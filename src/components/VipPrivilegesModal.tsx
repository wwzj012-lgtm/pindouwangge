import React, { useState } from 'react';
import {
  Crown,
  Sparkles,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  Zap,
  Download,
  Palette,
  Sliders,
  Store,
  X,
  Lock,
  ArrowRight,
  ImageIcon,
  Grid2x2,
  Wand2,
  Cloud,
  FileCheck,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';

interface VipPrivilegesModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenAuthModal: () => void;
}

interface PrivilegeItem {
  name: string;
  desc: string;
  free: boolean | string;
  vip: boolean | string;
  pro: boolean | string;
  badge?: string;
}

export const VipPrivilegesModal: React.FC<VipPrivilegesModalProps> = ({
  isOpen,
  onClose,
  onOpenAuthModal,
}) => {
  const { isVip, isPro } = useAuth();
  const { language } = useLanguage();
  const isEn = language === 'en';
  const [activeTab, setActiveTab] = useState<'all' | 'vip' | 'compare'>('vip');

  if (!isOpen) return null;

  const features: Array<{ category: string; items: PrivilegeItem[] }> = [
    {
      category: isEn ? 'Image Conversion & Canvas Limits' : '拼豆转换与画布尺寸',
      items: [
        {
          name: isEn ? 'Basic Canvas Grid Size' : '基础画布尺寸 (100x100内)',
          desc: isEn ? 'Standard grid size for small crafts and accessories' : '满足常规钥匙扣、小摆件设计需求',
          free: true,
          vip: true,
          pro: true,
        },
        {
          name: isEn ? '400x400 Large Canvas Grid' : '400x400 超大巨幅画布',
          desc: isEn ? 'Create complex, high-detail pixel artwork' : '支持大型墙挂画、高精细度动漫人物设计',
          free: false,
          vip: true,
          pro: true,
          badge: 'VIP',
        },
        {
          name: isEn ? '900x900 Giant Merchant Canvas' : '900x900 商家级巨型尺寸',
          desc: isEn ? 'Giant scale designs for commercial projects' : '极高精细度立体定制与大型展会艺术拼豆',
          free: false,
          vip: false,
          pro: true,
          badge: 'Pro',
        },
      ],
    },
    {
      category: isEn ? 'Pattern Export & Anti-theft Watermark' : '图纸导出与防盗水印',
      items: [
        {
          name: isEn ? '2K HD PNG Pattern Export' : '2K 高清 PNG 图纸导出',
          desc: isEn ? 'Clear grid lines with coordinates and color palette legends' : '清晰点阵、标尺坐标与完整色号图例',
          free: true,
          vip: true,
          pro: true,
        },
        {
          name: isEn ? '✨ Clean Watermark-Free Export' : '✨ 无水印纯净图纸导出',
          desc: isEn ? 'Remove platform watermarks for direct commercial sales & stall printing' : '一键一键关闭防盗水印，导出极简纯净图纸，适合商业售卖与摆摊打印',
          free: false,
          vip: true,
          pro: true,
          badge: 'VIP',
        },
        {
          name: isEn ? '👑 Custom Store Watermark' : '👑 自定义店铺专属水印',
          desc: isEn ? 'Add your store name, customize opacity, angle, and text color' : '支持输入个人/店铺名称、自由调节透明度、斜向角度与梦幻颜色，防止盗图',
          free: false,
          vip: true,
          pro: true,
          badge: 'VIP',
        },
        {
          name: isEn ? '💎 4K Ultra HD Export' : '💎 4K 极清分辨率导出',
          desc: isEn ? 'Ultra-clear 4K resolution output for professional printing' : '超高像素打印级画质，大型印刷与精细纸质图纸无模糊',
          free: false,
          vip: true,
          pro: true,
          badge: 'VIP',
        },
      ],
    },
    {
      category: isEn ? 'Smart Tools & Cost Saving' : '智能工具与提效省豆',
      items: [
        {
          name: isEn ? 'Pencil, Bucket, Line, Eraser, Eyedropper' : '画笔、油漆桶、直线、橡皮擦、吸管',
          desc: isEn ? 'Full suite of pixel editing and drawing tools' : '完整的像素画与点阵手工修改绘制工具集',
          free: true,
          vip: true,
          pro: true,
        },
        {
          name: isEn ? '⚡ Smart Bead Reducer Studio' : '⚡ 智能省豆与抠图工坊',
          desc: isEn ? 'Preview feature-aware saving targets: free trial 15%, VIP 15%/25%, Merchant VIP 40%' : '预览特征保留省豆：免费体验 15%，VIP 15%/25%，商家 VIP 40%',
          free: '体验 15%',
          vip: '15% / 25%',
          pro: true,
          badge: 'VIP',
        },
        {
          name: isEn ? '🎨 1-Click Smart Color Replacer' : '🎨 全图颜色一键替换',
          desc: isEn ? 'Batch replace any color on the grid in seconds' : '快速将全图指定拼豆颜色批量替换为其他色号',
          free: false,
          vip: true,
          pro: true,
          badge: 'VIP',
        },
        {
          name: isEn ? 'Font Scale Adjustment for Markers' : '色号标识字体比例调节 (75%~150%)',
          desc: isEn ? 'Adjust text size of bead color tags on printed guides' : '自由缩放标尺与色号标识大小，适应不同打印尺寸',
          free: false,
          vip: true,
          pro: true,
          badge: 'VIP',
        },
      ],
    },
    {
      category: isEn ? 'Palettes & Cloud Archive' : '色卡管理与云端归档',
      items: [
        {
          name: isEn ? 'Multi-Brand Palette Support' : '多品牌色卡支持 (MARD, Perler, Artkal...)',
          desc: isEn ? 'Supports MARD, Perler, Artkal, COCO, Hama, Nabbi, Yutu' : '内置各大主流拼豆品牌精准 RGB 色号库',
          free: true,
          vip: true,
          pro: true,
        },
        {
          name: isEn ? 'Editable pattern cloud history' : '可编辑图纸云端存档',
          desc: isEn ? 'Restores editable grids across signed-in devices' : '同步完整可编辑网格，可在其他已登录设备继续编辑和高清导出',
          free: '10条',
          vip: '20条',
          pro: '25条',
        },
        {
          name: isEn ? 'Mixed Palette Matching' : '跨品牌混采色卡与自定义 CSV 导入',
          desc: isEn ? 'Mix colors across brands or import custom palette CSV' : '支持自由组合不同品牌的色号库，导入个人专属色卡',
          free: false,
          vip: false,
          pro: true,
          badge: 'Pro',
        },
      ],
    },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-2 sm:p-4 animate-in fade-in duration-200 select-none">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-3xl max-h-[92vh] flex flex-col shadow-2xl text-slate-200 text-xs overflow-hidden">
        
        {/* Header */}
        <div className="p-3.5 sm:p-5 border-b border-slate-800 flex items-center justify-between bg-gradient-to-r from-slate-900 via-purple-950/40 to-slate-900 gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 shrink-0 shadow-lg shadow-amber-500/10">
              <Crown className="w-6 h-6 fill-amber-400/20" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base sm:text-lg font-black text-transparent bg-clip-text bg-gradient-to-r from-amber-200 via-purple-200 to-white">
                  {isEn ? 'Feature List & VIP Privileges' : '功能清单与会员特权对比'}
                </h3>
                <span className="bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[10px] font-extrabold px-2 py-0.5 rounded-full">
                  {isPro ? (isEn ? 'Merchant Pro Active' : '商家Pro 已激活') : isVip ? (isEn ? 'VIP Active' : 'VIP 会员已激活') : (isEn ? 'Free Plan' : '免费版')}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {isEn ? 'Explore all features and unlock VIP exclusives for commercial pattern creation.' : '了解豆织星格完整功能，升级 VIP 解锁无水印商用图纸与智能工具'}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Selection */}
        <div className="px-4 pt-3 pb-2 bg-slate-950 border-b border-slate-800 flex items-center justify-between gap-2 overflow-x-auto scrollbar-none">
          <div className="flex items-center gap-1.5 bg-slate-900 p-1 rounded-xl border border-slate-800 text-xs">
            <button
              onClick={() => setActiveTab('vip')}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'vip'
                  ? 'bg-gradient-to-r from-amber-500/20 to-purple-500/20 text-amber-300 border border-amber-500/30'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Crown className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span>{isEn ? 'VIP Exclusives' : '👑 VIP 专享功能'}</span>
            </button>
            <button
              onClick={() => setActiveTab('all')}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'all'
                  ? 'bg-slate-800 text-white border border-slate-700'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5 text-purple-400 shrink-0" />
              <span>{isEn ? 'Full Feature List' : '全量功能清单'}</span>
            </button>
            <button
              onClick={() => setActiveTab('compare')}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'compare'
                  ? 'bg-slate-800 text-white border border-slate-700'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span>{isEn ? 'Free vs VIP' : '权益对比表'}</span>
            </button>
          </div>

          {/* Quick CTA inside header tab bar */}
          {(!isVip && !isPro) && (
            <button
              onClick={() => {
                onClose();
                onOpenAuthModal();
              }}
              className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:brightness-110 text-slate-950 font-black text-xs flex items-center gap-1 shadow-md shadow-amber-500/20 cursor-pointer shrink-0 transition-all active:scale-95"
            >
              <Crown className="w-3.5 h-3.5 fill-current" />
              <span>{isEn ? 'Upgrade VIP' : '开通 VIP 特权'}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-5 space-y-4 bg-slate-950">
          
          {/* Tab 1: VIP Exclusives Focus */}
          {activeTab === 'vip' && (
            <div className="space-y-3">
              <div className="bg-gradient-to-r from-amber-500/10 via-purple-500/10 to-slate-900 border border-amber-500/20 rounded-xl p-3.5 flex items-center justify-between gap-3">
                <div>
                  <h4 className="text-sm font-black text-amber-300 flex items-center gap-1.5">
                    <Crown className="w-4 h-4 text-amber-400 fill-amber-400/20" />
                    <span>{isEn ? 'VIP Member Privilege Highlights' : 'VIP 会员的核心专享特权'}</span>
                  </h4>
                  <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                    专门为拼豆创作者、商业摆摊、图纸定制卖家设计的提效与商用工具组合：
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="bg-slate-900/90 rounded-xl p-3.5 border border-purple-500/30 flex flex-col gap-2 relative overflow-hidden">
                  <div className="flex items-center gap-2">
                    <span className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 font-bold border border-emerald-500/20">
                      <Download className="w-4 h-4" />
                    </span>
                    <div>
                      <h5 className="font-bold text-slate-200 text-xs">✨ 纯净无水印导出</h5>
                      <span className="text-[10px] text-amber-300 font-bold">VIP 专享解锁</span>
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    一键关闭所有防盗水印，导出极净 2K/4K PNG 矢量拼豆图纸，支持纸质打印与顾客商用发货。
                  </p>
                </div>

                <div className="bg-slate-900/90 rounded-xl p-3.5 border border-purple-500/30 flex flex-col gap-2 relative overflow-hidden">
                  <div className="flex items-center gap-2">
                    <span className="p-1.5 rounded-lg bg-purple-500/10 text-purple-400 font-bold border border-purple-500/20">
                      <Store className="w-4 h-4" />
                    </span>
                    <div>
                      <h5 className="font-bold text-slate-200 text-xs">👑 自定义店铺防盗底纹</h5>
                      <span className="text-[10px] text-amber-300 font-bold">VIP 专享解锁</span>
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    把防盗水印文字修改为您的【个人微信号】或【淘宝/小红书店铺名】，防止同行侵权盗用您的设计。
                  </p>
                </div>

                <div className="bg-slate-900/90 rounded-xl p-3.5 border border-purple-500/30 flex flex-col gap-2 relative overflow-hidden">
                  <div className="flex items-center gap-2">
                    <span className="p-1.5 rounded-lg bg-sky-500/10 text-sky-400 font-bold border border-sky-500/20">
                      <Zap className="w-4 h-4 fill-sky-400/20" />
                    </span>
                    <div>
                      <h5 className="font-bold text-slate-200 text-xs">⚡ 智能抠图与省豆工坊</h5>
                      <span className="text-[10px] text-amber-300 font-bold">VIP 专享解锁</span>
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    在应用前对照预览：免费用户可体验 15%，VIP 可选 15% 或 25%，商家 VIP 另可选 40%。背景移除与色块平滑可单独调整。
                  </p>
                </div>

                <div className="bg-slate-900/90 rounded-xl p-3.5 border border-purple-500/30 flex flex-col gap-2 relative overflow-hidden">
                  <div className="flex items-center gap-2">
                    <span className="p-1.5 rounded-lg bg-amber-500/10 text-amber-400 font-bold border border-amber-500/20">
                      <Grid2x2 className="w-4 h-4" />
                    </span>
                    <div>
                      <h5 className="font-bold text-slate-200 text-xs">📐 400x400 超大画布设计</h5>
                      <span className="text-[10px] text-amber-300 font-bold">VIP 专享解锁</span>
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    打破免费版 100 豆限制，支持大型挂画、巨幅场景点阵图纸创作，细节质感成倍提升。
                  </p>
                </div>

                <div className="bg-slate-900/90 rounded-xl p-3.5 border border-purple-500/30 flex flex-col gap-2 relative overflow-hidden">
                  <div className="flex items-center gap-2">
                    <span className="p-1.5 rounded-lg bg-rose-500/10 text-rose-400 font-bold border border-rose-500/20">
                      <Palette className="w-4 h-4" />
                    </span>
                    <div>
                      <h5 className="font-bold text-slate-200 text-xs">🎨 全图颜色一键批量替换</h5>
                      <span className="text-[10px] text-amber-300 font-bold">VIP 专享解锁</span>
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    遇到色号缺货或改色需求？一键将画布上的某一颜色替换为新色号，无需逐个像素重新涂抹。
                  </p>
                </div>

                <div className="bg-slate-900/90 rounded-xl p-3.5 border border-purple-500/30 flex flex-col gap-2 relative overflow-hidden">
                  <div className="flex items-center gap-2">
                    <span className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-400 font-bold border border-indigo-500/20">
                      <Cloud className="w-4 h-4" />
                    </span>
                    <div>
                      <h5 className="font-bold text-slate-200 text-xs">可编辑图纸云端存档</h5>
                      <span className="text-[10px] text-amber-300 font-bold">VIP 专享解锁</span>
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    云端保存完整可编辑网格：免费 10 条、VIP 20 条、商家 VIP 25 条；可在其他设备继续编辑和高清导出。
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Tab 2: Full Categorized Feature List */}
          {activeTab === 'all' && (
            <div className="space-y-4">
              {features.map((cat, idx) => (
                <div key={idx} className="bg-slate-900/80 rounded-xl p-3.5 border border-slate-800 space-y-2.5">
                  <h4 className="text-xs font-black text-purple-300 flex items-center gap-1.5 border-b border-slate-800 pb-2">
                    <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                    <span>{cat.category}</span>
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                    {cat.items.map((item, i) => (
                      <div key={i} className="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800/80 flex items-start justify-between gap-2">
                        <div className="space-y-0.5">
                          <div className="font-bold text-slate-200 flex items-center gap-1.5">
                            <span>{item.name}</span>
                          </div>
                          <p className="text-[11px] text-slate-400 leading-snug">{item.desc}</p>
                        </div>
                        {item.badge ? (
                          <span className={`px-2 py-0.5 rounded text-[10px] font-black shrink-0 ${
                            item.badge === 'Pro'
                              ? 'bg-purple-950 text-purple-300 border border-purple-700/60'
                              : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                          }`}>
                            {item.badge}
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 rounded text-[10px] font-semibold shrink-0">
                            基础免费
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Tab 3: Comparison Table */}
          {activeTab === 'compare' && (
            <div className="bg-slate-900/90 rounded-xl border border-slate-800 overflow-hidden text-xs">
              <div className="grid grid-cols-12 bg-slate-800/90 p-3 font-bold text-slate-200 text-xs border-b border-slate-700">
                <div className="col-span-5">{isEn ? 'Feature Capability' : '功能与特权服务'}</div>
                <div className="col-span-2 text-center text-slate-400">{isEn ? 'Free' : '免费版'}</div>
                <div className="col-span-2 text-center text-amber-300 font-extrabold">{isEn ? 'VIP Member' : '👑 VIP会员'}</div>
                <div className="col-span-3 text-center text-purple-300 font-extrabold">{isEn ? 'Merchant Pro' : '👑 商家Pro'}</div>
              </div>

              <div className="divide-y divide-slate-800/60">
                {features.flatMap(c => c.items).map((item, idx) => (
                  <div key={idx} className="grid grid-cols-12 p-3 items-center hover:bg-slate-800/30 transition-colors">
                    <div className="col-span-5 pr-2">
                      <div className="font-bold text-slate-200">{item.name}</div>
                      <div className="text-[10px] text-slate-400 line-clamp-1">{item.desc}</div>
                    </div>
                    <div className="col-span-2 text-center text-slate-400">
                      {typeof item.free === 'boolean' ? (
                        item.free ? <CheckCircle2 className="w-4 h-4 text-emerald-400 inline" /> : <XCircle className="w-4 h-4 text-slate-600 inline" />
                      ) : item.free}
                    </div>
                    <div className="col-span-2 text-center font-bold text-amber-300">
                      {typeof item.vip === 'boolean' ? (
                        item.vip ? <CheckCircle2 className="w-4 h-4 text-amber-400 inline" /> : <XCircle className="w-4 h-4 text-slate-600 inline" />
                      ) : item.vip}
                    </div>
                    <div className="col-span-3 text-center font-bold text-purple-300">
                      {typeof item.pro === 'boolean' ? (
                        item.pro ? <CheckCircle2 className="w-4 h-4 text-purple-400 inline" /> : <XCircle className="w-4 h-4 text-slate-600 inline" />
                      ) : item.pro}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>

        {/* Footer CTA */}
        <div className="p-3.5 sm:p-4 border-t border-slate-800 bg-slate-900 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="text-slate-400 text-xs text-center sm:text-left">
            <span>{isEn ? 'Instant activation via online checkout' : '支持微信 / 支付宝即时开通，无拘束享受完整功能'}</span>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              onClick={onClose}
              className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold transition-colors cursor-pointer text-xs flex-1 sm:flex-none"
            >
              {isEn ? 'Close' : '暂不开通'}
            </button>
            <button
              onClick={() => {
                onClose();
                onOpenAuthModal();
              }}
              className="px-5 py-2 rounded-xl bg-gradient-to-r from-amber-500 via-amber-600 to-amber-500 hover:brightness-110 text-slate-950 font-black text-xs shadow-lg shadow-amber-500/20 flex items-center justify-center gap-1.5 cursor-pointer transition-all active:scale-95 flex-1 sm:flex-none whitespace-nowrap"
            >
              <Crown className="w-4 h-4 fill-current" />
              <span>{isEn ? 'Upgrade VIP Privileges' : '立即开通 VIP / 商家Pro'}</span>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
