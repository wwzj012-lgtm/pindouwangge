import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const browser = process.env.AUTH_PROVIDER_TEST_BROWSER ?? [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(existsSync);

it.each(['refresh', 'redeem', 'transports', 'current', 'credentials'])('real API + AuthProvider, mock fetch: %s', async scenario => {
  if (!browser) throw new Error('Set AUTH_PROVIDER_TEST_BROWSER to run real API browser regressions');
  const working = mkdtempSync(join(tmpdir(), 'auth-api-session-'));
  const require = createRequire(import.meta.url);
  const { build } = createRequire(require.resolve('vite'))('esbuild');
  try {
    const bundle = await build({
      absWorkingDir: projectRoot, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
      define: { 'process.env.NODE_ENV': '"development"', 'import.meta.env.VITE_WORKER_API_URL': '"https://offline.invalid"' },
      // Deliberately no aliases/plugins: both Provider and API client are real.
      stdin: { contents: `import { runRealApiSessionChecks } from './src/context/AuthContext.api.browser.fixture';
        runRealApiSessionChecks(${JSON.stringify(scenario)}).then(report => {
          document.body.dataset.result = 'passed'; document.getElementById('result').textContent = JSON.stringify(report);
        }).catch(error => {
          document.body.dataset.result = 'failed'; document.getElementById('result').textContent = String(error.stack);
        });`, resolveDir: projectRoot, loader: 'tsx' },
    });
    const page = join(working, 'account-api.html');
    writeFileSync(page, `<!doctype html><meta charset="utf-8">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; connect-src 'none';">
      <body><div id="root"></div><pre id="result">pending</pre><script>${bundle.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script></body>`);
    const output = execFileSync(browser, [
      '--headless=new', '--disable-gpu', '--disable-background-networking', '--disable-component-update',
      '--disable-default-apps', '--disable-extensions', '--disable-sync', '--no-first-run', '--no-default-browser-check',
      '--host-resolver-rules=MAP * ~NOTFOUND', '--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=<-loopback>',
      `--user-data-dir=${join(working, 'browser-profile')}`, '--dump-dom', '--virtual-time-budget=15000', pathToFileURL(page).href,
    ], { encoding: 'utf8', timeout: 45000, maxBuffer: 5 * 1024 * 1024, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const reportText = output.match(/<pre id="result">([\s\S]*?)<\/pre>/)?.[1] ?? 'browser did not finish';
    expect(output.includes('data-result="passed"'), reportText).toBe(true);
    const report = JSON.parse(reportText.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
    expect(report.checks.length).toBeGreaterThan(15);
    expect(report.browserErrors).toEqual([]);
    expect(report.forbiddenRequests).toBe(0);
    console.log(`Real API + Provider ${scenario}: ${report.checks.length} checks, fetch mocked only, no credential logging.`);
  } finally {
    if (dirname(resolve(working)) !== resolve(tmpdir()) || !basename(working).startsWith('auth-api-session-')) throw new Error('Unexpected browser temporary path');
    rmSync(working, { recursive: true, force: true });
  }
}, 60000);
