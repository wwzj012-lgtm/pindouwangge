type Rgb = [number, number, number];
interface Sample { r: number; g: number; b: number; alpha: number }
interface Run { line: number; start: number; end: number; rgb: Rgb; track: Run[]; links: number }
export interface SourceStructure {
  mask: Uint8Array;
  strokes: Array<{ target: number; rgb: Rgb; footprint: number[] }>;
}

const LINEAR = Float64Array.from({ length: 256 }, (_, value) => {
  const s = value / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
});
function encode(value: number): number {
  return Math.round(255 * (value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055));
}

/** Exact fractional pixel coverage, with premultiplied alpha in linear light. */
export function resizeSourceArea(data: Uint8ClampedArray, width: number, height: number,
  columns: number, rows: number): Uint8ClampedArray {
  const output = new Uint8ClampedArray(columns * rows * 4);
  for (let row = 0; row < rows; row++) {
    const top = row * height / rows, bottom = (row + 1) * height / rows;
    for (let column = 0; column < columns; column++) {
      const left = column * width / columns, right = (column + 1) * width / columns;
      let alpha = 0, red = 0, green = 0, blue = 0;
      for (let y = Math.floor(top); y < Math.ceil(bottom); y++) {
        const vertical = Math.min(y + 1, bottom) - Math.max(y, top);
        for (let x = Math.floor(left); x < Math.ceil(right); x++) {
          const offset = (y * width + x) * 4;
          const weight = vertical * (Math.min(x + 1, right) - Math.max(x, left)) * data[offset + 3];
          alpha += weight;
          red += LINEAR[data[offset]] * weight;
          green += LINEAR[data[offset + 1]] * weight;
          blue += LINEAR[data[offset + 2]] * weight;
        }
      }
      const offset = (row * columns + column) * 4;
      if (alpha > 0) {
        output[offset] = encode(red / alpha);
        output[offset + 1] = encode(green / alpha);
        output[offset + 2] = encode(blue / alpha);
      }
      output[offset + 3] = Math.round(alpha / ((right - left) * (bottom - top)));
    }
  }
  return output;
}

function distance(first: Rgb, second: Rgb): number {
  return Math.max(Math.abs(first[0] - second[0]), Math.abs(first[1] - second[1]), Math.abs(first[2] - second[2]));
}

/** Input alpha regime; hidden RGB never participates in colour selection. */
export function sourceHasTransparency(data: Uint8ClampedArray, pixels: number, minimumMissingArea = 0): boolean {
  let missing = 0;
  for (let i = 0; i < pixels; i++) {
    missing += (255 - data[i * 4 + 3]) / 255;
    if (missing > 0 && missing >= minimumMissingArea) return true;
  }
  return false;
}

/** O(source pixels): mark actual closed white domains surrounded by ink. */
export function enclosedSourceWhite(data: Uint8ClampedArray, width: number, height: number,
  alphaCutoff: number, background: Uint8Array): Uint8Array {
  const total = width * height, state = new Uint8Array(total), output = new Uint8Array(total);
  const queue = new Int32Array(total);
  for (let i = 0; i < total; i++) {
    const o = i * 4, r = data[o], g = data[o + 1], b = data[o + 2];
    if (!background[i] && data[o + 3] >= alphaCutoff && Math.min(r, g, b) >= 242
      && Math.max(r, g, b) - Math.min(r, g, b) <= 12) state[i] = 1;
  }
  for (let seed = 0; seed < total; seed++) {
    if (state[seed] !== 1) continue;
    let end = 1, open = false, boundary = 0, ink = 0, strongInk = 0;
    queue[0] = seed; state[seed] = 2;
    for (let cursor = 0; cursor < end; cursor++) {
      const i = queue[cursor], x = i % width, y = Math.floor(i / width);
      if (!x || !y || x === width - 1 || y === height - 1) open = true;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const next = ny * width + nx, o = next * 4;
        if (state[next] === 1) { state[next] = 2; queue[end++] = next; }
        else if (!state[next]) {
          if (background[next] || data[o + 3] < alphaCutoff) open = true;
          boundary++;
          // Integrate boundary contrast: antialiased pixels are fractional ink,
          // rather than a hard dark/not-dark vote that rejects a closed hole.
          ink += Math.max(0, 242 - (data[o] + data[o + 1] * 2 + data[o + 2]) / 4);
          if ((data[o] + data[o + 1] * 2 + data[o + 2]) / 4 <= 205) strongInk++;
        }
      }
    }
    // Pale paper texture and a broad exterior are not enclosed lettering.
    if (!open && boundary > 0 && ink / boundary >= 18 && strongInk / boundary >= 0.35) {
      for (let cursor = 0; cursor < end; cursor++) output[queue[cursor]] = 1;
    }
  }
  return output;
}

