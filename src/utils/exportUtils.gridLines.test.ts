import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BeadColor } from '../types';
import * as exporter from './exportUtils';

type Command = { method: string; args: number[] };
type Paint = {
  method: string;
  args: number[];
  path: Command[];
  strokeStyle: string;
  fillStyle: string;
  lineWidth: number;
  dash: number[];
};

// Record actual drawing calls with the canvas state at paint time, including
// save/restore. Merely spying on setLineDash would miss solid/dashed mix-ups.
function canvasSpy() {
  const paints: Paint[] = [];
  let path: Command[] = [];
  const state = { strokeStyle: '#000000', fillStyle: '#000000', lineWidth: 1, globalAlpha: 1 };
  let dash: number[] = [];
  const stack: { state: typeof state; dash: number[] }[] = [];
  const record = (method: string, args: number[] = []) => {
    paints.push({ method, args, path: structuredClone(path),
      strokeStyle: state.strokeStyle, fillStyle: state.fillStyle, lineWidth: state.lineWidth, dash: [...dash],
    });
  };
  const ctx = Object.assign(state, {
    beginPath: vi.fn(() => { path = []; }),
    moveTo: vi.fn((...args: number[]) => { path.push({ method: 'moveTo', args }); }),
    lineTo: vi.fn((...args: number[]) => { path.push({ method: 'lineTo', args }); }),
    rect: vi.fn((...args: number[]) => { path.push({ method: 'rect', args }); }),
    roundRect: vi.fn((...args: number[]) => { path.push({ method: 'roundRect', args }); }),
    arc: vi.fn((...args: number[]) => { path.push({ method: 'arc', args }); }),
    stroke: vi.fn(() => record('stroke')),
    fill: vi.fn(() => record('fill')),
    strokeRect: vi.fn((...args: number[]) => record('strokeRect', args)),
    fillRect: vi.fn((...args: number[]) => record('fillRect', args)),
    fillText: vi.fn((_text: string, _x: number, _y: number) => {}),
    setLineDash: vi.fn((value: number[]) => { dash = [...value]; }),
    save: vi.fn(() => { stack.push({ state: {
      strokeStyle: state.strokeStyle, fillStyle: state.fillStyle,
      lineWidth: state.lineWidth, globalAlpha: state.globalAlpha,
    }, dash: [...dash] }); }),
    restore: vi.fn(() => {
      const saved = stack.pop()!;
      Object.assign(state, saved.state);
      dash = saved.dash;
    }),
    clip: vi.fn(),
    scale: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
  });
  const canvas = { width: 0, height: 0, getContext: vi.fn(() => ctx) };
  vi.stubGlobal('document', { createElement: vi.fn(() => canvas) });
  return { ctx, paints, canvas };
}

function options(overrides: Partial<exporter.ExportOptions> = {}): exporter.ExportOptions {
  const width = overrides.width ?? 38;
  const height = overrides.height ?? 34;
  return {
    width, height, grid: Array.from({ length: height }, () => Array(width).fill(null)),
    paletteMap: new Map(), boardSize: 26, brandName: 'MARD', projectName: 'Grid test',
    beadShape: 'square', showSymbols: true, showCoordinates: true, hideEmptyPegs: true,
    watermarkType: 'none', exportQuality: 'normal', legendScaleMode: '1.0', ...overrides,
  };
}

