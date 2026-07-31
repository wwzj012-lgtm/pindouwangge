import React, { useState } from 'react';
import { X, RefreshCw, Check } from 'lucide-react';
import { BeadColor } from '../types';

interface ColorReplaceModalProps {
  isOpen: boolean;
  onClose: () => void;
  sourceColor: BeadColor | null;
  activePalette: BeadColor[];
  onExecuteReplace: (sourceId: string, targetId: string) => void;
}

export const ColorReplaceModal: React.FC<ColorReplaceModalProps> = ({
  isOpen,
  onClose,
  sourceColor,
  activePalette,
  onExecuteReplace,
}) => {
  const [targetColor, setTargetColor] = useState<BeadColor | null>(null);

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
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg cursor-pointer"
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
          <div className="text-[11px] text-slate-400 font-semibold">选择目标替换色:</div>
          <div className="max-h-48 overflow-y-auto grid grid-cols-2 gap-1.5 pr-1">
            {activePalette.map(color => (
              <button
                key={color.id}
                onClick={() => setTargetColor(color)}
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
            ))}
          </div>
        </div>

        {/* Buttons */}
        <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
          <button
            onClick={onClose}
            className="bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium px-3 py-2 rounded-xl cursor-pointer"
          >
            取消
          </button>
          <button
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
