import { describe, expect, it } from 'vitest';
import type { BeadColor, ConvertSettings } from '../types';
import { convertImageDataToGrid } from './imagePipeline';
import {
  resizeSourceArea, projectSourceStrokes, enclosedSourceWhite,
  compactStructureGrayCandidate,
} from './sourceSampling';

const palette: BeadColor[] = [
  ['white', [255, 255, 255]], ['lavender', [208, 194, 220]],
  ['gold', [228, 185, 100]], ['ink', [16, 16, 16]],
].map(([id, rgb]) => ({ id: id as string, code: id as string, name: id as string,
  hex: '#000000', rgb: rgb as [number, number, number], brand: 'MARD' }));
const settings: ConvertSettings = {
  width: 10, height: 10, brand: 'MARD', keepAspectRatio: true, dither: 'none',
  colorLimit: 0, brightness: 0, contrast: 0, saturation: 0, transparentCutoff: 128,
  boardSize: 29, colorMatchAlgo: 'ciede2000', sharpening: 40, outlineBoost: false,
  chromaKeyColor: null, chromaKeyTolerance: 20, backgroundRemovalEnabled: false,
  kmeansClustering: true, quantizationStrength: 28, pipelineOverride: 'logo',
};
function image(pixel: (x: number, y: number) => number[]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(100 * 100 * 4);
  for (let y = 0; y < 100; y++) for (let x = 0; x < 100; x++) {
    data.set([...pixel(x, y), 255], (y * 100 + x) * 4);
  }
  return data;
}

