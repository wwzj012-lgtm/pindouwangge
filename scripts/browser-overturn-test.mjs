// 浏览器端字形翻案实验：自体 unique 池 + 合成数字兜底，对 refined 非锁定行翻案
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';

const vite = await createServer({ root: process.cwd(), server: { port: 46123, strictPort: true }, logLevel: 'error' });
await vite.listen();
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const page = await browser.newPage();
page.on('pageerror', err => console.log('[pageexception]', String(err).slice(0, 300)));
await page.goto('http://localhost:46123', { waitUntil: 'load', timeout: 60000 });

const truth = JSON.parse(readFileSync('benchmark/truth-cards.json', 'utf8'));
const result = await page.evaluate(async () => {
  const m = await import('/src/utils/importLegend.ts');
    const { rgbToLab } = await import('/src/utils/colorUtils.ts');
  const { BRAND_PALETTES } = await import('/src/data/palettes.ts');
  const out = {};
  for (const card of ['card1', 'card2', 'card3']) {
    const resp = await fetch(`/benchmark/images/${card}.png`);
    const bmp = await createImageBitmap(await resp.blob());
    const canvas = document.createElement('canvas');
    canvas.width = bmp.width; canvas.height = bmp.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0);
    const source = { data: ctx.getImageData(0, 0, bmp.width, bmp.height).data, width: bmp.width, height: bmp.height };
    const { rawEntries, splits, digitW } = m.collectCardEntries(source);
    const priors = rawEntries.map(e => e.dotRgb ? m.priorFromDot(e.dotRgb, BRAND_PALETTES.MARD.filter(c => c.enabled !== false).map(c => ({ color: c, lab: rgbToLab(...c.rgb) }))) : null);
    const prepared = BRAND_PALETTES.MARD.filter(c => c.enabled !== false).map(c => ({ color: c, lab: rgbToLab(...c.rgb) }));
    // 复刻切分回滚
    const sliceBackup = [], sliceApplied = [];
    for (let i = 0; i < splits.length; i++) {
      const s = splits[i];
      if (!s || !priors[i] || priors[i].deltaE > 6) { sliceBackup.push(null); sliceApplied.push(false); continue; }
      const before = s.codeGlyphs;
      m.sliceMergedCodeGlyphs(s, priors[i], digitW);
      sliceBackup.push(s.codeGlyphs !== before ? before : null);
      sliceApplied.push(s.codeGlyphs !== before);
    }
    const anchors0 = m.resolveCodes(rawEntries, splits, priors, prepared);
    const anchors = [...anchors0];
    for (let i = 0; i < splits.length; i++) {
      if (sliceApplied[i] && anchors0[i]?.code !== priors[i].code && sliceBackup[i]) { splits[i].codeGlyphs = sliceBackup[i]; anchors[i] = null; }
    }
    const refined = m.cardRefineCodes(rawEntries, splits, anchors, prepared);
    // 自体池（unique 行）+ 合成数字兜底
    const pool = new Map();
    const heights = [];
    splits.forEach((s, i) => { if (s) s.codeGlyphs.forEach(g => heights.push(g.y1 - g.y0 + 1)); });
    heights.sort((a, b) => a - b);
    const medH = heights.length ? heights[Math.floor(heights.length / 2)] : 9;
    const synthMaps = [medH - 1, medH, medH + 1].map(h => m.renderSyntheticDigitTemplates(h)).filter(Boolean);
    splits.forEach((s, i) => {
      const a = anchors[i];
      if (!s || !a?.unique || a.code.length !== s.codeGlyphs.length) return;
      [...a.code].forEach((ch, j) => { if (!pool.has(ch)) pool.set(ch, []); pool.get(ch).push({ bitmap: s.codeGlyphs[j].bitmap, from: i }); });
    });
    const glyphDist = (bmp, ch, excludeI = -1) => {
      const own = (pool.get(ch) ?? []).filter(p => p.from !== excludeI);
      if (own.length) return Math.min(...own.map(p => m.bitmapJaccard(bmp, p.bitmap)));
      const syns = synthMaps.map(t => t.get(ch)).filter(Boolean);
      if (syns.length) return Math.min(...syns.map(t => m.matchGlyph(bmp, new Map([[ch, t]]), true).distance));
      return null;
    };
    const taken = new Set();
    splits.forEach((s, i) => { const a = anchors[i]; if (a?.unique) taken.add(a.code); });
    // 翻案：refined 长度匹配、非 unique 行
    // unique 毒标降级：unique 行自身码 gs > 0.2（字形证据强烈反对）且存在
    // gs < 0.1 的替代码 → 降级翻案（A23 0.222 vs A18 0.075 实证）
    const downgrades = [];
    splits.forEach((s, i) => {
      const a = anchors[i];
      if (!s || !a?.unique || a.code.length !== s.codeGlyphs.length) return;
      const len = s.codeGlyphs.length;
      const scored = [];
      for (const p of prepared) {
        const code = p.color.code;
        if (code.length !== len || code === a.code) continue;
        let sum = 0, n = 0, miss = false;
        for (let j = 0; j < len; j++) {
          const d = glyphDist(s.codeGlyphs[j].bitmap, code[j], i);
          if (d === null) { miss = true; break; }
          sum += d; n++;
        }
        if (!miss) scored.push({ code, gs: sum / n });
      }
      scored.sort((x, y) => x.gs - y.gs);
      let selfGs = null;
      {
        let sum = 0, n = 0, miss = false;
        for (let j = 0; j < len; j++) {
          const d = glyphDist(s.codeGlyphs[j].bitmap, a.code[j], i);
          if (d === null) { miss = true; break; }
          sum += d; n++;
        }
        if (!miss) selfGs = sum / n;
      }
      if (selfGs !== null) downgrades.push({ i, code: a.code, selfGs, newCode: scored[0]?.code ?? '-', newGs: scored[0]?.gs ?? null, top: scored.slice(0, 2) });
    });
    const rows = [];
    splits.forEach((s, i) => {
      const a = anchors[i], r = refined[i];
      if (!s || s.codeGlyphs.length < 2) return;
      if (a?.unique) return;
      const len = s.codeGlyphs.length;
      const scored = [];
      for (const p of prepared) {
        const code = p.color.code;
        if (code.length !== len || taken.has(code)) continue;
        let sum = 0, n = 0, miss = false;
        for (let j = 0; j < len; j++) {
          const d = glyphDist(s.codeGlyphs[j].bitmap, code[j], i);
          if (d === null) { miss = true; break; }
          sum += d; n++;
        }
        if (!miss) scored.push({ code, gs: sum / n });
      }
    scored.sort((x, y) => x.gs - y.gs);
    // 当前码字形分（对照基准）：新第一名必须比它强 margin 以上才翻
    let curGs = null;
    const curCode = r?.code ?? a?.code ?? '';
    if (curCode && curCode.length === s.codeGlyphs.length) {
      let sum = 0, n = 0, miss = false;
      for (let j = 0; j < len; j++) {
        const d = glyphDist(s.codeGlyphs[j].bitmap, curCode[j]);
        if (d === null) { miss = true; break; }
        sum += d; n++;
      }
      if (!miss) curGs = sum / n;
    }
    rows.push({ i, old: r?.code ?? a?.code ?? '-', curGs, scored: scored.slice(0, 3) });
    });
    out[card] = { rows, downgrades };
  }
  return out;
}, {});

