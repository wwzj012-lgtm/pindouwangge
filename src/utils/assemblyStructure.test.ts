import { describe, expect, it } from 'vitest';
import { AssemblyStructureError, generateAssemblyStructure } from './assemblyStructure';

const filled = (width: number, height: number): boolean[][] => Array.from({ length: height }, () => Array<boolean>(width).fill(true));

function countOccupied(model: ReturnType<typeof generateAssemblyStructure>): number {
  return model.occupancy.flat(2).filter(Boolean).length;
}

describe('generateAssemblyStructure', () => {
  it('fuses front and side silhouettes into one connected orthographic structure', () => {
    const model = generateAssemblyStructure({
      front: { grid: filled(2, 2) },
      side: { grid: filled(2, 2) },
    });

    expect(model.dimensions).toEqual({ width: 2, height: 2, depth: 2 });
    expect(countOccupied(model)).toBe(8);
    expect(model.confidence.mode).toBe('orthographic-structure');
    expect(model.confidence.structureReady).toBe(true);
    expect(model.diagnostics.connectedComponentCount).toBe(1);
  });

  it('uses the top silhouette to reduce the front-side visual hull', () => {
    const model = generateAssemblyStructure({
      front: { grid: filled(2, 2) },
      side: { grid: filled(2, 2) },
      top: { grid: [[true, false], [false, false]] },
    });

    expect(countOccupied(model)).toBe(2);
    expect(model.confidence.score).toBeGreaterThanOrEqual(0.8);
  });

  it('returns a clearly labelled inferred draft when only one view is supplied', () => {
    const model = generateAssemblyStructure({ front: { grid: [['#7c3aed', true]] } });

    expect(model.confidence.mode).toBe('inferred-draft');
    expect(model.confidence.structureReady).toBe(false);
    expect(model.conflicts.some(conflict => conflict.code === 'insufficient-views')).toBe(true);
    expect(model.surfaceColors[0][0][0]).toMatchObject({ color: '#7c3aed', sourceView: 'front', status: 'observed-surface' });
    expect(model.surfaceColors[0][0][1]).toMatchObject({ color: null, sourceView: null, status: 'unknown' });
  });

  it('reports an empty intersection for contradictory orthographic silhouettes', () => {
    const model = generateAssemblyStructure({
      front: { grid: [[true], [false]] },
      side: { grid: [[false], [true]] },
    });

    expect(countOccupied(model)).toBe(0);
    expect(model.confidence.level).toBe('none');
    expect(model.conflicts.some(conflict => conflict.code === 'empty-intersection' && conflict.severity === 'error')).toBe(true);
  });

  it('keeps the largest six-neighbour component and reports removed isolated voxels', () => {
    const model = generateAssemblyStructure({
      front: { grid: [[true, true, false, true]] },
      side: { grid: [[true]] },
    });

    expect(model.diagnostics.occupiedBeforeCleanup).toBe(3);
    expect(model.diagnostics.occupiedAfterCleanup).toBe(2);
    expect(model.diagnostics.removedIsolatedVoxels).toBe(1);
    expect(model.conflicts.some(conflict => conflict.code === 'disconnected-geometry')).toBe(true);
  });

  it('enforces configured axis and voxel limits before allocating the volume', () => {
    expect(() => generateAssemblyStructure({ front: { grid: filled(3, 1) } }, { limits: { maxDimension: 2 } })).toThrow(AssemblyStructureError);
    expect(() => generateAssemblyStructure({ front: { grid: filled(4, 4) }, side: { grid: filled(4, 4) } }, { limits: { maxVoxels: 16 } })).toThrow('结构体素数量超过上限 16');
  });
});
