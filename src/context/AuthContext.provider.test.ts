import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const browser = process.env.AUTH_PROVIDER_TEST_BROWSER ?? [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(existsSync);

// Opt-in elsewhere via AUTH_PROVIDER_TEST_BROWSER; never install a DOM or browser dependency.
it.skipIf(!browser)('mounts the real AuthProvider and verifies membership through DOM consumers', async () => {
  const artifactRoot = process.env.AUTH_PROVIDER_TEST_ARTIFACTS;
  if (artifactRoot) mkdirSync(artifactRoot, { recursive: true });
  const working = mkdtempSync(join(artifactRoot ?? tmpdir(), 'auth-provider-'));
  const require = createRequire(import.meta.url);
  // Vite already includes esbuild; do not add or download dependencies.
  const { build } = createRequire(require.resolve('vite'))('esbuild');
  try {
    const result = await build({
      absWorkingDir: projectRoot, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
      define: { 'process.env.NODE_ENV': '"development"' },
      stdin: {
        contents: `import { runProviderChecks } from './src/context/AuthContext.provider.fixture';
          runProviderChecks().catch(error => {
            document.body.dataset.result = 'failed';
            document.getElementById('result').textContent = String(error.stack || error);
          });`,
        resolveDir: projectRoot, loader: 'tsx',
      },
      plugins: [{
        name: 'synthetic-provider-api-only',
        setup(builder: any) {
          builder.onResolve({ filter: /utils\/api$/ }, () => ({ path: 'mock-api', namespace: 'provider-test' }));
          builder.onLoad({ filter: /.*/, namespace: 'provider-test' }, () => ({
            contents: ['apiGet', 'apiGetCreditsSummary', 'apiCheckinCredits', 'apiPost', 'clearAdminSession', 'clearApiToken', 'getApiToken', 'setApiToken']
              .map(name => `export const ${name} = (...args) => globalThis.__providerMockApi.${name}(...args);`).join('\n'),
          }));
        },
      }],
    });
    const script = result.outputFiles[0].text.replace(/<\/script/gi, '<\/script');
    const html = `<!doctype html><meta charset="utf-8">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; connect-src 'none';">
      <body><div id="root"></div><pre id="result">pending</pre><script>
      const deny = () => { throw new Error('PROVIDER_BROWSER_OFFLINE: network forbidden'); };
      globalThis.fetch = deny; globalThis.XMLHttpRequest = deny; globalThis.WebSocket = deny; globalThis.EventSource = deny;
      navigator.sendBeacon = deny;
      ${script}</script></body>`;
    const page = join(working, 'provider.html');
    writeFileSync(page, html);
    const output = execFileSync(browser!, [
      '--headless=new', '--disable-gpu', '--disable-background-networking', '--disable-component-update',
      '--disable-default-apps', '--disable-extensions', '--disable-sync', '--no-first-run', '--no-default-browser-check',
      '--metrics-recording-only', '--disable-breakpad', '--disable-domain-reliability', '--disable-quic',
      '--disable-features=NetworkPrediction,OptimizationHints,MediaRouter,AutofillServerCommunication',
      '--host-resolver-rules=MAP * ~NOTFOUND', '--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=<-loopback>',
      `--user-data-dir=${join(working, 'browser-profile')}`, '--dump-dom', '--virtual-time-budget=10000',
      pathToFileURL(page).href,
    ], { encoding: 'utf8', timeout: 45000, maxBuffer: 5 * 1024 * 1024, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    if (artifactRoot) writeFileSync(join(working, 'browser-dom.html'), output);
    const reportText = output.match(/<pre id="result">([\s\S]*?)<\/pre>/)?.[1] ?? output.slice(-4000);
    expect(output, reportText).toContain('data-result="passed"');
    const report = JSON.parse(reportText.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
    expect(report.checks).toHaveLength(23);
    expect(report.browserErrors).toEqual([]);
    console.log(`AuthProvider browser: ${report.checks.length} checks passed; ${report.requests.length} mock calls; no real API loaded.`);
    if (artifactRoot) writeFileSync(join(working, 'browser-report.json'), JSON.stringify(report, null, 2));
  } finally {
    if (!artifactRoot) rmSync(working, { recursive: true, force: true });
  }
}, 60000);
