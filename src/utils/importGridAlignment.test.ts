import { describe, expect, it } from 'vitest';
import {
  clipRecognitionRegion, createDefaultGridAlignment, deriveAlignedCalibration,
  moveGridAlignment, normalizeGridAlignment, resizeGridAlignment, scaleGridAlignment,
} from './importGridAlignment';
import { recognizeImportImage, recognitionResultToCodeMatrix } from './importRecognition';
import type { BeadColor } from '../types';
import { freezeImportCalibrationSnapshot } from './importGridCalibration';

const image = { width: 200, height: 120 };
const full = { x: 0, y: 0, ...image };

describe('independent periodic grid alignment and recognition range', () => {
  it('starts at five source pixels, independent of image size or requested output counts', () => {
    const alignment = createDefaultGridAlignment(image);
    expect(alignment.cellSize).toBe(5);
    expect(alignment.originX % 5).toBe(0);
    expect(alignment.originY % 5).toBe(0);
    expect(deriveAlignedCalibration(alignment, full, image).calibration).toMatchObject({ originX: 0, originY: 0, columns: 40, rows: 24, cellWidth: 5, cellHeight: 5 });
  });

  it('moves a full-image grid freely without moving or resizing the selected region', () => {
    const before = { originX: 0, originY: 0, cellSize: 5 };
    const moved = moveGridAlignment(before, { x: 2, y: -3 });
    expect(moved).toEqual({ originX: 2, originY: -3, cellSize: 5 });
    const result = deriveAlignedCalibration(moved, full, image);
    expect(result.calibration).toMatchObject({ originX: 2, originY: 2, columns: 39, rows: 23 });
    expect(result.region).toEqual(full);
    expect(before).toEqual({ originX: 0, originY: 0, cellSize: 5 });
  });

  it('keeps movement across image edges unbounded, and whole-period shifts equivalent', () => {
    const shifted = moveGridAlignment({ originX: 0, originY: 0, cellSize: 5 }, { x: -5000, y: 8000 });
    expect(shifted.originX).toBe(-5000);
    expect(shifted.originY).toBe(8000);
    expect(deriveAlignedCalibration(shifted, full, image).calibration).toMatchObject({ originX: 0, originY: 0, columns: 40, rows: 24 });
  });

  it('scales the grid pitch without changing image/ROI dimensions or clamping to the source', () => {
    const lattice = { originX: 7, originY: 8, cellSize: 5 };
    expect(scaleGridAlignment(lattice, 2)).toEqual({ ...lattice, cellSize: 10 });
    expect(scaleGridAlignment(lattice, 0.1)).toEqual(lattice);
    expect(scaleGridAlignment(lattice, 1000)).toEqual({ ...lattice, cellSize: 512 });
    expect(scaleGridAlignment(lattice, NaN)).toEqual(lattice);
  });

  it('red anchor movement and blue three-cell resize produce square cells at any zoom-independent source point', () => {
    const current = { originX: 20, originY: 10, cellSize: 5 };
    expect(resizeGridAlignment(current, { x: 50, y: 40 })).toEqual({ ...current, cellSize: 10 });
    expect(resizeGridAlignment(current, { x: 56, y: 40 })).toEqual({ ...current, cellSize: 11 });
    expect(resizeGridAlignment(current, { x: -100, y: -100 })).toEqual(current);
    expect(resizeGridAlignment(current, { x: NaN, y: Infinity })).toEqual(current);
  });

  it('normalizes reverse drags and clips only the recognition region to source bounds', () => {
    expect(clipRecognitionRegion({ x: 190, y: 100, width: -200, height: -120 }, image))
      .toEqual({ x: 0, y: 0, width: 190, height: 100 });
    expect(clipRecognitionRegion({ x: -20, y: -10, width: 300, height: 200 }, image)).toEqual(full);
    expect(clipRecognitionRegion({ x: 300, y: 200, width: 10, height: 10 }, image))
      .toEqual({ x: 200, y: 120, width: 0, height: 0 });
  });

  it('automatically derives true rectangular dimensions using only fully selected cells', () => {
    const derived = deriveAlignedCalibration({ originX: 2, originY: 3, cellSize: 10 },
      { x: 5, y: 5, width: 75, height: 52 }, image);
    expect(derived.calibration).toEqual({ originX: 12, originY: 13, cellWidth: 10, cellHeight: 10, columns: 6, rows: 4 });
    expect(derived.region).toEqual({ x: 5, y: 5, width: 75, height: 52 });
    expect(derived.error).toBeNull();
  });

  it('retains exact fractional alignment lines without dropping a boundary cell', () => {
    const pitch = 5.1;
    const region = { x: 1.2, y: 2.3, width: pitch * 17, height: pitch * 13 };
    const derived = deriveAlignedCalibration({ originX: 1.2, originY: 2.3, cellSize: pitch }, region, image);
    expect(derived.calibration).toMatchObject({ originX: 1.2, originY: 2.3, columns: 17, rows: 13 });
  });

  it('reports empty and overly large recognition regions instead of guessing or truncating', () => {
    const lattice = { originX: 0, originY: 0, cellSize: 5 };
    expect(deriveAlignedCalibration(lattice, { x: 1, y: 1, width: 5, height: 5 }, image).calibration).toBeNull();
    expect(deriveAlignedCalibration(lattice, { x: 0, y: 0, width: 0, height: 5 }, image).error).toContain('至少');
    const tooLarge = deriveAlignedCalibration(lattice, { x: 0, y: 0, width: 5000, height: 5000 }, { width: 5000, height: 5000 });
    expect(tooLarge.calibration).toBeNull();
    expect(tooLarge.error).toContain('1000 列 × 1000 行');
    expect(tooLarge.error).toContain('900');
    expect(normalizeGridAlignment({ originX: NaN, originY: Infinity, cellSize: -1 })).toEqual(lattice);
  });

  it('uses inferred cell coordinates to classify an existing selected drawing without resampling its dimensions', () => {
    const palette: BeadColor[] = [
      { id: 'red', code: 'R', name: '红', hex: '#ff0000', rgb: [255, 0, 0], brand: 'CUSTOM' },
      { id: 'blue', code: 'B', name: '蓝', hex: '#0000ff', rgb: [0, 0, 255], brand: 'CUSTOM' },
    ];
    const data = new Uint8ClampedArray(30 * 20 * 4);
    for (let y = 0; y < 20; y++) for (let x = 0; x < 30; x++) {
      const red = Math.floor((x - 5) / 5) % 2 === 0;
      data.set(red ? [255, 0, 0, 255] : [0, 0, 255, 255], (y * 30 + x) * 4);
    }
    const derived = deriveAlignedCalibration({ originX: 0, originY: 0, cellSize: 5 },
      { x: 5, y: 5, width: 20, height: 10 }, { width: 30, height: 20 });
    const recognized = recognizeImportImage({ width: 30, height: 20, data }, derived.calibration!, palette, 'precision');
    expect(recognitionResultToCodeMatrix(recognized)).toEqual([['R','B','R','B'],['R','B','R','B']]);
    expect(recognized.calibration).toMatchObject({ originX: 5, originY: 5, columns: 4, rows: 2 });
  });

  it('freezes the inferred source rectangle without later lattice or selection edits changing the recognition snapshot', () => {
    const alignment = { originX: 40, originY: 20, cellSize: 40 };
    const selection = { x: 40, y: 20, width: 160, height: 80 };
    const derived = deriveAlignedCalibration(alignment, selection, { width: 240, height: 200 });
    const snapshot = freezeImportCalibrationSnapshot(derived.calibration!);
    const moved = moveGridAlignment(alignment, { x: -100, y: -100 });
    const changed = deriveAlignedCalibration(scaleGridAlignment(moved, 0.5), full, image);
    expect(changed.calibration).not.toEqual(snapshot.calibration);
    expect(snapshot.calibration).toEqual({ originX: 40, originY: 20, columns: 4, rows: 2, cellWidth: 40, cellHeight: 40 });
    expect(selection).toEqual({ x: 40, y: 20, width: 160, height: 80 });
    expect(Object.isFrozen(snapshot.calibration)).toBe(true);
  });

  it('permits the exact supported maximum and rejects only counts beyond it', () => {
    const source = { width: 4500, height: 4500 };
    expect(deriveAlignedCalibration({ originX: 0, originY: 0, cellSize: 5 }, { x: 0, y: 0, ...source }, source).calibration)
      .toMatchObject({ rows: 900, columns: 900 });
    expect(deriveAlignedCalibration({ originX: 0, originY: 0, cellSize: 5 }, { x: 0, y: 0, width: 10, height: 20 }, { width: 4, height: 4 }).calibration)
      .toBeNull();
  });
});
