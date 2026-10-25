import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';

const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));
const require = createRequire(import.meta.url);
const browser = process.env.ADMIN_DIALOGS_TEST_BROWSER ?? [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(existsSync);
let playwrightModule = process.env.ADMIN_DIALOGS_PLAYWRIGHT_MODULE;
try { playwrightModule ??= require.resolve('playwright-core'); } catch { /* optional local browser driver */ }

it.skipIf(!browser || !playwrightModule).each([1280, 390])('retains pending focus after native pointer and programmatic focus changes (%i px)', async width => {
  const working = mkdtempSync(join(tmpdir(), 'admin-dialog-pointer-'));
  const { build } = createRequire(require.resolve('vite'))('esbuild');
  const { chromium } = require(playwrightModule!);
  let browserInstance: any;
  try {
    const bundle = await build({
      absWorkingDir: projectRoot, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
      define: { 'process.env.NODE_ENV': '"development"' },
      stdin: { loader: 'tsx', resolveDir: projectRoot, contents: `
        import React, {useState} from 'react';import{createRoot}from'react-dom/client';
        import{AdminButton,AdminConfirmDialog}from'./src/components/admin/AdminPrimitives';
        globalThis.__pointerWrites=0;globalThis.__pointerCloses=0;
        function Probe(){const[open,setOpen]=useState(false),[busy,setBusy]=useState(false);
          globalThis.__finishPending=()=>setBusy(false);
          return <div className="admin-root"><AdminButton data-trigger onClick={()=>setOpen(true)}>打开确认</AdminButton>
            <AdminConfirmDialog open={open} title="确认测试操作" description="离线原生鼠标焦点回归" pending={busy}
              onClose={()=>{globalThis.__pointerCloses++;setOpen(false)}}
              onConfirm={()=>{globalThis.__pointerWrites++;setBusy(true)}}>
              <label className="admin-stage-field">原因<textarea disabled={busy} defaultValue="保留原因"/></label>
            </AdminConfirmDialog></div>}
        createRoot(document.getElementById('root')).render(<Probe/>);` },
    });
    const css = readFileSync(join(projectRoot, 'src/components/admin/admin.css'), 'utf8');
    const pagePath = join(working, 'pointer.html');
    writeFileSync(pagePath, `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}${css}</style><body><div id="root"></div><script>${bundle.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script></body></html>`);
    browserInstance = await chromium.launch({ executablePath: browser, headless: true, args: ['--allow-file-access-from-files', '--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND'] });
    for (const activation of ['mouse', 'keyboard']) {
      const context = await browserInstance.newContext({ viewport: { width, height: 1000 }, serviceWorkers: 'block', reducedMotion: 'reduce' });
      await context.route('**/*', (route: any) => /^https?:/.test(route.request().url()) ? route.abort() : route.continue());
      const page = await context.newPage();
      const errors: string[] = []; page.on('pageerror', (error: Error) => errors.push(error.message));
      await page.goto(pathToFileURL(pagePath).href);
      await page.getByRole('button', { name: '打开确认', exact: true }).click();
      const confirm = page.getByRole('button', { name: '确认', exact: true });
      if (activation === 'keyboard') { await confirm.focus(); await page.keyboard.press('Enter'); } else await confirm.click();
      await page.waitForFunction(() => document.querySelector('[role="dialog"][aria-busy="true"]')?.contains(document.activeElement));
      const pendingState = () => page.evaluate(() => ({
        inside: document.querySelector('[role="dialog"]')!.contains(document.activeElement),
        busy: document.querySelector('[role="dialog"]')!.getAttribute('aria-busy'),
        inert: document.getElementById('root')!.inert,
        writes: (globalThis as any).__pointerWrites, closes: (globalThis as any).__pointerCloses,
      }));
      const expected = { inside: true, busy: 'true', inert: true, writes: 1, closes: 0 };
      expect(await pendingState()).toEqual(expected);
      await page.mouse.click(2, 2); await page.waitForTimeout(120);
      expect(await pendingState(), activation + ' native backdrop click retains pending focus').toEqual(expected);
      await page.evaluate(() => { document.body.tabIndex = -1; document.body.focus(); });
      expect(await pendingState(), 'programmatic BODY focus redirects to top dialog').toEqual(expected);
      await page.evaluate(() => (document.activeElement as HTMLElement).blur());
      await page.waitForTimeout(30);
      expect(await pendingState(), 'programmatic blur without focusin redirects to dialog').toEqual(expected);
      await page.keyboard.press('Escape');
      expect(await pendingState(), 'pending Escape preserves focus and write guards').toEqual(expected);
      await page.evaluate(() => (globalThis as any).__finishPending());
      await page.waitForFunction(() => !document.querySelector('[role="dialog"]')?.hasAttribute('aria-busy'));
      await page.mouse.click(2, 2);
      await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
      expect(await page.evaluate(() => ({ closes: (globalThis as any).__pointerCloses, returned: document.activeElement === document.querySelector('[data-trigger]'), inert: document.getElementById('root')!.inert }))).toEqual({ closes: 1, returned: true, inert: false });
      expect(errors).toEqual([]);
      await context.close();
    }
  } finally {
    await browserInstance?.close();
    if (dirname(resolve(working)) !== resolve(tmpdir()) || !basename(working).startsWith('admin-dialog-pointer-')) throw new Error('Unexpected temporary path');
    rmSync(working, { recursive: true, force: true });
  }
}, 45000);