describe('cell-supported colour selection and diagnostic guards', () => {
  it.each(['logo', 'cartoon'] as const)('%s does not reactivate rejected pale-line projection at any phase', mode => {
    for (const horizontal of [false, true]) for (let phase = 0; phase < 10; phase++) {
      const data = image((x, y) => {
        const across = horizontal ? y : x, along = horizontal ? x : y;
        return across >= 43 && across < 46 && along >= 20 + phase && along < 30 + phase
          ? [208, 194, 220] : [255, 255, 255];
      });
      const result = convertImageDataToGrid(data, 100, 100, { ...settings, pipelineOverride: mode }, palette);
      expect(result.grid.flat(), mode + ' phase ' + phase).not.toContain('lavender');
    }
  });
  it.each(['logo', 'cartoon'] as const)('%s preserves narrow white slits and genuinely wide counters', mode => {
    const purple: [number, number, number] = [136, 114, 148];
    const textPalette = [...palette, { ...palette[1], id: 'purple', code: 'purple', rgb: purple }];
    for (const horizontal of [false, true]) {
      const data = image((x, y) => {
        const across = horizontal ? y : x, along = horizontal ? x : y;
        return across >= 43 && across < 46 && along >= 20 && along < 80 ? [255, 255, 255] : purple;
      });
      const samples = Array.from({ length: 100 }, () => ({ r: purple[0], g: purple[1], b: purple[2], alpha: 255 }));
      expect(projectSourceStrokes(data, 100, 100, 10, 10, 128, new Uint8Array(10000), samples).every(c => c === null)).toBe(true);
      const result = convertImageDataToGrid(data, 100, 100, { ...settings, pipelineOverride: mode, sharpening: 40 }, textPalette);
      for (let along = 2; along < 8; along++) expect(result.grid[horizontal ? 4 : along][horizontal ? along : 4]).toBe('purple');
    }
    // A real counter with enough source coverage must still remain open.
    const counter = image((x, y) => x >= 30 && x < 60 && y >= 30 && y < 60 ? [255, 255, 255] : purple);
    const result = convertImageDataToGrid(counter, 100, 100, { ...settings, pipelineOverride: mode }, textPalette);
    for (let y = 3; y < 6; y++) expect(result.grid[y].slice(3, 6)).toEqual(Array(3).fill('white'));
  });

  it.each(['logo', 'cartoon'] as const)('%s preserves black ink where a pale stroke crosses it', mode => {
    const data = image((x, y) => {
      if (y >= 43 && y < 46 && x >= 10 && x < 90) return [16, 16, 16];
      return x >= 43 && x < 46 && y >= 10 && y < 90 ? [208, 194, 220] : [255, 255, 255];
    });
    const result = convertImageDataToGrid(data, 100, 100, { ...settings, pipelineOverride: mode }, palette);
    expect(result.grid[4][4]).toBe('ink');
    expect(result.grid[4][3]).toBe('ink');
    const samples = Array.from({ length: 100 }, () => ({ r: 255, g: 255, b: 255, alpha: 255 }));
    samples[44] = { r: 16, g: 16, b: 16, alpha: 255 };
    const strokes = projectSourceStrokes(data, 100, 100, 10, 10, 128, new Uint8Array(10000), samples);
    expect(strokes[44]).toBeNull();
  });

  it('does not promote scattered specks or invent line colour in photo mode', () => {
    const specks = image((x, y) => x % 10 === y % 3 && y % 10 < 3
      ? [208, 194, 220] : [255, 255, 255]);
    expect(convertImageDataToGrid(specks, 100, 100, settings, palette).grid.flat()).not.toContain('lavender');
    const line = image((x, y) => x >= 43 && x < 46 && y >= 10 && y < 90
      ? [208, 194, 220] : [255, 255, 255]);
    const photo = convertImageDataToGrid(line, 100, 100, { ...settings, pipelineOverride: 'photo' }, palette);
    expect(photo.grid[4][4]).toBe('white');
  });

  it('respects invisible strokes, explicit colour budgets and input immutability', () => {
    const data = image((x, y) => x >= 43 && x < 46 ? [208, 194, 220] : [255, 255, 255]);
    for (let y = 0; y < 100; y++) for (let x = 43; x < 46; x++) data[(y * 100 + x) * 4 + 3] = 0;
    const before = data.slice();
    const result = convertImageDataToGrid(data, 100, 100, { ...settings, colorLimit: 1 }, palette);
    expect(new Set(result.grid.flat().filter(Boolean)).size).toBe(1);
    expect(result.grid.flat()).not.toContain('lavender');
    expect(data).toEqual(before);
  });

  it.each(['logo', 'cartoon'] as const)('%s aggregates a half-cell source line across RGB-bin boundaries', mode => {
    const twoPurples: [number, number, number][] = [[195, 178, 206], [193, 180, 203]];
    const linePalette = [...palette, { ...palette[1], id: 'purple', code: 'purple', rgb: twoPurples[0] }];
    const data = image((x, y) => y >= 30 && y < 35 && x >= 10 && x < 90 ? twoPurples[x % 2] : [255, 255, 255]);
    const result = convertImageDataToGrid(data, 100, 100, { ...settings, pipelineOverride: mode }, linePalette);
    for (let x = 2; x < 8; x++) expect(result.grid[3][x]).toBe('purple');
    expect(result.grid[2].every(id => id === 'white')).toBe(true);
    expect(result.grid[4].every(id => id === 'white')).toBe(true);
  });

  it('logo aggregation does not fill a source white centre surrounded by split-colour lettering', () => {
    const purple: [number, number, number] = [144, 128, 160];
    const textPalette = [...palette, { ...palette[1], id: 'purple', code: 'purple', rgb: purple }];
    const data = image((x, y) => x >= 33 && x < 37 && y >= 33 && y < 37 ? [255, 255, 255]
      : [x & 1 ? 148 : 140, y & 1 ? 132 : 124, x & 2 ? 164 : 156]);
    const result = convertImageDataToGrid(data, 100, 100, settings, textPalette);
    expect(result.grid[3][3]).toBe('white');
    expect(result.grid[2][3]).toBe('purple');
  });

  it('photo applies linear averaging to alpha-bearing inputs and ignores hidden RGB', () => {
    const grayPalette: BeadColor[] = [0, 128, 188, 255].map(v => ({ ...palette[0], id: String(v), code: String(v), rgb: [v, v, v] }));
    const data = new Uint8ClampedArray(12 * 4);
    for (let x = 0; x < 12; x++) {
      const v = x < 6 ? (x < 3 ? 0 : 255) : (x < 8 ? 0 : 255);
      data.set([v, v, v, x >= 10 ? 0 : 255], x * 4);
    }
    const cfg = { ...settings, width: 2, height: 1, pipelineOverride: 'photo' as const, sharpening: 0, kmeansClustering: false };
    // Two missing pixels are less than one six-pixel output-cell footprint:
    // only the partial cell changes regime; the opaque cell keeps A.
    expect(convertImageDataToGrid(data, 12, 1, cfg, grayPalette).grid).toEqual([['128', '188']]);
    data.set([250, 20, 70, 0], 40); data.set([10, 240, 60, 0], 44);
    expect(convertImageDataToGrid(data, 12, 1, cfg, grayPalette).grid).toEqual([['128', '188']]);
  });

  it('photo restores linear opaque interiors when the input has substantial transparent coverage', () => {
    const grayPalette: BeadColor[] = [0, 128, 188, 255].map(v => ({ ...palette[0], id: String(v), code: String(v), rgb: [v, v, v] }));
    const data = new Uint8ClampedArray(12 * 4);
    for (let x = 0; x < 12; x++) data.set([x < 3 ? 0 : 255, x < 3 ? 0 : 255, x < 3 ? 0 : 255, x < 6 ? 255 : 0], x * 4);
    const cfg = { ...settings, width: 2, height: 1, pipelineOverride: 'photo' as const, sharpening: 0, kmeansClustering: false };
    expect(convertImageDataToGrid(data, 12, 1, cfg, grayPalette).grid).toEqual([['188', null]]);
    for (let x = 6; x < 12; x++) data[x * 4 + 3] = 255;
    expect(convertImageDataToGrid(data, 12, 1, cfg, grayPalette).grid).toEqual([['128', '255']]);
  });

  it.each(['logo', 'cartoon'] as const)('%s keeps a source-majority enclosed counter despite split surrounding colours', mode => {
    const purple: [number, number, number] = [144, 128, 160];
    const textPalette = [...palette, { ...palette[1], id: 'purple', code: 'purple', rgb: purple }];
    const data = image((x, y) => x >= 31 && x < 39 && y >= 31 && y < 39 ? [255, 255, 255]
      : [x & 1 ? 148 : 140, y & 1 ? 132 : 124, x & 2 ? 164 : 156]);
    expect(convertImageDataToGrid(data, 100, 100, { ...settings, pipelineOverride: mode }, textPalette).grid[3][3]).toBe('white');
  });

  it('closed source-white classification rejects border openings and transparent enclosure breaks', () => {
    const closed = image((x, y) => x >= 31 && x < 39 && y >= 31 && y < 39 ? [255, 255, 255] : [144, 128, 160]);
    expect(enclosedSourceWhite(closed, 100, 100, 128, new Uint8Array(10000))[3535]).toBe(1);
    const open = closed.slice();
    for (let y = 0; y <= 31; y++) open.set([255, 255, 255, 255], (y * 100 + 35) * 4);
    expect(enclosedSourceWhite(open, 100, 100, 128, new Uint8Array(10000))[3535]).toBe(0);
    closed[(30 * 100 + 35) * 4 + 3] = 0;
    expect(enclosedSourceWhite(closed, 100, 100, 128, new Uint8Array(10000))[3535]).toBe(0);
  });

  it('closed counters accept fractional antialiased ink but reject a pale paper enclosure', () => {
    const counter = image((x, y) => x >= 31 && x < 39 && y >= 31 && y < 39 ? [255, 255, 255]
      : (x + y) % 2 ? [239, 239, 239] : [144, 128, 160]);
    expect(enclosedSourceWhite(counter, 100, 100, 128, new Uint8Array(10000))[3535]).toBe(1);
    for (const gray of [215, 235]) {
      const paper = image((x, y) => x >= 31 && x < 39 && y >= 31 && y < 39 ? [255, 255, 255] : [gray, gray, gray]);
      expect(enclosedSourceWhite(paper, 100, 100, 128, new Uint8Array(10000))[3535]).toBe(0);
    }
  });
});

