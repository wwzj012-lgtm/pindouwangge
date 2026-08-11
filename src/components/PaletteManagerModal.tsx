import React, { useState } from 'react';
import { X, Plus, Check, Search, Palette, Trash2, RotateCcw, Pipette } from 'lucide-react';
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

// Quick preset color swatches for fast custom color creation
const QUICK_PRESET_COLORS = [
  { name: '纯白', hex: '#FFFFFF' },
  { name: '纯黑', hex: '#000000' },
  { name: '鲜红', hex: '#FF2A4B' },
  { name: '桃粉', hex: '#FF69B4' },
  { name: '橘黄', hex: '#FF9500' },
  { name: '柠檬黄', hex: '#FFD700' },
  { name: '薄荷绿', hex: '#00E676' },
  { name: '深绿', hex: '#00897B' },
  { name: '天蓝', hex: '#00B0FF' },
  { name: '深蓝', hex: '#2979FF' },
  { name: '紫罗兰', hex: '#D500F9' },
  { name: '米肤色', hex: '#FFDFC4' },
  { name: '棕褐色', hex: '#8D6E63' },
  { name: '浅灰', hex: '#B0BEC5' },
];

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
  const [showAddCustom, setShowAddCustom] = useState(false);

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

  const handleDeleteCustomColor = (id: string) => {
    setActivePalette(activePalette.filter(c => c.id !== id));
  };

  const handleAddCustomColor = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCode.trim() || !newName.trim()) return;

    const customColor: BeadColor = {
      id: `custom_${Date.now()}_${newCode}`,
      code: newCode.trim(),
      name: newName.trim(),
      hex: newHex.toUpperCase(),
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
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-3xl h-[90vh] max-h-[92vh] flex flex-col shadow-2xl text-slate-200 text-xs overflow-hidden">
        {/* Header */}
        <div className="p-3 sm:p-4 border-b border-slate-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 shrink-0">
              <Palette className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="font-bold text-xs sm:text-base text-slate-100 truncate">
                拼豆色卡管理 ({BRAND_NAMES[brand]})
              </h3>
              <p className="text-[10px] sm:text-[11px] text-slate-400 truncate">
                只使用自己拥有的颜色，转换时会自动匹配已选中的色卡！
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1.5 rounded-xl hover:bg-slate-800 cursor-pointer transition-colors shrink-0 ml-2"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Action Controls & Search */}
        <div className="p-2.5 sm:p-3.5 bg-slate-950/60 border-b border-slate-800 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 shrink-0">
          <div className="relative flex-1 min-w-0">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="搜索色卡名称或代码..."
              className="w-full bg-slate-800 border border-slate-700 rounded-xl pl-8 pr-3 py-1.5 text-slate-200 outline-none focus:border-amber-500 transition-colors text-xs"
            />
          </div>

          <div className="flex items-center justify-between sm:justify-start gap-1.5 shrink-0">
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => handleEnableAll(true)}
                className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-2.5 py-1.5 rounded-xl border border-slate-700 cursor-pointer transition-colors text-xs"
              >
                全选
              </button>
              <button
                onClick={() => handleEnableAll(false)}
                className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-2.5 py-1.5 rounded-xl border border-slate-700 cursor-pointer transition-colors text-xs"
              >
                全不选
              </button>
              <button
                onClick={handleResetToDefault}
                className="bg-slate-800 hover:bg-slate-700 text-amber-400 px-2.5 py-1.5 rounded-xl border border-slate-700 flex items-center gap-1 cursor-pointer transition-colors text-xs"
              >
                <RotateCcw className="w-3 h-3" />
                <span>重置</span>
              </button>
            </div>

            <button
              onClick={() => setShowAddCustom(!showAddCustom)}
              className="bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 px-2.5 py-1.5 rounded-xl flex items-center gap-1 text-xs font-bold cursor-pointer transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{showAddCustom ? '收起自定' : '+ 自定义色'}</span>
            </button>
          </div>
        </div>

        {/* Collapsible Form: Add New Custom Color */}
        {showAddCustom && (
          <div className="p-3 sm:p-4 bg-slate-950/90 border-b border-slate-800 space-y-2.5 shrink-0 animate-fadeIn">
            <div className="text-[11px] font-bold text-amber-400 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Pipette className="w-3.5 h-3.5" />
                <span>添加自定义新色卡</span>
              </span>
              <span className="text-slate-400 font-normal text-[10px]">支持调色盘与Hex码</span>
            </div>

            <form onSubmit={handleAddCustomColor} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
              {/* Color Swatch Block */}
              <div className="flex items-center gap-2 shrink-0">
                <div className="relative group cursor-pointer">
                  <div
                    className="w-10 h-10 rounded-xl border-2 border-slate-600 group-hover:border-amber-400 shadow-md transition-all flex items-center justify-center relative overflow-hidden"
                    style={{ backgroundColor: newHex }}
                  >
                    <div className="bg-black/40 backdrop-blur-xs text-white text-[8px] font-bold px-1 py-0.5 rounded opacity-80 group-hover:opacity-100 transition-opacity">
                      调色
                    </div>
                  </div>
                  <input
                    type="color"
                    value={newHex}
                    onChange={e => setNewHex(e.target.value.toUpperCase())}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    title="点击打开调色板"
                  />
                </div>

                {/* Hex Code Text Field */}
                <div className="flex flex-col justify-center">
                  <label className="text-[9px] text-slate-400 font-mono mb-0.5">HEX 色号</label>
                  <input
                    type="text"
                    value={newHex}
                    onChange={e => {
                      const val = e.target.value;
                      setNewHex(val.startsWith('#') ? val : `#${val}`);
                    }}
                    className="w-20 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1 text-xs font-mono font-bold text-amber-300 outline-none focus:border-amber-500 uppercase"
                    maxLength={7}
                  />
                </div>
              </div>

              {/* Code & Name Input fields */}
              <div className="flex-1 grid grid-cols-2 gap-2">
                <input
                  type="text"
                  placeholder="色号 (如 M99)"
                  value={newCode}
                  onChange={e => setNewCode(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-2.5 py-1.5 text-slate-100 outline-none focus:border-amber-500 text-xs"
                />
                <input
                  type="text"
                  placeholder="名称 (如 荧光粉)"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-2.5 py-1.5 text-slate-100 outline-none focus:border-amber-500 text-xs"
                />
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-black px-3.5 py-2 rounded-xl flex items-center justify-center gap-1 cursor-pointer shrink-0 transition-transform active:scale-95 shadow-md shadow-amber-500/20"
              >
                <Plus className="w-4 h-4 stroke-[3]" />
                <span>添加</span>
              </button>
            </form>

            {/* Quick Color Presets Row */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 pt-0.5 scrollbar-thin">
              <span className="text-[10px] text-slate-400 shrink-0 mr-1">预设:</span>
              {QUICK_PRESET_COLORS.map(p => (
                <button
                  key={p.hex + p.name}
                  type="button"
                  onClick={() => setNewHex(p.hex)}
                  className={`w-6 h-6 rounded-full border border-black/30 shrink-0 cursor-pointer hover:scale-110 transition-transform flex items-center justify-center ${
                    newHex.toUpperCase() === p.hex.toUpperCase() ? 'ring-2 ring-amber-400 scale-110' : ''
                  }`}
                  style={{ backgroundColor: p.hex }}
                  title={`${p.name} (${p.hex})`}
                >
                  {newHex.toUpperCase() === p.hex.toUpperCase() && (
                    <Check className={`w-3 h-3 ${p.hex === '#FFFFFF' || p.hex === '#FFDFC4' ? 'text-black' : 'text-white'}`} />
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Color Grid list */}
        <div className="p-2.5 sm:p-4 flex-1 overflow-y-auto grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 min-h-0">
          {filteredPalette.map(color => {
            const isEnabled = color.enabled !== false;
            const isCustom = color.id.startsWith('custom_');

            return (
              <div
                key={color.id}
                onClick={() => handleToggleColor(color.id)}
                className={`p-2 sm:p-2.5 rounded-xl border flex items-center gap-2 cursor-pointer transition-all ${
                  isEnabled
                    ? 'bg-slate-800/80 hover:bg-slate-800 border-slate-700/80 text-slate-200 shadow-md'
                    : 'bg-slate-950/40 border-slate-900 text-slate-600 opacity-40 line-through'
                }`}
              >
                {/* Color Swatch Box */}
                <div
                  className="w-7 h-7 sm:w-9 sm:h-9 rounded-lg border border-black/30 shadow-inner flex items-center justify-center font-bold text-xs shrink-0"
                  style={{ backgroundColor: color.hex }}
                >
                  {isEnabled && <Check className={`w-3.5 h-3.5 drop-shadow ${color.hex === '#FFFFFF' || color.hex === '#FFFF00' ? 'text-black' : 'text-white'}`} />}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="font-mono font-bold leading-tight text-[11px] sm:text-xs text-slate-100 truncate flex items-center gap-1">
                    <span>{color.code}</span>
                    {isCustom && <span className="text-[8px] bg-amber-500/20 text-amber-300 px-0.5 rounded border border-amber-500/30">自定</span>}
                  </div>
                  <div className="text-[10px] text-slate-400 truncate">{color.name}</div>
                  <div className="text-[9px] font-mono text-slate-500 truncate">{color.hex}</div>
                </div>

                <div className="flex flex-col gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={e => {
                      e.stopPropagation();
                      onSelectColor(color);
                      onClose();
                    }}
                    className="text-[9px] sm:text-[10px] bg-slate-700 hover:bg-amber-500 hover:text-slate-950 font-bold px-1.5 py-0.5 sm:px-2 sm:py-1 rounded-md text-slate-200 transition-colors"
                  >
                    选中
                  </button>
                  {isCustom && (
                    <button
                      type="button"
                      onClick={e => {
                        e.stopPropagation();
                        handleDeleteCustomColor(color.id);
                      }}
                      className="text-[9px] bg-rose-950/80 hover:bg-rose-600 text-rose-300 hover:text-white p-0.5 rounded transition-colors flex items-center justify-center"
                      title="删除此自定义颜色"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="p-3 sm:p-4 border-t border-slate-800 flex justify-between items-center text-slate-400 text-[11px] bg-slate-950/60 shrink-0">
          <span>已开启 <strong className="text-white font-bold">{activePalette.filter(c => c.enabled !== false).length}</strong> / {activePalette.length} 种</span>
          <button
            onClick={onClose}
            className="bg-rose-600 hover:bg-rose-500 text-white font-bold px-4 py-1.5 sm:px-5 sm:py-2 rounded-xl cursor-pointer transition-colors shadow-lg shadow-rose-600/20 text-xs"
          >
            完成并应用
          </button>
        </div>
      </div>
    </div>
  );
};

