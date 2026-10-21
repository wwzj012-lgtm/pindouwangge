import { describe, expect, it } from 'vitest';
import { MARD_PALETTE } from '../data/palettes';
import type { BeadColor } from '../types';
import type { ImportGridCalibration } from './importGridCalibration';
import { recognizeImportImage, recognizeImportImageAsync, recognitionResultToCodeMatrix } from './importRecognition';
import type { ImportImagePixels } from './importRecognition';

const calibration: ImportGridCalibration = {
  originX: 0,
  originY: 0,
  cellWidth: 2,
  cellHeight: 2,
  columns: 2,
  rows: 2,
};

function pixels(rows: Array<Array<[number, number, number, number]>>): Uint8ClampedArray {
  return new Uint8ClampedArray(rows.flatMap(row => row.flatMap(pixel => pixel)));
}

const testPalette: BeadColor[] = [
  { id: 'red', code: 'R', name: 'Red', hex: '#ff0000', rgb: [255, 0, 0], brand: 'CUSTOM' },
  { id: 'blue', code: 'B', name: 'Blue', hex: '#0000ff', rgb: [0, 0, 255], brand: 'CUSTOM' },
];
const areaPalette: BeadColor[] = [
  ...testPalette,
  { id: 'green', code: 'G', name: 'Green', hex: '#00ff00', rgb: [0, 255, 0], brand: 'CUSTOM' },
  { id: 'black', code: 'K', name: 'Black', hex: '#000000', rgb: [0, 0, 0], brand: 'CUSTOM' },
  { id: 'white', code: 'W', name: 'White', hex: '#ffffff', rgb: [255, 255, 255], brand: 'CUSTOM' },
];

type Rgba = [number, number, number, number];
const red: Rgba = [255, 0, 0, 255];
const blue: Rgba = [0, 0, 255, 255];
const green: Rgba = [0, 255, 0, 255];
const black: Rgba = [0, 0, 0, 255];
const white: Rgba = [255, 255, 255, 255];
const transparent: Rgba = [0, 0, 255, 0];

function image(width: number, height: number, pixelAt: (x: number, y: number) => Rgba): ImportImagePixels {
  return { width, height, data: pixels(Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => pixelAt(x, y)))) };
}

function singleCell(source: ImportImagePixels, patch: Partial<ImportGridCalibration> = {}): ImportGridCalibration {
  return { originX: 0, originY: 0, cellWidth: source.width, cellHeight: source.height, columns: 1, rows: 1, ...patch };
}

