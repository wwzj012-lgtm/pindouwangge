export interface ImageFitRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Maps a source image into the bead-grid rectangle using the workspace fit mode. */
export function getGridImageFitRect(
  sourceWidth: number,
  sourceHeight: number,
  gridWidth: number,
  gridHeight: number,
  keepAspectRatio: boolean,
): ImageFitRect | null {
  if (![sourceWidth, sourceHeight, gridWidth, gridHeight].every(value => Number.isFinite(value) && value > 0)) return null;
  if (!keepAspectRatio) return { x: 0, y: 0, width: gridWidth, height: gridHeight };

  const scale = Math.min(gridWidth / sourceWidth, gridHeight / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return { x: (gridWidth - width) / 2, y: (gridHeight - height) / 2, width, height };
}
