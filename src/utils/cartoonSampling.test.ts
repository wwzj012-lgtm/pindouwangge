import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import type { BeadColor, ConvertSettings } from '../types';
import { convertImageDataToGrid } from './imagePipeline';

const colors: BeadColor[] = [
  ['ink', [16, 16, 16]], ['white', [245, 245, 245]],
  ['fill', [240, 207, 77]], ['near', [235, 202, 73]],
].map(([id, rgb]) => ({ id: id as string, code: id as string, name: id as string,
  rgb: rgb as [number, number, number], hex: '#000000', brand: 'MARD' }));
const settings: ConvertSettings = {
  width: 35, height: 35, keepAspectRatio: true, brand: 'MARD', dither: 'none',
  colorLimit: 0, brightness: 0, contrast: 0, saturation: 0, transparentCutoff: 128,
  boardSize: 29, sharpening: 0, outlineBoost: false, chromaKeyColor: null,
  chromaKeyTolerance: 20, colorMatchAlgo: 'ciede2000', kmeansClustering: true,
  quantizationStrength: 28, pipelineOverride: 'cartoon',
};
function raster(size: number, pixel: (x: number, y: number) => number[]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) data.set([...pixel(x, y), 255], (y * size + x) * 4);
  return data;
}

function darkRegionStats(grid: (string | null)[][], dark: (id: string | null) => boolean,
  bounds: [number, number, number, number]) {
  const [x0, y0, x1, y1] = bounds;
  let cells = 0, squares = 0;
  const widths: number[] = [];
  for (let y = y0; y <= y1; y++) {
    let run = 0, longest = 0;
    for (let x = x0; x <= x1; x++) {
      if (dark(grid[y][x])) {
        cells++; run++; longest = Math.max(longest, run);
        if (x > x0 && y > y0 && dark(grid[y][x - 1]) && dark(grid[y - 1][x]) && dark(grid[y - 1][x - 1])) squares++;
      } else run = 0;
    }
    widths.push(longest);
  }
  return { cells, squares, widths };
}

