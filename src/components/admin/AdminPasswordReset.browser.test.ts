import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';

const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));
const browser = process.env.ADMIN_RESET_TEST_BROWSER ?? [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(existsSync);

it.skipIf(!browser).each([1280, 390])('drives the current admin reset-password UI in an offline browser (%i px)', async width => {
  const working = mkdtempSync(join(tmpdir(), 'admin-reset-'));
  const require = createRequire(import.meta.url);
  const { build } = createRequire(require.resolve('vite'))('esbuild');
  try {
    const bundle = await build({
      absWorkingDir: projectRoot, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
      define: { 'process.env.NODE_ENV': '"development"' },
      stdin: { contents: `import { runAdminPasswordResetChecks } from './src/components/admin/AdminPasswordReset.browser.fixture';
        runAdminPasswordResetChecks().then(report => {
          parent.document.body.dataset.result = 'passed'; parent.document.getElementById('result').textContent = JSON.stringify(report);
        }).catch(error => {
          document.getElementById('root').replaceChildren();
          parent.document.body.dataset.result = 'failed'; parent.document.getElementById('result').textContent = String(error.message);
        });`, resolveDir: projectRoot, loader: 'tsx' },
      plugins: [{ name: 'offline-admin-dependencies', setup(builder: any) {
        // Expose the real cache only in this in-memory test build (Kant probe).
        builder.onLoad({ filter: /[\\/]AdminConsole\.tsx$/ }, (args: any) => {
          const source = readFileSync(args.path, 'utf8');
          const marker = '  const edits = useRef(new Map<Control, string>());';
          if (!source.includes(marker)) throw new Error('Admin editor cache probe needs updating');
          return { contents: source.replace(marker, marker + '\n  (globalThis as any).__adminFixtureEdits = edits;'), loader: 'tsx' };
        });
        builder.onResolve({ filter: /context\/AuthContext$/ }, () => ({ path: 'auth', namespace: 'admin-fixture' }));
        builder.onResolve({ filter: /utils\/api$/ }, () => ({ path: 'api', namespace: 'admin-fixture' }));
        builder.onLoad({ filter: /.*/, namespace: 'admin-fixture' }, (args: any) => ({ contents: args.path === 'auth'
          ? 'export const useAuth = () => globalThis.__adminFixtureAuth;'
          : 'export const getApiToken = () => null; export const getAdminSessionToken = () => null; export const clearAdminSession = () => globalThis.__adminFixtureClearSession?.(); export const setAdminSessionToken = () => {};' }));
        builder.onLoad({ filter: /\.css$/ }, () => ({ contents: '', loader: 'text' }));
      } }],
    });
    const script = bundle.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
    const css = readFileSync(join(projectRoot, 'src/components/admin/admin.css'), 'utf8');
    const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none';">
      <style>body{margin:0}*{box-sizing:border-box}${css}</style>
      <body><div id="root"></div><pre id="result">pending</pre><script>${script}</script></body>`;
    const page = join(working, 'admin.html'); writeFileSync(page, html);
    // A fixed-width browsing context avoids Chrome's minimum desktop window
    // width, so the mobile run really has a 390px viewport.
    const harness = join(working, 'harness.html');
    writeFileSync(harness, `<!doctype html><meta charset="utf-8"><body><iframe style="width:${width}px;height:900px;border:0" src="${pathToFileURL(page).href}?section=users"></iframe><pre id="result">pending</pre></body>`);
    const output = execFileSync(browser!, [
      '--headless=new', '--allow-file-access-from-files', '--disable-gpu', '--disable-background-networking', '--disable-component-update',
      '--disable-default-apps', '--disable-extensions', '--disable-sync', '--no-first-run', '--no-default-browser-check',
      '--metrics-recording-only', '--disable-breakpad', '--disable-domain-reliability', '--disable-quic',
      '--disable-features=NetworkPrediction,OptimizationHints,MediaRouter,AutofillServerCommunication',
      '--host-resolver-rules=MAP * ~NOTFOUND', '--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=<-loopback>',
      `--user-data-dir=${join(working, 'browser-profile')}`, `--window-size=${width},900`, '--dump-dom', '--virtual-time-budget=15000',
      pathToFileURL(harness).href,
    ], { encoding: 'utf8', timeout: 45000, maxBuffer: 5 * 1024 * 1024, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const reportText = output.match(/<pre id="result">([\s\S]*?)<\/pre>/)?.[1] ?? 'browser did not finish';
    expect(output.includes('data-result="passed"'), reportText).toBe(true);
    const report = JSON.parse(reportText.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
    expect(report.checks.length).toBeGreaterThanOrEqual(80);
    expect(report.viewportWidth).toBe(width);
    expect(report.browserErrors).toEqual([]);
    console.log(`Current admin browser (${width}px): ${report.checks.length} checks passed; ${report.writeCount} mocked writes; no live requests.`);
  } finally {
    if (dirname(resolve(working)) !== resolve(tmpdir()) || !basename(working).startsWith('admin-reset-')) throw new Error('Unexpected browser temporary path');
    rmSync(working, { recursive: true, force: true });
  }
}, 60000);
