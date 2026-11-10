import { describe, expect, it } from 'vitest';
import type { ImportImagePixels } from './importRecognition';
import { estimateBeadPitch, refineGridAlignment } from './importGridPitch';

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

describe('grid alignment refinement', () => {
  /** 印刷格线图：底色亮、格线暗 60+ 灰度（满足暗线投影"暗于两侧±3px"判定）。 */
  function buildLines(size: number, pitchX: number, pitchY: number): ImportImagePixels {
    const data = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const onLine = x % pitchX < 2 || y % pitchY < 2;
        const offset = (y * size + x) * 4;
        const [r, g, b] = onLine ? [90, 96, 104] : [210, 208, 202];
        data[offset] = r; data[offset + 1] = g; data[offset + 2] = b; data[offset + 3] = 255;
      }
    }
    return { data, width: size, height: size };
  }

  it('repairs far-edge drift from a rough manual alignment', () => {
    // 真格距 12.3（小数，和妲己图 29.6 同类）。手动对齐格距偏 2%、原点偏 0.8px：
    // 第 19 格的预测位置漂出 5px（大半格）——正是"近处齐、远处歪"。
    const image = buildLines(246, 12.3, 12.3);
    const rough = { originX: 0.8, originY: 0.8, cellSize: 12.55 };
    const drift = rough.originX + 19 * rough.cellSize;
    expect(Math.abs(drift - 234)).toBeGreaterThan(4); // 确认初值在远端确实歪

    const refinement = refineGridAlignment(image, rough);
    expect(refinement.applied).toBe(true);
    expect(Math.abs(refinement.cell - 12.3)).toBeLessThan(0.2);
    // 原点一律不动：用户拖的锚点必须原样保留
    expect(refinement.originX).toBe(rough.originX);
    expect(refinement.originY).toBe(rough.originY);
    expect(refinement.confidence).toBeGreaterThan(0.5);
    // 格距修正后第 19 格的预测贴住真实格线（远端漂移被抹平）
    const repaired = refinement.originX + 19 * refinement.cell;
    expect(Math.abs(repaired - 234)).toBeLessThan(2);
    expect(refinement.stretched).toBe(false);
  });

  it('leaves the alignment untouched when no grid lines exist', () => {
    const gradient = buildLines(180, 1e9, 1e9); // 无格线：全亮底
    const rough = { originX: 3, originY: 4, cellSize: 20 };
    const refinement = refineGridAlignment(gradient, rough);
    expect(refinement.applied).toBe(false);
    expect(refinement.cell).toBe(20);
    expect(refinement.originX).toBe(3);
    expect(refinement.message).toContain('格线');
  });

  it('keeps the user-anchored origin instead of jumping a whole lattice', () => {
    // 用户把网格拖到 origin=100.5：精修不得以任何理由移动它（哪怕是半格内的
    // "微调"）——浅格线图纸的投影峰来自格中央的色号文字，相位天然偏半格，
    // 任何基于峰列相位的原点修正都会把对齐好的网格挪到文字中心上。
    const image = buildLines(246, 12.3, 12.3);
    const anchored = { originX: 100.5, originY: 100.5, cellSize: 12.55 };
    const refinement = refineGridAlignment(image, anchored);
    expect(refinement.applied).toBe(true);
    expect(Math.abs(refinement.cell - 12.3)).toBeLessThan(0.2);
    expect(refinement.originX).toBe(100.5);
    expect(refinement.originY).toBe(100.5);
  });

  it('flags non-uniform stretching instead of failing silently', () => {
    // 横 12.3 / 纵 13.8（差 12%）：两轴都能在 ±8% 窗口内锁到，但必须警示拉伸
    const image = buildLines(276, 12.3, 13.8);
    const refinement = refineGridAlignment(image, { originX: 1, originY: 1, cellSize: 13.05 });
    expect(refinement.applied).toBe(true);
    expect(refinement.stretched).toBe(true);
    expect(refinement.message).toContain('拉伸');
  });
});
