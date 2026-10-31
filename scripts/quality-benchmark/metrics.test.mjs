import test from 'node:test';
import assert from 'node:assert/strict';
import { measure, referenceGrid } from './metrics.mjs';

const palette = [{ id: 'black', rgb: [0, 0, 0] }, { id: 'white', rgb: [255, 255, 255] }];
const sourceFromGrid = grid => ({ width: grid[0].length, height: grid.length, data: Buffer.from(grid.flat().flatMap(id => id === null ? [255, 0, 200, 0] : [...palette.find(c => c.id === id).rgb, 255])) });

test('fractional reference uses exact original area, including rectangular output', () => {
  const source = { width: 3, height: 1, data: Buffer.from([0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255]) };
  const reference = referenceGrid(source, 2, 1);
  assert.deepEqual(reference[0].white, [85, 85, 85]);
  assert.deepEqual(reference[1].white, [255, 255, 255]);
  assert.equal(measure(source, [['black', 'white']], palette).compositeAreaRgbMAE, 42.5);
});

test('exact original match has zero color/alpha errors and SSIM one', () => {
  const grid = Array.from({ length: 8 }, (_, y) => Array.from({ length: 8 }, (_, x) => x < 4 && y < 6 ? 'black' : 'white'));
  const m = measure(sourceFromGrid(grid), grid, palette);
  assert.equal(m.compositeAreaRgbMAE, 0); assert.equal(m.compositeAreaDeltaE76, 0);
  assert.equal(m.alphaMAE, 0); assert.equal(m.localLumaSSIMWhite, 1);
});

test('transparent hidden RGB is ignored; unsupported opaque fill is penalized', () => {
  const empty = Array.from({ length: 4 }, () => Array(4).fill(null));
  const source = sourceFromGrid(empty), good = measure(source, empty, palette);
  assert.equal(good.compositeAreaRgbMAE, 0); assert.equal(good.alphaMAE, 0);
  const wrong = measure(source, Array.from({ length: 4 }, () => Array(4).fill('white')), palette);
  assert.equal(wrong.opaqueOverFullyTransparent, 16); assert.equal(wrong.alphaMAE, 1);
  assert.equal(wrong.softAlphaIoU, 0); assert.ok(wrong.compositeAreaRgbMAE > 0);
});

test('painting all black cannot game dark-line quality through recall alone', () => {
  const grid = Array.from({ length: 8 }, () => Array.from({ length: 8 }, (_, x) => x === 3 ? 'black' : 'white'));
  const source = sourceFromGrid(grid), exact = measure(source, grid, palette, { lineProbe: true });
  const black = measure(source, Array.from({ length: 8 }, () => Array(8).fill('black')), palette, { lineProbe: true });
  assert.equal(exact.darkInkF1, 1); assert.equal(black.darkInkRecall, 1);
  assert.equal(black.darkInkPrecision, 0.125); assert.ok(black.darkInkF1 < 0.25);
});

test('diagonal same-color cells remain separate under four-connectivity', () => {
  const grid = Array.from({ length: 4 }, () => Array(4).fill('white')); grid[1][1] = 'black'; grid[2][2] = 'black';
  const m = measure(sourceFromGrid(grid), grid, palette);
  assert.equal(m.isolatedCells4, 2); assert.equal(m.tinyComponentCells4, 2);
  assert.equal(m.usedColors, 2);
  assert.equal(measure(sourceFromGrid(grid), grid, palette, { colorLimit: 1 }).colorLimitSatisfied, false);
});

test('unknown output IDs are rejected rather than treated as transparent', () => {
  assert.throws(() => measure(sourceFromGrid([['white']]), [['missing']], palette), /Unknown palette ID/);
});
