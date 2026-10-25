import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';

const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));
const browser = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
it.skipIf(!browser).each([1280, 390])('verifies real brand/color DOM CRUD and safety states at %i px', async width => {
  const working = mkdtempSync(join(tmpdir(), 'admin-brands-'));
  const require = createRequire(import.meta.url);
  const { build } = createRequire(require.resolve('vite'))('esbuild');
  try {
    const bundle = await build({ absWorkingDir: projectRoot, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
      define: { 'process.env.NODE_ENV': '"development"' },
      stdin: { contents: `import { runAdminBrandsColorsChecks } from './src/components/admin/AdminBrandsColors.browser.fixture';
        runAdminBrandsColorsChecks().then(report=>{parent.document.body.dataset.result='passed';parent.document.getElementById('result').textContent=JSON.stringify(report);})
        .catch(error=>{parent.document.body.dataset.result='failed';parent.document.getElementById('result').textContent=String(error.stack||error);});`, resolveDir: projectRoot, loader: 'tsx' },
      plugins: [{ name: 'css-separate', setup(builder: any) { builder.onLoad({ filter: /\.css$/ }, () => ({ contents: '', loader: 'text' })); } }],
    });
    const css = readFileSync(join(projectRoot, 'src/components/admin/admin.css'), 'utf8') + '\n'
      + readFileSync(join(projectRoot, 'src/components/admin/AdminBrandsColors.css'), 'utf8');
    const script = bundle.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
    const page = join(working, 'brands.html');
    writeFileSync(page, `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'">
      <style>body{margin:0}*{box-sizing:border-box}button{font:inherit;cursor:pointer}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}${css}</style><body><div id="root"></div><script>${script}</script></body></html>`);
    const harness = join(working, 'harness.html');
    writeFileSync(harness, `<!doctype html><html><meta charset="utf-8"><body style="margin:0;overflow:hidden"><iframe style="display:block;width:${width}px;height:100vh;border:0" src="${pathToFileURL(page).href}"></iframe><pre hidden id="result">pending</pre></body></html>`);
    const evidence = process.env.ADMIN_BRANDS_EVIDENCE_DIR; if (evidence) mkdirSync(resolve(evidence), { recursive: true });
    const output = execFileSync(browser!, ['--headless=new', '--force-prefers-reduced-motion', '--allow-file-access-from-files', '--disable-gpu', '--disable-background-networking', '--disable-component-update',
      '--disable-default-apps', '--disable-extensions', '--disable-sync', '--no-first-run', '--no-default-browser-check', '--metrics-recording-only',
      '--host-resolver-rules=MAP * ~NOTFOUND', '--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=<-loopback>',
      `--user-data-dir=${join(working, 'profile')}`, '--window-size=1360,1100', '--dump-dom', '--virtual-time-budget=20000',
      ...(evidence ? [`--screenshot=${resolve(evidence, `admin-brands-${width}.png`)}`] : []), pathToFileURL(harness).href],
    { encoding: 'utf8', timeout: 50000, maxBuffer: 4 * 1024 * 1024, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const reportText = (output.match(/<pre[^>]*id="result"[^>]*>([\s\S]*?)<\/pre>/)?.[1] ?? 'browser did not finish')
      .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    expect(output.includes('data-result="passed"'), reportText).toBe(true);
    const report = JSON.parse(reportText); expect(report.viewportWidth).toBe(width); expect(report.checks.length).toBeGreaterThanOrEqual(25); expect(report.browserErrors).toEqual([]);
    if (evidence) writeFileSync(resolve(evidence, `admin-brands-${width}.json`), JSON.stringify(report, null, 2));
  } finally {
    if (dirname(resolve(working)) !== resolve(tmpdir()) || !basename(working).startsWith('admin-brands-')) throw new Error('Unexpected temporary path');
    rmSync(working, { recursive: true, force: true });
  }
}, 65000);
