// Independent reference metrics. No imports from production conversion code.
const luma = rgb => 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
const linear = v => (v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
function lab(rgb) {
  const [r, g, b] = rgb.map(linear);
  const f = v => v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116;
  const x = f((r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047);
  const y = f(r * 0.2126 + g * 0.7152 + b * 0.0722);
  const z = f((r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

export function referenceGrid(source, size, targetHeight = size) {
  const { data, width, height } = source;
  const cells = Array.from({ length: size * targetHeight }, () => ({ white: [0, 0, 0], black: [0, 0, 0], alpha: 0, ink: 0, weight: 0 }));
  // Exact box-area overlap. Reference is always ORIGINAL RGBA, never converter samples.
  for (let gy = 0; gy < targetHeight; gy++) for (let gx = 0; gx < size; gx++) {
    const c = cells[gy * size + gx], x0 = gx * width / size, x1 = (gx + 1) * width / size, y0 = gy * height / targetHeight, y1 = (gy + 1) * height / targetHeight;
    for (let y = Math.floor(y0); y < Math.ceil(y1); y++) for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
      const weight = Math.max(0, Math.min(x + 1, x1) - Math.max(x, x0)) * Math.max(0, Math.min(y + 1, y1) - Math.max(y, y0));
      const i = (y * width + x) * 4, alpha = data[i + 3] / 255, rgb = [data[i], data[i + 1], data[i + 2]];
      c.weight += weight; c.alpha += alpha * weight;
      for (let k = 0; k < 3; k++) { c.black[k] += rgb[k] * alpha * weight; c.white[k] += (rgb[k] * alpha + 255 * (1 - alpha)) * weight; }
      if (alpha >= 128 / 255 && luma(rgb) < 80) c.ink += weight;
    }
    for (const key of ['white', 'black']) c[key] = c[key].map(v => v / c.weight);
    c.alpha /= c.weight; c.ink /= c.weight;
  }
  return cells;
}

function ssim(a, b, size, height) {
  let sum = 0, windows = 0;
  for (let cy = 0; cy < height; cy += 4) for (let cx = 0; cx < size; cx += 4) {
    let n = 0, sa = 0, sb = 0, aa = 0, bb = 0, ab = 0;
    for (let y = Math.max(0, cy - 3); y <= Math.min(height - 1, cy + 3); y++) for (let x = Math.max(0, cx - 3); x <= Math.min(size - 1, cx + 3); x++) {
      const i = y * size + x; n++; sa += a[i]; sb += b[i]; aa += a[i] ** 2; bb += b[i] ** 2; ab += a[i] * b[i];
    }
    const ma = sa / n, mb = sb / n, va = Math.max(0, aa / n - ma * ma), vb = Math.max(0, bb / n - mb * mb), cov = ab / n - ma * mb;
    sum += ((2 * ma * mb + 6.5025) * (2 * cov + 58.5225)) / ((ma * ma + mb * mb + 6.5025) * (va + vb + 58.5225)); windows++;
  }
  return sum / windows;
}

function edges(values, size, height) {
  const result = new Uint8Array(size * height);
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < size - 1; x++) {
    const i = y * size + x;
    const gx = -values[i - size - 1] + values[i - size + 1] - 2 * values[i - 1] + 2 * values[i + 1] - values[i + size - 1] + values[i + size + 1];
    const gy = -values[i - size - 1] - 2 * values[i - size] - values[i - size + 1] + values[i + size - 1] + 2 * values[i + size] + values[i + size + 1];
    result[i] = Math.hypot(gx, gy) / 4 >= 25 ? 1 : 0;
  }
  return result;
}
function overlap(a, b, size, radius, height = size) {
  let hits = 0, count = 0;
  for (let i = 0; i < a.length; i++) if (a[i]) {
    count++; const x = i % size, y = Math.floor(i / size); let found = false;
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      if (x + dx >= 0 && x + dx < size && y + dy >= 0 && y + dy < height && b[(y + dy) * size + x + dx]) found = true;
    }
    if (found) hits++;
  }
  return count ? hits / count : null;
}
function f1(precision, recall) { return precision === null || recall === null ? null : precision + recall ? 2 * precision * recall / (precision + recall) : 0; }

export function measure(source, grid, palette, { lineProbe = false, colorLimit = 0 } = {}) {
  const height = grid.length, size = grid[0].length, n = size * height, reference = referenceGrid(source, size, height), lookup = new Map(palette.map(c => [c.id, c.rgb]));
  if (grid.some(row => row.length !== size)) throw new Error('Expected rectangular grid');
  const ids = grid.flat(), output = ids.map(id => id === null ? null : lookup.get(id));
  if (output.some((rgb, i) => ids[i] !== null && !rgb)) throw new Error('Unknown palette ID');
  let rgbMAE = 0, deltaE = 0, alphaMAE = 0, alphaIntersection = 0, alphaUnion = 0, bleed = 0, lightnessBias = 0;
  const refLuma = [], outLuma = [], referenceInk = [], outputInk = [];
  for (let i = 0; i < n; i++) {
    const rgb = output[i], a = rgb ? 1 : 0, c = reference[i];
    alphaMAE += Math.abs(c.alpha - a); alphaIntersection += Math.min(c.alpha, a); alphaUnion += Math.max(c.alpha, a);
    if (rgb && c.alpha === 0) bleed++;
    for (const background of ['white', 'black']) {
      const projected = rgb ?? (background === 'white' ? [255, 255, 255] : [0, 0, 0]);
      for (let k = 0; k < 3; k++) rgbMAE += Math.abs(c[background][k] - projected[k]);
      const aLab = lab(c[background]), bLab = lab(projected);
      deltaE += Math.hypot(aLab[0] - bLab[0], aLab[1] - bLab[1], aLab[2] - bLab[2]);
      lightnessBias += bLab[0] - aLab[0];
    }
    refLuma.push(luma(c.white)); outLuma.push(luma(rgb ?? [255, 255, 255]));
    referenceInk.push(c.ink >= 0.04 ? 1 : 0); outputInk.push(rgb && luma(rgb) < 100 ? 1 : 0);
  }
  const refEdges = edges(refLuma, size, height), outEdges = edges(outLuma, size, height);
  const edgePrecision = overlap(outEdges, refEdges, size, 1, height), edgeRecall = overlap(refEdges, outEdges, size, 1, height);
  const seen = new Uint8Array(n); let isolated = 0, smallCells = 0, smallComponents = 0;
  for (let i = 0; i < n; i++) if (!seen[i] && ids[i] !== null) {
    const todo = [i]; seen[i] = 1;
    for (let j = 0; j < todo.length; j++) {
      const p = todo[j], x = p % size, y = Math.floor(p / size);
      for (const q of [x > 0 ? p - 1 : -1, x < size - 1 ? p + 1 : -1, y > 0 ? p - size : -1, y < height - 1 ? p + size : -1]) {
        if (q >= 0 && !seen[q] && ids[q] === ids[i]) { seen[q] = 1; todo.push(q); }
      }
    }
    if (todo.length === 1) isolated++;
    if (todo.length <= 3) { smallComponents++; smallCells += todo.length; }
  }
  const inkPrecision = lineProbe ? overlap(outputInk, referenceInk, size, 0, height) : null;
  const inkRecall = lineProbe ? overlap(referenceInk, outputInk, size, 0, height) : null;
  const usedColors = new Set(ids.filter(id => id !== null)).size;
  return { compositeAreaRgbMAE: rgbMAE / (n * 6), compositeAreaDeltaE76: deltaE / (n * 2), compositeLightnessBias: lightnessBias / (n * 2),
    localLumaSSIMWhite: ssim(refLuma, outLuma, size, height), edgePrecision1Cell: edgePrecision, edgeRecall1Cell: edgeRecall, edgeF1_1Cell: f1(edgePrecision, edgeRecall),
    darkInkPrecision: inkPrecision, darkInkRecall: inkRecall, darkInkF1: f1(inkPrecision, inkRecall),
    alphaMAE: alphaMAE / n, softAlphaIoU: alphaUnion ? alphaIntersection / alphaUnion : 1, opaqueOverFullyTransparent: bleed,
    isolatedCells4: isolated, tinyComponents4: smallComponents, tinyComponentCells4: smallCells, tinyCellRatio: smallCells / n,
    usedColors, transparentCells: ids.filter(id => id === null).length, colorLimitSatisfied: !colorLimit || usedColors <= colorLimit };
}

export const metricDefinitions = {
  compositeAreaRgbMAE: 'Original RGBA exact box-area reference versus grid; mean sRGB MAE on both black and white, 0..255, lower closer. Not an aesthetic score.',
  compositeAreaDeltaE76: 'Independent CIELAB DeltaE76 of original box-area composites vs palette cells on black and white; lower closer. Not CIEDE2000 and not internal pipeline diagnostics.',
  localLumaSSIMWhite: 'Mean local 7x7 luminance SSIM, centers every 4 cells, white composite; higher closer in local structure, not an aesthetic verdict.',
  edgeF1_1Cell: 'Sobel luma magnitude/4 >=25, one-cell Chebyshev matching tolerance; precision and recall both reported; fixed before running.',
  darkInkF1: 'Only designated synthetic text/contour control: original area dark (luma<80, alpha>=128) coverage >=4%, output luma<100. Exact-cell precision/recall/F1; can reward thickening, inspect PNG.',
  tinyComponentCells4: 'Same-ID 4-connected components of size <=3; counts include legitimate eyes, dots, pixel-art details and intended dithering. Lower is not always better.',
  softAlphaIoU: 'Fuzzy min/max overlap of original area alpha and binary output alpha; opaqueOverFullyTransparent counts unsupported filled cells.',
};