describe('fractional linear-light area sampling', () => {
  it('weights fractional coverage rather than counting overlapping source windows equally', () => {
    const data = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255]);
    // Each target owns one black source pixel and half of the white pixel:
    // linear energy 1/3 encodes to sRGB 156, not the old 128 window average.
    expect([...resizeSourceArea(data, 3, 1, 2, 1)]).toEqual([156, 156, 156, 255, 156, 156, 156, 255]);
  });

  it('premultiplies alpha, excludes hidden RGB and conserves coverage', () => {
    const data = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 0, 0, 0, 255, 255]);
    expect([...resizeSourceArea(data, 3, 1, 1, 1)]).toEqual([188, 0, 188, 170]);
    data.set([240, 120, 40, 0], 4);
    expect([...resizeSourceArea(data, 3, 1, 1, 1)]).toEqual([188, 0, 188, 170]);
  });

  it('keeps aligned pixel-art blocks exact and never mutates source bytes', () => {
    const data = new Uint8ClampedArray([
      30, 90, 160, 255, 30, 90, 160, 255, 230, 120, 20, 255, 230, 120, 20, 255,
      30, 90, 160, 255, 30, 90, 160, 255, 230, 120, 20, 255, 230, 120, 20, 255,
    ]);
    const before = data.slice();
    expect([...resizeSourceArea(data, 4, 2, 2, 1)]).toEqual([30, 90, 160, 255, 230, 120, 20, 255]);
    expect(resizeSourceArea(data, 4, 2, 4, 2)).toEqual(before);
    expect(data).toEqual(before);
  });
});

