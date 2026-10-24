import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build as viteBuild } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { beforeAll, expect, it } from 'vitest';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const browser = process.env.MEMBERSHIP_TEST_BROWSER ?? [
  'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(existsSync);
let css = '';
beforeAll(async () => {
  const result = await viteBuild({ configFile: false, logLevel: 'error', plugins: [tailwindcss()],
    build: { write: false, rollupOptions: { input: resolve(projectRoot, 'src/index.css') } } });
  const outputs = Array.isArray(result) ? result.flatMap(item => item.output) : 'output' in result ? result.output : [];
  css = outputs.flatMap(item => item.type === 'asset' && item.fileName.endsWith('.css') ? [item.source] : []).join('\n');
});

it.each([390, 1280])('real Provider, mobile nav, profile and Auth admin-entry DOM (%i px)', async width => {
  if (!browser) throw new Error('Browser required for admin entry verification');
  const working = mkdtempSync(join(tmpdir(), 'admin-entry-'));
  const require = createRequire(import.meta.url);
  const { build } = createRequire(require.resolve('vite'))('esbuild');
  try {
    const bundle = await build({ absWorkingDir: projectRoot, bundle: true, write: false, outfile: 'entry.js', platform: 'browser', format: 'iife', jsx: 'automatic',
      define: { 'process.env.NODE_ENV': '"development"', 'import.meta.env': '{"VITE_WORKER_API_URL":"https://offline.invalid"}' },
      stdin: { contents: `import { runAdminEntryChecks } from './src/components/AdminEntry.browser.fixture';
        runAdminEntryChecks().then(report => { parent.document.body.dataset.result='passed'; parent.document.getElementById('result').textContent=JSON.stringify(report); })
        .catch(error => { parent.document.body.dataset.result='failed'; parent.document.getElementById('result').textContent=String(error.stack); });`, resolveDir: projectRoot, loader: 'tsx' },
    });
    const inlineCss = bundle.outputFiles.filter((f: { path: string }) => f.path.endsWith('.css')).map((f: { text: string }) => f.text).join('\n');
    const page = join(working, 'entry.html');
    writeFileSync(page, `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none';">
      <style>${css}${inlineCss}</style><body><div id="root"></div><script>${bundle.outputFiles.find((f: { path: string }) => !f.path.endsWith('.css')).text.replace(/<\/script/gi, '<\\/script')}</script>`);
    const harness = join(working, 'harness.html');
    writeFileSync(harness, `<!doctype html><body><iframe style="width:${width}px;height:844px;border:0" src="${pathToFileURL(page).href}"></iframe><pre id="result">pending</pre>`);
    const output = execFileSync(browser, ['--headless=new', '--allow-file-access-from-files', '--disable-gpu', '--disable-background-networking',
      '--disable-component-update', '--disable-extensions', '--disable-sync', '--no-first-run', '--no-default-browser-check',
      '--host-resolver-rules=MAP * ~NOTFOUND', '--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=<-loopback>',
      `--user-data-dir=${join(working, 'profile')}`, '--dump-dom', '--virtual-time-budget=15000', pathToFileURL(harness).href],
      { encoding: 'utf8', timeout: 45000, maxBuffer: 5 * 1024 * 1024, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const reportText = output.match(/<pre id="result">([\s\S]*?)<\/pre>/)?.[1] ?? 'browser did not finish';
    expect(output.includes('data-result="passed"'), reportText).toBe(true);
    const report = JSON.parse(reportText.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
    expect(report.viewportWidth).toBe(width); expect(report.browserErrors).toEqual([]); expect(report.forbiddenRequests).toBe(0);
    console.log(`Admin entry (${width}px): ${report.checks.length} checks, real Provider/mobile/profile/Auth DOM, offline fetch only.`);
  } finally {
    if (dirname(resolve(working)) !== resolve(tmpdir()) || !basename(working).startsWith('admin-entry-')) throw new Error('Unexpected temporary path');
    rmSync(working, { recursive: true, force: true });
  }
}, 60000);

it('App wires the profile entry to the existing /admin route (no admin component changes)', () => {
  const source = readFileSync(resolve(projectRoot, 'src/App.tsx'), 'utf8');
  expect(/<UserProfileModal[\s\S]*?onOpenAdminPanel=/.test(source)).toBe(true);
});
