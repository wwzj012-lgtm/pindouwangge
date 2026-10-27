import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const browser = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
it.skipIf(!browser).each([1280, 390])('keeps the actual App canvas stable and strict conversions safe at %i px', async width => {
  const working = mkdtempSync(join(tmpdir(), 'brand-refresh-'));
  const require = createRequire(import.meta.url);
  const { build } = createRequire(require.resolve('vite'))('esbuild');
  const tailwindRequire = createRequire(require.resolve('@tailwindcss/vite'));
  const { compile } = tailwindRequire('@tailwindcss/node');
  const { Scanner } = tailwindRequire('@tailwindcss/oxide');
  let server: ReturnType<typeof createServer> | undefined;
  try {
    const bundle = await build({ absWorkingDir: projectRoot, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
      define: { 'process.env.NODE_ENV': '"development"', 'import.meta.env': JSON.stringify({ DEV: true, VITE_DEV_ALGORITHM_TEST: 'false' }) },
      stdin: { contents: `import { runBrandCatalogChecks } from './src/data/brandCatalog.browser.fixture';
        runBrandCatalogChecks().then(report=>{parent.document.body.dataset.result='passed';parent.document.getElementById('result').textContent=JSON.stringify(report);})
        .catch(error=>{parent.document.body.dataset.result='failed';parent.document.getElementById('result').textContent=String(error.stack||error);});`, resolveDir: projectRoot, loader: 'tsx' },
      plugins: [{ name: 'browser-app-probe', setup(builder: any) {
        builder.onLoad({ filter: /[\\/]src[\\/]App\.tsx$/ }, ({ path }: { path: string }) => {
          const original = readFileSync(path, 'utf8');
          const marker = '  return (\n    <div className="flex flex-col h-screen';
          if (!original.includes(marker)) throw new Error('App probe insertion point changed');
          return { contents: original.replace(marker, `  (window as any).__brandCatalogApp = { convertImageToGrid, handleConvertLargeCanvasImage, activePalette, setActivePalette, grid, settings, imageLoadMessage, setImageLoadMessage };\n${marker}`), loader: 'tsx' };
        });
        builder.onLoad({ filter: /\.css$/ }, () => ({ contents: '', loader: 'text' }));
      } }],
    });
    const compiler = await compile(readFileSync(join(projectRoot, 'src/index.css'), 'utf8'), { base: join(projectRoot, 'src'), onDependency() {} });
    const scanner = new Scanner({ sources: [{ base: projectRoot, pattern: 'src/**/*.{tsx,ts}', negated: false }] });
    const css = compiler.build(scanner.scan());
    const script = bundle.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
    const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'">
      <style>${css}</style><body><div id="root"></div><script>window.addEventListener('error',event=>{parent.document.body.dataset.result='failed';parent.document.getElementById('result').textContent=event.message;});</script><script>${script}</script></body></html>`;
    const harness = `<!doctype html><html><body style="margin:0;overflow:hidden"><iframe style="display:block;width:${width}px;height:100vh;border:0" src="/workspace?tab=studio"></iframe><pre hidden id="result">pending</pre></body></html>`;
    server = createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(req.url === '/harness' ? harness : html); });
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    const evidence = process.env.BRAND_CATALOG_EVIDENCE_DIR;
    if (evidence) mkdirSync(resolve(evidence), { recursive: true });
    const { stdout } = await promisify(execFile)(browser!, ['--headless=new', '--force-prefers-reduced-motion', '--disable-gpu', '--disable-background-networking',
      '--disable-component-update', '--disable-default-apps', '--disable-extensions', '--disable-sync', '--no-first-run', '--no-default-browser-check',
      `--user-data-dir=${join(working, 'profile')}`, '--window-size=1360,1000', '--dump-dom', '--virtual-time-budget=20000',
      `http://127.0.0.1:${port}/harness`],
    { encoding: 'utf8', timeout: 50000, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
    const reportText = (stdout.match(/<pre[^>]*id="result"[^>]*>([\s\S]*?)<\/pre>/)?.[1] ?? 'browser did not finish')
      .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    expect(stdout.includes('data-result="passed"'), reportText).toBe(true);
    const report = JSON.parse(reportText);
    expect(report.viewportWidth).toBe(width);
    expect(report.checks.length).toBe(width >= 1024 ? 25 : 24);
    expect(report.browserErrors).toEqual([]);
    if (evidence) writeFileSync(resolve(evidence, `brand-refresh-${width}.json`), JSON.stringify(report, null, 2));
  } finally {
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    if (dirname(resolve(working)) !== resolve(tmpdir()) || !basename(working).startsWith('brand-refresh-')) throw new Error('Unexpected temporary path');
    rmSync(working, { recursive: true, force: true });
  }
}, 65000);
