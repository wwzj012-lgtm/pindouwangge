import React, { createContext, useContext, useMemo, useState } from 'react';
import {
  BarChart3,
  Search,
  Copy,
  Check,
  Eye,
  RefreshCw,
  Hash,
  X,
  Trash2,
  RotateCcw,
  Sparkles,
} from 'lucide-react';
import { BeadColor, ColorStat } from '../types';
import { useLanguage } from '../context/LanguageContext';

export type StrayBeadConsolidationStrength = 'light' | 'standard' | 'strong';

export const PatternDetailsUnlockContext = createContext(false);

interface StatsPanelProps {
  grid: (string | null)[][];
  paletteMap: Map<string, BeadColor>;
  width: number;
  height: number;
  boardSize: number;
  highlightColorId?: string | null;
  highlightColorIds?: string[];
  onSetHighlightColorId?: (id: string | null) => void;
  onSetHighlightColorIds?: (ids: string[]) => void;
  onToggleHighlightColorId?: (id: string) => void;
  completedColorIds?: string[];
  onToggleCompletedColorId?: (id: string) => void;
  onOpenReplaceModal: (sourceColor: BeadColor) => void;
  onSelectColor: (color: BeadColor) => void;
  onEraseColor?: (colorId: string) => void;
  onRestoreColor?: (colorId: string) => void;
  erasedColorCoords?: Map<string, [number, number][]>;
  onCloseMobile?: () => void;
  onConsolidateStrayBeads?: (strength: StrayBeadConsolidationStrength) => void;
  detailsUnlocked?: boolean;
}

