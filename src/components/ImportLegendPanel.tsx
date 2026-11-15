import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, ChevronDown, Lock, LockOpen, Plus, ScanSearch, Search, Trash2, SquareDashed } from 'lucide-react';
import type { BeadColor } from '../types';
import {
  LEGEND_LOW_CONFIDENCE,
  parseLegend,
  suggestCodeFromRgb,
  strictCodeFromRgb,
  type LegendFrameRect,
  type LegendParseResult,
} from '../utils/importLegend';
import type { ImportGridCalibration, ImportImageDimensions } from '../utils/importGridCalibration';

/**
 * 「图例锁定」面板：识别设置区里的手动入口。
 *
 * 图纸上常印着"色点 + 色号 + NNN粒"的图例条——色点是作者标注的标准答案。
 * 点「从图例自动识别」解析图例，得到每色的目标粒数；用户核对/修改后，
 * 锁定行经 paletteLock（色板白名单）与 countQuota（数量配额）传入识别管线。
 * 不点按钮、不锁定时识别行为与未开启时完全一致。
 *
 * 解析失败（普通照片没有图例条）静默降级为手动加行，不阻塞识别流程。
 */

export interface LegendLockRow {
  /** 色号（必须在当前色板内才参与锁定）。 */
  code: string;
  /** 目标粒数（恰好语义）。 */
  count: number;
  /**
   * 数量锁定开关：开启 = 识别后把该色配平到恰好 N 粒。
   * 语义是"用户逐行显式勾选恰好 N 粒"——自动解析只默认锁色板，
   * 数量一律默认不锁（粒数自动识别准确率有限，默认锁定会让错配额
   * 驱动平衡改写，造成主动伤害；见 2024 回归裁决）。
   */
  countLocked: boolean;
  /** 行开关：由色板成员派生（在色板内 = 参与白名单与数量平衡）。 */
  enabled: boolean;
  /** 自动解析置信度（手动添加的行没有）。 */
  confidence?: number;
  /** 自动解析异常说明（供 UI 标黄解释）。 */
  warn?: string;
}

export interface LegendLockState {
  rows: LegendLockRow[];
  /**
   * 色板白名单总开关（默认关，必须显式打开）。
   *
   * 为什么默认关（瑶图 2026-11-14 实测教训）：解析出的色号可能有错，白名单
   * 会把整个色板收窄到这几个色号——27 行解析里只有 3 个色号有效时，整张图
   * 被迫映射成 3 种颜色，用户看到的是"整图糊成金色"而毫无线索。白名单是
   * 强力但危险的工具，交给用户核对完色号后自己打开。
   */
  whitelist?: boolean;
}

export interface ImportLegendPanelProps {
  imageElement: HTMLImageElement | null;
  dimensions: ImportImageDimensions | null;
  calibration: ImportGridCalibration | null;
  palette: BeadColor[];
  value: LegendLockState;
  onChange: (state: LegendLockState) => void;
  /** 识别进行中：禁用自动解析按钮。 */
  busy?: boolean;
  /** 用户框选的图例区域（图像像素坐标）；null = 自动定位图例带。 */
  legendRegion: LegendFrameRect | null;
  /** 「框选图例区域」按钮：切画布到图例框选模式。 */
  onFrameRequest: () => void;
  /** 清除框选区域。 */
  onClearRegion: () => void;
}

const FAILURE_NOTES: Record<string, string> = {
  noLegendBand: '图片下方没有找到图例条（普通照片没有图例），请手动添加行。',
  tooFewEntries: '图例条目太少，无法确认是图例条，请手动添加行。',
  templateStarved: '图例字形无法自举识别（字号太小或对比不足），请手动添加行。',
};

/** 框选区域模式下的失败文案：框内没有可用条目时引导重新框选。 */
const FRAME_FAILURE_NOTES: Record<string, string> = {
  noLegendBand: '框选区域内没有找到图例条目，请确认框住的是图例（拖动重新框选，或清除后重试自动识别）。',
  tooFewEntries: '框选区域内的图例条目太少，请把整个图例条框进去再试。',
  templateStarved: '图例字形无法自举识别（字号太小或对比不足），请手动添加行。',
};

