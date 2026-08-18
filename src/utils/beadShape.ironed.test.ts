import { describe, expect, it, vi } from 'vitest';
import { drawBeadOnCanvas } from './exportUtils';

function createCanvasContext(): CanvasRenderingContext2D {
  return {
    beginPath: vi.fn(),
    roundRect: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
}

describe('ironed bead rendering', () => {
  it('draws a filled fused surface with a softened center recess without changing the caller grid', () => {
    const grid: (string | null)[][] = [['M01', null], [null, 'M02']];
    const before = grid.map((row) => [...row]);
    const context = createCanvasContext();

    drawBeadOnCanvas(context, 0, 0, 20, '#7C3AED', 'ironed');

    expect(context.roundRect).toHaveBeenCalledOnce();
    expect(context.arc).toHaveBeenCalledOnce();
    expect(context.fill).toHaveBeenCalledTimes(2);
    expect(context.stroke).toHaveBeenCalledOnce();
    expect(grid).toEqual(before);
  });

  it('keeps the fourth display mode in the shared Toolbar segmented control', async () => {
    const source = await import('node:fs').then(({ readFileSync }) => readFileSync(new URL('../components/Toolbar.tsx', import.meta.url), 'utf8'));

    expect(source).toContain("setBeadShape('ironed')");
    expect(source).toContain('熨烫预览');
    expect(source).toContain('shapeButtonClass');
  });
});
