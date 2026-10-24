import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, expect, it } from 'vitest';

const cases = ['cloud-only rename', 'cloud-only delete', 'missing local delete is idempotent', 'foreign local guards',
  'real retry retains entitlement', 'helper drives real sync without dropping entitlement', 'unbound sync migrates scoped entitlement', 'private helper persists offline publication',
  'cloud-only private publish restores and persists cache',
  'quota recovery keeps DRAFT metadata and publishing locked', 'already-bound migration failure stays locked and retryable',
  'two-argument mark remains compatible', 'latest DRAFT blocks stale completed summary', 'actual grid exceeds latest paid coverage'];
let server: ViteDevServer;
let chrome: ChildProcess;
let socket: WebSocket;
let working: string;
let evaluate: (expression: string) => Promise<any>;
beforeAll(async () => {
  const browser = process.env.LIBRARY_TEST_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  if (!existsSync(browser)) throw new Error('Set LIBRARY_TEST_CHROME for real IndexedDB regression');
  working = await mkdtemp(join(tmpdir(), 'publication-storage-'));
  server = await createServer({ configFile: false, envDir: working, server: { host: '127.0.0.1', port: 0, hmr: false, watch: null }, plugins: [{
    name: 'real-storage-fixture', configureServer(vite) {
      vite.middlewares.use(async (req, res, next) => {
        if (req.url !== '/__storage-check') return next();
        res.setHeader('Content-Type', 'text/html');
        res.end(await vite.transformIndexHtml(req.url, '<!doctype html><body><script type="module" src="/src/utils/communityPatternPublication.storage.fixture.ts"></script></body>'));
      });
    },
  }] });
  await server.listen();
  const address = server.httpServer!.address(); if (!address || typeof address === 'string') throw new Error('Missing local test port');
  chrome = spawn(browser, ['--headless=new', '--no-first-run', '--disable-gpu', '--disable-background-networking', '--disable-component-update',
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', '--remote-debugging-port=0', `--user-data-dir=${join(working, 'chrome')}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  const endpoint = await new Promise<string>((accept, reject) => {
    let output = ''; const timeout = setTimeout(() => reject(new Error('Chrome startup timeout')), 15000);
    chrome.stderr!.on('data', chunk => { output += chunk; const found = output.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (found) { clearTimeout(timeout); accept(found[1]); } });
    chrome.on('error', error => { clearTimeout(timeout); reject(error); });
  });
  socket = new WebSocket(endpoint);
  await new Promise<void>((accept, reject) => { socket.addEventListener('open', () => accept(), { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let serial = 0; const pending = new Map<number, { accept: (value: any) => void; reject: (error: Error) => void }>();
  socket.addEventListener('message', event => {
    const message = JSON.parse(String(event.data)); const request = pending.get(message.id); if (!request) return;
    pending.delete(message.id); if (message.error) request.reject(new Error(JSON.stringify(message.error))); else request.accept(message.result);
  });
  const send = (method: string, params = {}, sessionId?: string): Promise<any> => new Promise((accept, reject) => { const id = ++serial; pending.set(id, { accept, reject }); socket.send(JSON.stringify({ id, method, params, sessionId })); });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  await send('Page.enable', {}, sessionId);
  await send('Page.navigate', { url: `http://127.0.0.1:${address.port}/__storage-check` }, sessionId);
  for (let i = 0; i < 150; i++) { if (await evaluate('Boolean(window.runStorageCase)')) return; await new Promise(accept => setTimeout(accept, 100)); }
  throw new Error(`Storage fixture not ready: ${await evaluate('document.body.innerText')}`);
}, 30000);

it.each(cases)('real IndexedDB + history + publication helper: %s', async name => {
  expect(await evaluate(`window.runStorageCase(${JSON.stringify(name)})`)).toEqual({ name, passed: true });
}, 20000);

afterAll(async () => {
  socket?.close();
  if (chrome && chrome.exitCode === null) { const stopped = new Promise<void>(accept => chrome.once('exit', () => accept())); chrome.kill(); await stopped; }
  await server?.close();
  if (working) {
    if (dirname(resolve(working)) !== resolve(tmpdir()) || !basename(working).startsWith('publication-storage-')) throw new Error('Unexpected storage test temporary path');
    await rm(working, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
