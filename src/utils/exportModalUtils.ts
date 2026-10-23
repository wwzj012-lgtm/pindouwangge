import type { BeadColor } from '../types';
import type { ExportOptions } from './exportUtils';

export type ExportPreset = 'standard' | 'follow' | 'share';

// Presets only change presentation. Membership privileges are resolved separately.
export function getExportPreset(preset: ExportPreset) {
  return {
    showSymbols: preset !== 'share',
    symbolDisplayType: preset === 'share' ? 'none' as const : 'code' as const,
    symbolFontScale: preset === 'follow' ? 1.25 : 1,
    exportQuality: 'high' as const,
    showCoordinates: preset !== 'share',
    legendPosition: preset === 'follow' ? 'bottom' as const : 'right' as const,
    legendScaleMode: 'auto' as const,
    hideEmptyPegs: true,
  };
}

export function resolveExportPrivileges(options: ExportOptions, isVip: boolean): ExportOptions {
  if (isVip) return options;
  return {
    ...options,
    watermarkType: options.watermarkType === 'none' ? 'double_diagonal' : options.watermarkType,
    exportQuality: options.exportQuality === 'ultra' ? 'high' : options.exportQuality,
    watermarkText: options.isEn ? 'BeadGrid' : '豆织星格',
    watermarkColor: '#A855F7',
    watermarkAngle: -25,
  };
}

export function getExportFilenameBase(value: string, fallback: string): string {
  const clean = (name: string) => name
    .replace(/\.png\s*$/i, '')
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_')
    .trim()
    .slice(0, 100)
    .replace(/[. ]+$/, '');
  const base = clean(value) || clean(fallback) || 'Pattern';
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(base) ? `_${base}` : base;
}

export function getExportFilename(base: string, board: number | null, isEn: boolean): string {
  const suffix = board === null
    ? (isEn ? '_FullPattern' : '_完整图纸')
    : (isEn ? `_Board${board + 1}` : `_板${board + 1}`);
  return `${base}${suffix}.png`;
}

export function getExportSummary(
  grid: (string | null)[][],
  paletteMap: Map<string, BeadColor>,
  width: number,
  height: number,
  boardSize: number,
  board: number | null,
) {
  const boardsX = Math.ceil(width / boardSize);
  const startX = board === null ? 0 : (board % boardsX) * boardSize;
  const startY = board === null ? 0 : Math.floor(board / boardsX) * boardSize;
  const endX = board === null ? width : Math.min(width, startX + boardSize);
  const endY = board === null ? height : Math.min(height, startY + boardSize);
  const counts = new Map<string, number>();
  let totalBeads = 0;
  for (let y = startY; y < endY; y++) {
    for (let x = startX; x < endX; x++) {
      const id = grid[y]?.[x];
      if (id !== null && id !== undefined) {
        counts.set(id, (counts.get(id) ?? 0) + 1);
        totalBeads++;
      }
    }
  }
  const materials = Array.from(counts, ([id, count]) => ({ id, bead: paletteMap.get(id), count }))
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
  return { width: endX - startX, height: endY - startY, totalBeads, colorCount: counts.size, materials };
}
