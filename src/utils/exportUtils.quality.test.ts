import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BeadColor } from '../types';
import { generatePatternCanvas, PatternExportSizeError, type ExportOptions, type ExportQuality } from './exportUtils';

type Matrix = [number, number, number, number, number, number];
type Event = { method: string; args: unknown[]; matrix: Matrix; state: typeof initialState };
const initialState = {
  fillStyle: '#000000', strokeStyle: '#000000', lineWidth: 1, globalAlpha: 1,
  font: '10px sans-serif', textAlign: 'start', textBaseline: 'alphabetic', dash: [] as number[],
};

// Canvas-state spy: transform composition and save/restore match the 2D API.
// Record paths, clips and text as well as paints so an unscaled header/legend/
// watermark, font, dash or line width cannot hide behind square cell arguments.
function canvasSpy() {
  const events: Event[] = [];
  const state = structuredClone(initialState);
  const snapshotState = () => Object.fromEntries(Object.keys(initialState).map(key =>
    [key, structuredClone(state[key as keyof typeof initialState])])) as typeof initialState;
  let matrix: Matrix = [1, 0, 0, 1, 0, 0];
  const stack: { state: typeof initialState; matrix: Matrix }[] = [];
  const multiply = ([a, b, c, d, e, f]: Matrix) => {
    const [A, B, C, D, E, F] = matrix;
    matrix = [A * a + C * b, B * a + D * b, A * c + C * d, B * c + D * d, A * e + C * f + E, B * e + D * f + F];
  };
  const ctx = Object.assign(state, {
    scale: (x: number, y: number) => multiply([x, 0, 0, y, 0, 0]),
    translate: (x: number, y: number) => multiply([1, 0, 0, 1, x, y]),
    rotate: (angle: number) => multiply([Math.cos(angle), Math.sin(angle), -Math.sin(angle), Math.cos(angle), 0, 0]),
    setTransform: (...value: Matrix) => { matrix = [...value]; },
    setLineDash: (dash: number[]) => { state.dash = [...dash]; },
    save: () => { stack.push({ state: snapshotState(), matrix: [...matrix] }); },
    restore: () => {
      const saved = stack.pop();
      if (!saved) throw new Error('Unbalanced canvas restore');
      Object.assign(state, saved.state);
      matrix = saved.matrix;
    },
  });
  for (const method of ['beginPath', 'moveTo', 'lineTo', 'rect', 'roundRect', 'arc', 'fill', 'stroke', 'fillRect', 'strokeRect', 'fillText', 'clip']) {
    Object.assign(ctx, { [method]: (...args: unknown[]) => events.push({
      method, args, matrix: [...matrix],
      state: snapshotState(),
    }) });
  }
  const canvas = { width: 0, height: 0, getContext: vi.fn(() => ctx) };
  vi.stubGlobal('document', { createElement: vi.fn(() => canvas) });
  return { canvas, events, stack };
}

function options(overrides: Partial<ExportOptions> = {}): ExportOptions {
  const width = overrides.width ?? 12;
  const height = overrides.height ?? 11;
  const paletteMap = new Map<string, BeadColor>(Array.from({ length: 36 }, (_, i) => [
    `c${i}`, { id: `c${i}`, code: `M${i}`, name: `Color ${i}`, hex: '#123456', rgb: [18, 52, 86], brand: 'MARD', symbol: '★' },
  ]));
  return {
    width, height, grid: Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) =>
      (x + y) % 7 === 0 ? null : `c${(y * width + x) % 36}`)),
    paletteMap, boardSize: 26, brandName: 'MARD', projectName: 'Quality layout', beadShape: 'square',
    showSymbols: true, showCoordinates: true, watermarkType: 'none', exportQuality: 'high', ...overrides,
  };
}

function render(input: ExportOptions) {
  const spy = canvasSpy();
  expect(generatePatternCanvas(input)).toBe(spy.canvas);
  expect(spy.stack).toHaveLength(0);
  return spy;
}

const factors: Record<ExportQuality, number> = { normal: 1 / 1.4, high: 1, ultra: 2 / 1.4 };
const logicalEvents = (events: Event[]) => events.map(({ matrix: _matrix, ...event }) => event);

