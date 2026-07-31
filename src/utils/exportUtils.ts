import { BeadColor, BeadShape } from '../types';

export type WatermarkPosition = 'grid_and_legend' | 'legend_only' | 'grid_center' | 'none';

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
  watermarkPosition?: WatermarkPosition; // Default: 'grid_and_legend'
  watermarkOpacity?: number; // Default: 0.18
}

// Draw diagonal translucent watermark across a rectangular region
function drawDiagonalWatermark(
  ctx: CanvasRenderingContext2D,
  rectX: number,
  rectY: number,
  rectW: number,
  rectH: number,
  text: string,
  opacity: number = 0.18,
  fontSize: number = 20,
  stepX: number = 240,
  stepY: number = 140
) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(rectX, rectY, rectW, rectH);
  ctx.clip();

  ctx.globalAlpha = opacity;
  ctx.fillStyle = '#6B21A8'; // Deep purple contrast watermark
  ctx.font = `bold ${fontSize}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const angle = -25 * Math.PI / 180;
  ctx.translate(rectX + rectW / 2, rectY + rectH / 2);
  ctx.rotate(angle);

  // Cover bounding box
  const diagonal = Math.sqrt(rectW * rectW + rectH * rectH) * 1.5;
  const startX = -diagonal;
  const endX = diagonal;
  const startY = -diagonal;
  const endY = diagonal;

  for (let y = startY; y < endY; y += stepY) {
    const rowIdx = Math.floor(y / stepY);
    const offsetX = (rowIdx % 2 === 0) ? 0 : stepX / 2;
    for (let x = startX; x < endX; x += stepX) {
      ctx.fillText(text, x + offsetX, y);
    }
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
  if (symbolStr && size >= 10) {
    // Determine text color based on background contrast
    const hex = colorHex.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16) || 255;
    const g = parseInt(hex.substring(2, 4), 16) || 255;
    const b = parseInt(hex.substring(4, 6), 16) || 255;
    const brightness = (r * 299 + g * 587 + b * 114) / 1000;
    const textColor = brightness > 140 ? '#000000' : '#FFFFFF';

    ctx.fillStyle = textColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${Math.max(8, Math.floor(size * 0.45))}px sans-serif`;
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
    watermarkPosition = 'grid_and_legend',
    watermarkOpacity = 0.18,
  } = options;

  // Calculate sub-boards bounds if a specific board is requested
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

  // Sizing parameters for high resolution output
  const cellSize = 24; // 24px per bead cell in high-res export
  const coordSize = showCoordinates ? 30 : 0;
  const headerHeight = 70;
  const legendWidth = 260; // Right side legend panel

  const gridPixelWidth = activeWidth * cellSize;
  const gridPixelHeight = activeHeight * cellSize;

  const totalCanvasWidth = coordSize + gridPixelWidth + legendWidth + 40;
  const totalCanvasHeight = headerHeight + coordSize + Math.max(gridPixelHeight, 400) + 40;

  const canvas = document.createElement('canvas');
  canvas.width = totalCanvasWidth;
  canvas.height = totalCanvasHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  // White background
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, totalCanvasWidth, totalCanvasHeight);

  // 1. Header Title & Meta Info
  ctx.fillStyle = '#1E293B';
  ctx.font = 'bold 22px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`${projectName}${subBoardTitle}`, 20, 36);

  ctx.fillStyle = '#64748B';
  ctx.font = '13px sans-serif';
  ctx.fillText(
    `品牌: ${brandName} | 尺寸: ${width}x${height} 豆 (需 ${Math.ceil(width / boardSize) * Math.ceil(height / boardSize)} 个 ${boardSize}x${boardSize} 板)`,
    20,
    58
  );

  const startGridX = 20 + coordSize;
  const startGridY = headerHeight + coordSize;

  // 2. Coordinate Labels (A..Z top, 1..N left)
  if (showCoordinates) {
    ctx.fillStyle = '#475569';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';

    // Top X coordinates
    for (let x = startX; x < endX; x++) {
      const px = startGridX + (x - startX) * cellSize + cellSize / 2;
      const label = getColumnLetter(x);
      ctx.fillText(label, px, headerHeight + coordSize - 8);
    }

    // Left Y coordinates
    ctx.textAlign = 'right';
    for (let y = startY; y < endY; y++) {
      const py = startGridY + (y - startY) * cellSize + cellSize / 2 + 4;
      ctx.fillText((y + 1).toString(), startGridX - 8, py);
    }
  }

  // 3. Render Bead Grid
  const colorCounts = new Map<string, number>();

  for (let y = startY; y < endY; y++) {
    for (let x = startX; x < endX; x++) {
      const px = startGridX + (x - startX) * cellSize;
      const py = startGridY + (y - startY) * cellSize;

      const cellId = grid[y][x];
      if (cellId) {
        colorCounts.set(cellId, (colorCounts.get(cellId) || 0) + 1);
        const bead = paletteMap.get(cellId);
        const colorHex = bead ? bead.hex : '#CCCCCC';
        const label = showSymbols && bead ? (bead.symbol || bead.code) : null;

        drawBeadOnCanvas(ctx, px, py, cellSize, colorHex, beadShape, label);
      } else {
        // Empty pegboard cell
        ctx.fillStyle = '#F1F5F9';
        ctx.fillRect(px, py, cellSize, cellSize);
        ctx.strokeStyle = '#E2E8F0';
        ctx.lineWidth = 1;
        ctx.strokeRect(px, py, cellSize, cellSize);

        // Peg dot
        ctx.beginPath();
        ctx.arc(px + cellSize / 2, py + cellSize / 2, 2, 0, Math.PI * 2);
        ctx.fillStyle = '#CBD5E1';
        ctx.fill();
      }

      // Board grid highlights (every 5 cells subtle line, every boardSize thick line)
      ctx.strokeStyle = '#E2E8F0';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(px, py, cellSize, cellSize);
    }
  }

  // 4. Board Outline Overlays (Thick red/blue lines for pegboards)
  ctx.strokeStyle = '#3B82F6';
  ctx.lineWidth = 2;
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
  if (watermarkPosition === 'grid_and_legend') {
    drawDiagonalWatermark(
      ctx,
      startGridX,
      startGridY,
      gridPixelWidth,
      gridPixelHeight,
      '✦ 豆织星格 PERLER PATTERN',
      watermarkOpacity,
      20,
      250,
      150
    );
  } else if (watermarkPosition === 'grid_center') {
    ctx.save();
    ctx.globalAlpha = Math.min(0.35, watermarkOpacity * 1.5);
    ctx.fillStyle = '#6B21A8';
    ctx.font = 'bold 30px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      '✦ 豆织星格 拼豆图纸 ✦',
      startGridX + gridPixelWidth / 2,
      startGridY + gridPixelHeight / 2
    );
    ctx.restore();
  }

  // 5. Render Legend Sidebar on Right Side
  const legendX = startGridX + gridPixelWidth + 30;
  let legendY = headerHeight + 10;

  // Render Legend Diagonal Watermark
  if (watermarkPosition === 'grid_and_legend' || watermarkPosition === 'legend_only') {
    drawDiagonalWatermark(
      ctx,
      legendX - 10,
      headerHeight + 5,
      legendWidth,
      totalCanvasHeight - headerHeight - 20,
      '✦ 豆织星格 色号清单 ✦',
      Math.min(0.28, watermarkOpacity + 0.04),
      16,
      200,
      110
    );
  }

  ctx.fillStyle = '#0F172A';
  ctx.font = 'bold 15px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('拼豆用量色号清单', legendX, legendY);
  legendY += 24;

  let totalBeadsInView = 0;
  const sortedColors = Array.from(colorCounts.entries())
    .map(([colorId, count]) => {
      totalBeadsInView += count;
      return { bead: paletteMap.get(colorId), count };
    })
    .filter(item => item.bead !== undefined)
    .sort((a, b) => b.count - a.count);

  ctx.font = '12px sans-serif';
  ctx.fillStyle = '#64748B';
  ctx.fillText(`总用豆量: ${totalBeadsInView} 粒 | 共 ${sortedColors.length} 色`, legendX, legendY);
  legendY += 20;

  // Divider
  ctx.strokeStyle = '#CBD5E1';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(legendX, legendY);
  ctx.lineTo(legendX + legendWidth - 10, legendY);
  ctx.stroke();
  legendY += 15;

  // Table items
  sortedColors.forEach(({ bead, count }) => {
    if (!bead) return;

    if (legendY > totalCanvasHeight - 30) return; // Prevent overflow

    // Color Swatch Box
    ctx.fillStyle = bead.hex;
    ctx.fillRect(legendX, legendY, 20, 20);
    ctx.strokeStyle = '#00000022';
    ctx.strokeRect(legendX, legendY, 20, 20);

    if (bead.symbol && showSymbols) {
      ctx.fillStyle = '#000000';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(bead.symbol, legendX + 10, legendY + 12);
    }

    // Code & Name
    ctx.textAlign = 'left';
    ctx.font = 'bold 12px monospace';
    ctx.fillStyle = '#0F172A';
    ctx.fillText(`${bead.code}`, legendX + 28, legendY + 14);

    ctx.font = '12px sans-serif';
    ctx.fillStyle = '#334155';
    const nameStr = bead.name.length > 8 ? bead.name.slice(0, 8) + '..' : bead.name;
    ctx.fillText(nameStr, legendX + 80, legendY + 14);

    // Count
    ctx.font = 'bold 12px sans-serif';
    ctx.fillStyle = '#2563EB';
    ctx.textAlign = 'right';
    ctx.fillText(`${count} 粒`, legendX + legendWidth - 20, legendY + 14);

    legendY += 26;
  });

  // Footer Watermark
  ctx.save();
  ctx.fillStyle = '#94A3B8';
  ctx.font = '500 12px sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('图纸生成自专业拼豆工作台【豆织星格】', totalCanvasWidth - 20, totalCanvasHeight - 12);
  ctx.restore();

  return canvas;
}

// Download canvas as PNG image
export function downloadCanvasImage(canvas: HTMLCanvasElement, filename: string) {
  const link = document.createElement('a');
  link.download = filename.endsWith('.png') ? filename : `${filename}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
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
