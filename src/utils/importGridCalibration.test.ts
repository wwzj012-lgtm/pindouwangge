import { describe, expect, it } from 'vitest';
import {
  createDefaultImportGridCalibration,
  dragImportGridCorner,
  freezeImportCalibrationSnapshot,
  getImportGridBounds,
  moveImportGrid,
  normalizeImportGridCalibration,
  resizeImportGridCalibration,
  updateImportGridCalibration,
} from './importGridCalibration';

describe('import grid calibration', () => {
  it('creates a centered source-space grid without view state', () => {
    const calibration = createDefaultImportGridCalibration({ width: 1000, height: 600 });
    expect(calibration).toEqual({
      originX: 0,
      originY: 0,
      cellWidth: 50,
      cellHeight: 30,
      columns: 20,
      rows: 20,
    });
    expect(getImportGridBounds(calibration)).toEqual({ x: 0, y: 0, width: 1000, height: 600 });
  });

  it('centers a bounded default grid when the source image is larger than the grid', () => {
    const calibration = createDefaultImportGridCalibration({ width: 20000, height: 12000 });

    expect(calibration).toMatchObject({
      columns: 20,
      rows: 20,
      cellWidth: 512,
      cellHeight: 512,
      originX: 4880,
      originY: 880,
    });
  });

  it('clamps dimensions, cell sizes, and origins to safe limits', () => {
    const fallback = createDefaultImportGridCalibration({ width: 320, height: 240 });
    expect(normalizeImportGridCalibration({
      columns: 100,
      rows: 0,
      cellWidth: 1,
      cellHeight: 999,
      originX: 999,
      originY: -30,
    }, { width: 320, height: 240 }, fallback)).toEqual({
      columns: 100,
      rows: 1,
      cellWidth: 1,
      cellHeight: 240,
      originX: 220,
      originY: 0,
    });
  });

  it('moves the grid in source pixels and prevents dragging it outside the image', () => {
    const current = {
      originX: 10,
      originY: 20,
      cellWidth: 20,
      cellHeight: 15,
      columns: 5,
      rows: 4,
    };
    expect(moveImportGrid(current, { x: 15, y: -50 }, { width: 200, height: 120 })).toMatchObject({
      originX: 25,
      originY: 0,
    });
    expect(moveImportGrid(current, { x: 999, y: 999 }, { width: 200, height: 120 })).toMatchObject({
      originX: 100,
      originY: 60,
    });
  });

  it('keeps the opposite corner fixed when resizing a manually aligned grid', () => {
    const grid = { originX: 10, originY: 20, cellWidth: 10, cellHeight: 8, columns: 5, rows: 4 };
    const image = { width: 200, height: 120 };
    const resized = dragImportGridCorner(grid, 'top-left', { x: 5, y: 10 }, image);
    expect(getImportGridBounds(resized)).toEqual({ x: 5, y: 10, width: 55, height: 42 });
    expect(grid.originX).toBe(10);
    const bottomRight = dragImportGridCorner(grid, 'bottom-right', { x: 300, y: 200 }, image);
    expect(getImportGridBounds(bottomRight)).toEqual({ x: 10, y: 20, width: 190, height: 100 });
  });

  it('supports all corner directions and prevents crossing the opposite corner', () => {
    const grid = { originX: 10, originY: 20, cellWidth: 10, cellHeight: 10, columns: 5, rows: 4 };
    const image = { width: 200, height: 120 };
    expect(getImportGridBounds(dragImportGridCorner(grid, 'top-right', { x: 80, y: 5 }, image)))
      .toEqual({ x: 10, y: 5, width: 70, height: 55 });
    expect(getImportGridBounds(dragImportGridCorner(grid, 'bottom-left', { x: 5, y: 75 }, image)))
      .toEqual({ x: 5, y: 20, width: 55, height: 55 });
    const crossed = dragImportGridCorner(grid, 'bottom-right', { x: 0, y: 0 }, image);
    expect(crossed.originX).toBe(10);
    expect(crossed.cellWidth).toBeGreaterThan(0);
    expect(crossed.cellHeight).toBeGreaterThan(0);
  });

  it('keeps equal cell sides and stays within the image under square lock', () => {
    const grid = { originX: 10, originY: 20, cellWidth: 10, cellHeight: 10, columns: 5, rows: 4 };
    const resized = dragImportGridCorner(grid, 'bottom-right', { x: 190, y: 55 }, { width: 200, height: 120 }, true);
    expect(resized.cellWidth).toBe(resized.cellHeight);
    expect(getImportGridBounds(resized)).toEqual({ x: 10, y: 20, width: 125, height: 100 });
  });

  it.each([26, 52, 104, 208, 312])('preserves calibrated bounds when presetting %i rows and columns', size => {
    const current = { originX: 17, originY: 9, cellWidth: 2, cellHeight: 1, columns: 20, rows: 20 };
    const before = getImportGridBounds(current);
    const resized = resizeImportGridCalibration(current, size, size, { width: 2000, height: 1200 });

    expect(resized).toMatchObject({ columns: size, rows: size });
    expect(getImportGridBounds(resized)).toEqual(before);
    expect(resized.cellWidth).toBeLessThan(4);
    expect(resized.cellHeight).toBeLessThan(4);
  });

  it('keeps a frozen calibration snapshot independent from later editor changes', () => {
    const current = {
      originX: 8,
      originY: 12,
      cellWidth: 16,
      cellHeight: 16,
      columns: 10,
      rows: 8,
    };
    const snapshot = freezeImportCalibrationSnapshot(current);
    current.originX = 120;
    const edited = updateImportGridCalibration(current, { columns: 12 }, { width: 400, height: 300 });

    expect(snapshot.calibration.originX).toBe(8);
    expect(snapshot.calibration.columns).toBe(10);
    expect(edited.columns).toBe(12);
    expect(snapshot.calibration).not.toBe(current);
    expect(Object.keys(snapshot)).toEqual(['calibration']);
  });
});
