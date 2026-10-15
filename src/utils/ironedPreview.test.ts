import { describe, expect, it, vi } from 'vitest';
import { drawBeadOnCanvas } from './exportUtils';
import { drawPreviewBeadOnCanvas } from './ironedPreview';

vi.mock('./exportUtils', () => ({ drawBeadOnCanvas: vi.fn() }));

function context(dpr = 1) {
  return {
    getTransform: () => ({ a: dpr, d: dpr, e: 0, f: 0 }),
    fillRect: vi.fn(), beginPath: vi.fn(), roundRect: vi.fn(), fill: vi.fn(),
    save: vi.fn(), restore: vi.fn(), rect: vi.fn(), clip: vi.fn(),
    fillStyle: '',
  } as unknown as CanvasRenderingContext2D;
}

describe('view-only fused surface', () => {
  it.each(['fuse_3d', 'circle_flat', 'square'] as const)('delegates %s without changing arguments', shape => {
    const ctx = context();
    drawPreviewBeadOnCanvas(ctx, 2, 3, 20, '#CC3344', shape, 'A1');
    expect(drawBeadOnCanvas).toHaveBeenLastCalledWith(ctx, 2, 3, 20, '#CC3344', shape, 'A1');
  });

  it('fills the exact shared cell rectangle with no code or legacy bead rendering', () => {
    const ctx = context();
    const grid = [['R', 'R', 'B'], ['R', 'R', 'B'], ['R', 'R', 'B']];
    const before = JSON.stringify(grid);
    vi.mocked(drawBeadOnCanvas).mockClear();
    drawPreviewBeadOnCanvas(ctx, 20, 20, 20, '#CC3344', 'ironed', 'A1', grid, 1, 1);
    expect(ctx.fillRect).toHaveBeenCalledWith(20, 20, 20, 20);
    expect(ctx.fillStyle).toBe('#CC3344');
    expect(drawBeadOnCanvas).not.toHaveBeenCalled();
    expect(JSON.stringify(grid)).toBe(before);
  });

  it('only rounds exposed corners, including next to a different occupied color', () => {
    const ctx = context();
    drawPreviewBeadOnCanvas(ctx, 0, 0, 20, '#CC3344', 'ironed', null, [['R', 'B']], 0, 0);
    expect(ctx.roundRect).toHaveBeenCalledWith(0, 0, 20, 20, [2, 0, 0, 2]);
  });

  it('skips explicit nulls and keeps a diagonal bead separate', () => {
    const ctx = context();
    const grid = [['R', null], [null, 'B']];
    drawPreviewBeadOnCanvas(ctx, 20, 0, 20, '#CC3344', 'ironed', null, grid, 1, 0);
    expect(ctx.fill).not.toHaveBeenCalled();
    expect(ctx.fillRect).not.toHaveBeenCalled();
    drawPreviewBeadOnCanvas(ctx, 0, 0, 20, '#CC3344', 'ironed', null, grid, 0, 0);
    expect(ctx.roundRect).toHaveBeenCalledWith(0, 0, 20, 20, [2, 2, 2, 2]);
  });

  it('snaps both shared edges at low zoom / HiDPI without eroding a thin line', () => {
    const ctx = context(2);
    drawPreviewBeadOnCanvas(ctx, 0.35, 0.35, 2.6, '#CC3344', 'ironed', null, [['R', 'R']], 0, 0);
    drawPreviewBeadOnCanvas(ctx, 2.95, 0.35, 2.6, '#CC3344', 'ironed', null, [['R', 'R']], 1, 0);
    expect(ctx.fillRect).toHaveBeenNthCalledWith(1, 0.5, 0.5, 2.5, 2.5);
    expect(ctx.fillRect).toHaveBeenNthCalledWith(2, 3, 0.5, 2.5, 2.5);
  });

  it('joins half-pixel ties even when neighboring positions accumulate different float error', () => {
    const ctx = context();
    const grid = Array.from({ length: 6 }, () => ['R', 'R', 'R']);
    const size = 27.166666666666668;
    const origin = 88.83333333333331;
    drawPreviewBeadOnCanvas(ctx, 20, origin + 3 * size, size, '#CC3344', 'ironed', null, grid, 1, 3);
    drawPreviewBeadOnCanvas(ctx, 20, origin + 4 * size, size, '#CC3344', 'ironed', null, grid, 1, 4);
    const first = vi.mocked(ctx.fillRect).mock.calls[0];
    const second = vi.mocked(ctx.fillRect).mock.calls[1];
    expect(first[1] + first[3]).toBe(second[1]);
  });

  it('keeps tiny diagonal silhouettes square to avoid antialias spill into nulls', () => {
    const ctx = context(2);
    drawPreviewBeadOnCanvas(ctx, 0.35, 0.35, 7.3, '#CC3344', 'ironed', null, [['R', null], [null, 'B']], 0, 0);
    expect(ctx.fillRect).toHaveBeenCalledWith(0.5, 0.5, 7, 7);
    expect(ctx.roundRect).not.toHaveBeenCalled();
  });

  it('uses whole physical-pixel corner radii at fractional HiDPI zoom', () => {
    const ctx = context(2);
    drawPreviewBeadOnCanvas(ctx, 0.35, 0.35, 19.6, '#CC3344', 'ironed', null, [['R', null], [null, 'B']], 0, 0);
    expect(ctx.roundRect).toHaveBeenCalledWith(0.5, 0.5, 19.5, 19.5, [2, 2, 2, 2]);
  });
});
