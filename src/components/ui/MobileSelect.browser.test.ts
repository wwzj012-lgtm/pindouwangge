import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// Reuse installed Chrome and the existing temporary/bundled playwright-core.
// Override these paths for another machine; no dependency installation is needed.
const playwrightPath = process.env.MOBILE_SELECT_PLAYWRIGHT
  ?? 'C:/Users/Plout/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs';
const chromePath = process.env.MOBILE_SELECT_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
let server: ViteDevServer;
let browser: any;
let context: any;
let page: any;
let origin = '';
let errors: string[];

beforeAll(async () => {
  if (!existsSync(playwrightPath) || !existsSync(chromePath)) {
    throw new Error('Set MOBILE_SELECT_PLAYWRIGHT and MOBILE_SELECT_CHROME to existing installations.');
  }
  server = await createServer({
    configFile: false,
    root: fileURLToPath(new URL('../../../', import.meta.url)),
    cacheDir: join(tmpdir(), 'mobile-select-vite', 'node_modules', '.vite'),
    logLevel: 'error', plugins: [react(), tailwindcss(), {
      name: 'mobile-select-fixture',
      configureServer(vite) {
        vite.middlewares.use('/__mobile_select.html', (_req, res) => {
          res.setHeader('Content-Type', 'text/html');
          res.end('<!doctype html><html><head><link rel="icon" href="data:,"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/src/components/ui/MobileSelect.browser.fixture.tsx"></script></body></html>');
        });
      },
    }], server: { host: '127.0.0.1', port: 0, hmr: false },
  });
  await server.listen();
  const address = server.httpServer!.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture server port');
  origin = `http://127.0.0.1:${address.port}`;
  const { chromium } = await import(/* @vite-ignore */ pathToFileURL(playwrightPath).href);
  browser = await chromium.launch({ executablePath: chromePath, headless: true });
}, 60000);

afterAll(async () => { await browser?.close(); await server?.close(); });
beforeEach(async () => {
  context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  page = await context.newPage();
  errors = [];
  page.on('pageerror', (error: Error) => errors.push(error.message));
  page.on('console', (message: any) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`${origin}/__mobile_select.html`);
  await page.getByRole('button', { name: 'Primary', exact: true }).waitFor();
});
afterEach(async () => { await context?.close(); expect(errors).toEqual([]); });

const configure = (patch: Record<string, unknown>) => page.evaluate((value: any) => (window as any).mobileSelectFixture.configure(value), patch);
const probe = () => page.evaluate(() => {
  const p = (window as any).mobileSelectFixture;
  return { changes: p.changes, backgroundClicks: p.backgroundClicks, ancestorEscapes: p.ancestorEscapes, documentEscapes: p.documentEscapes };
});
const focused = (locator: any) => locator.evaluate((element: Element) => element === document.activeElement);
const expectFocused = async (locator: any) => expect(await focused(locator)).toBe(true);
const expectClosed = async () => expect(await page.getByRole('listbox').count()).toBe(0);
const open = async (name = 'Primary') => {
  await page.getByRole('button', { name, exact: true }).click();
  await page.getByRole('listbox', { name, exact: true }).waitFor();
};

describe('MobileSelect real Chrome focus return matrix', () => {
  for (const [width, height] of [[390, 844], [360, 800], [844, 390], [768, 1024]]) {
    for (const label of ['Primary', 'Secondary']) {
      for (const path of ['escape', 'backdrop', 'cancel', 'choose']) {
        it(`${width}x${height} ${label} ${path} restores the exact trigger`, async () => {
          await page.setViewportSize({ width, height });
          await open(label);
          if (path === 'escape') await page.keyboard.press('Escape');
          if (path === 'backdrop') await page.mouse.click(width / 2, 4);
          if (path === 'cancel') await page.getByRole('button', { name: label === 'Primary' ? 'Cancel' : '取消', exact: true }).click();
          if (path === 'choose') await page.getByRole('option', { name: 'Alpha', exact: true }).click();
          await expectClosed();
          await expectFocused(page.getByRole('button', { name: label, exact: true }));
          const result = await probe();
          expect(result.changes).toEqual(path === 'choose' ? ['a'] : []);
          expect(result.backgroundClicks).toBe(0);
          expect(result.ancestorEscapes).toBe(0);
          expect(result.documentEscapes).toBe(0);
        });
      }
    }
  }
});

