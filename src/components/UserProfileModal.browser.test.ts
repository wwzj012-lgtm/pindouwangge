import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { createServer } from 'vite';
import { expect, it } from 'vitest';

const chromePath = process.env.LIBRARY_TEST_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';

it('keeps every App gallery callback on the profile library, with no reachable legacy component', async () => {
  const app = await readFile(new URL('../App.tsx', import.meta.url), 'utf8');
  expect(app).not.toContain('UserPatternsModal');
  expect(app.match(/onOpenPatternsModal=\{openProfileLibrary\}/g)).toHaveLength(5);
  expect(app.match(/onOpenUserProfileModal=\{openProfileLibrary\}/g)).toHaveLength(2);
  expect(app).toContain('onOpenProfile={openProfileLibrary}');
  expect(app).not.toContain('openPublishFromProfile');
});

it('drives real App library entry points and publication/management DOM at 390 and 1280px', async () => {
  if (!existsSync(chromePath)) throw new Error('Set LIBRARY_TEST_CHROME to run real App DOM verification');
  const working = await mkdtemp(join(tmpdir(), 'profile-library-check-'));
  const historyMethods = ['getUserExportedPatterns', 'getPatternProject', 'getExportedPatternPreview', 'markLegacyByWorkKeys', 'saveExportedPatternRecord', 'retryPatternCloudSync', 'renameExportedPattern', 'deleteLocalExportedPatternCopy', 'deleteCloudExportedPatternAndLocal', 'markExportedPatternPublished'];
  const communityMethods = ['listFavoriteCommunityPosts', 'uploadCommunityAsset', 'publishCommunityPost', 'setCommunityPostVisibility', 'withdrawCommunityPost'];
  const server = await createServer({
    configFile: false, envDir: working,
    server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
    plugins: [{
      name: 'offline-library-fixture', enforce: 'pre',
      resolveId(id) { if (/[/\\]context[/\\]AuthContext(?:\.tsx?)?$/.test(id)) return '\0library-auth'; },
      async load(id) {
        if (id === '\0library-auth') return `import {useSyncExternalStore} from 'react';export const useAuth=()=>useSyncExternalStore(window.libraryProbe.subscribe,()=>window.libraryProbe.auth);`;
        const normalized = id.replaceAll('\\', '/');
        const group = normalized.endsWith('/src/utils/patternHistory.ts') ? 'history' : normalized.endsWith('/src/utils/communityApi.ts') ? 'community' : null;
        if (!group) return;
        // Keep real predicates, normalization, codecs, snapshot renderer and UI;
        // replace only IO boundaries, with no test flags in production source.
        let source = await readFile(id, 'utf8');
        const names = group === 'history' ? historyMethods : communityMethods;
        for (const name of names) source = source.replace(new RegExp(`export (async )?function ${name}\\b`, 'g'), (_all, async = '') => `${async}function fixtureOriginal_${name}`);
        return source + names.map(name => `\nexport const ${name}=(...args)=>window.libraryProbe.${group}.${name}(...args);`).join('');
      },
      configureServer(vite) {
        vite.middlewares.use(async (req, res, next) => {
          if (req.url !== '/__library-check') return next();
          res.setHeader('Content-Type', 'text/html');
          res.end(await vite.transformIndexHtml(req.url, '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="root"></div><script type="module" src="/src/components/UserProfileModal.browser.fixture.tsx"></script></body></html>'));
        });
      },
    }, react(), tailwindcss()],
  });
  let chrome: ChildProcess | undefined;
  let socket: WebSocket | undefined;
  try {
    await server.listen();
    const address = server.httpServer!.address();
    if (!address || typeof address === 'string') throw new Error('Missing local verification port');
    chrome = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--disable-background-networking', '--disable-component-update', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', '--remote-debugging-port=0', `--user-data-dir=${join(working, 'chrome')}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    const endpoint = await new Promise<string>((accept, reject) => {
      let output = '';
      const timeout = setTimeout(() => reject(new Error('Chrome startup timeout')), 15000);
      chrome!.stderr!.on('data', chunk => { output += chunk; const found = output.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (found) { clearTimeout(timeout); accept(found[1]); } });
      chrome!.on('error', error => { clearTimeout(timeout); reject(error); });
    });
    socket = new WebSocket(endpoint);
    await new Promise<void>((accept, reject) => { socket!.addEventListener('open', () => accept(), { once: true }); socket!.addEventListener('error', reject, { once: true }); });
    let serial = 0;
    const pending = new Map<number, { accept: (value: any) => void; reject: (error: Error) => void }>();
    socket.addEventListener('message', event => {
      const message = JSON.parse(String(event.data)); const request = pending.get(message.id); if (!request) return;
      pending.delete(message.id); if (message.error) request.reject(new Error(JSON.stringify(message.error))); else request.accept(message.result);
    });
    const send = (method: string, params = {}, sessionId?: string): Promise<any> => new Promise((accept, reject) => { const id = ++serial; pending.set(id, { accept, reject }); socket!.send(JSON.stringify({ id, method, params, sessionId })); });
    const evaluate = async (expression: string, sessionId: string) => {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    for (const width of [390, 1280]) {
      const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
      await send('Page.enable', {}, sessionId);
      await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width === 390 }, sessionId);
      await send('Page.navigate', { url: `http://127.0.0.1:${address.port}/__library-check` }, sessionId);
      let ready = false;
      for (let i = 0; i < 200; i++) { if (await evaluate('Boolean(window.runLibraryChecks)', sessionId)) { ready = true; break; } await new Promise(accept => setTimeout(accept, 100)); }
      if (!ready) throw new Error(`App fixture startup failed: ${await evaluate('document.body.innerText', sessionId)}`);
      await evaluate(`window.captureComposer=true;void window.runLibraryChecks(${width}).then(value=>window.libraryReport=value).catch(error=>window.libraryFailure=String(error.stack))`, sessionId);
      const poll = async (expression: string) => {
        for (let i = 0; i < 400; i++) {
          const failure = await evaluate('window.libraryFailure', sessionId);
          if (failure) throw new Error(failure);
          const value = await evaluate(expression, sessionId);
          if (value) return value;
          await new Promise(accept => setTimeout(accept, 50));
        }
        throw new Error(`Browser check timeout: ${expression}`);
      };
      await poll('window.composerReady');
      const screenshot = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
      await writeFile(join(tmpdir(), `profile-library-${width}.png`), Buffer.from(screenshot.data, 'base64'));
      await evaluate('window.resumeComposer();void 0', sessionId);
      const report = await poll('window.libraryReport');
      expect(report.viewportWidth).toBe(width);
      expect(report.checks.length).toBeGreaterThan(70);
      expect(report.browserErrors).toEqual([]);
      console.log(`Actual App library DOM (${width}px): ${report.checks.length} checks; all API calls intercepted locally.`);
      await send('Target.closeTarget', { targetId });
    }
  } finally {
    socket?.close();
    if (chrome && chrome.exitCode === null) { const stopped = new Promise<void>(accept => chrome!.once('exit', () => accept())); chrome.kill(); await stopped; }
    await server.close();
    if (dirname(resolve(working)) !== resolve(tmpdir()) || !basename(working).startsWith('profile-library-check-')) throw new Error('Unexpected browser temporary path');
    await rm(working, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}, 120000);
