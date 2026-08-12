import { describe, expect, it } from 'vitest';
import type { BeadColor } from '../types';
import {
  decodePatternProject,
  encodePatternProject,
  type GridMatrix,
  type StoredPatternProject,
} from './patternGridCodec';

const palette: BeadColor[] = [
  { id: 'black', code: 'B', name: 'Black', hex: '#000000', rgb: [0, 0, 0], brand: 'MARD' },
  { id: 'white', code: 'W', name: 'White', hex: '#FFFFFF', rgb: [255, 255, 255], brand: 'MARD' },
  { id: 'red', code: 'R', name: 'Red', hex: '#FF0000', rgb: [255, 0, 0], brand: 'MARD' },
];

function projectFromGrid(grid: GridMatrix): StoredPatternProject {
  return {
    version: 2,
    name: 'Round trip',
    width: grid[0]?.length ?? 0,
    height: grid.length,
    boardSize: 29,
    brand: 'MARD',
    settings: {
      width: grid[0]?.length ?? 0,
      height: grid.length,
      keepAspectRatio: true,
      brand: 'MARD',
      dither: 'none',
      colorLimit: 0,
      brightness: 0,
      contrast: 0,
      saturation: 0,
      transparentCutoff: 128,
      boardSize: 29,
      colorMatchAlgo: 'ciede2000',
      sharpening: 0,
      outlineBoost: false,
      chromaKeyColor: null,
      chromaKeyTolerance: 0,
    },
    grid,
    palette,
    createdAt: 1,
  };
}

function grid(width: number, height: number, value: (x: number, y: number) => string | null): GridMatrix {
  return Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => value(x, y)));
}

describe('reversible pattern grid codec', () => {
  it('round trips a 1x1 empty grid', async () => {
    const input = projectFromGrid([[null]]);
    const encoded = await encodePatternProject(input);
    await expect(decodePatternProject(encoded.manifest, encoded.chunks)).resolves.toEqual(input);
  });

  it('round trips exact palette cells across a 128-cell boundary', async () => {
    const input = projectFromGrid(grid(129, 130, (x, y) => {
      if (x === 0 || y === 0 || x === 128 || y === 129) return 'black';
      if ((x + y) % 17 === 0) return 'red';
      return null;
    }));
    const encoded = await encodePatternProject(input);
    expect(encoded.chunks).toHaveLength(4);
    await expect(decodePatternProject(encoded.manifest, encoded.chunks)).resolves.toEqual(input);
  });

  it('round trips every conversion setting required for continued editing', async () => {
    const input = projectFromGrid([['black']]);
    input.settings = {
      ...input.settings,
      width: 1,
      height: 1,
      keepAspectRatio: false,
      brand: 'MARD',
      dither: 'floyd',
      colorLimit: 3,
      brightness: -12,
      contrast: 18,
      saturation: 27,
      transparentCutoff: 77,
      boardSize: 14,
      colorMatchAlgo: 'cie76',
      sharpening: 66,
      outlineBoost: true,
      vividBoost: true,
      chromaKeyColor: '#123456',
      chromaKeyTolerance: 23,
      kmeansClustering: true,
      pipelineOverride: 'logo',
      ditherStrength: 0.4,
    };
    input.boardSize = 14;
    await expect(decodePatternProject(
      (await encodePatternProject(input)).manifest,
      (await encodePatternProject(input)).chunks,
    )).resolves.toEqual(input);
  });

  it('uses RLE for large uniform areas and bit packing for noisy grids', async () => {
    const uniform = await encodePatternProject(projectFromGrid(grid(128, 128, () => 'white')));
    expect(uniform.chunks[0]?.codec).toBe('rle-v1');

    const noisy = await encodePatternProject(projectFromGrid(grid(128, 128, (x, y) => {
      const values: Array<string | null> = [null, 'black', 'white', 'red'];
      return values[(x * 19 + y * 23) % values.length] ?? null;
    })));
    expect(noisy.chunks[0]?.codec).toBe('bit-pack-v1');
  });

  it('round trips a maximum 900x900 grid without losing cells', async () => {
    const input = projectFromGrid(grid(900, 900, (x, y) => {
      if (x === y || x + y === 899) return 'black';
      if (x % 97 === 0 && y % 61 === 0) return 'red';
      return null;
    }));
    const encoded = await encodePatternProject(input);
    expect(encoded.chunks).toHaveLength(64);
    const decoded = await decodePatternProject(encoded.manifest, encoded.chunks);
    expect(decoded.grid).toEqual(input.grid);
  }, 20_000);

  it('rejects a modified chunk before restoring the grid', async () => {
    const encoded = await encodePatternProject(projectFromGrid([['black', null], [null, 'red']]));
    const [first, ...rest] = encoded.chunks;
    if (!first) throw new Error('expected test chunk');
    const modified = {
      ...first,
      payload: new Uint8Array(first.payload),
    };
    modified.payload[0] = (modified.payload[0] ?? 0) ^ 1;
    await expect(decodePatternProject(encoded.manifest, [modified, ...rest])).rejects.toThrow('integrity check');
  });
});
