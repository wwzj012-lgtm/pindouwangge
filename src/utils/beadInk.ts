/**
 * 豆色墨色通用模块（2026-11-26 收口）：
 * 全应用所有「豆色底 + 色号文字」的渲染层共用这一份亮度判定与墨色选择——
 * 画板(GridCanvas→drawBeadOnCanvas)、大画布(LargeCanvasView 两层)、
 * 识别结果画布(ImportRecognitionCanvas)、导出图纸/图例(exportUtils)、
 * 识别向导色块(ImportBlueprintWizard)、统计面板(StatsPanel)。
 *
 * 历史教训（同一类坑爆过两次）：
 * 1. LargeCanvasView 两层写死深墨 → 深豆上色号隐身；
 * 2. exportUtils 用 `parseInt(...) || 255` 算亮度——0 是假值，纯黑 H7
 *    (#000000) 三通道全被强转 255 → 亮度 255 → 黑豆配深墨。
 * 任何新渲染层一律引用本模块，不要再手写亮度判定。
 */

const HEX_SHORT_RE = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i;
const HEX_LONG_RE = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;

/** 解析 hex 为 RGB；支持 3/6 位，非法输入返回 null（调用方自行兜底）。 */
export function parseHexRgb(hex: string | undefined | null): { r: number; g: number; b: number } | null {
  if (!hex) return null;
  const short = HEX_SHORT_RE.exec(hex.trim());
  if (short) {
    return {
      r: Number.parseInt(short[1] + short[1], 16),
      g: Number.parseInt(short[2] + short[2], 16),
      b: Number.parseInt(short[3] + short[3], 16),
    };
  }
  const long = HEX_LONG_RE.exec(hex.trim());
  if (!long) return null;
  return {
    r: Number.parseInt(long[1], 16),
    g: Number.parseInt(long[2], 16),
    b: Number.parseInt(long[3], 16),
  };
}

/** 感知亮度（0-255，0.299/0.587/0.114 加权；非法输入按最暗 0 处理）。 */
export function beadLuma(hex: string | undefined | null): number {
  const rgb = parseHexRgb(hex);
  if (!rgb) return 0;
  return (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000;
}

export const BEAD_INK_DARK_BEAD = 'rgba(255,255,255,0.92)'; // 深豆 → 白墨
export const BEAD_INK_LIGHT_BEAD = 'rgba(15,23,42,0.8)';    // 浅豆 → 深墨
/** 亮度分界：≤150 视为深豆（与识别向导/识别画布历史口径一致）。 */
export const BEAD_INK_THRESHOLD = 150;

export interface BeadInkOptions {
  /** 深豆使用的墨色（默认 BEAD_INK_DARK_BEAD），导出等需要纯色的场景可覆盖。 */
  darkInk?: string;
  /** 浅豆使用的墨色（默认 BEAD_INK_LIGHT_BEAD）。 */
  lightInk?: string;
  /** 亮度分界（默认 150）。 */
  threshold?: number;
  /** 非法 hex 时的墨色（默认按浅豆深墨——调用方兜底底色通常是浅中性色）。 */
  fallbackInk?: string;
}

/** 豆色 → 文字墨色：唯一入口，所有渲染层必须走这里。 */
export function beadInkFor(hex: string | undefined | null, options: BeadInkOptions = {}): string {
  const darkInk = options.darkInk ?? BEAD_INK_DARK_BEAD;
  const lightInk = options.lightInk ?? BEAD_INK_LIGHT_BEAD;
  const fallbackInk = options.fallbackInk ?? lightInk;
  const threshold = options.threshold ?? BEAD_INK_THRESHOLD;
  const rgb = parseHexRgb(hex);
  if (!rgb) return fallbackInk;
  return (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000 <= threshold ? darkInk : lightInk;
}