function render(input: exporter.ExportOptions) {
  const spy = canvasSpy();
  expect(exporter.generatePatternCanvas(input)).toBe(spy.canvas);
  expect(spy.canvas.getContext).toHaveBeenCalledWith('2d');
  const background = spy.paints.find(p => p.method === 'fillRect' && p.fillStyle === '#F1F5F9')!;
  expect(background).toBeDefined();
  const [left, top, width, height] = background.args;
  const board = input.selectedBoardIndex;
  const startX = board == null ? 0 : board % Math.ceil(input.width / input.boardSize) * input.boardSize;
  const startY = board == null ? 0 : Math.floor(board / Math.ceil(input.width / input.boardSize)) * input.boardSize;
  const endX = board == null ? input.width : Math.min(input.width, startX + input.boardSize);
  const endY = board == null ? input.height : Math.min(input.height, startY + input.boardSize);
  const cell = width / (endX - startX);
  expect(height / (endY - startY)).toBe(cell);
  const inside = (x: number, y: number) => x >= left && x <= left + width && y >= top && y <= top + height;
  const gridStrokes = spy.paints.filter(p =>
    p.method === 'strokeRect' ? inside(p.args[0], p.args[1]) && inside(p.args[0] + p.args[2], p.args[1] + p.args[3]) :
      p.method === 'stroke' && p.path.length > 0 && p.path.every(c => inside(c.args[0], c.args[1])),
  );
  return { ...spy, left, top, width, height, cell, startX, startY, endX, endY, gridStrokes };
}

function expectCleanGrid(result: ReturnType<typeof render>) {
  const { gridStrokes, left, top, width, height, cell, startX, startY, endX, endY } = result;
  const frames = gridStrokes.filter(p => p.method === 'strokeRect');
  expect(frames).toHaveLength(1);
  expect(frames[0]).toMatchObject({ args: [left, top, width, height], dash: [] });
  expect(frames[0].strokeStyle).toBe('rgba(51, 65, 85, 0.75)');
  const expected: Partial<Paint>[] = [];
  for (const axis of ['x', 'y'] as const) {
    const start = axis === 'x' ? startX : startY;
    const end = axis === 'x' ? endX : endY;
    for (let coordinate = start + 1; coordinate < end; coordinate++) {
      if (coordinate % 5 !== 0) continue;
      const solid = coordinate % 10 === 0;
      const offset = (coordinate - start) * cell;
      expected.push({
        method: 'stroke',
        path: axis === 'x' ? [
          { method: 'moveTo', args: [left + offset, top] },
          { method: 'lineTo', args: [left + offset, top + height] },
        ] : [
          { method: 'moveTo', args: [left, top + offset] },
          { method: 'lineTo', args: [left + width, top + offset] },
        ],
        dash: solid ? [] : [4, 3], lineWidth: solid ? 1.6 : 1,
        strokeStyle: solid ? 'rgba(51, 65, 85, 0.75)' : 'rgba(100, 116, 139, 0.45)',
      });
    }
  }
  const lines = gridStrokes.filter(p => p.method === 'stroke');
  expect(lines).toHaveLength(expected.length);
  for (const line of expected) expect(lines).toContainEqual(expect.objectContaining(line));
  expect(result.paints.some(p => p.strokeStyle === 'rgba(59, 130, 246, 0.6)')).toBe(false);
}

