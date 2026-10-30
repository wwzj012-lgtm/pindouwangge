import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from '../App';
import { AuthProvider } from '../context/AuthContext';
import { LanguageProvider } from '../context/LanguageContext';
import { getBrandCatalogSnapshot, refreshBrandCatalog } from './brandCatalog';

export async function runBrandCatalogChecks() {
  const checks: string[] = [], browserErrors: string[] = [];
  const check = (condition: unknown, label: string) => {
    if (!condition) throw new Error(label);
    checks.push(label);
    parent.document.getElementById('result')!.textContent = JSON.stringify({ pending: label, checks });
  };
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
  check(!document.body.textContent?.includes('暂不可开始新转换'), 'first load does not insert a blocking layout banner');
  fail(); await wait(() => getBrandCatalogSnapshot().status === 'ready'); await tick();
  const toast = () => document.querySelector('[data-brand-catalog-toast]');
  check(toast()?.textContent?.includes('旧色卡'), 'first offline load announces old builtin palette in one polite toast');
  check(document.querySelectorAll('[data-brand-catalog-toast]').length === 1, 'only one catalog notice is rendered');
  check(toast()?.closest('[role="status"]')?.getAttribute('aria-live') === 'polite', 'catalog notice is screen-reader accessible without focus theft');
  await new Promise(resolve => setTimeout(resolve, 2100));
  check(!toast() && getBrandCatalogSnapshot().source === 'builtin', 'toast expires after two seconds without forgetting offline state');
  const image = async (color: string) => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 10;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = color; ctx.fillRect(0, 0, 10, 10);
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve(); img.onerror = () => reject(new Error('Test image failed to load'));
      img.src = canvas.toDataURL();
    });
    return img;
  };
  const red = await image('#FF0000'), blue = await image('#0000FF');
  const firstAttempt = app().convertImageToGrid(red, app().settings, app().activePalette);
  await wait(() => requests === 2); fail(); await firstAttempt; await tick();
  await wait(() => app().grid.flat().some(Boolean));
  check(!app().imageLoadMessage && !toast(), 'ordinary conversion works offline and unchanged failure does not flash toast again');
  const redFile = new File([pngBlob(red.src)], 'pattern.png', { type: 'image/png' });
  const initialLarge = app().handleConvertLargeCanvasImage(redFile, 'pixel', 10, 10);
  await wait(() => requests === 3); fail();
  check((await initialLarge).grid.flat().some(Boolean), 'large canvas conversion also works with builtin offline palette');
  window.dispatchEvent(new Event('online'));
  await wait(() => requests === 4); success(); await wait(() => getBrandCatalogSnapshot().source === 'live'); await tick();
  check(!toast(), 'online recovery automatically replaces old catalog and clears the offline notice');
  const liveConversion = app().convertImageToGrid(red, { ...app().settings, width: 10, height: 10, keepAspectRatio: false }, app().activePalette);
  await wait(() => requests === 5); success(); await liveConversion;
  await wait(() => app().grid.flat().filter(Boolean).every((id: string) => id === 'MARD_A1'));
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
  const realNow = Date.now; Date.now = () => realNow() + 60_000;
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
  for (let i = 0; i < 5; i++) { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); await tick(); }
  check(requests === count + 1, 'settled focus/visibility events are throttled instead of flickering repeatedly');
  Date.now = realNow;

  const background = refreshBrandCatalog(); await tick(); fail(); check(await background === false, 'background failure reports false explicitly'); await tick();
  check(getBrandCatalogSnapshot().status === 'ready', 'background failure keeps the loaded catalog ready');
  check(getBrandCatalogSnapshot().palettes === originalPalette, 'background failure retains the last validated catalog references');
  check(position() === originalPosition, 'background failure notice does not move actual canvas');
  const notice = toast()?.closest('[role="status"]');
  check(notice && getComputedStyle(notice).position === 'fixed', 'background failure notice is fixed outside layout');
  await new Promise(resolve => setTimeout(resolve, 2100));
  check(!toast(), 'cached offline toast also disappears after two seconds');

  app().setActivePalette(app().activePalette.map((color: any) => ({ ...color, enabled: true })));
  app().setImageLoadMessage(null); await tick();
  const attempt = app().convertImageToGrid(red, app().settings, app().activePalette);
  await tick(); fail(); await attempt; await tick();
  check(!app().imageLoadMessage && !toast(), 'ordinary cached conversion is allowed without repeating unchanged offline toast');
  const largeAttempt = app().handleConvertLargeCanvasImage(redFile, 'pixel', 10, 10);
  await tick(); fail(); check((await largeAttempt).grid.flat().every((id: string) => id === 'MARD_A1'), 'large canvas cached conversion is allowed with validated live values');

  app().setActivePalette(app().activePalette.map((color: any) => ({ ...color, enabled: true })));
  await tick();
  const settings = { ...app().settings, width: 10, height: 10, keepAspectRatio: false };
  const before = requests;
  const oldConversion = app().convertImageToGrid(red, settings, app().activePalette);
  const newConversion = app().convertImageToGrid(blue, settings, app().activePalette);
  await tick(); check(requests === before + 1, 'overlapping conversion freshness requests coalesce');
  success(); await Promise.all([oldConversion, newConversion]);
  await wait(() => app().grid.flat().filter(Boolean).length > 0
    && app().grid.flat().filter(Boolean).every((id: string) => id === 'MARD_A2')); await tick();
  check(app().grid.flat().filter(Boolean).every((id: string) => id === 'MARD_A2'), 'new image request supersedes old request after shared freshness response');
  app().setActivePalette(app().activePalette.map((color: any) =>
    color.id === 'MARD_A2' ? { ...color, enabled: false } : color));
  await wait(() => app().activePalette.find((color: any) => color.id === 'MARD_A2')?.enabled === false);
  const savedPalette = app().activePalette, savedGrid = app().grid;
  const changed = refreshBrandCatalog(); await tick();
  const edited = directory(); edited.items[0].colors[1].hex = '#00FF00'; edited.items[0].name = '更新后的目录';
  success(edited); await changed; await tick();
  check(getBrandCatalogSnapshot().names.MARD === '更新后的目录' && getBrandCatalogSnapshot().palettes.MARD[1].hex === '#00FF00', 'real server brand/color changes become live');
  check(app().grid === savedGrid, 'live edits preserve the existing drawing grid snapshot');
  const paletteAfterLiveEdit = app().activePalette;
  const paletteDiff = paletteAfterLiveEdit.findIndex((color: any, index: number) =>
    JSON.stringify(color) !== JSON.stringify(savedPalette[index]));
  const paletteJsonSame = JSON.stringify(paletteAfterLiveEdit) === JSON.stringify(savedPalette);
  const savedSecondColorHex = savedPalette[1]?.hex;
  check(paletteJsonSame && savedSecondColorHex === '#0000FF',
    'live edits preserve existing drawing palette values (first changed index ' + paletteDiff + ': ' +
    JSON.stringify({ paletteJsonSame, savedSecondColorHex, before: savedPalette[paletteDiff], after: paletteAfterLiveEdit[paletteDiff],
      savedLength: savedPalette.length, savedSample: savedPalette.slice(0, 3).map((color: any) =>
        ({ id: color.id, hex: color.hex, enabled: color.enabled })),
      afterLength: paletteAfterLiveEdit.length }) + ')');
  const nextRequests = requests;
  const nextConversion = app().convertImageToGrid(red, { ...settings, brand: 'MARD' }, app().activePalette);
  await wait(() => requests === nextRequests + 1); success(edited); await nextConversion;
  await wait(() => app().activePalette.find((color: any) => color.id === 'MARD_A2')?.hex === '#00FF00'
    && app().activePalette.find((color: any) => color.id === 'MARD_A2')?.enabled === false);
  check(app().grid.flat().filter(Boolean).every((id: string) => id === 'MARD_A1'),
    'next ordinary conversion uses latest live color data and preserves the local disabled choice');

  const denied = refreshBrandCatalog(); await tick(); settle(Response.json({ success: false, message: '权限拒绝' }, { status: 403 })); await denied; await tick();
  check(toast()?.textContent?.includes('无法使用'), 'authoritative denial appears as the same transient notice');
  await new Promise(resolve => setTimeout(resolve, 2100));
  check(!toast() && getBrandCatalogSnapshot().status === 'error', 'denial toast expiry does not clear authoritative block');
  const blockedGrid = app().grid;
  const blocked = app().convertImageToGrid(red, app().settings, app().activePalette); await tick(); fail(); await blocked; await tick();
  check(app().grid === blockedGrid && toast() && !app().imageLoadMessage, 'blocked ordinary action reannounces once and preserves work without duplicate main error');
  const blockedLarge = app().handleConvertLargeCanvasImage(redFile, 'pixel', 10, 10).then(() => false, (error: Error) => error.name === 'BrandCatalogUnavailableError');
  await tick(); fail(); check(await blockedLarge, 'large canvas remains truly blocked after denial even when offline');
  const retryButton = Array.from(toast()!.querySelectorAll('button')).find(button => button.textContent?.includes('重试'))!;
  retryButton.click(); await tick(); fail(); await tick();
  check(Boolean(toast()), 'manual retry failure can reannounce unchanged authoritative state');
  const empty = refreshBrandCatalog(); await tick(); success({ items: [] }); await empty; await tick();
  check(getBrandCatalogSnapshot().status === 'error' && Object.keys(getBrandCatalogSnapshot().palettes).length === 0, 'online empty directory is authoritative, not offline fallback');
  root.unmount(); await tick(); const unmountedRequests = requests;
  window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); await tick();
  check(requests === unmountedRequests, 'unmount removes focus and visibility listeners');
  check(browserErrors.length === 0, 'no browser errors');
  return { viewportWidth: window.innerWidth, checks, browserErrors, originalPosition };
}

function pngBlob(url: string): Blob {
  return new Blob([Uint8Array.from(atob(url.split(',')[1]), character => character.charCodeAt(0))], { type: 'image/png' });
}
