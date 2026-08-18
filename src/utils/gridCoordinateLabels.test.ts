import { describe, expect, it } from 'vitest';
import { getColumnLetter } from './exportUtils';
import { getColumnLabelPositions, getRowLabelPositions } from './gridCoordinateLabels';

const measureLabel = (label: string) => label.length * 7;

function expectNoLabelCollisions(labels: ReturnType<typeof getColumnLabelPositions>) {
  for (let index = 1; index < labels.length; index++) {
    const previous = labels[index - 1];
    const current = labels[index];
    const previousRight = previous.center + previous.size / 2;
    const currentLeft = current.center - current.size / 2;
    expect(previousRight + 3).toBeLessThanOrEqual(currentLeft);
  }
}

describe('getColumnLabelPositions', () => {
  it('keeps 87-column low-zoom labels collision-free after AA', () => {
    const labels = getColumnLabelPositions({
      columns: 87,
      cellSize: 4,
      boardSize: 29,
      originX: 20,
      viewportWidth: 400,
      getLabel: getColumnLetter,
      measureLabel,
    });

    expect(labels.some(label => label.index >= 26)).toBe(true);
    expect(labels.map(label => label.index)).toEqual(expect.arrayContaining([0, 29, 58, 86]));
    expectNoLabelCollisions(labels);
  });

  it('restores one-label-per-column density when rendered cells are wide enough', () => {
    const labels = getColumnLabelPositions({
      columns: 87,
      cellSize: 20,
      boardSize: 29,
      originX: 20,
      viewportWidth: 1800,
      getLabel: getColumnLetter,
      measureLabel,
    });

    expect(labels).toHaveLength(87);
    expect(labels[26].label).toBe('AA');
    expectNoLabelCollisions(labels);
  });

  it('keeps visible mobile labels inside the canvas width', () => {
    const viewportWidth = 390;
    const labels = getColumnLabelPositions({
      columns: 87,
      cellSize: 4,
      boardSize: 29,
      originX: 20,
      viewportWidth,
      getLabel: getColumnLetter,
      measureLabel,
    });

    for (const label of labels) {
      expect(label.center - label.size / 2).toBeGreaterThanOrEqual(0);
      expect(label.center + label.size / 2).toBeLessThanOrEqual(viewportWidth);
    }
    expectNoLabelCollisions(labels);
  });

  it('keeps 87 row labels collision-free at low zoom and preserves board boundaries', () => {
    const labels = getRowLabelPositions({
      rows: 87,
      cellSize: 4,
      boardSize: 29,
      originY: 20,
      viewportHeight: 400,
      measureLabel: () => 10,
    });

    expect(labels.map(label => label.index)).toEqual(expect.arrayContaining([0, 29, 58, 86]));
    expectNoLabelCollisions(labels);
  });

  it('restores all row labels when cell height is sufficient', () => {
    const labels = getRowLabelPositions({
      rows: 87,
      cellSize: 20,
      boardSize: 29,
      originY: 20,
      viewportHeight: 1800,
      measureLabel: () => 10,
    });

    expect(labels).toHaveLength(87);
    expectNoLabelCollisions(labels);
  });

  it('keeps visible row labels inside a mobile-height viewport', () => {
    const viewportHeight = 390;
    const labels = getRowLabelPositions({
      rows: 87,
      cellSize: 4,
      boardSize: 29,
      originY: 20,
      viewportHeight,
      measureLabel: () => 10,
    });

    for (const label of labels) {
      expect(label.center - label.size / 2).toBeGreaterThanOrEqual(0);
      expect(label.center + label.size / 2).toBeLessThanOrEqual(viewportHeight);
    }
    expectNoLabelCollisions(labels);
  });
});