/** 单行解析警告的人话翻译（多个用 ; 连接）。 */
function describeWarn(warn: string | undefined): string {
  if (!warn) return '';
  const map: Record<string, string> = {
    lowConfidence: '置信度低，请核对',
    splitSuspicious: '色号/数量切分存疑',
    countUnread: '粒数未读出',
    countOutOfRange: '粒数超出范围',
    countTailDropped: '粒数尾部被截断',
    duplicateCode: '色号重复',
    shapeTiePrior: '字形与色点先验打平，以色点为准',
    shapeMismatchPrior: '字形与色点先验不符，以色点为准',
    priorOnly: '仅凭色点先验判定',
    codeNotInPalette: '色号不在当前色板',
    codeFromSwatch: '色号未读出，按色点颜色建议，请核对',
    noTemplates: '缺少字形模板',
    templateStarvedEntry: '模板不足',
    entryTooShort: '条目太短',
    codeLenMismatch: '色号长度存疑',
  };
  return warn.split(';').map(key => map[key] ?? key).join('；');
}

/**
 * 解析结果 → 锁定行（handleAutoParse 的装配步骤，导出供单测直测）。
 *
 * 裁决口径：色板白名单默认开（enabled），数量锁定一律默认关——
 * 解析粒数仅作参考值，用户核对后逐行勾选或用「全部锁定数量」。
 * 低置信行保留 warn 供 UI 标黄提示，不做任何静默降级。
 *
 * 色号未读出（code 为空）的条目不再生成空白行占 UI（2026-11-14 用户
 * 实测反馈）：有色点的按色板最近色预填建议（warn=codeFromSwatch 请
 * 核对），连建议都给不出的省略掉——省略数由 parseSkippedCount 统计。
 */
export function parseEntriesToRows(
  entries: LegendParseResult['entries'],
  paletteCodes: ReadonlySet<string>,
  palette?: ReadonlyArray<BeadColor>,
): LegendLockRow[] {
  const rows: LegendLockRow[] = [];
  for (const entry of entries) {
    let code = entry.code;
    let warn = entry.warn;
    if (code.length === 0 && palette && palette.length) {
      // 空白行治理：色点先验是最强证据（整块印刷色），建议色必须过 ΔE 上限。
      const suggestion = entry.dotRgb ? suggestCodeFromRgb(entry.dotRgb, palette) : null;
      if (!suggestion) continue;
      code = suggestion.code;
      warn = [warn, 'codeFromSwatch'].filter(Boolean).join(';');
    }
    if (code.length === 0) continue;
    // 色板外错读码纠正（2026-11-15 用户实测「为什么出现不是这里面的」）：
    // D23→H1、M14→M10 这类 OCR 错读的色点仍是整块真印刷色——严格条件
    // （ΔE≤8 + 次近邻 margin≥3）下改判色板最近色；歧义/超限保留原码。
    if (palette && palette.length && !paletteCodes.has(code) && entry.dotRgb) {
      const strict = strictCodeFromRgb(entry.dotRgb, palette);
      if (strict) {
        code = strict.code;
        warn = [warn, 'codeFromSwatch'].filter(Boolean).join(';');
      }
    }
    rows.push({
      code,
      count: entry.count,
      countLocked: false,
      enabled: paletteCodes.has(code),
      confidence: entry.confidence,
      warn,
    });
  }
  // 同码去重（2026-11-15 用户实测「27 色里竟然有重复的」）：错读码经
  // 色点纠正后可能撞上真码（两条 H1），保 confidence 最高的一条。
  const byCode = new Map<string, LegendLockRow>();
  for (const row of rows) {
    const prev = byCode.get(row.code);
    if (!prev || row.confidence > prev.confidence) byCode.set(row.code, row);
  }
  return [...byCode.values()];
}

/** 解析条目里因「色号未读出且无法建议」被省略的数量（供 parseNote 说明）。 */
export function parseSkippedCount(
  entries: LegendParseResult['entries'],
  palette?: ReadonlyArray<BeadColor>,
): number {
  if (!palette || !palette.length) return entries.filter(entry => entry.code.length === 0).length;
  return entries.filter(entry => entry.code.length === 0 && !(entry.dotRgb && suggestCodeFromRgb(entry.dotRgb, palette))).length;
}

/** 全部锁定数量的投影合计：所有启用行（含未锁定行）的目标粒数之和。 */
export function lockableCountSum(rows: LegendLockRow[]): number {
  return rows.reduce((sum, row) => sum + (row.enabled && row.count > 0 ? Math.round(row.count) : 0), 0);
}

