import { describe, expect, it } from 'vitest';
import type { VoxelModel } from './assemblyStructure';
import { planAssemblyParts } from './assemblyPartPlanner';

function makeModel(width: number, height: number, depth: number, occupied: (x: number, y: number, z: number) => boolean, mode: 'orthographic-structure' | 'inferred-draft' = 'orthographic-structure'): VoxelModel {
  const occupancy = Array.from({ length: depth }, (_, z) => Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => occupied(x, y, z))));
  const surfaceColors = occupancy.map((plane, z) => plane.map((row, y) => row.map((filled, x) => filled ? { color: (x + y + z) % 2 ? '#663399' : '#ffd166', sourceView: 'front', status: 'observed-surface', observedFaces: { front: '#663399' } } : null)));
  return {
    dimensions: { width, height, depth }, occupancy, surfaceColors, sourceViews: mode === 'orthographic-structure' ? ['front', 'side'] : ['front'],
    confidence: { score: mode === 'orthographic-structure' ? 0.82 : 0.28, level: mode === 'orthographic-structure' ? 'high' : 'low', mode, structureReady: mode === 'orthographic-structure' },
    conflicts: [], diagnostics: { suppliedViews: mode === 'orthographic-structure' ? ['front', 'side'] : ['front'], candidateVoxels: width * height * depth, occupiedBeforeCleanup: occupancy.flat(2).filter(Boolean).length, occupiedAfterCleanup: occupancy.flat(2).filter(Boolean).length, removedIsolatedVoxels: 0, connectedComponentCount: 1, normalisedViews: {} },
  } as unknown as VoxelModel;
}

describe('planAssemblyParts', () => {
  it('creates deterministic interlocking XY/ZY parts with paired slots for a cuboid', () => {
    const plan = planAssemblyParts(makeModel(3, 4, 3, () => true));

    expect(plan.confidence.manufacturable).toBe(true);
    expect(plan.parts.some(part => part.orientation === 'xy')).toBe(true);
    expect(plan.parts.some(part => part.orientation === 'zy')).toBe(true);
    expect(plan.connections.length).toBeGreaterThan(0);
    for (const connection of plan.connections) {
      const xy = plan.parts.find(part => part.id === connection.xyPartId)!;
      const zy = plan.parts.find(part => part.id === connection.zyPartId)!;
      const xySlot = xy.slots.find(slot => slot.connectionId === connection.id);
      const zySlot = zy.slots.find(slot => slot.connectionId === connection.id);
      expect(xySlot?.partnerPartId).toBe(zy.id);
      expect(zySlot?.partnerPartId).toBe(xy.id);
      expect(xySlot?.side).not.toBe(zySlot?.side);
    }
    expect(plan.assemblySteps[0]).toMatchObject({ kind: 'skeleton' });
  });

  it('keeps usable parts for a non-rectangular structure', () => {
    const plan = planAssemblyParts(makeModel(5, 4, 4, (x, y, z) => x <= z + 1 && !(x === 0 && z === 3 && y > 1)));

    expect(plan.parts.length).toBeGreaterThanOrEqual(2);
    expect(plan.parts.every(part => part.beanCount >= 4 && part.bbox.maxU >= part.bbox.minU)).toBe(true);
    expect(plan.totalBeans).toBe(plan.parts.reduce((total, part) => total + part.beanCount, 0));
  });

  it('refuses empty structures and inferred drafts instead of inventing slots', () => {
    const empty = planAssemblyParts(makeModel(2, 2, 2, () => false));
    const draft = planAssemblyParts(makeModel(3, 3, 3, () => true, 'inferred-draft'));

    expect(empty.confidence.manufacturable).toBe(false);
    expect(empty.connections).toHaveLength(0);
    expect(draft.confidence.manufacturable).toBe(false);
    expect(draft.parts).toHaveLength(0);
    expect(draft.warnings[0]).toContain('草案');
  });

  it('respects maxParts while selecting effective slices', () => {
    const plan = planAssemblyParts(makeModel(8, 4, 8, (x, y, z) => x <= z || y === 0), { maxParts: 4, minSliceBeans: 2 });

    expect(plan.parts.length).toBeLessThanOrEqual(4);
  });

  it('uses stable non-empty identifiers across identical inputs', () => {
    const model = makeModel(4, 4, 4, () => true);
    const first = planAssemblyParts(model);
    const second = planAssemblyParts(model);

    expect(first.parts.map(part => part.id)).toEqual(second.parts.map(part => part.id));
    expect(first.connections.map(connection => connection.id)).toEqual(second.connections.map(connection => connection.id));
    expect(first.parts.every(part => part.id.length > 0 && part.number.length > 0)).toBe(true);
  });

  it('does not open slots for an invalid one-cell-high crossing', () => {
    const plan = planAssemblyParts(makeModel(2, 1, 2, () => true), { minSliceBeans: 1, minRemainingBeans: 1, minIntersectionLength: 2 });

    expect(plan.connections).toHaveLength(0);
    expect(plan.parts.flatMap(part => part.slots)).toHaveLength(0);
    expect(plan.confidence.manufacturable).toBe(false);
  });
});
