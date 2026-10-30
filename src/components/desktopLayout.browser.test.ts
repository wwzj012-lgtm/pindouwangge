import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * 桌面/移动的**渲染尺寸契约**（真实 Chrome 测量，不是数 class 名）。
 *
 * 为什么需要它：两端共用 GridCanvas / HomeView 等叶子组件，只靠断点变形。
 * 前两轮事故都是「为移动端改共享组件 → 桌面被压扁」：
 *   · 下拉框 20px（sm:h-auto + py-0）
 *   · 主按钮 16px（flex 列把固定高度压成内容高度）
 * 源码断言只能证明「写了某个类」，证明不了「渲染出来是 32px」。
 * 这里直接把面板里每个控件的高度量出来，离群值一律报错。
 */

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const chromePath = process.env.LAYOUT_TEST_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';

/** 允许出现的高度（px）。32 是通用控件，36 主按钮，40 两行预设卡，24 滑块，16 复选框。 */
const DESKTOP_HEIGHTS = new Set([16, 24, 32, 36, 40]);
const MOBILE_MIN = 40;

type Row = { tag: string; label: string; h: number; fs: string };

const probeDesktop = `(() => {
  const panel = document.querySelector('.w-80');
  if (!panel) return { error: 'settings panel not mounted' };
  const rows = [...panel.querySelectorAll('button,select,input')].map(el => {
    const r = el.getBoundingClientRect();
    if (r.height < 2) return null;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') return null;
    return {
      tag: el.tagName.toLowerCase() + (el.type ? ':' + el.type : ''),
      label: (el.textContent || '').trim().slice(0, 10) || el.getAttribute('aria-label') || el.type || '?',
      h: Math.round(r.height),
      fs: cs.fontSize,
    };
  }).filter(Boolean);
  const stats = [...document.querySelectorAll('div')].find(d => typeof d.className === 'string' && d.className.includes('lg:w-80') && d.className.includes('border-l'));
  const statsRows = stats ? [...stats.querySelectorAll('button,input')].map(el => {
    const r = el.getBoundingClientRect();
    if (r.height < 2) return null;
    return { tag: el.tagName.toLowerCase() + (el.type ? ':' + el.type : ''), label: (el.textContent || '').trim().slice(0, 10) || el.placeholder || '?', h: Math.round(r.height), fs: getComputedStyle(el).fontSize };
  }).filter(Boolean) : [];
  const bars = [...document.querySelectorAll('button')].filter(b => ['首页', '豆社', '画板', '大画板'].includes((b.textContent || '').trim()));
  const tools = [...document.querySelectorAll('[aria-label="绘图工具"] button')];
  return {
    rows: rows.concat(statsRows),
    nav: bars.map(b => ({ w: Math.round(b.getBoundingClientRect().width), h: Math.round(b.getBoundingClientRect().height) })),
    tools: tools.map(b => ({ w: Math.round(b.getBoundingClientRect().width), h: Math.round(b.getBoundingClientRect().height) })),
    bodyOverflow: document.body.scrollWidth > innerWidth,
    viewport: innerWidth,
  };
})()`;

const probeMobile = `(() => {
  const sheet = [...document.querySelectorAll('div')].find(d => typeof d.className === 'string' && d.className.includes('max-w-none') && d.className.includes('overflow-visible'));
  if (!sheet) return { error: 'settings sheet not open' };
  const rows = [...sheet.querySelectorAll('button,select,input')].map(el => {
    const r = el.getBoundingClientRect();
    if (r.height < 2) return null;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') return null;
    return { tag: el.tagName.toLowerCase() + (el.type ? ':' + el.type : ''), label: (el.textContent || '').trim().slice(0, 10) || el.type || '?', h: Math.round(r.height), fs: cs.fontSize };
  }).filter(Boolean);
  return {
    rows,
    pad: getComputedStyle(sheet).padding,
    bodyOverflow: document.body.scrollWidth > innerWidth,
    viewport: innerWidth,
  };
})()`;

