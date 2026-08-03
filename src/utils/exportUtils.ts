import { BeadColor, BeadShape } from '../types';

export type WatermarkType = 'double_diagonal' | 'corners' | 'bottom' | 'none';
export type WatermarkPosition = WatermarkType | 'grid_and_legend' | 'legend_only' | 'grid_center';
export type LegendPosition = 'right' | 'bottom';
export type LegendScaleMode = 'auto' | '1.0' | '1.5' | '2.0' | '2.5' | '3.0';

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
  watermarkText?: string; // Default: '豆织星格'
  watermarkOpacity?: number; // Default: 0.18
  watermarkColor?: string; // Default: '#A855F7'
  watermarkAngle?: number; // Default: -25
  watermarkPosition?: WatermarkPosition; // Legacy fallback
  legendPosition?: LegendPosition; // Default: 'right'
  legendScaleMode?: LegendScaleMode; // Default: 'auto'
  hideEmptyPegs?: boolean; // Default: false
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
  angleDegrees: number = -25
) {
  if (type === 'none' || opacity <= 0 || rectW <= 0 || rectH <= 0) return;

  ctx.save();
  ctx.beginPath();
  ctx.rect(rectX, rectY, rectW, rectH);
  ctx.clip();

  ctx.globalAlpha = opacity;
  const label = text.trim() ? (text.startsWith('✦') ? text : `✦ ${text}`) : '✦ 豆织星格';

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
  symbolStr?: string | null
) {
  if (shape === 'square') {
    ctx.fillStyle = colorHex;
    ctx.fillRect(x, y, size, size);
    ctx.strokeStyle = '#00000022';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(x, y, size, size);
  } else if (shape === 'circle_flat') {
    ctx.beginPath();
    ctx.arc(x + size / 2, y + size / 2, size * 0.46, 0, Math.PI * 2);
    ctx.fillStyle = colorHex;
    ctx.fill();
    ctx.strokeStyle = '#00000033';
    ctx.lineWidth = 1;
    ctx.stroke();
  } else {
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
    ctx.lineWidth = 0.5;
    ctx.stroke();
  }

  // Symbol or short code text inside cell
  if (symbolStr && size >= 8) {
    // Determine text color based on background contrast with soft alpha transparency for comfortable legibility
    const hex = colorHex.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16) || 255;
    const g = parseInt(hex.substring(2, 4), 16) || 255;
    const b = parseInt(hex.substring(4, 6), 16) || 255;
    const brightness = (r * 299 + g * 587 + b * 114) / 1000;
    const textColor = brightness > 140 ? 'rgba(0, 0, 0, 0.72)' : 'rgba(255, 255, 255, 0.88)';

    ctx.fillStyle = textColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    // Dynamically adjust font size based on string length for perfect balance & clear readability
    const len = symbolStr.length;
    const scale = len <= 1 ? 0.46 : len === 2 ? 0.40 : 0.34;
    const fontSize = Math.max(7, Math.floor(size * scale));

    ctx.font = `700 ${fontSize}px system-ui, -apple-system, sans-serif`;
    ctx.fillText(symbolStr, x + size / 2, y + size / 2);
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
    watermarkText = '豆织星格',
    watermarkOpacity = 0.18,
    watermarkColor = '#A855F7',
    watermarkAngle = -25,
    watermarkPosition = 'grid_and_legend',
    legendPosition = 'right',
    legendScaleMode = 'auto',
    hideEmptyPegs = false,
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
    subBoardTitle = ` [拼豆板第 ${selectedBoardIndex + 1} 板 (${bx + 1},${by + 1})]`;
  }

  const activeWidth = endX - startX;
  const activeHeight = endY - startY;

  // Sizing parameters: dynamically adjust cellSize based on grid dimensions to prevent canvas size limit failures
  const maxGridBeadsInView = Math.max(activeWidth, activeHeight);
  let cellSize = 24; // 24px per bead cell for standard boards
  if (maxGridBeadsInView > 80) {
    cellSize = 12;
  } else if (maxGridBeadsInView > 50) {
    cellSize = 16;
  } else if (maxGridBeadsInView > 32) {
    cellSize = 20;
  }

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
    `品牌: ${brandName} | 尺寸: ${width}x${height} 豆 (需 ${Math.ceil(width / boardSize) * Math.ceil(height / boardSize)} 个 ${boardSize}x${boardSize} 板)`,
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
  for (let y = startY; y < endY; y++) {
    for (let x = startX; x < endX; x++) {
      const px = startGridX + (x - startX) * cellSize;
      const py = startGridY + (y - startY) * cellSize;

      const cellId = grid[y][x];
      if (cellId) {
        const bead = paletteMap.get(cellId);
        const colorHex = bead ? bead.hex : '#CCCCCC';
        const label = showSymbols && bead ? (bead.symbol || bead.code) : null;

        drawBeadOnCanvas(ctx, px, py, cellSize, colorHex, beadShape, label);
      } else if (!hideEmptyPegs) {
        // Simple elegant peg dot inside empty cell (rendered beautifully over the grey background grid)
        ctx.beginPath();
        ctx.arc(px + cellSize / 2, py + cellSize / 2, 1.8, 0, Math.PI * 2);
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
    watermarkAngle
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
    watermarkAngle
  );

  // Legend Header Text
  ctx.fillStyle = '#0F172A';
  ctx.font = legendHeaderFont;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('拼豆用量色号清单', legendX, legendY);

  ctx.font = legendSubFont;
  ctx.fillStyle = '#64748B';
  ctx.fillText(
    `总用豆量: ${totalBeadsInView} 粒 | 共 ${sortedColors.length} 色`,
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

    // Symbol inside swatch
    if (bead.symbol && showSymbols) {
      const hex = bead.hex.replace('#', '');
      const r = parseInt(hex.substring(0, 2), 16) || 255;
      const g = parseInt(hex.substring(2, 4), 16) || 255;
      const b = parseInt(hex.substring(4, 6), 16) || 255;
      const brightness = (r * 299 + g * 587 + b * 114) / 1000;

      ctx.fillStyle = brightness > 140 ? '#000000' : '#FFFFFF';
      ctx.font = `bold ${Math.round(11 * scale)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(bead.symbol, itemX + swatchSize / 2, itemY + swatchSize / 2);
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
    ctx.fillText(`${count} 粒`, itemX + legendColWidth - Math.round(15 * scale), itemY + swatchSize / 2);
  });

  // Footer Watermark
  ctx.save();
  ctx.fillStyle = '#94A3B8';
  ctx.font = `500 ${Math.round(12 * Math.max(1, scale * 0.7))}px sans-serif`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillText('图纸生成自专业拼豆工作台【豆织星格】', totalCanvasWidth - 20, totalCanvasHeight - 10);
  ctx.restore();

  return canvas;
}

// Download canvas as PNG image (utilizes toBlob with object URL for maximum memory efficiency, especially on large grids)
export function downloadCanvasImage(canvas: HTMLCanvasElement, filename: string) {
  const finalFilename = filename.endsWith('.png') ? filename : `${filename}.png`;
  
  try {
    canvas.toBlob((blob) => {
      if (!blob) {
        // Fallback to toDataURL if toBlob fails or is not supported in environment
        const url = canvas.toDataURL('image/png');
        const link = document.createElement('a');
        link.download = finalFilename;
        link.href = url;
        link.click();
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = finalFilename;
      link.href = url;
      link.click();
      
      // Clean up the object URL after a short delay
      setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 200);
    }, 'image/png');
  } catch (err) {
    // Fallback if toBlob errors out
    const url = canvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.download = finalFilename;
    link.href = url;
    link.click();
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