export interface CellColorBin {
  rgb: Rgb;
  weight: number;
  area: number;
  x: number;
  y: number;
  xx: number;
  yy: number;
}
export interface CellForeground { rgb: Rgb; background: Rgb; coverage: number; compact: boolean }

export interface CompactStructureGrayPixel { rgb: Rgb; alpha: number }
export interface CompactStructureGrayEvidence {
  pixels: readonly CompactStructureGrayPixel[];
  cellArea: number;
  neighborColors: readonly (Rgb | null)[];
  existingWhiteCoverage: number;
  existingPrimary?: Rgb | null;
  targetAlpha?: number;
}
export interface CompactStructureGrayOptions {
  enabled?: boolean;
  minCoverage?: number;
  maxColorVariance?: number;
  minNeighborSupport?: number;
  neighborDistance?: number;
}

/** Return a source-backed compact colour layer when local topology supports it. */
export function compactStructureGrayCandidate(
  evidence: CompactStructureGrayEvidence,
  options: CompactStructureGrayOptions = {},
): Rgb | null {
  const {
    enabled = true,
    minCoverage = 0.25,
    maxColorVariance = 0.035,
    minNeighborSupport = 2,
    neighborDistance = 18,
  } = options;
  if (!enabled || evidence.existingWhiteCoverage > 0.5 || evidence.targetAlpha === 0) return null;
  // An established primary color owns this cell; the gray layer must not replace it.
  if (evidence.existingPrimary) return null;
  if (evidence.cellArea <= 0 || evidence.pixels.length === 0) return null;

  let visibleWeight = 0;
  const color: Rgb = [0, 0, 0];
  for (const pixel of evidence.pixels) {
    const weight = Math.max(0, Math.min(255, pixel.alpha)) / 255;
    if (!weight) continue;
    visibleWeight += weight;
    for (let channel = 0; channel < 3; channel++) color[channel] += pixel.rgb[channel] * weight;
  }
  if (visibleWeight / evidence.cellArea < minCoverage) return null;
  for (let channel = 0; channel < 3; channel++) color[channel] /= visibleWeight;

  let variance = 0;
  for (const pixel of evidence.pixels) {
    const weight = Math.max(0, Math.min(255, pixel.alpha)) / 255;
    if (!weight) continue;
    for (let channel = 0; channel < 3; channel++) {
      const delta = pixel.rgb[channel] / 255 - color[channel] / 255;
      variance += weight * delta * delta / 3;
    }
  }
  variance /= visibleWeight;
  if (variance > maxColorVariance) return null;
  const candidatePixel = evidence.pixels.filter(pixel => pixel.alpha > 0).reduce((best, pixel) => {
    const bestDistance = best ? distance(best.rgb, color as Rgb) : Infinity;
    return distance(pixel.rgb, color as Rgb) < bestDistance ? pixel : best;
  }, null as CompactStructureGrayPixel | null);
  if (!candidatePixel) return null;
  const candidate = [...candidatePixel.rgb] as Rgb;
  const support = evidence.neighborColors.filter(neighbor => neighbor
    && distance(neighbor, candidate) <= neighborDistance).length;
  if (support < minNeighborSupport) return null;
  return candidate;
}