/**
 * 「全部锁定数量」是否应禁用：没有可操作行，或一键锁满后 Σ粒数会超过
 * 网格格数（数量平衡无法完全达成，对比条已有文案，这里补禁用态）。
 * 投影合计 ≥ 当前已锁定合计，因此"已锁定合计超格"同样被禁用覆盖。
 */
export function lockAllDisabled(rows: LegendLockRow[], gridCells: number): boolean {
  if (rows.length === 0) return true;
  if (gridCells > 0 && lockableCountSum(rows) > gridCells) return true;
  return false;
}

/** 「全部解锁」是否应禁用：没有任何已锁定数量的行。 */
export function unlockAllDisabled(rows: LegendLockRow[]): boolean {
  return !rows.some(row => row.countLocked);
}

/**
 * 解析结果是否可信到足以自动打开色板白名单（2026-11-14 用户实测裁决）。
 *
 * 白名单默认关的初衷是防"解析色号大面积错误时整图被压成 3 种金色"（3/28
 * 的灾难场景），但一刀切默认关让正确场景下功能形同虚设——用户设定了
 * 27 色 + 数量，识别照样吐出 70+ 杂色。裁决口径改为按证据自动启用：
 * - 图纸头部标注色数与解析条数/色板命中数一致 → 最强自洽证据，直接开；
 * - 色板命中率 ≥ 0.7 → 开（命中率低说明解析大面积错误，保持关）。
 */
export function shouldAutoWhitelist(rows: LegendLockRow[], headerColorCount: number | undefined): boolean {
  const usable = rows.filter(row => row.enabled && row.code).length;
  if (rows.length === 0 || usable === 0) return false;
  if (headerColorCount !== undefined && headerColorCount > 0 && usable === headerColorCount) return true;
  return usable / rows.length >= 0.7;
}

/**
 * 色号自绘 listbox（fixed 定位菜单）：原生 <select> 的弹层是系统级渲染，
 * 在侧栏的滚动/变换容器里会脱离锚点"飞"到窗口别处（2026-11-14 用户实测）；
 * 且 .ir-lg-rows 有 overflow-y，普通绝对定位菜单会被裁剪。fixed 定位 +
 * 任意外部滚动即关闭，两个问题一起解决。色板 200+ 色，带过滤输入框。
 */
