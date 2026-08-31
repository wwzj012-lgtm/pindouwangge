import React, { createContext, useContext, useEffect, useState } from 'react';

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
    proTag: 'VIP',
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
    proMember: '商家 VIP',
    personalCenter: '个人中心',
    home: '首页', community: '豆社', studio: '画板', largeCanvas: '大画板', assembly: '立体拼豆', guideAction: '使用指南', vip: '会员', points: '积分', checkin: '签到', checkedIn: '已签到', loading: '加载中', loginCheckin: '登录签到', searchPlaceholder: '搜索作品、图纸、豆色...',

    // Smart Reducer
    reducerTitle: '特征保真智能省豆',
    reducerDesc: '按人物与图形特征保护轮廓、五官和关键色块：VIP 可选 15%/25%，商家 VIP 可选 40% 省豆。',
    reducerCompTitle: '为什么不只是缩放网格？',
    reducerCompBadTitle: '普通缩放：',
    reducerCompBadDesc: '会把每个区域简化为更少的格子，细线、边缘和高光可能损失。',
    reducerCompGoodTitle: '特征保留省豆：',
    reducerCompGoodDesc: '按目标豆子面积缩放，用边缘、区域占比与中心权重选择代表色；请在应用前对照预览确认。',
    reducerScaleTitle: '会员省豆目标',
    reducerScaleKeep: '保持原网格',
    reducerScaleKeepDesc: '不改变网格尺寸',
    reducerScale15: '省豆 15%',
    reducerScale15Desc: 'VIP 权益',
    reducerScale25: '省豆 25%',
    reducerScale25Desc: 'VIP 权益',
    reducerScale40: '省豆 40%',
    reducerScale40Desc: '商家 VIP 权益',
    reducerBgTitle: '智能抠除四周无用背景拼豆',
    reducerBgLabel: '抠除背景色 (底色设为透明, 不铺 background 豆)',
    reducerBgDesc: '自动识别人物/主体四周的单色背景，无需购买并平铺几千颗无用背景豆。',
    reducerIntensityTitle: '色彩区块平滑度与精简档位',
    reducerIntensityLight: '1档 · 微调精炼',
    reducerIntensityLightDesc: '仅清除分散游离噪点。',
    reducerIntensityMedium: '2档 · 标准推荐',
    reducerIntensityMediumDesc: '在平滑色块与主体特征之间取得平衡。',
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
    reducerSavingEst: '预计材料节省：',
    reducerSavingBenchmark: '* 备注计价基准：按市面常规 3 元 / 千粒补充包零售价测算。',
    cancel: '取消',
    reducerApplyVip: '应用减粒图纸到当前拼豆画布',
    reducerApplyTrial: '消耗 1 次新用户免费体验额度直接应用',
    reducerApplyUnlock: '登录或开通会员后应用',

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
    proTag: 'VIP',
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
    proMember: 'Merchant VIP',
    personalCenter: 'Account',
    home: 'Home', community: 'Community', studio: 'Studio', largeCanvas: 'Large canvas', assembly: '3D beads', guideAction: 'Guide', vip: 'VIP', points: 'points', checkin: 'Check in', checkedIn: 'Checked in', loading: 'Loading', loginCheckin: 'Sign in to check in', searchPlaceholder: 'Search works, patterns, colors...',

    // Smart Reducer
    reducerTitle: 'Feature-preserving smart bead saver',
    reducerDesc: 'Protect contours, facial features and signature colors: VIP saves 15%/25%; Merchant VIP unlocks 40%.',
    reducerCompTitle: 'Why not just resize the grid?',
    reducerCompBadTitle: 'Standard resizing:',
    reducerCompBadDesc: 'Fewer cells can lose fine lines, edges, and highlights.',
    reducerCompGoodTitle: 'Feature-aware reduction:',
    reducerCompGoodDesc: 'Scales by target bead area and chooses representative colors from edge, regional coverage, and centre weighting. Review the preview before applying.',
    reducerScaleTitle: 'Membership saving target',
    reducerScaleKeep: 'Keep 100% Original',
    reducerScaleKeepDesc: 'Keeps the current grid size',
    reducerScale15: 'Save 15%',
    reducerScale15Desc: 'VIP benefit',
    reducerScale25: 'Save 25%',
    reducerScale25Desc: 'VIP benefit',
    reducerScale40: 'Save 40%',
    reducerScale40Desc: 'Merchant VIP benefit',
    reducerBgTitle: 'Smart Outer Background Removal',
    reducerBgLabel: 'Remove Background Color (Set transparent, no background beads)',
    reducerBgDesc: 'Auto-detects flat background around the subject so you do not need to buy & place thousands of useless background beads.',
    reducerIntensityTitle: 'Color Patch Smoothing & Intensity Level',
    reducerIntensityLight: 'Level 1 · Refinement',
    reducerIntensityLightDesc: 'Only removes floating noise pixels.',
    reducerIntensityMedium: 'Level 2 · Standard',
    reducerIntensityMediumDesc: 'Balances color smoothing and subject features.',
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
    reducerSavingEst: 'Estimated material savings:',
    reducerSavingBenchmark: '* Note: Price calculated at estimated retail rate of $0.42 / 1000 beads supplementary pack.',
    cancel: 'Cancel',
    reducerApplyVip: 'Apply Optimized Pattern to Canvas',
    reducerApplyTrial: 'Use 1 Free Trial Credit to Apply',
    reducerApplyUnlock: 'Sign in or upgrade to apply',

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

  useEffect(() => {
    document.documentElement.lang = language === 'en' ? 'en' : 'zh-CN';
    document.documentElement.dataset.language = language;
  }, [language]);

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t, formatPrice, isEn }}>
      {children}
    </LanguageContext.Provider>
  );
};