/** Histogram bins are storage only: nearby colours share their actual coverage. */
export function clusterCellColors(bins: Iterable<CellColorBin>): CellColorBin[] {
  const groups: CellColorBin[] = [];
  for (const bin of [...bins].sort((a, b) => b.weight - a.weight)) {
    const rgb = bin.rgb.map(v => v / bin.weight) as Rgb;
    const group = groups.find(g => distance(rgb, g.rgb.map(v => v / g.weight) as Rgb) <= 16);
    if (!group) { groups.push({ ...bin, rgb: [...bin.rgb] }); continue; }
    for (let c = 0; c < 3; c++) group.rgb[c] += bin.rgb[c];
    group.weight += bin.weight; group.area += bin.area;
    group.x += bin.x; group.y += bin.y; group.xx += bin.xx; group.yy += bin.yy;
  }
  return groups.sort((a, b) => b.weight - a.weight);
}

/** A candidate describes colour inside this cell, never an instruction to draw elsewhere. */
export function cellForeground(groups: CellColorBin[], total: number): CellForeground | null {
  if (groups.length < 2 || total <= 0) return null;
  const lightness = (rgb: Rgb) => (rgb[0] + rgb[1] * 2 + rgb[2]) / 4;
  const colors = groups.map(g => ({ bin: g, rgb: g.rgb.map(v => v / g.weight) as Rgb }));
  const background = colors.reduce((a, b) => lightness(a.rgb) > lightness(b.rgb) ? a : b);
  // A small bright counter inside dark lettering is not the local background.
  if (background.bin.area / total < 0.35) return null;
  const foreground = colors.filter(g => g.bin.area / total >= 0.15
    && (Math.max(...g.rgb) > 64 || Math.max(...g.rgb) - Math.min(...g.rgb) > 32)
    && lightness(g.rgb) + 8 < lightness(background.rgb) && distance(g.rgb, background.rgb) >= 18)
    .sort((a, b) => b.bin.area - a.bin.area)[0];
  if (!foreground) return null;
  const g = foreground.bin;
  const variance = Math.min(g.xx / g.area - (g.x / g.area) ** 2, g.yy / g.area - (g.y / g.area) ** 2);
  return { rgb: foreground.rgb.map(Math.round) as Rgb, background: background.rgb,
    coverage: g.area / total, compact: variance <= 0.035 };
}

/** Neighbours vote only for candidates already supported inside the current cell. */
export function resolveCellForeground(candidates: Array<CellForeground | null>, samples: Sample[],
  columns: number, rows: number): void {
  const lightness = (rgb: Rgb) => (rgb[0] + rgb[1] * 2 + rgb[2]) / 4;
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i], sample = samples[i];
    if (!candidate || !candidate.compact || candidate.coverage < 0.25 || !sample.alpha) continue;
    const current: Rgb = [sample.r, sample.g, sample.b];
    if (lightness(current) < lightness(candidate.rgb) + 8) continue;
    const x = i % columns, y = Math.floor(i / columns);
    let support = 0, background = 0;
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= columns || ny < 0 || ny >= rows) continue;
      const neighbor = candidates[ny * columns + nx];
      if (neighbor && neighbor.compact && neighbor.coverage >= 0.25 && distance(neighbor.rgb, candidate.rgb) <= 18) support++;
      else background++;
    }
    // Enclosed light holes cannot borrow the surrounding dark ink's support.
    if (support < 2 || background === 0) continue;
    sample.r = candidate.rgb[0]; sample.g = candidate.rgb[1]; sample.b = candidate.rgb[2];
  }
}

