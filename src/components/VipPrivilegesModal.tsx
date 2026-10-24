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
  const { currentUser, userProfile, isVip, isPro } = useAuth();
  const hasFormalLogin = Boolean(currentUser) && ![currentUser, userProfile].some(account => {
    const value = account as unknown as Record<string, unknown> | null;
    return value?.authProvider === 'guest' || value?.auth_provider === 'guest' || value?.provider === 'guest';
  });
  const { language } = useLanguage();
  const isEn = language === 'en';
  const [activeTab, setActiveTab] = useState<'all' | 'vip' | 'compare'>('vip');

  if (!isOpen) return null;

  const features: Array<{ category: string; items: PrivilegeItem[] }> = [
    {
      category: isEn ? 'Credits & Pattern Creation' : '积分与图纸创作',
      items: [
        {
          name: isEn ? 'All canvas sizes' : '全部画板尺寸（按面积计费）',
          desc: isEn ? '30×30 = 1 credit; larger boards scale by grid area.' : '30×30（900 格）= 1 积分，其他尺寸按格子数换算；52×52 约 3.1 积分。',
          free: '按积分',
          vip: '按积分',
          pro: '按积分',
        },
        {
          name: isEn ? 'Image conversion & editing' : '图像转换、绘制与编辑',
          desc: isEn ? 'Core creation tools are available to every signed-in user with enough credits.' : '核心生成和编辑对所有登录用户开放，提交保存或正式导出时扣积分。',
          free: '按积分',
          vip: '按积分',
          pro: '按积分',
        },
        {
          name: isEn ? 'Background removal' : '背景移除',
          desc: isEn ? 'Free while quality improvements continue.' : '目前免费使用，不消耗积分；请以预览结果为准。',
          free: '免费',
          vip: '免费',
          pro: '免费',
        },
      ],
    },
    {
      category: isEn ? 'VIP Watermark & Commercial Benefits' : 'VIP 水印与商用权益',
      items: [
        {
          name: isEn ? '✨ Watermark-free export' : '✨ 去平台水印导出',
          desc: isEn ? 'Export clean pattern files for personal or commercial use.' : '导出不含平台水印的图纸，适合个人使用或商业交付。',
          free: false,
          vip: true,
          pro: true,
          badge: 'VIP',
        },
        {
          name: isEn ? '👑 Custom watermark' : '👑 自定义水印',
          desc: isEn ? 'Use your own name or shop watermark with adjustable style.' : '使用个人或店铺名称水印，并调整样式和透明度。',
          free: false,
          vip: true,
          pro: true,
          badge: 'VIP',
        },
        {
          name: isEn ? '⚡ Batch processing' : '⚡ 批量处理',
          desc: isEn ? 'Process multiple images or exports in one workflow.' : '一次处理多张图片或多个导出任务，提高批量制作效率。',
          free: false,
          vip: true,
          pro: true,
          badge: 'VIP',
        },
        {
          name: isEn ? 'Commercial authorization' : '商业授权支持',
          desc: isEn ? 'Use VIP benefits for commercial pattern delivery.' : '为商用图纸交付提供会员权益支持，具体授权范围以订单说明为准。',
          free: false,
          vip: true,
          pro: true,
          badge: 'VIP',
        },
      ],
    },
    {
      category: isEn ? 'Smart Tools & Palettes' : '智能工具与色卡',
      items: [
        {
          name: isEn ? 'Smart bead saving' : '智能省豆',
          desc: isEn ? 'Light, standard and strong targets all use credits; preview is free before applying.' : '轻度、标准、强力三档均按积分计费，应用前可免费预览；背景移除不消耗积分。',
          free: '按积分',
          vip: '按积分',
          pro: '按积分',
        },
        {
          name: isEn ? 'Merchant 40% saving discount' : '商家 VIP 40% 省豆折扣',
          desc: isEn ? 'Only Merchant VIP can select the 40% saving target and receive its commercial discount.' : '仅商家 VIP 可选择 40% 省豆档位并享受对应商用折扣；普通积分用户和创作者 VIP 可使用其他档位。',
          free: false,
          vip: false,
          pro: true,
          badge: '商家 VIP',
        },
        {
          name: isEn ? 'Drawing tools & color replace' : '绘画工具与整图改色',
          desc: isEn ? 'Pixel editing tools are available to all plans.' : '画笔、填充、替换等编辑工具对所有方案开放。',
          free: true,
          vip: true,
          pro: true,
        },
        {
          name: isEn ? 'Multi-brand palettes' : '多品牌色卡与色号',
          desc: isEn ? 'Palette matching is available to all plans.' : '主流品牌色卡和色号匹配对所有方案开放。',
          free: true,
          vip: true,
          pro: true,
        },
      ],
    },
    {
      category: isEn ? 'Cloud Archive' : '云端空间',
      items: [
        {
          name: isEn ? 'Editable pattern cloud archive' : '可编辑图纸云端存档',
          desc: isEn ? 'Free accounts get basic space; VIP plans include more storage.' : '免费用户享有基础空间，VIP/商用会员提供更大云空间；云端保存按提示扣积分。',
          free: '基础空间',
          vip: '更大空间',
          pro: '更大空间',
        },
      ],
    },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4 animate-in fade-in duration-200 select-none">
      <div className="bg-[#FAF9FD] border border-purple-200/80 rounded-3xl w-full max-w-3xl max-h-[92vh] flex flex-col shadow-2xl shadow-purple-900/10 text-slate-800 text-xs overflow-hidden">
        
        {/* Header */}
        <div className="px-5 py-4 border-b border-purple-200/70 flex items-center justify-between bg-gradient-to-r from-purple-100/70 via-slate-50 to-amber-50/40 backdrop-blur-md gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-amber-100 via-purple-50 to-indigo-50 border border-amber-200 flex items-center justify-center text-amber-600 shadow-xs shrink-0">
              <Crown className="w-5 h-5 fill-amber-500/20 text-amber-600" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base sm:text-lg font-extrabold text-slate-900 tracking-tight">
                  {isEn ? 'Credits & VIP Benefits' : '积分与 VIP 权益说明'}
                </h3>
                <span className="bg-amber-100 border border-amber-300 text-amber-800 text-[10px] font-extrabold px-2.5 py-0.5 rounded-full">
                  {isPro ? (isEn ? 'Merchant plan active' : '商用会员已激活') : isVip ? (isEn ? 'VIP active' : 'VIP 会员已激活') : (isEn ? '积分用户' : '积分用户')}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {isEn ? 'Use credits for core creation and unlock a small set of VIP commercial benefits.' : '核心创作使用积分，VIP 仅解锁少量水印、批量和商用权益'}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            aria-label={isEn ? 'Close VIP benefits' : '关闭会员权益'}
            className="text-slate-400 hover:text-slate-700 p-2 rounded-xl hover:bg-purple-100/60 transition-all cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Selection */}
        <div className="px-4 pt-3 pb-2 bg-slate-100/70 border-b border-purple-200/60 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 shrink-0">
          <div className="flex flex-wrap items-center gap-1.5 bg-slate-200/70 p-1 rounded-xl border border-slate-300/60 text-[11px] sm:text-xs">
            <button
              onClick={() => setActiveTab('vip')}
              className={`px-2 sm:px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                activeTab === 'vip'
                  ? 'bg-white text-amber-900 border border-amber-300 shadow-xs'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <Crown className="w-3.5 h-3.5 text-amber-500 shrink-0" />
              <span>{isEn ? 'VIP Exclusives' : '👑 VIP 专享功能'}</span>
            </button>
            <button
              onClick={() => setActiveTab('all')}
              className={`px-2 sm:px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                activeTab === 'all'
                  ? 'bg-white text-purple-900 border border-purple-300 shadow-xs'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5 text-purple-600 shrink-0" />
              <span>{isEn ? 'Full Feature List' : '全量功能清单'}</span>
            </button>
            <button
              onClick={() => setActiveTab('compare')}
              className={`px-2 sm:px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                activeTab === 'compare'
                  ? 'bg-white text-emerald-900 border border-emerald-300 shadow-xs'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
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
              className="px-3 py-1.5 min-h-[44px] sm:min-h-0 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white font-black text-xs flex items-center justify-center gap-1 whitespace-nowrap shadow-sm shadow-amber-500/20 cursor-pointer shrink-0 transition-all active:scale-95"
            >
              <Crown className="w-3.5 h-3.5 fill-current" />
              <span>{hasFormalLogin ? (isEn ? 'Redeem membership code' : '兑换会员激活码') : (isEn ? 'Sign in to redeem' : '登录后兑换')}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-5 space-y-4 bg-slate-100/60 custom-scrollbar">
          
          {/* Tab 1: VIP Exclusives Focus */}
          {activeTab === 'vip' && (
            <div className="space-y-3">
              <div className="bg-gradient-to-r from-amber-50 via-purple-50/50 to-amber-50 border border-amber-200/80 rounded-2xl p-3.5 flex items-center justify-between gap-3 shadow-xs">
                <div>
                  <h4 className="text-sm font-black text-amber-900 flex items-center gap-1.5">
                    <Crown className="w-4 h-4 text-amber-500 fill-amber-500/20" />
                    <span>{isEn ? 'What VIP unlocks' : 'VIP 仅解锁这些权益'}</span>
                  </h4>
                  <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                    {isEn ? 'Core generation, sizes, palettes, bead saving and background removal use credits; VIP keeps watermark-free, batch, commercial and cloud benefits.' : '核心生成、尺寸、色卡、省豆和背景移除均可使用积分完成；VIP 只保留水印、批量、商用和云空间权益。'}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                <div className="rounded-xl border border-sky-100 bg-sky-50/60 p-2.5 shadow-xs"><b className="text-sky-900">30×30</b><span className="block text-slate-600">{isEn ? '1 credit' : '1 积分'}</span></div>
                <div className="rounded-xl border border-sky-100 bg-sky-50/60 p-2.5 shadow-xs"><b className="text-sky-900">52×52</b><span className="block text-slate-600">{isEn ? '≈ 3.1 credits' : '约 3.1 积分'}</span></div>
                <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-2.5 shadow-xs"><b className="text-emerald-900">{isEn ? 'Daily check-in' : '每日签到'}</b><span className="block text-slate-600">{isEn ? '≈ 40 credits' : '约 40 积分'}</span></div>
                <div className="rounded-xl border border-amber-100 bg-amber-50/60 p-2.5 shadow-xs"><b className="text-amber-900">{isEn ? 'Background removal' : '背景移除'}</b><span className="block text-slate-600">{isEn ? 'Free' : '免费'}</span></div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="bg-white rounded-2xl p-3.5 border border-purple-100 hover:border-purple-200 flex flex-col gap-2 relative overflow-hidden shadow-xs hover:shadow-sm transition-all">
                  <div className="flex items-center gap-2">
                    <span className="p-1.5 rounded-lg bg-emerald-50 text-emerald-600 font-bold border border-emerald-100">
                      <Download className="w-4 h-4" />
                    </span>
                    <div>
                      <h5 className="font-bold text-slate-900 text-xs">✨ 纯净无水印导出</h5>
                      <span className="text-[10px] text-amber-700 font-bold bg-amber-50 border border-amber-200 px-1.5 py-0.2 rounded-full">VIP 专享解锁</span>
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    一键关闭所有防盗水印，导出极净 2K/4K PNG 矢量拼豆图纸，支持纸质打印与顾客商用发货。
                  </p>
                </div>

                <div className="bg-white rounded-2xl p-3.5 border border-purple-100 hover:border-purple-200 flex flex-col gap-2 relative overflow-hidden shadow-xs hover:shadow-sm transition-all">
                  <div className="flex items-center gap-2">
                    <span className="p-1.5 rounded-lg bg-purple-50 text-purple-600 font-bold border border-purple-100">
                      <Store className="w-4 h-4" />
                    </span>
                    <div>
                      <h5 className="font-bold text-slate-900 text-xs">👑 自定义店铺防盗底纹</h5>
                      <span className="text-[10px] text-amber-700 font-bold bg-amber-50 border border-amber-200 px-1.5 py-0.2 rounded-full">VIP 专享解锁</span>
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    把防盗水印文字修改为您的【个人微信号】或【淘宝/小红书店铺名】，防止同行侵权盗用您的设计。
                  </p>
                </div>

                <div className="bg-white rounded-2xl p-3.5 border border-purple-100 hover:border-purple-200 flex flex-col gap-2 relative overflow-hidden shadow-xs hover:shadow-sm transition-all">
                  <div className="flex items-center gap-2">
                    <span className="p-1.5 rounded-lg bg-sky-50 text-sky-600 font-bold border border-sky-100">
                      <Zap className="w-4 h-4 fill-sky-500/20" />
                    </span>
                    <div>
                      <h5 className="font-bold text-slate-900 text-xs">⚡ 批量处理</h5>
                      <span className="text-[10px] text-amber-700 font-bold bg-amber-50 border border-amber-200 px-1.5 py-0.2 rounded-full">VIP 专享解锁</span>
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    一次处理多张图片或多个导出任务，适合批量制作与商用交付；单张图纸仍可用积分完成。
                  </p>
                </div>

                <div className="bg-white rounded-2xl p-3.5 border border-purple-100 hover:border-purple-200 flex flex-col gap-2 relative overflow-hidden shadow-xs hover:shadow-sm transition-all">
                  <div className="flex items-center gap-2">
                    <span className="p-1.5 rounded-lg bg-amber-50 text-amber-600 font-bold border border-amber-100">
                      <Grid2x2 className="w-4 h-4" />
                    </span>
                    <div>
                      <h5 className="font-bold text-slate-900 text-xs">🏷️ 商业授权支持</h5>
                      <span className="text-[10px] text-amber-700 font-bold bg-amber-50 border border-amber-200 px-1.5 py-0.2 rounded-full">VIP 专享解锁</span>
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    为商用图纸交付提供会员权益支持，具体授权范围以订单和平台规则为准。
                  </p>
                </div>

                <div className="bg-white rounded-2xl p-3.5 border border-purple-100 hover:border-purple-200 flex flex-col gap-2 relative overflow-hidden shadow-xs hover:shadow-sm transition-all">
                  <div className="flex items-center gap-2">
                    <span className="p-1.5 rounded-lg bg-rose-50 text-rose-600 font-bold border border-rose-100">
                      <Cloud className="w-4 h-4" />
                    </span>
                    <div>
                      <h5 className="font-bold text-slate-900 text-xs">☁️ 更大云端空间</h5>
                      <span className="text-[10px] text-amber-700 font-bold bg-amber-50 border border-amber-200 px-1.5 py-0.2 rounded-full">VIP 专享解锁</span>
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    保存更多可编辑图纸和资源，跨设备继续编辑；保存操作按页面提示消耗积分。
                  </p>
                </div>

                <div className="bg-white rounded-2xl p-3.5 border border-purple-100 hover:border-purple-200 flex flex-col gap-2 relative overflow-hidden shadow-xs hover:shadow-sm transition-all">
                  <div className="flex items-center gap-2">
                    <span className="p-1.5 rounded-lg bg-indigo-50 text-indigo-600 font-bold border border-indigo-100">
                      <Cloud className="w-4 h-4" />
                    </span>
                    <div>
                      <h5 className="font-bold text-slate-900 text-xs">📦 会员周额度</h5>
                      <span className="text-[10px] text-purple-700 font-bold bg-purple-50 border border-purple-200 px-1.5 py-0.2 rounded-full">VIP 附赠积分</span>
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    创作者会员每周 500 积分，商用会员每周 1500 积分；额度按周期发放，未使用部分按规则过期。
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Tab 2: Full Categorized Feature List */}
          {activeTab === 'all' && (
            <div className="space-y-4">
              {features.map((cat, idx) => (
                <div key={idx} className="bg-purple-50/30 rounded-2xl p-3.5 border border-purple-100 space-y-2.5">
                  <h4 className="text-xs font-black text-purple-900 flex items-center gap-1.5 border-b border-purple-100 pb-2">
                    <Sparkles className="w-3.5 h-3.5 text-purple-600" />
                    <span>{cat.category}</span>
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                    {cat.items.map((item, i) => (
                      <div key={i} className="p-2.5 rounded-xl bg-white border border-purple-100/70 flex items-start justify-between gap-2 shadow-xs">
                        <div className="space-y-0.5">
                          <div className="font-bold text-slate-900 flex items-center gap-1.5">
                            <span>{item.name}</span>
                          </div>
                          <p className="text-[11px] text-slate-500 leading-snug">{item.desc}</p>
                        </div>
                        {item.badge ? (
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-black shrink-0 ${
                            item.badge === 'Pro'
                              ? 'bg-purple-100 text-purple-800 border border-purple-300'
                              : 'bg-amber-100 text-amber-800 border border-amber-300'
                          }`}>
                            {item.badge}
                          </span>
                        ) : typeof item.free === 'string' ? (
                          <span className="px-1.5 py-0.5 bg-sky-50 text-sky-700 border border-sky-200 rounded-full text-[10px] font-semibold shrink-0">
                            {isEn ? item.free === '按积分' ? 'Credits' : item.free : item.free}
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full text-[10px] font-semibold shrink-0">
                            {isEn ? (item.free ? 'Included' : 'Unavailable') : (item.free ? '基础免费' : '不可用')}
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
            <div className="bg-white rounded-2xl border border-purple-100 overflow-hidden text-xs shadow-xs">
              <div className="grid grid-cols-12 bg-purple-50/70 p-3 font-bold text-slate-800 text-xs border-b border-purple-100">
                <div className="col-span-5">{isEn ? 'Feature Capability' : '功能与特权服务'}</div>
                <div className="col-span-2 text-center text-slate-500">{isEn ? 'Credits user' : '积分用户'}</div>
                <div className="col-span-2 text-center text-amber-800 font-extrabold">{isEn ? 'VIP Member' : '👑 VIP会员'}</div>
                <div className="col-span-3 text-center text-purple-800 font-extrabold">{isEn ? 'Merchant Pro' : '👑 商家Pro'}</div>
              </div>

              <div className="divide-y divide-purple-50">
                {features.flatMap(c => c.items).map((item, idx) => (
                  <div key={idx} className="grid grid-cols-12 p-3 items-center hover:bg-purple-50/30 transition-colors">
                    <div className="col-span-5 pr-2">
                      <div className="font-bold text-slate-900">{item.name}</div>
                      <div className="text-[10px] text-slate-500 line-clamp-1">{item.desc}</div>
                    </div>
                    <div className="col-span-2 text-center text-slate-500">
                      {typeof item.free === 'boolean' ? (
                        item.free ? <CheckCircle2 className="w-4 h-4 text-emerald-600 inline" /> : <XCircle className="w-4 h-4 text-slate-300 inline" />
                      ) : item.free}
                    </div>
                    <div className="col-span-2 text-center font-bold text-amber-800">
                      {typeof item.vip === 'boolean' ? (
                        item.vip ? <CheckCircle2 className="w-4 h-4 text-amber-600 inline" /> : <XCircle className="w-4 h-4 text-slate-300 inline" />
                      ) : item.vip}
                    </div>
                    <div className="col-span-3 text-center font-bold text-purple-800">
                      {typeof item.pro === 'boolean' ? (
                        item.pro ? <CheckCircle2 className="w-4 h-4 text-purple-600 inline" /> : <XCircle className="w-4 h-4 text-slate-300 inline" />
                      ) : item.pro}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>

        {/* Footer CTA */}
        <div className="p-3.5 sm:p-4 border-t border-purple-100 bg-purple-50/40 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="text-slate-500 text-xs text-center sm:text-left">
            <span>{isEn ? 'Credits are used at apply, cloud save, publish and protected export.' : '积分在应用结果、云端保存、发布和受保护导出时扣除；失败会自动释放。'}</span>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              onClick={onClose}
              className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold transition-colors cursor-pointer text-xs flex-1 sm:flex-none"
            >
              {isEn ? 'Close' : '暂不开通'}
            </button>
            <button
              onClick={() => {
                onClose();
                onOpenAuthModal();
              }}
              className="px-5 py-2 rounded-xl bg-gradient-to-r from-amber-500 via-amber-600 to-amber-500 hover:from-amber-600 hover:to-amber-700 text-white font-black text-xs shadow-md shadow-amber-500/20 flex items-center justify-center gap-1.5 cursor-pointer transition-all active:scale-95 flex-1 sm:flex-none whitespace-nowrap"
            >
              <Crown className="w-4 h-4 fill-current" />
              <span>{hasFormalLogin ? (isEn ? 'Redeem membership code' : '兑换会员激活码') : (isEn ? 'Sign in to redeem' : '登录后兑换')}</span>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
