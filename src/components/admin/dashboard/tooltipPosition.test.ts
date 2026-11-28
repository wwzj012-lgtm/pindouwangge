import { describe, expect, it } from 'vitest';
import { placeChartTooltip, placeTooltip } from './tooltipPosition';

/**
 * 悬浮提示避让（PRD §4 验收：峰值日与首末日 hover 均不遮挡、不溢出卡片）。
 * 纯函数，无 DOM：给定点位与尺寸，必须返回上下避让 + 水平钳位后的落点。
 */

const base = { plotWidth: 600, plotHeight: 200, tipWidth: 180, tipHeight: 70 };
const call = (input: Partial<Parameters<typeof placeTooltip>[0]>) => placeTooltip({ ...base, pointX: 300, pointY: 100, ...input });

describe('tooltip placement: vertical avoidance', () => {
  it('puts the tip below a point in the upper half of the plot', () => {
    const result = call({ pointY: 20 });
    expect(result.placement).toBe('below');
    expect(result.y).toBe(32); // 20 + 12 gap
  });
  it('puts the tip above a point in the lower half of the plot', () => {
    const result = call({ pointY: 160 });
    expect(result.placement).toBe('above');
    expect(result.y).toBe(78); // 160 - 70 - 12
  });
  it('treats the exact vertical middle as the lower half (above placement)', () => {
    expect(call({ pointY: 100 }).placement).toBe('above');
  });
  it('never lets the tip leave the plot vertically', () => {
    // 顶点在上半部 → 放下方 12px；底部点 → 上方（199-70-12=117），仍在绘图区内。
    expect(call({ pointY: 0 }).y).toBe(12);
    expect(call({ pointY: 199 }).y).toBe(117);
    // 点超出绘图区底部时钳到内边界，不溢出卡片。
    expect(call({ pointY: 400 }).y).toBe(200 - 70);
  });
  it('honours a custom gap', () => {
    expect(call({ pointY: 20, gap: 4 }).y).toBe(24);
    expect(call({ pointY: 160, gap: 0 }).y).toBe(90);
  });
});

describe('tooltip placement: horizontal clamping', () => {
  it('centers the tip on the point when there is room', () => {
    expect(call({ pointX: 300 }).x).toBe(210); // 300 - 90
  });
  it('clamps to the left edge at the first data point', () => {
    expect(call({ pointX: 4 }).x).toBe(0);
  });
  it('clamps to the right edge at the last data point', () => {
    // 600 - 180 = 420：右侧不溢出。
    expect(call({ pointX: 596 }).x).toBe(420);
  });
  it('left-aligns when the tip is wider than the plot', () => {
    const result = placeTooltip({ ...base, plotWidth: 120, tipWidth: 180, pointX: 60, pointY: 20 });
    expect(result.x).toBe(0);
  });
});

describe('tooltip placement: four corners and midpoints stay inside the card', () => {
  const corners = [
    { name: 'top-left', pointX: 0, pointY: 0 },
    { name: 'top-right', pointX: 600, pointY: 0 },
    { name: 'bottom-left', pointX: 0, pointY: 200 },
    { name: 'bottom-right', pointX: 600, pointY: 200 },
    { name: 'mid-top', pointX: 300, pointY: 0 },
    { name: 'mid-bottom', pointX: 300, pointY: 200 },
    { name: 'mid-left', pointX: 0, pointY: 100 },
    { name: 'mid-right', pointX: 600, pointY: 100 },
  ];
  it.each(corners)('keeps $name inside the plot box', ({ pointX, pointY }) => {
    const { x, y } = call({ pointX, pointY });
    expect(x).toBeGreaterThanOrEqual(0);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(x + base.tipWidth).toBeLessThanOrEqual(base.plotWidth);
    expect(y + base.tipHeight).toBeLessThanOrEqual(base.plotHeight);
    expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
  });
  it('never overlaps the point it describes', () => {
    // 上方放置时提示底边在点上方 ≥ gap；下方放置时提示顶边在点下方 ≥ gap。
    const above = call({ pointY: 160 });
    expect(above.y + base.tipHeight).toBeLessThanOrEqual(160);
    const below = call({ pointY: 20 });
    expect(below.y).toBeGreaterThanOrEqual(20);
  });
});

describe('chart tooltip keeps clear of the Y-axis gutters (first/last day)', () => {
  // 真实图表：容器 900×220，左轴 34px、右轴 34px、上 8px、下 24px（X 轴标签）。
  const gutter = { left: 34, right: 34, top: 8, bottom: 24 };
  const box = { boxWidth: 900, boxHeight: 220 };
  const tip = { tipWidth: 190, tipHeight: 86 };

  it('first day: the tooltip stays right of the left axis gutter instead of covering tick labels', () => {
    // recharts 在首日的 activeCoordinate.x 就是绘图区左边界（= gutter.left）。
    const result = placeChartTooltip({ ...box, ...tip, gutter, pointX: 34, pointY: 180 });
    expect(result.x).toBeGreaterThanOrEqual(gutter.left);
    expect(result.x + tip.tipWidth).toBeLessThanOrEqual(box.boxWidth - gutter.right);
    expect(result.placement).toBe('above');
  });

  it('last day: the tooltip stays left of the right axis gutter and inside the card', () => {
    const result = placeChartTooltip({ ...box, ...tip, gutter, pointX: box.boxWidth - gutter.right, pointY: 180 });
    expect(result.x + tip.tipWidth).toBeLessThanOrEqual(box.boxWidth - gutter.right);
    expect(result.x).toBeGreaterThanOrEqual(gutter.left);
    expect(result.y).toBeGreaterThanOrEqual(0);
  });

  it('falls back to the gutter offset when the plot box is degenerate', () => {
    const result = placeChartTooltip({ ...box, ...tip, gutter, pointX: 0, pointY: 0, boxWidth: 40, boxHeight: 40 });
    expect(Number.isFinite(result.x) && Number.isFinite(result.y)).toBe(true);
    expect(result.x).toBeGreaterThanOrEqual(0);
  });
});
