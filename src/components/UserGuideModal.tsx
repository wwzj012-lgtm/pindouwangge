import React from 'react';
import { useLanguage } from '../context/LanguageContext';
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
  const { language } = useLanguage();
  const isEn = language === 'en';
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 animate-fadeIn">
      <div className="bg-[#FAF9FD] border border-purple-200/80 rounded-3xl w-full max-w-5xl max-h-[92vh] flex flex-col shadow-2xl shadow-purple-900/10 text-slate-800 overflow-hidden">
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-purple-200/70 flex items-center justify-between bg-gradient-to-r from-purple-100/70 via-slate-50 to-purple-50/50 backdrop-blur-md sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl overflow-hidden bg-purple-50 border border-purple-200 flex items-center justify-center shadow-xs shrink-0">
              <img src="/douzhixingge_logo.svg" alt="豆织星格" className="w-full h-full object-cover" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-extrabold text-slate-900 tracking-tight">{isEn ? 'BeadGrid · User Guide' : '豆织星格 · 简体中文版使用指南'}</h2>
                <span className="bg-purple-100 border border-purple-200 text-purple-700 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
                  {isEn ? 'v3.0 Credits' : 'v3.0 积分制度说明'}
                </span>
              </div>
              <p className="text-xs text-slate-500">
                {isEn ? 'Bead pattern editor & image pixel workspace · Credits and membership guide' : '拼豆图纸网格编辑器 & 图像转像素工作台 · 积分与会员权益指南'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 p-2 rounded-xl hover:bg-purple-100/60 cursor-pointer transition-all"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-8 text-xs sm:text-sm leading-relaxed text-slate-700 bg-slate-100/60 custom-scrollbar">
          {/* Welcome Banner */}
          <div className="bg-gradient-to-r from-purple-100/70 via-purple-50 to-indigo-50 border border-purple-200/80 rounded-2xl p-4 flex items-start gap-3 shadow-xs">
            <Sparkles className="w-6 h-6 text-purple-600 shrink-0 mt-0.5" />
            <div>
              <h3 className="font-bold text-slate-900 text-sm sm:text-base">
                {isEn ? 'Welcome to BeadGrid professional pixel workspace' : '欢迎体验【豆织星格】拼豆专业级像素创意工作台'}
              </h3>
              <p className="text-slate-600 text-xs mt-1 leading-relaxed">
                {isEn ? 'BeadGrid provides image conversion, grid editing, palette management, material statistics and pattern export. Core creation uses credits; VIP adds watermark, batch, commercial and cloud benefits. On desktop use the left conversion panel, top editing toolbar and right material summary; on mobile switch workspaces from the bottom bar.' : '【豆织星格】面向拼豆爱好者与像素创作者，提供图像转换、网格编辑、色卡管理、物料统计和图纸导出。核心创作使用积分，VIP 仅提供少量水印、批量、商用与云空间权益；桌面端左侧用于转换设置、顶部工具栏用于编辑、右侧用于用量统计，手机端通过底栏切换工作区。'}
              </p>
            </div>
          </div>

          {/* SECTION 0: CREDITS & MEMBERSHIP */}
          <div className="space-y-3">
            <h3 className="font-bold text-slate-900 text-base flex items-center gap-2 text-amber-600 border-b border-purple-100 pb-2">
              <Sparkles className="w-4 h-4 text-amber-500" />
              {isEn ? '0. Credits and membership (start here)' : '0. 积分与会员制度（先看这里）'}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="bg-amber-50/50 p-4 rounded-2xl border border-amber-200/80 space-y-2 text-slate-700 shadow-xs">
                <div className="font-bold text-amber-900">{isEn ? 'How to earn credits' : '积分怎么获得'}</div>
                <p>{isEn ? 'Sign in daily to claim about 40 credits (streak rewards vary by cycle). Creator members receive 500 credits weekly; commercial members receive 1,500. Purchased credits remain valid; check-in and membership allowances expire according to the rules.' : '登录后每天可签到领取约 40 积分（连续签到奖励会按周期变化）。创作者会员每周附赠 500 积分，商用会员每周附赠 1500 积分；充值购买的积分长期有效，签到和会员额度按页面规则过期。'}</p>
                <p className="text-slate-500">{isEn ? 'Protected actions prompt new users to sign in. Guests cannot save, publish or download protected files.' : '新用户首次使用受保护操作时会先提示登录，游客不能保存、发布或下载受保护文件。'}</p>
              </div>
              <div className="bg-sky-50/50 p-4 rounded-2xl border border-sky-200/80 space-y-2 text-slate-700 shadow-xs">
                <div className="font-bold text-sky-900">{isEn ? 'How credits are spent' : '积分怎么消耗'}</div>
                <p>{isEn ? '30×30 (900 cells) = 1 credit; other sizes scale by grid area, and 52×52 is about 3.1 credits. Upload, preview and local editing are free. Credits are quoted and charged when applying results, cloud saving, publishing or downloading protected high-resolution/watermark-free files.' : '30×30（900 格）= 1 积分，其他尺寸按画板格子数换算；52×52 约 3.1 积分。上传、预览和本地编辑可先免费体验，点击“应用结果”、云端保存、发布社区或下载受保护的高清/无水印文件时，系统会显示报价并扣除积分。'}</p>
                <p className="text-slate-500">{isEn ? 'Background removal is currently free. If credits are insufficient, reduce the size, disable advanced options, or open the top-up/redeem page.' : '背景移除目前免费，不消耗积分。积分不足时可缩小尺寸、取消高级选项或前往充值/兑换码页面。'}</p>
              </div>
            </div>
            <div className="bg-purple-50/60 border border-purple-200/80 rounded-2xl p-4 space-y-2 text-slate-700 shadow-xs">
              <div className="font-bold text-purple-900">{isEn ? 'What VIP keeps exclusive' : 'VIP 保留哪些权益'}</div>
              <p>{isEn ? 'VIP is not a generation-count membership: core generation, bead saving, palettes, sizes and background removal follow the credit rules above. VIP mainly unlocks watermark-free export, custom watermark, batch processing, commercial authorization and larger cloud storage; weekly membership credits are used first.' : 'VIP 不是生成次数会员：核心生成、智能省豆、色卡、尺寸和背景移除都按上面的积分规则使用。VIP 主要解锁去平台水印、自定义水印、批量处理、商业授权和更大云端空间；会员周额度会优先抵扣积分消耗。'}</p>
              <p className="text-slate-500">{isEn ? 'A “7-day trial card” grants membership benefits for 7 days. After it ends, the account returns to the standard credit plan and purchased credits remain.' : '兑换码中的“7 天体验卡”代表 7 天会员权益，体验期结束后恢复普通积分账户，剩余充值积分不会被清除。'}</p>
            </div>
          </div>

          {/* SECTION 1: KEYBOARD SHORTCUTS & MOUSE CONTROLS */}
          <div className="space-y-3">
            <h3 className="font-bold text-slate-900 text-base flex items-center gap-2 text-purple-700 border-b border-purple-100 pb-2">
              <Keyboard className="w-4 h-4 text-purple-600" />
              1. 快捷按键与鼠标交互说明 (Keyboard Shortcuts & Interactive Controls)
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              {/* Tool Hotkeys */}
              <div className="bg-purple-50/40 p-4 rounded-2xl border border-purple-100 space-y-2">
                <div className="font-bold text-purple-900 flex items-center justify-between border-b border-purple-100/80 pb-1.5">
                  <span>✦ 绘图编辑器单键快捷切换</span>
                  <span className="text-[10px] text-slate-500">点击主键盘区（英文半角输入下）</span>
                </div>
                <div className="space-y-1.5 pt-1">
                  <div className="flex items-center justify-between bg-white p-2.5 rounded-xl border border-purple-100/80 shadow-xs text-slate-700">
                    <span className="flex items-center gap-2"><Pencil className="w-3.5 h-3.5 text-rose-500" /> 画笔工具 (Pencil)</span>
                    <kbd className="bg-slate-100 text-slate-800 font-mono font-bold px-2 py-0.5 rounded-lg border border-slate-200">P</kbd>
                  </div>
                  <div className="flex items-center justify-between bg-white p-2.5 rounded-xl border border-purple-100/80 shadow-xs text-slate-700">
                    <span className="flex items-center gap-2"><Move className="w-3.5 h-3.5 text-amber-500" /> 画布抓手平移 (Hand Tool)</span>
                    <kbd className="bg-slate-100 text-slate-800 font-mono font-bold px-2 py-0.5 rounded-lg border border-slate-200">H</kbd>
                  </div>
                  <div className="flex items-center justify-between bg-white p-2.5 rounded-xl border border-purple-100/80 shadow-xs text-slate-700">
                    <span className="flex items-center gap-2"><PaintBucket className="w-3.5 h-3.5 text-yellow-500" /> 油漆桶连通填充 (Bucket)</span>
                    <kbd className="bg-slate-100 text-slate-800 font-mono font-bold px-2 py-0.5 rounded-lg border border-slate-200">B</kbd>
                  </div>
                  <div className="flex items-center justify-between bg-white p-2.5 rounded-xl border border-purple-100/80 shadow-xs text-slate-700">
                    <span className="flex items-center gap-2"><Pipette className="w-3.5 h-3.5 text-sky-500" /> 滴管吸色工具 (Eyedropper)</span>
                    <kbd className="bg-slate-100 text-slate-800 font-mono font-bold px-2 py-0.5 rounded-lg border border-slate-200">I</kbd>
                  </div>
                  <div className="flex items-center justify-between bg-white p-2.5 rounded-xl border border-purple-100/80 shadow-xs text-slate-700">
                    <span className="flex items-center gap-2"><Eraser className="w-3.5 h-3.5 text-slate-500" /> 橡皮擦除 (Eraser)</span>
                    <kbd className="bg-slate-100 text-slate-800 font-mono font-bold px-2 py-0.5 rounded-lg border border-slate-200">E</kbd>
                  </div>
                  <div className="flex items-center justify-between bg-white p-2.5 rounded-xl border border-purple-100/80 shadow-xs text-slate-700">
                    <span className="flex items-center gap-2"><RefreshCw className="w-3.5 h-3.5 text-emerald-500" /> 全图指定色替换 (Global Replace)</span>
                    <kbd className="bg-slate-100 text-slate-800 font-mono font-bold px-2 py-0.5 rounded-lg border border-slate-200">R</kbd>
                  </div>
                </div>
              </div>

              {/* Mobile Touch & Desktop Mouse Controls */}
              <div className="bg-sky-50/40 p-4 rounded-2xl border border-sky-100 space-y-2">
                <div className="font-bold text-sky-900 flex items-center justify-between border-b border-sky-100/80 pb-1.5">
                  <span>✦ 触屏手势、高级平移与缩放</span>
                  <span className="text-[10px] text-slate-500">平板/手机/电脑操作</span>
                </div>
                <div className="space-y-1.5 pt-1">
                  <div className="flex items-center justify-between bg-white p-2.5 rounded-xl border border-sky-100/80 shadow-xs text-slate-700">
                    <span className="flex items-center gap-2"><Maximize2 className="w-3.5 h-3.5 text-rose-500" /> 双指捏合平移缩放 (Pinch Zoom)</span>
                    <span className="text-rose-600 font-mono font-bold">普通画板双指缩放/平移；大画板双指缩放</span>
                  </div>
                  <div className="flex items-center justify-between bg-white p-2.5 rounded-xl border border-sky-100/80 shadow-xs text-slate-700">
                    <span className="flex items-center gap-2"><Move className="w-3.5 h-3.5 text-amber-500" /> 电脑端快捷平移</span>
                    <span className="text-amber-700 font-mono font-bold">按住 Space + 鼠标左键拖拽</span>
                  </div>
                  <div className="flex items-center justify-between bg-white p-2.5 rounded-xl border border-sky-100/80 shadow-xs text-slate-700">
                    <span className="flex items-center gap-2"><Maximize2 className="w-3.5 h-3.5 text-sky-500" /> 桌面端画布缩放</span>
                    <span className="text-sky-700 font-mono font-bold">鼠标悬停画板后滚动滚轮缩放</span>
                  </div>
                  <div className="flex items-center justify-between bg-white p-2.5 rounded-xl border border-sky-100/80 shadow-xs text-slate-700">
                    <span className="flex items-center gap-2"><Keyboard className="w-3.5 h-3.5 text-purple-500" /> 画板快捷缩放</span>
                    <span className="text-purple-700 font-mono font-bold">Ctrl/Cmd + + / −；Ctrl/Cmd + 0</span>
                  </div>
                  <div className="flex items-center justify-between bg-white p-2.5 rounded-xl border border-sky-100/80 shadow-xs text-slate-700">
                    <span className="flex items-center gap-2"><RotateCcw className="w-3.5 h-3.5 text-purple-500" /> 撤销操作 (Undo)</span>
                    <kbd className="bg-slate-100 text-slate-800 font-mono font-bold px-2 py-0.5 rounded-lg border border-slate-200">Ctrl + Z</kbd>
                  </div>
                  <div className="flex items-center justify-between bg-white p-2.5 rounded-xl border border-sky-100/80 shadow-xs text-slate-700">
                    <span className="flex items-center gap-2"><RotateCcw className="w-3.5 h-3.5 text-purple-500" /> 重做操作 (Redo)</span>
                    <kbd className="bg-slate-100 text-slate-800 font-mono font-bold px-2 py-0.5 rounded-lg border border-slate-200">Ctrl + Y / Ctrl + Shift + Z</kbd>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-purple-200/80 bg-purple-50/50 p-4 text-xs text-slate-700 shadow-xs">
            <div className="flex items-center gap-2 font-bold text-purple-900">
              <Maximize2 className="h-3.5 w-3.5 text-purple-600" />
              普通画板与大画板缩放 (Canvas Zoom)
            </div>
            <p className="mt-2 leading-relaxed">
              鼠标悬停普通画板或大画板后直接滚动滚轮即可围绕光标缩放；<kbd className="mx-1 rounded-md border border-purple-200 bg-white px-1.5 py-0.5 font-mono font-bold text-purple-700 shadow-xs">Ctrl/Command + + / −</kbd>可逐级缩放，<kbd className="mx-1 rounded-md border border-purple-200 bg-white px-1.5 py-0.5 font-mono font-bold text-purple-700 shadow-xs">Ctrl/Command + 0</kbd>适配当前画板全部有效内容。移动端保留原有触控手势与绘制行为。
            </p>
          </div>

          {/* SECTION 2: FUNCTIONAL FEATURE BREAKDOWN */}
          <div className="space-y-5">
            <h3 className="font-bold text-slate-900 text-base flex items-center gap-2 text-rose-600 border-b border-purple-100 pb-2">
              <Sliders className="w-4 h-4 text-rose-500" />
              2. 功能板块详细介绍与使用指南 (Core Functional Workbenches)
            </h3>

            <div className="space-y-4 text-xs">
              {/* Image Studio Workshop */}
              <div className="bg-purple-50/30 border border-purple-100 rounded-2xl p-4 space-y-3">
                <div className="font-bold text-slate-900 flex items-center gap-2 text-sm border-b border-purple-100 pb-1.5">
                  <Wand2 className="w-4.5 h-4.5 text-purple-600" />
                  图像转像素工作坊 (Image Studio Workshop)
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-slate-700">
                  <div className="bg-white p-3 rounded-xl border border-purple-100/70 shadow-xs space-y-1">
                    <strong className="text-slate-900 flex items-center gap-1 font-bold">
                      <span className="text-amber-500">✦</span> 鲜艳高饱和保护 & 肤色修正 (Vivid Boost)
                    </strong>
                    <p className="text-slate-500 leading-relaxed">
                      照片分支使用 <strong>CIEDE2000 色彩匹配</strong>，图标分支使用 CIE76；可在预览中检查色彩和轮廓是否符合原图。
                    </p>
                  </div>
                  <div className="bg-white p-3 rounded-xl border border-purple-100/70 shadow-xs space-y-1">
                    <strong className="text-slate-900 flex items-center gap-1 font-bold">
                      <span className="text-amber-500">✦</span> 深色轮廓描边边缘强化保护 (Outline Boost)
                    </strong>
                    <p className="text-slate-500 leading-relaxed">
                      开启后，引擎在像素转换时会自动对图像中的黑色或极深色边缘进行<strong>描边锁定与对比度扩张</strong>，确保精细线稿或动漫表情轮廓不断线、不被周围的浅色区域混合吞噬。
                    </p>
                  </div>
                  <div className="bg-white p-3 rounded-xl border border-purple-100/70 shadow-xs space-y-1">
                    <strong className="text-slate-900 flex items-center gap-1 font-bold">
                      <span className="text-amber-500">✦</span> 智能绿幕与背景一键抠除 (Chroma Key Background)
                    </strong>
                    <p className="text-slate-500 leading-relaxed">
                      支持在预览区吸取背景色并调节容差。只会移除与画布边缘连通的候选背景，主体内部孔洞会保留；背景移除目前免费，应用前请检查预览。
                    </p>
                  </div>
                  <div className="bg-white p-3 rounded-xl border border-purple-100/70 shadow-xs space-y-1">
                    <strong className="text-slate-900 flex items-center gap-1 font-bold">
                      <span className="text-amber-500">✦</span> Floyd-Steinberg 空间误差扩散抖动 (Dithering)
                    </strong>
                    <p className="text-slate-500 leading-relaxed">
                      用于照片和渐变光影的误差扩散，可在设置面板中切换并调节强度。抖动会改变局部颜色分布，请以转换预览为准。
                    </p>
                  </div>
                </div>
              </div>

              {/* Smart Bead Reducer */}
              <div className="bg-gradient-to-r from-amber-50/60 via-purple-50/40 to-amber-50/60 border border-amber-200/80 rounded-2xl p-4 space-y-3">
                <div className="font-bold text-amber-900 flex items-center gap-2 text-sm border-b border-amber-200/60 pb-1.5">
                  <Sparkles className="w-4.5 h-4.5 text-amber-500 fill-current" />
                  显著性智能省豆与精纯优化引擎 (Smart Bead Reducer)
                </div>
                <p className="text-slate-600 leading-relaxed">
                  省豆功能对所有登录用户开放，按当前图纸尺寸和报价规则消耗积分。引擎会优先合并低频、孤立且不受保护的颜色，并保留五官、文字、细线和有意留白；结果会因图纸内容不同而变化，请对照预览后再应用：
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-slate-700 pt-1">
                  <div className="bg-white p-3 rounded-xl border border-amber-200/60 shadow-xs space-y-1">
                    <strong className="text-slate-900 flex items-center gap-1.5 font-bold">
                      <span className="text-purple-600 font-mono">1.</span> 悬空孤立噪点极速净化 (1-3px Isolated Noise Clean)
                    </strong>
                    <p className="text-slate-500 leading-relaxed">
                      物理拼装时，漂浮在四周的 1x1 或 1x2 像素孤豆极难挂烫，且容易断裂。减粒引擎可智能识别这部分由于图片背景残留、噪点而产生的“悬空灰尘”，一键将其清除，使物理插板更稳固。
                    </p>
                  </div>
                  <div className="bg-white p-3 rounded-xl border border-amber-200/60 shadow-xs space-y-1">
                    <strong className="text-slate-900 flex items-center gap-1.5 font-bold">
                      <span className="text-purple-600 font-mono">2.</span> 大面积平滑与零碎色卡压缩 (Palette Consolidation)
                    </strong>
                    <p className="text-slate-500 leading-relaxed">
                      将极低频零碎杂色卡进行聚类归并。例如一张图纸如果只用了两颗“薰衣草紫”，引擎将自动将其归纳到相近的“浅紫”或边缘色，<strong>直接清退非必要买整包的冷门色号</strong>，节省买整包豆的开支。
                    </p>
                  </div>
                  <div className="bg-white p-3 rounded-xl border border-amber-200/60 shadow-xs space-y-1">
                    <strong className="text-slate-900 flex items-center gap-1.5 font-bold">
                      <span className="text-purple-600 font-mono">3.</span> 四周空白拼板自动裁剪 (Auto Crop Blank Board)
                    </strong>
                    <p className="text-slate-500 leading-relaxed">
                      自动裁剪网格图像边缘完全没有豆子的空缺插板，紧缩核心画布，使拼装图纸的聚焦度更高、打印耗材更省。
                    </p>
                  </div>
                  <div className="bg-white p-3 rounded-xl border border-amber-200/60 shadow-xs space-y-1">
                    <strong className="text-slate-900 flex items-center gap-1.5 font-bold">
                      <span className="text-purple-600 font-mono">4.</span> 极速减豆计价报告系统 (Savings RMB Calculator)
                    </strong>
                    <p className="text-slate-500 leading-relaxed">
                      动态显示减粒前后的拼豆数量和色卡种类变化。材料金额仅按 3 元/1000 粒的示例单价估算，实际采购成本以店铺与包装规格为准。
                    </p>
                  </div>
                </div>
              </div>

              {/* Drawing Tools */}
              <div className="bg-rose-50/30 border border-rose-100 rounded-2xl p-4 space-y-3">
                <div className="font-bold text-rose-900 flex items-center gap-2 text-sm border-b border-rose-100 pb-1.5">
                  <Pencil className="w-4.5 h-4.5 text-rose-500" />
                  像素级几何绘画工具箱 (Precision Geometry Canvas Tools)
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-slate-700">
                  <div className="bg-white p-3 rounded-xl border border-rose-100/70 shadow-xs space-y-1">
                    <strong className="text-slate-900 block font-bold">✦ 直线/矩形/正圆高级像素几何画法</strong>
                    <p className="text-slate-500 leading-relaxed">
                      直线、矩形和圆形工具按网格生成轮廓，便于补边框和绘制规整饰物。
                    </p>
                  </div>
                  <div className="bg-white p-3 rounded-xl border border-rose-100/70 shadow-xs space-y-1">
                    <strong className="text-slate-900 block font-bold">✦ 智能油漆桶与全图改色 (Global Fill & Replace)</strong>
                    <p className="text-slate-500 leading-relaxed">
                      提供“连通区域填充（油漆桶）”与“全画布色值一键大替换（R 键）”。可快速替换因色号停产而需要全盘更换为另一个相近品牌或色号的繁琐重复操作。
                    </p>
                  </div>
                  <div className="bg-white p-3 rounded-xl border border-rose-100/70 shadow-xs space-y-1">
                    <strong className="text-slate-900 block font-bold">✦ 十字/四向多轴镜像对称 (Symmetry Master)</strong>
                    <p className="text-slate-500 leading-relaxed">
                      支持“左右轴、上下轴、四向四轴十字对称”。画一笔四侧自动同步响应，是创作杯垫、魔法阵、像素曼陀罗等对称设计时降本增效的神器。
                    </p>
                  </div>
                  <div className="bg-white p-3 rounded-xl border border-rose-100/70 shadow-xs space-y-1">
                    <strong className="text-slate-900 block font-bold">✦ 画布像素级平移微调 (Shift Grid)</strong>
                    <p className="text-slate-500 leading-relaxed">
                      由于添加边框或转图位置出现偏差，可一键利用方向微调按钮，对全盘像素进行整体“上、下、左、右”像素平移，不需要重新画全图。
                    </p>
                  </div>
                </div>
              </div>

              {/* Palette Stats Panel */}
              <div className="bg-sky-50/30 border border-sky-100 rounded-2xl p-4 space-y-3">
                <div className="font-bold text-sky-900 flex items-center gap-2 text-sm border-b border-sky-100 pb-1.5">
                  <FileSpreadsheet className="w-4.5 h-4.5 text-sky-500" />
                  品牌色卡、库存筛选与寻豆定位系统 (Palette & Locator Systems)
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-slate-700">
                  <div className="bg-white p-3 rounded-xl border border-sky-100/70 shadow-xs space-y-1">
                    <strong className="text-slate-900 flex items-center gap-1.5 font-bold">
                      🔥 闪烁高亮定位 (Color Locator Highlight)
                    </strong>
                    <p className="text-slate-500 leading-relaxed">
                      <strong>【寻豆黑科技】</strong>：实物插板拼装时，在右侧列表中点击任意色卡色号，画布中所有使用该色号的拼豆将以<b>高亮度闪烁呼吸</b>展示！插板时一个色号一个色号拼，极速提高拼装效率。
                    </p>
                  </div>
                  <div className="bg-white p-3 rounded-xl border border-sky-100/70 shadow-xs space-y-1">
                    <strong className="text-slate-900 block font-bold">✦ 玩家专属：手头“已有色板”配置 (Inventory Guard)</strong>
                    <p className="text-slate-500 leading-relaxed">
                      在色卡管理器中勾选手头色号、屏蔽缺货色号。图像转换只会从当前启用的色号中匹配，便于按现有材料调整图纸。
                    </p>
                  </div>
                  <div className="bg-white p-3 rounded-xl border border-sky-100/70 shadow-xs space-y-1">
                    <strong className="text-slate-900 block font-bold">✦ 多国主流拼豆厂商色号一键映射</strong>
                    <p className="text-slate-500 leading-relaxed">
                      内置 <strong>MARD、ARTKAL、Perler、HAMA、MIDO 及 COCO</strong> 等品牌色卡与色号代码（如 M01、S01、P01）。不同批次可能存在色差，购买前请对照实物色卡。
                    </p>
                  </div>
                  <div className="bg-white p-3 rounded-xl border border-sky-100/70 shadow-xs space-y-1">
                    <strong className="text-slate-900 block font-bold">✦ 精确用量清单一键拷贝</strong>
                    <p className="text-slate-500 leading-relaxed">
                      精确统计至单颗豆子的详细数据，并自动按 1000 粒/袋 或 500 粒/袋 自动进行用量采购袋数换算。提供文本清单一键复制，让您直接私发客服采购极速下单。
                    </p>
                  </div>
                </div>
              </div>

              {/* View & Backdrop Settings */}
              <div className="bg-emerald-50/30 border border-emerald-100 rounded-2xl p-4 space-y-3">
                <div className="font-bold text-emerald-900 flex items-center gap-2 text-sm border-b border-emerald-100 pb-1.5">
                  <Eye className="w-4.5 h-4.5 text-emerald-600" />
                  视觉渲染排版、标尺打印与原图叠影描摹 (Visual Rendering & Export Studio)
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-slate-700">
                  <div className="bg-white p-3 rounded-xl border border-emerald-100/70 shadow-xs space-y-1">
                    <strong className="text-slate-900 block font-bold">✦ 印刻符号匹配辅助 (Show Pattern Symbols)</strong>
                    <p className="text-slate-500 leading-relaxed">
                      可让每个圆豆像素点正中央打上与其色卡相匹配的专属拉丁符号/数字标记（如 A, B, 1, ★），即使图纸上有 10 种相近的红橙过渡色，也绝不会拼错色号。
                    </p>
                  </div>
                  <div className="bg-white p-3 rounded-xl border border-emerald-100/70 shadow-xs space-y-1">
                    <strong className="text-slate-900 block font-bold">✦ 原图叠影半透明衬底描摹 (Overlay Trace Paper)</strong>
                    <p className="text-slate-500 leading-relaxed">
                      允许您选择一张原参考图置于网格编辑器底层，调节其“不透明度（Opacity）”，就能像传统硫酸纸描红一样，贴着底层图片轮廓直接描点画线。
                    </p>
                  </div>
                  <div className="bg-white p-3 rounded-xl border border-emerald-100/70 shadow-xs space-y-1">
                    <strong className="text-slate-900 block font-bold">✦ 巨幅拼豆：高精度多板拼接导出 (Multi-board Export Layout)</strong>
                    <p className="text-slate-500 leading-relaxed">
                      在导出工作室中，可将大图按 29x29 或 50x50 拼板分块导出。每个图块附带坐标与边界信息，便于打印和拼接。
                    </p>
                  </div>
                  <div className="bg-white p-3 rounded-xl border border-emerald-100/70 shadow-xs space-y-1">
                    <strong className="text-slate-900 block font-bold">✦ 3D 实物融豆熨烫效果实时预览 (Studio Rendering)</strong>
                    <p className="text-slate-500 leading-relaxed">
                      工作台支持原木、暗色网格和影棚背景，以及 3D 融豆外观预览；这些为视觉辅助，不代表实际熨烫效果。
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-purple-200/60 bg-slate-100/80 flex flex-wrap justify-between items-center gap-3">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <HelpCircle className="w-4 h-4 text-purple-600 shrink-0" />
            <span>专业拼豆图纸网格工作台【豆织星格】</span>
          </div>
          <button
            onClick={onClose}
            className="bg-gradient-to-r from-purple-600 via-purple-700 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-bold text-xs px-6 py-2.5 rounded-xl shadow-md shadow-purple-500/25 transition-all cursor-pointer active:scale-95"
          >
            我已掌握，开始拼豆设计
          </button>
        </div>
      </div>
    </div>
  );
};
