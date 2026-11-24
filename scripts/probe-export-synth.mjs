// 验证合成数字模板路径：Node 无 DOM，用 sharp 渲染 SVG 数字位图模拟
// Canvas fillText/getImageData，stub document 后跑完整 parseLegend。
import { createServer } from 'vite';
import sharp from 'sharp';

const vite = await createServer({ root: process.cwd(), appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });

// 预渲染 (fontPx, digit) → RGBA（canvas 尺寸与实现一致：W=ceil(fontPx*1.6), H=ceil(fontPx*1.8)，fillText(x=ceil(fontPx*0.2), y=ceil(fontPx*1.25))）
const rendered = new Map();
for (let fontPx = 9; fontPx <= 18; fontPx += 1) {
  const W = Math.ceil(fontPx * 1.6), H = Math.ceil(fontPx * 1.8);
  for (let d = 0; d <= 9; d += 1) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><text x="${Math.ceil(fontPx * 0.2)}" y="${Math.ceil(fontPx * 1.25)}" font-size="${fontPx}" font-weight="bold" font-family="DejaVu Sans" fill="#000">${d}</text></svg>`;
    const { data, info } = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    rendered.set(`${fontPx}:${d}`, { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height });
  }
}

globalThis.document = {
  createElement: () => ({
    width: 0, height: 0,
    getContext: () => ({
      font: '',
      textBaseline: '',
      fillStyle: '',
      measureText: () => ({ actualBoundingBoxAscent: 73, actualBoundingBoxDescent: 0 }),
      clearRect: () => {},
      fillText: () => {},
      getImageData: (_x, _y, w, h) => {
        const cur = globalThis.__curFill;
        const hit = rendered.get(`${cur.fontPx}:${cur.ch}`);
        if (!hit || hit.width !== w || hit.height !== h) {
          // 尺寸不匹配：返回全透明（会让该数字被丢弃，暴露问题而非静默错）
          return { data: new Uint8ClampedArray(w * h * 4) };
        }
        return { data: hit.data };
      },
    }),
    // fillText 时记录当前 (ch, fontPx) 供 getImageData 查表
  }),
};
// 用 Proxy 让 ctx.fillText 记录 ch/fontPx
const origCreateElement = globalThis.document.createElement;
globalThis.document.createElement = () => {
  const canvas = origCreateElement();
  const ctx = canvas.getContext();
  const ctx2 = new Proxy(ctx, {
    get(target, prop) {
      if (prop === 'fillText') return (ch) => {
        const fontPx = parseInt(target.font.match(/(\d+)px/)?.[1] ?? '0', 10);
        globalThis.__curFill = { ch: String(ch), fontPx };
      };
      return target[prop];
    },
  });
  canvas.getContext = () => ctx2;
  return canvas;
};

const { parseLegend, countTemplateAssignment } = await vite.ssrLoadModule('/src/utils/importLegend.ts');
const { refineGridAlignment } = await vite.ssrLoadModule('/src/utils/importGridPitch.ts');
const { BRAND_PALETTES } = await vite.ssrLoadModule('/src/data/palettes.ts');

const { data, info } = await sharp('C:/Users/Plout/.workbuddy/clipboard-images/clipboard-2026-11-15T03-22-12-361Z-ca506670.jpg').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };

const refined = refineGridAlignment(source, { originX: 0, originY: 0, cellSize: 12.5 });
const COLS = 101, ROWS = 132;
const CAL = { originX: refined.originX, originY: refined.originY, cellWidth: refined.cell, cellHeight: refined.cell, columns: COLS, rows: ROWS };
const legend = parseLegend(source, CAL, BRAND_PALETTES.MARD, { gridRows: ROWS, gridCols: COLS });
console.log('ok:', legend.ok, 'entries:', legend.ok ? legend.entries.length : legend.failureReason);
if (legend.ok) {
console.log('checks:', JSON.stringify(legend.checks));
for (const a of countTemplateAssignment.slice(0, 3)) console.log('  path:', JSON.stringify(a));
for (const e of legend.entries) console.log(`  ${e.code.padEnd(4)} count=${String(e.count).padStart(4)} conf=${e.confidence.toFixed(2)}${e.warn ? ' warn=' + e.warn : ''}`);
}
await vite.close();
