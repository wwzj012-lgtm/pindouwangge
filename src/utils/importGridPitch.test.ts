import { describe, expect, it } from 'vitest';
import type { ImportImagePixels } from './importRecognition';
import { estimateBeadPitch } from './importGridPitch';

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

describe('bead pitch estimate', () => {
  it('recovers the pitch of a tiled bead photo', () => {
    const colors: Rgb[] = [[232, 232, 230], [150, 158, 166], [40, 60, 90], [120, 90, 180], [26, 26, 28]];
    let seed = 11;
    const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const cell = 9;
    const grid = Array.from({ length: 20 }, () => Array.from({ length: 20 }, () => Math.floor(rand() * colors.length)));
    const image = build(180, (x, y) => {
      const [r, g, b] = colors[grid[Math.floor(y / cell)][Math.floor(x / cell)]];
      const noise = ((x * 7919 + y * 104729) % 7) - 3;
      return [r + noise, g + noise, b + noise];
    });

    const estimate = estimateBeadPitch(image);
    expect(estimate).not.toBeNull();
    // 9 的整数倍也是"相似"的位移，允许它在 9 / 18 之间选，但不能漂到别处
    expect([9, 18]).toContain(estimate!.cellX);
    expect([9, 18]).toContain(estimate!.cellY);
    expect(estimate!.confidence).toBeGreaterThan(0.2);
  });

  it('never merges neighbouring beads into one cell', () => {
    // 18px 的块、块内 9px 处还有一道边：两个周期都真实存在。
    // 这时的规矩是"宁细勿粗"——报 9（把一颗豆切成 4 格）只是分辨率偏高，
    // 报 36（四颗豆并成一格）会把颜色平均掉，正是这次要修的那种糊。
    const image = build(180, (x, y) => {
      const inCell = (x % 18) < 9 && (y % 18) < 9;
      return inCell ? [40, 60, 90] : [200, 200, 196];
    });
    const estimate = estimateBeadPitch(image);
    expect(estimate).not.toBeNull();
    expect(18 % estimate!.cellX).toBe(0);
    expect(18 % estimate!.cellY).toBe(0);
    expect(estimate!.confidence).toBeGreaterThan(0.2);
  });

  it('reports low confidence on a smooth gradient with no beads', () => {
    const image = build(180, (x, y) => [x, y, 128]);
    const estimate = estimateBeadPitch(image);
    // 完全平滑时任何位移都"同样相似"，应当给出很低的置信度（或直接放弃）
    if (estimate) expect(estimate.confidence).toBeLessThan(0.25);
  });

  it('ignores images that are too small to measure', () => {
    expect(estimateBeadPitch({ data: new Uint8ClampedArray(16 * 16 * 4), width: 16, height: 16 })).toBeNull();
  });
});