const GLYPH_MARGIN = 0.03, GLYPH_MAX = 0.35;
for (const card of Object.keys(result)) {
  const tseq = (truth[card].entries ?? truth[card]).map(e => e[0]);
  let good = 0, bad = 0;
  const log = [];
  for (const row of result[card].rows) {
    const s = row.scored;
    if (s.length < 2) continue;
    // 规则1：margin 版（第一名显著领先第二名）
    const marginOk = s[1].gs - s[0].gs >= GLYPH_MARGIN;
    // 规则2：当前码保护——当前码字形证据已强（gs<0.15）不翻
    const curOk = row.curGs === null || row.curGs >= 0.25;
    if (s[0].gs <= GLYPH_MAX && marginOk && curOk) {
      const t = tseq[row.i] ?? '?';
      const ok = s[0].code === t;
      if (ok) good++; else bad++;
      log.push(`#${row.i} ${row.old}→${s[0].code} 真${t} ${ok ? '✓' : '✗'} gs=${s[0].gs.toFixed(3)} cur=${row.curGs === null ? '—' : row.curGs.toFixed(3)} vs ${s[1].gs.toFixed(3)}`);
    }
  }
  console.log(`${card}: 翻正=${good} 误翻=${bad}`);
  log.forEach(l => console.log('  ' + l));
  const dg = (result[card].downgrades ?? []).filter(d => d.selfGs > 0.12);
  console.log(`  [unique自身gs>0.12 共${dg.length}]`);
  for (const d of dg) console.log(`  #${d.i} ${d.code} self=${d.selfGs.toFixed(3)} top=${d.top.map(x => `${x.code}:${x.gs.toFixed(3)}`).join(' ')}`);
await browser.close();
await vite.close();
}