describe('compact structure gray candidates', () => {
  const gray: [number, number, number] = [120, 124, 128];
  const nearGray: [number, number, number] = [121, 125, 127];
  const pixel = (rgb: [number, number, number], alpha = 255) => ({ rgb, alpha });
  const evidence = (overrides: Partial<Parameters<typeof compactStructureGrayCandidate>[0]> = {}) => ({
    pixels: Array.from({ length: 4 }, () => pixel(gray)),
    cellArea: 4,
    neighborColors: [gray, gray, null, null],
    existingWhiteCoverage: 0,
    ...overrides,
  });

  it('is enabled by default and requires the 25% coverage threshold', () => {
    expect(compactStructureGrayCandidate(evidence())).toEqual(gray);
    expect(compactStructureGrayCandidate(evidence({
      pixels: [pixel(gray)], cellArea: 5,
    }))).toBeNull();
  });

  it('rejects high source color variance and accepts the configured limit', () => {
    const pixels = [pixel(gray), pixel([255, 255, 255]), pixel(gray), pixel(gray)];
    const neighbors: [number, number, number][] = [gray, gray];
    expect(compactStructureGrayCandidate(evidence({ pixels, neighborColors: neighbors }))).toBeNull();
    expect(compactStructureGrayCandidate(evidence({ pixels, neighborColors: neighbors }), { maxColorVariance: 0.5 })).not.toBeNull();
  });

  it('requires two four-neighbor same-color supports', () => {
    expect(compactStructureGrayCandidate(evidence({ neighborColors: [gray, null, null, null] }))).toBeNull();
    expect(compactStructureGrayCandidate(evidence({ neighborColors: [gray, nearGray, null, null] }))).toEqual(gray);
  });

  it('skips source white majority and transparent source pixels', () => {
    expect(compactStructureGrayCandidate(evidence({ existingWhiteCoverage: 0.51 }))).toBeNull();
    expect(compactStructureGrayCandidate(evidence({
      pixels: Array.from({ length: 4 }, () => pixel(gray, 0)),
    }))).toBeNull();
  });

  it('keeps an existing primary color ahead of the gray candidate and supports disabling', () => {
    const primary: [number, number, number] = [30, 40, 50];
    expect(compactStructureGrayCandidate(evidence({ existingPrimary: primary }))).toBeNull();
    expect(compactStructureGrayCandidate(evidence(), { enabled: false })).toBeNull();
  });
});
