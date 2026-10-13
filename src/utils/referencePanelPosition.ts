export interface ReferencePanelSize {
  width: number;
  height: number;
}

export interface ReferencePanelPosition {
  x: number;
  y: number;
}

export const REFERENCE_PANEL_MARGIN = 8;

export function clampReferencePanelPosition(
  position: ReferencePanelPosition,
  container: ReferencePanelSize,
  panel: ReferencePanelSize,
  margin = REFERENCE_PANEL_MARGIN,
): ReferencePanelPosition {
  const maxX = Math.max(margin, container.width - panel.width - margin);
  const maxY = Math.max(margin, container.height - panel.height - margin);

  return {
    x: Math.min(Math.max(margin, position.x), maxX),
    y: Math.min(Math.max(margin, position.y), maxY),
  };
}

export function getInitialReferencePanelPosition(
  container: ReferencePanelSize,
  panel: ReferencePanelSize,
  margin = REFERENCE_PANEL_MARGIN,
): ReferencePanelPosition {
  return clampReferencePanelPosition(
    { x: container.width - panel.width - margin, y: margin },
    container,
    panel,
    margin,
  );
}

/**
 * When collapsing the reference panel, the minimized icon appears
 * directly at the position of the collapse button (top-right of header),
 * rather than jumping to the top-left (upload button) position.
 */
export function getCollapsedReferencePanelPosition(
  position: ReferencePanelPosition,
  container: ReferencePanelSize,
  expandedSize: ReferencePanelSize,
  minimizedSize: ReferencePanelSize,
  margin = REFERENCE_PANEL_MARGIN,
): ReferencePanelPosition {
  // Center of the collapse button relative to expanded panel:
  // right padding ~6px, button width 28px -> center is ~20px from right edge
  // header top padding ~4px, button height 28px -> center is ~18px from top edge
  const buttonCenterX = position.x + expandedSize.width - 20;
  const buttonCenterY = position.y + 18;

  const targetX = buttonCenterX - minimizedSize.width / 2;
  const targetY = buttonCenterY - minimizedSize.height / 2;

  return clampReferencePanelPosition(
    { x: targetX, y: targetY },
    container,
    minimizedSize,
    margin,
  );
}

/**
 * When expanding the reference panel from the minimized cloud icon,
 * anchor the collapse button area of the expanded panel to where the icon was.
 */
export function getExpandedReferencePanelPosition(
  position: ReferencePanelPosition,
  container: ReferencePanelSize,
  expandedSize: ReferencePanelSize,
  minimizedSize: ReferencePanelSize,
  margin = REFERENCE_PANEL_MARGIN,
): ReferencePanelPosition {
  const cloudCenterX = position.x + minimizedSize.width / 2;
  const cloudCenterY = position.y + minimizedSize.height / 2;

  const targetX = cloudCenterX - (expandedSize.width - 20);
  const targetY = cloudCenterY - 18;

  return clampReferencePanelPosition(
    { x: targetX, y: targetY },
    container,
    expandedSize,
    margin,
  );
}
