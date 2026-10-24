import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const browser = process.env.MEMBERSHIP_TEST_BROWSER ?? [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(existsSync);

it.each([390, 1280])('drives real membership DOM with offline API mocks (%i px)', async width => {
  if (!browser) throw new Error('Set MEMBERSHIP_TEST_BROWSER to run the real DOM checks');
  const working = mkdtempSync(join(tmpdir(), 'membership-redemption-'));
  const require = createRequire(import.meta.url);
  const { build } = createRequire(require.resolve('vite'))('esbuild');
  try {
    const bundle = await build({
      absWorkingDir: projectRoot, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
      define: { 'process.env.NODE_ENV': '"development"' },
      stdin: { contents: `import { runMembershipChecks } from './src/components/MembershipRedemption.browser.fixture';
        runMembershipChecks().then(report => {
          parent.document.body.dataset.result = 'passed'; parent.document.getElementById('result').textContent = JSON.stringify(report);
        }).catch(error => {
          parent.document.body.dataset.result = 'failed'; parent.document.getElementById('result').textContent = String(error.stack);
        });`, resolveDir: projectRoot, loader: 'tsx' },
      plugins: [{ name: 'offline-membership-dependencies', setup(builder: any) {
        builder.onResolve({ filter: /context\/AuthContext$/ }, () => ({ path: 'auth', namespace: 'membership-fixture' }));
        builder.onResolve({ filter: /context\/LanguageContext$/ }, () => ({ path: 'language', namespace: 'membership-fixture' }));
        builder.onResolve({ filter: /utils\/api$/ }, () => ({ path: 'api', namespace: 'membership-fixture' }));
        builder.onResolve({ filter: /utils\/authCredentials$/ }, () => ({ path: 'credentials', namespace: 'membership-fixture' }));
        builder.onLoad({ filter: /.*/, namespace: 'membership-fixture' }, (args: any) => ({ contents: {
          auth: 'export const useAuth = () => globalThis.__membershipAuth;',
          language: 'export const useLanguage = () => ({ language: globalThis.__membershipLanguage });',
          api: 'export const apiPost = (...args) => globalThis.__membershipApi(...args); export const SIGNIN_REQUEST_OPTIONS = {}; export const SIGNUP_REQUEST_OPTIONS = {};',
          credentials: 'export const AUTH_AUTOCOMPLETE = { username: "username", signinPassword: "current-password", signupPassword: "new-password" }; export const saveBrowserPasswordCredential = (...args) => globalThis.__membershipCredentials(...args);',
        }[args.path] }));
      } }],
    });
    const script = bundle.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
    const page = join(working, 'membership.html');
    writeFileSync(page, `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none';">
      <body><div id="root"></div><script>${script}</script></body>`);
    const harness = join(working, 'harness.html');
    writeFileSync(harness, `<!doctype html><meta charset="utf-8"><body><iframe style="width:${width}px;height:900px;border:0" src="${pathToFileURL(page).href}"></iframe><pre id="result">pending</pre></body>`);
    const output = execFileSync(browser, [
      '--headless=new', '--allow-file-access-from-files', '--disable-gpu', '--disable-background-networking', '--disable-component-update',
      '--disable-default-apps', '--disable-extensions', '--disable-sync', '--no-first-run', '--no-default-browser-check',
      '--host-resolver-rules=MAP * ~NOTFOUND', '--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=<-loopback>',
      `--user-data-dir=${join(working, 'browser-profile')}`, '--dump-dom', '--virtual-time-budget=15000',
      pathToFileURL(harness).href,
    ], { encoding: 'utf8', timeout: 45000, maxBuffer: 5 * 1024 * 1024, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const reportText = output.match(/<pre id="result">([\s\S]*?)<\/pre>/)?.[1] ?? 'browser did not finish';
    expect(output.includes('data-result="passed"'), reportText).toBe(true);
    const report = JSON.parse(reportText.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
    expect(report.viewportWidth).toBe(width);
    expect(report.checks.length).toBeGreaterThan(100);
    expect(report.browserErrors).toEqual([]);
    expect(report.networkCalls).toBe(0);
    console.log(`Membership DOM (${width}px): ${report.checks.length} checks, no live requests.`);
  } finally {
    if (dirname(resolve(working)) !== resolve(tmpdir()) || !basename(working).startsWith('membership-redemption-')) throw new Error('Unexpected browser temporary path');
    rmSync(working, { recursive: true, force: true });
  }
}, 60000);
