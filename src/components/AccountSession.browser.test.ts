import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build as viteBuild } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { beforeAll, expect, it } from 'vitest';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const browser = process.env.MEMBERSHIP_TEST_BROWSER ?? [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(existsSync);
let css = '';
beforeAll(async () => {
  // Compile the actual app stylesheet, not a handwritten approximation of Tailwind.
  const result = await viteBuild({
    configFile: false, logLevel: 'error', plugins: [tailwindcss()],
    build: { write: false, rollupOptions: { input: resolve(projectRoot, 'src/index.css') } },
  });
  const outputs = Array.isArray(result) ? result.flatMap(item => item.output) : 'output' in result ? result.output : [];
  css = outputs.flatMap(item => item.type === 'asset' && item.fileName.endsWith('.css') ? [item.source] : []).join('\n');
  expect(css.length).toBeGreaterThan(1000);
});

it.each([
  ['redeem', 390], ['scopes', 390], ['restore', 390], ['logout', 390], ['reopen', 390],
  ['layout', 390], ['layout', 1280], ['capabilities', 390],
])('real AuthProvider browser regression: %s (%i px)', async (scenario, width) => {
  if (!browser) throw new Error('Set MEMBERSHIP_TEST_BROWSER to run browser regressions');
  const working = mkdtempSync(join(tmpdir(), 'account-session-'));
  const require = createRequire(import.meta.url);
  const { build } = createRequire(require.resolve('vite'))('esbuild');
  try {
    const bundle = await build({
      absWorkingDir: projectRoot, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
      define: { 'process.env.NODE_ENV': '"development"' },
      stdin: { contents: `import { runAccountSessionChecks } from './src/components/AccountSession.browser.fixture';
        runAccountSessionChecks(${JSON.stringify(scenario)}).then(report => {
          parent.document.body.dataset.result = 'passed'; parent.document.getElementById('result').textContent = JSON.stringify(report);
        }).catch(error => {
          parent.document.body.dataset.result = 'failed'; parent.document.getElementById('result').textContent = String(error.stack);
        });`, resolveDir: projectRoot, loader: 'tsx' },
      plugins: [{ name: 'offline-account-session-boundaries', setup(builder: any) {
        builder.onResolve({ filter: /utils\/api$/ }, () => ({ path: 'api', namespace: 'account-session' }));
        builder.onResolve({ filter: /context\/LanguageContext$/ }, () => ({ path: 'language', namespace: 'account-session' }));
        builder.onResolve({ filter: /utils\/authCredentials$/ }, () => ({ path: 'credentials', namespace: 'account-session' }));
        builder.onLoad({ filter: /.*/, namespace: 'account-session' }, (args: any) => ({ contents: {
          api: ['apiGet', 'apiGetCreditsSummary', 'apiCheckinCredits', 'apiPost', 'clearAdminSession', 'clearApiToken', 'getApiToken', 'setApiToken']
            .map(name => `export const ${name} = (...args) => globalThis.__accountSessionApi.${name}(...args);`).join('\n')
            + '\nexport const SIGNIN_REQUEST_OPTIONS = {}; export const SIGNUP_REQUEST_OPTIONS = {};',
          language: 'export const useLanguage = () => ({ language: globalThis.__accountSessionLanguage ?? "zh" });',
          credentials: 'export const AUTH_AUTOCOMPLETE = { username: "username", signinPassword: "current-password", signupPassword: "new-password" }; export const saveBrowserPasswordCredential = async () => {};',
        }[args.path] }));
      } }],
    });
    const page = join(working, 'account.html');
    writeFileSync(page, `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none';">
      <style>${css}</style><body><div id="root"></div><script>${bundle.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script></body>`);
    const harness = join(working, 'harness.html');
    writeFileSync(harness, `<!doctype html><meta charset="utf-8"><body><iframe style="width:${width}px;height:844px;border:0" src="${pathToFileURL(page).href}"></iframe><pre id="result">pending</pre></body>`);
    const output = execFileSync(browser, [
      '--headless=new', '--allow-file-access-from-files', '--disable-gpu', '--disable-background-networking', '--disable-component-update',
      '--disable-default-apps', '--disable-extensions', '--disable-sync', '--no-first-run', '--no-default-browser-check',
      '--host-resolver-rules=MAP * ~NOTFOUND', '--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=<-loopback>',
      `--user-data-dir=${join(working, 'browser-profile')}`, '--dump-dom', '--virtual-time-budget=15000', pathToFileURL(harness).href,
    ], { encoding: 'utf8', timeout: 45000, maxBuffer: 5 * 1024 * 1024, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const reportText = output.match(/<pre id="result">([\s\S]*?)<\/pre>/)?.[1] ?? 'browser did not finish';
    expect(output.includes('data-result="passed"'), reportText).toBe(true);
    const report = JSON.parse(reportText.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
    expect(report.viewportWidth).toBe(width);
    expect(report.browserErrors).toEqual([]);
    expect(report.networkCalls).toBe(0);
    console.log(`Account session ${scenario} (${width}px): ${report.checks.length} checks, real Provider, real CSS, no live requests.`);
  } finally {
    if (dirname(resolve(working)) !== resolve(tmpdir()) || !basename(working).startsWith('account-session-')) throw new Error('Unexpected browser temporary path');
    rmSync(working, { recursive: true, force: true });
  }
}, 60000);
