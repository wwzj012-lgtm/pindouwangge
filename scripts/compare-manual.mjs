// 手动校准图纸 vs 自动识别 全格对比
// 手动图：clipboard-2026-11-08T13-16-17-405Z-08d1e2aa.jpg (1920x1491, 52x52, pitch 26.30, origin 36.5/86.9)
// 原图：  clipboard-2026-11-08T12-16-53-978Z-9b7a700d.jpg (妲己.jpg)
import { createServer } from 'vite';
import sharp from 'sharp';
import { writeFileSync } from 'fs';

const MANUAL = 'C:/Users/Plout/.workbuddy/clipboard-images/clipboard-2026-11-08T13-16-17-405Z-08d1e2aa.jpg';
const ORIG = 'C:/Users/Plout/.workbuddy/clipboard-images/clipboard-2026-11-08T12-16-53-978Z-9b7a700d.jpg';
const OUT = 'C:/Users/Plout/Desktop/pindouwangge/pattern_compare/import';

// ---------- 1. 解析手动图纸 ----------
const M_PITCH = 26.30, M_OX = 36.5, M_OY = 86.9, COLS = 52, ROWS = 52;
const m = await sharp(MANUAL).raw().toBuffer({ resolveWithObject: true });
const mPx = (x, y) => { const i = (y * m.info.width + x) * m.info.channels; return [m.data[i], m.data[i + 1], m.data[i + 2]]; };

const ROOT = 'D:/Build_Apps/pindouwangge';
const vite = await createServer({ root: ROOT, appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: ROOT + '/vite.config.ts' });
const { BRAND_PALETTES } = await vite.ssrLoadModule('/src/data/palettes.ts');
const PALETTE = BRAND_PALETTES.MARD;
const palList = PALETTE.map(c => ({ code: c.code, rgb: c.rgb }));

// 每格采样：5x5 均匀 25 点，逐点判空白/最近邻色板投票取众数
const BLANK_BG = [241, 244, 249];
function sampleCell(cx, cy) {
  const votes = new Map();
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const x = Math.round(cx + dx * 3), y = Math.round(cy + dy * 3);
    if (x < 0 || y < 0 || x >= m.info.width || y >= m.info.height) continue;
    const [r, g, b] = mPx(x, y);
    const dBlank = Math.sqrt((r - BLANK_BG[0]) ** 2 + (g - BLANK_BG[1]) ** 2 + (b - BLANK_BG[2]) ** 2);
    if (dBlank < 12) { votes.set('__BLANK', (votes.get('__BLANK') || 0) + 1); continue; }
    let bi = -1, bd = Infinity;
    for (let i = 0; i < palList.length; i++) {
      const p = palList[i].rgb;
      const d = (p[0] - r) ** 2 + (p[1] - g) ** 2 + (p[2] - b) ** 2;
      if (d < bd) { bd = d; bi = i; }
    }
    if (bd < 900) votes.set(palList[bi].code, (votes.get(palList[bi].code) || 0) + 1);
  }
  let bk = null, bn = 0, tot = 0;
  for (const [k, n] of votes) { tot += n; if (n > bn) { bn = n; bk = k; } }
  return { code: bk, votes: bn, tot };
}

const manual = []; // manual[r][c] = {code, dist} | null(空白)
let mDistStats = [];
for (let r = 0; r < ROWS; r++) {
  const row = [];
  for (let c = 0; c < COLS; c++) {
    const s = sampleCell(M_OX + (c + 0.5) * M_PITCH, M_OY + (r + 0.5) * M_PITCH);
    if (!s.code || s.code === '__BLANK' || s.votes < 8) { row.push(null); continue; }
    row.push({ code: s.code, conf: s.votes / s.tot });
  }
  manual.push(row);
}
const filledManual = manual.flat().filter(Boolean).length;
const lowConf = manual.flat().filter(e => e && e.conf < 0.6).length;
console.log(`手动图非空格 ${filledManual}（低置信<60%: ${lowConf}）`);

// ---------- 2. 识别管线 ----------
const { recognizeImportImage } = await vite.ssrLoadModule('/src/utils/importRecognition.ts');
const { data, info } = await sharp(ORIG).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
console.log('原图尺寸:', info.width, 'x', info.height, '→ rows估算:', (info.height / 29.54).toFixed(2));
const source = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
const estRows = Math.round(info.height / 29.54);
const cal = { originX: 0, originY: 0, cellWidth: 29.6, cellHeight: 29.54, columns: 52, rows: estRows };
const rRec = recognizeImportImage(source, cal, PALETTE, 'precision', undefined, { mode: 'precision', edgeInsetRatio: 0.1, symbolAssist: true });
console.log('symbolAssist:', JSON.stringify(rRec.symbolAssist));
const rec = rRec.cells;

