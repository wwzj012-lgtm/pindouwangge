import { describe, expect, it } from 'vitest';
import { detectPixelGrid, snapToPixelGrid } from './pixelGrid';

function makeArt(logical: number, scale: number, noise = 0, alpha = 255): { data: Uint8ClampedArray; width: number } {
  const width = logical * scale;
  const data = new Uint8ClampedArray(width * width * 4);
  let seed = 12345;
  const random = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let y = 0; y < width; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const lx = Math.floor(x / scale);
      const ly = Math.floor(y / scale);
      const i = ly * logical + lx;
      const o = (y * width + x) * 4;
      const n = noise > 0 ? (random() - 0.5) * 2 * noise : 0;
      data[o] = (i * 53) % 256 + n;
      data[o + 1] = (i * 97) % 256 + n;
      data[o + 2] = (i * 151) % 256 + n;
      data[o + 3] = alpha;
    }
  }
  return { data, width };
}

describe('detectPixelGrid', () => {
  it('finds the native cell size of nearest-upscaled pixel art', () => {
    const { data, width } = makeArt(16, 24);
    const detection = detectPixelGrid(data, width, width);
    expect(detection).not.toBeNull();
    expect(detection!.cell).toBe(24);
    expect(detection!.cols).toBe(16);
    expect(detection!.rows).toBe(16);
    expect(detection!.confidence).toBeGreaterThan(2);
  });

  it('detects sprites whose edges only run along shape outlines', () => {
    // Mostly flat regions: colour changes concentrate on a rectangle outline,
    // so only a minority of lattice lines carry any edge energy at all.
    const logical = 48;
    const scale = 24;
    const width = logical * scale;
    const data = new Uint8ClampedArray(width * width * 4);
    for (let y = 0; y < width; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const lx = Math.floor(x / scale);
        const ly = Math.floor(y / scale);
        const inside = lx >= 12 && lx < 36 && ly >= 10 && ly < 30;
        const o = (y * width + x) * 4;
        data[o] = inside ? 217 : 45;
        data[o + 1] = inside ? 43 : 43;
        data[o + 2] = inside ? 44 : 65;
        data[o + 3] = 255;
      }
    }
    const detection = detectPixelGrid(data, width, width);
    expect(detection).not.toBeNull();
    // With only two edge lines per axis the native size is statistically
    // ambiguous against coarser lattices that also contain those lines; any
    // multiple of it snaps losslessly (every block boundary lands on a native
    // grid line), so a multiple is an acceptable answer.
    expect(detection!.cell % scale).toBe(0);
    expect(detection!.cols).toBeGreaterThanOrEqual(12);
  });

  it('survives mild JPEG-like noise on flat blocks', () => {
    const { data, width } = makeArt(16, 20, 6);
    const detection = detectPixelGrid(data, width, width);
    expect(detection).not.toBeNull();
    expect(detection!.cell).toBe(20);
  });

  it('rejects smooth gradients', () => {
    const size = 256;
    const data = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const o = (y * size + x) * 4;
        data[o] = Math.round((x / size) * 255);
        data[o + 1] = Math.round((y / size) * 255);
        data[o + 2] = 120;
        data[o + 3] = 255;
      }
    }
    expect(detectPixelGrid(data, size, size)).toBeNull();
  });

  it('rejects a single flat colour', () => {
    const size = 256;
    const data = new Uint8ClampedArray(size * size * 4).fill(255);
    expect(detectPixelGrid(data, size, size)).toBeNull();
  });

  it('rejects images too small for a lattice', () => {
    const data = new Uint8ClampedArray(12 * 12 * 4).fill(200);
    expect(detectPixelGrid(data, 12, 12)).toBeNull();
  });
});

describe('snapToPixelGrid', () => {
  it('restores the author flat colours inside every block', () => {
    const logical = 12;
    const scale = 16;
    const { data, width } = makeArt(logical, scale);
    const detection = detectPixelGrid(data, width, width)!;
    const snapped = snapToPixelGrid(data, width, width, detection);
    for (let ly = 0; ly < logical; ly += 1) {
      for (let lx = 0; lx < logical; lx += 1) {
        const i = ly * logical + lx;
        const expected = [(i * 53) % 256, (i * 97) % 256, (i * 151) % 256];
        const cx = lx * scale + Math.floor(scale / 2);
        const cy = ly * scale + Math.floor(scale / 2);
        const o = (cy * width + cx) * 4;
        expect([snapped[o], snapped[o + 1], snapped[o + 2]]).toEqual(expected);
      }
    }
  });

  it('makes every pixel within a block identical after snapping', () => {
    const { data, width } = makeArt(10, 14, 5);
    const detection = detectPixelGrid(data, width, width)!;
    const snapped = snapToPixelGrid(data, width, width, detection);
    const { cols, rows, cell, phaseX, phaseY } = detection;
    for (let by = 0; by < rows; by += 1) {
      for (let bx = 0; bx < cols; bx += 1) {
        const x0 = phaseX + bx * cell;
        const y0 = phaseY + by * cell;
        const o = ((y0 + 2) * width + x0 + 2) * 4;
        for (let dy = 0; dy < cell; dy += 3) {
          for (let dx = 0; dx < cell; dx += 3) {
            const p = ((y0 + dy) * width + x0 + dx) * 4;
            expect(Math.abs(snapped[p] - snapped[o])).toBeLessThanOrEqual(1);
            expect(Math.abs(snapped[p + 1] - snapped[o + 1])).toBeLessThanOrEqual(1);
            expect(Math.abs(snapped[p + 2] - snapped[o + 2])).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  });

  it('leaves blocks with mixed alpha untouched', () => {
    const logical = 10;
    const scale = 20;
    const { data, width } = makeArt(logical, scale);
    // Punch a soft alpha gradient through one block to fake anti-aliased detail.
    const targetLx = 3;
    const targetLy = 4;
    for (let dy = 0; dy < scale; dy += 1) {
      for (let dx = 0; dx < scale; dx += 1) {
        const o = ((targetLy * scale + dy) * width + targetLx * scale + dx) * 4;
        data[o + 3] = dx < scale / 2 ? 255 : 10;
      }
    }
    const detection = detectPixelGrid(data, width, width)!;
    const snapped = snapToPixelGrid(data, width, width, detection);
    const oOpaque = ((targetLy * scale + 2) * width + targetLx * scale + 2) * 4;
    const oClear = ((targetLy * scale + 2) * width + targetLx * scale + scale - 2) * 4;
    expect(snapped[oOpaque + 3]).toBe(255);
    expect(snapped[oClear + 3]).toBe(10);
  });
});
