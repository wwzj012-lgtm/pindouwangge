import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';

const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));
const browser = process.env.ADMIN_MANAGEMENT_TEST_BROWSER ?? [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(existsSync);

it.skipIf(!browser).each(['config', 'uncertain', 'pagination'].flatMap(scenario => [1280, 390].map(width => ({ scenario, width }))))('repairs review regression $scenario in real offline DOM ($width px)', async ({ scenario, width }) => {
  const working = mkdtempSync(join(tmpdir(), 'admin-management-'));
  const require = createRequire(import.meta.url);
  const { build } = createRequire(require.resolve('vite'))('esbuild');
  const tailwind = createRequire(require.resolve('@tailwindcss/vite'));
  const { compile } = tailwind('@tailwindcss/node');
  const { Scanner } = tailwind('@tailwindcss/oxide');
  try {
    const bundle = await build({
      absWorkingDir: projectRoot, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
      define: { 'process.env.NODE_ENV': '"development"' },
      stdin: { contents: `import { runAdminReviewRegressionChecks } from './src/components/admin/AdminReviewRegression.browser.fixture';
        runAdminReviewRegressionChecks('${scenario}').then(report => {
          parent.document.body.dataset.result=report.passed?'passed':'failed';parent.document.getElementById('result').textContent=JSON.stringify(report);
        }).catch(error => {
          parent.document.body.dataset.result='failed';parent.document.getElementById('result').textContent=String(error.stack || error);
        });`, resolveDir: projectRoot, loader: 'tsx' },
      plugins: [{ name: 'offline-admin-only', setup(builder: any) {
        builder.onResolve({ filter: /context\/AuthContext$/ }, () => ({ path: 'auth', namespace: 'offline-admin' }));
        builder.onResolve({ filter: /utils\/api$/ }, () => ({ path: 'api', namespace: 'offline-admin' }));
        builder.onLoad({ filter: /.*/, namespace: 'offline-admin' }, (args: any) => ({ contents: args.path === 'auth'
          ? 'export const useAuth = () => globalThis.__adminFixtureAuth;'
          : 'export const getApiToken=()=>null;export const getAdminSessionToken=()=>null;export const clearAdminSession=()=>{};export const setAdminSessionToken=()=>{};' }));
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
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none';">
      <style>body{margin:0}*{box-sizing:border-box}${css}</style><body><div id="root"></div><script>${script}</script></body></html>`);
    const harness = join(working, 'harness.html');
    writeFileSync(harness, `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><body style="margin:0;overflow:hidden"><iframe title="后台离线验证" style="display:block;width:${width}px;height:100vh;border:0" src="${pathToFileURL(page).href}?section=users"></iframe><pre hidden id="result">pending</pre></body></html>`);
    const evidence = process.env.ADMIN_MANAGEMENT_EVIDENCE_DIR;
    const stage = process.env.ADMIN_REVIEW_EVIDENCE_STAGE ?? 'green';
    const evidenceName = `admin-review-${stage}-${scenario}-${width}`;
    if (evidence) mkdirSync(resolve(evidence), { recursive: true });
    const output = execFileSync(browser!, [
      '--headless=new', '--force-prefers-reduced-motion', '--allow-file-access-from-files', '--disable-gpu', '--disable-background-networking', '--disable-component-update',
      '--disable-default-apps', '--disable-extensions', '--disable-sync', '--no-first-run', '--no-default-browser-check',
      '--metrics-recording-only', '--disable-breakpad', '--disable-domain-reliability', '--disable-quic',
      '--disable-features=NetworkPrediction,OptimizationHints,MediaRouter,AutofillServerCommunication',
      '--host-resolver-rules=MAP * ~NOTFOUND', '--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=<-loopback>',
      `--user-data-dir=${join(working, 'browser-profile')}`, `--window-size=${Math.max(800, width)},1000`, '--dump-dom', '--virtual-time-budget=20000',
      ...(evidence ? [`--screenshot=${resolve(evidence, `${evidenceName}.png`)}`] : []),
      pathToFileURL(harness).href,
    ], { encoding: 'utf8', timeout: 50000, maxBuffer: 5 * 1024 * 1024, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const reportText = (output.match(/<pre[^>]*id="result"[^>]*>([\s\S]*?)<\/pre>/)?.[1] ?? 'browser did not finish')
      .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    const report = JSON.parse(reportText);
    if (evidence) writeFileSync(resolve(evidence, `${evidenceName}.json`), JSON.stringify(report, null, 2));
    expect(report.passed, report.error ?? reportText).toBe(true);
    expect(report.viewportWidth).toBe(width);
    expect(report.checks.length).toBeGreaterThanOrEqual(8);
    expect(report.browserErrors).toEqual([]);
    if (evidence) writeFileSync(resolve(evidence, `${evidenceName}.json`), JSON.stringify(report, null, 2));
    console.log(`Current admin (${width}px): ${report.checks.length} real DOM checks; ${report.writeCount} synthetic writes; no live requests.`);
  } finally {
    // Same-shell validated absolute temp directory only; never delete workspace paths.
    if (dirname(resolve(working)) !== resolve(tmpdir()) || !basename(working).startsWith('admin-management-')) throw new Error('Unexpected temporary path');
    rmSync(working, { recursive: true, force: true });
  }
}, 65000);