/** 造一张 8 色图喂给隐藏的 file input：只有 hasImage=true 时主按钮才会渲染。 */
const seedImage = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const input = [...document.querySelectorAll('input[type=file]')].find(i => (i.accept || '').includes('image'));
  if (!input) return 'no-input';
  const canvas = document.createElement('canvas');
  canvas.width = 160; canvas.height = 160;
  const ctx = canvas.getContext('2d');
  const cols = ['#ff3366','#3366ff','#22c55e','#f59e0b','#8b5cf6','#06b6d4','#ef4444','#111827'];
  for (let i = 0; i < 8; i++) { ctx.fillStyle = cols[i]; ctx.fillRect((i % 4) * 40, Math.floor(i / 4) * 80, 40, 80); }
  const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
  const dt = new DataTransfer();
  dt.items.add(new File([blob], 'layout-contract.png', { type: 'image/png' }));
  Object.defineProperty(input, 'files', { value: dt.files, configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(2400);
  const cancel = [...document.querySelectorAll('button')].find(b => (b.textContent || '').trim() === '取消');
  if (cancel) { cancel.click(); await sleep(500); }
  return 'ok';
})()`;

const clickByText = (text: string) => `(() => {
  const el = [...document.querySelectorAll('button,a,[role=button]')].find(b => (b.textContent || '').trim().includes(${JSON.stringify(text)}));
  if (!el) return false;
  el.click();
  return true;
})()`;

// Read the mounted canvas state without invoking React setters or app handlers.
const inspectGrid = `(() => {
  const canvas = document.querySelector('[data-grid-canvas]');
  let fiber = canvas[Object.keys(canvas).find(key => key.startsWith('__reactFiber$'))];
  while (fiber.return) fiber = fiber.return;
  const pending = [fiber.stateNode.current];
  while (pending.length) {
    const node = pending.pop();
    const props = node.memoizedProps;
    if (props && Array.isArray(props.grid) && typeof props.onCellClick === 'function' && typeof props.zoom === 'number') {
      let hook = node.memoizedState;
      while (hook) {
        const pan = hook.memoizedState;
        if (pan && typeof pan.x === 'number' && typeof pan.y === 'number') {
          const rect = canvas.getBoundingClientRect();
          return { grid: props.grid, zoom: props.zoom, pan, width: props.width, height: props.height,
            boardSize: props.boardSize, selected: props.selectedColor?.id, coord: props.showCoordinates ? 28 : 0,
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
        }
        hook = hook.next;
      }
    }
    if (node.child) pending.push(node.child);
    if (node.sibling) pending.push(node.sibling);
  }
  throw new Error('Mounted canvas state unavailable');
})()`;

const observeRulerDrawing = `(() => {
  for (const method of ['clearRect', 'fillText']) {
    const original = CanvasRenderingContext2D.prototype[method];
    CanvasRenderingContext2D.prototype[method] = function(...args) {
      if (this.canvas.matches('[data-grid-canvas]')) {
        if (method === 'clearRect') window.__rulerText = [];
        else (window.__rulerText ??= []).push({ text: String(args[0]), x: args[1], y: args[2], align: this.textAlign });
      }
      return original.apply(this, args);
    };
  }
})()`;

/* ------------------------------------------------------------ CDP client -- */

function makeClient(wsUrl: string) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  ws.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data as string);
    const entry = msg.id && pending.get(msg.id);
    if (!entry) return;
    pending.delete(msg.id);
    msg.error ? entry.reject(new Error(JSON.stringify(msg.error))) : entry.resolve(msg.result);
  });
  const ready = new Promise<void>((resolve, reject) => {
    ws.addEventListener('open', () => resolve());
    ws.addEventListener('error', () => reject(new Error('CDP socket failed')));
  });
  return {
    ready,
    send<T = any>(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<T> {
      const mid = ++id;
      return new Promise<T>((resolve, reject) => {
        pending.set(mid, { resolve: resolve as (v: any) => void, reject });
        ws.send(JSON.stringify({ id: mid, method, params, ...(sessionId ? { sessionId } : {}) }));
      });
    },
    close() { ws.close(); },
  };
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function waitForPort(profileDir: string): Promise<number> {
  const file = join(profileDir, 'DevToolsActivePort');
  for (let i = 0; i < 100; i++) {
    if (existsSync(file)) {
      const port = Number(readFileSync(file, 'utf8').split('\n')[0]);
      if (port) return port;
    }
    await sleep(100);
  }
  throw new Error('Chrome did not expose a debugging port');
}

/* ------------------------------------------------------------------ suite -- */

const available = existsSync(chromePath);

describe.skipIf(!available)('shared components keep the desktop and mobile contracts', () => {
  let server: ViteDevServer;
  let chrome: ChildProcess | undefined;
  let profileDir = '';
  let client: ReturnType<typeof makeClient> | undefined;
  let sessionId = '';
  let origin = '';
  const send = <T = any>(method: string, params: Record<string, unknown> = {}) => client!.send<T>(method, params, sessionId);

  beforeAll(async () => {
    server = await createServer({
      configFile: false,
      root: projectRoot,
      logLevel: 'error',
      plugins: [react(), tailwindcss()],
      server: { host: '127.0.0.1', port: 0, hmr: false },
    });
    await server.listen();
    const address = server.httpServer!.address();
    if (!address || typeof address === 'string') throw new Error('dev server has no port');
    origin = `http://127.0.0.1:${address.port}`;

    profileDir = mkdtempSync(join(tmpdir(), 'layout-contract-'));
    chrome = spawn(chromePath, [
      '--headless=new', '--disable-gpu', '--hide-scrollbars', '--mute-audio',
      '--no-first-run', '--no-default-browser-check', '--disable-extensions',
      '--disable-background-networking', '--disable-component-update', '--disable-sync',
      '--remote-debugging-port=0', `--user-data-dir=${profileDir}`,
      '--window-size=1440,1024', 'about:blank',
    ], { stdio: 'ignore' });
    const port = await waitForPort(profileDir);
    const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    client = makeClient(version.webSocketDebuggerUrl);
    await client.ready;
    const { targetId } = await client.send('Target.createTarget', { url: 'about:blank' });
    const attached = await client.send('Target.attachToTarget', { targetId, flatten: true });
    sessionId = attached.sessionId;
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Network.enable');
    // 这套契约只关心中枢布局，抓不到真实接口时页面也必须能渲染。
    await send('Network.setBlockedURLs', { urls: ['*/api/*', '*supabase*', '*googleapis*'] });
  }, 120000);

  afterAll(async () => {
    client?.close();
    chrome?.kill();
    await server?.close();
    if (profileDir) rmSync(profileDir, { recursive: true, force: true });
  });

  async function openStudio(width: number, height: number) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 1024 });
    await send('Emulation.setTouchEmulationEnabled', { enabled: width < 1024, maxTouchPoints: 5 });
    await send('Page.navigate', { url: `${origin}/workspace?tab=studio` });
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      const ready = await send<{ result: { value: boolean } }>('Runtime.evaluate', {
        expression: `Boolean(document.querySelector('.w-80') || document.querySelector('[aria-label="画板工具箱"]'))`,
        returnByValue: true,
      });
      if (ready.result.value) { await sleep(700); return; }
      await sleep(200);
    }
    throw new Error(`studio did not render at ${width}px`);
  }

  const evaluate = async (expression: string) => {
    const res = await send<{ result: { value: any } }>('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true,
    });
    return res.result.value;
  };

  it('keeps every desktop control on the 32/36/40 grid and nothing clipped', async () => {
    await openStudio(1440, 1024);
    // 没有图时主按钮根本不渲染，面板也不会溢出——正好绕开上一轮那个 flex 压扁的坑
    expect(await evaluate(seedImage)).toBe('ok');
    await sleep(600);
    const report = await evaluate(probeDesktop) as {
      error?: string; rows: Row[]; nav: { w: number; h: number }[]; tools: { w: number; h: number }[]; bodyOverflow: boolean;
    };
    expect(report.error).toBeUndefined();
    expect(report.bodyOverflow).toBe(false);

    const offGrid = report.rows.filter(row => !DESKTOP_HEIGHTS.has(row.h));
    expect(
      offGrid.map(row => `${row.tag} "${row.label}" h=${row.h}`),
      `桌面端出现了不在 16/24/32/36/40 里的控件高度：${JSON.stringify(offGrid)}`,
    ).toEqual([]);

    // 这条专治「主按钮被 flex 压成 16px」：内容是图标 16px，被压扁时高度会等于 16
    const primary = report.rows.filter(row => row.label.includes('重新计算'));
    if (primary.length) expect(primary[0].h).toBe(36);

    // 导航项被压窄后会折成竖排（宽 50 高 52），所以高度不能超过控件本身
    for (const item of report.nav) expect(item.h).toBeLessThanOrEqual(40);
    for (const item of report.tools) expect(item.h).toBeLessThanOrEqual(40);
  }, 60000);

  it('keeps every phone control at 40px or more and the sheet full-bleed', async () => {
    await openStudio(390, 844);
    // 移动端参数面板在「转图」tab 里
    await evaluate(clickByText('转图'));
    await sleep(900);
    const report = await evaluate(probeMobile) as { error?: string; rows: Row[]; pad: string; bodyOverflow: boolean };
    expect(report.error).toBeUndefined();
    expect(report.bodyOverflow).toBe(false);
    expect(report.pad).toBe('0px');

    const tooSmall = report.rows.filter(row => !row.tag.includes('checkbox') && !row.tag.includes('range') && row.h < MOBILE_MIN);
    expect(
      tooSmall.map(row => `${row.tag} "${row.label}" h=${row.h}`),
      `手机端出现小于 ${MOBILE_MIN}px 的控件：${JSON.stringify(tooSmall)}`,
    ).toEqual([]);
  }, 60000);

  it.each([[844, 390], [768, 1024]])('keeps the compact reference and zoom controls reachable at %ix%i', async (width, height) => {
    await openStudio(width, height);
    const controls = () => evaluate(`(() => {
      const trigger = document.querySelector('button[aria-label="打开原图参考"]');
      const header = document.querySelector('[aria-label="拖动原图参考位置"]');
      const labels = ['居中适应屏幕', '全屏全图预览', '缩小', '放大'];
      const zoom = document.querySelector('button[aria-label="缩小"]');
      return {
        triggerWidth: trigger?.getBoundingClientRect().width ?? 0,
        desktopPanelWidth: header?.getBoundingClientRect().width ?? 0,
        zoomPercent: Number(zoom?.parentElement?.textContent?.match(/(\\d+)%/)?.[1]),
        controls: labels.map(label => {
          const button = document.querySelector('button[aria-label="' + label + '"]');
          const rect = button?.getBoundingClientRect();
          const x = rect ? rect.left + rect.width / 2 : -1;
          const y = rect ? rect.top + rect.height / 2 : -1;
          return { label, x, y, reachable: !!button && !!rect?.width && button.contains(document.elementFromPoint(x, y)) };
        }),
      };
    })()`);
    const clickAt = async (x: number, y: number) => {
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
      await sleep(150);
    };

    for (const withSource of [false, true]) {
      if (withSource) expect(await evaluate(seedImage)).toBe('ok');
      const before = await controls();
      expect(before.triggerWidth).toBe(44);
      expect(before.desktopPanelWidth).toBe(0);
      expect(before.controls.filter((control: { reachable: boolean }) => !control.reachable)).toEqual([]);
      const plus = before.controls.find((control: { label: string }) => control.label === '放大');
      const beforeZoom = (await evaluate(inspectGrid)).zoom;
      await clickAt(plus.x, plus.y);
      const enlarged = await controls();
      const enlargedZoom = (await evaluate(inspectGrid)).zoom;
      expect(enlargedZoom).toBeGreaterThan(beforeZoom);
      const minus = enlarged.controls.find((control: { label: string }) => control.label === '缩小');
      await clickAt(minus.x, minus.y);
      expect((await evaluate(inspectGrid)).zoom).toBeLessThan(enlargedZoom);

      await evaluate(`document.querySelector('button[aria-label="打开原图参考"]').click()`);
      await sleep(150);
      expect(await evaluate(`(() => {
        const sheet = [...document.querySelectorAll('section')].find(el => el.textContent.includes('原图参考') && el.textContent.includes('重置画板'));
        return (sheet?.getBoundingClientRect().width ?? 0) > 0;
      })()`)).toBe(true);
      await evaluate(clickByText('关闭'));
      await sleep(150);
      expect((await controls()).controls.filter((control: { reachable: boolean }) => !control.reachable)).toEqual([]);
    }
  }, 60000);

  it.each([[390, 844], [844, 390]])('frames boards 2/4/6 with visible rulers and editable first/last cells at %ix%i', async (width, height) => {
    const script = await send('Page.addScriptToEvaluateOnNewDocument', { source: observeRulerDrawing });
    try {
      await openStudio(width, height);
      const tap = async (x: number, y: number) => {
        await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
        await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await sleep(180);
      };
      for (const number of [2, 4, 6]) {
        await evaluate(`document.querySelector('button[aria-label="第 ${number} 板"]').click()`);
        await sleep(250);
        const state = await evaluate(inspectGrid);
        expect(state.coord).toBe(28);
        const across = Math.ceil(state.width / state.boardSize);
        const x0 = ((number - 1) % across) * state.boardSize;
        const y0 = Math.floor((number - 1) / across) * state.boardSize;
        const cols = Math.min(state.boardSize, state.width - x0);
        const rows = Math.min(state.boardSize, state.height - y0);
        const cell = 20 * state.zoom;
        const left = state.pan.x + state.coord + x0 * cell;
        const top = state.pan.y + state.coord + y0 * cell;
        expect(left).toBeGreaterThanOrEqual(state.coord);
        expect(top).toBeGreaterThanOrEqual(state.coord);
        expect(left + cols * cell).toBeLessThanOrEqual(state.rect.width + 0.01);
        expect(top + rows * cell).toBeLessThanOrEqual(state.rect.height - 64 + 0.01);
        const rulers = await evaluate(`(() => {
          const canvas = document.querySelector('[data-grid-canvas]');
          const ctx = canvas.getContext('2d');
          const dpr = canvas.width / canvas.getBoundingClientRect().width;
          return (window.__rulerText ?? []).map(label => {
            const metrics = ctx.measureText(label.text);
            const x = label.align === 'right' ? label.x - metrics.width : label.x - metrics.width / 2;
            const pixels = ctx.getImageData(Math.max(0, Math.floor(x * dpr)), Math.max(0, Math.floor((label.y - 8) * dpr)), Math.ceil((metrics.width + 2) * dpr), Math.ceil(16 * dpr)).data;
            let ink = 0;
            for (let i = 0; i < pixels.length; i += 4) if (pixels[i] < 110 && pixels[i + 1] < 130 && pixels[i + 2] < 150 && pixels[i + 3] > 200) ink++;
            return { ...label, ink };
          });
        })()`);
        for (const [align, last] of [['center', cols], ['right', rows]] as const) {
          for (const text of ['1', String(last)]) {
            const label = rulers.find((entry: any) => entry.align === align && entry.text === text);
            expect(label, `board ${number} ${align} label ${text}`).toBeDefined();
            expect(label.ink).toBeGreaterThan(0);
            if (align === 'center') expect(label.y).toBeCloseTo(top - state.coord / 2);
            else expect(label.x).toBeCloseTo(left - 6);
          }
        }
        for (const [x, y] of [[x0, y0], [x0 + cols - 1, y0 + rows - 1]]) {
          const current = await evaluate(inspectGrid);
          const clientX = current.rect.x + current.pan.x + current.coord + (x + 0.5) * 20 * current.zoom;
          const clientY = current.rect.y + current.pan.y + current.coord + (y + 0.5) * 20 * current.zoom;
          expect(await evaluate(`document.elementFromPoint(${clientX}, ${clientY})?.matches('[data-grid-canvas]')`)).toBe(true);
          await tap(clientX, clientY);
          const drawn = await evaluate(inspectGrid);
          expect(drawn.grid[y][x]).toBe(current.selected);
          expect(drawn.grid.flat().filter(Boolean).length).toBe(current.grid.flat().filter(Boolean).length + 1);
          await evaluate(`document.querySelector('button[aria-label="撤销"]').click()`);
          await sleep(180);
          expect((await evaluate(inspectGrid)).grid).toEqual(current.grid);
        }
      }
      await evaluate(clickByText('全图'));
      await sleep(250);
      expect(await evaluate(`document.querySelector('[aria-label="拼豆板"] [aria-pressed="true"]')`)).toBeNull();
      const whole = await evaluate(inspectGrid);
      expect(whole.pan.x).toBeGreaterThanOrEqual(0);
      expect(whole.pan.y).toBeGreaterThanOrEqual(0);
      expect(whole.pan.y + whole.coord + whole.height * 20 * whole.zoom).toBeLessThanOrEqual(whole.rect.height - 64 + 0.01);
    } finally {
      await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: script.identifier });
    }
  }, 60000);

  it('keeps desktop wheel zoom and whole-pattern reset working', async () => {
    await openStudio(1440, 1024);
    const before = await evaluate(inspectGrid);
    await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: before.rect.x + before.rect.width / 2, y: before.rect.y + before.rect.height / 2, deltaX: 0, deltaY: -120 });
    await sleep(250);
    expect((await evaluate(inspectGrid)).zoom).toBeGreaterThan(before.zoom);
    await evaluate(`document.querySelector('button[aria-label="居中适应屏幕"]').click()`);
    await sleep(250);
    expect((await evaluate(inspectGrid)).zoom).toBeCloseTo(before.zoom);
  }, 60000);
});
