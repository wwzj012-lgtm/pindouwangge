// 诊断实验：card4 '2'→'7' 系统性误读的根因定位。
// 提取 D9/D17/F16/F20 首数字（真'2'）的字形位图，对 bold/regular 两套
// 合成模板算 Jaccard 排名；并把候选模板与实际字形拼成对照图。
// 用法：node scripts/exp-card4-synth.mjs
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync } from 'node:fs';

const vite = await createServer({ root: process.cwd(), server: { port: 46125, strictPort: true }, logLevel: 'error' });
await vite.listen();

const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
});
const page = await browser.newPage();
page.on('pageerror', err => console.log('[pageexception]', String(err).slice(0, 300)));
await page.goto('http://localhost:46125', { waitUntil: 'load', timeout: 60000 });

const out = await page.evaluate(async () => {
  const { analyzeLineWithContrast, bitmapJaccard } = await import('/src/utils/importLegend.ts');
  // bitmapJaccard 未导出则内联一个等价实现
  const jac = bitmapJaccard ?? ((a, b) => {
    // 对齐尝试 ±2px，取最小距离
    let best = 1;
    for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) {
      let inter = 0, union = 0;
      for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++) {
        const av = a.data[y * a.w + x];
        const bx = x + dx, by = y + dy;
        const bv = bx >= 0 && bx < b.w && by >= 0 && by < b.h ? b.data[by * b.w + bx] : 0;
        if (av && bv) inter++;
        if (av || bv) union++;
      }
      const d = union === 0 ? 1 : 1 - inter / union;
      if (d < best) best = d;
    }
    return best;
  });

  const resp = await fetch('/benchmark/images/card4-strip.png');
  const blob = await resp.blob();
  const bmp = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width; canvas.height = bmp.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  const px = ctx.getImageData(0, 0, bmp.width, bmp.height);
  const source = { data: new Uint8ClampedArray(px.data.buffer), width: bmp.width, height: bmp.height };

  // 数量行带：row1 y≈16-46, row2 y≈58-88（strip 坐标）
  const spots = [
    { name: 'D9-first(真2)', x0: 460, x1: 482, y0: 14, y1: 48 },
    { name: 'D17-first(真2)', x0: 558, x1: 580, y0: 14, y1: 48 },
    { name: 'F16-first(真2)', x0: 848, x1: 870, y0: 56, y1: 90 },
    { name: 'D24-first(真3)', x0: 655, x1: 677, y0: 14, y1: 48 },
  ];
  const results = [];
  // 两套合成模板：bold（管线现状）与 regular（假设）
  const renderSynth = (weight, targetH) => {
    const SS = 4;
    const c = document.createElement('canvas');
    const c2 = document.createElement('canvas');
    const g = c.getContext('2d'); const g2 = c2.getContext('2d');
    const probeFont = 100;
    g.font = `${weight} ${probeFont}px sans-serif`;
    const probe = g.measureText('0');
    const probeH = (probe.actualBoundingBoxAscent ?? 0) + (probe.actualBoundingBoxDescent ?? 0);
    const fontPx = Math.max(9, Math.round((targetH * probeFont) / probeH));
    const big = fontPx * SS;
    c.width = Math.ceil(big * 1.8); c.height = Math.ceil(big * 1.8);
    g.font = `${weight} ${big}px sans-serif`;
    g.textBaseline = 'alphabetic'; g.fillStyle = '#000';
    const map = new Map();
    for (const ch of '0123456789') {
      g.clearRect(0, 0, c.width, c.height);
      g.fillText(ch, Math.ceil(big * 0.2), Math.ceil(big * 1.25));
      const img = g.getImageData(0, 0, c.width, c.height).data;
      let x0 = c.width, x1 = -1, y0 = c.height, y1 = -1;
      for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
        if (img[(y * c.width + x) * 4 + 3] > 127) {
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
      if (x1 < x0) continue;
      const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
      c2.width = Math.max(1, Math.round(bw / SS)); c2.height = Math.max(1, Math.round(bh / SS));
      g2.clearRect(0, 0, c2.width, c2.height);
      g2.imageSmoothingEnabled = true; g2.imageSmoothingQuality = 'high';
      g2.drawImage(c, x0, y0, bw, bh, 0, 0, c2.width, c2.height);
      const scaled = g2.getImageData(0, 0, c2.width, c2.height).data;
      const w = c2.width, h = c2.height;
      const data = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) data[i] = scaled[i * 4 + 3] >= 128 ? 1 : 0;
      map.set(ch, { data, w, h });
    }
    return map;
  };

  for (const spot of spots) {
    const comps = analyzeLineWithContrast(source, [255, 255, 255], { y0: spot.y0, y1: spot.y1, minX: spot.x0, maxX: spot.x1 }, 60, 0.95)
      .filter(c2 => c2.x0 >= spot.x0 && c2.x1 <= spot.x1);
    const first = comps[0];
    if (!first) { results.push({ name: spot.name, error: 'no comps', n: comps.length }); continue; }
    const rankings = {};
    for (const [tag, weight, th] of [['bold-h10', 'bold', 10], ['bold-h11', 'bold', 11], ['reg-h10', 'normal', 10], ['reg-h11', 'normal', 11]]) {
      const tpl = renderSynth(weight, th);
      const ranked = [...tpl.entries()]
        .map(([ch, t]) => ({ ch, d: jac(first.bitmap, t) }))
        .sort((a, b) => a.d - b.d);
      rankings[tag] = ranked.slice(0, 3).map(r => `${r.ch}:${r.d.toFixed(3)}`).join(' ');
    }
    results.push({ name: spot.name, glyph: { w: first.bitmap.w, h: first.bitmap.h, x0: first.x0 }, rankings });
  }
  return results;
});

for (const r of out) {
  if (r.error) { console.log(r.name, 'ERROR', r.error, 'n=' + r.n); continue; }
  console.log(`${r.name} glyph=${r.glyph.w}x${r.glyph.h}@x${r.glyph.x0}`);
  for (const [tag, val] of Object.entries(r.rankings)) console.log(`   ${tag}: ${val}`);
}
await browser.close();
await vite.close();
