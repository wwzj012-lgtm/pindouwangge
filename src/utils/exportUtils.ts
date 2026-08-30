import { BeadColor, BeadShape } from '../types';

export type WatermarkType = 'double_diagonal' | 'corners' | 'bottom' | 'none';
export type WatermarkPosition = WatermarkType | 'grid_and_legend' | 'legend_only' | 'grid_center';
export type LegendPosition = 'right' | 'bottom';
export type LegendScaleMode = 'auto' | '1.0' | '1.5' | '2.0' | '2.5' | '3.0';
export type SymbolDisplayType = 'code' | 'symbol' | 'none';
export type ExportQuality = 'normal' | 'high' | 'ultra';

export interface ExportOptions {
  grid: (string | null)[][];
  paletteMap: Map<string, BeadColor>;
  width: number;
  height: number;
  boardSize: number;
  brandName: string;
  projectName: string;
  showSymbols: boolean;
  showCoordinates: boolean;
  beadShape: BeadShape;
  selectedBoardIndex?: number | null; // null for full image, 0..N for specific sub-board
  watermarkType?: WatermarkType; // Default: 'double_diagonal'
  watermarkText?: string; // Default: '豆织星格' / 'BeadGrid'
  watermarkOpacity?: number; // Default: 0.18
  watermarkColor?: string; // Default: '#A855F7'
  watermarkAngle?: number; // Default: -25
  watermarkPosition?: WatermarkPosition; // Legacy fallback
  legendPosition?: LegendPosition; // Default: 'right'
  legendScaleMode?: LegendScaleMode; // Default: 'auto'
  hideEmptyPegs?: boolean; // Default: false
  isEn?: boolean;
  symbolDisplayType?: SymbolDisplayType; // 'code' (normal code e.g. M01), 'symbol' (icons e.g. ★), 'none'
  symbolFontScale?: number; // 0.7 to 1.5, default 1.0
  exportQuality?: ExportQuality; // 'normal' (1x), 'high' (1.4x HD), 'ultra' (2.0x Ultra HD)
}

// Flexible watermark overlay function supporting double_diagonal, corners, bottom, or none
export function drawWatermarkOverlay(
  ctx: CanvasRenderingContext2D,
  rectX: number,
  rectY: number,
  rectW: number,
  rectH: number,
  type: WatermarkType = 'double_diagonal',
  text: string = '豆织星格',
  opacity: number = 0.18,
  color: string = '#A855F7',
  angleDegrees: number = -25,
  isEn: boolean = false
) {
  if (type === 'none' || opacity <= 0 || rectW <= 0 || rectH <= 0) return;

  const defaultText = isEn ? 'BeadGrid' : '豆织星格';
  const effectiveText = text && text.trim() ? text.trim() : defaultText;

  ctx.save();
  ctx.beginPath();
  ctx.rect(rectX, rectY, rectW, rectH);
  ctx.clip();

  ctx.globalAlpha = opacity;
  const label = effectiveText.startsWith('✦') ? effectiveText : `✦ ${effectiveText}`;

  if (type === 'double_diagonal') {
    const area = rectW * rectH;
    const targetCount = Math.max(5, Math.min(22, Math.round(Math.sqrt(area) / 120)));
    const targetCellArea = area / targetCount;
    const stepY = Math.max(100, Math.round(Math.sqrt(targetCellArea / 2.0)));
    const stepX = Math.max(200, Math.round(stepY * 2.0));
    const fontSize = Math.max(18, Math.min(26, Math.round(stepY * 0.22)));

    ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const angle = (angleDegrees * Math.PI) / 180;
    ctx.translate(rectX + rectW / 2, rectY + rectH / 2);
    ctx.rotate(angle);

    ctx.fillStyle = color || '#A855F7';

    const diagonal = Math.sqrt(rectW * rectW + rectH * rectH) * 1.5;
    const startX = -diagonal;
    const endX = diagonal;
    const startY = -diagonal;
    const endY = diagonal;

    for (let y = startY; y < endY; y += stepY) {
      const rowIdx = Math.floor(y / stepY);
      const offsetX = rowIdx % 2 === 0 ? 0 : stepX / 2;
      for (let x = startX; x < endX; x += stepX) {
        ctx.fillText(label, x + offsetX, y);
      }
    }
  } else if (type === 'corners') {
    const padding = 16;
    const fontSize = Math.max(13, Math.min(20, Math.round(rectW * 0.03)));
    ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
    ctx.fillStyle = color || '#A855F7';

    // Top-Left
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(label, rectX + padding, rectY + padding);

    // Top-Right
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText(label, rectX + rectW - padding, rectY + padding);

    // Bottom-Left
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(label, rectX + padding, rectY + rectH - padding);

    // Bottom-Right
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText(label, rectX + rectW - padding, rectY + rectH - padding);
  } else if (type === 'bottom') {
    const padding = 14;
    const fontSize = Math.max(14, Math.min(22, Math.round(rectW * 0.035)));
    ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
    ctx.fillStyle = color || '#A855F7';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(label, rectX + rectW / 2, rectY + rectH - padding);
  }

  ctx.restore();
}