it('opens on selected option; traps Tab, skips disabled options, navigates and commits only with Enter/Space', async () => {
  await open();
  await expectFocused(page.getByRole('option', { name: 'Gamma' }));
  const cancel = page.getByRole('button', { name: 'Cancel', exact: true });
  const target = await cancel.evaluate((el: HTMLElement) => ({ width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height }));
  expect(target.height).toBe(44);
  expect(target.width).toBeGreaterThanOrEqual(44);
  await page.keyboard.press('Tab');
  await expectFocused(cancel);
  await page.keyboard.press('Tab');
  await expectFocused(page.getByRole('option', { name: 'Gamma' }));
  await page.keyboard.press('Shift+Tab');
  await expectFocused(cancel);
  await page.keyboard.press('Shift+Tab');
  await expectFocused(page.getByRole('option', { name: 'Gamma' }));
  await page.keyboard.press('ArrowUp');
  await expectFocused(page.getByRole('option', { name: 'Alpha' }));
  await page.keyboard.press('ArrowUp');
  await expectFocused(page.getByRole('option', { name: 'Delta' }));
  await page.keyboard.press('ArrowDown');
  await expectFocused(page.getByRole('option', { name: 'Alpha' }));
  await page.keyboard.press('End');
  await expectFocused(page.getByRole('option', { name: 'Delta' }));
  await page.keyboard.press('Home');
  await expectFocused(page.getByRole('option', { name: 'Alpha' }));
  expect((await probe()).changes).toEqual([]);
  await page.keyboard.press('Enter');
  await expectClosed();
  expect((await probe()).changes).toEqual(['a']);
  await expectFocused(page.getByRole('button', { name: 'Primary', exact: true }));
  await page.keyboard.press('Enter');
  await expectFocused(page.getByRole('option', { name: 'Alpha' }));
  await page.keyboard.press('ArrowDown');
  await expectFocused(page.getByRole('option', { name: 'Gamma' }));
  await page.keyboard.press('Space');
  await expectClosed();
  expect((await probe()).changes).toEqual(['a', 'c']);
});

it('keeps value controlled and honours disabled trigger/options and live option updates', async () => {
  await configure({ disabled: true });
  expect(await page.getByRole('button', { name: 'Primary', exact: true }).isDisabled()).toBe(true);
  await page.evaluate(() => (document.querySelector('[aria-label="Primary"]') as HTMLButtonElement).click());
  await expectClosed();
  await configure({ disabled: false, acceptChange: false });
  await open();
  expect(await page.getByRole('option', { name: 'Beta' }).isDisabled()).toBe(true);
  await page.getByRole('option', { name: 'Beta' }).evaluate((el: HTMLButtonElement) => el.click());
  expect((await probe()).changes).toEqual([]);
  await page.getByRole('option', { name: 'Alpha' }).click();
  expect((await probe()).changes).toEqual(['a']);
  expect(await page.getByRole('button', { name: 'Primary', exact: true }).innerText()).toBe('Gamma');
  await open();
  await expectFocused(page.getByRole('option', { name: 'Gamma' }));
  await configure({ options: [{ value: 'a', label: 'Alpha' }, { value: 'd', label: 'Delta' }] });
  await expectFocused(page.getByRole('option', { name: 'Alpha' }));
  await configure({ options: [{ value: 'a', label: 'Alpha', disabled: true }, { value: 'd', label: 'Delta' }] });
  await expectFocused(page.getByRole('option', { name: 'Delta' }));
  await configure({ options: [{ value: 'd', label: 'Delta', disabled: true }] });
  await expectFocused(page.getByRole('button', { name: 'Cancel', exact: true }));
  await configure({ options: [] });
  await page.keyboard.press('Tab');
  await expectFocused(page.getByRole('button', { name: 'Cancel', exact: true }));
  await configure({ options: [{ value: 'e', label: 'Echo' }], value: 'e' });
  await page.keyboard.press('Tab');
  await expectFocused(page.getByRole('option', { name: 'Echo' }));
  expect(await page.getByRole('option', { name: 'Echo' }).getAttribute('aria-selected')).toBe('true');
  await configure({ disabled: true });
  await expectClosed();
});

