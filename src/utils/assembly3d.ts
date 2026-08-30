/** Pure, integer-grid assembly primitives for the V1 3D bead model. */

export type AssemblyFace = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom';
export type AssemblyRotation = 0 | 90 | 180 | 270;
export type AssemblyPosition = Readonly<{ x: number; y: number; z: number }>;

/** A local point on a part. Anchor coordinates use the part's untransformed 3D space. */
export interface Anchor {
  readonly id: string;
  readonly position: AssemblyPosition;
}

export type AssemblyAnchor = Anchor;

export interface AssemblyPart<T = unknown> {
  readonly id: string;
  readonly grid: readonly (readonly (T | null | undefined)[])[];
  readonly width: number;
  readonly height: number;
  readonly face: AssemblyFace;
  readonly rotation: AssemblyRotation;
  readonly position: AssemblyPosition;
  readonly anchors: readonly Anchor[];
}

export interface AssemblyJoint {
  readonly id?: string;
  readonly partA: string;
  readonly anchorA: string;
  readonly partB: string;
  readonly anchorB: string;
}

export interface AssemblyProject<T = unknown> {
  readonly parts: readonly AssemblyPart<T>[];
  readonly joints: readonly AssemblyJoint[];
}

export interface AssemblyCell<T = unknown> {
  readonly partId: string;
  readonly gridX: number;
  readonly gridY: number;
  readonly value: T;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface AssemblyCollision {
  readonly cell: Readonly<{ x: number; y: number; z: number }>;
  readonly partA: string;
  readonly partB: string;
}

export interface AssemblyJointError {
  readonly joint: AssemblyJoint;
  readonly code: 'missing-part' | 'missing-anchor' | 'no-contact';
  readonly message: string;
}

export interface AssemblyValidationResult {
  readonly valid: boolean;
  readonly collisions: readonly AssemblyCollision[];
  readonly jointErrors: readonly AssemblyJointError[];
  readonly errors: readonly string[];
}

export interface CreateAssemblyPartOptions {
  readonly id?: string;
  readonly face?: AssemblyFace;
  readonly rotation?: AssemblyRotation;
  readonly position?: AssemblyPosition;
  readonly anchors?: readonly Anchor[];
}

const FACES: readonly AssemblyFace[] = ['front', 'back', 'left', 'right', 'top', 'bottom'];
const ROTATIONS: readonly AssemblyRotation[] = [0, 90, 180, 270];

type Vec = [number, number, number];

function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
  }
  return value;
}