// Convert column index to Excel-style letter coordinate (0 -> A, 25 -> Z, 26 -> AA)
export function getColumnLetter(colIndex: number): string {
  let temp = colIndex;
  let letter = '';
  while (temp >= 0) {
    letter = String.fromCharCode((temp % 26) + 65) + letter;
    temp = Math.floor(temp / 26) - 1;
  }
  return letter;
}

// Render 3D Fuse Bead or Flat bead on canvas context
export function drawBeadOnCanvas(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  colorHex: string,
  shape: BeadShape,
  symbolStr?: string | null,
  symbolFontScale: number = 1.0
) {
  if (shape === 'square') {
    ctx.fillStyle = colorHex;
    ctx.fillRect(x, y, size, size);
    ctx.strokeStyle = '#00000022';
    ctx.lineWidth = Math.max(0.5, size * 0.02);
    ctx.strokeRect(x, y, size, size);
  } else if (shape === 'circle_flat') {
    ctx.beginPath();
    ctx.arc(x + size / 2, y + size / 2, size * 0.46, 0, Math.PI * 2);
    ctx.fillStyle = colorHex;
    ctx.fill();
    ctx.strokeStyle = '#00000033';
    ctx.lineWidth = Math.max(0.5, size * 0.03);
    ctx.stroke();
  } else if (shape === 'ironed') {
    // Ironed beads are nearly fused into one surface: only a 2.5% total cell gap
    // remains so adjacent colors stay readable without resembling separate beads.
    const inset = size * 0.0125;
    const fusedSize = size - inset * 2;
    const radius = Math.round(size * 0.085 * 100) / 100;
    const seamInset = size * 0.018;
    const edgeWidth = Math.max(0.35, size * 0.012);
    const textureLineWidth = Math.max(0.25, size * 0.006);
    const textureLineCount = Math.min(4, Math.max(1, Math.floor(size / 18)));

    ctx.beginPath();
    ctx.roundRect(x + inset, y + inset, fusedSize, fusedSize, radius);
    ctx.fillStyle = colorHex;
    ctx.fill();

    // A restrained perimeter keeps white and near-white areas readable on the board.
    ctx.beginPath();
    ctx.roundRect(x + inset, y + inset, fusedSize, fusedSize, radius);
    ctx.strokeStyle = '#00000028';
    ctx.lineWidth = edgeWidth;
    ctx.stroke();

    // Short, low-contrast seams read as a flattened join, not a raised 3D rim.
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x + inset, y + inset, fusedSize, fusedSize, radius);
    ctx.clip();

    ctx.beginPath();
    ctx.moveTo(x + seamInset + radius, y + seamInset);
    ctx.lineTo(x + size - seamInset - radius, y + seamInset);
    ctx.moveTo(x + seamInset, y + seamInset + radius);
    ctx.lineTo(x + seamInset, y + size - seamInset - radius);
    ctx.strokeStyle = '#ffffff20';
    ctx.lineWidth = edgeWidth;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(x + seamInset + radius, y + size - seamInset);
    ctx.lineTo(x + size - seamInset - radius, y + size - seamInset);
    ctx.moveTo(x + size - seamInset, y + seamInset + radius);
    ctx.lineTo(x + size - seamInset, y + size - seamInset - radius);
    ctx.strokeStyle = '#00000019';
    ctx.lineWidth = edgeWidth;
    ctx.stroke();

    // Deterministic, size-controlled paper texture avoids noisy pixel grain.
    const texturePadding = Math.max(radius, size * 0.11);
    const textureStartX = x + inset + texturePadding;
    const textureEndX = x + inset + fusedSize - texturePadding;
    ctx.strokeStyle = '#ffffff12';
    ctx.lineWidth = textureLineWidth;
    for (let lineIndex = 0; lineIndex < textureLineCount; lineIndex++) {
      const progress = (lineIndex + 1) / (textureLineCount + 1);
      const textureY = y + inset + fusedSize * progress;
      const offset = lineIndex % 2 === 0 ? size * 0.01 : -size * 0.01;
      ctx.beginPath();
      ctx.moveTo(textureStartX + offset, textureY);
      ctx.lineTo(textureEndX - offset, textureY + (lineIndex % 2 === 0 ? -size * 0.004 : size * 0.004));
      ctx.stroke();
    }
    ctx.restore();
  } else if (shape === 'fuse_3d') {
    // 'fuse_3d' Realistic fuse bead with center peg hole
    const cx = x + size / 2;
    const cy = y + size / 2;
    const r = size * 0.46;

    // Outer ring
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = colorHex;
    ctx.fill();

    // Outer rim highlight / shadow
    ctx.lineWidth = Math.max(1, size * 0.08);
    ctx.strokeStyle = '#ffffff44';
    ctx.stroke();

    // Inner bead hole
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.35, 0, Math.PI * 2);
    ctx.fillStyle = '#00000033';
    ctx.fill();
    ctx.strokeStyle = '#00000022';
    ctx.lineWidth = Math.max(0.5, size * 0.02);
    ctx.stroke();
  } else {
    // Runtime-safe fallback for unknown shape values: keep the preview flat.
    ctx.fillStyle = colorHex;
    ctx.fillRect(x, y, size, size);
    ctx.strokeStyle = '#00000022';
    ctx.lineWidth = Math.max(0.5, size * 0.02);
    ctx.strokeRect(x, y, size, size);
  }

  // Symbol or short color code text inside cell (ultra-clean, sharp & thin font)
  if (symbolStr && size >= 6) {
    const hex = colorHex.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16) || 255;
    const g = parseInt(hex.substring(2, 4), 16) || 255;
    const b = parseInt(hex.substring(4, 6), 16) || 255;
    const brightness = (r * 299 + g * 587 + b * 114) / 1000;
    const maxC = Math.max(r, g, b);
    const minC = Math.min(r, g, b);
    const maxSaturation = maxC > 0 ? (maxC - minC) / maxC : 0;

    // Contrast & Color Logic (as specified):
    // 1. Dark blocks: pure white text with 0.9 opacity
    // 2. Light/bright blocks: soft dark #222222 (not harsh black)
    // 3. High-saturation vivid blocks: white text with 0.85 opacity
    let textColor = 'rgba(255, 255, 255, 0.9)';
    if (brightness > 155 && maxSaturation < 0.6) {
      textColor = 'rgba(34, 34, 34, 0.92)';
    } else if (maxSaturation >= 0.6 && brightness > 100) {
      textColor = 'rgba(255, 255, 255, 0.85)';
    } else if (brightness <= 155) {
      textColor = 'rgba(255, 255, 255, 0.9)';
    }

    ctx.save();
    ctx.fillStyle = textColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const len = symbolStr.length;
    // Scale font size based on string length & symbolFontScale
    const baseScale = len <= 1 ? 0.52 : len === 2 ? 0.42 : len === 3 ? 0.34 : 0.27;
    const fontSize = Math.max(6, Math.floor(size * baseScale * symbolFontScale));

    if (fontSize >= 5) {
      // Clean thin/light font stack for crisp non-overlapping numbers & icons
      ctx.font = `300 ${fontSize}px "Roboto Light", "Roboto", "JetBrains Mono", system-ui, -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif`;
      ctx.fillText(symbolStr, x + size / 2, y + size / 2 + 0.5);
    }
    ctx.restore();
  }
}

