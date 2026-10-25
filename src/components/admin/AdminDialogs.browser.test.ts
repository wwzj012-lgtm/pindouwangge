import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';

const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));
const browser = process.env.ADMIN_DIALOGS_TEST_BROWSER ?? [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(existsSync);

it.skipIf(!browser).each([1280, 390])('verifies portal focus, inert, busy and error lifecycle in real offline DOM (%i px)', async width => {
  const working = mkdtempSync(join(tmpdir(), 'admin-dialogs-'));
  const require = createRequire(import.meta.url);
  const { build } = createRequire(require.resolve('vite'))('esbuild');
  const tailwind = createRequire(require.resolve('@tailwindcss/vite'));
  const { compile } = tailwind('@tailwindcss/node');
  const { Scanner } = tailwind('@tailwindcss/oxide');
  try {
    const bundle = await build({
      absWorkingDir: projectRoot, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
      define: { 'process.env.NODE_ENV': '"development"' },
      stdin: { contents: `import { runAdminDialogChecks } from './src/components/admin/AdminDialogs.browser.fixture';
        runAdminDialogChecks().then(report => {
          parent.document.body.dataset.result='passed';parent.document.getElementById('result').textContent=JSON.stringify(report);
        }).catch(error => {
          parent.document.body.dataset.result='failed';parent.document.getElementById('result').textContent=String(error.stack || error);
        });`, resolveDir: projectRoot, loader: 'tsx' },
      plugins: [{ name: 'offline-admin-only', setup(builder: any) {
        builder.onResolve({ filter: /context\/AuthContext$/ }, () => ({ path: 'auth', namespace: 'offline-admin' }));
        builder.onResolve({ filter: /utils\/api$/ }, () => ({ path: 'api', namespace: 'offline-admin' }));
        builder.onLoad({ filter: /.*/, namespace: 'offline-admin' }, (args: any) => ({ contents: args.path === 'auth'
          ? 'export const useAuth = () => globalThis.__adminFixtureAuth;'
          : 'export const getApiToken=()=>"fixture-user";export const getAdminSessionToken=()=>"fixture-admin";export const clearAdminSession=()=>{};export const setAdminSessionToken=()=>{};' }));
        builder.onLoad({ filter: /\.css$/ }, () => ({ contents: '', loader: 'text' }));
      } }],
    });
    // Compile the real utility layer, not an approximation of responsive classes.
    const compiler = await compile('@import "tailwindcss";', { base: projectRoot, onDependency: () => {} });
    const scanner = new Scanner({ sources: [{ base: projectRoot, pattern: 'src/components/admin/**/*.tsx', negated: false }] });
    const css = compiler.build(scanner.scan()) + '\n' + readFileSync(join(projectRoot, 'src/components/admin/admin.css'), 'utf8');
    const script = bundle.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
    const page = join(working, 'admin.html');
    writeFileSync(page, `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src blob:; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none';">
      <style>body{margin:0}*{box-sizing:border-box}${css}</style><body><div id="root"></div><script>${script}</script></body></html>`);
    const harness = join(working, 'harness.html');
    writeFileSync(harness, `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><body style="margin:0;overflow:hidden"><iframe title="后台离线验证" style="display:block;width:${width}px;height:100vh;border:0" src="${pathToFileURL(page).href}?section=users"></iframe><pre hidden id="result">pending</pre></body></html>`);
    const evidence = process.env.ADMIN_DIALOGS_EVIDENCE_DIR;
    if (evidence) {
      mkdirSync(resolve(evidence), { recursive: true });
      const persistentPage = resolve(evidence, `admin-dialogs-page-${width}.html`);
      writeFileSync(persistentPage, readFileSync(page, 'utf8'));
      writeFileSync(resolve(evidence, `admin-dialogs-fixture-${width}.html`), readFileSync(harness, 'utf8').replace(pathToFileURL(page).href, pathToFileURL(persistentPage).href));
    }
    const output = execFileSync(browser!, [
      '--headless=new', '--force-prefers-reduced-motion', '--allow-file-access-from-files', '--disable-gpu', '--disable-background-networking', '--disable-component-update',
      '--disable-default-apps', '--disable-extensions', '--disable-sync', '--no-first-run', '--no-default-browser-check',
      '--metrics-recording-only', '--disable-breakpad', '--disable-domain-reliability', '--disable-quic',
      '--disable-features=NetworkPrediction,OptimizationHints,MediaRouter,AutofillServerCommunication',
      '--host-resolver-rules=MAP * ~NOTFOUND', '--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=<-loopback>',
      `--user-data-dir=${join(working, 'browser-profile')}`, `--window-size=${Math.max(800, width)},1000`, '--dump-dom', '--virtual-time-budget=20000',
      ...(evidence ? [`--screenshot=${resolve(evidence, `admin-dialogs-${width}.png`)}`] : []),
      pathToFileURL(harness).href,
    ], { encoding: 'utf8', timeout: 50000, maxBuffer: 5 * 1024 * 1024, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const reportText = (output.match(/<pre[^>]*id="result"[^>]*>([\s\S]*?)<\/pre>/)?.[1] ?? 'browser did not finish')
      .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    expect(output.includes('data-result="passed"'), reportText).toBe(true);
    const report = JSON.parse(reportText);
    expect(report.viewportWidth).toBe(width);
    expect(report.checks.length).toBeGreaterThanOrEqual(30);
    expect(report.browserErrors).toEqual([]);
    if (evidence) writeFileSync(resolve(evidence, `admin-dialogs-${width}.json`), JSON.stringify(report, null, 2));
    console.log(`Admin dialogs (${width}px): ${report.checks.length} real DOM checks; ${report.writeCount} synthetic writes; no live requests.`);
  } finally {
    // Same-shell validated absolute temp directory only; never delete workspace paths.
    if (dirname(resolve(working)) !== resolve(tmpdir()) || !basename(working).startsWith('admin-dialogs-')) throw new Error('Unexpected temporary path');
    rmSync(working, { recursive: true, force: true });
  }
}, 65000);
