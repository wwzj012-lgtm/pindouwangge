/**
 * 图例字形锚库（2026-11-24 card4 攻坚定型，生产闭环）：
 * 人工校对确认的真值字形按版式指纹隔离持久化，识别时对自举模板池做
 * 「缺字补位」——不并入自举桶、不参与 prune 聚类（种子三连教训：
 * 与自举同源会改聚类路径，逐位标注必须来源干净）。
 *
 * 存储：localStorage（41 字形 ≈ 数 KB；纯浏览器、跨会话持久）。
 * 序列化红线：bitmap 一律普通 number[]（Uint8Array 过 JSON.stringify
 * 会变成索引对象，还原 new Uint8Array(obj) 得到空数组——今天实测踩坑）。
 */
import type { Bitmap } from './importLegend';

export interface AnchorGlyphSample {
  /** 普通一维 0/1 数组（JSON 安全），长度 = w*h。 */
  data: number[];
  w: number;
  h: number;
  /** 来源标记（调试/审计用）：'row-code-edit' | 'row-locked'。 */
  via: string;
}

export interface AnchorLibraryData {
  version: 1;
  styles: Record<string, { cards: string[]; chars: Record<string, AnchorGlyphSample[]> }>;
}

export interface AnchorGlyphSource {
  bitmap: Bitmap;
}

const STORAGE_KEY = 'legend-anchor-library-v1';
/** 同字符变体上限：防止库无限膨胀与变体混淆。 */
const MAX_INSTANCES = 8;

const bitmapKey = (w: number, h: number, data: ArrayLike<number>): string => `${w}x${h}:${Array.from(data).join('')}`;

/** 版式指纹：字形切片众数宽×众数高。票式色卡字体与点状图例小字天然
 * 不同尺寸，跨指纹不借锚（跨字体锚 = water-box 953→83 的历史坑）。 */
export function fingerprintFromGlyphs(glyphs: AnchorGlyphSource[]): string {
  if (!glyphs.length) return '';
  const ws = glyphs.map(g => g.bitmap.w).sort((a, b) => a - b);
  const hs = glyphs.map(g => g.bitmap.h).sort((a, b) => a - b);
  return `${ws[Math.floor(ws.length / 2)]}x${hs[Math.floor(hs.length / 2)]}`;
}

function readLibrary(): AnchorLibraryData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AnchorLibraryData;
      if (parsed && parsed.version === 1 && parsed.styles) return parsed;
    }
  } catch { /* 损坏库按空处理，识别流程不受影响 */ }
  return { version: 1, styles: {} };
}

function writeLibrary(lib: AnchorLibraryData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lib));
  } catch { /* 配额满/隐私模式：锚库写入失败静默，不阻塞识别 */ }
}

/** 加载某版式的锚（缺字补位用）：Bitmap 在浏览器匹配侧临时构造。 */
export function loadAnchors(fingerprint: string): Map<string, Bitmap[]> {
  const out = new Map<string, Bitmap[]>();
  if (!fingerprint) return out;
  const style = readLibrary().styles[fingerprint];
  if (!style) return out;
  for (const [ch, samples] of Object.entries(style.chars)) {
    out.set(ch, samples.map(s => ({ data: new Uint8Array(s.data), w: s.w, h: s.h })));
  }
  return out;
}

/** 锚库状态描述（面板状态条）：无库返回空串。 */
export function describeAnchors(fingerprint: string): string {
  if (!fingerprint) return '';
  const style = readLibrary().styles[fingerprint];
  if (!style) return '';
  const chars = Object.keys(style.chars).length;
  const count = Object.values(style.chars).reduce((s, a) => s + a.length, 0);
  return `锚库 ${fingerprint}：${chars} 字符 ${count} 字形（来自 ${style.cards.join('、')}）`;
}

/**
 * 学习一条人工确认的色号：该条目的字形按真值逐位标注入锚库。
 * 只接受「字形数 == 色号长度」的条目（切分错误的行逐位标注本身是错的，
 * card4 H13 的 '13' 粘连实证）；同 bitmap hash 去重；超上限淘汰最早样本。
 * @returns 实际新增的字形数（0 = 长度不匹配或全部已存在）。
 */
export function learnCodeGlyphs(
  code: string,
  glyphs: AnchorGlyphSource[],
  via: string,
  cardTag = 'ui',
): number {
  if (glyphs.length !== code.length) return 0;
  const fingerprint = fingerprintFromGlyphs(glyphs);
  if (!fingerprint) return 0;
  const lib = readLibrary();
  const style = lib.styles[fingerprint] ?? { cards: [], chars: {} };
  if (!style.cards.includes(cardTag)) style.cards.push(cardTag);
  let added = 0;
  code.split('').forEach((ch, j) => {
    const g = glyphs[j];
    const list = style.chars[ch] ?? [];
    const key = bitmapKey(g.bitmap.w, g.bitmap.h, g.bitmap.data);
    if (list.some(x => bitmapKey(x.w, x.h, x.data) === key)) return;
    list.push({ data: Array.from(g.bitmap.data), w: g.bitmap.w, h: g.bitmap.h, via });
    style.chars[ch] = list.slice(-MAX_INSTANCES);
    added += 1;
  });
  if (added > 0) {
    lib.styles[fingerprint] = style;
    writeLibrary(lib);
  }
  return added;
}

/** 便捷：从 Bitmap[] 采集该色号全部字形（供面板行学习入口）。 */
export function collectCodeGlyphs(entryGlyphs: Array<{ bitmap: Bitmap }>): AnchorGlyphSource[] {
  return entryGlyphs.map(g => ({ bitmap: g.bitmap }));
}