function positionOf(value: AssemblyPosition | undefined, name: string): AssemblyPosition {
  const position = value ?? { x: 0, y: 0, z: 0 };
  if (!position || !isInteger(position.x) || !isInteger(position.y) || !isInteger(position.z)) {
    throw new TypeError(`${name} must contain integer x, y and z coordinates`);
  }
  return freeze({ x: position.x, y: position.y, z: position.z });
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

function assertFace(face: unknown): asserts face is AssemblyFace {
  if (!FACES.includes(face as AssemblyFace)) throw new TypeError(`face must be one of ${FACES.join(', ')}`);
}

function assertRotation(rotation: unknown): asserts rotation is AssemblyRotation {
  if (!ROTATIONS.includes(rotation as AssemblyRotation)) throw new TypeError('rotation must be 0, 90, 180 or 270');
}

function cloneAnchors(anchors: readonly Anchor[] | undefined): readonly Anchor[] {
  if (anchors === undefined) return freeze([] as Anchor[]);
  if (!Array.isArray(anchors)) throw new TypeError('anchors must be an array');
  const ids = new Set<string>();
  const copy = anchors.map((anchor, index) => {
    if (!anchor || typeof anchor.id !== 'string' || anchor.id.trim() === '' || ids.has(anchor.id)) {
      throw new TypeError(`anchor ${index} has an invalid or duplicate id`);
    }
    ids.add(anchor.id);
    return freeze({ id: anchor.id, position: positionOf(anchor.position, `anchor ${anchor.id}.position`) });
  });
  return freeze(copy);
}

function cloneGrid<T>(grid: readonly (readonly (T | null | undefined)[])[]): readonly (readonly (T | null | undefined)[])[] {
  if (!Array.isArray(grid) || grid.length === 0) throw new TypeError('grid must contain at least one row');
  const width = grid[0]?.length ?? 0;
  if (!Number.isSafeInteger(width) || width < 1) throw new TypeError('grid must contain at least one column');
  const rows = grid.map((row, index) => {
    if (!Array.isArray(row) || row.length !== width) throw new TypeError(`grid row ${index} has an inconsistent width`);
    return freeze([...row]);
  });
  return freeze(rows);
}

/** Create an immutable assembly part from a rectangular 2D bean grid. */
export function createAssemblyPart<T>(id: string, grid: readonly (readonly (T | null | undefined)[])[], options?: Omit<CreateAssemblyPartOptions, 'id'>): AssemblyPart<T>;
export function createAssemblyPart<T>(grid: readonly (readonly (T | null | undefined)[])[], options: CreateAssemblyPartOptions & { readonly id: string }): AssemblyPart<T>;
export function createAssemblyPart<T>(
  idOrGrid: string | readonly (readonly (T | null | undefined)[])[],
  gridOrOptions: readonly (readonly (T | null | undefined)[])[] | (CreateAssemblyPartOptions & { readonly id: string }),
  maybeOptions?: Omit<CreateAssemblyPartOptions, 'id'>,
): AssemblyPart<T> {
  let id: string | undefined;
  let grid: readonly (readonly (T | null | undefined)[])[];
  let options: CreateAssemblyPartOptions | undefined;
  if (typeof idOrGrid === 'string') {
    id = idOrGrid;
    grid = gridOrOptions as readonly (readonly (T | null | undefined)[])[];
    options = maybeOptions;
  } else {
    const supplied = gridOrOptions as CreateAssemblyPartOptions & { readonly id: string };
    id = supplied.id;
    grid = idOrGrid;
    options = supplied;
  }
  if (typeof id !== 'string' || id.trim() === '') throw new TypeError('part id must be a non-empty string');
  if (!Array.isArray(grid)) throw new TypeError('grid is required');
  const copiedGrid = cloneGrid<T>(grid);
  const face = options?.face ?? 'front';
  const rotation = options?.rotation ?? 0;
  assertFace(face);
  assertRotation(rotation);
  const position = positionOf(options?.position, 'part position');
  const anchors = cloneAnchors(options?.anchors);
  return freeze({
    id,
    grid: copiedGrid,
    width: copiedGrid[0]!.length,
    height: copiedGrid.length,
    face,
    rotation,
    position,
    anchors,
  });
}

export const createPartFromGrid = createAssemblyPart;
export const createPartFromBeanGrid = createAssemblyPart;

/** Create an immutable project snapshot. */
export function createAssemblyProject<T>(parts: readonly AssemblyPart<T>[], joints: readonly AssemblyJoint[] = []): AssemblyProject<T> {
  if (!Array.isArray(parts) || !Array.isArray(joints)) throw new TypeError('parts and joints must be arrays');
  const partCopies: AssemblyPart<T>[] = parts.map((part) => createAssemblyPart<T>(part.id, part.grid, {
    face: part.face,
    rotation: part.rotation,
    position: part.position,
    anchors: part.anchors,
  }));
  const jointCopies = joints.map((joint) => {
    if (!joint || typeof joint.partA !== 'string' || typeof joint.partB !== 'string' || typeof joint.anchorA !== 'string' || typeof joint.anchorB !== 'string') {
      throw new TypeError('joint must reference part and anchor ids');
    }
    return freeze({ ...joint });
  });
  return freeze({ parts: freeze(partCopies), joints: freeze(jointCopies) });
}

function rotatedCoordinates(x: number, y: number, width: number, height: number, rotation: AssemblyRotation): [number, number] {
  if (rotation === 0) return [x, y];
  if (rotation === 90) return [height - 1 - y, x];
  if (rotation === 180) return [width - 1 - x, height - 1 - y];
  return [y, width - 1 - x];
}

function addScaled(origin: AssemblyPosition, u: Vec, v: Vec, a: number, b: number): Vec {
  return [origin.x + u[0] * a + v[0] * b, origin.y + u[1] * a + v[1] * b, origin.z + u[2] * a + v[2] * b];
}

function faceBasis(face: AssemblyFace): { u: Vec; v: Vec } {
  switch (face) {
    case 'front': return { u: [1, 0, 0], v: [0, 1, 0] };
    case 'back': return { u: [-1, 0, 0], v: [0, 1, 0] };
    case 'left': return { u: [0, 0, 1], v: [0, 1, 0] };
    case 'right': return { u: [0, 0, -1], v: [0, 1, 0] };
    case 'top': return { u: [1, 0, 0], v: [0, 0, 1] };
    case 'bottom': return { u: [1, 0, 0], v: [0, 0, -1] };
  }
}

/** Transform one local 2D grid coordinate into its integer world coordinate. */
export function transformAssemblyCoordinate(part: Pick<AssemblyPart, 'face' | 'rotation' | 'position' | 'width' | 'height'>, x: number, y: number): AssemblyPosition {
  assertFace(part.face);
  assertRotation(part.rotation);
  if (!isInteger(x) || !isInteger(y) || x < 0 || y < 0 || x >= part.width || y >= part.height) {
    throw new RangeError('grid coordinate is outside the part');
  }
  const [rx, ry] = rotatedCoordinates(x, y, part.width, part.height, part.rotation);
  const basis = faceBasis(part.face);
  const [wx, wy, wz] = addScaled(part.position, basis.u, basis.v, rx, ry);
  return freeze({ x: wx, y: wy, z: wz });
}

/** Return every non-empty grid cell in world coordinates, without mutating the part. */
export function getAssemblyOccupiedCells<T>(part: AssemblyPart<T>): readonly AssemblyCell<T>[] {
  const cells: AssemblyCell<T>[] = [];
  for (let y = 0; y < part.height; y += 1) {
    for (let x = 0; x < part.width; x += 1) {
      const value = part.grid[y]?.[x];
      if (value === null || value === undefined) continue;
      const position = transformAssemblyCoordinate(part, x, y);
      cells.push(freeze({ partId: part.id, gridX: x, gridY: y, value, ...position }));
    }
  }
  return freeze(cells);
}

export const calculateOccupiedCells = getAssemblyOccupiedCells;
export const getOccupiedCells = getAssemblyOccupiedCells;
export const calculateAssemblyCells = getAssemblyOccupiedCells;
export const transformPartCoordinate = transformAssemblyCoordinate;

function cellKey(position: Pick<AssemblyPosition, 'x' | 'y' | 'z'>): string {
  return `${position.x},${position.y},${position.z}`;
}

/** Find overlapping occupied cells between distinct parts. */
export function findAssemblyCollisions<T>(project: AssemblyProject<T>): readonly AssemblyCollision[] {
  const occupied = new Map<string, { partId: string }>();
  const collisions: AssemblyCollision[] = [];
  for (const part of project.parts) {
    for (const cell of getAssemblyOccupiedCells(part)) {
      const key = cellKey(cell);
      const previous = occupied.get(key);
      if (previous && previous.partId !== part.id) {
        const pair = [previous.partId, part.id].sort();
        const duplicate = collisions.some((collision) => collision.cell.x === cell.x && collision.cell.y === cell.y && collision.cell.z === cell.z && collision.partA === pair[0] && collision.partB === pair[1]);
        if (!duplicate) collisions.push(freeze({ cell: freeze({ x: cell.x, y: cell.y, z: cell.z }), partA: pair[0]!, partB: pair[1]! }));
      } else {
        occupied.set(key, { partId: part.id });
      }
    }
  }
  return freeze(collisions);
}

export const validateAssemblyCollisions = findAssemblyCollisions;
export const detectAssemblyCollisions = findAssemblyCollisions;

function hasContact<T>(a: AssemblyPart<T>, b: AssemblyPart<T>): boolean {
  const bCells = getAssemblyOccupiedCells(b);
  const byKey = new Set(bCells.map(cellKey));
  for (const cell of getAssemblyOccupiedCells(a)) {
    const neighbours = [[cell.x + 1, cell.y, cell.z], [cell.x - 1, cell.y, cell.z], [cell.x, cell.y + 1, cell.z], [cell.x, cell.y - 1, cell.z], [cell.x, cell.y, cell.z + 1], [cell.x, cell.y, cell.z - 1]];
    if (neighbours.some(([x, y, z]) => byKey.has(`${x},${y},${z}`))) return true;
  }
  return false;
}

function findAnchor(part: AssemblyPart, id: string): Anchor | undefined {
  return (part.anchors ?? []).find((anchor) => anchor.id === id);
}

export function validateAssemblyJoints<T>(project: AssemblyProject<T>): readonly AssemblyJointError[] {
  const parts = new Map(project.parts.map((part) => [part.id, part]));
  const errors: AssemblyJointError[] = [];
  for (const joint of project.joints) {
    const partA = parts.get(joint.partA);
    const partB = parts.get(joint.partB);
    if (!partA || !partB) {
      errors.push(freeze({ joint, code: 'missing-part', message: `joint references a missing part: ${!partA ? joint.partA : joint.partB}` }));
      continue;
    }
    if (!findAnchor(partA, joint.anchorA) || !findAnchor(partB, joint.anchorB)) {
      errors.push(freeze({ joint, code: 'missing-anchor', message: 'joint references a missing anchor' }));
      continue;
    }
    if (!hasContact(partA, partB)) errors.push(freeze({ joint, code: 'no-contact', message: 'joint parts do not have adjacent occupied cells' }));
  }
  return freeze(errors);
}

function validatePartShape<T>(part: AssemblyPart<T>, index: number): string[] {
  const errors: string[] = [];
  if (!part || typeof part !== 'object') return [`part ${index} is invalid`];
  if (typeof part.id !== 'string' || part.id.trim() === '') errors.push(`part ${index} has an invalid id`);
  try {
    cloneGrid(part.grid);
    assertFace(part.face);
    assertRotation(part.rotation);
    positionOf(part.position, `part ${part.id || index} position`);
    cloneAnchors(part.anchors);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : `part ${index} is invalid`);
  }
  return errors;
}

