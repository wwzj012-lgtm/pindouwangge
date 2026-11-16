import { describe, expect, it } from 'vitest';
import type { ImportImagePixels } from './importRecognition';
import { estimateGridWarp, warpOffsetAt } from './importGridWarp';

type Rgb = [number, number, number];

function build(size: number, paint: (x: number, y: number) => Rgb): ImportImagePixels {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const [r, g, b] = paint(x, y);
      const offset = (y * size + x) * 4;
      data[offset] = r; data[offset + 1] = g; data[offset + 2] = b; data[offset + 3] = 255;
    }
  }
  return { data, width: size, height: size };
}

/** 印刷格线图：格线暗于底色（满足暗线投影"暗于两侧±3px"判定）。 */
function buildLines(size: number, paint: (x: number, y: number) => boolean): ImportImagePixels {
  return build(size, (x, y) => (paint(x, y) ? [90, 96, 104] : [210, 208, 202]));
}

describe('estimateGridWarp', () => {
  it('returns null on a perfectly regular grid (no perspective)', () => {
    // 无透视的规则格线：任何块的偏移都应为 0，不值得启用
    const image = buildLines(360, (x, y) => x % 30 < 2 || y % 30 < 2);
    const warp = estimateGridWarp(image, { originX: 0, originY: 0, cellSize: 30 });
    expect(warp).toBeNull();
  });

  it('returns null when the image is too small to tile', () => {
    const image = buildLines(40, (x, y) => x % 10 < 1 || y % 10 < 1);
    expect(estimateGridWarp(image, { originX: 0, originY: 0, cellSize: 10 })).toBeNull();
  });

  it('recovers a smooth perspective drift field', () => {
    // 合成透视：格线位置 = k*cell + skew * (x/W) * (y/H) * W（与真实照片同级 ~1%）
    const size = 400;
    const cell = 25;
    const skew = 0.02;
    const drift = (x: number, y: number) => skew * (x / size) * y;
    // 横向格线（沿 x 方向的线）在 y 上漂移；竖向格线在 x 上漂移
    const image = buildLines(size, (x, y) => {
      const dx = drift(x, y);
      const dy = skew * (y / size) * x;
      return Math.abs(((x - dx) % cell + cell) % cell) < 2 || Math.abs(((y - dy) % cell + cell) % cell) < 2;
    });
    const warp = estimateGridWarp(image, { originX: 0, originY: 0, cellSize: cell });
    expect(warp).not.toBeNull();
    expect(warp!.maxResidual).toBeGreaterThan(0.12);
    // 全场漂移上限 = skew * size = 8px = 0.32 格，估计场应与之同量级
    expect(warp!.maxResidual).toBeLessThan(0.6);
    // 每个块中心采样：偏移应接近该处真值（±0.1 格）
    const truthAt = (x: number, y: number) => ({ dx: drift(x, y), dy: skew * (y / size) * x });
    let worst = 0;
    for (let tj = 0; tj < warp!.rows; tj += 1) {
      for (let ti = 0; ti < warp!.cols; ti += 1) {
        const cx = warp!.originX + (ti + 0.5) * warp!.tileCells * cell;
        const cy = warp!.originY + (tj + 0.5) * warp!.tileCells * cell;
        const off = warpOffsetAt(warp!, cx, cy);
        const truth = truthAt(cx, cy);
        worst = Math.max(worst, Math.abs(off.dx - truth.dx), Math.abs(off.dy - truth.dy));
      }
    }
    expect(worst / cell).toBeLessThan(0.15);
  });
});

describe('warpOffsetAt', () => {
  const field = {
    tileCells: 2, cols: 2, rows: 2,
    originX: 0, originY: 0, cellSize: 10,
    dx: Float64Array.from([0, 20, 0, 20]),
    dy: Float64Array.from([0, 0, 30, 30]),
    maxResidual: 3,
  };

  it('returns exact tile-center offsets', () => {
    // 块 (0,0) 中心：格坐标 (1,1) → px (15,15)
    expect(warpOffsetAt(field, 15, 15)).toEqual({ dx: 0, dy: 0 });
    // 块 (1,0) 中心：格坐标 (3,1) → px (35,15)
    expect(warpOffsetAt(field, 35, 15)).toEqual({ dx: 20, dy: 0 });
    // 块 (0,1) 中心：格坐标 (1,3) → px (15,35)
    expect(warpOffsetAt(field, 15, 35)).toEqual({ dx: 0, dy: 30 });
    // 块 (1,1) 中心：px (35,35)
    expect(warpOffsetAt(field, 35, 35)).toEqual({ dx: 20, dy: 30 });
  });

  it('bilinearly interpolates between tile centers', () => {
    // 两块中心的中点：px (25,15) → dx = 10
    expect(warpOffsetAt(field, 25, 15).dx).toBeCloseTo(10, 6);
    // 垂直中点：px (15,25) → dy = 15
    expect(warpOffsetAt(field, 15, 25).dy).toBeCloseTo(15, 6);
  });

  it('clamps outside the field instead of extrapolating', () => {
    expect(warpOffsetAt(field, -50, 15).dx).toBe(0);
    expect(warpOffsetAt(field, 500, 15).dx).toBe(20);
  });
});
