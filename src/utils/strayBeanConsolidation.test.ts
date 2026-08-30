import { describe, expect, it } from 'vitest';
import { consolidateStrayBeans, type RgbColor, type StrayBeanGridAdapter } from './strayBeanConsolidation';

type Cell = { id: string; color: RgbColor } | null;

const WHITE: RgbColor = { r: 240, g: 240, b: 240 };
const LIGHT_GREY: RgbColor = { r: 220, g: 220, b: 220 };
const MID_GREY: RgbColor = { r: 185, g: 185, b: 185 };
const DARK_GREY: RgbColor = { r: 150, g: 150, b: 150 };

const adapter: StrayBeanGridAdapter<Cell> = {
  isFilled: (cell): cell is Exclude<Cell, null> => cell !== null,
  getColorKey: (cell) => {
    const { r, g, b } = (cell as Exclude<Cell, null>).color;
    return `${r},${g},${b}`;
  },
  getColor: (cell) => (cell as Exclude<Cell, null>).color,
  replaceColor: (noise, replacement) => ({
    id: (noise as Exclude<Cell, null>).id,
    color: { ...(replacement as Exclude<Cell, null>).color },
  }),
};

function bean(id: string, color: RgbColor): Cell {
  return { id, color: { ...color } };
}

function countColour(grid: Cell[][], color: RgbColor): number {
  return grid.flat().filter((cell) => cell !== null
    && cell.color.r === color.r
    && cell.color.g === color.g
    && cell.color.b === color.b).length;
}

describe('consolidateStrayBeans', () => {
  it.each([
    ['light', 10],
    ['standard', 20],
    ['strong', 30],
  ] as const)('replaces a source colour at the inclusive %s threshold', (strength, threshold) => {
    const grid: Cell[][] = [[
      ...Array.from({ length: threshold + 1 }, (_, index) => bean(`target-${index}`, WHITE)),
      ...Array.from({ length: threshold }, (_, index) => bean(`source-${index}`, LIGHT_GREY)),
    ]];
    const result = consolidateStrayBeans(grid, adapter, strength);

    expect(countColour(result, LIGHT_GREY)).toBe(0);
    expect(countColour(result, WHITE)).toBe(threshold * 2 + 1);
  });

  it.each([
    ['light', 11],
    ['standard', 21],
    ['strong', 31],
  ] as const)('keeps a source colour at %s threshold plus one', (strength, sourceCount) => {
    const grid: Cell[][] = [[
      ...Array.from({ length: sourceCount + 1 }, (_, index) => bean(`target-${index}`, WHITE)),
      ...Array.from({ length: sourceCount }, (_, index) => bean(`source-${index}`, LIGHT_GREY)),
    ]];
    const result = consolidateStrayBeans(grid, adapter, strength);

    expect(countColour(result, LIGHT_GREY)).toBe(sourceCount);
    expect(countColour(result, WHITE)).toBe(sourceCount + 1);
  });

  it('replaces every occurrence of an eligible colour in one global pass', () => {
    const grid: Cell[][] = [
      [
        ...Array.from({ length: 11 }, (_, index) => bean(`target-${index}`, WHITE)),
        bean('source-near', LIGHT_GREY),
        null,
      ],
      [null, null, null],
      [bean('source-distant', LIGHT_GREY), null, null],
    ];
    const result = consolidateStrayBeans(grid, adapter, 'light');

    expect(result[0][1]?.color).toEqual(WHITE);
    expect(result[2][0]?.color).toEqual(WHITE);
  });

  it('chooses the closest actual neighbouring colour, with deterministic tie handling', () => {
    const grid: Cell[][] = [[
      bean('near', MID_GREY), bean('source', LIGHT_GREY), bean('far', DARK_GREY),
      ...Array.from({ length: 10 }, (_, index) => bean(`near-${index}`, MID_GREY)),
      ...Array.from({ length: 10 }, (_, index) => bean(`far-${index}`, DARK_GREY)),
    ]];
    const result = consolidateStrayBeans(grid, adapter, 'light');

    expect(result[0][1]?.color).toEqual(MID_GREY);
  });

  it('avoids eliminated target colours and safely keeps a source with no candidate', () => {
    const grid: Cell[][] = [[
      bean('low-neighbour', MID_GREY), bean('source', LIGHT_GREY), bean('stable', WHITE),
      ...Array.from({ length: 10 }, (_, index) => bean(`stable-${index}`, WHITE)),
    ]];
    const noCandidateGrid: Cell[][] = [[bean('only-source', LIGHT_GREY)]];

    const result = consolidateStrayBeans(grid, adapter, 'light');
    const noCandidateResult = consolidateStrayBeans(noCandidateGrid, adapter, 'light');

    expect(result[0][1]?.color).toEqual(WHITE);
    expect(result[0][0]?.color).toEqual(MID_GREY);
    expect(noCandidateResult[0][0]?.color).toEqual(LIGHT_GREY);
  });

  it('is deterministic and does not mutate the original grid or cell references', () => {
    const grid: Cell[][] = [[bean('target', WHITE), bean('source-a', LIGHT_GREY)], [null, bean('source-b', LIGHT_GREY)]];
    const originalSource = grid[0][1];
    const originalSnapshot = JSON.stringify(grid);

    const first = consolidateStrayBeans(grid, adapter, 'light');
    const second = consolidateStrayBeans(grid, adapter, 'light');

    expect(first).toEqual(second);
    expect(grid[0][1]).toBe(originalSource);
    expect(JSON.stringify(grid)).toBe(originalSnapshot);
  });
});