// Generate printable tutorial canvas
export function generatePatternCanvas(options: ExportOptions): HTMLCanvasElement {
  const {
    grid,
    paletteMap,
    width,
    height,
    boardSize,
    brandName,
    projectName,
    showSymbols,
    showCoordinates,
    beadShape,
    selectedBoardIndex,
    watermarkType: rawWatermarkType,
    watermarkText = options.isEn ? 'BeadGrid' : '豆织星格',
    watermarkOpacity = 0.18,
    watermarkColor = '#A855F7',
    watermarkAngle = -25,
    watermarkPosition = 'grid_and_legend',
    legendPosition = 'right',
    legendScaleMode = 'auto',
    hideEmptyPegs = false,
    isEn = false,
  } = options;

  // Resolve effective watermark type
  const watermarkType: WatermarkType = rawWatermarkType
    ? rawWatermarkType
    : (watermarkPosition === 'none' ? 'none' : 'double_diagonal');

  // 1. Calculate sub-boards bounds if a specific board is requested
  const boardsX = Math.ceil(width / boardSize);
  let startX = 0;
  let endX = width;
  let startY = 0;
  let endY = height;
  let subBoardTitle = '';

  if (selectedBoardIndex !== undefined && selectedBoardIndex !== null) {
    const bx = selectedBoardIndex % boardsX;
    const by = Math.floor(selectedBoardIndex / boardsX);
    startX = bx * boardSize;
    endX = Math.min(width, (bx + 1) * boardSize);
    startY = by * boardSize;
    endY = Math.min(height, (by + 1) * boardSize);
    subBoardTitle = isEn
      ? ` [Pegboard #${selectedBoardIndex + 1} (${bx + 1},${by + 1})]`
      : ` [拼豆板第 ${selectedBoardIndex + 1} 板 (${bx + 1},${by + 1})]`;
  }

  const activeWidth = endX - startX;
  const activeHeight = endY - startY;

  // Sizing parameters: dynamically adjust cellSize based on grid dimensions & exportQuality
  const exportQuality = options.exportQuality || 'high';
  const qualityMultiplier = exportQuality === 'normal' ? 1.0 : exportQuality === 'ultra' ? 2.0 : 1.4;

  const maxGridBeadsInView = Math.max(activeWidth, activeHeight);
  let baseCellSize = 28;
  if (maxGridBeadsInView > 120) {
    baseCellSize = 18;
  } else if (maxGridBeadsInView > 80) {
    baseCellSize = 22;
  } else if (maxGridBeadsInView > 40) {
    baseCellSize = 25;
  }

  const cellSize = Math.round(baseCellSize * qualityMultiplier);

  const gridPixelWidth = activeWidth * cellSize;
  const gridPixelHeight = activeHeight * cellSize;

  // 2. Count beads & colors
  const colorCounts = new Map<string, number>();
  let totalBeadsInView = 0;

  for (let y = startY; y < endY; y++) {
    for (let x = startX; x < endX; x++) {
      const cellId = grid[y][x];
      if (cellId) {
        colorCounts.set(cellId, (colorCounts.get(cellId) || 0) + 1);
        totalBeadsInView++;
      }
    }
  }

  const sortedColors = Array.from(colorCounts.entries())
    .map(([colorId, count]) => ({ bead: paletteMap.get(colorId), count }))
    .filter(item => item.bead !== undefined)
    .sort((a, b) => b.count - a.count);

  // 3. Dynamic Legend Scaling Factor Calculation (Capped to prevent huge canvas scaling)
  let scale = 1.0;
  if (legendScaleMode === 'auto') {
    const maxGridDim = Math.max(gridPixelWidth, gridPixelHeight);
    scale = Math.max(1.0, Math.min(1.5, maxGridDim / 720));
  } else {
    scale = parseFloat(legendScaleMode) || 1.0;
  }

  // Scaled dimensions & typography
  const headerHeight = Math.round(70 * Math.max(1, scale * 0.7));
  const coordSize = showCoordinates ? Math.round(30 * Math.max(1, scale * 0.6)) : 0;
  const startGridX = 20 + coordSize;
  const startGridY = headerHeight + coordSize;

  const swatchSize = Math.round(22 * scale);
  const rowHeight = Math.round(32 * scale);
  const legendColWidth = Math.round(200 * scale);

  const legendHeaderFont = `bold ${Math.round(18 * scale)}px sans-serif`;
  const legendSubFont = `${Math.round(13 * scale)}px sans-serif`;
  const legendCodeFont = `bold ${Math.round(14 * scale)}px monospace`;
  const legendNameFont = `${Math.round(13 * scale)}px sans-serif`;
  const legendCountFont = `bold ${Math.round(14 * scale)}px sans-serif`;

  // 4. Calculate Legend Layout & Canvas Bounds
  let totalCanvasWidth = 0;
  let totalCanvasHeight = 0;
  let numCols = 1;
  let maxRowsPerCol = sortedColors.length || 1;
  let totalLegendWidth = 0;
  let totalLegendHeight = 0;

  if (legendPosition === 'right') {
    const headerSpace = Math.round(75 * scale);
    const availGridHeight = Math.max(gridPixelHeight, Math.round(320 * scale));
    maxRowsPerCol = Math.max(4, Math.floor((availGridHeight - headerSpace) / rowHeight));
    numCols = Math.max(1, Math.ceil(sortedColors.length / maxRowsPerCol));
    totalLegendWidth = numCols * legendColWidth + Math.round(20 * scale);

    totalCanvasWidth = startGridX + gridPixelWidth + totalLegendWidth + Math.round(35 * scale);
    const legendNeededH = maxRowsPerCol * rowHeight + headerSpace;
    totalCanvasHeight = headerHeight + coordSize + Math.max(gridPixelHeight, legendNeededH) + Math.round(40 * scale);
  } else {
    // 'bottom' layout
    const availWidth = gridPixelWidth + coordSize;
    numCols = Math.max(1, Math.floor(availWidth / legendColWidth));
    const totalRows = Math.ceil(sortedColors.length / numCols) || 1;
    totalLegendHeight = totalRows * rowHeight + Math.round(85 * scale);

    totalCanvasWidth = Math.max(
      startGridX + gridPixelWidth + Math.round(30 * scale),
      startGridX + numCols * legendColWidth + Math.round(30 * scale)
    );
    totalCanvasHeight = startGridY + gridPixelHeight + totalLegendHeight + Math.round(40 * scale);
  }

  const canvas = document.createElement('canvas');
  canvas.width = totalCanvasWidth;
  canvas.height = totalCanvasHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  // White background
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, totalCanvasWidth, totalCanvasHeight);

  // 5. Header Title & Meta Info
  const mainTitleFont = `bold ${Math.round(22 * Math.max(1, scale * 0.7))}px sans-serif`;
  const subTitleFont = `${Math.round(13 * Math.max(1, scale * 0.6))}px sans-serif`;

  ctx.fillStyle = '#1E293B';
  ctx.font = mainTitleFont;
  ctx.textAlign = 'left';
  ctx.fillText(`${projectName}${subBoardTitle}`, 20, Math.round(36 * Math.max(1, scale * 0.7)));

  ctx.fillStyle = '#64748B';
  ctx.font = subTitleFont;
  ctx.fillText(
    isEn
      ? `Brand: ${brandName} | Size: ${width}x${height} Beads (${Math.ceil(width / boardSize) * Math.ceil(height / boardSize)} board(s) of ${boardSize}x${boardSize})`
      : `品牌: ${brandName} | 尺寸: ${width}x${height} 豆 (需 ${Math.ceil(width / boardSize) * Math.ceil(height / boardSize)} 个 ${boardSize}x${boardSize} 板)`,
    20,
    Math.round(58 * Math.max(1, scale * 0.7))
  );

  // 6. Coordinate Labels (A..Z top, 1..N left)
  if (showCoordinates) {
    ctx.fillStyle = '#475569';
    ctx.font = `bold ${Math.round(11 * Math.max(1, scale * 0.6))}px sans-serif`;
    ctx.textAlign = 'center';

    // Top X coordinates
    for (let x = startX; x < endX; x++) {
      const px = startGridX + (x - startX) * cellSize + cellSize / 2;
      const label = getColumnLetter(x);
      ctx.fillText(label, px, startGridY - 8);
    }

    // Left Y coordinates
    ctx.textAlign = 'right';
    for (let y = startY; y < endY; y++) {
      const py = startGridY + (y - startY) * cellSize + cellSize / 2 + 4;
      ctx.fillText((y + 1).toString(), startGridX - 8, py);
    }
  }

  // 7. Render Grid Background and Lines First (Allows round beads to overlap lines cleanly and keeps white beads highly visible)
  ctx.fillStyle = '#F1F5F9';
  ctx.fillRect(startGridX, startGridY, gridPixelWidth, gridPixelHeight);

  ctx.strokeStyle = '#E2E8F0';
  ctx.lineWidth = 0.5;
  for (let y = startY; y < endY; y++) {
    for (let x = startX; x < endX; x++) {
      const px = startGridX + (x - startX) * cellSize;
      const py = startGridY + (y - startY) * cellSize;
      ctx.strokeRect(px, py, cellSize, cellSize);
    }
  }

  // Draw Beads or Peg Dots on top of the background grid
  const symbolDisplayType = options.symbolDisplayType ?? (showSymbols ? 'code' : 'none');
  const symbolFontScale = options.symbolFontScale ?? 1.0;

  for (let y = startY; y < endY; y++) {
    for (let x = startX; x < endX; x++) {
      const px = startGridX + (x - startX) * cellSize;
      const py = startGridY + (y - startY) * cellSize;

      const cellId = grid[y][x];
      if (cellId) {
        const bead = paletteMap.get(cellId);
        const colorHex = bead ? bead.hex : '#CCCCCC';
        let label: string | null = null;
        if (bead) {
          if (symbolDisplayType === 'code') {
            label = bead.code || bead.symbol || null;
          } else if (symbolDisplayType === 'symbol') {
            label = bead.symbol || bead.code || null;
          } else if (symbolDisplayType === 'none') {
            label = null;
          }
        }

        drawBeadOnCanvas(ctx, px, py, cellSize, colorHex, beadShape, label, symbolFontScale);
      } else if (!hideEmptyPegs) {
        // Simple elegant peg dot inside empty cell (rendered beautifully over the grey background grid)
        ctx.beginPath();
        ctx.arc(px + cellSize / 2, py + cellSize / 2, Math.max(1.8, cellSize * 0.08), 0, Math.PI * 2);
        ctx.fillStyle = '#CBD5E1';
        ctx.fill();
      }
    }
  }

  // 8. Board Outline Overlays (Subtle translucent lines for pegboards)
  ctx.strokeStyle = 'rgba(59, 130, 246, 0.45)';
  ctx.lineWidth = 1.5;
  for (let bx = Math.floor(startX / boardSize); bx <= Math.ceil(endX / boardSize); bx++) {
    const gx = bx * boardSize;
    if (gx >= startX && gx <= endX) {
      const px = startGridX + (gx - startX) * cellSize;
      ctx.beginPath();
      ctx.moveTo(px, startGridY);
      ctx.lineTo(px, startGridY + gridPixelHeight);
      ctx.stroke();
    }
  }
  for (let by = Math.floor(startY / boardSize); by <= Math.ceil(endY / boardSize); by++) {
    const gy = by * boardSize;
    if (gy >= startY && gy <= endY) {
      const py = startGridY + (gy - startY) * cellSize;
      ctx.beginPath();
      ctx.moveTo(startGridX, py);
      ctx.lineTo(startGridX + gridPixelWidth, py);
      ctx.stroke();
    }
  }

  // Render Grid Watermark Overlay
  drawWatermarkOverlay(
    ctx,
    startGridX,
    startGridY,
    gridPixelWidth,
    gridPixelHeight,
    watermarkType,
    watermarkText,
    watermarkOpacity,
    watermarkColor,
    watermarkAngle,
    isEn
  );

  // 9. Render Scaled Legend Panel (Right Sidebar or Bottom Block)
  const legendX = legendPosition === 'right'
    ? startGridX + gridPixelWidth + Math.round(25 * scale)
    : startGridX;
  const legendY = legendPosition === 'right'
    ? headerHeight + 10
    : startGridY + gridPixelHeight + Math.round(25 * scale);

  const legendBoxW = legendPosition === 'right'
    ? totalLegendWidth
    : (totalCanvasWidth - legendX - Math.round(20 * scale));
  const legendBoxH = legendPosition === 'right'
    ? (totalCanvasHeight - legendY - Math.round(20 * scale))
    : (totalCanvasHeight - legendY - Math.round(25 * scale));

  // Legend Card Background
  ctx.fillStyle = '#F8FAFC';
  ctx.strokeStyle = '#CBD5E1';
  ctx.lineWidth = Math.max(1, Math.round(1.5 * scale));
  ctx.fillRect(legendX - 10, legendY - 10, legendBoxW, legendBoxH);
  ctx.strokeRect(legendX - 10, legendY - 10, legendBoxW, legendBoxH);

  // Legend Watermark Overlay
  drawWatermarkOverlay(
    ctx,
    legendX - 10,
    legendY - 10,
    legendBoxW,
    legendBoxH,
    watermarkType,
    watermarkText,
    Math.min(0.28, watermarkOpacity + 0.04),
    watermarkColor,
    watermarkAngle,
    isEn
  );

  // Legend Header Text
  ctx.fillStyle = '#0F172A';
  ctx.font = legendHeaderFont;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(isEn ? 'Color & Bead Quantity Checklist' : '拼豆用量色号清单', legendX, legendY);

  ctx.font = legendSubFont;
  ctx.fillStyle = '#64748B';
  ctx.fillText(
    isEn
      ? `Total Beads: ${totalBeadsInView} | ${sortedColors.length} Colors`
      : `总用豆量: ${totalBeadsInView} 粒 | 共 ${sortedColors.length} 色`,
    legendX,
    legendY + Math.round(26 * scale)
  );

  // Divider Line
  ctx.strokeStyle = '#CBD5E1';
  ctx.lineWidth = Math.max(1, Math.round(1 * scale));
  ctx.beginPath();
  ctx.moveTo(legendX, legendY + Math.round(48 * scale));
  ctx.lineTo(legendX + legendBoxW - Math.round(20 * scale), legendY + Math.round(48 * scale));
  ctx.stroke();

  const itemsStartY = legendY + Math.round(60 * scale);

  // Render Table Items
  sortedColors.forEach(({ bead, count }, idx) => {
    if (!bead) return;

    let col = 0;
    let row = 0;

    if (legendPosition === 'right') {
      col = Math.floor(idx / maxRowsPerCol);
      row = idx % maxRowsPerCol;
    } else {
      col = idx % numCols;
      row = Math.floor(idx / numCols);
    }

    const itemX = legendX + col * legendColWidth;
    const itemY = itemsStartY + row * rowHeight;

    // Color Swatch Box
    ctx.fillStyle = bead.hex;
    ctx.fillRect(itemX, itemY, swatchSize, swatchSize);
    ctx.strokeStyle = '#00000033';
    ctx.lineWidth = Math.max(1, Math.round(1 * scale));
    ctx.strokeRect(itemX, itemY, swatchSize, swatchSize);

    // Symbol / Code inside swatch
    let swatchLabel: string | null = null;
    if (symbolDisplayType === 'code') swatchLabel = bead.code;
    else if (symbolDisplayType === 'symbol') swatchLabel = bead.symbol;
    else if (symbolDisplayType !== 'none' && showSymbols) swatchLabel = bead.symbol || bead.code;

    if (swatchLabel && symbolDisplayType !== 'none') {
      const hex = bead.hex.replace('#', '');
      const r = parseInt(hex.substring(0, 2), 16) || 255;
      const g = parseInt(hex.substring(2, 4), 16) || 255;
      const b = parseInt(hex.substring(4, 6), 16) || 255;
      const brightness = (r * 299 + g * 587 + b * 114) / 1000;

      ctx.fillStyle = brightness > 140 ? '#000000' : '#FFFFFF';
      const swatchFontScale = swatchLabel.length > 2 ? 0.75 : 1.0;
      ctx.font = `bold ${Math.round(10 * scale * swatchFontScale)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(swatchLabel, itemX + swatchSize / 2, itemY + swatchSize / 2);
    }

    // Code
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = legendCodeFont;
    ctx.fillStyle = '#0F172A';
    ctx.fillText(`${bead.code}`, itemX + swatchSize + Math.round(8 * scale), itemY + swatchSize / 2);

    // Name
    ctx.font = legendNameFont;
    ctx.fillStyle = '#334155';
    const nameStr = bead.name.length > 8 ? bead.name.slice(0, 8) + '..' : bead.name;
    ctx.fillText(nameStr, itemX + swatchSize + Math.round(62 * scale), itemY + swatchSize / 2);

    // Count
    ctx.font = legendCountFont;
    ctx.fillStyle = '#2563EB';
    ctx.textAlign = 'right';
    ctx.fillText(isEn ? `${count}` : `${count} 粒`, itemX + legendColWidth - Math.round(15 * scale), itemY + swatchSize / 2);
  });

  // Footer Watermark
  ctx.save();
  ctx.fillStyle = '#94A3B8';
  ctx.font = `500 ${Math.round(12 * Math.max(1, scale * 0.7))}px sans-serif`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillText(
    isEn ? 'Pattern generated by BeadGrid Studio' : '图纸生成自专业拼豆工作台【豆织星格】',
    totalCanvasWidth - 20,
    totalCanvasHeight - 10
  );
  ctx.restore();

  return canvas;
}

export function isWeChatBrowser(): boolean {
  return typeof navigator !== 'undefined' && /MicroMessenger/i.test(navigator.userAgent);
}

// Download canvas as PNG image (utilizes toBlob with object URL, handles WeChat restrictions)
export type CanvasDownloadResult = 'downloaded' | 'wechat-preview';

const MAX_EXPORT_PIXELS = 40_000_000;
const DEFAULT_BLOB_TIMEOUT_MS = 20_000;

function canvasToBlobWithTimeout(canvas: HTMLCanvasElement, timeoutMs: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new Error('PNG 生成超时，请降低图纸尺寸或切换分板导出后重试。'));
    }, timeoutMs);

    try {
      canvas.toBlob(blob => {
        window.clearTimeout(timeoutId);
        if (!blob) {
          reject(new Error('PNG 生成失败：浏览器未返回图像数据。'));
          return;
        }
        resolve(blob);
      }, 'image/png');
    } catch (error) {
      window.clearTimeout(timeoutId);
      reject(error instanceof Error ? error : new Error('PNG 生成失败。'));
    }
  });
}

// Download canvas as a PNG via a Blob URL. The promise lets the UI report generation and failures.
export async function downloadCanvasImage(
  canvas: HTMLCanvasElement,
  filename: string,
  onWeChatSaveNotice?: (dataUrl: string) => void,
  timeoutMs = DEFAULT_BLOB_TIMEOUT_MS,
): Promise<CanvasDownloadResult> {
  const finalFilename = filename.endsWith('.png') ? filename : `${filename}.png`;
  const pixels = canvas.width * canvas.height;

  if (!Number.isFinite(pixels) || canvas.width < 1 || canvas.height < 1) {
    throw new Error('PNG 生成失败：图纸尺寸无效。');
  }
  if (pixels > MAX_EXPORT_PIXELS) {
    throw new Error('图纸尺寸过大，无法安全生成 PNG。请切换分板导出或降低导出画质。');
  }

  if (isWeChatBrowser() && onWeChatSaveNotice) {
    try {
      onWeChatSaveNotice(canvas.toDataURL('image/png'));
      return 'wechat-preview';
    } catch (error) {
      throw error instanceof Error ? error : new Error('微信预览生成失败。');
    }
  }

  const blob = await canvasToBlobWithTimeout(canvas, timeoutMs);
  let url: string | null = null;

  try {
    url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = finalFilename;
    link.rel = 'noopener';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url!), 1_000);
    return 'downloaded';
  } catch (error) {
    if (url) URL.revokeObjectURL(url);
    throw error instanceof Error ? error : new Error('无法启动浏览器下载。');
  }
}

// Download project JSON file
export function downloadProjectJson(data: object, filename: string) {
  const jsonStr = JSON.stringify(data, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.download = filename.endsWith('.perler') ? filename : `${filename}.perler`;
  link.href = url;
  link.click();
  URL.revokeObjectURL(url);
}
