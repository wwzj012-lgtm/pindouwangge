import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import react from '@vitejs/plugin-react';
import { createServer } from 'vite';
import { expect, it } from 'vitest';

// Optional native-Chrome interactions: bundled runtime, no installs or API calls.
const runtime = process.env.COMMUNITY_CANVAS_PLAYWRIGHT
  ?? 'C:/Users/Plout/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json';
const chrome = process.env.COMMUNITY_CANVAS_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const harness = `
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {CommunityPatternCanvas} from '/src/components/CommunityPatternCanvas.tsx';
const palette=[
  {id:'a',code:'A1',name:'白',hex:'#FFFFFF',rgb:[255,255,255],brand:'MARD'},
  {id:'b',code:'B2',name:'红',hex:'#FF0000',rgb:[255,0,0],brand:'MARD'}
];
function make(w,h){return {version:2,name:'practice',width:w,height:h,boardSize:29,brand:'MARD',settings:{},createdAt:1,palette,grid:Array.from({length:h},(_,y)=>Array.from({length:w},(_,x)=>(x+y)%5===0?null:'ab'[(x+y)%2]))}}
const project=make(40,40);
window.probe={project,toggles:[],texts:[],evenodd:0,draws:0,patch:null};
const fill=CanvasRenderingContext2D.prototype.fill;
const text=CanvasRenderingContext2D.prototype.fillText;
const draw=CanvasRenderingContext2D.prototype.drawImage;
CanvasRenderingContext2D.prototype.fill=function(rule){if(this.canvas.isConnected&&rule==='evenodd')probe.evenodd++;return fill.apply(this,arguments)};
CanvasRenderingContext2D.prototype.fillText=function(value,...rest){if(this.canvas.isConnected)probe.texts.push(String(value));return text.call(this,value,...rest)};
CanvasRenderingContext2D.prototype.drawImage=function(){if(this.canvas.isConnected)probe.draws++;return draw.apply(this,arguments)};
function Harness(){
  const [props,setProps]=useState({project,sectionSize:20,doneCells:new Set(),focusRect:null,flashCell:null});
  probe.patch=next=>setProps(current=>({...current,...next}));
  return React.createElement(CommunityPatternCanvas,{...props,onToggleCell:index=>{
    probe.toggles.push(index);
    setProps(current=>{const next=new Set(current.doneCells);next.add(index);return {...current,doneCells:next}});
  }});
}
createRoot(document.getElementById('root')).render(React.createElement(Harness));
`;

