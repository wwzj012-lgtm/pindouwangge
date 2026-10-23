import { validateStoredProject, type StoredPatternProject } from './patternGridCodec';

export interface CanvasMembership {
  isVip?: boolean;
  isPro?: boolean;
}

export function canvasLimitForMembership(membership: CanvasMembership): number {
  return membership.isPro ? 900 : membership.isVip ? 400 : 100;
}

/** Editing follows the current user's tier, never the author's entitlements. */
export function canEditCommunityPattern(
  project: Pick<StoredPatternProject, 'width' | 'height'>,
  membership: CanvasMembership,
): boolean {
  const limit = canvasLimitForMembership(membership);
  return Number.isInteger(project.width) && project.width >= 1 && project.width <= limit
    && Number.isInteger(project.height) && project.height >= 1 && project.height <= limit;
}

export interface CommunityCropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Copy original cells verbatim; no resizing, palette matching, or inherited rights. */
export function cropCommunityPattern(
  project: StoredPatternProject,
  rect: CommunityCropRect,
  membership: CanvasMembership,
): StoredPatternProject {
  validateStoredProject(project);
  const { x, y, width, height } = rect;
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0
    || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error('框选起点必须为非负整数，宽度和高度必须为正整数');
  }
  if (x + width > project.width || y + height > project.height) {
    throw new Error('框选区域超出原图范围，请在原图内重新选择');
  }
  const limit = canvasLimitForMembership(membership);
  if (width > limit || height > limit) {
    throw new Error(`框选区域超过当前权益的 ${limit}×${limit} 上限，请缩小框选区域或升级会员`);
  }

  const suffix = '（区域副本）';
  // Explicit project fields prevent work IDs, payment state, and source hashes
  // attached to an editor project from leaking into this independent copy.
  return {
    version: project.version,
    name: `${project.name.slice(0, 60 - suffix.length)}${suffix}`,
    width,
    height,
    boardSize: project.boardSize,
    brand: project.brand,
    settings: { ...project.settings, width, height },
    grid: project.grid.slice(y, y + height).map(row => row.slice(x, x + width)),
    palette: project.palette.map(color => ({ ...color, rgb: [...color.rgb] })),
    createdAt: project.createdAt,
  };
}
