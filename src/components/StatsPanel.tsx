import React, { useState, useMemo } from 'react';
import {
  BarChart3,
  Search,
  Copy,
  Check,
  Eye,
  RefreshCw,
  Hash,
} from 'lucide-react';
import { BeadColor, ColorStat } from '../types';

interface StatsPanelProps {
  grid: (string | null)[][];
  paletteMap: Map<string, BeadColor>;
  width: number;
  height: number;
  boardSize: number;
  highlightColorId: string | null;
  onSetHighlightColorId: (id: string | null) => void;
  onOpenReplaceModal: (sourceColor: BeadColor) => void;
  onSelectColor: (color: BeadColor) => void;
}

export const StatsPanel: React.FC<StatsPanelProps> = ({
  grid,
  paletteMap,
  width,
  height,
  boardSize,
  highlightColorId,
  onSetHighlightColorId,
  onOpenReplaceModal,
  onSelectColor,
}) => {
  const [search, setSearch] = useState('');
  const [copied, setCopied] = useState(false);

  // Compute stats
  const { stats, totalBeads } = useMemo(() => {
    const counts = new Map<string, number>();
    let total = 0;

    for (const row of grid) {
      for (const cellId of row) {
        if (cellId) {
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
        });
      }
    });

    statList.sort((a, b) => b.count - a.count);

    return { stats: statList, totalBeads: total };
  }, [grid, paletteMap]);

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

  // Total Boards needed
  const boardsX = Math.ceil(width / boardSize);
  const boardsY = Math.ceil(height / boardSize);
  const totalBoards = boardsX * boardsY;

  // Copy shopping list
  const handleCopyList = () => {
    const lines = stats.map(s => `${s.color.code} ${s.color.name}: ${s.count} 粒 (${s.color.hex})`);
    const text = `拼豆用量统计 (${width}x${height} 豆, 共 ${totalBeads} 粒):\n` + lines.join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="w-80 bg-slate-900 border-l border-slate-800 text-slate-200 p-4 flex flex-col h-full overflow-hidden text-xs select-none shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm">
          <BarChart3 className="w-4 h-4" />
          <span>豆数用量统计与色卡清单</span>
        </div>

        <button
          onClick={handleCopyList}
          className="bg-slate-800 hover:bg-slate-700 text-slate-300 p-1.5 rounded-lg border border-slate-700 flex items-center gap-1 cursor-pointer transition-colors"
          title="复制用量清单"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          <span>{copied ? '已复制' : '复制用量'}</span>
        </button>
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-3 gap-2 my-3">
        <div className="bg-slate-800/80 p-2.5 rounded-xl border border-slate-700/80 text-center">
          <div className="text-[10px] text-slate-400">总用豆数</div>
          <div className="text-sm font-bold text-emerald-400 font-mono mt-0.5">{totalBeads}</div>
        </div>
        <div className="bg-slate-800/80 p-2.5 rounded-xl border border-slate-700/80 text-center">
          <div className="text-[10px] text-slate-400">使用色数</div>
          <div className="text-sm font-bold text-rose-400 font-mono mt-0.5">{stats.length}</div>
        </div>
        <div className="bg-slate-800/80 p-2.5 rounded-xl border border-slate-700/80 text-center">
          <div className="text-[10px] text-slate-400">需拼豆板</div>
          <div className="text-sm font-bold text-sky-400 font-mono mt-0.5">{totalBoards} 板</div>
        </div>
      </div>

      {/* Search Input */}
      <div className="relative mb-3">
        <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="搜索色号(如 M01 / 纯白)..."
          className="w-full bg-slate-800/80 border border-slate-700/80 rounded-lg pl-8 pr-3 py-1.5 text-slate-200 text-xs outline-none focus:border-emerald-500"
        />
      </div>

      {/* Highlight Active Indicator */}
      {highlightColorId && (
        <div className="bg-rose-950/80 border border-rose-600/80 text-rose-200 p-2 rounded-lg mb-2 flex items-center justify-between">
          <span className="text-[11px] font-medium">当前正点亮网格中的特定颜色</span>
          <button
            onClick={() => onSetHighlightColorId(null)}
            className="text-xs text-rose-300 underline font-bold cursor-pointer"
          >
            取消点亮
          </button>
        </div>
      )}

      {/* Color Table List */}
      <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
        {filteredStats.map(s => {
          const isHighlighted = highlightColorId === s.color.id;

          return (
            <div
              key={s.color.id}
              className={`p-2 rounded-xl border transition-all flex items-center gap-2.5 ${
                isHighlighted
                  ? 'bg-rose-950/70 border-rose-500 text-white shadow-md'
                  : 'bg-slate-800/60 border-slate-700/60 text-slate-300 hover:bg-slate-800'
              }`}
            >
              {/* Color Swatch & Symbol */}
              <button
                onClick={() => onSelectColor(s.color)}
                className="w-7 h-7 rounded-lg border border-black/30 shadow-inner flex items-center justify-center font-bold text-xs shrink-0 cursor-pointer"
                style={{ backgroundColor: s.color.hex }}
                title="设为画笔涂色"
              >
                <span className={isLightColor(s.color.hex) ? 'text-black' : 'text-white'}>
                  {s.color.symbol}
                </span>
              </button>

              {/* Code & Name */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-mono font-bold text-slate-100 text-xs">{s.color.code}</span>
                  <span className="text-[10px] text-slate-400 truncate">{s.color.name}</span>
                </div>

                {/* Progress bar */}
                <div className="w-full bg-slate-700 h-1.5 rounded-full mt-1 overflow-hidden">
                  <div
                    className="bg-emerald-500 h-full rounded-full"
                    style={{ width: `${Math.min(100, Math.max(5, s.percentage))}%` }}
                  />
                </div>
              </div>

              {/* Count & Percentage */}
              <div className="text-right shrink-0">
                <div className="font-mono font-bold text-emerald-400 text-xs">{s.count} 粒</div>
                <div className="text-[10px] text-slate-500">{s.percentage.toFixed(1)}%</div>
              </div>

              {/* Actions: Highlight & Replace */}
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => onSetHighlightColorId(isHighlighted ? null : s.color.id)}
                  className={`p-1.5 rounded-md cursor-pointer transition-colors ${
                    isHighlighted
                      ? 'bg-rose-600 text-white'
                      : 'text-slate-400 hover:text-white hover:bg-slate-700'
                  }`}
                  title="点亮/独占定位网格中的此颜色"
                >
                  <Eye className="w-3.5 h-3.5" />
                </button>

                <button
                  onClick={() => onOpenReplaceModal(s.color)}
                  className="p-1.5 rounded-md text-slate-400 hover:text-amber-300 hover:bg-slate-700 cursor-pointer transition-colors"
                  title="全板替换此颜色"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          );
        })}

        {filteredStats.length === 0 && (
          <div className="text-center py-8 text-slate-500">未找到匹配的颜色号</div>
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
