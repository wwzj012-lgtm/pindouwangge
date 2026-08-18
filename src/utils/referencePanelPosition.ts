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
