// 浏览器端冒烟检查：真实 Chrome 里加载 u2netp（onnxruntime-web / WASM），
// 对 street-boy 跑 computeSubjectMask，验证 /ort/ wasm、/models/u2netp.onnx、
// canvas 预处理与上采样整条链路。
// 运行: node scripts/seg-browser-check.mjs
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'vite';

const chromePath = process.env.PRACTICE_TEST_CHROME
  ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
if (!existsSync(chromePath)) {
  console.error('Chrome not found:', chromePath);
  process.exit(1);
}

const fixtureHtml = `<!DOCTYPE html><html><body><div id="status">running</div><script type="module">
import { computeSubjectMask } from '/src/utils/subjectSegmentation.ts';
const img = new Image();
img.onload = async () => {
  const started = performance.now();
  try {
    const result = await computeSubjectMask(img);
    window.probe = {
      ok: true,
      coverage: result ? result.coverage : null,
      width: result ? result.width : 0,
      height: result ? result.height : 0,
      ms: Math.round(performance.now() - started),
    };
  } catch (error) {
    window.probe = { ok: false, error: String(error && error.stack || error) };
  }
  document.getElementById('status').textContent = 'done';
};
img.onerror = () => { window.probe = { ok: false, error: 'image load failed' }; document.getElementById('status').textContent = 'done'; };
img.src = '/benchmark/images/street-boy.jpg';
</script></body></html>`;

const server = await createServer({
  configFile: 'vite.config.ts',
  root: process.cwd(),
  appType: 'custom',
  logLevel: 'error',
  server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
  plugins: [{
    name: 'seg-check-fixture',
    configureServer(middleware) {
      middleware.middlewares.use('/__seg-check', (_req, res) => {
        res.setHeader('content-type', 'text/html');
        res.end(fixtureHtml);
      });
    },
  }],
});
await server.listen();
const address = server.httpServer.address();
const profile = await mkdtemp(join(tmpdir(), 'seg-browser-check-'));let chrome;
try {
  chrome = spawn(chromePath, [
    '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  const endpoint = await new Promise((accept, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error('Chrome startup timeout')), 15000);
    chrome.stderr.on('data', chunk => {
      output += chunk;
      const found = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (found) { clearTimeout(timeout); accept(found[1]); }
    });
    chrome.on('error', error => { clearTimeout(timeout); reject(error); });
  });
  const socket = new WebSocket(endpoint);
  await new Promise((accept, reject) => {
    socket.addEventListener('open', () => accept(), { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let serial = 0;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(String(event.data));
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(JSON.stringify(message.error)));
    else request.accept(message.result);
  });
  const send = (method, params = {}, sessionId) => new Promise((accept, reject) => {
    const id = ++serial;
    pending.set(id, { accept, reject });
    socket.send(JSON.stringify({ id, method, params, sessionId }));
  });
  const evaluate = async (expression, sessionId) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const wait = ms => new Promise(accept => setTimeout(accept, ms));
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Runtime.enable', {}, sessionId);
  const consoleLines = [];
  socket.addEventListener('message', event => {
    const message = JSON.parse(String(event.data));
    if (message.method === 'Runtime.consoleAPICalled' && message.params?.args) {
      consoleLines.push(message.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300));
    }
  });
  await send('Page.enable', {}, sessionId);
  await send('Page.navigate', { url: `http://127.0.0.1:${address.port}/__seg-check` }, sessionId);
  let probe = null;
  for (let i = 0; i < 300; i++) {
    probe = await evaluate('window.probe ?? null', sessionId).catch(() => null);
    if (probe) break;
    await wait(200);
  }
  if (!probe) {
    console.log('console:', consoleLines.slice(-5));
    throw new Error('probe never resolved (timeout)');
  }
  if (probe.coverage === null && consoleLines.length) {
    console.log('console:', consoleLines.slice(-8));
  }
  console.log('browser probe:', JSON.stringify(probe));
  if (consoleLines.length) console.log('console:', consoleLines.slice(-8));
  if (!probe.ok || probe.coverage === null) {
    console.error('FAIL:', probe.error ?? 'mask null');
    process.exitCode = 1;
  } else if (probe.coverage < 0.15 || probe.coverage > 0.5) {
    console.error(`FAIL: coverage ${probe.coverage} out of expected range`);
    process.exitCode = 1;
  } else {
    console.log(`PASS: coverage ${(probe.coverage * 100).toFixed(1)}% on ${probe.width}x${probe.height} in ${probe.ms}ms`);
  }
} finally {
  if (chrome) chrome.kill();
  // Windows: Chrome briefly locks files inside the profile after kill.
  try { await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch { /* best effort */ }
  await new Promise(accept => server.close(accept));
}
