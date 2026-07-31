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
} from 'lucide-react';

interface UserGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const UserGuideModal: React.FC<UserGuideModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 animate-fadeIn">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl text-slate-200 overflow-hidden">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-800 flex items-center justify-between bg-slate-900/90 sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-purple-600 via-indigo-600 to-rose-500 flex items-center justify-center shadow-lg shadow-purple-500/20">
              <BookOpen className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-bold text-white">豆织星格 · 简体中文版操作指南</h2>
                <span className="bg-purple-950 text-purple-300 border border-purple-800/60 text-[10px] font-bold px-2 py-0.5 rounded-full">
                  v2.5 官方使用说明
                </span>
              </div>
              <p className="text-xs text-slate-400">
                欢迎使用【豆织星格】专业拼豆图纸设计与像素转换工作台
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

        {/* Content Body */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-6 text-xs sm:text-sm leading-relaxed">
          {/* Hero Banner */}
          <div className="bg-gradient-to-r from-purple-950/60 via-slate-900 to-slate-900 border border-purple-800/40 rounded-xl p-4 flex items-start gap-3">
            <Sparkles className="w-6 h-6 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <h3 className="font-bold text-slate-100 text-sm sm:text-base">
                关于【豆织星格】
              </h3>
              <p className="text-slate-300 text-xs mt-1">
                【豆织星格】专为拼豆（Perler / Artkal / Hama / MARD Beads）爱好者、手工艺者及像素画创作者量身定制。支持将任何二次元动漫图像或照片自动转为高还原度的像素图纸，并提供精准的拼豆用量色卡清单与高清可打印图纸导出。
              </p>
            </div>
          </div>

          {/* Section 1: Image Conversion */}
          <div className="space-y-3">
            <h3 className="font-bold text-slate-100 text-base flex items-center gap-2 text-purple-400 border-b border-slate-800 pb-2">
              <Wand2 className="w-4 h-4 text-purple-400" />
              1. 图像上传与 AI 滤镜转图
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-slate-300 text-xs">
              <div className="bg-slate-800/60 p-3 rounded-xl border border-slate-700/60 space-y-1">
                <span className="font-bold text-purple-300 block">✦ 图像AI增强与抠图工作坊</span>
                <p>点击顶部【上传图片转换】或【转换增强工作坊】，可实时调整图片尺寸、裁剪、旋转、水平翻转。</p>
              </div>
              <div className="bg-slate-800/60 p-3 rounded-xl border border-slate-700/60 space-y-1">
                <span className="font-bold text-rose-300 block">✦ 边缘锐化与黑边保护</span>
                <p>开启【暗色/黑色描边保护】可极大降低动漫二次元人物轮廓黑边丢失的问题，保持线条清晰。</p>
              </div>
              <div className="bg-slate-800/60 p-3 rounded-xl border border-slate-700/60 space-y-1">
                <span className="font-bold text-amber-300 block">✦ CIEDE2000 工业级感知匹配</span>
                <p>内置 CIEDE2000 真实人类视觉感知色彩匹配算法，比常规 RGB 匹配更精准贴合实物豆子表现。</p>
              </div>
              <div className="bg-slate-800/60 p-3 rounded-xl border border-slate-700/60 space-y-1">
                <span className="font-bold text-emerald-300 block">✦ 绿幕 / 单色绿底自动抠图</span>
                <p>在工作坊中点击【点击选取透明抠除背景色】，支持一键抠除背景，保留干净主体。</p>
              </div>
            </div>
          </div>

          {/* Section 2: Drawing Tools */}
          <div className="space-y-3">
            <h3 className="font-bold text-slate-100 text-base flex items-center gap-2 text-rose-400 border-b border-slate-800 pb-2">
              <Pencil className="w-4 h-4 text-rose-400" />
              2. 拼豆网格手动绘制工具
            </h3>
            <ul className="space-y-2 text-xs text-slate-300 bg-slate-800/40 p-3.5 rounded-xl border border-slate-800">
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                <span><strong className="text-white">画笔 (P):</strong> 在画布网格上点选或按住拖拽绘制拼豆。</span>
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                <span><strong className="text-white">直线 / 矩形 / 圆形:</strong> 拖拽绘制几何图框，系统将自动使用 Bresenham 算法精准像素化。</span>
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                <span><strong className="text-white">油漆桶 (B):</strong> 洪水填充算法，一键将相同颜色的连通区域快速填满目标颜色。</span>
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                <span><strong className="text-white">替换全图此色 (R):</strong> 选择源颜色与目标颜色后，一键全局替换该色号（适合改色调）。</span>
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                <span><strong className="text-white">吸管 (I) & 橡皮擦 (E):</strong> 快速获取网格已有颜色或清除错误拼豆。</span>
              </li>
            </ul>
          </div>

          {/* Section 3: Symmetry & Backdrops */}
          <div className="space-y-3">
            <h3 className="font-bold text-slate-100 text-base flex items-center gap-2 text-sky-400 border-b border-slate-800 pb-2">
              <Spline className="w-4 h-4 text-sky-400" />
              3. 多轴对称镜像与画布衬底
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-slate-300">
              <div className="bg-slate-800/60 p-3 rounded-xl border border-slate-700/60">
                <div className="font-bold text-sky-300 flex items-center gap-1.5 mb-1">
                  <Spline className="w-3.5 h-3.5" />
                  对称模式
                </div>
                <p>支持【左右镜像】、【上下镜像】与【4向四轴镜像】，非常适合制作中心对称花纹、精灵图标与饰品图纸。</p>
              </div>
              <div className="bg-slate-800/60 p-3 rounded-xl border border-slate-700/60">
                <div className="font-bold text-emerald-300 flex items-center gap-1.5 mb-1">
                  <Layers className="w-3.5 h-3.5" />
                  画布衬底与叠影
                </div>
                <p>可在工具栏切换深色网格、白色插板、复古木纹及暗调工作台。开启【原图叠影】可在网格背后显示原图半透明衬底。</p>
              </div>
            </div>
          </div>

          {/* Section 4: Palette Management */}
          <div className="space-y-3">
            <h3 className="font-bold text-slate-100 text-base flex items-center gap-2 text-amber-400 border-b border-slate-800 pb-2">
              <Palette className="w-4 h-4 text-amber-400" />
              4. 品牌色卡管理 (MARD, MIDO, ARTKAL 等)
            </h3>
            <p className="text-xs text-slate-300">
              系统内置包括 MARD (融合豆), MIDO, ARTKAL, COCO, PERLER, HAMMER 等各大拼豆品牌的完整专业色卡。点击【自定义色板】可单独开启或禁用手头缺货的色号，确保转换出的图纸色号均可实际拼装。
            </p>
          </div>

          {/* Section 5: High-Res Export */}
          <div className="space-y-3">
            <h3 className="font-bold text-slate-100 text-base flex items-center gap-2 text-emerald-400 border-b border-slate-800 pb-2">
              <Download className="w-4 h-4 text-emerald-400" />
              5. 导出高清图纸教程与用量清单
            </h3>
            <p className="text-xs text-slate-300">
              点击右上角【导出拼豆图纸】，可实时渲染带 A..Z / 1..N 标准横纵标尺、拼豆符号标识、分板 (如 29x29) 序号的打印级别高清图纸。导出的图纸右侧将附带精确到“粒”与“包”的拼豆用量色卡表，并带有【豆织星格】正版水印。
            </p>
          </div>

          {/* Section 6: Shortcuts */}
          <div className="space-y-3 bg-slate-800/80 p-4 rounded-xl border border-slate-700/80">
            <h3 className="font-bold text-slate-100 text-sm flex items-center gap-2 text-purple-300">
              <Keyboard className="w-4 h-4" />
              快捷键指南
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <div className="bg-slate-900/90 p-2 rounded-lg border border-slate-700/80 flex items-center justify-between">
                <span className="text-slate-400">画笔</span>
                <kbd className="bg-slate-800 text-rose-400 font-mono px-1.5 py-0.5 rounded border border-slate-700">P</kbd>
              </div>
              <div className="bg-slate-900/90 p-2 rounded-lg border border-slate-700/80 flex items-center justify-between">
                <span className="text-slate-400">油漆桶</span>
                <kbd className="bg-slate-800 text-rose-400 font-mono px-1.5 py-0.5 rounded border border-slate-700">B</kbd>
              </div>
              <div className="bg-slate-900/90 p-2 rounded-lg border border-slate-700/80 flex items-center justify-between">
                <span className="text-slate-400">吸管</span>
                <kbd className="bg-slate-800 text-rose-400 font-mono px-1.5 py-0.5 rounded border border-slate-700">I</kbd>
              </div>
              <div className="bg-slate-900/90 p-2 rounded-lg border border-slate-700/80 flex items-center justify-between">
                <span className="text-slate-400">橡皮擦</span>
                <kbd className="bg-slate-800 text-rose-400 font-mono px-1.5 py-0.5 rounded border border-slate-700">E</kbd>
              </div>
              <div className="bg-slate-900/90 p-2 rounded-lg border border-slate-700/80 flex items-center justify-between">
                <span className="text-slate-400">替换全图色</span>
                <kbd className="bg-slate-800 text-rose-400 font-mono px-1.5 py-0.5 rounded border border-slate-700">R</kbd>
              </div>
              <div className="bg-slate-900/90 p-2 rounded-lg border border-slate-700/80 flex items-center justify-between">
                <span className="text-slate-400">撤销操作</span>
                <kbd className="bg-slate-800 text-rose-400 font-mono px-1.5 py-0.5 rounded border border-slate-700">Ctrl+Z</kbd>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-900 flex justify-between items-center">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <HelpCircle className="w-4 h-4 text-purple-400" />
            <span>【豆织星格】拼豆图纸网格编辑器</span>
          </div>
          <button
            onClick={onClose}
            className="bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs px-5 py-2 rounded-lg shadow-md transition-all cursor-pointer active:scale-95"
          >
            知道了，开始创作
          </button>
        </div>
      </div>
    </div>
  );
};
