import { describe, expect, it } from 'vitest';
import {
  assertValidAssemblyProject,
  createAssemblyPart,
  createAssemblyProject,
  findAssemblyCollisions,
  getAssemblyOccupiedCells,
  validateAssemblyProject,
  type AssemblyProject,
} from './assembly3d';

describe('3D assembly model', () => {
  it('maps face coordinates and 90-degree rotations to integer cells', () => {
    const front = createAssemblyPart('front', [['a', 'b'], ['c', null]], { face: 'front' });
    expect(getAssemblyOccupiedCells(front).map(({ x, y, z }) => [x, y, z])).toEqual([
      [0, 0, 0], [1, 0, 0], [0, 1, 0],
    ]);

    const rotated = createAssemblyPart('rotated', [['a', 'b'], ['c', null]], { face: 'top', rotation: 90, position: { x: 4, y: 5, z: 6 } });
    expect(getAssemblyOccupiedCells(rotated).map(({ x, y, z }) => [x, y, z])).toEqual([
      [5, 5, 6], [5, 5, 7], [4, 5, 6],
    ]);
  });

  it('reports overlap while allowing adjacent parts', () => {
    const first = createAssemblyPart('a', [['x']], { position: { x: 0, y: 0, z: 0 } });
    const adjacent = createAssemblyPart('b', [['y']], { position: { x: 0, y: 0, z: 1 } });
    const overlap = createAssemblyPart('c', [['z']], { position: { x: 0, y: 0, z: 0 } });

    expect(findAssemblyCollisions(createAssemblyProject([first, adjacent]))).toEqual([]);
    expect(findAssemblyCollisions(createAssemblyProject([first, overlap]))).toMatchObject([
      { partA: 'a', partB: 'c', cell: { x: 0, y: 0, z: 0 } },
    ]);
  });

  it('checks joint anchors and occupied-cell contact', () => {
    const first = createAssemblyPart('a', [['x']], { anchors: [{ id: 'edge', position: { x: 0, y: 0, z: 0 } }] });
    const second = createAssemblyPart('b', [['y']], {
      position: { x: 0, y: 0, z: 1 },
      anchors: [{ id: 'edge', position: { x: 0, y: 0, z: 0 } }],
    });
    const project = createAssemblyProject([first, second], [{ partA: 'a', anchorA: 'edge', partB: 'b', anchorB: 'edge' }]);
    expect(validateAssemblyProject(project).valid).toBe(true);

    const missingAnchor: AssemblyProject = createAssemblyProject([first, second], [{ partA: 'a', anchorA: 'missing', partB: 'b', anchorB: 'edge' }]);
    expect(validateAssemblyProject(missingAnchor).jointErrors[0]?.code).toBe('missing-anchor');

    const far = createAssemblyPart('far', [['y']], { position: { x: 0, y: 0, z: 3 }, anchors: [{ id: 'edge', position: { x: 0, y: 0, z: 0 } }] });
    const noContact = createAssemblyProject([first, far], [{ partA: 'a', anchorA: 'edge', partB: 'far', anchorB: 'edge' }]);
    expect(validateAssemblyProject(noContact).jointErrors[0]?.code).toBe('no-contact');
  });

  it('rejects malformed grids and invalid transforms', () => {
    expect(() => createAssemblyPart('bad', [['x'], []])).toThrow(/inconsistent width/);
    expect(() => createAssemblyPart('bad', [['x']], { face: 'diagonal' as never })).toThrow(/face/);
    expect(() => createAssemblyPart('bad', [['x']], { rotation: 45 as never })).toThrow(/rotation/);
    expect(() => createAssemblyPart('bad', [['x']], { position: { x: 0.5, y: 0, z: 0 } })).toThrow(/integer/);
  });

  it('returns immutable snapshots and does not mutate source data', () => {
    const grid = [['x', null]] as Array<Array<string | null>>;
    const part = createAssemblyPart('immutable', grid);
    grid[0]![0] = 'changed';
    expect(part.grid[0]?.[0]).toBe('x');
    expect(Object.isFrozen(part)).toBe(true);
    expect(Object.isFrozen(part.grid)).toBe(true);
    expect(Object.isFrozen(getAssemblyOccupiedCells(part))).toBe(true);

    expect(() => assertValidAssemblyProject(createAssemblyProject([part]))).not.toThrow();
  });
});
