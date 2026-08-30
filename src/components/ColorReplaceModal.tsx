import React, { useMemo, useState } from 'react';
import { X, RefreshCw } from 'lucide-react';
import { BeadColor } from '../types';

interface ColorReplaceModalProps {
  isOpen: boolean;
  onClose: () => void;
  sourceColor: BeadColor | null;
  activePalette: BeadColor[];
  onExecuteReplace: (sourceId: string, targetId: string) => void;
}

export const filterBeadColors = (palette: BeadColor[], query: string): BeadColor[] => {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return palette;

  return palette.filter(color =>
    [color.code, color.name, color.brand].some(value =>
      value.toLocaleLowerCase().includes(normalizedQuery),
    ),
  );
};

export const ColorReplaceModal: React.FC<ColorReplaceModalProps> = ({
  isOpen,
  onClose,
  sourceColor,
  activePalette,
  onExecuteReplace,
}) => {
  const [targetColor, setTargetColor] = useState<BeadColor | null>(null);
  const [targetSearch, setTargetSearch] = useState('');
  const filteredPalette = useMemo(
    () => filterBeadColors(activePalette, targetSearch),
    [activePalette, targetSearch],
  );

  if (!isOpen || !sourceColor) return null;

  const handleConfirm = () => {
    if (targetColor) {
      onExecuteReplace(sourceColor.id, targetColor.id);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-5 shadow-2xl text-slate-200 text-xs space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2 text-amber-400 font-bold text-sm">
            <RefreshCw className="w-4 h-4" />
            <span>替换网格中的特定拼豆颜色</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg cursor-pointer"
            aria-label="关闭颜色替换弹窗"
            title="关闭"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Source vs Target Swatch */}
        <div className="flex items-center justify-between bg-slate-950 p-3 rounded-xl border border-slate-800">
          <div className="text-center space-y-1">
            <div className="text-[10px] text-slate-400">原始颜色</div>
            <div
              className="w-10 h-10 rounded-lg border border-black/30 shadow-inner mx-auto flex items-center justify-center font-bold text-xs"
              style={{ backgroundColor: sourceColor.hex }}
            >
              {sourceColor.symbol}
            </div>
            <div className="font-mono font-bold">{sourceColor.code}</div>
            <div className="text-[10px] text-slate-400">{sourceColor.name}</div>
          </div>

          <RefreshCw className="w-5 h-5 text-amber-400 animate-pulse" />

          <div className="text-center space-y-1">
            <div className="text-[10px] text-slate-400">替换为新颜色</div>
            {targetColor ? (
              <>
                <div
                  className="w-10 h-10 rounded-lg border border-black/30 shadow-inner mx-auto flex items-center justify-center font-bold text-xs"
                  style={{ backgroundColor: targetColor.hex }}
                >
                  {targetColor.symbol}
                </div>
                <div className="font-mono font-bold text-emerald-400">{targetColor.code}</div>
                <div className="text-[10px] text-slate-400">{targetColor.name}</div>
              </>
            ) : (
              <div className="w-10 h-10 rounded-lg border border-dashed border-slate-700 mx-auto flex items-center justify-center text-slate-600">
                未选择
              </div>
            )}
          </div>
        </div>

        {/* Target Palette Selector Grid */}
        <div className="space-y-1.5">
          <div className="text-[11px] text-slate-400 font-semibold flex items-center justify-between">
            <span>选择目标替换色:</span>
            <button
              type="button"
              onClick={() => {
                onExecuteReplace(sourceColor.id, 'TRANSPARENT_ERASE');
                onClose();
              }}
              className="text-[10px] text-pink-400 hover:text-pink-300 underline font-bold cursor-pointer"
            >
              🧹 替换为透明/擦除此色
            </button>
          </div>
          <label className="block">
            <span className="sr-only">搜索目标替换色</span>
            <input
              type="search"
              value={targetSearch}
              onChange={event => setTargetSearch(event.target.value)}
              placeholder="按色号、名称或品牌搜索"
              aria-label="搜索目标替换色"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-[11px] text-slate-200 outline-none placeholder:text-slate-500 focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
            />
          </label>
          <div className="max-h-48 overflow-y-auto grid grid-cols-2 gap-1.5 pr-1">
            {filteredPalette.length > 0 ? (
              filteredPalette.map(color => (
                <button
                  key={color.id}
                  type="button"
                  onClick={() => setTargetColor(color)}
                  aria-pressed={targetColor?.id === color.id}
                  aria-label={`选择 ${color.code} ${color.name} 作为替换色`}
                  className={`p-1.5 rounded-lg border flex items-center gap-2 cursor-pointer transition-colors ${
                    targetColor?.id === color.id
                      ? 'bg-amber-950/80 border-amber-500 text-white font-bold'
                      : 'bg-slate-800/80 border-slate-700/80 text-slate-300 hover:bg-slate-700/80'
                  }`}
                >
                  <div
                    className="w-5 h-5 rounded border border-black/20 shrink-0"
                    style={{ backgroundColor: color.hex }}
                  />
                  <div className="truncate text-left">
                    <div className="font-mono leading-none">{color.code}</div>
                    <div className="text-[9px] text-slate-400 truncate leading-tight">{color.name}</div>
                  </div>
                </button>
              ))
            ) : (
              <div className="col-span-2 rounded-lg border border-dashed border-slate-700 px-3 py-4 text-center text-[11px] text-slate-500">
                未找到匹配的颜色，请尝试其他色号、名称或品牌。
              </div>
            )}
          </div>
        </div>

        {/* Buttons */}
        <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium px-3 py-2 rounded-xl cursor-pointer"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!targetColor}
            className="bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white font-bold px-4 py-2 rounded-xl cursor-pointer transition-colors"
          >
            全板一键替换
          </button>
        </div>
      </div>
    </div>
  );
};