describe('cartoon source sampling at low resolution', () => {
  it.each([0, 2, 4, 5, 6, 8])('keeps a connected one-cell diagonal at phase %s (031 P1)', (phase) => {
    const data = raster(350, (x, y) => y >= 40 && y < 310 && Math.abs(x - y - phase) <= 1
      ? [16, 16, 16] : [240, 207, 77]);
    const result = convertImageDataToGrid(data, 350, 350, settings, colors);
    let previous = -1;
    for (let y = 5; y < 30; y++) {
      const columns = result.grid[y].flatMap((id, x) => id === 'ink' ? [x] : []);
      expect(columns, `phase ${phase}, row ${y}`).toHaveLength(1);
      if (previous >= 0) expect(Math.abs(columns[0] - previous)).toBeLessThanOrEqual(1);
      previous = columns[0];
    }
    result.grid.forEach((row, y) => expect(row.filter(id => id === 'ink').length,
      `phase ${phase}, endpoint/row ${y}`).toBeLessThanOrEqual(1));
  });
  it.each([false, true])('never promotes unrelated 6%% dark specks, repeat=%s (031 P1)', (repeat) => {
    const dotX = [0, 3, 6, 1, 4, 7];
    const data = raster(350, (x, y) => (repeat || Math.floor(x / 10) === 8 && Math.floor(y / 10) === 8)
      && y % 10 < 6 && x % 10 === dotX[y % 10] ? [16, 16, 16] : [240, 207, 77]);
    const result = convertImageDataToGrid(data, 350, 350, settings, colors);
    expect(result.grid.flat().filter(id => id === 'ink')).toHaveLength(0);
  });
  it('does not widen already represented ink into an adjacent cell (generic P2 topology)', () => {
    // Two source-supported strokes share a sub-cell bright gap; area sampling
    // represents them in column 8. Re-projecting the second must not add column 9.
    const data = raster(350, x => x >= 83 && x < 87 || x >= 89 && x < 93
      ? [16, 16, 16] : [240, 207, 77]);
    const result = convertImageDataToGrid(data, 350, 350, settings, colors);
    for (let y = 1; y < 34; y++) {
      expect(result.grid[y].filter(id => id === 'ink')).toHaveLength(1);
      expect(result.grid[y][8]).toBe('ink');
    }
  });
  it.each([82, 89, 90])('keeps a sub-cell vertical ink stroke once at source x=%s', (lineX) => {
    const data = raster(350, (x, y) => y >= 40 && y < 310 && x >= lineX && x < lineX + 2 ? [16, 16, 16] : [240, 207, 77]);
    const before = data.slice();
    const result = convertImageDataToGrid(data, 350, 350, settings, colors);
    for (let y = 5; y < 30; y++) {
      expect(result.grid[y].filter(id => id === 'ink')).toHaveLength(1);
      expect(result.grid[y][Math.floor((lineX + 1) / 10)]).toBe('ink');
    }
    expect(data).toEqual(before);
  });
  it('keeps one diagonal path, without spreading ink outside intersected source cells', () => {
    const data = raster(350, (x, y) => x >= 40 && x < 310 && Math.abs(x - y) <= 1 ? [16, 16, 16] : [240, 207, 77]);
    const result = convertImageDataToGrid(data, 350, 350, settings, colors);
    for (let i = 5; i < 30; i++) expect(result.grid[i][i]).toBe('ink');
    result.grid.forEach((row, y) => row.forEach((id, x) => { if (id === 'ink') expect(Math.abs(x - y)).toBeLessThanOrEqual(1); }));
  });
  it('stabilizes near-identical flat fills without swallowing antialiased ink', () => {
    const data = raster(350, (x, y) => {
      if (x >= 80 && x < 82) return [16, 16, 16];
      if (x === 79 || x === 82) return [110, 96, 43];
      return (Math.floor(x / 10) + Math.floor(y / 10)) % 2 ? [240, 207, 77] : [235, 202, 73];
    });
    const result = convertImageDataToGrid(data, 350, 350, settings, colors);
    expect(new Set(result.grid.flat().filter(id => id !== 'ink')).size).toBe(1);
    for (let y = 1; y < 34; y++) expect(result.grid[y][8]).toBe('ink');
  });
  it('retains solid dark interiors and a source white eye highlight', () => {
    const data = raster(350, (x, y) => x >= 100 && x < 250 && y >= 100 && y < 250
      ? x >= 160 && x < 180 && y >= 160 && y < 180 ? [245, 245, 245] : [16, 16, 16]
      : [240, 207, 77]);
    const result = convertImageDataToGrid(data, 350, 350, settings, colors);
    expect(result.grid[12].slice(11, 24)).toEqual(Array(13).fill('ink'));
    expect(result.grid[16][16]).toBe('white');
    expect(result.grid[17][17]).toBe('white');
  });
  it('respects background removal and an explicit one-color limit', () => {
    const data = raster(350, (x, y) => x >= 100 && x < 250 && y >= 100 && y < 250 ? [16, 16, 16] : [240, 207, 77]);
    const result = convertImageDataToGrid(data, 350, 350, { ...settings, backgroundRemovalEnabled: true, chromaKeyColor: '#F0CF4D', colorLimit: 1 }, colors);
    expect(result.grid[0][0]).toBeNull();
    expect(new Set(result.grid.flat().filter(Boolean)).size).toBe(1);
    result.grid.forEach((row, y) => row.forEach((id, x) => expect(result.diagnostics.matches[y][x]?.matchedColorId ?? null).toBe(id)));
  });
});

// The copyrighted JPEG stays outside git. The fixture-backed assertion runs
// when local 030 QA artifacts are present; portable synthetic cases above always run.
const evidence = resolve(process.cwd(), '../pindouwangge-change-history/2026-10-15-030-cartoon-quality');
const original = resolve(evidence, 'original.jpg');
const baselineFile = resolve(evidence, 'baseline-cartoon-35.json');
it.runIf(existsSync(original) && existsSync(baselineFile))('does not regress the manual user bag ROI (031 P2)', async () => {
  const require = createRequire(resolve(process.cwd(), 'package.json'));
  const sharp = require('sharp'); // Existing local decoder, no dependency installation.
  const decoded = await sharp(original).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const baseline = JSON.parse(readFileSync(baselineFile, 'utf8'));
  const palette = baseline.palette as BeadColor[];
  const colorMap = new Map(palette.map(color => [color.id, color]));
  const dark = (id: string | null) => id !== null && Math.max(...colorMap.get(id)!.rgb) < 65;
  const result = convertImageDataToGrid(new Uint8ClampedArray(decoded.data), decoded.info.width, decoded.info.height,
    baseline.settings, palette);
  // Manual ROI [472,540,580,830] only in the regression, never in the algorithm.
  const bounds: [number, number, number, number] = [18, 21, 22, 32];
  const before = darkRegionStats(baseline.result.grid, dark, bounds);
  const after = darkRegionStats(result.grid, dark, bounds);
  expect(after.cells).toBeLessThanOrEqual(before.cells);
  expect(after.squares).toBeLessThanOrEqual(before.squares);
  after.widths.forEach((width, row) => expect(width, `ROI row ${row + bounds[1]}`).toBeLessThanOrEqual(before.widths[row]));
});