function absoluteLines(result: ReturnType<typeof render>) {
  return result.gridStrokes.filter(p => p.method === 'stroke').map(p => {
    const [from, to] = p.path;
    const vertical = from.args[0] === to.args[0];
    return {
      axis: vertical ? 'x' : 'y',
      coordinate: vertical ? result.startX + (from.args[0] - result.left) / result.cell :
        result.startY + (from.args[1] - result.top) / result.cell,
      dash: p.dash, lineWidth: p.lineWidth, strokeStyle: p.strokeStyle,
    };
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('PNG canvas grid strokes', () => {
  describe.each([true, false])('showCoordinates=%s', showCoordinates => {
    it.each([
      { boardSize: 10, width: 32, height: 28 },
      { boardSize: 26, width: 133, height: 132 },
      { boardSize: 29, width: 293, height: 33 },
      { boardSize: 29, width: 33, height: 293 },
    ])('full image: $width x $height, boardSize=$boardSize (including shared 10/board multiples)', dimensions => {
      expectCleanGrid(render(options({ ...dimensions, showCoordinates })));
    });

    it.each([10, 26, 29])('boardSize=%s: first, nonzero-origin and partial edge boards align with full image', boardSize => {
      const input = options({ width: boardSize * 2 + 8, height: boardSize * 2 + 7, boardSize, showCoordinates });
      const full = render(input);
      for (const selectedBoardIndex of [0, 4, 8]) {
        const board = render({ ...input, selectedBoardIndex });
        expectCleanGrid(board);
        const expected = absoluteLines(full).filter(line => line.axis === 'x' ?
          line.coordinate > board.startX && line.coordinate < board.endX :
          line.coordinate > board.startY && line.coordinate < board.endY);
        expect(absoluteLines(board)).toEqual(expected);
        if (selectedBoardIndex === 8) {
          expect(board.width / board.cell).toBe(8);
          expect(board.height / board.cell).toBe(7);
        }
      }
    });
  });

  it.each([
    { symbolDisplayType: 'code' as const, showSymbols: true, labels: ['M01', '★', 'M03'] },
    { symbolDisplayType: 'symbol' as const, showSymbols: true, labels: ['A', '★', 'M03'] },
    { symbolDisplayType: 'none' as const, showSymbols: true, labels: [] },
    { symbolDisplayType: undefined, showSymbols: false, labels: [] },
  ])('keeps square color fills, nulls, missing colors, symbols and input data: $symbolDisplayType / $showSymbols', mode => {
    const paletteMap = new Map<string, BeadColor>([
      ['a', { id: 'a', code: 'M01', symbol: 'A', name: 'White', hex: '#FFFFFF', rgb: [255, 255, 255], brand: 'MARD' }],
      ['b', { id: 'b', code: '', symbol: '★', name: 'Red', hex: '#FF0022', rgb: [255, 0, 34], brand: 'MARD' }],
      ['c', { id: 'c', code: 'M03', name: 'Blue', hex: '#1122AA', rgb: [17, 34, 170], brand: 'MARD' }],
    ]);
    const grid = [['a', null, 'b', 'missing'], [null, 'c', null, 'a']];
    const before = structuredClone({ grid, paletteMap });
    const result = render(options({ width: 4, height: 2, grid, paletteMap, showCoordinates: false, ...mode }));
    expectCleanGrid(result);
    const fills = result.paints.filter(p => p.method === 'fillRect' && p.args[2] === result.cell && p.args[3] === result.cell);
    expect(fills.map(p => ({ color: p.fillStyle, x: (p.args[0] - result.left) / result.cell, y: (p.args[1] - result.top) / result.cell }))).toEqual([
      { color: '#FFFFFF', x: 0, y: 0 }, { color: '#FF0022', x: 2, y: 0 }, { color: '#CCCCCC', x: 3, y: 0 },
      { color: '#1122AA', x: 1, y: 1 }, { color: '#FFFFFF', x: 3, y: 1 },
    ]);
    const labels = result.ctx.fillText.mock.calls.filter(([, x, y]) =>
      x >= result.left && x < result.left + result.width && y >= result.top && y < result.top + result.height,
    ).map(([text]) => text);
    expect(labels).toEqual(mode.labels.length ? [...mode.labels, mode.labels[0]] : []);
    expect(result.ctx.fillText).toHaveBeenCalledWith('总用豆量: 5 粒 | 共 3 色', expect.any(Number), expect.any(Number));
    expect({ grid, paletteMap }).toEqual(before);
  });

  it('keeps selected-board colors/counts and empty peg visibility without mutating null cells', () => {
    const input = options({ width: 60, height: 59, boardSize: 26, selectedBoardIndex: 8, hideEmptyPegs: false });
    input.grid[52][52] = 'missing';
    input.grid[0][0] = 'outside-board';
    const before = structuredClone(input.grid);
    const result = render(input);
    expectCleanGrid(result);
    expect(result.paints.filter(p => p.method === 'fill' && p.fillStyle === '#CBD5E1')).toHaveLength(8 * 7 - 1);
    expect(result.paints.filter(p => p.method === 'fillRect' && p.fillStyle === '#CCCCCC')).toMatchObject([
      { args: [result.left, result.top, result.cell, result.cell] },
    ]);
    expect(result.ctx.fillText).toHaveBeenCalledWith('总用豆量: 1 粒 | 共 0 色', expect.any(Number), expect.any(Number));
    expect(input.grid).toEqual(before);
  });

  it('preserves default square outlines for other drawBeadOnCanvas callers', () => {
    const { ctx, paints } = canvasSpy();
    exporter.drawBeadOnCanvas(ctx as unknown as CanvasRenderingContext2D, 2, 3, 28, '#123456', 'square', 'M01');
    expect(paints.filter(p => p.method === 'strokeRect')).toMatchObject([
      { args: [2, 3, 28, 28], strokeStyle: '#00000022' },
    ]);
    expect(ctx.fillRect).toHaveBeenCalledWith(2, 3, 28, 28);
    expect(ctx.fillText).toHaveBeenCalledWith('M01', 16, 17.5);
  });

  it.each(['circle_flat', 'fuse_3d', 'ironed'] as const)('preserves %s bead rendering independently of auxiliary grid lines', beadShape => {
    const result = render(options({ width: 1, height: 1, grid: [['missing']], beadShape }));
    const direct = canvasSpy();
    exporter.drawBeadOnCanvas(direct.ctx as unknown as CanvasRenderingContext2D, result.left, result.top, result.cell, '#CCCCCC', beadShape);
    const beadPaint = result.paints.filter(p => p.method === 'fill' || p.method === 'stroke' && p.path.some(c => c.method === 'arc' || c.method === 'roundRect') ||
      p.method === 'stroke' && ['#ffffff20', '#00000019', '#ffffff12'].includes(p.strokeStyle));
    const visiblePaint = (p: Paint) => p.method === 'fill' ?
      { method: p.method, path: p.path, fillStyle: p.fillStyle } :
      { method: p.method, path: p.path, strokeStyle: p.strokeStyle, lineWidth: p.lineWidth, dash: p.dash };
    expect(beadPaint.map(visiblePaint)).toEqual(direct.paints.map(visiblePaint));
  });

  it.each(['none', 'corners', 'bottom', 'double_diagonal'] as const)('keeps watermark selection and grid/legend clipping: %s', watermarkType => {
    const result = render(options({ width: 12, height: 12, watermarkType, watermarkText: 'Licensed mark' }));
    expectCleanGrid(result);
    const marks = result.ctx.fillText.mock.calls.filter(([text]) => text.includes('Licensed mark'));
    if (watermarkType === 'none') {
      expect(marks).toHaveLength(0);
      expect(result.ctx.clip).not.toHaveBeenCalled();
    } else {
      expect(marks.length).toBeGreaterThan(0);
      expect(result.ctx.clip).toHaveBeenCalledTimes(2);
      expect(result.ctx.rect).toHaveBeenCalledWith(result.left, result.top, result.width, result.height);
    }
  });
});

describe('PatternExportSizeError allocation gate', () => {
  it.each([false, true])('throws the typed size error before allocation, isEn=%s', isEn => {
    const createElement = vi.fn(() => { throw new Error('unsafe allocation'); });
    vi.stubGlobal('document', { createElement });
    let error: unknown;
    try {
      exporter.generatePatternCanvas(options({ width: 900, height: 900, exportQuality: 'ultra', isEn }));
    } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(Error);
    expect(error).toHaveProperty('name', 'PatternExportSizeError');
    expect(error).toBeInstanceOf(exporter.PatternExportSizeError);
    expect((error as Error).message).toBe(isEn ?
      'Full PNG is too large. Select an individual board to export without resizing the pattern.' :
      '整张 PNG 超过浏览器安全尺寸，请在「导出范围」选择单块分板；图纸网格不会缩小。');
    expect(createElement).not.toHaveBeenCalled();
  });

  it('does not wrap or swallow unrelated canvas errors', () => {
    const failure = new Error('canvas unavailable');
    vi.stubGlobal('document', { createElement: vi.fn(() => { throw failure; }) });
    expect(() => exporter.generatePatternCanvas(options())).toThrow(failure);
  });
});