function expectDensityOnly(input: ExportOptions) {
  const hd = render({ ...input, exportQuality: 'high' });
  for (const exportQuality of ['normal', 'ultra'] as const) {
    const factor = factors[exportQuality];
    const actual = render({ ...input, exportQuality });
    expect(actual.canvas.width).toBe(Math.round(hd.canvas.width * factor));
    expect(actual.canvas.height).toBe(Math.round(hd.canvas.height * factor));
    // At most half a physical pixel per dimension is introduced by rounding.
    const ratio = hd.canvas.width / hd.canvas.height;
    expect(Math.abs(actual.canvas.width - ratio * actual.canvas.height)).toBeLessThanOrEqual(0.5 + ratio * 0.5 + 1e-9);
    expect(logicalEvents(actual.events)).toEqual(logicalEvents(hd.events));
    for (let i = 0; i < actual.events.length; i++) {
      actual.events[i].matrix.forEach((component, index) => {
        expect(component).toBeCloseTo(hd.events[i].matrix[index] * factor, 9);
      });
    }
    const grid = actual.events.find(event => event.method === 'fillRect' && event.state.fillStyle === '#F1F5F9')!;
    const [left, top, gridWidth, gridHeight] = grid.args as number[];
    const board = input.selectedBoardIndex;
    const startX = board == null ? 0 : board % Math.ceil(input.width / input.boardSize) * input.boardSize;
    const startY = board == null ? 0 : Math.floor(board / Math.ceil(input.width / input.boardSize)) * input.boardSize;
    const columns = board == null ? input.width : Math.min(input.boardSize, input.width - startX);
    const rows = board == null ? input.height : Math.min(input.boardSize, input.height - startY);
    const physicalCellX = gridWidth / columns * Math.hypot(grid.matrix[0], grid.matrix[1]);
    const physicalCellY = gridHeight / rows * Math.hypot(grid.matrix[2], grid.matrix[3]);
    expect(physicalCellX).toBeCloseTo(physicalCellY, 10);
    const beads = actual.events.filter(event => event.method === 'fillRect' && event.state.fillStyle === '#123456' &&
      (event.args[0] as number) >= left && (event.args[0] as number) < left + gridWidth &&
      (event.args[1] as number) >= top && (event.args[1] as number) < top + gridHeight);
    if (input.beadShape === 'square') {
      const visibleCount = input.grid.slice(startY, startY + rows).reduce((sum, row) => sum + row.slice(startX, startX + columns).filter(Boolean).length, 0);
      expect(beads).toHaveLength(visibleCount);
      for (const bead of beads) {
        expect(bead.args[2]).toBe(gridWidth / columns);
        expect(bead.args[3]).toBe(gridHeight / rows);
        expect((bead.args[2] as number) * Math.hypot(bead.matrix[0], bead.matrix[1])).toBeCloseTo(physicalCellX, 10);
      }
    }
  }
}

afterEach(() => vi.unstubAllGlobals());

describe('export quality changes only pixel density, never HD logical layout', () => {
  const views = [
    { width: 12, height: 11 },
    { width: 41, height: 25 },
    { width: 81, height: 23 },
    { width: 121, height: 17 },
    { width: 60, height: 59, selectedBoardIndex: 8 },
  ];
  for (const view of views) {
    for (const legendPosition of ['right', 'bottom'] as const) {
      for (const legendScaleMode of ['auto', '3.0'] as const) {
        it.each([false, true])(`${JSON.stringify(view)}, ${legendPosition}/${legendScaleMode}, empty=%s`, empty => {
          const input = options({ ...view, legendPosition, legendScaleMode });
          if (empty) input.grid = input.grid.map(row => row.map(() => null));
          const before = structuredClone({ grid: input.grid, paletteMap: input.paletteMap });
          expectDensityOnly(input);
          expect({ grid: input.grid, paletteMap: input.paletteMap }).toEqual(before);
        });
      }
    }
  }

  it.each(['none', 'corners', 'bottom', 'double_diagonal'] as const)('uniformly scales clips, opacity, rotation and fonts for watermark=%s', watermarkType => {
    expectDensityOnly(options({ watermarkType, watermarkText: 'Licensed mark', watermarkOpacity: 0.17, watermarkAngle: -31, watermarkColor: '#987654' }));
  });

  it.each(['circle_flat', 'ironed', 'fuse_3d'] as const)('also preserves %s paths, peg dots and symbol layout without coordinates', beadShape => {
    expectDensityOnly(options({ beadShape, showCoordinates: false, symbolDisplayType: 'symbol', symbolFontScale: 1.3, legendPosition: 'bottom', isEn: true }));
  });

  it('preserves hidden empty pegs and suppressed symbols at manual 1.0 legend scale', () => {
    expectDensityOnly(options({ hideEmptyPegs: true, showSymbols: false, symbolDisplayType: 'none', legendScaleMode: '1.0' }));
  });

  it('defaults to unchanged HD output', () => {
    const implicit = render(options({ exportQuality: undefined }));
    const explicit = render(options());
    expect(implicit.canvas.width).toBe(explicit.canvas.width);
    expect(implicit.canvas.height).toBe(explicit.canvas.height);
    expect(implicit.events).toEqual(explicit.events);
  });

  it('reproduces HD to ultra composition drift independently of normal quality', () => {
    const input = options();
    const hd = render(input);
    const ultra = render({ ...input, exportQuality: 'ultra' });
    expect(ultra.canvas.width).toBe(Math.round(hd.canvas.width * factors.ultra));
    expect(ultra.canvas.height).toBe(Math.round(hd.canvas.height * factors.ultra));
    expect(logicalEvents(ultra.events)).toEqual(logicalEvents(hd.events));
  });

  it.each(['right', 'bottom'] as const)('pins existing HD dimensions and the entire draw trace: %s', legendPosition => {
    const hd = render(options({ legendPosition }));
    const digest = createHash('sha256').update(JSON.stringify(hd.events)).digest('hex');
    // Captured from the original HD renderer before the density-only fix.
    const baseline = legendPosition === 'right'
      ? { width: 1373, height: 569, digest: 'd6f53216a61473c1d34764eb7cb0b7950d8eccb12a308ecb491014f53ef149d2' }
      : { width: 548, height: 1230, digest: '54f4024fc5f83783eb2817ff1a0a023545201f8893d733fd76a67c9c7455c271' };
    expect({ width: hd.canvas.width, height: hd.canvas.height, digest }).toEqual(baseline);
  });
});