it.skipIf(!existsSync(runtime) || !existsSync(chrome))('draws rulers, section badges, placed veil and click-to-toggle progress', async () => {
  const { chromium } = createRequire(runtime)('./index.js');
  const server = await createServer({
    configFile: false,
    // A private dep cache keeps parallel browser tests from re-optimizing the shared one.
    cacheDir: 'node_modules/.vite/practice-canvas-check',
    server: { host: '127.0.0.1', port: 0 }, plugins: [react(), {
      name: 'practice-canvas-check',
      resolveId(id) { if (id === '/__practice_canvas_harness.js') return '\0practice-canvas-harness'; },
      load(id) { if (id === '\0practice-canvas-harness') return harness; },
      configureServer(vite) {
        vite.middlewares.use(async (req, res, next) => {
          if (req.url !== '/__practice_canvas_check') return next();
          res.setHeader('Content-Type', 'text/html');
          res.end(await vite.transformIndexHtml(req.url, '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:12px;box-sizing:border-box}#root{width:100%;max-width:800px}</style></head><body><div id="root"></div><script type="module" src="/__practice_canvas_harness.js"></script></body></html>'));
        });
      },
    }],
  });
  let browser: any;
  try {
    await server.listen();
    const address = server.httpServer!.address();
    const origin = 'http://127.0.0.1:' + (typeof address === 'object' && address ? address.port : 0);
    browser = await chromium.launch({ executablePath: chrome, headless: true });
    const context = await browser.newContext({ viewport: { width: 900, height: 780 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error: Error) => errors.push(error.message));
    await context.route('**/*', (route: any) => route.request().url().startsWith(origin) ? route.continue() : route.abort());
    await page.goto(origin + '/__practice_canvas_check');
    await page.waitForFunction(() => (window as any).probe?.draws > 0 && (window as any).probe.texts.length > 0);
    const settle = () => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await settle();

    // Section badges: one per section, screen-space, fixed 10px type.
    const texts: string[] = await page.evaluate(() => (window as any).probe.texts);
    for (const label of ['A1', 'A2', 'B1', 'B2']) expect(texts).toContain(label);

    // Rulers: the band nearest the viewport edges is an opaque-ish white strip.
    const pixels = () => page.evaluate(() => {
      const canvas = document.querySelector('canvas')!;
      const context = canvas.getContext('2d')!;
      const at = (x: number, y: number) => Array.from(context.getImageData(x, y, 1, 1).data) as number[];
      return { topBand: at(160, 4), leftBand: at(4, 160), corner: at(4, 4) };
    });
    const withRulers = await pixels();
    expect(withRulers.topBand[3]).toBeGreaterThan(180);
    expect(withRulers.topBand.slice(0, 3)).toEqual([255, 255, 255]);
    expect(withRulers.leftBand[3]).toBeGreaterThan(180);
    expect(withRulers.corner[3]).toBeGreaterThan(180);
    await page.getByRole('button', { name: '隐藏行列坐标标尺' }).click();
    await settle();
    const withoutRulers = await pixels();
    expect(withoutRulers.topBand[3]).toBe(0);
    expect(withoutRulers.leftBand[3]).toBe(0);
    expect(await page.getByRole('button', { name: '显示行列坐标标尺' }).getAttribute('aria-pressed')).toBe('false');
    await page.getByRole('button', { name: '显示行列坐标标尺' }).click();
    await settle();

    const cellPoint = (x: number, y: number) => page.locator('canvas').evaluate((canvas: HTMLCanvasElement, xy: number[]) => {
      const project = (window as any).probe.project, rect = canvas.getBoundingClientRect();
      const zoom = Math.min(64, (rect.width - 40) / project.width, (rect.height - 40) / project.height);
      return {
        x: rect.x + (rect.width - project.width * zoom) / 2 + (xy[0] + 0.5) * zoom,
        y: rect.y + (rect.height - project.height * zoom) / 2 + (xy[1] + 0.5) * zoom,
      };
    }, [x, y]);
    // The fixture leaves every fifth cell empty: (20, 20) is empty, (21, 20) holds a bead.
    const center = await cellPoint(21, 20);

    // A tap toggles exactly one cell and the status bar reports the new state.
    await page.mouse.move(center.x, center.y);
    await page.mouse.down();
    await page.mouse.up();
    await settle();
    const toggles: number[] = await page.evaluate(() => (window as any).probe.toggles);
    expect(toggles).toEqual([20 * 40 + 21]);
    await expect.poll(() => page.locator('.community-pattern-canvas__status').textContent()).toContain('已拼');
    await expect.poll(() => page.locator('.community-pattern-canvas__status').textContent()).toContain('所在区块');
    // Without a hovered cell the same slot is a plain pointer hint: overall progress
    // lives in the practice panel only, so it is never duplicated down here.
    await page.mouse.move(5, 5);
    await expect.poll(() => page.locator('.community-pattern-canvas__status').textContent()).toContain('指向网格查看坐标');
    expect(await page.locator('.community-pattern-canvas__status').textContent()).not.toContain('总进度');

    // Empty cells are never marked, and a drag pans instead of toggling.
    const empty = await cellPoint(20, 20);
    await page.mouse.move(empty.x, empty.y);
    await page.mouse.down();
    await page.mouse.up();
    await settle();
    expect(await page.evaluate(() => (window as any).probe.toggles.length)).toBe(1);

    // The ruler bands are an overlay: tapping under them must never mark a hidden bead.
    const rulerBox = await page.locator('canvas').boundingBox();
    for (const [offsetX, offsetY] of [[10, 10], [10, 200], [200, 10]]) {
      await page.mouse.move(rulerBox!.x + offsetX, rulerBox!.y + offsetY);
      await page.mouse.down();
      await page.mouse.up();
      await settle();
    }
    expect(await page.evaluate(() => (window as any).probe.toggles.length)).toBe(1);
    // Dragging (pressing) inside the ruler band still pans.
    await page.mouse.move(rulerBox!.x + 10, rulerBox!.y + 10);
    await page.mouse.down();
    await page.mouse.move(rulerBox!.x + 60, rulerBox!.y + 50, { steps: 4 });
    await page.mouse.up();
    await settle();
    expect(await page.evaluate(() => (window as any).probe.toggles.length)).toBe(1);

    await page.mouse.move(center.x, center.y);
    await page.mouse.down();
    await page.mouse.move(center.x + 40, center.y + 30, { steps: 5 });
    await page.mouse.up();
    await settle();
    expect(await page.evaluate(() => (window as any).probe.toggles.length)).toBe(1);

    // Focusing a rect re-frames the view and dims everything around it (evenodd veil).
    const beforeFocus = await page.evaluate(() => (window as any).probe.evenodd);
    expect(beforeFocus).toBe(0);
    await page.evaluate(() => (window as any).probe.patch({ focusRect: { x: 30, y: 30, width: 10, height: 10, nonce: 1 } }));
    await settle();
    expect(await page.evaluate(() => (window as any).probe.evenodd)).toBeGreaterThan(0);
    await expect.poll(() => page.getByLabel('视图缩放').textContent()).not.toBe('100%');
    // The focused rect must be centered: hovering the middle reports its middle cell.
    const canvasBox = await page.locator('canvas').boundingBox();
    await page.mouse.move(canvasBox!.x + canvasBox!.width / 2, canvasBox!.y + canvasBox!.height / 2);
    await expect.poll(() => page.locator('.community-pattern-canvas__status').textContent()).toContain('列 36 · 行 36');
    await page.mouse.move(5, 5);
    await page.evaluate(() => (window as any).probe.patch({ focusRect: null }));
    await settle();
    await expect.poll(() => page.getByLabel('视图缩放').textContent()).toBe('100%');

    // Flash target and done set never create per-cell DOM.
    await page.evaluate(() => (window as any).probe.patch({ flashCell: { x: 3, y: 3, nonce: 1 } }));
    await settle();
    expect(await page.locator('.community-pattern-canvas *').count()).toBeLessThan(25);
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    await server.close();
  }
}, 60_000);