/** Validate collisions, joints, and basic project shape without mutating input. */
export function validateAssemblyProject<T>(project: AssemblyProject<T>): AssemblyValidationResult {
  const errors: string[] = [];
  if (!project || typeof project !== 'object' || !Array.isArray(project.parts) || !Array.isArray(project.joints)) {
    return freeze({ valid: false, collisions: [], jointErrors: [], errors: ['project must contain parts and joints arrays'] });
  }
  const ids = new Set<string>();
  project.parts.forEach((part, index) => {
    errors.push(...validatePartShape(part, index));
    if (typeof part?.id === 'string' && ids.has(part.id)) errors.push(`duplicate part id ${part.id}`);
    if (typeof part?.id === 'string') ids.add(part.id);
  });
  const collisions = errors.length === 0 ? findAssemblyCollisions(project) : [];
  const jointErrors = errors.length === 0 ? validateAssemblyJoints(project) : [];
  return freeze({ valid: errors.length === 0 && collisions.length === 0 && jointErrors.length === 0, collisions, jointErrors, errors: freeze(errors) });
}

export function assertValidAssemblyProject<T>(project: AssemblyProject<T>): void {
  const result = validateAssemblyProject(project);
  if (!result.valid) {
    const details = [...result.errors, ...result.collisions.map((collision) => `collision between ${collision.partA} and ${collision.partB} at ${cellKey(collision.cell)}`), ...result.jointErrors.map((error) => error.message)];
    throw new Error(details.join('; ') || 'assembly project is invalid');
  }
}

export const validateAssembly = validateAssemblyProject;
