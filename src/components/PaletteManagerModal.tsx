import React, { useState } from 'react';
import { X, Plus, Check, Search, Palette, Trash2, RotateCcw } from 'lucide-react';
import { BeadColor, BrandKey } from '../types';
import { BRAND_PALETTES, BRAND_NAMES, hexToRgb } from '../data/palettes';

interface PaletteManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  brand: BrandKey;
  activePalette: BeadColor[];
  setActivePalette: (palette: BeadColor[]) => void;
  onSelectColor: (color: BeadColor) => void;
}

export const PaletteManagerModal: React.FC<PaletteManagerModalProps> = ({
  isOpen,
  onClose,
  brand,
  activePalette,
  setActivePalette,
  onSelectColor,
}) => {
  const [search, setSearch] = useState('');
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [newHex, setNewHex] = useState('#FF4081');

  if (!isOpen) return null;

  const handleToggleColor = (id: string) => {
    setActivePalette(
      activePalette.map(c => (c.id === id ? { ...c, enabled: c.enabled === false } : c))
    );
  };

  const handleEnableAll = (enable: boolean) => {
    setActivePalette(activePalette.map(c => ({ ...c, enabled: enable })));
  };

  const handleResetToDefault = () => {
    setActivePalette([...BRAND_PALETTES[brand]]);
  };

  const handleAddCustomColor = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCode.trim() || !newName.trim()) return;

    const customColor: BeadColor = {
      id: `custom_${Date.now()}_${newCode}`,
      code: newCode.trim(),
      name: newName.trim(),
      hex: newHex,
      rgb: hexToRgb(newHex),
      brand,
      symbol: newCode.trim().slice(0, 2),
      enabled: true,
    };

    setActivePalette([customColor, ...activePalette]);
    setNewCode('');
    setNewName('');
  };

  const filteredPalette = activePalette.filter(
    c =>
      c.code.toLowerCase().includes(search.toLowerCase()) ||
      c.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl text-slate-200 text-xs">
        {/* Header */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Palette className="w-5 h-5 text-amber-400" />
            <div>
              <h3 className="font-bold text-sm text-slate-100">
                管理与自定义拼豆色卡 ({BRAND_NAMES[brand]})
              </h3>
              <p className="text-[11px] text-slate-400">
                禁用不拥有的拼豆颜色后，系统在图像转换时将仅从已开启的色卡中匹配！
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Action Controls */}
        <div className="p-4 bg-slate-950/60 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="搜索色卡名称或代码..."
              className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-8 pr-3 py-1.5 text-slate-200 outline-none focus:border-amber-500"
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => handleEnableAll(true)}
              className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-2.5 py-1.5 rounded-lg border border-slate-700 cursor-pointer"
            >
              全选开启
            </button>
            <button
              onClick={() => handleEnableAll(false)}
              className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-2.5 py-1.5 rounded-lg border border-slate-700 cursor-pointer"
            >
              全取消
            </button>
            <button
              onClick={handleResetToDefault}
              className="bg-slate-800 hover:bg-slate-700 text-amber-400 px-2.5 py-1.5 rounded-lg border border-slate-700 flex items-center gap-1 cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" />
              <span>恢复默认全集</span>
            </button>
          </div>
        </div>

        {/* Form: Add New Custom Color */}
        <form onSubmit={handleAddCustomColor} className="p-4 bg-slate-900 border-b border-slate-800 flex items-center gap-2">
          <input
            type="text"
            placeholder="自定义色号 (如 M99)"
            value={newCode}
            onChange={e => setNewCode(e.target.value)}
            className="w-28 bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-200 outline-none"
          />
          <input
            type="text"
            placeholder="颜色名称 (如 荧光粉)"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-200 outline-none"
          />
          <input
            type="color"
            value={newHex}
            onChange={e => setNewHex(e.target.value)}
            className="w-9 h-8 bg-slate-800 border border-slate-700 rounded-lg cursor-pointer"
          />
          <button
            type="submit"
            className="bg-amber-600 hover:bg-amber-500 text-white font-bold px-3 py-1.5 rounded-lg flex items-center gap-1 cursor-pointer shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>添加自定义色</span>
          </button>
        </form>

        {/* Color Grid list */}
        <div className="p-4 flex-1 overflow-y-auto grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
          {filteredPalette.map(color => {
            const isEnabled = color.enabled !== false;

            return (
              <div
                key={color.id}
                onClick={() => handleToggleColor(color.id)}
                className={`p-2 rounded-xl border flex items-center gap-2 cursor-pointer transition-all ${
                  isEnabled
                    ? 'bg-slate-800/80 border-slate-700 text-slate-200'
                    : 'bg-slate-950/40 border-slate-900 text-slate-600 opacity-50 line-through'
                }`}
              >
                <div
                  className="w-6 h-6 rounded-md border border-black/20 flex items-center justify-center font-bold text-[10px] shrink-0"
                  style={{ backgroundColor: color.hex }}
                >
                  {isEnabled && <Check className="w-3.5 h-3.5 text-black/80 drop-shadow" />}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="font-mono font-bold leading-tight truncate">{color.code}</div>
                  <div className="text-[10px] text-slate-400 truncate">{color.name}</div>
                </div>

                <button
                  type="button"
                  onClick={e => {
                    e.stopPropagation();
                    onSelectColor(color);
                    onClose();
                  }}
                  className="text-[10px] bg-slate-700 hover:bg-rose-600 hover:text-white px-1.5 py-0.5 rounded text-slate-300 transition-colors"
                >
                  选中
                </button>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800 flex justify-between items-center text-slate-400 text-[11px]">
          <span>已开启 <strong className="text-white">{activePalette.filter(c => c.enabled !== false).length}</strong> / {activePalette.length} 种颜色</span>
          <button
            onClick={onClose}
            className="bg-rose-600 hover:bg-rose-500 text-white font-bold px-4 py-2 rounded-xl cursor-pointer"
          >
            完成并应用
          </button>
        </div>
      </div>
    </div>
  );
};