/** A work pixel is protected when its real source footprint contains a stroke. */
export function resizeSourceProtection(mask: Uint8Array, width: number, height: number,
  columns: number, rows: number): Uint8Array {
  if (width === columns && height === rows) return mask;
  const output = new Uint8Array(columns * rows);
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
    const left = Math.floor(column * width / columns), right = Math.ceil((column + 1) * width / columns);
    const top = Math.floor(row * height / rows), bottom = Math.ceil((row + 1) * height / rows);
    for (let y = top; y < bottom && !output[row * columns + column]; y++) {
      for (let x = left; x < right; x++) if (mask[y * width + x]) { output[row * columns + column] = 1; break; }
    }
  }
  return output;
}

/**
 * Represent a narrow source-connected coloured/pale stroke once per grid band.
 * Matching flanks distinguish a stroke from a broad fill's ordinary edge.
 * Dark neutral ink is left to the established cartoon ink projector.
 */
export function analyzeSourceStrokes(data: Uint8ClampedArray, width: number, height: number,
  columns: number, rows: number, alphaCutoff: number, background: Uint8Array,
): SourceStructure {
  const structure: SourceStructure = { mask: new Uint8Array(width * height), strokes: [] };
  const scaleX = width / columns, scaleY = height / rows;
  const rgbAt = (index: number): Rgb => [data[index * 4], data[index * 4 + 1], data[index * 4 + 2]];
  const visible = (index: number) => !background[index] && data[index * 4 + 3] >= alphaCutoff;
  for (const axis of [0, 1]) {
    const length = axis === 0 ? width : height, lines = axis === 0 ? height : width;
    const acrossScale = axis === 0 ? scaleX : scaleY, alongScale = axis === 0 ? scaleY : scaleX;
    if (acrossScale <= 1 || alongScale <= 1) continue;
    const radius = Math.max(2, Math.ceil(acrossScale * 0.65));
    const maxWidth = Math.max(2, acrossScale * 0.65), minSupport = Math.max(2, alongScale * 0.6);
    const indexAt = (line: number, position: number) => axis === 0 ? line * width + position : position * width + line;
    const cellAt = (band: number, position: number) => axis === 0 ? band * columns + position : position * columns + band;
    const isStroke = (line: number, position: number): boolean => {
      if (position < radius || position + radius >= length) return false;
      const index = indexAt(line, position), before = indexAt(line, position - radius), after = indexAt(line, position + radius);
      if (!visible(index) || !visible(before) || !visible(after)) return false;
      const rgb = rgbAt(index);
      if (Math.max(...rgb) <= 64 && Math.max(...rgb) - Math.min(...rgb) <= 32) return false;
      const first = rgbAt(before), second = rgbAt(after);
      const contrast = Math.min(distance(rgb, first), distance(rgb, second));
      // Light counters are negative space, not extra strokes to spread over
      // adjacent dark lettering. Pale coloured ink on light paper still has
      // positive local contrast even though it is nowhere near black.
      const lightness = (color: Rgb) => (color[0] + color[1] * 2 + color[2]) / 4;
      return contrast >= 18 && lightness(rgb) + 6 < Math.min(lightness(first), lightness(second))
        && distance(first, second) <= contrast * 0.6;
    };
    const finish = (track: Run[]) => {
      if (track.length < minSupport) return;
      // Keep actual source support, not an expanded rectangle or an invented
      // bridge, available to quantization and denoising before grid sampling.
      for (const run of track) for (let position = run.start; position < run.end; position++) {
        structure.mask[indexAt(run.line, position)] = 1;
      }
      // Allocate representation from the entire connected source track. A
      // one-cell-long dash split 50/50 over two bands still owns one cell;
      // moving it must not independently fail two per-band support thresholds.
      const bands = new Set<number>();
      const count = Math.max(1, Math.round(track.length / alongScale));
      for (let sample = 0; sample < count; sample++) {
        const run = track[Math.min(track.length - 1, Math.floor((sample + 0.5) * track.length / count))];
        bands.add(Math.floor((run.line + 0.5) / alongScale));
      }
      for (let begin = 0; begin < track.length;) {
        const band = Math.floor((track[begin].line + 0.5) / alongScale);
        let end = begin + 1;
        while (end < track.length && Math.floor((track[end].line + 0.5) / alongScale) === band) end++;
        if (bands.has(band)) {
          const rgb: Rgb = [0, 0, 0], footprint = new Set<number>();
          let position = 0;
          for (let i = begin; i < end; i++) {
            const run = track[i];
            position += (run.start + run.end) / 2;
            for (let c = 0; c < 3; c++) rgb[c] += run.rgb[c] / (end - begin);
            for (let p = Math.floor(run.start / acrossScale); p <= Math.floor((run.end - 0.001) / acrossScale); p++) {
              footprint.add(cellAt(band, p));
            }
          }
          // Assign diagonal strokes to just one scan direction.
          const first = track[begin], last = track[end - 1];
          const slope = Math.abs((last.start + last.end - first.start - first.end) / 2)
            / Math.max(1, last.line - first.line) * alongScale / acrossScale;
          const followsAxis = axis === 0 ? slope <= 1 : slope < 1;
          const target = cellAt(band, Math.floor(position / (end - begin) / acrossScale));
          if (followsAxis && footprint.has(target)) {
            structure.strokes.push({ target, rgb: rgb.map(Math.round) as Rgb, footprint: [...footprint] });
          }
        }
        begin = end;
      }
    };
    let previous: Run[] = [];
    for (let line = 0; line <= lines; line++) {
      const current: Run[] = [];
      let start = -1;
      for (let position = 0; line < lines && position <= length; position++) {
        if (position < length && isStroke(line, position)) {
          if (start < 0) start = position;
          continue;
        }
        if (start < 0) continue;
        if (position - start <= maxWidth) {
          current.push({ line, start, end: position, rgb: rgbAt(indexAt(line, Math.floor((start + position) / 2))), track: [], links: 0 });
        }
        start = -1;
      }
      for (const run of previous) run.links = 0;
      const parents = new Map<Run, Run>();
      let first = 0;
      for (const run of current) {
        while (first < previous.length && previous[first].end < run.start) first++;
        for (let i = first; i < previous.length && previous[i].start <= run.end; i++) {
          if (distance(run.rgb, previous[i].rgb) > 18) continue;
          run.links++; previous[i].links++; parents.set(run, previous[i]);
        }
      }
      const continued = new Set<Run[]>();
      for (const run of current) {
        const parent = parents.get(run);
        if (run.links === 1 && parent?.links === 1) { run.track = parent.track; continued.add(run.track); }
        run.track.push(run);
      }
      for (const run of previous) if (!continued.has(run.track)) finish(run.track);
      previous = current;
    }
  }
  return structure;
}

/** Reuse the pre-quantization topology; never overwrite a stronger existing stroke. */
export function projectSourceStrokes(data: Uint8ClampedArray, width: number, height: number,
  columns: number, rows: number, alphaCutoff: number, background: Uint8Array,
  samples: readonly Sample[], analysis?: SourceStructure): Array<Rgb | null> {
  const structure = analysis ?? analyzeSourceStrokes(data, width, height, columns, rows, alphaCutoff, background);
  const output: Array<Rgb | null> = Array(columns * rows).fill(null);
  const lightness = (rgb: Rgb) => (rgb[0] + rgb[1] * 2 + rgb[2]) / 4;
  for (const { target, rgb, footprint } of structure.strokes) {
    const sample = samples[target];
    if (!sample || sample.alpha === 0 || lightness([sample.r, sample.g, sample.b]) + 12 < lightness(rgb)) continue;
    const represented = footprint.some(cell => {
      const existing = samples[cell];
      return output[cell] !== null || existing?.alpha > 0 && distance(rgb, [existing.r, existing.g, existing.b]) <= 12;
    });
    if (!represented) output[target] = rgb;
  }
  return output;
}
