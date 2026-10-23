import { afterEach, describe, expect, it, vi } from 'vitest';
import { generatePatternCanvas, type ExportOptions } from './exportUtils';

afterEach(() => vi.unstubAllGlobals());
describe('large public-pattern export allocation safety', () => {
  it('still renders a single original-size board from the same 900-square pattern', () => {
    const canvas = { width: 0, height: 0, getContext: vi.fn(() => null) };
    vi.stubGlobal('document', { createElement: vi.fn(() => canvas) });
    const grid = Array.from({ length: 900 }, () => Array(900).fill(null));
    const options: ExportOptions = {
      width: 900, height: 900, grid, paletteMap: new Map(), selectedBoardIndex: 0,
      boardSize: 26, brandName: 'MARD', projectName: 'Public original', beadShape: 'square', exportQuality: 'high',
      showSymbols: true, showCoordinates: true, watermarkType: 'double_diagonal', legendPosition: 'right', legendScaleMode: 'auto',
    };
    expect(generatePatternCanvas(options)).toBe(canvas);
    expect(canvas.width * canvas.height).toBeLessThan(40_000_000);
    expect(canvas.width).toBeGreaterThan(26 * 28);
    expect(options.width).toBe(900);
    expect(options.height).toBe(900);
    expect(options.grid).toBe(grid);
  });
  it.each(['high', 'ultra'] as const)('rejects oversized %s PNG before creating a multi-gigabyte canvas', quality => {
    const createElement = vi.fn(() => { throw new Error('allocated unsafe canvas'); });
    vi.stubGlobal('document', { createElement });
    const options: ExportOptions = {
      width: 900, height: 900, grid: Array.from({ length: 900 }, () => Array(900).fill(null)), paletteMap: new Map(),
      boardSize: 26, brandName: 'MARD', projectName: 'Public original', beadShape: 'square', exportQuality: quality,
      showSymbols: true, showCoordinates: true, watermarkType: 'double_diagonal', legendPosition: 'right', legendScaleMode: 'auto',
    };
    expect(() => generatePatternCanvas(options)).toThrow(/分板|boards/);
    expect(createElement).not.toHaveBeenCalled();
  });
});
