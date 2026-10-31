import { convertImageDataToGrid } from '/src/utils/imagePipeline.ts';
import { imageToGridWithDiagnostics } from '/src/utils/colorUtils.ts';
import { clusterCellColors } from '/src/utils/sourceSampling.ts';

const digest = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(v => v.toString(16).padStart(2, '0')).join('');
const round = value => Math.round(value * 1e6) / 1e6;
const rgb = value => value ? [round(value[0]), round(value[1]), round(value[2])] : null;
const maxDiff = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
const luma = v => (v[0] + 2 * v[1] + v[2]) / 4;
const gray = v => luma(v) >= 32 && luma(v) <= 224 && Math.max(...v) - Math.min(...v) <= 30;
const summarize = (data, width, height, rect, sourceWidth, sourceHeight, sourceAlpha) => {
  const [gx, gy, columns, rows] = rect, left = gx * sourceWidth / columns, right = (gx + 1) * sourceWidth / columns;
  const top = gy * sourceHeight / rows, bottom = (gy + 1) * sourceHeight / rows;
  const bins = new Map(), sum = [0, 0, 0]; let area = 0, grayArea = 0, inkArea = 0;
  for (let y = Math.floor(top); y < Math.ceil(bottom); y++) for (let x = Math.floor(left); x < Math.ceil(right); x++) {
    const o = (y * sourceWidth + x) * 4, alpha = sourceAlpha[o + 3] / 255;
    if (alpha <= 0) continue;
    const weight = (Math.min(y + 1, bottom) - Math.max(y, top)) * (Math.min(x + 1, right) - Math.max(x, left)) * alpha;
    const sampleX = Math.min(width - 1, Math.floor((x + 0.5) * width / sourceWidth));
    const sampleY = Math.min(height - 1, Math.floor((y + 0.5) * height / sourceHeight));
    const q = (sampleY * width + sampleX) * 4, v = [data[q], data[q + 1], data[q + 2]];
    const key = (v[0] >> 4) * 256 + (v[1] >> 4) * 16 + (v[2] >> 4);
    const bin = bins.get(key) || { rgb: [0, 0, 0], area: 0 };
    for (let c = 0; c < 3; c++) { bin.rgb[c] += v[c] * weight; sum[c] += v[c] * weight; }
    bin.area += weight; bins.set(key, bin); area += weight;
    if (gray(v)) grayArea += weight; if (luma(v) < 235) inkArea += weight;
  }
  const topBins = Array.from(bins.values()).sort((a, b) => b.area - a.area).slice(0, 8).map(v => ({
    rgb: v.rgb.map(x => round(x / v.area)), area: round(v.area), coverage: round(v.area / area)
  }));
  return { meanRgb: sum.map(x => round(x / area)), grayCoverage: round(grayArea / area), inkCoverage: round(inkArea / area), topBins };
};
const groupSummary = (bins, total) => clusterCellColors(bins).slice(0, 10).map(b => ({ rgb: b.rgb.map(x => round(x / b.weight)), area: round(b.area), coverage: round(b.area / total), variance: round(Math.min(b.xx / b.area - (b.x / b.area) ** 2, b.yy / b.area - (b.y / b.area) ** 2)) }));
export async function timed({ fixture, settings, palette }) {
  delete globalThis.__QB_STAGE__;
  const image = new Image(); image.src = '/__fixture/' + encodeURIComponent(fixture.file); await image.decode();
  const times = [], hashes = []; let result;
  for (let i = 0; i < 3; i++) {
    const start = performance.now(); result = imageToGridWithDiagnostics(image, settings, palette); times.push(performance.now() - start);
    hashes.push(await digest(new TextEncoder().encode(JSON.stringify(result.grid))));
  }
  return { times, hashes, gridSha256: hashes[0], grid: result.grid, settings, provenance: 'Uninstrumented full-frame HTMLImageElement production entry, fresh context first call plus two warm calls. Excludes decode/import/diagnosis; includes Canvas1200.' };
}
const makeRect = (name, originalRect, naturalWidth, naturalHeight, width, height) => {
  const [x, y, w, h] = originalRect;
  return { name, originalRect, gridRect: [Math.floor(x / naturalWidth * width), Math.floor(y / naturalHeight * height), Math.ceil((x + w) / naturalWidth * width), Math.ceil((y + h) / naturalHeight * height)] };
};
const diagnose = async ({ fixture, settings, palette, rois }) => {
  const image = new Image(); image.src = '/__fixture/' + encodeURIComponent(fixture.file); await image.decode();
  const canvas = document.createElement('canvas'), scale = Math.min(1, 1200 / Math.max(image.naturalWidth, image.naturalHeight));
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  const source = ctx.getImageData(0, 0, canvas.width, canvas.height).data, wanted = new Set();
  const plans = rois.map(r => makeRect(r.name, r.originalRect, image.naturalWidth, image.naturalHeight, settings.width, settings.height));
  for (const r of plans) for (let y = r.gridRect[1]; y < r.gridRect[3]; y++) for (let x = r.gridRect[0]; x < r.gridRect[2]; x++) wanted.add(y * settings.width + x);
  const captures = { cells: new Map(), pixels: {}, grids: {}, pre: null };
  globalThis.__QB_STAGE__ = {
    source(data, width, height) { captures.source = { data, width, height }; },
    preprocess(v) { captures.pre = v; },
    cell(index, v) { if (wanted.has(index)) captures.cells.set(index, { normalRgb: rgb(v.normalRgb), shapeRgb: rgb(v.shapeRgb), centerRgb: rgb(v.centerRgb), sourceWhiteCoverage: round(v.sourceWhiteCoverage), total: round(v.total), valid: round(v.valid), weightedValid: round(v.weightedValid), protectedCounter: v.protectedCounter, candidate: v.candidate, acceptedCandidate: v.acceptedCandidate, sourceGroups: groupSummary(v.original.values(), v.valid), voteGroups: groupSummary(v.dominant.values(), v.valid), sourceBins: Array.from(v.original.values()).sort((a,b) => b.area-a.area).slice(0,8).map(b => ({rgb: b.rgb.map(x => round(x/b.weight)), area: round(b.area)})), voteBins: Array.from(v.dominant.values()).sort((a,b) => b.weight-a.weight).slice(0,8).map(b => ({rgb: b.rgb.map(x => round(x/b.weight)), area: round(b.area), vote: round(b.weight)}))}); },
    pixels(name, values) { captures.pixels[name] = values.map(v => v.alpha ? [v.r, v.g, v.b] : null); },
    grid(name, values) { captures.grids[name] = values.map(row => [...row]); },
  };
  let result; try { result = convertImageDataToGrid(source, canvas.width, canvas.height, settings, palette); } finally { delete globalThis.__QB_STAGE__; }
  if (!captures.source || !captures.pre || captures.cells.size !== wanted.size) throw new Error('incomplete stage capture');
  const paletteMap = new Map(palette.map(c => [c.id, c.rgb]));
  const cells = [];
  for (const index of wanted) {
    const x = index % settings.width, y = Math.floor(index / settings.width), stage = captures.cells.get(index);
    const cell = [x, y, settings.width, settings.height], getPixel = name => captures.pixels[name] ? captures.pixels[name][index] : null;
    const getGrid = name => captures.grids[name] ? { id: captures.grids[name][y][x], rgb: paletteMap.get(captures.grids[name][y][x]) || null } : null;
    const qBefore = summarize(captures.pre.processData, captures.pre.width, captures.pre.height, cell, canvas.width, canvas.height, source);
    const qAfter = summarize(captures.pre.quantizedData, captures.pre.width, captures.pre.height, cell, canvas.width, canvas.height, source);
    const originalSummary = summarize(source, canvas.width, canvas.height, cell, canvas.width, canvas.height, source);
    const denoisedSummary = summarize(captures.pre.denoised, captures.pre.width, captures.pre.height, cell, canvas.width, canvas.height, source);
    const transitions = { changed: 0, grayToWhite: 0, grayToDark: 0, inkToWhite: 0, workInkToWhite: 0, area: 0 };
    const [gx, gy, columns, rows] = cell, left = gx * canvas.width / columns, right = (gx + 1) * canvas.width / columns, top = gy * canvas.height / rows, bottom = (gy + 1) * canvas.height / rows;
    for (let py = Math.floor(top); py < Math.ceil(bottom); py++) for (let px = Math.floor(left); px < Math.ceil(right); px++) {
      const so = (py * canvas.width + px) * 4, a = source[so + 3] / 255; if (!a) continue;
      const w = (Math.min(py + 1, bottom) - Math.max(py, top)) * (Math.min(px + 1, right) - Math.max(px, left)) * a;
      const bx = Math.min(captures.pre.width - 1, Math.floor((px + 0.5) * captures.pre.width / canvas.width)), by = Math.min(captures.pre.height - 1, Math.floor((py + 0.5) * captures.pre.height / canvas.height)), po = (by * captures.pre.width + bx) * 4;
      const before = [captures.pre.processData[po], captures.pre.processData[po + 1], captures.pre.processData[po + 2]], after = [captures.pre.quantizedData[po], captures.pre.quantizedData[po + 1], captures.pre.quantizedData[po + 2]], original = [source[so], source[so + 1], source[so + 2]];
      transitions.area += w; if (maxDiff(before, after) >= 8) transitions.changed += w; if (gray(before) && luma(after) >= 235) transitions.grayToWhite += w; if (gray(before) && luma(after) < 32) transitions.grayToDark += w; if (luma(original) < 235 && luma(after) >= 235) transitions.inkToWhite += w; if (luma(before) < 235 && luma(after) >= 235) transitions.workInkToWhite += w;
    }
    for (const key of ['changed', 'grayToWhite', 'grayToDark', 'inkToWhite', 'workInkToWhite']) transitions[key] = round(transitions[key] / transitions.area);
    if (!originalSummary.meanRgb.every(Number.isFinite) || !qBefore.meanRgb.every(Number.isFinite) || !qAfter.meanRgb.every(Number.isFinite)) throw new Error('non-finite cell areas');
    cells.push({ x, y, originalEnvelope: [round(x * image.naturalWidth / settings.width), round(y * image.naturalHeight / settings.height), round((x + 1) * image.naturalWidth / settings.width), round((y + 1) * image.naturalHeight / settings.height)], source: originalSummary, sampling: stage, workBeforeQuantization: qBefore, workQuantized: qAfter, workDenoised: denoisedSummary, quantizationTransitions: transitions, pixels: Object.fromEntries(Object.entries(captures.pixels).map(([k,v]) => [k, v[index]])), colors: Object.fromEntries(Object.entries(captures.grids).map(([k,v]) => [k, getGrid(k)])) });
  }
  return { sourcePixelSha256: await digest(source), sourceSize: [canvas.width, canvas.height], originalSize: [image.naturalWidth, image.naturalHeight], workSize: [captures.pre.width, captures.pre.height], settings, rois: plans, cells, gridSha256: await digest(new TextEncoder().encode(JSON.stringify(result.grid))), grid: result.grid };
};
export { diagnose };
