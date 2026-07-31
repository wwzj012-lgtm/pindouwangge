import React from 'react';
import {
  X,
  BookOpen,
  Wand2,
  Pencil,
  Spline,
  Layers,
  Palette,
  Download,
  HelpCircle,
  Keyboard,
  CheckCircle2,
  Sparkles,
  MousePointer,
  Grid,
  FileSpreadsheet,
  Pipette,
  PaintBucket,
  Eraser,
  RefreshCw,
  Sliders,
  Maximize2,
  Move,
  Eye,
  RotateCcw,
} from 'lucide-react';

interface UserGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const UserGuideModal: React.FC<UserGuideModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 animate-fadeIn">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-5xl max-h-[92vh] flex flex-col shadow-2xl text-slate-200 overflow-hidden">
        {/* Modal Header */}
        <div className="p-4 sm:p-5 border-b border-slate-800 flex items-center justify-between bg-slate-900/95 sticky top-0 z-10 backdrop-blur">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl overflow-hidden bg-purple-950/80 border border-purple-500/40 flex items-center justify-center shadow-lg shadow-purple-500/20 shrink-0">
              <img src="/douzhixingge_logo.svg" alt="豆织星格" className="w-full h-full object-cover" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-black text-white">豆织星格 · 简体中文版使用指南</h2>
                <span className="bg-purple-950 text-purple-300 border border-purple-800/60 text-[10px] font-bold px-2 py-0.5 rounded-full">
                  v2.8 全功能说明书
                </span>
              </div>
              <p className="text-xs text-slate-400">
                拼豆图纸网格编辑器 & 图像转像素工作台 · 触屏/桌面双端全功能说明
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-800 cursor-pointer transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-7 text-xs sm:text-sm leading-relaxed text-slate-300">
          {/* Welcome Banner */}
          <div className="bg-gradient-to-r from-purple-950/80 via-indigo-950/50 to-slate-900 border border-purple-800/50 rounded-xl p-4 flex items-start gap-3 shadow-inner">
            <Sparkles className="w-6 h-6 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <h3 className="font-bold text-white text-sm sm:text-base">
                欢迎体验【豆织星格】拼豆专业工作台
              </h3>
              <p className="text-slate-300 text-xs mt-1 leading-relaxed">
                【豆织星格】是专为拼豆（Perler, MARD 融合豆, ARTKAL, MIDO, COCO 等）爱好者、像素插画家及手工艺者设计的专业像素设计工具。集成了<strong>图像AI滤镜转换、描边强化保护、多轴镜像绘图、高清分板标尺导出与精确用量清单</strong>功能。
              </p>
            </div>
          </div>

          {/* SECTION 1: KEYBOARD SHORTCUTS & MOUSE CONTROLS */}
          <div className="space-y-3">
            <h3 className="font-bold text-slate-100 text-base flex items-center gap-2 text-purple-400 border-b border-slate-800 pb-2">
              <Keyboard className="w-4 h-4 text-purple-400" />
              1. 快捷按键与鼠标交互说明 (Keyboard Shortcuts & Controls)
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              {/* Tool Hotkeys */}
              <div className="bg-slate-800/60 p-3.5 rounded-xl border border-slate-700/60 space-y-2">
                <div className="font-bold text-purple-300 flex items-center justify-between">
                  <span>✦ 绘图与平移快捷键</span>
                  <span className="text-[10px] text-slate-400">单键即刻切换</span>
                </div>
                <div className="space-y-1.5 pt-1">
                  <div className="flex items-center justify-between bg-slate-900/80 p-2 rounded-lg border border-slate-800">
                    <span className="flex items-center gap-2"><Pencil className="w-3.5 h-3.5 text-rose-400" /> 画笔工具 (Pencil)</span>
                    <kbd className="bg-slate-800 text-rose-300 font-mono font-bold px-2 py-0.5 rounded border border-slate-700">P</kbd>
                  </div>
                  <div className="flex items-center justify-between bg-slate-900/80 p-2 rounded-lg border border-slate-800">
                    <span className="flex items-center gap-2"><Move className="w-3.5 h-3.5 text-amber-400" /> 单指平移拖拽 (Hand)</span>
                    <kbd className="bg-slate-800 text-amber-300 font-mono font-bold px-2 py-0.5 rounded border border-slate-700">H</kbd>
                  </div>
                  <div className="flex items-center justify-between bg-slate-900/80 p-2 rounded-lg border border-slate-800">
                    <span className="flex items-center gap-2"><PaintBucket className="w-3.5 h-3.5 text-amber-400" /> 油漆桶填充 (Bucket)</span>
                    <kbd className="bg-slate-800 text-amber-300 font-mono font-bold px-2 py-0.5 rounded border border-slate-700">B</kbd>
                  </div>
                  <div className="flex items-center justify-between bg-slate-900/80 p-2 rounded-lg border border-slate-800">
                    <span className="flex items-center gap-2"><Pipette className="w-3.5 h-3.5 text-sky-400" /> 吸管取色 (Eyedropper)</span>
                    <kbd className="bg-slate-800 text-sky-300 font-mono font-bold px-2 py-0.5 rounded border border-slate-700">I</kbd>
                  </div>
                  <div className="flex items-center justify-between bg-slate-900/80 p-2 rounded-lg border border-slate-800">
                    <span className="flex items-center gap-2"><Eraser className="w-3.5 h-3.5 text-slate-400" /> 橡皮擦 (Eraser)</span>
                    <kbd className="bg-slate-800 text-slate-300 font-mono font-bold px-2 py-0.5 rounded border border-slate-700">E</kbd>
                  </div>
                  <div className="flex items-center justify-between bg-slate-900/80 p-2 rounded-lg border border-slate-800">
                    <span className="flex items-center gap-2"><RefreshCw className="w-3.5 h-3.5 text-emerald-400" /> 全图改色 (Replace)</span>
                    <kbd className="bg-slate-800 text-emerald-300 font-mono font-bold px-2 py-0.5 rounded border border-slate-700">R</kbd>
                  </div>
                </div>
              </div>

              {/* Mobile Touch & Desktop Mouse Controls */}
              <div className="bg-slate-800/60 p-3.5 rounded-xl border border-slate-700/60 space-y-2">
                <div className="font-bold text-sky-300 flex items-center justify-between">
                  <span>✦ 手机触屏手势 & 视图控制</span>
                  <span className="text-[10px] text-slate-400">触屏/电脑优化</span>
                </div>
                <div className="space-y-1.5 pt-1">
                  <div className="flex items-center justify-between bg-slate-900/80 p-2 rounded-lg border border-slate-800">
                    <span className="flex items-center gap-2"><Maximize2 className="w-3.5 h-3.5 text-rose-400" /> 双指捏合 (Pinch Zoom)</span>
                    <span className="text-rose-300 font-mono font-bold">两指缩放/平移</span>
                  </div>
                  <div className="flex items-center justify-between bg-slate-900/80 p-2 rounded-lg border border-slate-800">
                    <span className="flex items-center gap-2"><Move className="w-3.5 h-3.5 text-amber-400" /> 单指抓手模式 (Hand Tool)</span>
                    <span className="text-amber-300 font-mono font-bold">切抓手/点右下角🤚</span>
                  </div>
                  <div className="flex items-center justify-between bg-slate-900/80 p-2 rounded-lg border border-slate-800">
                    <span className="flex items-center gap-2"><RotateCcw className="w-3.5 h-3.5 text-indigo-400" /> 撤销 / 重做</span>
                    <kbd className="bg-slate-800 text-indigo-300 font-mono font-bold px-2 py-0.5 rounded border border-slate-700">Ctrl + Z / Y</kbd>
                  </div>
                  <div className="flex items-center justify-between bg-slate-900/80 p-2 rounded-lg border border-slate-800">
                    <span className="flex items-center gap-2"><Move className="w-3.5 h-3.5 text-emerald-400" /> 电脑端平移</span>
                    <span className="text-emerald-300 font-mono font-bold">Shift+左键 / 鼠标中键</span>
                  </div>
                  <div className="flex items-center justify-between bg-slate-900/80 p-2 rounded-lg border border-slate-800">
                    <span className="flex items-center gap-2"><Maximize2 className="w-3.5 h-3.5 text-sky-400" /> 一键居中自适应</span>
                    <span className="text-sky-300 font-mono font-bold">右下角 🎯 适应屏幕</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* SECTION 2: FUNCTIONAL FEATURE BREAKDOWN */}
          <div className="space-y-4">
            <h3 className="font-bold text-slate-100 text-base flex items-center gap-2 text-rose-400 border-b border-slate-800 pb-2">
              <Sliders className="w-4 h-4 text-rose-400" />
              2. 每一个功能面板可以做什么 (Detailed Feature Breakdown)
            </h3>

            <div className="space-y-3 text-xs">
              {/* Header Functions */}
              <div className="bg-slate-800/40 border border-slate-800 rounded-xl p-3.5 space-y-2">
                <div className="font-bold text-purple-300 flex items-center gap-2 text-sm">
                  <Grid className="w-4 h-4 text-purple-400" />
                  顶部导航控制栏 (Header Toolbar)
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-slate-300">
                  <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800">
                    <strong className="text-white block mb-0.5">✦ 画板规格预设 (Board Presets)</strong>
                    点击可一键切换 29x29、50x50、70x70、100x100 等常用规格，自动匹配实际插板拼接。
                  </div>
                  <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800">
                    <strong className="text-white block mb-0.5">✦ 品牌色卡选择 (Brand Palette)</strong>
                    一键切换 MARD (融合豆), MIDO, ARTKAL, COCO, PERLER, HAMMER 等主流厂商色号库。
                  </div>
                  <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800">
                    <strong className="text-white block mb-0.5">✦ 上传图片转换 (Image Conversion)</strong>
                    上传任意二次元动漫图或照片，开启 AI 转拼豆像素工作坊。
                  </div>
                  <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800">
                    <strong className="text-white block mb-0.5">✦ 工程文件导入/导出 (.perler)</strong>
                    导出设计为 `.perler` 专用文件保存到本地，下次导入可随时恢复编辑。
                  </div>
                  <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800">
                    <strong className="text-white block mb-0.5">✦ 自定义色板 (Palette Manager)</strong>
                    勾选手头拥有的豆子色号，禁用缺货色号，确保转换图纸均可实际拼装。
                  </div>
                  <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800">
                    <strong className="text-white block mb-0.5">✦ 导出拼豆图纸 (Export Studio)</strong>
                    生成带横纵轴坐标标尺、印有符号与【豆织星格】水印的高清打印级别图纸。
                  </div>
                </div>
              </div>

              {/* Drawing Tools */}
              <div className="bg-slate-800/40 border border-slate-800 rounded-xl p-3.5 space-y-2">
                <div className="font-bold text-rose-300 flex items-center gap-2 text-sm">
                  <Pencil className="w-4 h-4 text-rose-400" />
                  像素绘制与几何造型工具 (Drawing & Shape Tools)
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-slate-300">
                  <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800">
                    <strong className="text-white block mb-0.5">✦ 画笔 & 橡皮擦</strong>
                    点击单个像素格或按住鼠标拖拽连续铺豆/擦除错误拼豆。
                  </div>
                  <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800">
                    <strong className="text-white block mb-0.5">✦ 直线 / 矩形 / 正圆几何工具</strong>
                    拖拽鼠标自动按 Bresenham 像素算法生成精细画线的几何外框，方便搭框架。
                  </div>
                  <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800">
                    <strong className="text-white block mb-0.5">✦ 油漆桶连通填充 (Bucket Fill)</strong>
                    点击任意单色区域，一键将周围连通的同色拼豆全部替换为当前选中的颜色。
                  </div>
                  <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800">
                    <strong className="text-white block mb-0.5">✦ 全图指定色替换 (Global Replace)</strong>
                    选中源颜色与目标颜色后，一键替换全图中该色号的所有豆子，极速调整色调。
                  </div>
                  <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800">
                    <strong className="text-white block mb-0.5">✦ 多轴对称镜像 (Symmetry Modes)</strong>
                    开启【左右】、【上下】或【4向四轴镜像】，画一笔四角同步绘制，设计对称花纹的神器。
                  </div>
                  <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800">
                    <strong className="text-white block mb-0.5">✦ 方向平移控制 (Grid Shift)</strong>
                    提供上下左右方向按钮，可将全图网格整体向某方向移动 1 个像素格，方便对齐。
                  </div>
                </div>
              </div>

              {/* Image Studio Workshop */}
              <div className="bg-slate-800/40 border border-slate-800 rounded-xl p-3.5 space-y-2">
                <div className="font-bold text-amber-300 flex items-center gap-2 text-sm">
                  <Wand2 className="w-4 h-4 text-amber-400" />
                  图像AI转换与防模糊增强工作坊 (Image Studio Workshop)
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-slate-300">
                  <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800">
                    <strong className="text-white block mb-0.5">✦ 🔥 鲜艳高饱满预设 (防发白/色彩保护)</strong>
                    预设内置 CIEDE2000 色彩匹配算法，保护动漫人物肤色与高饱和发色，彻底解决传统转图发白灰暗问题。
                  </div>
                  <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800">
                    <strong className="text-white block mb-0.5">✦ 暗色黑线条轮廓描边保护</strong>
                    独创二次元轮廓增强技术，自动识别边缘黑线与暗色描边，防止转换时被周围浅色像素混合侵蚀。
                  </div>
                  <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800">
                    <strong className="text-white block mb-0.5">✦ 单色绿幕/纯色背景一键抠除 (Chroma Key)</strong>
                    点击图片中的背景颜色，自动将同色系背景转为透明，保留纯净人物主体与边缘。
                  </div>
                  <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800">
                    <strong className="text-white block mb-0.5">✦ 抖动扩散 (Dithering) & 锐化抖动滤镜</strong>
                    提供 Floyd-Steinberg 像素抖动与锐化对比调节，自然过度复杂人像渐变色与光影细节。
                  </div>
                </div>
              </div>

              {/* Palette Stats Panel */}
              <div className="bg-slate-800/40 border border-slate-800 rounded-xl p-3.5 space-y-2">
                <div className="font-bold text-sky-300 flex items-center gap-2 text-sm">
                  <FileSpreadsheet className="w-4 h-4 text-sky-400" />
                  色卡选择与用量袋数统计面板 (Palette & Stats Panel)
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-slate-300">
                  <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800">
                    <strong className="text-white block mb-0.5">✦ 闪烁高亮特定色号 (Color Highlight)</strong>
                    在色卡列表中点击任意色号，画布上所有该颜色的豆子都会高亮闪烁，实物拼装时找豆极快！
                  </div>
                  <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800">
                    <strong className="text-white block mb-0.5">✦ 精确用量与袋数统计</strong>
                    自动计算图案中所使用的每种色号颗数，并按 1000 粒/袋换算采购袋数。
                  </div>
                </div>
              </div>

              {/* View & Backdrop Settings */}
              <div className="bg-slate-800/40 border border-slate-800 rounded-xl p-3.5 space-y-2">
                <div className="font-bold text-emerald-300 flex items-center gap-2 text-sm">
                  <Eye className="w-4 h-4 text-emerald-400" />
                  视觉辅助与原图衬底功能 (Visual Overlays & Backdrops)
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-slate-300">
                  <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800">
                    <strong className="text-white block mb-0.5">✦ 网格符号印记 (Show Symbols)</strong>
                    在每个拼豆上打印独特字母/数字编号，避免相近颜色分不清导致的误拼。
                  </div>
                  <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800">
                    <strong className="text-white block mb-0.5">✦ A..Z / 1..N 横纵坐标轴</strong>
                    在画布周围显示标准坐标标注，拼大图时迅速定位行列位置。
                  </div>
                  <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800">
                    <strong className="text-white block mb-0.5">✦ 工作台背景样式</strong>
                    支持切换暗色专业网格、白色透明插板、复古木纹工作台及实物拼插效果。
                  </div>
                  <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800">
                    <strong className="text-white block mb-0.5">✦ 原图半透明叠影 (Overlay Image)</strong>
                    把参考原图贴在网格底层并调节透明度，像描摹纸一样顺手描绘线条。
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-900/90 flex flex-wrap justify-between items-center gap-3">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <HelpCircle className="w-4 h-4 text-purple-400 shrink-0" />
            <span>专业拼豆图纸网格工作台【豆织星格】</span>
          </div>
          <button
            onClick={onClose}
            className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold text-xs px-6 py-2.5 rounded-lg shadow-lg shadow-purple-900/40 transition-all cursor-pointer active:scale-95"
          >
            我已掌握，开始拼豆设计
          </button>
        </div>
      </div>
    </div>
  );
};

