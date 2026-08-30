import { useEffect, useMemo, useRef, useState } from 'react';
import { createAssemblyPreview, type RenderCell } from '../utils/assembly3dPreview';
import type { AssemblyProject } from '../utils/assembly3d';

type PaletteEntry = { hex: string; code?: string; name?: string };
type PreviewCell = RenderCell<string | null>;

interface Assembly3DPreviewProps {
  project: AssemblyProject<string | null>;
  paletteMap: Map<string, PaletteEntry>;
  collisionPartIds: readonly string[];
}

type CanvasSize = { width: number; height: number };

const EMPTY_SIZE: CanvasSize = { width: 0, height: 0 };
const PREVIEW_PADDING = 18;

function comparePreviewCells(left: PreviewCell, right: PreviewCell): number {
  return left.depthSortKey - right.depthSortKey
    || left.worldY - right.worldY
    || left.worldX - right.worldX
    || left.worldZ - right.worldZ
    || left.partId.localeCompare(right.partId)
    || left.gridY - right.gridY
    || left.gridX - right.gridX;
}

function isHexColor(value: string): boolean {
  return /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(value);
}

function shadeHex(hex: string, factor: number): string {
  if (!isHexColor(hex)) return hex;
  const normalized = hex.length === 4
    ? `#${hex.slice(1).split('').map(component => component + component).join('')}`
    : hex;
  const channels = [1, 3, 5].map(offset => Number.parseInt(normalized.slice(offset, offset + 2), 16));
  return `#${channels.map(channel => Math.round(Math.max(0, Math.min(255, channel * factor))).toString(16).padStart(2, '0')).join('')}`;
}

function colorForCell(cell: PreviewCell, paletteMap: Map<string, PaletteEntry>): string {
  const value = cell.colorValue;
  if (typeof value !== 'string') return '#CBD5E1';
  return paletteMap.get(value)?.hex ?? (isHexColor(value) ? value : '#CBD5E1');
}

function fillPolygon(context: CanvasRenderingContext2D, points: readonly [number, number][], fill: string, collision: boolean): void {
  context.beginPath();
  context.moveTo(points[0]![0], points[0]![1]);
  for (let index = 1; index < points.length; index += 1) context.lineTo(points[index]![0], points[index]![1]);
  context.closePath();
  context.fillStyle = fill;
  context.fill();
  context.lineWidth = collision ? 1.5 : 0.75;
  context.strokeStyle = collision ? '#DC2626' : 'rgba(51, 65, 85, 0.38)';
  context.stroke();
}

function drawEmptyState(context: CanvasRenderingContext2D, size: CanvasSize): void {
  context.fillStyle = '#F8FAFC';
  context.fillRect(0, 0, size.width, size.height);
  context.fillStyle = '#64748B';
  context.font = '600 12px system-ui, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText('No generated assembly parts to preview', size.width / 2, size.height / 2);
}

export function Assembly3DPreview({ project, paletteMap, collisionPartIds }: Assembly3DPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [canvasSize, setCanvasSize] = useState<CanvasSize>(EMPTY_SIZE);
  const preview = useMemo(() => createAssemblyPreview(project), [project]);
  const cells = useMemo(() => [...preview.cells].sort(comparePreviewCells), [preview]);
  const collisionIds = useMemo(() => new Set(collisionPartIds), [collisionPartIds]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = canvas?.parentElement;
    if (!container) return undefined;

    const updateSize = () => {
      const bounds = container.getBoundingClientRect();
      const width = Math.round(bounds.width);
      const height = Math.round(bounds.height);
      setCanvasSize(current => current.width === width && current.height === height ? current : { width, height });
    };

    updateSize();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateSize);
      return () => window.removeEventListener('resize', updateSize);
    }

    const observer = new ResizeObserver(updateSize);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || canvasSize.width < 1 || canvasSize.height < 1) return;

    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const pixelWidth = Math.max(1, Math.round(canvasSize.width * pixelRatio));
    const pixelHeight = Math.max(1, Math.round(canvasSize.height * pixelRatio));
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;

    const context = canvas.getContext('2d');
    if (!context) return;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, canvasSize.width, canvasSize.height);

    if (cells.length === 0) {
      drawEmptyState(context, canvasSize);
      return;
    }

    const positioned = cells.map(cell => ({
      cell,
      x: cell.worldX - cell.worldZ,
      y: (cell.worldX + cell.worldZ) / 2 - cell.worldY,
    }));
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const item of positioned) {
      minX = Math.min(minX, item.x - 1);
      maxX = Math.max(maxX, item.x + 1);
      minY = Math.min(minY, item.y - 0.6);
      maxY = Math.max(maxY, item.y + 1.5);
    }

    const horizontalUnits = Math.max(1, maxX - minX);
    const verticalUnits = Math.max(1, maxY - minY);
    const usableWidth = Math.max(1, canvasSize.width - PREVIEW_PADDING * 2);
    const usableHeight = Math.max(1, canvasSize.height - PREVIEW_PADDING * 2);
    const unit = Math.min(30, Math.max(4, Math.min(usableWidth / horizontalUnits, usableHeight / verticalUnits)));
    const contentWidth = horizontalUnits * unit;
    const contentHeight = verticalUnits * unit;
    const offsetX = (canvasSize.width - contentWidth) / 2 - minX * unit;
    const offsetY = (canvasSize.height - contentHeight) / 2 - minY * unit;
    const halfWidth = unit;
    const halfHeight = unit * 0.48;
    const cubeHeight = unit * 0.92;

    context.fillStyle = '#F8FAFC';
    context.fillRect(0, 0, canvasSize.width, canvasSize.height);
    for (const item of positioned) {
      const centerX = offsetX + item.x * unit;
      const centerY = offsetY + item.y * unit;
      const base = colorForCell(item.cell, paletteMap);
      const collision = collisionIds.has(item.cell.partId);
      const top: [number, number][] = [
        [centerX, centerY - halfHeight],
        [centerX + halfWidth, centerY],
        [centerX, centerY + halfHeight],
        [centerX - halfWidth, centerY],
      ];
      const left: [number, number][] = [
        top[3],
        top[2],
        [centerX, centerY + halfHeight + cubeHeight],
        [centerX - halfWidth, centerY + cubeHeight],
      ];
      const right: [number, number][] = [
        top[1],
        [centerX + halfWidth, centerY + cubeHeight],
        [centerX, centerY + halfHeight + cubeHeight],
        top[2],
      ];
      fillPolygon(context, left, shadeHex(base, 0.76), collision);
      fillPolygon(context, right, shadeHex(base, 0.58), collision);
      fillPolygon(context, top, shadeHex(base, 1.08), collision);
    }
  }, [canvasSize, cells, collisionIds, paletteMap]);

  return (
    <div className="relative mt-2 h-56 w-full overflow-hidden rounded border border-slate-200 bg-slate-50" aria-label="Isometric assembly preview">
      <canvas ref={canvasRef} className="block h-full w-full" role="img" aria-label={`Isometric assembly preview with ${cells.length} beads`} />
    </div>
  );
}