function CodeListbox({ value, colors, onChange, ariaLabel }: {
  value: string;
  colors: BeadColor[];
  onChange: (code: string) => void;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [anchor, setAnchor] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);

  const openMenu = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const below = window.innerHeight - rect.bottom - 12;
    const openUp = below < 140 && rect.top - 12 > below;
    const maxHeight = openUp ? Math.min(300, rect.top - 12) : Math.min(300, below);
    setAnchor({
      left: Math.min(rect.left, window.innerWidth - 232),
      top: openUp ? rect.top - maxHeight - 4 : rect.bottom + 4,
      width: Math.max(rect.width, 224),
      maxHeight,
    });
    setFilter('');
    setOpen(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !buttonRef.current?.contains(target)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); event.stopPropagation(); }
    };
    // fixed 定位菜单不随文档滚动：外部任何滚动（含行列表自身）直接关闭，
    // 避免脱锚。注意放行菜单内部的选项列表滚动——否则用户滚动选项时菜单
    // 会闪关，且初始化"滚到选中项"也会把自己关掉（2026-11-14 用户实测
    // "点击选不了颜色"的根因）。
    const onScroll = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    filterRef.current?.focus({ preventScroll: true });
    // 把选中项滚进可视区：只调菜单选项列表自己的 scrollTop，绝不能用
    // scrollIntoView——它会滚动外层行列表容器，触发上面的 onScroll 关闭。
    const active = menuRef.current?.querySelector('.is-active') as HTMLElement | null;
    const list = menuRef.current?.querySelector('.ir-lg-code-list') as HTMLElement | null;
    if (active && list) {
      const offset = active.offsetTop - list.clientHeight / 2 + active.offsetHeight / 2;
      list.scrollTop = Math.max(0, offset);
    }
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  const selected = colors.find(color => color.code === value) ?? null;
  const query = filter.trim().toLowerCase();
  const filtered = query
    ? colors.filter(color => color.code.toLowerCase().includes(query) || color.name.toLowerCase().includes(query))
    : colors;

  return (
    <>
      <button
        type="button"
        ref={buttonRef}
        className="ir-lg-code-btn"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={selected ? `${value} · ${selected.name}` : (value || '选择色号')}
        onClick={() => (open ? setOpen(false) : openMenu())}
      >
        <span className="ir-lg-code-code">{value || '选择色号'}</span>
        <ChevronDown size={12} aria-hidden="true" />
        {/* 弹性占位：箭头贴着色号，而不是被推到按钮最右端（贴住数量框） */}
        <span className="ir-lg-code-flex" aria-hidden="true" />
      </button>
      {open && anchor && (
        <div ref={menuRef} className="ir-lg-code-menu" role="listbox" aria-label={ariaLabel}
          style={{ left: anchor.left, top: anchor.top, width: anchor.width, maxHeight: anchor.maxHeight }}>
          <div className="ir-lg-code-search">
            <Search size={12} aria-hidden="true" />
            <input
              ref={filterRef}
              type="text"
              value={filter}
              placeholder="筛选色号/名称"
              aria-label="筛选色号"
              onChange={event => setFilter(event.target.value)}
            />
          </div>
          <div className="ir-lg-code-list">
            {filtered.length === 0 && <p className="ir-lg-code-empty">没有匹配的色号</p>}
            {filtered.map(color => {
              const active = color.code === value;
              return (
                <button
                  key={color.id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={`ir-lg-code-opt${active ? ' is-active' : ''}`}
                  onClick={() => { onChange(color.code); setOpen(false); }}
                >
                  <span className="ir-lg-dot" style={{ background: color.hex }} aria-hidden="true" />
                  <span className="ir-lg-code-opt-code">{color.code}</span>
                  {color.name !== color.code && <small>{color.name}</small>}
                  {active && <Check size={12} aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

export function ImportLegendPanel({ imageElement, dimensions, calibration, palette, value, onChange, busy, legendRegion, onFrameRequest, onClearRegion }: ImportLegendPanelProps) {
  const [lastParse, setLastParse] = useState<LegendParseResult | null>(null);
  const [parseNote, setParseNote] = useState<string | null>(null);
  const [isParsing, setIsParsing] = useState(false);

  const paletteByCode = useMemo(() => {
    const map = new Map<string, BeadColor>();
    for (const color of palette) if (color.enabled !== false) map.set(color.code, color);
    return map;
  }, [palette]);
  const paletteColors = useMemo(() => [...paletteByCode.values()], [paletteByCode]);

  const gridCells = calibration ? calibration.columns * calibration.rows : 0;
  const lockedSum = value.rows.reduce((sum, row) => sum + (row.enabled && row.countLocked && row.count > 0 ? Math.round(row.count) : 0), 0);
  const lockedColors = value.rows.filter(row => row.enabled && row.code && paletteByCode.has(row.code)).length;
  const lockedCounts = value.rows.filter(row => row.enabled && row.countLocked && row.count > 0 && paletteByCode.has(row.code)).length;
  const anyCountLocked = lockedCounts > 0;
  const duplicateCodes = useMemo(() => {
    const seen = new Set<string>();
    const dup = new Set<string>();
    for (const row of value.rows) {
      if (!row.enabled || !row.code) continue;
      if (seen.has(row.code)) dup.add(row.code);
      seen.add(row.code);
    }
    return dup;
  }, [value.rows]);

  const handleAutoParse = useCallback(() => {
    if (!imageElement || !dimensions || !calibration) {
      setParseNote('请先完成校准再解析图例。');
      return;
    }
    setIsParsing(true);
    setParseNote(null);
    try {
      // 复用识别管线的像素提取方式：整幅原图绘制到离屏画布后取像素。
      const canvas = document.createElement('canvas');
      canvas.width = dimensions.width;
      canvas.height = dimensions.height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) {
        setParseNote('无法读取图片像素，请重新选择图片。');
        return;
      }
      context.drawImage(imageElement, 0, 0, dimensions.width, dimensions.height);
      const pixels = context.getImageData(0, 0, dimensions.width, dimensions.height);
      // ⚠️ 解析必须用全色板（2026-11-15 白名单塌缩事故回退）：收窄解析域
      // 会形成正反馈——首漏的码被错配到收窄域内近码 → 去重后行集塌缩 →
      // 再解析进一步收窄 → 整图被压成几个颜色。白名单只管网格识别
      // （importRecognition），解析层靠 shouldAutoWhitelist 的命中率守卫。
      const result = parseLegend(
        { data: pixels.data, ...dimensions },
        calibration,
        palette,
        {
          gridRows: calibration.rows,
          gridCols: calibration.columns,
          // 框选区域优先：只解析框内的内容，不再依赖网格底边/右边缘推断。
          region: legendRegion ?? undefined,
        },
      );
      setLastParse(result);
      if (result.ok) {
        // 裁决口径（2026-11-14 用户实测修订）：解析结果可信（色板命中率高，
        // 或与图纸头部标注色数自洽）时自动启用白名单——否则用户设定了
        // 27 色照样识别出 70+ 杂色，功能形同虚设。命中率高说明色号大面积
        // 正确；命中率低（<0.7）仍保持关，防"整图压成 3 种金色"灾难。
        // 数量锁定依旧一律 false：粒数解析准确率有限，错配额是主动伤害。
        const rows = parseEntriesToRows(result.entries, new Set(paletteByCode.keys()), palette);
        const skipped = parseSkippedCount(result.entries, palette);
        const usable = rows.filter(row => row.enabled).length;
        const autoWhitelist = shouldAutoWhitelist(rows, result.checks.headerColorCount);
        const skippedNote = skipped > 0 ? `，${skipped} 条色号未读出且无法按色点建议已省略` : '';
        setParseNote(autoWhitelist
          ? `解析出 ${result.entries.length} 条（${usable} 条色号在色板内${skippedNote}）。已自动启用色板白名单：识别只从这 ${usable} 色里选色，压掉杂色。色号如有错请先逐行修正或关闭开关；粒数仍是参考值，锁定数量前请核对数字。`
          : `解析出 ${result.entries.length} 条，但色板命中率低（${usable}/${rows.length}）${skippedNote}。白名单保持关闭（色号大面积错误时开白名单会把整图压成少数颜色），请核对色号后再手动打开。`);
        onChange({ rows, whitelist: autoWhitelist });
      } else {
        setParseNote((legendRegion ? FRAME_FAILURE_NOTES : FAILURE_NOTES)[result.failureReason ?? 'noLegendBand'] ?? '图例解析失败，请手动添加行。');
      }
    } catch (error) {
      setParseNote(error instanceof Error ? error.message : '图例解析失败，请手动添加行。');
    } finally {
      setIsParsing(false);
    }
  }, [imageElement, dimensions, calibration, palette, paletteByCode, onChange, legendRegion]);

  const updateRow = useCallback((index: number, patch: Partial<LegendLockRow>) => {
    const rows = value.rows.map((row, i) => (i === index ? { ...row, ...patch } : row));
    onChange({ rows, whitelist: value.whitelist });
  }, [value.rows, value.whitelist, onChange]);

  const changeRowCode = useCallback((index: number, code: string) => {
    // 启用态由色板成员派生：选了有效色号即参与白名单（需总开关打开才生效）。
    const enabled = code.length > 0 && paletteByCode.has(code);
    updateRow(index, { code, enabled });
  }, [updateRow, paletteByCode]);

  const removeRow = useCallback((index: number) => {
    onChange({ rows: value.rows.filter((_, i) => i !== index), whitelist: value.whitelist });
  }, [value.rows, value.whitelist, onChange]);

  const addRow = useCallback(() => {
    // 数量锁定同样是显式勾选语义：手动加行也不默认锁。
    onChange({ rows: [...value.rows, { code: '', count: 1, countLocked: false, enabled: false }], whitelist: value.whitelist });
  }, [value.rows, value.whitelist, onChange]);

  // 一键操作：把逐行勾选降到两次点击。「全部锁定数量」只锁启用且有粒数的行，
  // Σ超格时禁用（见 lockAllDisabled）。
  const lockAllCounts = useCallback(() => {
    onChange({ rows: value.rows.map(row => (row.enabled && row.count > 0 ? { ...row, countLocked: true } : row)), whitelist: value.whitelist });
  }, [value.rows, value.whitelist, onChange]);

  const unlockAllCounts = useCallback(() => {
    onChange({ rows: value.rows.map(row => (row.countLocked ? { ...row, countLocked: false } : row)), whitelist: value.whitelist });
  }, [value.rows, value.whitelist, onChange]);

  const clearRows = useCallback(() => {
    setLastParse(null);
    setParseNote(null);
    onChange({ rows: [], whitelist: false });
  }, [onChange]);

  const toggleWhitelist = useCallback((next: boolean) => {
    onChange({ rows: value.rows, whitelist: next });
  }, [value.rows, onChange]);

  const whitelistOn = value.whitelist === true;
  const sumRatio = gridCells > 0 ? Math.min(1, lockedSum / gridCells) : 0;
  const overGrid = gridCells > 0 && lockedSum > gridCells;

  return (
    <section className="ir-section ir-legend-panel" aria-labelledby="ir-legend-title">
      <div className="ir-section-title">
        <h2 id="ir-legend-title">图例锁定</h2>
        <span className="ir-badge ir-lg-badge" data-tone={value.rows.length ? 'ok' : undefined}>
          {value.rows.length ? `${lockedColors} 色白名单${whitelistOn ? ' · 开' : ' · 关'}` : '未启用'}
        </span>
      </div>
      <p className="ir-help">图纸印有「色点 + 色号 + NNN粒」图例时，解析每色目标粒数供识别参考：解析结果可信（色号与色板匹配度高）会自动启用「色板白名单」压掉杂色，粒数仍需核对后再锁定数量。图例不在常规位置（底部横条/右缘竖列/角上面板块）时，先在左侧画布「框选图例区域」再识别。</p>
      {legendRegion && (
        <p className="ir-help ir-lg-region" role="status">
          <SquareDashed size={13} />已框选图例区域 {Math.abs(legendRegion.x1 - legendRegion.x0)} × {Math.abs(legendRegion.y1 - legendRegion.y0)} px，识别只解析框内内容。
          <button type="button" className="ir-text-button" onClick={onClearRegion}>清除框选</button>
        </p>
      )}
      <div className="ir-legend-actions">
        <button
          type="button"
          className="ir-button ir-primary"
          onClick={handleAutoParse}
          disabled={busy || isParsing || !imageElement || !dimensions || !calibration}
          aria-describedby="ir-legend-help"
        >
          <ScanSearch size={15} />{isParsing ? '解析中…' : '从图例自动识别'}
        </button>
        <button
          type="button"
          className="ir-button"
          onClick={onFrameRequest}
          aria-pressed={legendRegion !== null}
          title="在左侧画布上拖动，框住整条图例（支持底部横条、右缘竖列、角上面板块）"
        ><SquareDashed size={15} />框选图例区域</button>
        <button type="button" className="ir-button" onClick={addRow} aria-label="手动添加图例行"><Plus size={15} />手动加行</button>
        <button
          type="button"
          className="ir-button ir-quiet"
          onClick={clearRows}
          disabled={!value.rows.length}
          aria-label="清空图例行"
        >清空</button>
      </div>
      {parseNote && <p className="ir-help ir-lg-note" role="status">{parseNote}</p>}
      {value.rows.length > 0 && (
        <>
          <label className={`ir-lg-whitelist${whitelistOn ? ' is-on' : ''}`}>
            <input
              type="checkbox"
              checked={whitelistOn}
              onChange={event => toggleWhitelist(event.target.checked)}
            />
            <span>
              <strong>识别时启用色板白名单（{lockedColors} 色）</strong>
              <small>只从上面这些色号里选色。解析结果与色板匹配度高时会自动打开；色号有错时整张图会被压成少数几种颜色，请先逐行核对修正。</small>
            </span>
          </label>
          <div className="ir-lg-toolbar">
            <span className="ir-lg-toolbar-info">
              色板 <strong>{lockedColors}</strong> · 数量 <strong>{lockedCounts}</strong>
            </span>
            <div className="ir-lg-toolbar-actions">
              <button
                type="button"
                className="ir-lg-mini"
                onClick={lockAllCounts}
                disabled={lockAllDisabled(value.rows, gridCells)}
                title={gridCells > 0 && lockableCountSum(value.rows) > gridCells ? '锁定粒数合计超过网格格数，请先核对各行数值' : '把所有启用行勾选为数量锁定'}
              ><Lock size={12} />全部锁定数量</button>
              <button
                type="button"
                className="ir-lg-mini"
                onClick={unlockAllCounts}
                disabled={unlockAllDisabled(value.rows)}
                title="取消所有行的数量锁定"
              ><LockOpen size={12} />全部解锁</button>
            </div>
          </div>
          <div className="ir-legend-rows ir-lg-rows" role="group" aria-label="图例锁定行">
            {value.rows.map((row, index) => {
              const color = paletteByCode.get(row.code);
              const notInPalette = row.code.length > 0 && !paletteByCode.has(row.code);
              const lowConfidence = row.confidence !== undefined && row.confidence < LEGEND_LOW_CONFIDENCE;
              const warnText = describeWarn(row.warn)
                || (notInPalette ? '色号不在当前色板，不参与锁定' : '')
                || (duplicateCodes.has(row.code) ? '色号与其他行重复' : '');
              return (
                <div
                  key={`${row.code || 'empty'}-${index}`}
                  className={`ir-lg-row${lowConfidence || warnText ? ' has-warn' : ''}${notInPalette ? ' is-invalid' : ''}${row.countLocked ? ' is-locked' : ''}`}
                >
                  <span className="ir-lg-dot" style={{ background: color?.hex ?? 'var(--ir-line)' }} aria-hidden="true" />
                  <CodeListbox
                    value={row.code}
                    colors={paletteColors}
                    onChange={nextCode => changeRowCode(index, nextCode)}
                    ariaLabel={`第 ${index + 1} 行色号`}
                  />
                  <span className="ir-lg-count-wrap">
                    <input
                      className="ir-lg-count"
                      type="number"
                      min={1}
                      max={999}
                      aria-label={`第 ${index + 1} 行目标粒数`}
                      value={row.count}
                      onChange={event => {
                        const next = Math.max(0, Math.min(999, Math.round(event.currentTarget.valueAsNumber) || 0));
                        updateRow(index, { count: next });
                      }}
                    />
                    <span aria-hidden="true">粒</span>
                  </span>
                  {row.confidence !== undefined && (
                    <span className={`ir-lg-conf${lowConfidence ? ' is-low' : ''}`} aria-label={`第 ${index + 1} 行解析置信度 ${Math.round(row.confidence * 100)}%`}>
                      {Math.round(row.confidence * 100)}%
                    </span>
                  )}
                  {warnText && (
                    <span className="ir-lg-warn" role="img" aria-label={`第 ${index + 1} 行：${warnText}`} title={warnText}>
                      <AlertTriangle size={13} />
                    </span>
                  )}
                  {/* 锁定/删除合并为连体按钮组：两个孤立 42×42 大按钮是整行松散的主因 */}
                  <div className="ir-lg-btns">
                    <button
                      type="button"
                      className={`ir-lg-lock${row.countLocked ? ' is-on' : ''}`}
                      aria-pressed={row.countLocked}
                      aria-label={`第 ${index + 1} 行${row.countLocked ? '取消' : ''}数量锁定（恰好 ${row.count} 粒）`}
                      title={row.countLocked ? `已锁：识别后配平到恰好 ${row.count} 粒` : '锁定后识别结果配平到恰好 N 粒'}
                      onClick={() => updateRow(index, { countLocked: !row.countLocked })}
                    >{row.countLocked ? <Lock size={15} /> : <LockOpen size={15} />}</button>
                    <button type="button" className="ir-icon-button ir-lg-del" aria-label={`删除第 ${index + 1} 行`} onClick={() => removeRow(index)}><Trash2 size={15} /></button>
                  </div>
                </div>
              );
            })}
          </div>
          {gridCells > 0 && (
            <div className="ir-lg-sum" aria-live="polite">
              <div className="ir-lg-sum-head">
                <span>Σ锁定粒数 / 网格格数</span>
                <strong className={overGrid ? 'ir-legend-sum-over' : ''}>{lockedSum} / {gridCells}</strong>
              </div>
              <div className="ir-lg-sum-bar" role="img" aria-label={`锁定粒数占网格格数 ${(sumRatio * 100).toFixed(1)}%`}>
                <span style={{ width: `${(sumRatio * 100).toFixed(1)}%` }} />
              </div>
              {overGrid && <p className="ir-help" data-tone="error">锁定粒数超过网格格数，数量平衡无法完全达成，请核对各行数值。</p>}
            </div>
          )}
          <p className="ir-help ir-legend-hint" role="note">粒数自动识别准确率有限，锁定前请核对数字；白名单关闭时数量锁定不生效。若图纸有纸底空格，建议同时勾选「图纸色号辅助」。</p>
        </>
      )}
      {lastParse && lastParse.ok && lastParse.checks.headerColorCount !== undefined && lastParse.entries.length !== lastParse.checks.headerColorCount && (
        <p className="ir-help" data-tone="error">图例解析出 {lastParse.entries.length} 条，与图纸头部标注的 {lastParse.checks.headerColorCount} 色不一致，请核对（缺失或多余的行可手动增删）。</p>
      )}
    </section>
  );
}