describe('import recognition', () => {
  it('keeps whole-cell statistics by default and excludes grid borders only when requested', async () => {
    const source = image(10, 10, (x, y) => x === 0 || y === 0 || x === 9 || y === 9 ? black : red);
    const grid = singleCell(source);
    const whole = recognizeImportImage(source, grid, areaPalette, 'precision');
    const inset = recognizeImportImage(source, grid, areaPalette, 'precision', undefined, { edgeInsetRatio: 0.1 });
    expect(whole.cells[0][0].dominantRatio).toBeCloseTo(0.64);
    expect(whole.edgeInsetRatio).toBe(0);
    expect(inset.cells[0][0].colorId).toBe('red');
    expect(inset.cells[0][0].dominantRatio).toBe(1);
    expect(inset.cells[0][0].sampledArea).toBe(64);
    expect(inset.calibration).toEqual(grid);
    expect(await recognizeImportImageAsync(source, grid, areaPalette, 'precision', undefined, { edgeInsetRatio: 0.1 })).toEqual(inset);
  });

  it.each([-1, NaN, Infinity, 0.5])('clamps invalid edge exclusions without reversing or removing a cell (%s)', edgeInsetRatio => {
    const source = image(2, 2, () => red);
    const result = recognizeImportImage(source, singleCell(source), areaPalette, 'precision', undefined, { edgeInsetRatio });
    expect(result.edgeInsetRatio).toBe(edgeInsetRatio === 0.5 ? 0.2 : 0);
    expect(result.cells[0][0].colorId).toBe('red');
    expect(result.cells[0][0].sampledArea).toBeGreaterThan(0);
  });

  it('returns the selected calibrated rows and columns as exact palette codes', () => {
    const result = recognizeImportImage({
      width: 4,
      height: 4,
      data: pixels([
        [[255, 0, 0, 255], [255, 0, 0, 255], [0, 0, 255, 255], [0, 0, 255, 255]],
        [[255, 0, 0, 255], [255, 0, 0, 255], [0, 0, 255, 255], [0, 0, 255, 255]],
        [[255, 0, 0, 255], [255, 0, 0, 255], [0, 0, 255, 255], [0, 0, 255, 255]],
        [[255, 0, 0, 255], [255, 0, 0, 255], [0, 0, 255, 255], [0, 0, 255, 255]],
      ]),
    }, calibration, testPalette, 'fast');

    expect(result.mode).toBe('fast');
    expect(result.summary.mapped).toBe(4);
    expect(result.summary.distinctColors).toBeGreaterThan(1);
    expect(recognitionResultToCodeMatrix(result)).toEqual([['R', 'B'], ['R', 'B']]);
  });

  it('counts every intersecting source pixel and ignores transparent pixels', () => {
    const result = recognizeImportImage({
      width: 4,
      height: 4,
      data: pixels([
        [[255, 0, 0, 255], [255, 0, 0, 255], [0, 0, 0, 0], [0, 0, 0, 0]],
        [[255, 0, 0, 255], [255, 0, 0, 255], [0, 0, 0, 0], [0, 0, 0, 0]],
        [[0, 0, 0, 0], [0, 0, 0, 0], [0, 255, 0, 255], [0, 255, 0, 255]],
        [[0, 0, 0, 0], [0, 0, 0, 0], [0, 255, 0, 255], [0, 255, 0, 255]],
      ]),
    }, calibration, MARD_PALETTE, 'precision');

    expect(result.cells[0][0].sampleCount).toBe(4);
    expect(result.cells[0][0].coverage).toBe(4);
    expect(result.cells[0][1].status).toBe('blank');
    expect(result.cells[1][0].status).toBe('blank');
    expect(result.cells[1][1].status).toBe('mapped');
    expect(result.summary.blank).toBe(2);
  });

  it('marks invalid source data explicitly', () => {
    const result = recognizeImportImage({ width: 0, height: 0, data: new Uint8ClampedArray() }, calibration, MARD_PALETTE, 'fast');
    expect(result.summary.invalid).toBe(4);
    expect(result.summary.blank).toBe(0);
    expect(recognitionResultToCodeMatrix(result)).toEqual([['', ''], ['', '']]);
  });

  it('does not modify the caller-owned calibration or source pixels', () => {
    const source = {
      width: 4,
      height: 4,
      data: pixels(Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => [255, 0, 0, 255] as [number, number, number, number]))),
    };
    const originalPixels = source.data.slice();
    const originalCalibration = { ...calibration };

    recognizeImportImage(source, calibration, testPalette, 'precision');

    expect(source.data).toEqual(originalPixels);
    expect(calibration).toEqual(originalCalibration);
  });

  it('votes for a real palette color instead of mapping an anti-aliased edge average', () => {
    const image = Array.from({ length: 10 }, () => Array.from({ length: 10 }, () => [255, 0, 0, 255] as [number, number, number, number]));
    for (const [x, y] of [[5, 5], [3, 5]]) image[y][x] = [90, 0, 165, 255];
    const grid = { ...calibration, columns: 1, rows: 1, cellWidth: 10, cellHeight: 10 };
    const result = recognizeImportImage({ width: 10, height: 10, data: pixels(image) }, grid, testPalette, 'fast');

    expect(result.cells[0][0].colorId).toBe('red');
    expect(result.cells[0][0].sampleRgb).toEqual([255, 0, 0]);
    expect(result.cells[0][0].confidence).toBeGreaterThan(0.9);
    expect(result.cells[0][0].confidence).toBeLessThanOrEqual(1);
    expect(result.cells[0][0].quality).toBe('good');
    expect(result.summary.quality).toBe('good');
  });

  it('does not mistake the contaminated old center cross for the whole cell', () => {
    const image = Array.from({ length: 10 }, () => Array.from({ length: 10 }, () => [255, 0, 0, 255] as [number, number, number, number]));
    for (const [x, y] of [[5, 5], [3, 5], [6, 5]]) image[y][x] = [0, 0, 255, 255];
    const grid = { ...calibration, columns: 1, rows: 1, cellWidth: 10, cellHeight: 10 };
    const source = { width: 10, height: 10, data: pixels(image) };
    const fast = recognizeImportImage(source, grid, testPalette, 'fast').cells[0][0];
    const precision = recognizeImportImage(source, grid, testPalette, 'precision').cells[0][0];

    expect(fast.colorId).toBe('red');
    expect(precision.colorId).toBe('red');
    expect(precision.sampleCount).toBe(100);
    expect(precision.dominantRatio).toBeCloseTo(0.97);
    expect(precision.runnerUpRatio).toBeCloseTo(0.03);
  });

  it('keeps opaque backgrounds mapped and reports transparent-only cells as blank', () => {
    const result = recognizeImportImage({
      width: 2,
      height: 2,
      data: pixels([
        [[255, 0, 0, 255], [255, 0, 0, 255]],
        [[255, 0, 0, 255], [255, 0, 0, 255]],
      ]),
    }, { ...calibration, columns: 1, rows: 1, cellWidth: 2, cellHeight: 2 }, testPalette, 'precision');
    expect(result.cells[0][0].status).toBe('mapped');
    expect(result.cells[0][0].colorId).toBe('red');
  });

  it('recognizes the area majority even when every old precision probe has the wrong color', () => {
    // The former 5x5 midpoint probes all land on odd pixel coordinates.
    // Blue owns 25 square pixels, red the other 75, including all cell edges.
    const source = image(10, 10, (x, y) => x % 2 === 1 && y % 2 === 1 ? blue : red);
    const cell = recognizeImportImage(source, singleCell(source), testPalette, 'precision').cells[0][0];
    expect(cell.colorId).toBe('red');
    expect(cell.sampleCount).toBe(100);
    expect(cell.coverage).toBe(100);
    expect(cell.dominantRatio).toBeCloseTo(0.75);
    expect(cell.runnerUpRatio).toBeCloseTo(0.25);
  });

  it.each(['fast', 'precision'] as const)('covers the entire cell rather than a contaminated center in %s mode', mode => {
    const source = image(20, 20, (x, y) => x >= 7 && x < 13 && y >= 7 && y < 13 ? blue : red);
    const cell = recognizeImportImage(source, singleCell(source), testPalette, mode).cells[0][0];
    expect(cell.colorId).toBe('red');
    expect(cell.dominantRatio).toBeGreaterThan(0.8);
    expect(cell.dominantRatio).toBeLessThan(1);
    if (mode === 'precision') {
      expect(cell.dominantRatio).toBeCloseTo(364 / 400);
      expect(cell.runnerUpRatio).toBeCloseTo(36 / 400);
    }
  });

  it('reports a 60/40 area split as dominance, not accuracy', () => {
    const source = image(10, 10, x => x < 6 ? red : blue);
    const result = recognizeImportImage(source, singleCell(source), testPalette, 'precision');
    const cell = result.cells[0][0];
    expect(cell.colorId).toBe('red');
    expect(cell.dominantRatio).toBeCloseTo(0.6);
    expect(cell.runnerUpRatio).toBeCloseTo(0.4);
    expect(cell.confidence).toBe(cell.dominantRatio);
    expect(cell.quality).toBe('fair');
    expect(result.summary.meanConfidence).toBe(cell.dominantRatio);
  });

  it('selects a three-color plurality even without an absolute majority', () => {
    const source = image(10, 10, x => x < 4 ? red : x < 7 ? blue : green);
    const cell = recognizeImportImage(source, singleCell(source), areaPalette, 'precision').cells[0][0];
    expect(cell.colorId).toBe('red');
    expect(cell.dominantRatio).toBeCloseTo(0.4);
    expect(cell.runnerUpRatio).toBeCloseTo(0.3);
    expect(cell.quality).toBe('poor');
  });

  it('groups perceptually near red shades before comparing them with the blue region', () => {
    // No individual red RGB value exceeds the 40% blue region.
    const source = image(10, 10, x => x < 3 ? red : x < 6 ? [250, 5, 5, 255] : blue);
    const cell = recognizeImportImage(source, singleCell(source), testPalette, 'precision').cells[0][0];
    expect(cell.colorId).toBe('red');
    expect(cell.dominantRatio).toBeCloseTo(0.6);
    expect(cell.runnerUpRatio).toBeCloseTo(0.4);
    expect(cell.sampleRgb).toEqual([253, 3, 3]);
  });

  it('keeps gridline and text minorities from replacing the cell fill', () => {
    const source = image(10, 10, (x, y) => {
      const border = x === 0 || y === 0 || x === 9 || y === 9;
      const label = x === 4 && y >= 3 && y < 7;
      return border || label ? black : red;
    });
    const cell = recognizeImportImage(source, singleCell(source), areaPalette, 'precision').cells[0][0];
    expect(cell.colorId).toBe('red');
    expect(cell.dominantRatio).toBeCloseTo(0.6);
    expect(cell.runnerUpRatio).toBeCloseTo(0.4);
    expect(cell.coverage).toBe(100);
  });

  it('includes the whole cell even when its edges, not its center, hold the majority', () => {
    const source = image(10, 10, (x, y) => x < 2 || x >= 8 || y < 2 || y >= 8 ? red : blue);
    const cell = recognizeImportImage(source, singleCell(source), testPalette, 'precision').cells[0][0];
    expect(cell.colorId).toBe('red');
    expect(cell.dominantRatio).toBeCloseTo(0.64);
    expect(cell.runnerUpRatio).toBeCloseTo(0.36);
  });

  it('weights fractional pixel intersections in both dimensions instead of counting equal votes', () => {
    const source = image(2, 2, (x, y) => x === 1 && y === 1 ? blue : red);
    // Cell [0.75,2] x [0.75,2]: blue area 1; the other 3 overlaps total 0.5625.
    const grid = singleCell(source, { originX: 0.75, originY: 0.75, cellWidth: 1.25, cellHeight: 1.25 });
    const cell = recognizeImportImage(source, grid, testPalette, 'precision').cells[0][0];
    expect(cell.colorId).toBe('blue');
    expect(cell.coverage).toBe(1.5625);
    expect(cell.sampledArea).toBe(1.5625);
    expect(cell.sampleCount).toBe(4);
    expect(cell.dominantRatio).toBeCloseTo(1 / 1.5625);
    expect(cell.runnerUpRatio).toBeCloseTo(0.5625 / 1.5625);
  });

  it('shares boundary pixels geometrically between adjacent fractional cells', () => {
    const source = image(3, 1, x => x === 1 ? blue : red);
    const grid = singleCell(source, { cellWidth: 1.5, columns: 2 });
    const result = recognizeImportImage(source, grid, testPalette, 'precision');
    expect(recognitionResultToCodeMatrix(result)).toEqual([['R', 'R']]);
    for (const cell of result.cells[0]) {
      expect(cell.coverage).toBe(1.5);
      expect(cell.dominantRatio).toBeCloseTo(2 / 3);
      expect(cell.runnerUpRatio).toBeCloseTo(1 / 3);
      expect(cell.sampleCount).toBe(2);
    }
  });

  it.each(['fast', 'precision'] as const)('clips partial source overlap without adding border area in %s mode', mode => {
    const source = image(2, 1, x => x === 0 ? red : blue);
    const grid = singleCell(source, { originX: -3, cellWidth: 5 });
    const cell = recognizeImportImage(source, grid, testPalette, mode).cells[0][0];
    expect(cell.status).toBe('mapped');
    expect(cell.coverage).toBe(2);
    expect(cell.sampledArea).toBe(2);
    expect(cell.dominantRatio).toBe(0.5);
    expect(cell.runnerUpRatio).toBe(0.5);
  });

  it('clips fractional overlap on the bottom and right source edges', () => {
    const source = image(2, 2, () => red);
    const grid = singleCell(source, { originX: 1.75, originY: 1.5, cellWidth: 2, cellHeight: 2 });
    const cell = recognizeImportImage(source, grid, testPalette, 'precision').cells[0][0];
    expect(cell.sampledArea).toBe(0.125);
    expect(cell.coverage).toBe(0.125);
    expect(cell.sampleCount).toBe(1);
    expect(cell.dominantRatio).toBe(1);
    expect(cell.runnerUpRatio).toBe(0);
  });

  it.each(['fast', 'precision'] as const)('marks wholly out-of-source cells invalid on every side in %s mode', mode => {
    const source = image(2, 2, () => red);
    for (const patch of [{ originX: -2 }, { originY: -2 }, { originX: 2 }, { originY: 2 }]) {
      const cell = recognizeImportImage(source, singleCell(source, patch), testPalette, mode).cells[0][0];
      expect(cell.status).toBe('invalid');
      expect(cell.color).toBeNull();
      expect(cell.coverage).toBe(0);
      expect(cell.sampleCount).toBe(0);
      expect(cell.dominantRatio).toBeNull();
    }
  });

  it.each(['fast', 'precision'] as const)('keeps opaque white and opaque background cells in %s mode', mode => {
    const source = image(4, 2, x => x < 2 ? white : black);
    const result = recognizeImportImage(source, { ...calibration, rows: 1 }, areaPalette, mode);
    expect(recognitionResultToCodeMatrix(result)).toEqual([['W', 'K']]);
    for (const cell of result.cells[0]) {
      expect(cell.status).toBe('mapped');
      expect(cell.coverage).toBe(4);
      expect(cell.dominantRatio).toBe(1);
    }
  });

  it.each(['fast', 'precision'] as const)('reports transparent-only source overlap as blank in %s mode', mode => {
    const source = image(2, 2, () => transparent);
    const cell = recognizeImportImage(source, singleCell(source), testPalette, mode).cells[0][0];
    expect(cell.status).toBe('blank');
    expect(cell.colorId).toBeNull();
    expect(cell.sampledArea).toBe(4);
    expect(cell.coverage).toBe(0);
    expect(cell.sampleCount).toBe(0);
    expect(cell.dominantRatio).toBeNull();
    expect(cell.runnerUpRatio).toBeNull();
    expect(cell.confidence).toBeNull();
  });

  it('excludes transparency from the area denominator and applies alpha cutoff without alpha weighting', () => {
    const source = image(5, 1, x => [
      transparent, [255, 0, 0, 23], [255, 0, 0, 24], blue, red,
    ][x] as Rgba);
    const cell = recognizeImportImage(source, singleCell(source), testPalette, 'precision').cells[0][0];
    expect(cell.colorId).toBe('red');
    expect(cell.sampledArea).toBe(5);
    expect(cell.coverage).toBe(3);
    expect(cell.sampleCount).toBe(3);
    expect(cell.dominantRatio).toBeCloseTo(2 / 3);
    expect(cell.runnerUpRatio).toBeCloseTo(1 / 3);
    // A cutoff of zero must still not count fully transparent RGB.
    const zeroCutoff = recognizeImportImage(image(1, 1, () => transparent),
      { ...calibration, rows: 1, columns: 1 }, testPalette, 'precision', 0);
    expect(zeroCutoff.cells[0][0].status).toBe('blank');
  });

  it('weights fractional transparency using only visible overlap', () => {
    const source = image(3, 1, x => x === 0 ? red : x === 1 ? transparent : blue);
    const cell = recognizeImportImage(source, singleCell(source, { originX: 0.5, cellWidth: 2.5 }),
      testPalette, 'precision').cells[0][0];
    expect(cell.colorId).toBe('blue');
    expect(cell.coverage).toBe(1.5);
    expect(cell.sampledArea).toBe(2.5);
    expect(cell.sampleCount).toBe(2);
    expect(cell.dominantRatio).toBeCloseTo(2 / 3);
  });

  it('estimates distributed full-cell coverage in fast mode rather than claiming exact ratios', () => {
    const source = image(100, 100, x => x < 60 ? red : blue);
    const exact = recognizeImportImage(source, singleCell(source), testPalette, 'precision').cells[0][0];
    const fast = recognizeImportImage(source, singleCell(source), testPalette, 'fast').cells[0][0];
    expect(fast.colorId).toBe('red');
    expect(Math.abs(fast.dominantRatio! - exact.dominantRatio!)).toBeLessThan(0.1);
    expect(Math.abs(fast.runnerUpRatio! - exact.runnerUpRatio!)).toBeLessThan(0.1);
    expect(fast.sampleCount).toBeLessThan(exact.sampleCount);
    expect(fast.coverage).toBeCloseTo(exact.coverage);
  });

  it.each(['fast', 'precision'] as const)('returns invalid cells for empty or disabled palettes in %s mode', mode => {
    const source = image(2, 2, () => red);
    for (const palette of [[], testPalette.map(color => ({ ...color, enabled: false }))]) {
      expect(recognizeImportImage(source, singleCell(source), palette, mode).cells[0][0].status).toBe('invalid');
    }
  });

  it.each(['fast', 'precision'] as const)('keeps async %s results identical to sync recognition', async mode => {
    const source = {
      width: 4,
      height: 4,
      data: pixels([
        [[255, 0, 0, 255], [255, 0, 0, 255], [0, 0, 255, 255], [0, 0, 255, 255]],
        [[255, 0, 0, 255], [255, 0, 0, 255], [0, 0, 255, 255], [0, 0, 255, 255]],
        [[0, 0, 0, 0], [0, 0, 0, 0], [0, 255, 0, 255], [0, 255, 0, 255]],
        [[0, 0, 0, 0], [0, 0, 0, 0], [0, 255, 0, 255], [0, 255, 0, 255]],
      ]),
    };
    const progress: number[] = [];
    const asyncResult = await recognizeImportImageAsync(source, calibration, testPalette, mode, undefined, {
      batchSize: 1,
      onProgress: value => progress.push(value),
    });

    expect(asyncResult).toEqual(recognizeImportImage(source, calibration, testPalette, mode));
    expect(progress[0]).toBe(0);
    expect(progress.at(-1)).toBe(100);
    expect(progress.some(value => value > 0 && value < 100)).toBe(true);
    expect(progress.every((value, index) => index === 0 || value >= progress[index - 1])).toBe(true);
    expect(progress.every(value => value >= 0 && value <= 100)).toBe(true);
  });

  it('yields repeatedly while recognizing a 312 by 312 precision grid', async () => {
    const width = 312;
    const data = new Uint8ClampedArray(width * width * 4);
    for (let offset = 0; offset < data.length; offset += 4) {
      data[offset] = 255;
      data[offset + 3] = 255;
    }
    const grid = { originX: 0, originY: 0, cellWidth: 1, cellHeight: 1, columns: width, rows: width };
    const progress: number[] = [];
    let eventLoopTicks = 0;
    const ticker = setInterval(() => { eventLoopTicks += 1; }, 0);
    try {
      const result = await recognizeImportImageAsync({ width, height: width, data }, grid, testPalette, 'precision', undefined, {
        onProgress: value => progress.push(value),
      });
      expect(result.summary.total).toBe(width * width);
    } finally {
      clearInterval(ticker);
    }

    expect(eventLoopTicks).toBeGreaterThan(10);
    expect(progress[0]).toBe(0);
    expect(progress.at(-1)).toBe(100);
    expect(progress.every((value, index) => index === 0 || value >= progress[index - 1])).toBe(true);
  }, 15000);

  it('stops on abort without reporting completion', async () => {
    const controller = new AbortController();
    const progress: number[] = [];
    await expect(recognizeImportImageAsync({
      width: 4,
      height: 4,
      data: pixels(Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => [255, 0, 0, 255] as [number, number, number, number]))),
    }, calibration, testPalette, 'precision', undefined, {
      batchSize: 1,
      signal: controller.signal,
      onProgress: value => {
        progress.push(value);
        if (value > 0) controller.abort();
      },
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(progress).not.toContain(100);
  });

  it.each(['fast', 'precision'] as const)('keeps async %s parity with fractional, clipped, transparent and invalid cells', async mode => {
    const source = image(5, 3, (x, y) => x === 1 ? transparent : y === 0 ? red : blue);
    const grid = singleCell(source, { originX: -0.25, originY: -0.5, cellWidth: 2.25, cellHeight: 1.25, columns: 4, rows: 4 });
    const result = await recognizeImportImageAsync(source, grid, testPalette, mode);
    expect(result).toEqual(recognizeImportImage(source, grid, testPalette, mode));
    expect(result.summary.invalid).toBeGreaterThan(0);
  });

  it('yields and reports progress inside a single large precision cell', async () => {
    const source = image(256, 256, x => x < 160 ? red : blue);
    const grid = singleCell(source);
    const progress: number[] = [];
    let eventLoopTicks = 0;
    const ticker = setInterval(() => { eventLoopTicks += 1; }, 0);
    try {
      const result = await recognizeImportImageAsync(source, grid, testPalette, 'precision', undefined, {
        batchSize: 10000,
        onProgress: value => progress.push(value),
      });
      expect(result).toEqual(recognizeImportImage(source, grid, testPalette, 'precision'));
    } finally {
      clearInterval(ticker);
    }
    expect(eventLoopTicks).toBeGreaterThan(2);
    expect(progress.filter(value => value > 0 && value < 50).length).toBeGreaterThan(2);
    expect(progress[0]).toBe(0);
    expect(progress.at(-1)).toBe(100);
    expect(progress.every((value, index) => index === 0 || value >= progress[index - 1])).toBe(true);
  });

  it('allows a UI timer to abort within a single large cell before completion', async () => {
    const controller = new AbortController();
    const source = image(512, 512, () => red);
    const progress: number[] = [];
    const pending = recognizeImportImageAsync(source, singleCell(source), testPalette, 'precision', undefined, {
      batchSize: 10000,
      signal: controller.signal,
      onProgress: value => progress.push(value),
    });
    const timer = setTimeout(() => controller.abort(), 0);
    try {
      await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    } finally {
      clearTimeout(timer);
    }
    expect(progress.some(value => value > 0 && value < 50)).toBe(true);
    expect(progress).not.toContain(100);
  });

  it('also yields and honors abort while classifying many distinct pixel colors', async () => {
    const controller = new AbortController();
    const source = image(128, 128, (x, y) => [x, y, (x + y) % 256, 255]);
    const progress: number[] = [];
    await expect(recognizeImportImageAsync(source, singleCell(source), areaPalette, 'precision', undefined, {
      signal: controller.signal,
      onProgress: value => {
        progress.push(value);
        if (value > 50) controller.abort();
      },
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(progress.some(value => value > 50 && value < 99)).toBe(true);
    expect(progress).not.toContain(100);
  });

  it('does no recognition work for an already aborted request', async () => {
    const controller = new AbortController();
    controller.abort();
    const progress: number[] = [];
    const source = image(2, 2, () => red);
    await expect(recognizeImportImageAsync(source, singleCell(source), testPalette, 'precision', undefined, {
      signal: controller.signal,
      onProgress: value => progress.push(value),
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(progress).toEqual([]);
  });

  it('keeps async invalid-source results and completion progress consistent', async () => {
    const source = { width: 0, height: 0, data: new Uint8ClampedArray() };
    const progress: number[] = [];
    const result = await recognizeImportImageAsync(source, calibration, testPalette, 'precision', undefined, {
      onProgress: value => progress.push(value),
    });
    expect(result).toEqual(recognizeImportImage(source, calibration, testPalette, 'precision'));
    expect(progress).toEqual([0, 100]);
  });

});