describe('40M pixel gate uses rounded final physical dimensions before allocation', () => {
  it.each([
    { width: 124, height: 881, exportQuality: 'normal' as const, hdWidth: 3533, hdHeight: 22188, allowed: false },
    { width: 125, height: 875, exportQuality: 'normal' as const, hdWidth: 3558, hdHeight: 22038, allowed: true },
  ])('takes integer rounding into account at the budget boundary: $width x $height, $exportQuality', fixture => {
    const { width, height, exportQuality, hdWidth, hdHeight, allowed } = fixture;
    const factor = factors[exportQuality];
    const physicalWidth = Math.round(hdWidth * factor);
    const physicalHeight = Math.round(hdHeight * factor);
    // Each fixture crosses the budget boundary solely because of rounding.
    expect(hdWidth * hdHeight * factor ** 2 <= 40_000_000).toBe(!allowed);
    expect(physicalWidth * physicalHeight <= 40_000_000).toBe(allowed);
    const spy = canvasSpy();
    spy.canvas.getContext.mockReturnValue(null as never);
    const input = options({ width, height, exportQuality });
    if (allowed) {
      expect(generatePatternCanvas(input)).toBe(spy.canvas);
      expect(spy.canvas).toMatchObject({ width: physicalWidth, height: physicalHeight });
    } else {
      expect(() => generatePatternCanvas(input)).toThrow(PatternExportSizeError);
      expect(document.createElement).not.toHaveBeenCalled();
    }
  });

  it.each(['normal', 'high', 'ultra'] as const)('checks %s physical output, leaving original cells untouched', exportQuality => {
    const input = options({ width: 300, height: 180, exportQuality });
    const before = structuredClone(input.grid);
    const spy = canvasSpy();
    // HD fits (~37M), ultra exceeds 40M. Null context avoids recording 54k cells.
    spy.canvas.getContext.mockReturnValue(null as never);
    if (exportQuality === 'ultra') {
      expect(() => generatePatternCanvas(input)).toThrow(PatternExportSizeError);
      expect(document.createElement).not.toHaveBeenCalled();
    } else {
      expect(generatePatternCanvas(input)).toBe(spy.canvas);
      expect(spy.canvas.width * spy.canvas.height).toBeLessThanOrEqual(40_000_000);
    }
    expect(input.grid).toEqual(before);
  });

  it('permits normal density even when the HD logical canvas exceeds 40M', () => {
    const input = options({ width: 360, height: 200 });
    const spy = canvasSpy();
    spy.canvas.getContext.mockReturnValue(null as never);
    expect(() => generatePatternCanvas(input)).toThrow(PatternExportSizeError);
    expect(document.createElement).not.toHaveBeenCalled();
    expect(generatePatternCanvas({ ...input, exportQuality: 'normal' })).toBe(spy.canvas);
    expect(spy.canvas.width * spy.canvas.height).toBeLessThanOrEqual(40_000_000);
  });
});
