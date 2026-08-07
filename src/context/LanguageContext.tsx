import React, { createContext, useContext, useState } from 'react';

export type Language = 'zh' | 'en';

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
  formatPrice: (rmb: number) => string;
  isEn: boolean;
}

const translations: Record<Language, Record<string, string>> = {
  zh: {
    // Header
    appName: '豆织星格',
    proTag: 'PRO',
    selectBrand: '选择色卡品牌',
    pegboard: '拼豆板',
    guide: '指南',
    uploadImage: '上传图片',
    smartReduce: '智能减粒省豆',
    samples: '示例',
    openProject: '打开工程',
    saveProject: '保存工程',
    exportPattern: '导出图纸',
    clearCanvas: '清空画布',
    loginActivate: '登录/激活',
    vipMember: 'VIP 会员',
    proMember: '商家Pro',
    personalCenter: '个人中心',

    // Smart Reducer
    reducerTitle: '👑 VIP 专属 · 显著性智能省豆与精纯优化引擎',
    reducerDesc: '保持主图 100% 五官与细节原汁原味：抠除无用背景 + 净化悬空杂豆 + 连片色块平滑，省豆 20%~50%！',
    reducerCompTitle: '为什么远胜于简单调节网格宽高尺寸？(PRO 专属核心算法)',
    reducerCompBadTitle: '❌ 普通直接调节宽高尺寸：',
    reducerCompBadDesc: '等比例强制缩放整个盘面，会导致人物眼睛、眉毛、表情、高光与精致线稿变模糊失真甚至直接消失。',
    reducerCompGoodTitle: '✅ VIP 显著性智能省豆引擎：',
    reducerCompGoodDesc: '保持图纸 100% 原始网格像素与细节不变，通过 Sobel 边缘锁死五官，自动抠除四周无用背景豆（背景变 0 豆）、净化 1-3px 悬空杂豆，真正做到物超所值！',
    reducerScaleTitle: '图纸网格度数 (可选微调缩放)',
    reducerScaleKeep: '保持 100% 原网格',
    reducerScaleKeepDesc: '画质零损失',
    reducerScale15: '精简 -15% 度数',
    reducerScale15Desc: '拼豆数直降 ~28%',
    reducerScale30: '极致 -30% 度数',
    reducerScale30Desc: '拼豆数直降 ~50%',
    reducerBgTitle: '智能抠除四周无用背景拼豆',
    reducerBgLabel: '抠除背景色 (底色设为透明, 不铺 background 豆)',
    reducerBgDesc: '自动识别人物/主体四周的单色背景，无需购买并平铺几千颗无用背景豆。',
    reducerIntensityTitle: '色彩区块平滑度与精简档位',
    reducerIntensityLight: '1档 · 微调精炼',
    reducerIntensityLightDesc: '仅清除分散游离噪点。',
    reducerIntensityMedium: '2档 · 标准推荐',
    reducerIntensityMediumDesc: '平衡高画质，完美保持主体表情清晰。',
    reducerIntensityStrong: '3档 · 极简平滑',
    reducerIntensityStrongDesc: '强力合并近似颜色，图纸更具经典像素风。',
    reducerProtectTitle: '图像通用自适应细节保护机制',
    reducerProtectFeature: '五官与高反差轮廓锁死',
    reducerProtectVibrant: '💎 核心高饱和色彩纯净保护',
    reducerProtectNoise: '🧹 1-3px 悬空噪点清除',
    reducerProtectMinor: '🎨 压缩极低频零碎色卡',
    reducerProtectCrop: '✂️ 自动裁切边缘无豆空白盘',
    reducerOrigScheme: '标准原图方案 (未减粒)',
    reducerOptScheme: '智能减粒方案 (实测减豆)',
    reducerSaved: '省豆 -',
    reducerOrigTotal: '原始拼豆总数:',
    reducerOptTotal: '减粒后拼豆总数:',
    reducerUsePalette: '使用色卡:',
    reducerOptPalette: '精简色卡:',
    reducerSavingsItem1: '① 抠除背景 & 连片合并 (耗材省豆)',
    reducerSavingsItem1DescBefore: '抠除背景、合并连片，减少',
    reducerSavingsItem1DescAfter: '颗拼豆耗材',
    reducerSavingsItem2: '② 精简杂色色卡 (整包清退)',
    reducerSavingsItem2DescBefore: '色卡从',
    reducerSavingsItem2DescMiddle: '种精简至',
    reducerSavingsItem2DescAfter: '种，少购入',
    reducerSavingsItem2DescEnd: '整包杂色拼豆',
    reducerSavingEst: 'PRO VIP 预计总节省：',
    reducerSavingBenchmark: '* 备注计价基准：按市面常规 3 元 / 千粒补充包零售价测算。',
    cancel: '取消',
    reducerApplyVip: '应用减粒图纸到当前拼豆画布',
    reducerApplyTrial: '消耗 1 次新用户免费体验额度直接应用',
    reducerApplyUnlock: '解锁 PRO VIP 权限 / 激活卡密应用',

    // Stats panel
    statsTitle: '📊 实时物料清单与拼豆成本核算大盘',
    statsSub: '精准定位各色号拼豆需求，一键省豆与防盗水印导出',
    statsTotalBeads: '盘面拼豆颗粒总数',
    statsColorsUsed: '图纸已用色卡品种',
    statsEmptyPegs: '盘面空置插槽数量',
    statsTotalPacks: '预计需要补充整包',
    statsRmbValue: '采购拼豆预计支出花费',
  },
  en: {
    // Header
    appName: 'BeadGrid',
    proTag: 'PRO',
    selectBrand: 'Select Palette Brand',
    pegboard: 'Pegboard',
    guide: 'Guide',
    uploadImage: 'Upload Image',
    smartReduce: 'Smart Reducer',
    samples: 'Samples',
    openProject: 'Open Project',
    saveProject: 'Save Project',
    exportPattern: 'Export Pattern',
    clearCanvas: 'Clear Canvas',
    loginActivate: 'Login / Redeem',
    vipMember: 'VIP Member',
    proMember: 'Merchant Pro',
    personalCenter: 'Account',

    // Smart Reducer
    reducerTitle: '👑 VIP Only · Saliency Smart Bead Saver & Optimization Engine',
    reducerDesc: 'Keep 100% facial features & details intact: Remove background + clear floating beads + color patch smoothing, save 20%-50% beads!',
    reducerCompTitle: 'Why is this far superior to simple grid resizing? (PRO Core Algorithm)',
    reducerCompBadTitle: '❌ Standard Grid Resizing:',
    reducerCompBadDesc: 'Enforces proportional scaling of the whole board, causing fine details like eyes, eyebrows, facial expressions, highlights, and fine lineart to become blurry or disappear.',
    reducerCompGoodTitle: '✅ VIP Saliency Smart Bead Saver:',
    reducerCompGoodDesc: 'Keeps 100% original grid pixels & fine details intact. Protects facial features using Sobel edge-lock, automatically removes outer background beads (transparent background), and cleans 1-3px floaters, saving materials!',
    reducerScaleTitle: 'Grid Resolution Scaling (Optional)',
    reducerScaleKeep: 'Keep 100% Original',
    reducerScaleKeepDesc: 'Zero loss in quality',
    reducerScale15: 'Reduce -15% Grid',
    reducerScale15Desc: 'Saves ~28% beads',
    reducerScale30: 'Extreme -30% Grid',
    reducerScale30Desc: 'Saves ~50% beads',
    reducerBgTitle: 'Smart Outer Background Removal',
    reducerBgLabel: 'Remove Background Color (Set transparent, no background beads)',
    reducerBgDesc: 'Auto-detects flat background around the subject so you do not need to buy & place thousands of useless background beads.',
    reducerIntensityTitle: 'Color Patch Smoothing & Intensity Level',
    reducerIntensityLight: 'Level 1 · Refinement',
    reducerIntensityLightDesc: 'Only removes floating noise pixels.',
    reducerIntensityMedium: 'Level 2 · Standard',
    reducerIntensityMediumDesc: 'Balances high quality while keeping subject expressions pristine.',
    reducerIntensityStrong: 'Level 3 · Pixel Flat',
    reducerIntensityStrongDesc: 'Aggressively merges colors for a classic, clean retro pixel look.',
    reducerProtectTitle: 'Adaptive Detail Protection Mechanism',
    reducerProtectFeature: 'Lock Features & High-Contrast Contours',
    reducerProtectVibrant: '💎 Vibrant Accent Color Protection',
    reducerProtectNoise: '🧹 Clear 1-3px Floating Noise',
    reducerProtectMinor: '🎨 Compress Low-Frequency Colors',
    reducerProtectCrop: '✂️ Auto-Crop Empty Border Padding',
    reducerOrigScheme: 'Standard Original Pattern (Unreduced)',
    reducerOptScheme: 'Smart Reduced Pattern (Optimized)',
    reducerSaved: 'Saved -',
    reducerOrigTotal: 'Original Beads:',
    reducerOptTotal: 'Reduced Beads:',
    reducerUsePalette: 'Colors Used:',
    reducerOptPalette: 'Reduced Colors:',
    reducerSavingsItem1: '① Remove Background & Merge Patches (Material)',
    reducerSavingsItem1DescBefore: 'Background removal and color smoothing saves',
    reducerSavingsItem1DescAfter: 'beads',
    reducerSavingsItem2: '② Streamline Accessory Colors (Pack Refunding)',
    reducerSavingsItem2DescBefore: 'Reduces color variety from',
    reducerSavingsItem2DescMiddle: 'to',
    reducerSavingsItem2DescAfter: 'colors, saving you from buying',
    reducerSavingsItem2DescEnd: 'individual retail packs',
    reducerSavingEst: 'PRO VIP Total USD Saved:',
    reducerSavingBenchmark: '* Note: Price calculated at estimated retail rate of $0.42 / 1000 beads supplementary pack.',
    cancel: 'Cancel',
    reducerApplyVip: 'Apply Optimized Pattern to Canvas',
    reducerApplyTrial: 'Use 1 Free Trial Credit to Apply',
    reducerApplyUnlock: 'Unlock PRO VIP / Redeem Card to Apply',

    // Stats panel
    statsTitle: '📊 Live Material Checklist & Perler Cost Valuation Panel',
    statsSub: 'Track bead demands for each color code, optimize materials, and export watermark-free patterns',
    statsTotalBeads: 'Total Bead Count on Board',
    statsColorsUsed: 'Different Color Codes Used',
    statsEmptyPegs: 'Remaining Empty Pegboard Pins',
    statsTotalPacks: 'Estimated Full Packs Needed',
    statsRmbValue: 'Estimated Total Purchase Expense',
  }
};

const exchangeRate = 7.2; // 1 USD = 7.2 CNY

const LanguageContext = createContext<LanguageContextType>({
  language: 'zh',
  setLanguage: () => {},
  t: (key) => key,
  formatPrice: (rmb) => `¥${rmb}`,
  isEn: false,
});

export const useLanguage = () => useContext(LanguageContext);

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<Language>(() => {
    const saved = localStorage.getItem('dzxg_language');
    if (saved === 'en' || saved === 'zh') return saved;
    return 'zh';
  });

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem('dzxg_language', lang);
  };

  const t = (key: string): string => {
    return translations[language]?.[key] || translations['zh']?.[key] || key;
  };

  const formatPrice = (rmb: number): string => {
    if (language === 'en') {
      const usd = rmb / exchangeRate;
      return `$${usd.toFixed(2)}`;
    }
    return `¥${rmb.toFixed(1)}元`;
  };

  const isEn = language === 'en';

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t, formatPrice, isEn }}>
      {children}
    </LanguageContext.Provider>
  );
};