// ---------- 3. 对比 ----------
const { extractBeadSymbols } = await vite.ssrLoadModule('/src/utils/importSymbolOCR.ts');
const sym = extractBeadSymbols(source, cal, PALETTE);
const ocrCode = new Map(); // "r:c" -> code
for (const [key, s] of sym.codes) { const sep = key.indexOf(':'); ocrCode.set(`${Number(key.slice(0, sep))}:${Number(key.slice(sep + 1))}`, s.code); }
console.log(`OCR resolved 格: ${sym.codes.size}`);

const codeOf = cell => cell?.color ? cell.color.code : null;
let same = 0, diff = 0, bothEmpty = 0, manualEmptyRecFill = 0, manualFillRecEmpty = 0;
const diffRows = [];
const cmpRows = Math.min(ROWS, rec.length);
for (let r = 0; r < cmpRows; r++) for (let c = 0; c < COLS; c++) {
  const mc = manual[r][c]?.code ?? null;
  const rc = codeOf(rec[r][c]);
  if (mc === '?') continue;
  if (mc === null && rc === null) bothEmpty++;
  else if (mc !== null && rc !== null) {
    if (mc === rc) same++;
    else { diff++; diffRows.push([r, c, mc, rc]); }
  } else if (mc === null && rc !== null) manualEmptyRecFill++;
  else manualFillRecEmpty++;
}
const filled = same + diff;
console.log(`\n=== 对比结果 (前 ${cmpRows} 行) ===`);
console.log(`双方均空白: ${bothEmpty}`);
console.log(`双方均非空: ${filled}, 色号一致: ${same} (${(100 * same / filled).toFixed(2)}%), 不一致: ${diff}`);
console.log(`手动空白但识别放豆: ${manualEmptyRecFill}`);
console.log(`手动放豆但识别空白: ${manualFillRecEmpty}`);
// 第 52 行（识别可能没有）
if (ROWS > cmpRows) {
  const last = [];
  for (let c = 0; c < COLS; c++) if (manual[cmpRows]?.[c]) last.push(`c${c + 1}:${manual[cmpRows][c].code}`);
  console.log(`第 ${cmpRows + 1} 行手动非空格: ${last.length}${last.length ? ' → ' + last.join(' ') : ''}`);
}
// 不一致清单（前 60）
console.log(`\n不一致明细 (r,c 1-based | 手动 vs 识别):`);
for (const [r, c, mc, rc] of diffRows.slice(0, 60)) console.log(`  r${r + 1} c${c + 1}: ${mc} vs ${rc}`);
if (diffRows.length > 60) console.log(`  ...共 ${diffRows.length} 处`);

// 错色 ΔE 分布（用色板 rgb）
const rgbOf = code => palList.find(p => p.code === code)?.rgb;
let deSum = 0, deN = 0, bigDe = 0;
const lab = (rgb) => {
  let [r, g, b] = rgb.map(v => { v /= 255; return v > 0.04045 ? ((v + 0.055) / 1.055) ** 2.4 : v / 12.92; });
  const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047, y = r * 0.2126 + g * 0.7152 + b * 0.0722, z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const f = t => t > 0.008856 ? t ** (1 / 3) : 7.787 * t + 16 / 116;
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
};
const deRows = [];
for (const [r, c, mc, rc] of diffRows) {
  const a = rgbOf(mc), b = rgbOf(rc);
  if (!a || !b) continue;
  const la = lab(a), lb = lab(b);
  const de = Math.sqrt((la[0] - lb[0]) ** 2 + (la[1] - lb[1]) ** 2 + (la[2] - lb[2]) ** 2);
  deSum += de; deN++;
  if (de > 12) { bigDe++; deRows.push([r, c, mc, rc, de.toFixed(1)]); }
}
console.log(`\n错色格 ΔE76: 平均 ${(deSum / deN).toFixed(1)}, ΔE>12 (明显色差): ${bigDe}`);
console.log('大色差错格 (前40):');
for (const d of deRows.slice(0, 40)) console.log(`  r${d[0] + 1} c${d[1] + 1}: ${d[2]} vs ${d[3]} (ΔE ${d[4]})`);

