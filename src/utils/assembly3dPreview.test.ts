import { describe, expect, it } from 'vitest';
import { createAssemblyPart, createAssemblyProject } from './assembly3d';
import { createAssemblyPreview, projectAssemblyToIsometric } from './assembly3dPreview';

describe('assembly 3D preview projection', () => {
  it('returns an empty immutable preview for an empty project', () => {
    const preview = createAssemblyPreview(createAssemblyProject([]));
    expect(preview).toEqual({ parts: [], cells: [] });
    expect(Object.isFrozen(preview)).toBe(true);
    expect(JSON.parse(JSON.stringify(preview))).toEqual({ parts: [], cells: [] });
  });

  it('projects multiple parts and preserves deterministic depth ordering', () => {
    const near = createAssemblyPart('z-part', [['near']], { position: { x: 0, y: 0, z: 0 } });
    const far = createAssemblyPart('a-part', [['far']], { position: { x: 2, y: 0, z: 0 } });
    const preview = createAssemblyPreview(createAssemblyProject([near, far]), { tileWidth: 20, tileHeight: 10 });
    expect(preview.parts.map((part) => part.partId)).toEqual(['z-part', 'a-part']);
    expect(preview.cells.map((cell) => cell.partId)).toEqual(['z-part', 'a-part']);
    expect(preview.cells[0]?.x).toBe(0);
    expect(preview.cells[1]?.x).toBe(20);
    expect(preview.cells[0]?.depthSortKey).toBeLessThan(preview.cells[1]?.depthSortKey ?? 0);
  });

  it('reflects face and rotation in occupied world and screen coordinates', () => {
    const part = createAssemblyPart('top-rotated', [['a', 'b'], ['c', null]], {
      face: 'top',
      rotation: 90,
      position: { x: 4, y: 5, z: 6 },
    });
    const preview = projectAssemblyToIsometric(createAssemblyProject([part]));
    expect(preview.cells.map(({ worldX, worldY, worldZ }) => [worldX, worldY, worldZ])).toEqual([
      [4, 5, 6], [5, 5, 6], [5, 5, 7],
    ]);
    expect(preview.cells.every((cell) => cell.face === 'top' && cell.faceOrientation === 'top')).toBe(true);
    expect(preview.cells[0]).toMatchObject({ x: -1, y: 0, z: 15, colorIndex: null });
  });

  it('emits color indices and values without mutating source data', () => {
    const source = [['red', null], ['blue', 'green']];
    const part = createAssemblyPart('colors', source);
    const before = JSON.stringify(source);
    const preview = createAssemblyPreview(createAssemblyProject([part]), { colorIndex: (value) => ({ red: 1, blue: 2, green: 3 }[value] ?? null) });
    expect(preview.cells.map((cell) => [cell.colorIndex, cell.colorValue])).toEqual([[1, 'red'], [2, 'blue'], [3, 'green']]);
    expect(JSON.stringify(source)).toBe(before);
    expect(JSON.stringify(preview)).toBe(JSON.stringify(createAssemblyPreview(createAssemblyProject([part]), { colorIndex: (value) => ({ red: 1, blue: 2, green: 3 }[value] ?? null) })));
  });
});
