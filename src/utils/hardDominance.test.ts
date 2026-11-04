import { describe, expect, it } from 'vitest';
import {
  detectCellHardDominance,
  resolveHardDominanceSupport,
  type CellColorBin,
  type HardDominanceCell,
} from './sourceSampling';

function bin(rgb: [number, number, number], weight: number): CellColorBin {
  return {
    rgb: rgb.map((v) => v * weight) as [number, number, number],
    weight,
    area: weight,
    x: 0, y: 0, xx: 0, yy: 0,
  };
}

describe('detectCellHardDominance', () => {
  it('reports the primary share and the runner-up block', () => {
    const verdict = detectCellHardDominance([
      bin([240, 240, 240], 0.44),
      bin([30, 28, 60], 0.44),
    ], 0.88);
    expect(verdict).not.toBeNull();
    expect(verdict!.share).toBeCloseTo(0.5);
    expect(verdict!.secondaryRgb).toEqual([30, 28, 60]);
    expect(verdict!.secondaryShare).toBeCloseTo(0.5);
  });

  it('stays null for a near-tie split of close colours', () => {
    const verdict = detectCellHardDominance([
      bin([200, 200, 200], 0.45),
      bin([210, 205, 195], 0.45),
    ], 0.9);
    expect(verdict).toBeNull();
  });
});

describe('resolveHardDominanceSupport', () => {
  const cols = 5, rows = 3;
  const blank = () => Array.from({ length: cols * rows }, () => ({ r: 255, g: 255, b: 255, alpha: 0 }));

  it('keeps a supported primary on a true-majority cell', () => {
    // Cell 7 (middle) is 60% navy; its right neighbour committed navy too.
    const colours = blank();
    colours[7] = { r: 200, g: 200, b: 200, alpha: 255 };
    colours[8] = { r: 30, g: 28, b: 60, alpha: 255 };
    const cells: HardDominanceCell[] = [
      { index: 7, verdict: { rgb: [30, 28, 60], share: 0.6, secondaryRgb: [240, 240, 240], secondaryShare: 0.35 } },
      { index: 8, verdict: { rgb: [30, 28, 60], share: 0.8, secondaryRgb: null, secondaryShare: 0.1 } },
    ];
    const decisions = resolveHardDominanceSupport(cells, colours, cols, rows);
    expect(decisions.get(7)).toEqual([30, 28, 60]);
  });

  it('switches a coin-flip cell to its runner-up when that side both outweighs and is supported', () => {
    // Cell 7: cluster merging inflated navy to 0.42 but cream really holds 0.45.
    // Neighbours are cream; nobody nearby is navy.
    const colours = blank();
    colours[7] = { r: 130, g: 130, b: 150, alpha: 255 };
    colours[2] = { r: 245, g: 242, b: 235, alpha: 255 };
    colours[12] = { r: 245, g: 242, b: 235, alpha: 255 };
    const cells: HardDominanceCell[] = [
      { index: 7, verdict: { rgb: [30, 28, 60], share: 0.42, secondaryRgb: [245, 242, 235], secondaryShare: 0.45 } },
      { index: 2, verdict: { rgb: [245, 242, 235], share: 0.9, secondaryRgb: null, secondaryShare: 0.05 } },
      { index: 12, verdict: { rgb: [245, 242, 235], share: 0.9, secondaryRgb: null, secondaryShare: 0.05 } },
    ];
    const decisions = resolveHardDominanceSupport(cells, colours, cols, rows);
    expect(decisions.get(7)).toEqual([245, 242, 235]);
  });

  it('never hands a majority cell over to a smaller runner-up', () => {
    // 45% navy vs 42% cream: cream may be neighbour-supported, but navy is
    // still the larger block, so the cell keeps the area average instead.
    const colours = blank();
    colours[7] = { r: 130, g: 130, b: 150, alpha: 255 };
    colours[2] = { r: 245, g: 242, b: 235, alpha: 255 };
    const cells: HardDominanceCell[] = [
      { index: 7, verdict: { rgb: [30, 28, 60], share: 0.45, secondaryRgb: [245, 242, 235], secondaryShare: 0.42 } },
      { index: 2, verdict: { rgb: [245, 242, 235], share: 0.9, secondaryRgb: null, secondaryShare: 0.05 } },
    ];
    const decisions = resolveHardDominanceSupport(cells, colours, cols, rows);
    expect(decisions.get(7)).toBeNull();
  });

  it('keeps the area average for an unsupported near-even split', () => {
    const colours = blank();
    colours[7] = { r: 130, g: 130, b: 150, alpha: 255 };
    const cells: HardDominanceCell[] = [
      { index: 7, verdict: { rgb: [30, 28, 60], share: 0.45, secondaryRgb: [245, 242, 235], secondaryShare: 0.42 } },
    ];
    const decisions = resolveHardDominanceSupport(cells, colours, cols, rows);
    expect(decisions.has(7)).toBe(false);
  });

  it('never commits a lone flip without a candidate neighbour', () => {
    const colours = blank();
    colours[7] = { r: 200, g: 200, b: 200, alpha: 255 };
    const cells: HardDominanceCell[] = [
      { index: 7, verdict: { rgb: [30, 28, 60], share: 0.8, secondaryRgb: null, secondaryShare: 0.1 } },
    ];
    const decisions = resolveHardDominanceSupport(cells, colours, cols, rows);
    expect(decisions.has(7)).toBe(false);
  });

  it('keeps a thin dark line: coin-flip cells chained along the line stay on it', () => {
    // Vertical navy line on cream: cells 7 and 12 are 45/42 coin flips, cell 2 is solid navy.
    const colours = blank();
    const cells: HardDominanceCell[] = [
      { index: 2, verdict: { rgb: [30, 28, 60], share: 0.85, secondaryRgb: null, secondaryShare: 0.1 } },
      { index: 7, verdict: { rgb: [30, 28, 60], share: 0.45, secondaryRgb: [245, 242, 235], secondaryShare: 0.42 } },
      { index: 12, verdict: { rgb: [30, 28, 60], share: 0.45, secondaryRgb: [245, 242, 235], secondaryShare: 0.42 } },
    ];
    const decisions = resolveHardDominanceSupport(cells, colours, cols, rows);
    expect(decisions.get(7)).toEqual([30, 28, 60]);
    expect(decisions.get(12)).toEqual([30, 28, 60]);
  });
});
