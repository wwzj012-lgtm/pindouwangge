import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer, transformWithEsbuild } from 'vite';
import { expect, it } from 'vitest';

const runtime = process.env.PREVIEW_PLAYWRIGHT ?? 'C:/Users/Plout/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json';
const chrome = process.env.PREVIEW_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';

it.skipIf(!existsSync(runtime) || !existsSync(chrome))('loads near-viewport covers, retries storage failures and releases URLs on unmount in Chrome', async () => {
  // Exercise the actual private component without exporting a test-only product API.
  const source = readFileSync(new URL('./UserPatternsModal.tsx', import.meta.url), 'utf8');
  const cover = source.slice(source.indexOf('function PatternCover('), source.indexOf('\nfunction statusLabel('));
  const harness = await transformWithEsbuild(`
    import React,{useEffect,useRef,useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {Image,RefreshCw} from 'lucide-react';
    window.probe={created:[],revoked:[],unhandled:[],mount:null};
    addEventListener('unhandledrejection',e=>probe.unhandled.push(String(e.reason)));
    const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);
    URL.createObjectURL=b=>{const u=create(b);probe.created.push(u);return u};
    URL.revokeObjectURL=u=>{probe.revoked.push(u);revoke(u)};
    function getExportedPatternPreview(id){return fetch('/__preview?id='+id).then(r=>{if(!r.ok)throw Error('storage unavailable');return r.blob()})}
    ${cover}
    function Harness(){const [shown,setShown]=useState(true);probe.mount=setShown;return shown?Array.from({length:12},(_,id)=><article key={id} data-cover={id} style={{height:400,width:320}}><PatternCover userId="fixture" record={{id:String(id),hasPreview:true,cloudRevision:1}}/></article>):null}
    createRoot(document.getElementById('root')).render(<Harness/>);
  `, 'preview-harness.tsx', { loader: 'tsx', jsx: 'automatic' });
  const requests: string[] = [];
  let failFirst = true, hold = false;
  const held: Array<(status: number) => void> = [];
  const server = await createServer({ configFile: false, server: { host: '127.0.0.1', port: 0 }, plugins: [{
    name: 'preview-regression',
    resolveId(id) { if (id === '/__preview_harness.js') return '\0preview-harness'; },
    load(id) { if (id === '\0preview-harness') return harness.code; },
    configureServer(vite) { vite.middlewares.use(async (req, res, next) => {
      if (req.url?.startsWith('/__preview?')) {
        const id = new URL(req.url, 'http://fixture').searchParams.get('id')!;
        requests.push(id);
        const finish = (status: number) => { res.statusCode = status; res.setHeader('Content-Type', 'image/svg+xml'); res.end('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>'); };
        if (hold) held.push(finish);
        else if (id === '0' && failFirst) { failFirst = false; finish(503); }
        else finish(200);
        return;
      }
      if (req.url !== '/__preview_check') return next();
      res.setHeader('Content-Type', 'text/html');
      res.end(await vite.transformIndexHtml(req.url, '<html><head><style>article>div{aspect-ratio:4/3;width:100%}article img{width:100%;height:100%}</style></head><body style="margin:0"><div id="root"></div><script type="module" src="/__preview_harness.js"></script></body></html>'));
    }); },
  }] });
  let browser: any;
  try {
    await server.listen();
    const address = server.httpServer!.address() as { port: number };
    const origin = `http://127.0.0.1:${address.port}`;
    const { chromium } = createRequire(runtime)('./index.js');
    browser = await chromium.launch({ executablePath: chrome, headless: true });
    const page = await browser.newPage({ viewport: { width: 390, height: 600 } });
    const errors: string[] = [];
    page.on('pageerror', (error: Error) => errors.push(error.message));
    await page.route('**/*', (route: any) => route.request().url().startsWith(origin) ? route.continue() : route.abort());
    const settle = () => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await page.goto(origin + '/__preview_check');
    const retry = page.getByRole('button', { name: '预览加载失败，点击重试' });
    await retry.waitFor(); await settle();
    const initial = requests.length;
    expect(initial).toBeGreaterThan(0); expect(initial).toBeLessThan(12);
    expect(requests).not.toContain('11');
    await retry.click();
    await expect.poll(() => page.locator('[data-cover="0"] img').count()).toBe(1);
    expect(requests.filter(id => id === '0')).toHaveLength(2);
    await page.locator('[data-cover="11"]').scrollIntoViewIfNeeded();
    await expect.poll(() => requests.includes('11')).toBe(true);
    await expect.poll(() => page.locator('[data-cover="11"] img').count()).toBe(1);
    await page.evaluate(() => (window as any).probe.mount(false)); await settle();
    await expect.poll(() => page.evaluate(() => (window as any).probe.revoked.length)).toBe(await page.evaluate(() => (window as any).probe.created.length));
    // Resolve and reject reads after disposal: neither may create a URL or update UI.
    for (const status of [503, 200]) {
      hold = true;
      await page.evaluate(() => { scrollTo(0, 0); (window as any).probe.mount(true); });
      await expect.poll(() => held.length).toBeGreaterThan(0);
      await page.evaluate(() => (window as any).probe.mount(false)); await settle();
      const before = await page.evaluate(() => (window as any).probe.created.length);
      held.splice(0).forEach(finish => finish(status));
      await page.waitForLoadState('networkidle'); await settle();
      expect(await page.evaluate(() => (window as any).probe.created.length)).toBe(before);
      expect(await page.locator('#root *').count()).toBe(0);
    }
    expect(await page.evaluate(() => (window as any).probe.unhandled)).toEqual([]);
    expect(errors).toEqual([]);
    const created = await page.evaluate(() => (window as any).probe.created.length);
    expect(created).toBeGreaterThan(0);
    process.stdout.write(`Chrome covers: initial requests ${initial}/12; failed cover retry 2 requests; offscreen cover loaded on scroll; ${created}/${created} object URLs revoked; disposed resolve/reject clean.\n`);
  } finally {
    held.splice(0).forEach(finish => finish(503));
    await browser?.close(); await server.close();
  }
}, 30_000);