// 错色对 Top 排行 + 近邻色占比
const pairCnt = new Map();
for (const [r, c, mc, rc] of diffRows) {
  const key = [mc, rc].sort().join('<->');
  pairCnt.set(key, (pairCnt.get(key) || 0) + 1);
}
const pairs = [...pairCnt.entries()].sort((a, b) => b[1] - a[1]);
console.log(`\n错色对 Top 20:`);
for (const [k, n] of pairs.slice(0, 20)) console.log(`  ${k}: ${n}`);
const nearPairs = pairs.filter(([k]) => {
  const [a, b] = k.split('<->');
  const ra = rgbOf(a), rb = rgbOf(b);
  if (!ra || !rb) return false;
  const la = lab(ra), lb = lab(rb);
  return Math.sqrt((la[0] - lb[0]) ** 2 + (la[1] - lb[1]) ** 2 + (la[2] - lb[2]) ** 2) < 12;
}).reduce((s, [, n]) => s + n, 0);
console.log(`\n错色中同色系近邻 (ΔE<12): ${nearPairs}/${diff} (${(100 * nearPairs / diff).toFixed(1)}%)`);
const mCodes = new Set(manual.flat().filter(Boolean).map(e => e.code));
const rCodes = new Set(rec.flat().map(codeOf).filter(Boolean));
console.log(`色数: 手动 ${mCodes.size} vs 识别 ${rCodes.size}`);
const onlyRec = [...rCodes].filter(c => !mCodes.has(c));
console.log(`识别有而手动没有的色号 (${onlyRec.length}): ${onlyRec.join(' ')}`);

// 错色格 × OCR 命中 交叉分析
let ocrAgreeManual = 0, ocrDisagreeManual = 0, ocrMiss = 0;
const ocrMissList = [], ocrDisList = [];
for (const [r, c, mc, rc] of diffRows) {
  const oc = ocrCode.get(`${r}:${c}`);
  if (oc == null) { ocrMiss++; if (ocrMissList.length < 30) ocrMissList.push([r, c, mc, rc]); }
  else if (oc === mc) { ocrAgreeManual++; if (ocrDisList.length < 20) ocrDisList.push([r, c, mc, rc, 'OCR同手动但识别异']); }
  else { ocrDisagreeManual++; }
}
console.log(`\n错色 ${diff} 格中: OCR=手动(识别却不同) ${ocrAgreeManual}, OCR≠手动 ${ocrDisagreeManual}, OCR未解析 ${ocrMiss}`);
if (ocrAgreeManual > 0) { console.log('OCR同手动但识别不同的格 (前20):'); for (const d of ocrDisList) console.log(`  r${d[0] + 1} c${d[1] + 1}: 手动${d[2]} 识别${d[3]}`); }
// OCR 错读模式：手动 vs OCR 对 top20
const ocrPairCnt = new Map();
for (const [r, c, mc, rc] of diffRows) {
  const oc = ocrCode.get(`${r}:${c}`);
  if (oc == null || oc === mc) continue;
  const key = `${mc} → OCR:${oc} (识别:${rc})`;
  ocrPairCnt.set(key, (ocrPairCnt.get(key) || 0) + 1);
}
const ocrPairs = [...ocrPairCnt.entries()].sort((a, b) => b[1] - a[1]);
console.log(`\nOCR 错读对 Top 25 (手动 → OCR读出):`);
for (const [k, n] of ocrPairs.slice(0, 25)) console.log(`  ${k}: ${n}`);
// 一致格中 OCR 命中率
let agreeOcrHit = 0, agreeOcrSame = 0;
for (let r = 0; r < cmpRows; r++) for (let c = 0; c < COLS; c++) {
  const mc = manual[r][c]?.code, rc = codeOf(rec[r][c]);
  if (!mc || mc === '?' || rc !== mc) continue;
  const oc = ocrCode.get(`${r}:${c}`);
  if (oc != null) { agreeOcrHit++; if (oc === mc) agreeOcrSame++; }
}
console.log(`一致格 ${same} 中 OCR 命中 ${agreeOcrHit}（其中 OCR=该色号 ${agreeOcrSame}）`);

// 保存 JSON 供渲染
writeFileSync(`${OUT}/manual_vs_rec.json`, JSON.stringify({ manual, recCodes: rec.map(row => row.map(c => codeOf(c))), diffs: diffRows, stats: { filled, same, diff, manualEmptyRecFill, manualFillRecEmpty } }));
console.log('\n-> manual_vs_rec.json');
await vite.close();