export const StatsPanel: React.FC<StatsPanelProps> = ({
  grid,
  paletteMap,
  width,
  height,
  boardSize,
  highlightColorId,
  highlightColorIds,
  onSetHighlightColorId,
  onSetHighlightColorIds,
  onToggleHighlightColorId,
  completedColorIds = [],
  onToggleCompletedColorId,
  onOpenReplaceModal,
  onSelectColor,
  onEraseColor,
  onRestoreColor,
  erasedColorCoords,
  onCloseMobile,
  onConsolidateStrayBeads,
  detailsUnlocked,
}) => {
  const { language, t } = useLanguage();
  const isEn = language === 'en';
  const contextDetailsUnlocked = useContext(PatternDetailsUnlockContext);
  const hasDetails = detailsUnlocked ?? contextDetailsUnlocked;
  const [search, setSearch] = useState('');
  const [copied, setCopied] = useState(false);
  const [strayBeadStrength, setStrayBeadStrength] = useState<StrayBeadConsolidationStrength>('standard');
  const activeHighlightIds = highlightColorIds ?? (highlightColorId ? [highlightColorId] : []);

  // Compute active & erased stats
  const { stats, erasedStats, totalBeads, colorTypes } = useMemo(() => {
    const counts = new Map<string, number>();
    let total = 0;

    for (const row of grid) {
      for (const cellId of row) {
        if (cellId !== null) {
          counts.set(cellId, (counts.get(cellId) || 0) + 1);
          total++;
        }
      }
    }

    const statList: ColorStat[] = [];
    counts.forEach((count, colorId) => {
      const color = paletteMap.get(colorId);
      if (color) {
        statList.push({
          color,
          count,
          percentage: total > 0 ? (count / total) * 100 : 0,
          bagsCount: Math.ceil(count / 1000),
        });
      }
    });

    statList.sort((a, b) => b.count - a.count);

    const erasedList: ColorStat[] = [];
    if (erasedColorCoords) {
      erasedColorCoords.forEach((coords, colorId) => {
        if ((counts.get(colorId) || 0) === 0) {
          const color = paletteMap.get(colorId);
          if (color) {
            erasedList.push({
              color,
              count: coords.length,
              percentage: 0,
              bagsCount: 0,
            });
          }
        }
      });
    }

    return { stats: statList, erasedStats: erasedList, totalBeads: total, colorTypes: counts.size };
  }, [grid, paletteMap, erasedColorCoords]);

  // Filter stats
  const filteredStats = useMemo(() => {
    if (!search.trim()) return stats;
    const term = search.toLowerCase();
    return stats.filter(
      s =>
        s.color.code.toLowerCase().includes(term) ||
        s.color.name.toLowerCase().includes(term)
    );
  }, [stats, search]);

  const filteredErasedStats = useMemo(() => {
    if (!erasedStats || erasedStats.length === 0) return [];
    if (!search.trim()) return erasedStats;
    const term = search.toLowerCase();
    return erasedStats.filter(
      s =>
        s.color.code.toLowerCase().includes(term) ||
        s.color.name.toLowerCase().includes(term)
    );
  }, [erasedStats, search]);

  // Total Boards needed
  const boardsX = Math.ceil(width / boardSize);
  const boardsY = Math.ceil(height / boardSize);
  const totalBoards = boardsX * boardsY;
  const completedStats = useMemo(
    () => stats.filter(stat => completedColorIds.includes(stat.color.id)),
    [completedColorIds, stats],
  );
  const completedBeads = completedStats.reduce((sum, stat) => sum + stat.count, 0);

  const toggleHighlight = (colorId: string) => {
    if (onToggleHighlightColorId) {
      onToggleHighlightColorId(colorId);
      return;
    }
    const nextIds = activeHighlightIds.includes(colorId)
      ? activeHighlightIds.filter(id => id !== colorId)
      : [...activeHighlightIds, colorId];
    if (onSetHighlightColorIds) {
      onSetHighlightColorIds(nextIds);
    } else {
      onSetHighlightColorId?.(nextIds.length === 1 ? nextIds[0] : null);
    }
  };

  const clearHighlight = () => {
    if (onSetHighlightColorIds) onSetHighlightColorIds([]);
    else onSetHighlightColorId?.(null);
  };

  // Copy shopping list
  const handleCopyList = () => {
    const lines = stats.map(s => `${s.color.code} ${s.color.name}: ${s.count} ${isEn ? 'pcs' : '粒'} (${s.color.hex})`);
    const text = isEn
      ? `Bead Usage Stats (${width}x${height} grid, ${totalBeads} beads total):\n` + lines.join('\n')
      : `拼豆用量统计 (${width}x${height} 豆, 共 ${totalBeads} 粒):\n` + lines.join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="w-80 max-w-[85vw] bg-white/90 backdrop-blur-md border-l border-purple-200/90 text-purple-950 p-4 flex flex-col h-full overflow-hidden text-xs select-none shrink-0 shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-purple-200/80 pb-3">
        <div className="flex items-center gap-2 text-purple-900 font-extrabold text-sm">
          <BarChart3 className="w-4 h-4 text-purple-600" />
          <span>{hasDetails ? (isEn ? 'Bead Usage Stats & Palette' : '豆数用量统计与色卡清单') : (isEn ? 'Palette Preview' : '色卡预览')}</span>
        </div>

        <div className="flex items-center gap-1.5">
          {hasDetails && (
            <button
              type="button"
              onClick={handleCopyList}
              className="bg-purple-50 hover:bg-purple-100 text-purple-900 px-2 py-1 rounded-xl border border-purple-200 flex items-center gap-1 cursor-pointer transition-colors font-bold text-[11px]"
              title={isEn ? 'Copy list' : '复制用量清单'}
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5 text-purple-600" />}
              <span>{copied ? (isEn ? 'Copied' : '已复制') : (isEn ? 'Copy List' : '复制用量')}</span>
            </button>
          )}
          {onCloseMobile && (
            <button
              type="button"
              onClick={onCloseMobile}
              className="lg:hidden p-1 text-purple-500 hover:text-purple-900 rounded-lg hover:bg-purple-100 cursor-pointer"
              aria-label={isEn ? 'Close stats panel' : '关闭统计面板'}
              title={isEn ? 'Close' : '关闭'}
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      <div className="my-3 grid grid-cols-2 gap-2">
      <div className="rounded-2xl border border-purple-200/80 bg-purple-50/80 p-2.5 text-center" aria-label={isEn ? 'Total Beads' : '总用豆数'}>
        <div className="text-[10px] font-medium text-purple-600">{isEn ? 'Total Beads' : '总用豆数'}</div>
        <div className="mt-0.5 font-mono text-sm font-black text-purple-900">{totalBeads}</div>
      </div>
      <div className="rounded-2xl border border-purple-200/80 bg-purple-50/80 p-2.5 text-center" aria-label={isEn ? 'Colors Used' : '颜色种类数量'}>
        <div className="text-[10px] font-medium text-purple-600">{isEn ? 'Colors Used' : '颜色种类'}</div>
        <div className="mt-0.5 font-mono text-sm font-black text-purple-900">{colorTypes}</div>
      </div>
      </div>

      {hasDetails ? (
        <>
          <div className="my-3">
            <div className="bg-purple-50/80 p-2.5 rounded-2xl border border-purple-200/80 text-center">
              <div className="text-[10px] text-purple-600 font-medium">{isEn ? 'Boards Needed' : '需拼豆板'}</div>
              <div className="text-sm font-black text-indigo-700 font-mono mt-0.5">{totalBoards} {isEn ? 'boards' : '板'}</div>
            </div>
          </div>

          <div className="mb-3 rounded-2xl border border-emerald-200/90 bg-emerald-50/70 px-3 py-2 text-emerald-950">
            <div className="flex items-center justify-between gap-2 text-[11px] font-extrabold">
              <span>{isEn ? 'Making progress' : '制作进度'}</span>
              <span className="font-mono">{completedStats.length}/{stats.length} {isEn ? 'colors' : '色'}</span>
            </div>
            <div className="mt-1 flex items-center justify-between gap-2 text-[10px] font-medium text-emerald-700">
              <span>{isEn ? 'Completed beads' : '已完成拼豆'}</span>
              <span className="font-mono">{completedBeads}/{totalBeads}</span>
            </div>
          </div>
        </>
      ) : (
        <p className="my-3 rounded-2xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-[11px] leading-5 text-indigo-950" role="status">
          {isEn
            ? 'Complete this pattern to unlock brand color codes, quantities, and the copyable material list.'
            : '完成图纸后即可解锁品牌色号、每色数量和可复制的材料清单。'}
        </p>
      )}

      <section className="mb-3 rounded-xl border border-purple-200/90 bg-purple-50/70 p-2.5" aria-label={isEn ? 'Stray bead consolidation' : '整合散豆'}>
        <div className="flex items-center gap-1.5 text-[11px] font-extrabold text-purple-900">
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-purple-600" aria-hidden="true" />
          <span>{isEn ? 'Consolidate stray beads' : '整合散豆'}</span>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-1" role="group" aria-label={isEn ? 'Consolidation strength' : '整合强度'}>
          {([
            ['light', isEn ? 'Light' : '轻度'],
            ['standard', isEn ? 'Standard' : '标准'],
            ['strong', isEn ? 'Strong' : '强力'],
          ] as const).map(([strength, label]) => (
            <button
              key={strength}
              type="button"
              onClick={() => setStrayBeadStrength(strength)}
              aria-pressed={strayBeadStrength === strength}
              className={`min-w-0 rounded-lg border px-1.5 py-1 text-[10px] cursor-pointer transition-colors ${
                strayBeadStrength === strength
                  ? 'bg-purple-600 border-purple-600 text-white font-bold hover:bg-purple-700'
                  : 'bg-white border-purple-200 text-purple-700 hover:bg-purple-100'
              }`}
            >
              <span className="block truncate">{label}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => onConsolidateStrayBeads?.(strayBeadStrength)}
          disabled={!onConsolidateStrayBeads || totalBeads === 0}
          className="mt-2 w-full rounded-xl bg-purple-600 px-2 py-1.5 text-[11px] font-bold text-white cursor-pointer transition-colors hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-50 flex items-center justify-center gap-1.5"
          title={isEn ? 'Clean isolated noise in the current grid' : '清理当前网格中的孤立杂点'}
        >
          <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{isEn ? 'Apply to current grid' : '应用到当前网格'}</span>
        </button>
      </section>

      {/* Search Input */}
      <div className="relative mb-3">
        <Search className="w-3.5 h-3.5 text-purple-400 absolute left-3 top-2.5" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={hasDetails ? (isEn ? 'Search color code / name...' : '搜索色号(如 M01 / 纯白)...') : (isEn ? 'Filter palette colors...' : '筛选色卡颜色...')}
          className="w-full bg-purple-50/80 border border-purple-200/90 rounded-xl pl-8 pr-3 py-1.5 text-purple-950 text-xs outline-none focus:ring-2 focus:ring-purple-400/30 placeholder-purple-400 font-medium"
        />
      </div>

      {/* Highlight Active Indicator */}
      {activeHighlightIds.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 p-2.5 rounded-2xl mb-2 flex items-center justify-between">
          <span className="text-[11px] font-bold">{hasDetails ? (isEn ? `Highlighting ${activeHighlightIds.length} color${activeHighlightIds.length === 1 ? '' : 's'} on canvas` : `当前正点亮网格中的 ${activeHighlightIds.length} 个色号`) : (isEn ? 'Palette colors are highlighted on canvas' : '当前色卡颜色已在网格中点亮')}</span>
          <button
            type="button"
            onClick={clearHighlight}
            className="text-xs text-amber-700 underline font-extrabold cursor-pointer hover:text-amber-900"
          >
            {isEn ? 'Unhighlight' : '取消点亮'}
          </button>
        </div>
      )}

      {/* Color Table List */}
      <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
        {filteredStats.map((s, index) => {
          const isHighlighted = activeHighlightIds.includes(s.color.id);
          const isCompleted = completedColorIds.includes(s.color.id);
          const colorLabel = hasDetails ? s.color.code : (isEn ? `Color ${index + 1}` : `颜色 ${index + 1}`);

          return (
            <div
              key={s.color.id}
              role="button"
              tabIndex={0}
              onClick={() => toggleHighlight(s.color.id)}
              onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  toggleHighlight(s.color.id);
                }
              }}
              className={`p-2 rounded-2xl border transition-all flex items-center gap-2.5 ${
                isHighlighted
                  ? 'bg-purple-600 border-purple-600 text-white shadow-md'
                  : isCompleted
                    ? 'bg-slate-50/80 border-emerald-200/80 text-slate-700 opacity-75'
                  : 'bg-purple-50/60 border-purple-200/70 text-purple-950 hover:bg-purple-100/80'
              } cursor-pointer`}
            >
              {/* Color Swatch & Symbol */}
              <button
                type="button"
                onClick={event => { event.stopPropagation(); onSelectColor(s.color); }}
                className="w-7 h-7 rounded-lg border border-black/20 shadow-inner flex items-center justify-center font-extrabold text-xs shrink-0 cursor-pointer"
                style={{ backgroundColor: s.color.hex }}
                aria-label={isEn ? `Set ${colorLabel} as active paint color` : `将${colorLabel}设为当前画笔颜色`}
                title={isEn ? 'Set as active paint color' : '设为画笔涂色'}
              >
                {hasDetails && <span className={isLightColor(s.color.hex) ? 'text-black' : 'text-white'}>{s.color.symbol}</span>}
              </button>

              {/* Code & Name */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className={`font-mono font-black text-xs ${isHighlighted ? 'text-white' : isCompleted ? 'text-slate-700 line-through decoration-slate-400' : 'text-purple-950'}`}>{colorLabel}</span>
                  {hasDetails && <span className={`text-[10px] truncate ${isHighlighted ? 'text-purple-100' : 'text-purple-600'}`}>{s.color.name}</span>}
                  {isCompleted && <span className={`rounded-full px-1 py-0.5 text-[9px] font-black ${isHighlighted ? 'bg-white/20 text-white' : 'bg-emerald-100 text-emerald-700'}`}>{isEn ? 'Done' : '已完成'}</span>}
                </div>

                {hasDetails && (
                  <div className="w-full bg-purple-200/80 h-1.5 rounded-full mt-1 overflow-hidden">
                    <div
                      className={`${isCompleted ? 'bg-slate-400' : 'bg-purple-600'} h-full rounded-full`}
                      style={{ width: `${Math.min(100, Math.max(5, s.percentage))}%` }}
                    />
                  </div>
                )}
              </div>

              {hasDetails && (
                <div className="text-right shrink-0">
                  <div className={`font-mono font-bold text-xs ${isHighlighted ? 'text-white' : 'text-purple-950'}`}>{s.count} {isEn ? 'pcs' : '粒'}</div>
                  <div className={`text-[10px] ${isHighlighted ? 'text-purple-200' : 'text-purple-500'}`}>{s.percentage.toFixed(1)}%</div>
                </div>
              )}

              {/* Actions: Highlight & Replace */}
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={event => { event.stopPropagation(); toggleHighlight(s.color.id); }}
                  className={`p-1.5 rounded-lg cursor-pointer transition-colors ${
                    isHighlighted
                      ? 'bg-white text-purple-900'
                      : 'text-purple-500 hover:text-purple-950 hover:bg-purple-200/80'
                  }`}
                  aria-label={isEn ? `${isHighlighted ? 'Remove highlight from' : 'Highlight'} ${colorLabel}` : `${isHighlighted ? '取消点亮' : '点亮'}${colorLabel}`}
                  title={isEn ? 'Highlight this color' : '点亮/独占定位网格中的此颜色'}
                >
                  <Eye className="w-3.5 h-3.5" />
                </button>

                {onToggleCompletedColorId && (
                  <button
                    type="button"
                    onClick={event => { event.stopPropagation(); onToggleCompletedColorId(s.color.id); }}
                    aria-pressed={isCompleted}
                    className={`p-1.5 rounded-lg cursor-pointer transition-colors ${
                      isCompleted
                        ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                        : isHighlighted
                          ? 'text-purple-100 hover:text-white hover:bg-white/15'
                          : 'text-purple-500 hover:text-emerald-700 hover:bg-emerald-100'
                    }`}
                    aria-label={isEn ? `${isCompleted ? 'Mark' : 'Mark'} ${colorLabel} as ${isCompleted ? 'in progress' : 'completed'}` : `${isCompleted ? '标记' : '标记'}${colorLabel}${isCompleted ? '为制作中' : '为已完成'}`}
                    title={isEn ? (isCompleted ? 'Mark this color as in progress' : 'Mark this color as completed') : (isCompleted ? '取消完成标记' : '标记此色号已完成')}
                  >
                    <Check className="w-3.5 h-3.5" />
                  </button>
                )}

                <button
                  type="button"
                  onClick={event => { event.stopPropagation(); onOpenReplaceModal(s.color); }}
                  className={`p-1.5 rounded-lg cursor-pointer transition-colors ${
                    isHighlighted ? 'text-purple-100 hover:text-white' : 'text-purple-500 hover:text-purple-950 hover:bg-purple-200/80'
                  }`}
                  aria-label={isEn ? `Replace ${colorLabel} globally` : `全板替换${colorLabel}`}
                  title={isEn ? 'Replace this color globally' : '全板替换此颜色'}
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>

                {onEraseColor && (
                  <button
                    type="button"
                    onClick={event => { event.stopPropagation(); onEraseColor(s.color.id); }}
                    className={`p-1.5 rounded-lg cursor-pointer transition-colors ${
                      isHighlighted ? 'text-purple-200 hover:text-rose-200' : 'text-purple-400 hover:text-rose-600 hover:bg-rose-50'
                    }`}
                    aria-label={isEn ? `Erase ${colorLabel} from grid` : `从网格擦除${colorLabel}`}
                    title={isEn ? 'Erase this color from grid' : '擦除全板此颜色 (变为空白/无豆)'}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {filteredStats.length === 0 && filteredErasedStats.length === 0 && (
          <div className="text-center py-8 text-purple-400 font-medium">{isEn ? 'No matching color code found' : '未找到匹配的颜色号'}</div>
        )}

        {/* Erased Colors Section (Displayed at the bottom with dimmed visual style) */}
        {filteredErasedStats.length > 0 && (
          <div className="mt-4 pt-3 border-t border-purple-200/80 space-y-1.5">
            <div className="flex items-center justify-between text-[11px] font-semibold text-purple-600 px-1 mb-1">
              <span className="flex items-center gap-1.5">
                <RotateCcw className="w-3.5 h-3.5 text-purple-500" />
                {hasDetails ? (isEn ? `Erased Colors (${filteredErasedStats.length})` : `已擦除色卡 (${filteredErasedStats.length})`) : (isEn ? 'Erased palette colors' : '已擦除色卡')}
              </span>
              <span className="text-[10px] text-purple-400 font-normal">{isEn ? 'Click restore' : '点击右侧恢复入板'}</span>
            </div>

            {filteredErasedStats.map((s, index) => (
              <div
                key={s.color.id}
                className="p-2 rounded-2xl border border-dashed border-purple-200 bg-purple-50/40 text-purple-600 opacity-70 hover:opacity-100 transition-all flex items-center gap-2.5 group"
              >
                {/* Color Swatch */}
                <button
                  type="button"
                  onClick={() => onSelectColor(s.color)}
                  className="w-7 h-7 rounded-lg border border-black/20 shadow-inner flex items-center justify-center font-bold text-xs shrink-0 cursor-pointer opacity-80 group-hover:opacity-100 transition-all"
                  style={{ backgroundColor: s.color.hex }}
                  aria-label={isEn ? `Set ${hasDetails ? s.color.code : `Color ${index + 1}`} as active paint color` : `将${hasDetails ? s.color.code : `颜色 ${index + 1}`}设为当前画笔颜色`}
                  title={isEn ? 'Set as active paint color' : '设为画笔涂色'}
                >
                  {hasDetails && <span className={isLightColor(s.color.hex) ? 'text-black' : 'text-white'}>{s.color.symbol}</span>}
                </button>

                {/* Code & Name */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 line-through decoration-purple-400">
                    <span className="font-mono font-bold text-purple-800 text-xs">{hasDetails ? s.color.code : (isEn ? `Color ${index + 1}` : `颜色 ${index + 1}`)}</span>
                    {hasDetails && <span className="text-[10px] text-purple-500 truncate">{s.color.name}</span>}
                  </div>
                  <div className="text-[10px] text-purple-400 mt-0.5">{isEn ? 'Erased' : '已擦除'}</div>
                </div>

                {/* Restore Action */}
                {onRestoreColor && (
                  <button
                    type="button"
                    onClick={() => onRestoreColor(s.color.id)}
                    className="px-2.5 py-1 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-[11px] font-bold flex items-center gap-1 cursor-pointer transition-all shrink-0 shadow-xs"
                    title={isEn ? 'Restore this color back to grid' : '点击恢复此颜色到网格原本位置'}
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>{isEn ? 'Restore' : '恢复'}</span>
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

function isLightColor(hex: string): boolean {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16) || 255;
  const g = parseInt(clean.substring(2, 4), 16) || 255;
  const b = parseInt(clean.substring(4, 6), 16) || 255;
  return (r * 299 + g * 587 + b * 114) / 1000 > 140;
}
