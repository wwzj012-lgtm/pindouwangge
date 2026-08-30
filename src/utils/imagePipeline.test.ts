import { describe, expect, it } from 'vitest';
import type { BeadColor, ConvertSettings } from '../types';
import {
  classifyImageColors,
  convertImageDataToGrid,
  deltaE2000,
  edgeConnectedBackgroundMask,
  inferEdgeBackground,
  rgbToLab,
} from './imagePipeline';

const palette: BeadColor[] = [
  { id: 'black', code: 'B', name: 'Black', hex: '#000000', rgb: [0, 0, 0], brand: 'MARD' },
  { id: 'gray', code: 'N', name: 'Gray', hex: '#808080', rgb: [128, 128, 128], brand: 'MARD' },
  { id: 'white', code: 'W', name: 'White', hex: '#FFFFFF', rgb: [255, 255, 255], brand: 'MARD' },
  { id: 'red', code: 'R', name: 'Red', hex: '#FF0000', rgb: [255, 0, 0], brand: 'MARD' },
  { id: 'green', code: 'G', name: 'Green', hex: '#00FF00', rgb: [0, 255, 0], brand: 'MARD' },
  { id: 'blue', code: 'U', name: 'Blue', hex: '#0000FF', rgb: [0, 0, 255], brand: 'MARD' },
  { id: 'yellow', code: 'Y', name: 'Yellow', hex: '#FFFF00', rgb: [255, 255, 0], brand: 'MARD' },
];

const baseSettings: ConvertSettings = {
  width: 5,
  height: 5,
  keepAspectRatio: true,
  brand: 'MARD',
  dither: 'floyd',
  colorLimit: 0,
  brightness: 0,
  contrast: 0,
  saturation: 0,
  transparentCutoff: 16,
  boardSize: 29,
  colorMatchAlgo: 'ciede2000',
  sharpening: 0,
  outlineBoost: false,
  chromaKeyColor: null,
  chromaKeyTolerance: 20,
};

function makePixels(width: number, height: number, color: [number, number, number] = [255, 255, 255]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) data.set([...color, 255], index * 4);
  return data;
}

function setPixel(data: Uint8ClampedArray, width: number, x: number, y: number, rgba: [number, number, number, number]): void {
  data.set(rgba, (y * width + x) * 4);
}

function fromAscii(lines: string[]): Uint8ClampedArray {
  const width = lines[0].length;
  const data = makePixels(width, lines.length);
  lines.forEach((line, y) => [...line].forEach((cell, x) => {
    if (cell === '#') setPixel(data, width, x, y, [0, 0, 0, 255]);
  }));
  return data;
}

