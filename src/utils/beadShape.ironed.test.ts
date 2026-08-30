import { describe, expect, it, vi } from 'vitest';
import type { BeadColor } from '../types';
import { drawBeadOnCanvas, generatePatternCanvas } from './exportUtils';

type CanvasEvent = {
  name: string;
  args: unknown[];
};

type RecordedContext = CanvasRenderingContext2D & {
  events: CanvasEvent[];
};

function createCanvasContext(): RecordedContext {
  const events: CanvasEvent[] = [];
  const record = (name: string) => vi.fn((...args: unknown[]) => events.push({ name, args }));
  const context = {
    events,
    beginPath: record('beginPath'),
    roundRect: record('roundRect'),
    arc: record('arc'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    clip: record('clip'),
    save: record('save'),
    restore: record('restore'),
    fill: record('fill'),
    stroke: record('stroke'),
    fillRect: record('fillRect'),
    strokeRect: record('strokeRect'),
  } as Record<string, unknown>;

  Object.defineProperties(context, {
    fillStyle: {
      set: (value: string) => events.push({ name: 'fillStyle', args: [value] }),
    },
    strokeStyle: {
      set: (value: string) => events.push({ name: 'strokeStyle', args: [value] }),
    },
    lineWidth: {
      set: (value: number) => events.push({ name: 'lineWidth', args: [value] }),
    },
  });

  return context as unknown as RecordedContext;
}

describe('ironed bead rendering', () => {
  it('uses a 2.5% cell gap, original body color, and restrained edge seams', () => {
    const context = createCanvasContext();

    drawBeadOnCanvas(context, 10, 20, 100, '#F8FAFC', 'ironed');

    expect(context.roundRect).toHaveBeenCalledWith(11.25, 21.25, 97.5, 97.5, 8.5);
    expect(context.events).toContainEqual({ name: 'fillStyle', args: ['#F8FAFC'] });
    expect(context.events).toContainEqual({ name: 'strokeStyle', args: ['#00000028'] });
    expect(context.events).toContainEqual({ name: 'strokeStyle', args: ['#ffffff20'] });
    expect(context.events).toContainEqual({ name: 'strokeStyle', args: ['#00000019'] });
    expect(context.events).toContainEqual({ name: 'strokeStyle', args: ['#ffffff12'] });
    expect(context.moveTo).toHaveBeenCalledTimes(8);
    expect(context.lineTo).toHaveBeenCalledTimes(8);
  });

  it('does not draw the fuse_3d center hole or a thick ring for ironed beads', () => {
    const context = createCanvasContext();

    drawBeadOnCanvas(context, 0, 0, 20, '#7C3AED', 'ironed');

    expect(context.arc).not.toHaveBeenCalled();
    expect(context.events.filter(({ name }) => name === 'lineWidth')).toEqual([
      { name: 'lineWidth', args: [0.35] },
      { name: 'lineWidth', args: [0.35] },
      { name: 'lineWidth', args: [0.35] },
      { name: 'lineWidth', args: [0.25] },
    ]);
  });

  it('preserves the fuse_3d drawing sequence and center-hole geometry', () => {
    const context = createCanvasContext();

    drawBeadOnCanvas(context, 0, 0, 20, '#7C3AED', 'fuse_3d');

    expect(context.arc).toHaveBeenNthCalledWith(1, 10, 10, 9.200000000000001, 0, Math.PI * 2);
    expect(context.arc).toHaveBeenNthCalledWith(2, 10, 10, 3.22, 0, Math.PI * 2);
    expect(context.events.filter(({ name }) => name === 'fillStyle')).toEqual([
      { name: 'fillStyle', args: ['#7C3AED'] },
      { name: 'fillStyle', args: ['#00000033'] },
    ]);
    expect(context.events.filter(({ name }) => name === 'strokeStyle')).toEqual([
      { name: 'strokeStyle', args: ['#ffffff44'] },
      { name: 'strokeStyle', args: ['#00000022'] },
    ]);
    expect(context.events.filter(({ name }) => name === 'lineWidth')).toEqual([
      { name: 'lineWidth', args: [1.6] },
      { name: 'lineWidth', args: [0.5] },
    ]);
  });

  it('falls back to a flat cell for unknown runtime shape values', () => {
    const context = createCanvasContext();

    drawBeadOnCanvas(context, 2, 3, 20, '#7C3AED', 'unknown' as never);

    expect(context.fillRect).toHaveBeenCalledWith(2, 3, 20, 20);
    expect(context.arc).not.toHaveBeenCalled();
  });

  it('keeps the ironed shape on the printable export path', () => {
    const context = new Proxy<Record<PropertyKey, unknown>>({}, {
      get(target, property) {
        if (typeof property === 'symbol') return target[property];
        if (!(property in target)) target[property] = vi.fn();
        return target[property];
      },
    });
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => context),
    } as unknown as HTMLCanvasElement;
    const originalDocument = globalThis.document;

    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: { createElement: vi.fn(() => canvas) },
    });

    try {
      const paletteMap = new Map<string, BeadColor>([
        ['M01', {
          id: 'M01', code: 'M01', name: 'White', hex: '#FFFFFF', rgb: [255, 255, 255], brand: 'MARD',
        }],
      ]);
      const result = generatePatternCanvas({
        grid: [['M01']],
        paletteMap,
        width: 1,
        height: 1,
        boardSize: 1,
        brandName: 'Test',
        projectName: 'Smoke',
        showSymbols: false,
        showCoordinates: false,
        beadShape: 'ironed',
        hideEmptyPegs: true,
      });

      expect(result).toBe(canvas);
      expect(canvas.getContext).toHaveBeenCalledWith('2d');
      expect(context.roundRect).toHaveBeenCalled();
      expect(context.arc).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(globalThis, 'document', { configurable: true, value: originalDocument });
    }
  });
});