it('blocks background focus, clicks and scrolling; restores existing overflow and scroll position', async () => {
  await page.evaluate(() => {
    document.body.style.setProperty('overflow', 'auto', 'important');
    document.documentElement.style.overflow = 'scroll';
    scrollTo(0, 120);
  });
  // Programmatic click avoids Playwright scrolling the trigger back into view.
  await page.getByRole('button', { name: 'Primary', exact: true }).evaluate((el: HTMLButtonElement) => el.click());
  await expectFocused(page.getByRole('option', { name: 'Gamma' }));
  const position = await page.evaluate(() => scrollY);
  expect(position).toBe(120);
  await page.evaluate(() => document.getElementById('background')!.focus());
  await expectFocused(page.getByRole('option', { name: 'Gamma' }));
  await page.mouse.move(180, 20);
  await page.mouse.wheel(0, 500);
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => scrollY)).toBe(position);
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => [document.body.style.overflow, document.body.style.getPropertyPriority('overflow'), document.documentElement.style.overflow, scrollY])).toEqual(['auto', 'important', 'scroll', position]);
  await expectFocused(page.getByRole('button', { name: 'Primary', exact: true }));
});

it('cleans up on unmount without closing or stealing focus from another modal', async () => {
  await page.evaluate(() => { document.body.style.overflow = 'hidden'; });
  await open();
  await page.evaluate(() => (document.getElementById('peer') as HTMLDialogElement).showModal());
  await expectFocused(page.locator('#peer-button'));
  await page.keyboard.press('Escape');
  expect(await page.locator('#peer').evaluate((el: HTMLDialogElement) => el.open)).toBe(false);
  expect(await page.getByRole('listbox').count()).toBe(1);
  await page.evaluate(() => (document.getElementById('peer') as HTMLDialogElement).showModal());
  await configure({ mounted: false });
  await expectFocused(page.locator('#peer-button'));
  expect(await page.locator('#peer').evaluate((el: HTMLDialogElement) => el.open)).toBe(true);
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
  await page.keyboard.press('Escape');
  await expectClosed();
  await page.getByRole('button', { name: 'Secondary', exact: true }).click();
  await page.keyboard.press('Escape');
  await expectFocused(page.getByRole('button', { name: 'Secondary', exact: true }));
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
  expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe('');
});

it('releases shared scroll locks only after the last select unmounts and leaves unrelated keys alone', async () => {
  await open();
  await page.getByRole('button', { name: 'Secondary', exact: true }).evaluate((el: HTMLButtonElement) => el.click());
  await expectFocused(page.getByRole('option', { name: 'Gamma' }).last());
  await configure({ mounted: false });
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
  await expectFocused(page.getByRole('option', { name: 'Gamma' }));
  await configure({ second: false });
  expect(await page.evaluate(() => [document.body.style.overflow, document.documentElement.style.overflow])).toEqual(['', '']);
  const before = (await probe()).documentEscapes;
  await page.keyboard.press('Escape');
  expect((await probe()).documentEscapes).toBe(before + 1);
  await page.locator('#background').click();
  expect((await probe()).backgroundClicks).toBe(1);
});