describe('CIEDE2000', () => {
  const vectors: Array<[[number, number, number], [number, number, number], number]> = [
    [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
    [[50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
    [[50, 2.8361, -74.0200], [50, 0, -82.7485], 3.4412],
    [[50, -1.3802, -84.2814], [50, 0, -82.7485], 1.0],
    [[50, -1.1848, -84.8006], [50, 0, -82.7485], 1.0],
    [[50, 2.49, -0.001], [50, -2.49, 0.0009], 7.1792],
  ];

  it.each(vectors)('matches published reference %j to %j', (first, second, expected) => {
    expect(deltaE2000(first, second)).toBeCloseTo(expected, 4);
  });
});

describe('pipeline classification and palette matching', () => {
  it('routes five effective colours to logo and six to photo', () => {
    const five = makePixels(5, 1);
    const six = makePixels(6, 1);
    const colors: Array<[number, number, number]> = [
      [0, 0, 0], [255, 255, 255], [255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0],
    ];
    colors.slice(0, 5).forEach((rgb, x) => setPixel(five, 5, x, 0, [...rgb, 255]));
    colors.forEach((rgb, x) => setPixel(six, 6, x, 0, [...rgb, 255]));
    expect(classifyImageColors(five, 5, 1).pipeline).toBe('logo');
    expect(classifyImageColors(six, 6, 1).pipeline).toBe('photo');
  });

  it('maps each palette RGB back to its own bead id', () => {
    for (const color of palette) {
      const data = makePixels(1, 1, color.rgb);
      const result = convertImageDataToGrid(data, 1, 1, { ...baseSettings, width: 1, height: 1 }, palette);
      expect(result.grid[0][0]).toBe(color.id);
    }
  });

  it('keeps neutral input neutral rather than introducing coloured bead noise', () => {
    const data = makePixels(3, 1);
    setPixel(data, 3, 0, 0, [0, 0, 0, 255]);
    setPixel(data, 3, 1, 0, [128, 128, 128, 255]);
    const result = convertImageDataToGrid(data, 3, 1, { ...baseSettings, width: 3, height: 1 }, palette);
    expect(result.grid[0]).toEqual(['black', 'gray', 'white']);
  });
});

describe('topology-preserving background removal', () => {
  it('keeps backgrounds by default, including legacy settings that lack the explicit opt-in', () => {
    const data = makePixels(5, 5, [255, 255, 255]);
    for (let y = 1; y <= 3; y += 1) {
      for (let x = 1; x <= 3; x += 1) setPixel(data, 5, x, y, [0, 0, 0, 255]);
    }

    const result = convertImageDataToGrid(data, 5, 5, { ...baseSettings, chromaKeyColor: null }, palette);

    expect(result.diagnostics.background).toBeNull();
    expect(result.diagnostics.backgroundPixelsRemoved).toBe(0);
    expect(result.grid[0][0]).toBe('white');
    expect(result.grid[2][2]).toBe('black');
  });

  it('removes edge background only after an explicit auto or manual opt-in', () => {
    const data = makePixels(5, 5, [255, 255, 255]);
    for (let y = 1; y <= 3; y += 1) {
      for (let x = 1; x <= 3; x += 1) setPixel(data, 5, x, y, [0, 0, 0, 255]);
    }

    const auto = convertImageDataToGrid(data, 5, 5, {
      ...baseSettings,
      backgroundRemovalEnabled: true,
      chromaKeyColor: null,
    }, palette);
    const manual = convertImageDataToGrid(data, 5, 5, {
      ...baseSettings,
      backgroundRemovalEnabled: true,
      chromaKeyColor: '#FFFFFF',
    }, palette);

    expect(auto.diagnostics.background?.source).toBe('auto');
    expect(manual.diagnostics.background).toMatchObject({ source: 'manual', color: '#FFFFFF' });
    expect(auto.diagnostics.backgroundPixelsRemoved).toBe(16);
    expect(manual.diagnostics.backgroundPixelsRemoved).toBe(16);
    expect(auto.grid[2][2]).toBe('black');
    expect(manual.grid[2][2]).toBe('black');
  });

  it('removes the outer white background while retaining the hole in a black ring', () => {
    const data = fromAscii([
      '.......',
      '.#####.',
      '.#...#.',
      '.#...#.',
      '.#...#.',
      '.#####.',
      '.......',
    ]);
    const mask = edgeConnectedBackgroundMask(data, 7, 7, '#FFFFFF', 20, 16);
    expect(mask[0]).toBe(1);
    expect(mask[3 * 7 + 3]).toBe(0);
  });

  it('keeps enclosed background-colour cells through the full conversion pipeline', () => {
    const data = fromAscii([
      '.......',
      '.#####.',
      '.#...#.',
      '.#...#.',
      '.#...#.',
      '.#####.',
      '.......',
    ]);
    const result = convertImageDataToGrid(data, 7, 7, {
      ...baseSettings,
      width: 7,
      height: 7,
      dither: 'none',
      pipelineOverride: 'logo',
      backgroundRemovalEnabled: true,
      chromaKeyColor: '#FFFFFF',
    }, palette);

    expect(result.grid[0][0]).toBeNull();
    expect(result.grid[1][1]).toBe('black');
    expect(result.grid[3][3]).toBe('white');
  });

  it.each([
    ['O', ['.###.', '#...#', '#...#', '#...#', '.###.']],
    ['A', ['.###.', '#...#', '#####', '#...#', '#...#']],
    ['B', ['####.', '#...#', '####.', '#...#', '####.']],
    ['P', ['####.', '#...#', '####.', '#....', '#....']],
    ['R', ['####.', '#...#', '####.', '#.#..', '#..#.']],
  ])('preserves enclosed white counters in %s', (_letter, glyph) => {
    const padded = ['.......', ...glyph.map((row) => `.${row}.`), '.......'];
    const data = fromAscii(padded);
    const mask = edgeConnectedBackgroundMask(data, 7, 7, '#FFFFFF', 20, 16);
    expect(mask[0]).toBe(1);
    expect(mask[2 * 7 + 3]).toBe(0);
  });

  it('keeps a non-edge foreground region even when it is the exact background colour', () => {
    const data = fromAscii([
      '.......',
      '.#####.',
      '.#...#.',
      '.#...#.',
      '.#...#.',
      '.#####.',
      '.......',
    ]);
    const mask = edgeConnectedBackgroundMask(data, 7, 7, '#FFFFFF', 20, 16);
    expect(mask[3 * 7 + 3]).toBe(0);
  });

  it('honours source alpha and never treats transparent pixels as chroma-key candidates', () => {
    const data = makePixels(5, 5, [255, 255, 255]);
    for (let y = 0; y < 5; y += 1) {
      for (let x = 0; x < 5; x += 1) {
        if (x === 0 || x === 4 || y === 0 || y === 4) setPixel(data, 5, x, y, [255, 255, 255, 0]);
      }
    }
    const mask = edgeConnectedBackgroundMask(data, 5, 5, '#FFFFFF', 20, 16);
    expect(mask[0]).toBe(0);
    expect(mask[2 * 5 + 2]).toBe(0);
  });

  it('uses the alpha cutoff for antialiased candidates without leaking into enclosed same-colour pixels', () => {
    const data = makePixels(7, 7, [0, 0, 0]);
    setPixel(data, 7, 0, 0, [255, 255, 255, 15]);
    setPixel(data, 7, 1, 0, [250, 250, 250, 16]);
    setPixel(data, 7, 2, 0, [255, 255, 255, 255]);
    setPixel(data, 7, 4, 4, [250, 250, 250, 16]);

    const mask = edgeConnectedBackgroundMask(data, 7, 7, '#FFFFFF', 20, 16);

    expect(mask[0]).toBe(0);
    expect(mask[1]).toBe(1);
    expect(mask[2]).toBe(1);
    expect(mask[4 * 7 + 4]).toBe(0);
  });

  it('makes a target grid cell transparent below 35% surviving coverage after removal', () => {
    const data = makePixels(4, 4, [255, 255, 255]);
    [[1, 1], [2, 1], [1, 2], [2, 2]].forEach(([x, y]) => setPixel(data, 4, x, y, [0, 0, 0, 255]));
    const result = convertImageDataToGrid(data, 4, 4, {
      ...baseSettings,
      width: 1,
      height: 1,
      dither: 'none',
      pipelineOverride: 'logo',
      backgroundRemovalEnabled: true,
      chromaKeyColor: '#FFFFFF',
    }, palette);

    expect(result.diagnostics.backgroundPixelsRemoved).toBe(12);
    expect(result.grid[0][0]).toBeNull();
  });

  it('does not leak through diagonal-only contact', () => {
    const data = makePixels(8, 8, [0, 0, 0]);
    [[0, 0], [1, 0], [0, 1], [0, 2], [0, 3]].forEach(([x, y]) => setPixel(data, 8, x, y, [255, 255, 255, 255]));
    // (2, 1) only touches the removed component diagonally via (1, 0).
    setPixel(data, 8, 2, 1, [255, 255, 255, 255]);
    const mask = edgeConnectedBackgroundMask(data, 8, 8, '#FFFFFF', 20, 16);
    expect(mask[0]).toBe(1);
    expect(mask[1 * 8 + 2]).toBe(0);
  });

  it('keeps a foreground region that touches the edge when its colour differs from the background', () => {
    const data = makePixels(7, 7, [255, 255, 255]);
    [[0, 2], [0, 3], [0, 4], [1, 3]].forEach(([x, y]) => setPixel(data, 7, x, y, [0, 0, 0, 255]));
    const mask = edgeConnectedBackgroundMask(data, 7, 7, '#FFFFFF', 20, 16);
    expect(mask[0]).toBe(1);
    expect(mask[3 * 7]).toBe(0);
  });

  it('infers a JPEG-like edge background in Lab space without deleting the different-colour subject', () => {
    const data = makePixels(7, 7, [251, 251, 249]);
    const edgeColours: Array<[number, number, number]> = [[248, 249, 247], [252, 251, 250], [250, 252, 249], [253, 252, 251]];
    let colourIndex = 0;
    for (let y = 0; y < 7; y += 1) {
      for (let x = 0; x < 7; x += 1) {
        if (x === 0 || x === 6 || y === 0 || y === 6) {
          const rgb = edgeColours[colourIndex % edgeColours.length];
          setPixel(data, 7, x, y, [...rgb, 255]);
          colourIndex += 1;
        }
      }
    }
    setPixel(data, 7, 3, 3, [0, 0, 0, 255]);
    const inferred = inferEdgeBackground(data, 7, 7, 16);
    const mask = edgeConnectedBackgroundMask(data, 7, 7, null, 20, 16);
    expect(inferred?.source).toBe('auto');
    expect(inferred?.confidence).toBeGreaterThan(0.7);
    expect(mask[0]).toBe(1);
    expect(mask[3 * 7 + 3]).toBe(0);
  });

  it('does not auto-remove an ambiguous four-colour image border', () => {
    const data = makePixels(8, 8, [0, 0, 0]);
    const edgePixels: Array<[number, number]> = [];
    for (let x = 0; x < 8; x += 1) {
      edgePixels.push([x, 0], [x, 7]);
    }
    for (let y = 1; y < 7; y += 1) {
      edgePixels.push([0, y], [7, y]);
    }
    const cornerBackgrounds: Array<[number, number, number]> = [
      [255, 255, 255], [255, 0, 0], [0, 255, 0], [0, 0, 255],
    ];
    edgePixels.forEach(([x, y], index) => {
      setPixel(data, 8, x, y, [...cornerBackgrounds[Math.floor(index / 7)], 255]);
    });

    expect(inferEdgeBackground(data, 8, 8, 16)).toBeNull();
    expect(edgeConnectedBackgroundMask(data, 8, 8, null, 20, 16)).toEqual(new Uint8Array(64));
  });

  it('does not auto-remove when the two leading edge colours are too close', () => {
    const data = makePixels(8, 8, [0, 0, 0]);
    const edgePixels: Array<[number, number]> = [];
    for (let x = 0; x < 8; x += 1) {
      edgePixels.push([x, 0], [x, 7]);
    }
    for (let y = 1; y < 7; y += 1) {
      edgePixels.push([0, y], [7, y]);
    }
    edgePixels.forEach(([x, y], index) => {
      const rgb: [number, number, number] = index < 14
        ? [255, 255, 255]
        : index < 25
          ? [0, 0, 255]
          : [0, 255, 0];
      setPixel(data, 8, x, y, [...rgb, 255]);
    });

    expect(inferEdgeBackground(data, 8, 8, 16)).toBeNull();
  });

  it('removes a manual edge-connected background component even when it is small', () => {
    const data = makePixels(20, 20, [0, 0, 0]);
    setPixel(data, 20, 0, 10, [255, 255, 255, 255]);
    setPixel(data, 20, 1, 10, [255, 255, 255, 255]);
    setPixel(data, 20, 10, 10, [255, 255, 255, 255]);

    const mask = edgeConnectedBackgroundMask(data, 20, 20, '#FFFFFF', 20, 16);

    expect(mask[10 * 20]).toBe(1);
    expect(mask[10 * 20 + 1]).toBe(1);
    expect(mask[10 * 20 + 10]).toBe(0);
  });

  it('handles a 512 by 512 background without recursive flood-fill growth', () => {
    const data = makePixels(512, 512, [255, 255, 255]);
    for (let y = 220; y < 292; y += 1) {
      for (let x = 220; x < 292; x += 1) setPixel(data, 512, x, y, [0, 0, 0, 255]);
    }

    const mask = edgeConnectedBackgroundMask(data, 512, 512, '#FFFFFF', 20, 16);

    expect(mask).toHaveLength(512 * 512);
    expect(mask[0]).toBe(1);
    expect(mask[256 * 512 + 256]).toBe(0);
  });
});

describe('detail preservation and deterministic output', () => {
  it('keeps one-pixel line endpoints and closed outlines in logo mode', () => {
    const line = makePixels(5, 5);
    for (let x = 1; x <= 3; x += 1) setPixel(line, 5, x, 2, [0, 0, 0, 255]);
    const result = convertImageDataToGrid(line, 5, 5, baseSettings, palette);
    expect(result.diagnostics.pipeline).toBe('logo');
    expect(result.grid[2][1]).toBe('black');
    expect(result.grid[2][3]).toBe('black');

    const outline = fromAscii(['.....', '.###.', '.#.#.', '.###.', '.....']);
    const outlined = convertImageDataToGrid(outline, 5, 5, baseSettings, palette);
    expect(outlined.grid[1][1]).toBe('black');
    expect(outlined.grid[3][3]).toBe('black');
  });

  it('disables dithering for logo input', () => {
    const data = makePixels(5, 5);
    setPixel(data, 5, 2, 2, [0, 0, 0, 255]);
    const dithered = convertImageDataToGrid(data, 5, 5, { ...baseSettings, chromaKeyColor: '#FFFFFF', dither: 'floyd' }, palette);
    const flat = convertImageDataToGrid(data, 5, 5, { ...baseSettings, chromaKeyColor: '#FFFFFF', dither: 'none' }, palette);
    expect(dithered.diagnostics.pipeline).toBe('logo');
    expect(dithered.grid).toEqual(flat.grid);
  });

  it('uses the photo pipeline deterministically and retains transparent grid cells', () => {
    const data = makePixels(6, 6);
    const colors: Array<[number, number, number]> = [
      [0, 0, 0], [255, 255, 255], [255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0],
    ];
    for (let index = 0; index < 36; index += 1) {
      const rgb = colors[index % colors.length];
      data.set([...rgb, 255], index * 4);
    }
    setPixel(data, 6, 2, 2, [255, 255, 255, 0]);
    const settings = { ...baseSettings, width: 6, height: 6, dither: 'floyd' as const };
    const first = convertImageDataToGrid(data, 6, 6, settings, palette);
    const second = convertImageDataToGrid(data, 6, 6, settings, palette);
    expect(first.diagnostics.pipeline).toBe('photo');
    expect(first.grid).toEqual(second.grid);
    expect(first.grid[2][2]).toBeNull();
  });

  it('does not clean a low-contrast photo cell when Floyd-Steinberg is disabled', () => {
    const softPalette: BeadColor[] = [
      { id: 'gray', code: 'G', name: 'Gray', hex: '#808080', rgb: [128, 128, 128], brand: 'MARD' },
      { id: 'dark-gray', code: 'D', name: 'Dark gray', hex: '#606060', rgb: [96, 96, 96], brand: 'MARD' },
    ];
    const data = makePixels(3, 3, [128, 128, 128]);
    setPixel(data, 3, 1, 1, [108, 108, 108, 255]);
    const result = convertImageDataToGrid(data, 3, 3, {
      ...baseSettings,
      width: 3,
      height: 3,
      pipelineOverride: 'photo',
      dither: 'none',
    }, softPalette);

    expect(result.grid.flat().every(Boolean)).toBe(true);
    expect(result.grid[1][1]).toBe('dark-gray');
  });

  it('cleans a low-contrast Floyd-Steinberg colour speck and reports the final match', () => {
    const softPalette: BeadColor[] = [
      { id: 'gray', code: 'G', name: 'Gray', hex: '#808080', rgb: [128, 128, 128], brand: 'MARD' },
      { id: 'dark-gray', code: 'D', name: 'Dark gray', hex: '#606060', rgb: [96, 96, 96], brand: 'MARD' },
    ];
    const data = makePixels(3, 3, [128, 128, 128]);
    setPixel(data, 3, 1, 1, [108, 108, 108, 255]);
    const result = convertImageDataToGrid(data, 3, 3, {
      ...baseSettings,
      width: 3,
      height: 3,
      pipelineOverride: 'photo',
      dither: 'floyd',
      ditherStrength: 1,
    }, softPalette);

    expect(result.grid.flat().every(Boolean)).toBe(true);
    expect(result.grid[1][1]).toBe('gray');
    expect(result.diagnostics.matches[1][1]?.matchedColorId).toBe(result.grid[1][1]);
  });

  it('keeps high-contrast photo lines and transparent boundaries intact', () => {
    const data = makePixels(5, 5, [255, 255, 255]);
    for (let x = 1; x <= 3; x += 1) setPixel(data, 5, x, 2, [0, 0, 0, 255]);
    setPixel(data, 5, 0, 0, [255, 255, 255, 0]);
    const result = convertImageDataToGrid(data, 5, 5, {
      ...baseSettings,
      width: 5,
      height: 5,
      pipelineOverride: 'photo',
      dither: 'none',
    }, palette);

    expect(result.grid[0][0]).toBeNull();
    expect(result.grid[2][1]).toBe('black');
    expect(result.grid[2][2]).toBe('black');
    expect(result.grid[2][3]).toBe('black');
  });

  it('exposes first and second palette candidates for each non-transparent output cell', () => {
    const data = makePixels(1, 1, [255, 0, 0]);
    const result = convertImageDataToGrid(data, 1, 1, { ...baseSettings, width: 1, height: 1, pipelineOverride: 'photo', dither: 'none' }, palette);
    const match = result.diagnostics.matches[0][0];
    expect(match).not.toBeNull();
    expect(match?.sourceLab).toHaveLength(3);
    expect(match?.matchingLab).toEqual(match?.sourceLab);
    expect(match?.matchedColorId).toBe('red');
    expect(match?.matchedColorCode).toBe('R');
    expect(match?.deltaE).toBeCloseTo(0, 6);
    expect(match?.secondColorId).not.toBeNull();
    expect(match?.secondDeltaE).toBeGreaterThan(match?.deltaE ?? 0);
    expect(match?.deltaEDifference).toBeGreaterThan(0);
  });

  it('honours a manual pipeline override while retaining automatic classification diagnostics', () => {
    const data = makePixels(5, 1);
    const colors: Array<[number, number, number]> = [[0, 0, 0], [255, 255, 255], [255, 0, 0], [0, 255, 0], [0, 0, 255]];
    colors.forEach((rgb, x) => setPixel(data, 5, x, 0, [...rgb, 255]));
    const result = convertImageDataToGrid(data, 5, 1, { ...baseSettings, width: 5, height: 1, pipelineOverride: 'photo' }, palette);
    expect(result.diagnostics.detectedPipeline).toBe('logo');
    expect(result.diagnostics.pipeline).toBe('photo');
    expect(result.diagnostics.pipelineOverridden).toBe(true);
    expect(result.diagnostics.effectiveColorCount).toBe(5);
  });

  it('treats zero Floyd-Steinberg strength exactly like no dithering', () => {
    const data = makePixels(6, 6);
    const colors: Array<[number, number, number]> = [[0, 0, 0], [255, 255, 255], [255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0]];
    for (let index = 0; index < 36; index += 1) data.set([...colors[index % colors.length], 255], index * 4);
    const floydZero = convertImageDataToGrid(data, 6, 6, { ...baseSettings, width: 6, height: 6, dither: 'floyd', ditherStrength: 0 }, palette);
    const none = convertImageDataToGrid(data, 6, 6, { ...baseSettings, width: 6, height: 6, dither: 'none' }, palette);
    expect(floydZero.diagnostics.pipeline).toBe('photo');
    expect(floydZero.grid).toEqual(none.grid);
  });

  it('keeps source diagnostics anchored to the adjusted sample after error diffusion', () => {
    const data = makePixels(6, 1);
    const colors: Array<[number, number, number]> = [
      [70, 70, 70], [70, 70, 70], [255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0],
    ];
    colors.forEach((rgb, x) => setPixel(data, 6, x, 0, [...rgb, 255]));
    const result = convertImageDataToGrid(data, 6, 1, {
      ...baseSettings,
      width: 6,
      height: 1,
      pipelineOverride: 'photo',
      dither: 'floyd',
      ditherStrength: 1,
    }, palette);
    const first = result.diagnostics.matches[0][0];
    const second = result.diagnostics.matches[0][1];

    expect(first?.sourceLab).toEqual(rgbToLab([70, 70, 70]));
    expect(second?.sourceLab).toEqual(rgbToLab([70, 70, 70]));
    expect(second?.matchingLab).not.toEqual(second?.sourceLab);
  });

  it('limits the candidate palette before final mapping', () => {
    const data = makePixels(2, 1);
    setPixel(data, 2, 0, 0, [255, 0, 0, 255]);
    setPixel(data, 2, 1, 0, [0, 255, 0, 255]);
    const result = convertImageDataToGrid(data, 2, 1, { ...baseSettings, width: 2, height: 1, colorLimit: 1, dither: 'none' }, palette);
    expect(new Set(result.grid[0].filter((color): color is string => color !== null))).toEqual(new Set(['red']));
  });

  it('normalizes fractional color limits and rejects empty or truncated image input safely', () => {
    const data = makePixels(2, 1);
    setPixel(data, 2, 0, 0, [255, 0, 0, 255]);
    setPixel(data, 2, 1, 0, [0, 255, 0, 255]);
    const limited = convertImageDataToGrid(data, 2, 1, { ...baseSettings, width: 2, height: 1, colorLimit: 0.5 }, palette);
    const emptyPalette = convertImageDataToGrid(data, 2, 1, { ...baseSettings, width: 2, height: 1 }, []);
    const truncated = convertImageDataToGrid(new Uint8ClampedArray(0), 1, 1, { ...baseSettings, width: 1, height: 1 }, palette);

    expect(limited.grid[0].every((color) => color !== null)).toBe(true);
    expect(emptyPalette.grid).toEqual([]);
    expect(truncated.grid).toEqual([]);
  });
});

describe('image adjustment and lightness regression', () => {
  const noBackgroundSettings = {
    ...baseSettings,
    pipelineOverride: 'photo' as const,
    dither: 'none' as const,
    chromaKeyColor: '#00FFFF',
    chromaKeyTolerance: 0,
    sharpening: 0,
    outlineBoost: false,
  };

  it('treats brightness zero as neutral and changes lightness in the requested direction', () => {
    const data = makePixels(1, 1, [128, 128, 128]);
    const neutral = convertImageDataToGrid(data, 1, 1, { ...noBackgroundSettings, width: 1, height: 1, brightness: 0 }, palette);
    const brighter = convertImageDataToGrid(data, 1, 1, { ...noBackgroundSettings, width: 1, height: 1, brightness: 20 }, palette);
    const darker = convertImageDataToGrid(data, 1, 1, { ...noBackgroundSettings, width: 1, height: 1, brightness: -20 }, palette);

    expect(neutral.diagnostics.matches[0][0]?.sourceLab).toEqual(rgbToLab([128, 128, 128]));
    expect(neutral.diagnostics.meanSourceLightness).toBeCloseTo(neutral.diagnostics.meanMatchedLightness, 6);
    expect(brighter.diagnostics.meanSourceLightness).toBeGreaterThan(neutral.diagnostics.meanSourceLightness);
    expect(darker.diagnostics.meanSourceLightness).toBeLessThan(neutral.diagnostics.meanSourceLightness);
  });

  it('keeps sharpening at zero as an identity and sharpens high-contrast edges without overshoot', () => {
    const data = makePixels(3, 3, [80, 80, 80]);
    setPixel(data, 3, 1, 1, [220, 220, 220, 255]);
    const neutral = convertImageDataToGrid(data, 3, 3, { ...noBackgroundSettings, width: 3, height: 3 }, palette);
    const sharpened = convertImageDataToGrid(data, 3, 3, { ...noBackgroundSettings, width: 3, height: 3, sharpening: 100 }, palette);
    const neutralCenter = neutral.diagnostics.matches[1][1]!;
    const sharpenedCenter = sharpened.diagnostics.matches[1][1]!;

    expect(neutralCenter.sourceLab).toEqual(rgbToLab([220, 220, 220]));
    expect(sharpenedCenter.sourceLab[0]).toBeGreaterThan(neutralCenter.sourceLab[0]);
    expect(sharpenedCenter.sourceLab[0]).toBeLessThanOrEqual(100);
    expect(sharpenedCenter.matchingLab[0]).toBeLessThanOrEqual(100);
  });

  it('only boosts a strongly contrasted dark outline and leaves a flat dark shadow intact', () => {
    const data = makePixels(5, 3, [65, 65, 65]);
    for (let y = 0; y < 3; y += 1) {
      setPixel(data, 5, 3, y, [20, 20, 20, 255]);
      setPixel(data, 5, 4, y, [230, 230, 230, 255]);
    }
    const normal = convertImageDataToGrid(data, 5, 3, { ...noBackgroundSettings, width: 5, height: 3 }, palette);
    const protectedResult = convertImageDataToGrid(data, 5, 3, { ...noBackgroundSettings, width: 5, height: 3, outlineBoost: true }, palette);

    expect(protectedResult.diagnostics.matches[1][1]?.sourceLab[0]).toBeCloseTo(normal.diagnostics.matches[1][1]?.sourceLab[0] ?? 0, 6);
    expect(protectedResult.diagnostics.matches[1][3]?.sourceLab[0]).toBeLessThan(normal.diagnostics.matches[1][3]?.sourceLab[0] ?? 0);
  });

  it('does not significantly darken a bright photo mapped to an exact available palette', () => {
    const brightPalette: BeadColor[] = [
      [255, 220, 220], [220, 255, 220], [220, 220, 255], [255, 255, 200], [250, 220, 255], [210, 245, 245],
    ].map((rgb, index) => ({ id: `bright-${index}`, code: `P${index}`, name: `Bright ${index}`, hex: '#FFFFFF', rgb: rgb as [number, number, number], brand: 'MARD' }));
    const data = makePixels(6, 1);
    brightPalette.forEach((color, x) => setPixel(data, 6, x, 0, [...color.rgb, 255]));
    const result = convertImageDataToGrid(data, 6, 1, {
      ...noBackgroundSettings,
      width: 6,
      height: 1,
      pipelineOverride: 'auto',
    }, brightPalette);

    expect(result.diagnostics.pipeline).toBe('photo');
    expect(result.diagnostics.meanSourceLightness).toBeGreaterThan(75);
    expect(Math.abs(result.diagnostics.lightnessBias)).toBeLessThanOrEqual(0.5);
    expect(result.diagnostics.meanDeltaE).toBeCloseTo(0, 6);
  });
});

describe('conservative interior-hole protection', () => {
  it('repairs a tiny semi-transparent gap enclosed by a solid subject', () => {
    const data = makePixels(3, 3, [0, 0, 0]);
    // The centre represents a partially sampled subject cell after resize;
    // it is not transparent enough to be treated as a background hole.
    setPixel(data, 3, 1, 1, [0, 0, 0, 64]);
    const result = convertImageDataToGrid(data, 3, 3, {
      ...baseSettings,
      width: 3,
      height: 3,
      dither: 'none',
      pipelineOverride: 'logo',
    }, palette);

    expect(result.grid[1][1]).toBe('black');
  });

  it('does not fill an enclosed transparent counter used by a cut-out', () => {
    const data = makePixels(3, 3, [0, 0, 0]);
    setPixel(data, 3, 1, 1, [255, 255, 255, 0]);
    const result = convertImageDataToGrid(data, 3, 3, {
      ...baseSettings,
      width: 3,
      height: 3,
      dither: 'none',
      pipelineOverride: 'logo',
    }, palette);

    expect(result.grid[1][1]).toBeNull();
  });
});
