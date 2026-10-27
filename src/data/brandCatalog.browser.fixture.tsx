import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from '../App';
import { AuthProvider } from '../context/AuthContext';
import { LanguageProvider } from '../context/LanguageContext';
import { getBrandCatalogSnapshot, refreshBrandCatalog } from './brandCatalog';

export async function runBrandCatalogChecks() {
  const checks: string[] = [], browserErrors: string[] = [];
  const check = (condition: unknown, label: string) => { if (!condition) throw new Error(label); checks.push(label); };
  window.addEventListener('error', event => browserErrors.push(event.message));
  window.addEventListener('unhandledrejection', event => browserErrors.push(String(event.reason)));
  const tick = () => new Promise(resolve => setTimeout(resolve, 40));
  const wait = async (predicate: () => boolean) => {
    for (let i = 0; i < 100 && !predicate(); i++) await tick();
    if (!predicate()) throw new Error('Timed out waiting for browser state');
  };
  const directory = () => ({ items: [{ code: 'MARD', name: '测试目录', enabled: true, builtin: true, protected: true,
    version: 1, colorCount: 2, colors: [
      { id: 'MARD_A1', code: 'A1', name: '红色', hex: '#FF0000', screenReferenceOnly: false },
      { id: 'MARD_A2', code: 'A2', name: '蓝色', hex: '#0000FF', screenReferenceOnly: false },
    ] }] });
  let requests = 0, settle!: (response: Response) => void;
  window.fetch = (async (input: RequestInfo | URL) => {
    if (String(input).includes('/api/brands/catalog')) {
      requests++;
      return new Promise<Response>(resolve => { settle = resolve; });
    }
    return Response.json({ success: true, data: { items: [], flags: {}, announcements: [] } });
  }) as typeof fetch;
  const success = (data = directory()) => settle(Response.json({ success: true, data }));
  const fail = () => settle(Response.json({ success: false, message: 'offline' }, { status: 503 }));
  const app = (): any => (window as any).__brandCatalogApp;
  const root = createRoot(document.getElementById('root')!);
  root.render(<StrictMode><AuthProvider><LanguageProvider><App /></LanguageProvider></AuthProvider></StrictMode>);
  await wait(() => requests === 1 && Boolean(app()));
  check(document.body.textContent?.includes('正在读取品牌目录，暂不可开始新转换。'), 'first load shows blocking banner');
  fail(); await wait(() => getBrandCatalogSnapshot().status === 'error'); await tick();
  check(document.body.textContent?.includes('新转换暂停'), 'first failure remains visibly closed');
  const image = async (color: string) => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 10;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = color; ctx.fillRect(0, 0, 10, 10);
    const img = new Image(); img.src = canvas.toDataURL(); await img.decode(); return img;
  };
  const red = await image('#FF0000'), blue = await image('#0000FF');
  const initialGrid = app().grid;
  const firstAttempt = app().convertImageToGrid(red, app().settings, app().activePalette);
  await wait(() => requests === 2); fail(); await firstAttempt; await tick();
  check(app().grid === initialGrid && Boolean(app().imageLoadMessage), 'ordinary conversion rejects first read failure without changing grid');
  const recovery = refreshBrandCatalog(); await wait(() => requests === 3); success(); await recovery; await tick();
  await wait(() => Boolean(document.querySelector('[data-grid-canvas]')));
  const canvas = document.querySelector<HTMLCanvasElement>('[data-grid-canvas]')!;
  const position = () => { const rect = canvas.getBoundingClientRect(); return [rect.x, rect.y, rect.width, rect.height].join(','); };
  const originalPosition = position(), originalPalette = getBrandCatalogSnapshot().palettes;
  app().setActivePalette(app().activePalette.map((color: any) => ({ ...color, enabled: false })));
  await tick();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
  const count = requests;
  window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); await tick();
  check(requests === count, 'hidden focus and visibility events do not fetch');
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  for (let i = 0; i < 20; i++) { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); }
  await wait(() => requests === count + 1); await tick();
  check(requests === count + 1, 'focus/visibility storm and multiple hook subscribers share one request');
  check(getBrandCatalogSnapshot().status === 'ready' && getBrandCatalogSnapshot().refreshing, 'pending focus refresh stays ready');
  check(position() === originalPosition, 'pending focus refresh does not move or resize actual canvas');
  check(!document.body.textContent?.includes('正在读取品牌目录'), 'pending focus refresh does not insert top loading banner');
  const select = Array.from(document.querySelectorAll('select')).find(item => item.value === 'MARD');
  if (window.innerWidth >= 1024) check(select && !select.disabled, 'brand selector stays enabled during background refresh');
  success(); await wait(() => !getBrandCatalogSnapshot().refreshing); await tick();
  check(getBrandCatalogSnapshot().palettes === originalPalette, 'identical server data reuses catalog references');
  check(app().activePalette.every((color: any) => color.enabled === false), 'identical refresh preserves local disabled color choices');
  check(position() === originalPosition, 'completed unchanged refresh does not move actual canvas');

  const background = refreshBrandCatalog(); await tick(); fail(); check(await background === false, 'background failure reports false explicitly'); await tick();
  check(getBrandCatalogSnapshot().status === 'ready', 'background failure keeps the loaded catalog ready');
  check(getBrandCatalogSnapshot().palettes === originalPalette, 'background failure retains the last validated catalog references');
  check(position() === originalPosition, 'background failure notice does not move actual canvas');
  const notice = Array.from(document.querySelectorAll('[role="status"]')).find(item => item.textContent?.includes('品牌目录更新失败'));
  check(notice && getComputedStyle(notice).position === 'fixed', 'background failure notice is fixed outside layout');

  app().setActivePalette(app().activePalette.map((color: any) => ({ ...color, enabled: true })));
  app().setImageLoadMessage(null); await tick();
  const beforeFailedConversion = app().grid;
  const attempt = app().convertImageToGrid(red, app().settings, app().activePalette);
  await tick(); fail(); await attempt; await tick();
  check(app().grid === beforeFailedConversion && app().imageLoadMessage?.includes('品牌目录不可用'), 'ordinary strict conversion rejects fresh failure even with ready cached data');
  const largeAttempt = app().handleConvertLargeCanvasImage(new File(['unused'], 'pattern.png'), 'pixel', 10, 10)
    .then(() => false, (error: Error) => error.message.includes('品牌目录不可用'));
  await tick(); fail(); check(await largeAttempt, 'large canvas strict conversion rejects fresh failure even with ready cached data');

  app().setActivePalette(app().activePalette.map((color: any) => ({ ...color, enabled: true })));
  await tick();
  const settings = { ...app().settings, width: 10, height: 10, keepAspectRatio: false };
  const before = requests;
  const oldConversion = app().convertImageToGrid(red, settings, app().activePalette);
  const newConversion = app().convertImageToGrid(blue, settings, app().activePalette);
  await tick(); check(requests === before + 1, 'overlapping conversion freshness requests coalesce');
  success(); await Promise.all([oldConversion, newConversion]);
  await wait(() => app().grid.some((row: any[]) => row.some(Boolean))); await tick();
  check(app().grid.flat().filter(Boolean).every((id: string) => id === 'MARD_A2'), 'new image request supersedes old request after shared freshness response');
  const savedPalette = app().activePalette, savedGrid = app().grid;
  const changed = refreshBrandCatalog(); await tick();
  const edited = directory(); edited.items[0].colors[1].hex = '#00FF00'; edited.items[0].name = '更新后的目录';
  success(edited); await changed; await tick();
  check(getBrandCatalogSnapshot().names.MARD === '更新后的目录' && getBrandCatalogSnapshot().palettes.MARD[1].hex === '#00FF00', 'real server brand/color changes become live');
  check(app().activePalette === savedPalette && app().grid === savedGrid && savedPalette[1].hex === '#0000FF', 'live edits preserve existing drawing palette and grid snapshot');
  root.unmount(); await tick(); const unmountedRequests = requests;
  window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); await tick();
  check(requests === unmountedRequests, 'unmount removes focus and visibility listeners');
  check(browserErrors.length === 0, 'no browser errors');
  return { viewportWidth: window.innerWidth, checks, browserErrors, originalPosition };
}
