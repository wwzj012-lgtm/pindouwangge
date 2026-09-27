import React, { useRef, useState, useMemo } from 'react';
import {
  Sparkles,
  Image as ImageIcon,
  Palette,
  Compass,
  FileDown,
  ArrowRight,
  Zap,
  Grid2X2,
  Wand2,
  Layers,
  CheckCircle2,
  Sliders,
  Flame,
  Volume2,
  VolumeX,
  Clock,
  Weight,
  Ruler,
  Paintbrush,
  Eraser,
  PaintBucket,
  Trash2,
  RotateCcw,
  ExternalLink,
  MousePointerClick,
  ChevronDown,
  ShieldCheck,
  Printer,
  Boxes,
  Heart,
  Grid,
  User,
} from 'lucide-react';
import { consumeSelectedImageFile } from '../utils/imageFileSelection';

export interface HeroExample {
  id: 'batiao-cat' | 'boss-xiaoxin' | 'spiderman' | 'chibi-character';
  name: string;
  url: string;
}

export const HERO_EXAMPLES: readonly HeroExample[] = [
  { id: 'batiao-cat', name: '八条猫', url: '/images/batiao-cat.webp' },
  { id: 'boss-xiaoxin', name: '霸总小新', url: '/images/boss-xiaoxin.jpg' },
  { id: 'spiderman', name: '蜘蛛侠', url: '/images/spiderman.webp' },
  { id: 'chibi-character', name: 'Q版人物', url: '/images/chibi-character.jpg' },
];

// Compatibility exports used by existing landing tests and integrations.
export const LANDING_SHOWCASE = HERO_EXAMPLES.slice(0, 3);
export const LANDING_CAPABILITIES = [
  { title: '智能转拼豆' },
  { title: '精准配色' },
  { title: '自由画板' },
  { title: '立体组合' },
] as const;

export function createHeroExampleActivation(
  example: HeroExample,
  onLoadHeroExample: (example: HeroExample) => void,
): () => void {
  return () => onLoadHeroExample(example);
}

export interface LandingViewProps {
  onNavigateTab?: (tab: 'home' | 'community' | 'studio' | 'largeCanvas') => void;
  onStartPhotoToBead?: (file: File) => void;
  onLoadHeroExample?: (example: HeroExample) => void;
  onImportPattern?: () => void;
  onEnterWorkspace?: () => void;
  onExploreCommunity?: () => void;
  onOpenAuthModal?: () => void;
  onOpenUserProfileModal?: () => void;
}

export type HomeViewProps = LandingViewProps;

// Preset Pixel Bead Art Patterns for the Interactive Live Canvas
type PresetKey = 'cat' | 'rocket' | 'heart' | 'star' | 'sword';

const PIXEL_PATTERNS: Record<PresetKey, { name: string; icon: string; grid: string[] }> = {
  cat: {
    name: '八条猫',
    icon: '🐱',
    grid: [
      '. . . . B B . . . . B B . . . .',
      '. . . B O O B . . B O O B . . .',
      '. . . B O O O B B O O O B . . .',
      '. . B O O O O O O O O O O B . .',
      '. B O W W O O O O O O W W O B .',
      '. B O W B O O O O O O B W O B .',
      '. B O O O O R R O O O O O O B .',
      '. B O O O R R R R O O O O O B .',
      '. . B O O O O B B O O O O B . .',
      '. . . B O O O W W O O O B . . .',
      '. . . B O O O O O O O O B . . .',
      '. . B O O B B B B B B O O B . .',
      '. B O O B W W W W W W B O O B .',
      '. B O B W W W W W W W W B O B .',
      '. . B B W W W W W W W W B B . .',
      '. . . B B B B B B B B B B . . .',
    ],
  },
  rocket: {
    name: '星球火箭',
    icon: '🚀',
    grid: [
      '. . . . . . . B B . . . . . . .',
      '. . . . . . B R R B . . . . . .',
      '. . . . . . B R R B . . . . . .',
      '. . . . . B W W W W B . . . . .',
      '. . . . . B W C C W B . . . . .',
      '. . . . . B W C C W B . . . . .',
      '. . . . . B W W W W B . . . . .',
      '. . . . . B P P P P B . . . . .',
      '. . . . . B P P P P B . . . . .',
      '. . . . . B W W W W B . . . . .',
      '. . . . B R B W W B R B . . . .',
      '. . . B R R B W W B R R B . . .',
      '. . B R R B . B B . B R R B . .',
      '. . . B B . B O O B . B B . . .',
      '. . . . . . B Y Y B . . . . . .',
      '. . . . . . . B B . . . . . . .',
    ],
  },
  heart: {
    name: '像素心形',
    icon: '💎',
    grid: [
      '. . . . . . . . . . . . . . . .',
      '. . B B B . . . . . B B B . . .',
      '. B F F F B . . . B F F F B . .',
      'B F W W F F B . B F F F F F B .',
      'B F W F F F F B F F F F F F B .',
      'B F F F F F F F F F F F F F B .',
      'B F F F F F F F F F F F F F B .',
      '. B F F F F F F F F F F F B . .',
      '. . B F F F F F F F F F B . . .',
      '. . . B F F F F F F F B . . . .',
      '. . . . B F F F F F B . . . . .',
      '. . . . . B F F F B . . . . . .',
      '. . . . . . B F B . . . . . . .',
      '. . . . . . . B . . . . . . . .',
      '. . . . . . . . . . . . . . . .',
      '. . . . . . . . . . . . . . . .',
    ],
  },
  star: {
    name: '游戏星格',
    icon: '🎮',
    grid: [
      '. . . . . . . B B . . . . . . .',
      '. . . . . . B Y Y B . . . . . .',
      '. . . . . . B Y Y B . . . . . .',
      '. . . . . B Y Y Y Y B . . . . .',
      '. B B B B Y Y Y Y Y Y B B B B .',
      '. B Y Y Y Y Y Y Y Y Y Y Y Y B .',
      '. . B Y B W Y Y Y Y W B Y B . .',
      '. . B Y B B Y Y Y Y B B Y B . .',
      '. . . B Y Y Y Y Y Y Y Y B . . .',
      '. . . B Y B B B B Y Y B . . .',
      '. . . B Y B Y Y Y Y B Y B . . .',
      '. . B Y B . B Y Y B . B Y B . .',
      '. . B Y B . B Y Y B . B Y B . .',
      '. B Y B . . . B B . . . B Y B .',
      '. B B . . . . . . . . . . B B .',
      '. . . . . . . . . . . . . . . .',
    ],
  },
  sword: {
    name: '勇者像素剑',
    icon: '⚔️',
    grid: [
      '. . . . . . . . . . . . . B B .',
      '. . . . . . . . . . . . B C W B',
      '. . . . . . . . . . . B C W B .',
      '. . . . . . . . . . B C W B . .',
      '. . . . . . . . . B C W B . . .',
      '. . . . . . . . B C W B . . . .',
      '. . . . . . . B C W B . . . . .',
      '. . . . . . B C W B . . . . . .',
      '. . . . . B C W B . . . . . . .',
      '. . . B B B W B . . . . . . . .',
      '. . B P P B B . . . . . . . . .',
      '. B P P P P B . . . . . . . . .',
      '. B B P P B . . . . . . . . . .',
      '. . . B B Y B . . . . . . . . .',
      '. . . . . B B . . . . . . . . .',
      '. . . . . . . . . . . . . . . .',
    ],
  },
};

const COLOR_MAP: Record<string, { hex: string; code: string; name: string }> = {
  P: { hex: '#9333ea', code: 'PER-01', name: '浅紫' },
  F: { hex: '#ec4899', code: 'PER-08', name: '樱花粉' },
  Y: { hex: '#f59e0b', code: 'PER-15', name: '柠檬黄' },
  W: { hex: '#ffffff', code: 'PER-02', name: '珍珠白' },
  B: { hex: '#2e1065', code: 'PER-99', name: '轮廓黑' },
  C: { hex: '#06b6d4', code: 'ART-12', name: '冰霜蓝' },
  O: { hex: '#f97316', code: 'ART-05', name: '活力橙' },
  R: { hex: '#f43f5e', code: 'MID-22', name: '胭脂红' },
};

// Web Audio API Sound Synthesizers
const playBeadPopSound = () => {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(650, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(140, ctx.currentTime + 0.07);

    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.07);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.07);
  } catch {
    // Audio autoplay fallback
  }
};

const playIroningSound = () => {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const bufferSize = ctx.sampleRate * 0.35;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1500, ctx.currentTime);
    filter.frequency.linearRampToValueAtTime(350, ctx.currentTime + 0.35);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    noise.start();
  } catch {
    // Fallback
  }
};

const playAIScanSound = () => {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(440, ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(880, ctx.currentTime + 0.2);

    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.2);
  } catch {
    // Fallback
  }
};

export const LandingView: React.FC<LandingViewProps> = ({
  onNavigateTab,
  onStartPhotoToBead,
  onLoadHeroExample,
  onImportPattern,
  onEnterWorkspace,
  onOpenAuthModal,
  onOpenUserProfileModal,
}) => {
  const navigateTab = onNavigateTab ?? ((tab: 'home' | 'community' | 'studio' | 'largeCanvas') => {
    const route = tab === 'community'
      ? '/workspace?tab=community'
      : tab === 'largeCanvas'
        ? '/large-canvas'
        : '/workspace?tab=studio';
    window.history.pushState({}, '', route);
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  const startPhotoToBead = onStartPhotoToBead ?? (() => undefined);
  const loadHeroExample = onLoadHeroExample ?? (() => undefined);
  const importPattern = onImportPattern ?? (() => undefined);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const choosePhoto = () => photoInputRef.current?.click();

  // Interactive Live Canvas States
  const [activePresetKey, setActivePresetKey] = useState<PresetKey>('cat');
  const [beadStyle, setBeadStyle] = useState<'ring' | 'melted'>('ring');
  const [showPegboard, setShowPegboard] = useState<boolean>(true);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [selectedColorKey, setSelectedColorKey] = useState<string>('P');
  const [drawingTool, setDrawingTool] = useState<'brush' | 'bucket' | 'eraser'>('brush');
  const [hoveredCell, setHoveredCell] = useState<{ r: number; c: number; char: string } | null>(null);
  const [highlightedColorChar, setHighlightedColorChar] = useState<string | null>(null);

  // Drawing Drag State
  const [isMouseDown, setIsMouseDown] = useState<boolean>(false);

  // Animation States
  const [isIroning, setIsIroning] = useState<boolean>(false);
  const [isAIScanning, setIsAIScanning] = useState<boolean>(false);
  const [ironSuccessMsg, setIronSuccessMsg] = useState<string | null>(null);

  // Allow user edits on the canvas
  const [customGrids, setCustomGrids] = useState<Record<PresetKey, string[][]>>(() => {
    const initial: Record<string, string[][]> = {};
    for (const key of Object.keys(PIXEL_PATTERNS) as PresetKey[]) {
      initial[key] = PIXEL_PATTERNS[key].grid.map(row => row.split(' '));
    }
    return initial as Record<PresetKey, string[][]>;
  });

  const activeGrid = customGrids[activePresetKey];

  // Cell drawing algorithm (brush, eraser, bucket fill)
  const applyCellAction = (r: number, c: number) => {
    const fillChar = drawingTool === 'eraser' ? '.' : selectedColorKey;

    if (drawingTool === 'bucket') {
      const targetChar = activeGrid[r][c];
      if (targetChar === fillChar) return;

      const nextGrid = activeGrid.map(row => [...row]);
      const queue: [number, number][] = [[r, c]];
      const visited = new Set<string>();

      while (queue.length > 0) {
        const [cr, cc] = queue.pop()!;
        const key = `${cr},${cc}`;
        if (visited.has(key)) continue;
        visited.add(key);

        if (cr < 0 || cr >= 16 || cc < 0 || cc >= 16) continue;
        if (nextGrid[cr][cc] === targetChar) {
          nextGrid[cr][cc] = fillChar;
          queue.push([cr + 1, cc], [cr - 1, cc], [cr, cc + 1], [cr, cc - 1]);
        }
      }

      setCustomGrids(prev => ({ ...prev, [activePresetKey]: nextGrid }));
      if (soundEnabled) playBeadPopSound();
    } else {
      // Brush / Eraser
      if (activeGrid[r][c] === fillChar) return;
      setCustomGrids(prev => {
        const nextGrid = prev[activePresetKey].map((row, ri) =>
          row.map((cell, ci) => (ri === r && ci === c ? fillChar : cell))
        );
        return { ...prev, [activePresetKey]: nextGrid };
      });
      if (soundEnabled) playBeadPopSound();
    }
  };

  const handleClearCanvas = () => {
    const emptyRow = Array(16).fill('.');
    const emptyGrid = Array(16).fill(emptyRow);
    setCustomGrids(prev => ({ ...prev, [activePresetKey]: emptyGrid }));
  };

  const handleResetPattern = () => {
    const orig = PIXEL_PATTERNS[activePresetKey].grid.map(row => row.split(' '));
    setCustomGrids(prev => ({ ...prev, [activePresetKey]: orig }));
  };

  // Trigger High-Tech Virtual Heat Pressing (Ironing)
  const triggerHeatPress = () => {
    if (isIroning) return;
    setIsIroning(true);
    if (soundEnabled) playIroningSound();

    setTimeout(() => {
      setBeadStyle('melted');
      setIsIroning(false);
      setIronSuccessMsg('🔥 热压烫豆完成 · 像素深度融合 98%');
      setTimeout(() => setIronSuccessMsg(null), 3000);
    }, 1000);
  };

  // Trigger AI Quantum Re-assembly Scanline
  const triggerAIScan = () => {
    if (isAIScanning) return;
    setIsAIScanning(true);
    if (soundEnabled) playAIScanSound();

    const keys = Object.keys(PIXEL_PATTERNS) as PresetKey[];
    const nextIdx = (keys.indexOf(activePresetKey) + 1) % keys.length;

    setTimeout(() => {
      setActivePresetKey(keys[nextIdx]);
      setIsAIScanning(false);
    }, 800);
  };

  const scrollToLiveCanvas = () => {
    const el = document.getElementById('live-canvas-section');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const scrollToFeatures = () => {
    const el = document.getElementById('capabilities');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const scrollToProcess = () => {
    const el = document.getElementById('workflow');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const scrollToShowcase = () => {
    const el = document.getElementById('showcase');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  // Compute live bead stats for the active artwork
  const beadStats = useMemo(() => {
    let totalBeads = 0;
    const counts: Record<string, number> = {};
    activeGrid.forEach(row => {
      row.forEach(cell => {
        if (cell !== '.') {
          totalBeads++;
          counts[cell] = (counts[cell] || 0) + 1;
        }
      });
    });

    const topColors = Object.entries(counts)
      .map(([char, count]) => ({ char, count, ...COLOR_MAP[char] }))
      .sort((a, b) => b.count - a.count);

    const estMinutes = Math.max(5, Math.ceil(totalBeads * 0.12));
    const estWeightGram = (totalBeads * 0.035).toFixed(1);

    return { totalBeads, topColors, estMinutes, estWeightGram };
  }, [activeGrid]);

  return (
    <div
      onMouseUp={() => setIsMouseDown(false)}
      className="relative flex-1 overflow-y-auto bg-homepage-mesh min-h-screen text-purple-950 pb-20 select-none"
    >
      {/* Aesthetic Floating Ambient Background Light Orbs */}
      <div className="absolute top-10 left-1/4 w-[500px] h-[500px] bg-purple-300/25 rounded-full blur-[120px] pointer-events-none -z-10" />
      <div className="absolute top-1/3 right-10 w-[450px] h-[450px] bg-pink-300/20 rounded-full blur-[130px] pointer-events-none -z-10" />
      <div className="absolute bottom-1/4 left-10 w-[600px] h-[600px] bg-indigo-200/20 rounded-full blur-[140px] pointer-events-none -z-10" />

      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={event => {
          const file = consumeSelectedImageFile(event.target);
          if (file) startPhotoToBead(file);
        }}
      />

      {/* Standalone Product Homepage Header Navbar */}
      <header className="sticky top-0 z-50 bg-white/85 backdrop-blur-xl border-b border-purple-100/90 shadow-2xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 sm:h-20 flex items-center justify-between">
          {/* Brand Logo & Title */}
          <div
            className="flex items-center gap-3 cursor-pointer group"
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          >
            <img
              src="/douzhixingge_logo.svg"
              alt="豆织星格"
              className="w-9 h-9 sm:w-10 sm:h-10 object-contain transition-transform group-hover:scale-105"
            />
            <div>
              <div className="flex items-center gap-2">
                <span className="text-base sm:text-lg font-black tracking-tight text-purple-950">
                  豆织<span className="text-indigo-600">星格</span>
                </span>
                <span className="px-2 py-0.5 rounded-full bg-purple-100 text-purple-800 text-[10px] font-black uppercase tracking-wider">
                  BEADGRID OS
                </span>
              </div>
              <p className="text-[10px] text-purple-700/80 font-bold hidden sm:block">
                智能拼豆图纸创作与 3D 触觉平台
              </p>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="hidden md:flex items-center gap-6 text-xs sm:text-sm font-extrabold text-purple-900/80">
            <button
              type="button"
              onClick={scrollToFeatures}
              className="hover:text-purple-700 transition-colors cursor-pointer"
            >
              能力
            </button>
            <button
              type="button"
              onClick={scrollToShowcase}
              className="hover:text-purple-700 transition-colors cursor-pointer"
            >
              作品
            </button>
            <button
              type="button"
              onClick={scrollToProcess}
              className="hover:text-purple-700 transition-colors cursor-pointer"
            >
              流程
            </button>
            <button
              type="button"
              onClick={scrollToLiveCanvas}
              className="hover:text-purple-700 transition-colors cursor-pointer flex items-center gap-1 text-purple-700 font-black"
            >
              <Sparkles className="w-3.5 h-3.5 text-purple-600" />
              <span>LIVE 画板</span>
            </button>
          </nav>

          {/* Right Action CTA */}
          <div className="flex items-center gap-2.5">
            {onOpenAuthModal && (
              <button
                type="button"
                onClick={onOpenAuthModal}
                className="hidden sm:flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold text-purple-900 bg-purple-50 hover:bg-purple-100 border border-purple-200/80 transition-all cursor-pointer"
              >
                <User className="w-3.5 h-3.5 text-purple-600" />
                <span>登录 / 注册</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => navigateTab('studio')}
              className="px-4 py-2 sm:px-5 sm:py-2.5 rounded-xl bg-gradient-to-r from-purple-600 via-indigo-600 to-fuchsia-600 hover:brightness-110 text-white font-black text-xs sm:text-sm shadow-md shadow-purple-500/20 transition-all flex items-center gap-2 cursor-pointer"
            >
              <Wand2 className="w-4 h-4 text-amber-300" />
              <span>进入工作台</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <div className="max-w-7xl w-full mx-auto px-3 sm:px-6 lg:px-8 py-6 sm:py-10 space-y-12 sm:space-y-16">

        {/* 1. PRODUCT HERO SECTION - STANDALONE SAAS LANDING BANNER */}
        <div className="relative rounded-3xl bg-white/95 backdrop-blur-xl border border-purple-200/90 p-6 sm:p-10 lg:p-12 shadow-2xl shadow-purple-900/5 overflow-hidden">
          {/* Ambient Decorative Background Glows */}
          <div className="absolute -top-32 -right-32 w-96 h-96 bg-purple-300/20 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-32 -left-32 w-96 h-96 bg-pink-300/20 rounded-full blur-3xl pointer-events-none" />

          <div className="relative z-10 grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">

            {/* Left Column: Headline, Brand Copy & Actions */}
            <div className="lg:col-span-7 space-y-5 sm:space-y-6">
              {/* Product Badge */}
              <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-purple-100/90 border border-purple-200 text-xs font-black text-purple-900 shadow-2xs">
                <Sparkles className="w-3.5 h-3.5 text-purple-600" />
                <span>2026 旗舰级拼豆创意 OS · 智能像素图纸工作台</span>
              </div>

              {/* Main Headline */}
              <div className="space-y-1">
                <h1 className="text-3xl sm:text-5xl lg:text-6xl font-black tracking-tight leading-tight text-purple-950">
                  把灵感，织成
                </h1>
                <h1 className="text-3xl sm:text-5xl lg:text-6xl font-black tracking-tight leading-tight bg-gradient-to-r from-purple-700 via-fuchsia-600 to-pink-600 bg-clip-text text-transparent">
                  一格一格的星光
                </h1>
              </div>

              {/* Subtitle Description */}
              <p className="text-sm sm:text-base lg:text-lg text-purple-800/80 font-medium leading-relaxed max-w-2xl">
                一张照片，秒变精准可拼装的拼豆图纸。豆织星格整合 CIEDE2000 色卡匹配算法、3D 触觉画板、智能拼板分块与高清矢量物料单导出，开启全新手作设计体验。
              </p>

              {/* Primary Call to Actions */}
              <div className="flex flex-wrap items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => navigateTab('studio')}
                  className="px-6 py-3.5 sm:px-8 sm:py-4 rounded-2xl bg-gradient-to-r from-purple-600 via-indigo-600 to-fuchsia-600 hover:brightness-110 text-white font-black text-sm shadow-lg shadow-purple-500/25 transition-all flex items-center gap-2.5 cursor-pointer"
                >
                  <Wand2 className="w-5 h-5 text-amber-300 fill-amber-300" />
                  <span>免费开始创作</span>
                  <ArrowRight className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  onClick={scrollToLiveCanvas}
                  className="px-5 py-3.5 sm:px-7 sm:py-4 rounded-2xl bg-gradient-to-r from-purple-100 to-pink-100 hover:from-purple-200 hover:to-pink-200 border border-purple-300/80 text-purple-900 font-extrabold text-sm shadow-xs transition-colors flex items-center gap-2 cursor-pointer"
                >
                  <MousePointerClick className="w-4 h-4 text-purple-700" />
                  <span>体验 LIVE 互动画板</span>
                  <ChevronDown className="w-4 h-4 text-purple-600" />
                </button>

                <button
                  type="button"
                  onClick={() => navigateTab('community')}
                  className="px-5 py-3.5 sm:px-6 sm:py-4 rounded-2xl bg-white border border-purple-200 hover:bg-purple-50 text-purple-900 font-extrabold text-sm shadow-2xs transition-colors flex items-center gap-2 cursor-pointer"
                >
                  <Compass className="w-4 h-4 text-purple-600" />
                  <span>浏览社区图纸</span>
                </button>
              </div>

              {/* Key Trust & Metric Badges */}
              <div className="pt-4 border-t border-purple-100 grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs font-extrabold text-purple-900/80">
                <div className="flex items-center gap-2 p-2 rounded-xl bg-purple-50/70">
                  <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>100% 本地计算 (隐私安全)</span>
                </div>
                <div className="flex items-center gap-2 p-2 rounded-xl bg-purple-50/70">
                  <Palette className="w-4 h-4 text-purple-600 shrink-0" />
                  <span>12+ 国际品牌色卡算法</span>
                </div>
                <div className="flex items-center gap-2 p-2 rounded-xl bg-purple-50/70 col-span-2 sm:col-span-1">
                  <Printer className="w-4 h-4 text-pink-600 shrink-0" />
                  <span>1:1 打印与矢量 BOM</span>
                </div>
              </div>
            </div>

            {/* Right Column: Hero Showcase Interactive Card Preview */}
            <div className="lg:col-span-5 flex justify-center lg:justify-end">
              <div
                onClick={scrollToLiveCanvas}
                className="w-full max-w-md rounded-3xl bg-gradient-to-br from-purple-900 via-indigo-950 to-purple-950 p-6 text-white shadow-2xl shadow-purple-950/20 border border-purple-700/50 relative overflow-hidden group cursor-pointer hover:border-purple-400 transition-colors"
              >
                {/* Glowing Background FX */}
                <div className="absolute top-0 right-0 w-48 h-48 bg-pink-500/20 rounded-full blur-2xl group-hover:bg-pink-500/30 transition-colors pointer-events-none" />

                <div className="relative z-10 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                      <span className="text-xs font-black tracking-wider uppercase text-purple-200">
                        ⚡ LIVE CANVAS 互动画板
                      </span>
                    </div>
                    <span className="text-[10px] font-mono font-bold bg-white/10 px-2.5 py-1 rounded-full border border-white/20">
                      实时微观触感
                    </span>
                  </div>

                  {/* Pixel Art Mini Preview Grid */}
                  <div className="aspect-16/10 rounded-2xl bg-white/10 border border-white/20 backdrop-blur-md p-3 flex items-center justify-center relative overflow-hidden group-hover:bg-white/15 transition-colors">
                    <div className="grid grid-cols-16 gap-0.5 w-full max-w-[220px]">
                      {PIXEL_PATTERNS.cat.grid.map((row, r) =>
                        row.split(' ').map((cellChar, c) => (
                          <div
                            key={`${r}-${c}`}
                            className={`aspect-square rounded-full ${
                              cellChar !== '.' ? 'shadow-xs' : 'bg-white/5'
                            }`}
                            style={
                              cellChar !== '.'
                                ? { backgroundColor: COLOR_MAP[cellChar]?.hex || '#fff' }
                                : undefined
                            }
                          />
                        ))
                      )}
                    </div>

                    <div className="absolute inset-0 bg-gradient-to-t from-purple-950/90 via-purple-950/20 to-transparent flex flex-col justify-end p-3 text-center">
                      <p className="text-xs font-black text-amber-300 flex items-center justify-center gap-1">
                        <span>👇 点击体验下方 3D 触觉互动画板</span>
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs font-extrabold text-purple-200 pt-1">
                    <span className="flex items-center gap-1 text-purple-300">
                      <span>支持圆珠/融豆</span>
                      <span>•</span>
                      <span>热压烫豆</span>
                    </span>
                    <span className="text-amber-300 flex items-center gap-1 group-hover:translate-x-1 transition-transform">
                      <span>进入画板</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </span>
                  </div>
                </div>
              </div>
            </div>

          </div>
        </div>

        {/* 2. STANDALONE "LIVE CANVAS" SHOWCASE SECTION (独立旗舰互动画板) */}
        <section
          id="live-canvas-section"
          className="relative rounded-3xl bg-white/90 backdrop-blur-xl border-2 border-purple-200 p-4 sm:p-6 lg:p-8 shadow-2xl shadow-purple-900/10 space-y-6 overflow-hidden"
        >
          {/* Section Header */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-purple-100 pb-5">
            <div className="space-y-1">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-purple-100 text-purple-800 text-xs font-extrabold">
                <Sparkles className="w-3.5 h-3.5 text-purple-600" />
                <span>⚡ LIVE CANVAS SHOWCASE · 极客实时拼豆画板</span>
              </div>
              <h2 className="text-xl sm:text-3xl font-black text-purple-950 tracking-tight">
                微观触感拼豆交互工作台
              </h2>
              <p className="text-xs sm:text-sm text-purple-800/80 font-medium">
                体验 1:1 物理针板底座、3D 立体圆珠与融豆质感、ASMR 点击声效、虚拟热压烫豆与 AI 重组。
              </p>
            </div>

            {/* Global Quick Toggles */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setBeadStyle(s => (s === 'ring' ? 'melted' : 'ring'))}
                className={`px-3 py-1.5 rounded-xl border text-xs font-black flex items-center gap-1.5 cursor-pointer transition-colors ${
                  beadStyle === 'ring'
                    ? 'bg-purple-50 text-purple-900 border-purple-200 hover:bg-purple-100'
                    : 'bg-emerald-50 text-emerald-900 border-emerald-300'
                }`}
              >
                <span>{beadStyle === 'ring' ? '⭕ 3D立体圆珠' : '🟩 深度融豆平烫'}</span>
              </button>

              <button
                type="button"
                onClick={() => setShowPegboard(p => !p)}
                className={`px-3 py-1.5 rounded-xl border text-xs font-black flex items-center gap-1.5 cursor-pointer transition-colors ${
                  showPegboard
                    ? 'bg-indigo-600 text-white border-indigo-600 shadow-2xs'
                    : 'bg-purple-50 text-purple-800 border-purple-200'
                }`}
              >
                <span>📌 亚克力针板模式</span>
              </button>

              <button
                type="button"
                onClick={() => setSoundEnabled(s => !s)}
                className="px-2.5 py-1.5 rounded-xl bg-purple-50 hover:bg-purple-100 border border-purple-200 text-xs font-black flex items-center gap-1 cursor-pointer text-purple-800"
                title={soundEnabled ? '按压音效已开启' : '音效已静音'}
              >
                {soundEnabled ? <Volume2 className="w-3.5 h-3.5 text-purple-600" /> : <VolumeX className="w-3.5 h-3.5 text-slate-400" />}
                <span className="hidden sm:inline">{soundEnabled ? '音效开启' : '静音'}</span>
              </button>
            </div>
          </div>

          {/* Main Grid Workspace Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-start">

            {/* Left Column: Presets, Tools & Color Swatches */}
            <div className="lg:col-span-4 space-y-5 bg-purple-50/60 rounded-2xl p-4 sm:p-5 border border-purple-100">

              {/* 1. Pattern Presets */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-black text-purple-900 flex items-center gap-1">
                    <span>预设像素图纸</span>
                  </label>
                  <button
                    type="button"
                    onClick={triggerAIScan}
                    disabled={isAIScanning}
                    className="px-2.5 py-1 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 hover:brightness-110 text-white text-xs font-black flex items-center gap-1 cursor-pointer shadow-xs disabled:opacity-50"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>{isAIScanning ? 'AI扫描重组中…' : 'AI 扫描重组'}</span>
                  </button>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-2 gap-2">
                  {(Object.keys(PIXEL_PATTERNS) as PresetKey[]).map(key => {
                    const preset = PIXEL_PATTERNS[key];
                    const isActive = activePresetKey === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => {
                          setActivePresetKey(key);
                          setHighlightedColorChar(null);
                        }}
                        className={`px-3 py-2 rounded-xl text-xs font-black flex items-center gap-2 transition-colors cursor-pointer border text-left ${
                          isActive
                            ? 'bg-purple-600 text-white border-purple-600 shadow-sm'
                            : 'bg-white hover:bg-purple-100/80 text-purple-900 border-purple-200/80'
                        }`}
                      >
                        <span className="text-base">{preset.icon}</span>
                        <span className="truncate">{preset.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 2. Drawing Tools Palette */}
              <div className="space-y-2 pt-2 border-t border-purple-200/60">
                <label className="text-xs font-black text-purple-900 block">绘图与编辑工具</label>
                <div className="grid grid-cols-4 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setDrawingTool('brush')}
                    className={`p-2 rounded-xl text-xs font-black flex flex-col items-center justify-center gap-1 cursor-pointer border transition-colors ${
                      drawingTool === 'brush'
                        ? 'bg-purple-600 text-white border-purple-600 shadow-xs'
                        : 'bg-white text-purple-800 border-purple-200 hover:bg-purple-100/70'
                    }`}
                    title="自由画笔"
                  >
                    <Paintbrush className="w-4 h-4" />
                    <span className="text-[10px]">画笔</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setDrawingTool('bucket')}
                    className={`p-2 rounded-xl text-xs font-black flex flex-col items-center justify-center gap-1 cursor-pointer border transition-colors ${
                      drawingTool === 'bucket'
                        ? 'bg-purple-600 text-white border-purple-600 shadow-xs'
                        : 'bg-white text-purple-800 border-purple-200 hover:bg-purple-100/70'
                    }`}
                    title="倒色油漆桶 (Flood Fill)"
                  >
                    <PaintBucket className="w-4 h-4" />
                    <span className="text-[10px]">倒色</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setDrawingTool('eraser')}
                    className={`p-2 rounded-xl text-xs font-black flex flex-col items-center justify-center gap-1 cursor-pointer border transition-colors ${
                      drawingTool === 'eraser'
                        ? 'bg-purple-600 text-white border-purple-600 shadow-xs'
                        : 'bg-white text-purple-800 border-purple-200 hover:bg-purple-100/70'
                    }`}
                    title="橡皮擦"
                  >
                    <Eraser className="w-4 h-4" />
                    <span className="text-[10px]">橡皮擦</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleResetPattern}
                    className="p-2 rounded-xl text-xs font-black flex flex-col items-center justify-center gap-1 cursor-pointer border bg-white text-purple-800 border-purple-200 hover:bg-purple-100/70"
                    title="重置初始图纸"
                  >
                    <RotateCcw className="w-4 h-4" />
                    <span className="text-[10px]">重置</span>
                  </button>
                </div>
              </div>

              {/* 3. Color Swatch Picker */}
              <div className="space-y-2 pt-2 border-t border-purple-200/60">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-black text-purple-900 block">标准 Perler / Artkal 色卡</label>
                  <button
                    type="button"
                    onClick={handleClearCanvas}
                    className="text-[10px] text-pink-600 font-extrabold hover:underline flex items-center gap-0.5 cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>清空画板</span>
                  </button>
                </div>

                <div className="grid grid-cols-4 gap-2">
                  {Object.keys(COLOR_MAP).map(ck => {
                    const info = COLOR_MAP[ck];
                    const isSelected = selectedColorKey === ck && drawingTool !== 'eraser';
                    return (
                      <button
                        key={ck}
                        type="button"
                        onClick={() => {
                          setSelectedColorKey(ck);
                          if (drawingTool === 'eraser') setDrawingTool('brush');
                        }}
                        className={`p-2 rounded-xl border flex flex-col items-center justify-center gap-1 transition-colors cursor-pointer relative ${
                          isSelected
                            ? 'bg-white border-purple-600 ring-2 ring-purple-600 shadow-sm'
                            : 'bg-white border-purple-200/80 hover:bg-purple-100/50'
                        }`}
                      >
                        <span
                          className="w-5 h-5 rounded-full border border-black/20 shadow-xs"
                          style={{ backgroundColor: info.hex }}
                        />
                        <span className="text-[10px] font-mono font-bold text-purple-950 truncate max-w-full">
                          {info.name}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 4. Action Bar */}
              <div className="pt-2 border-t border-purple-200/60 flex flex-col gap-2">
                <button
                  type="button"
                  onClick={triggerHeatPress}
                  disabled={isIroning}
                  className={`w-full py-3 rounded-2xl font-black text-xs sm:text-sm flex items-center justify-center gap-2 cursor-pointer transition-colors ${
                    isIroning
                      ? 'bg-amber-500 text-white shadow-md'
                      : 'bg-gradient-to-r from-amber-500 to-orange-500 hover:brightness-110 text-white shadow-md shadow-amber-500/20'
                  }`}
                >
                  <Flame className="w-4 h-4" />
                  <span>{isIroning ? '热压融豆进行中…' : '🔥 虚拟热压烫豆 (模拟平烫)'}</span>
                </button>
              </div>

            </div>

            {/* Right Column: Main Canvas Board Stage */}
            <div className="lg:col-span-8 flex flex-col items-center space-y-4">

              {/* Canvas Board Container */}
              <div className="w-full max-w-lg bg-white rounded-3xl border-2 border-purple-200 p-4 sm:p-6 shadow-xl relative overflow-hidden flex flex-col items-center justify-center">

                {/* Heat Press Beam Overlay */}
                {isIroning && (
                  <>
                    <div className="absolute inset-0 bg-gradient-to-r from-amber-500/10 via-orange-500/20 to-amber-500/10 z-25 pointer-events-none rounded-3xl" />
                    <div className="absolute inset-y-0 w-36 bg-gradient-to-r from-transparent via-amber-300/80 via-orange-500/90 to-transparent blur-xs z-30 pointer-events-none animate-iron-beam flex items-center justify-center">
                      <div className="w-1.5 h-full bg-white/90 shadow-[0_0_18px_#f59e0b]" />
                    </div>
                  </>
                )}

                {/* AI Laser Scanline Overlay */}
                {isAIScanning && (
                  <>
                    <div className="absolute inset-0 bg-purple-900/10 z-25 pointer-events-none rounded-3xl" />
                    <div className="absolute inset-x-0 h-20 bg-gradient-to-b from-transparent via-fuchsia-400/80 to-transparent blur-xs z-30 pointer-events-none animate-laser-scan flex items-center">
                      <div className="h-1 w-full bg-cyan-300 shadow-[0_0_14px_#06b6d4]" />
                    </div>
                  </>
                )}

                {/* Toast Notification */}
                {ironSuccessMsg && (
                  <div className="absolute top-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded-2xl bg-amber-950/90 text-amber-200 text-xs font-black shadow-2xl backdrop-blur-md z-40 border border-amber-400/50">
                    {ironSuccessMsg}
                  </div>
                )}

                {/* Main Interactive Bead Grid */}
                <div
                  onMouseDown={() => setIsMouseDown(true)}
                  className={`grid grid-cols-16 gap-1 w-full aspect-square p-3 sm:p-4 rounded-2xl shadow-inner border transition-colors relative ${
                    showPegboard
                      ? 'bg-slate-100/90 border-slate-300 shadow-inner bg-pegboard-dots'
                      : 'bg-white/90 border-purple-200'
                  }`}
                >
                  {activeGrid.map((row, r) =>
                    row.map((cellChar, c) => {
                      const colorInfo = COLOR_MAP[cellChar];
                      const isHovered = hoveredCell?.r === r && hoveredCell?.c === c;
                      const isHighlightedByLegend = highlightedColorChar === cellChar && cellChar !== '.';

                      return (
                        <div
                          key={`${r}-${c}`}
                          onMouseDown={() => applyCellAction(r, c)}
                          onMouseEnter={() => {
                            setHoveredCell({ r, c, char: cellChar });
                            if (isMouseDown) applyCellAction(r, c);
                          }}
                          onMouseLeave={() => setHoveredCell(null)}
                          className={`relative aspect-square transition-all duration-300 ease-out cursor-pointer flex items-center justify-center ${
                            cellChar === '.'
                              ? showPegboard
                                ? 'bg-slate-200/50 border border-slate-300/60 hover:bg-purple-200/80'
                                : 'bg-slate-100/50 border border-dashed border-purple-200/50 hover:bg-purple-100/80'
                              : ''
                          } ${beadStyle === 'melted' ? 'rounded-[30%] scale-[0.98]' : 'rounded-full'} ${
                            isHovered ? 'z-20 ring-2 ring-purple-600 brightness-110 shadow-sm' : ''
                          } ${isHighlightedByLegend ? 'bead-active-highlight' : ''}`}
                          style={
                            cellChar !== '.'
                              ? {
                                  backgroundColor: colorInfo?.hex || '#9333ea',
                                  boxShadow:
                                    beadStyle === 'ring'
                                      ? 'inset -1px -2px 3px rgba(0,0,0,0.3), inset 1px 2px 3px rgba(255,255,255,0.7), 0 2px 4px rgba(0,0,0,0.15)'
                                      : '0 1px 2px rgba(0,0,0,0.15)',
                                }
                              : undefined
                          }
                        >
                          {/* Pegboard Pin Center Dot */}
                          {showPegboard && (
                            <div className="w-[18%] h-[18%] rounded-full bg-slate-400/60 absolute z-0 pointer-events-none" />
                          )}

                          {/* 3D Bead Inner Ring Hole */}
                          {cellChar !== '.' && beadStyle === 'ring' && (
                            <div className="w-[32%] h-[32%] rounded-full bg-purple-950/30 shadow-inner relative z-10" />
                          )}
                        </div>
                      );
                    })
                  )}
                </div>

                {/* FIXED-HEIGHT HOVER TOOLTIP DISPLAY BAR - ABSOLUTELY ZERO LAYOUT SHIFT OR JUMPING */}
                <div className="w-full h-10 mt-3 flex items-center justify-center bg-purple-50/90 rounded-2xl border border-purple-100/80 px-4">
                  {hoveredCell && hoveredCell.char !== '.' && COLOR_MAP[hoveredCell.char] ? (
                    <div className="flex items-center gap-2 text-xs font-bold text-purple-950">
                      <span
                        className="w-3.5 h-3.5 rounded-full border border-black/20 shadow-xs shrink-0"
                        style={{ backgroundColor: COLOR_MAP[hoveredCell.char].hex }}
                      />
                      <span>{COLOR_MAP[hoveredCell.char].code}</span>
                      <span className="text-purple-300">•</span>
                      <span>{COLOR_MAP[hoveredCell.char].name}</span>
                      <span className="text-purple-300">•</span>
                      <span className="font-mono text-purple-700 bg-purple-200/60 px-2 py-0.5 rounded-md text-[11px]">
                        坐标 [{hoveredCell.r + 1}, {hoveredCell.c + 1}]
                      </span>
                    </div>
                  ) : (
                    <div className="text-[11px] font-bold text-purple-600/80 flex items-center gap-1.5">
                      <MousePointerClick className="w-3.5 h-3.5" />
                      <span>鼠标悬停拼豆可查看精准色号与坐标</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Crafts Specification & Interactive Color Legend Bar */}
              <div className="w-full bg-white rounded-2xl border border-purple-200 p-4 space-y-3">
                {/* Stats row */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs font-black text-purple-950">
                  <div className="p-2 rounded-xl bg-purple-50 border border-purple-100 flex items-center justify-center gap-1.5">
                    <Clock className="w-4 h-4 text-purple-600" />
                    <span>预计耗时: ~{beadStats.estMinutes}分钟</span>
                  </div>
                  <div className="p-2 rounded-xl bg-pink-50 border border-pink-100 flex items-center justify-center gap-1.5">
                    <Weight className="w-4 h-4 text-pink-600" />
                    <span>总重: ~{beadStats.estWeightGram}g</span>
                  </div>
                  <div className="p-2 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center gap-1.5">
                    <Ruler className="w-4 h-4 text-indigo-600" />
                    <span>规格: Perler 5.0mm (8×8cm)</span>
                  </div>
                  <div className="p-2 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    <span>总豆数: {beadStats.totalBeads} 颗</span>
                  </div>
                </div>

                {/* Color Legend Filter Pills */}
                <div className="pt-1 border-t border-purple-100">
                  <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none py-1 w-full">
                    <span className="text-[11px] font-black text-purple-500 shrink-0">用量与高亮:</span>
                    {beadStats.topColors.map(tc => {
                      const isHighlighted = highlightedColorChar === tc.char;
                      return (
                        <button
                          key={tc.char}
                          type="button"
                          onClick={() => setHighlightedColorChar(isHighlighted ? null : tc.char)}
                          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-black transition-colors cursor-pointer border shrink-0 ${
                            isHighlighted
                              ? 'bg-purple-600 text-white border-purple-600 ring-2 ring-purple-400'
                              : 'bg-purple-50 hover:bg-purple-100 text-purple-900 border-purple-200'
                          }`}
                          title="点击高亮画板对应颜色"
                        >
                          <span className="w-2.5 h-2.5 rounded-full border border-black/20" style={{ backgroundColor: tc.hex }} />
                          <span>{tc.name}</span>
                          <span className="font-mono text-purple-600 text-[10px]">{tc.count}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

            </div>

          </div>
        </section>

        {/* 3. PRODUCT CORE CAPABILITIES SECTION ("为什么选择豆织星格" `#features-section`) */}
        <section className="space-y-6 pt-4 landing-anchor-target" id="capabilities" aria-label="核心能力">
          <div className="text-center space-y-2 max-w-2xl mx-auto">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-purple-100 text-purple-800 text-xs font-black uppercase tracking-wider">
              <Sparkles className="w-3.5 h-3.5 text-purple-600" />
              <span>CORE ADVANTAGES</span>
            </div>
            <h2 className="text-2xl sm:text-4xl font-black text-purple-950 tracking-tight">
              打造专业拼豆手作的核心工具
            </h2>
            <p className="text-xs sm:text-sm text-purple-800/80 font-medium">
              告别传统偏色与模糊手改图纸，豆织星格用算法赋予每颗拼豆精准生命力。
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">

            {/* Feature 01 */}
            <div className="bg-white rounded-3xl p-6 border border-purple-200/80 shadow-xs hover:shadow-xl hover:border-purple-300 transition-all space-y-4">
              <div className="w-12 h-12 rounded-2xl bg-indigo-50 border border-indigo-100 text-indigo-600 flex items-center justify-center">
                <Wand2 className="w-6 h-6" />
              </div>
              <div className="space-y-1.5">
                <h3 className="text-base font-extrabold text-purple-950">智能转图与 AI 抠图</h3>
                <p className="text-xs text-purple-800/80 font-medium leading-relaxed">
                  上传任意照片或插画，自动提取主体，快速将复杂图案量化为清晰像素网格。
                </p>
              </div>
            </div>

            {/* Feature 02 */}
            <div className="bg-white rounded-3xl p-6 border border-purple-200/80 shadow-xs hover:shadow-xl hover:border-purple-300 transition-all space-y-4">
              <div className="w-12 h-12 rounded-2xl bg-purple-50 border border-purple-100 text-purple-600 flex items-center justify-center">
                <Palette className="w-6 h-6" />
              </div>
              <div className="space-y-1.5">
                <h3 className="text-base font-extrabold text-purple-950">12+ 国际色卡算法</h3>
                <p className="text-xs text-purple-800/80 font-medium leading-relaxed">
                  内置 Perler、Artkal、Mard 等多品牌官方色卡，采用 CIEDE2000 色差无损核色。
                </p>
              </div>
            </div>

            {/* Feature 03 */}
            <div className="bg-white rounded-3xl p-6 border border-purple-200/80 shadow-xs hover:shadow-xl hover:border-purple-300 transition-all space-y-4">
              <div className="w-12 h-12 rounded-2xl bg-pink-50 border border-pink-100 text-pink-600 flex items-center justify-center">
                <Flame className="w-6 h-6" />
              </div>
              <div className="space-y-1.5">
                <h3 className="text-base font-extrabold text-purple-950">3D 触觉与热压预览</h3>
                <p className="text-xs text-purple-800/80 font-medium leading-relaxed">
                  实时切换立体 3D 圆珠与平烫融豆质感，提前预估烫豆后的像素融合物理效果。
                </p>
              </div>
            </div>

            {/* Feature 04 */}
            <div className="bg-white rounded-3xl p-6 border border-purple-200/80 shadow-xs hover:shadow-xl hover:border-purple-300 transition-all space-y-4">
              <div className="w-12 h-12 rounded-2xl bg-emerald-50 border border-emerald-100 text-emerald-600 flex items-center justify-center">
                <Printer className="w-6 h-6" />
              </div>
              <div className="space-y-1.5">
                <h3 className="text-base font-extrabold text-purple-950">1:1 切片与矢量 BOM</h3>
                <p className="text-xs text-purple-800/80 font-medium leading-relaxed">
                  支持大型作品拼接大板切片 (29×29)，导出包含色号使用数量的高清 PDF 打印单。
                </p>
              </div>
            </div>

          </div>
        </section>

        {/* 4. VISUAL Core Workflow STEPS */}
        <section className="bg-white/80 rounded-3xl border border-purple-200 p-6 sm:p-10 shadow-lg space-y-8 landing-anchor-target" id="workflow" aria-label="创作流程">
          <div className="text-center space-y-2">
            <h2 className="text-2xl sm:text-3xl font-black text-purple-950 tracking-tight">
              轻松四步，完成你的拼豆作品
            </h2>
            <p className="text-xs sm:text-sm text-purple-800/80 font-medium">
              简单清晰的四步流程，把创意完美落成实体
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 relative">
            <div className="flex flex-col items-center text-center space-y-3 p-4 rounded-2xl bg-purple-50/50 border border-purple-100">
              <span className="w-10 h-10 rounded-2xl bg-purple-600 text-white font-black text-sm flex items-center justify-center shadow-md">
                1
              </span>
              <h4 className="text-sm font-extrabold text-purple-950">导入图片 / 选预设</h4>
              <p className="text-xs text-purple-800/70 font-medium">
                支持拖拽照片或从社区选购预设图案。
              </p>
            </div>

            <div className="flex flex-col items-center text-center space-y-3 p-4 rounded-2xl bg-purple-50/50 border border-purple-100">
              <span className="w-10 h-10 rounded-2xl bg-indigo-600 text-white font-black text-sm flex items-center justify-center shadow-md">
                2
              </span>
              <h4 className="text-sm font-extrabold text-purple-950">智能转像素与选色卡</h4>
              <p className="text-xs text-purple-800/70 font-medium">
                一键适配 Perler/Artkal 品牌色号。
              </p>
            </div>

            <div className="flex flex-col items-center text-center space-y-3 p-4 rounded-2xl bg-purple-50/50 border border-purple-100">
              <span className="w-10 h-10 rounded-2xl bg-fuchsia-600 text-white font-black text-sm flex items-center justify-center shadow-md">
                3
              </span>
              <h4 className="text-sm font-extrabold text-purple-950">3D 画板微调修色</h4>
              <p className="text-xs text-purple-800/70 font-medium">
                在 3D 画板中修补细节，预览烫豆效果。
              </p>
            </div>

            <div className="flex flex-col items-center text-center space-y-3 p-4 rounded-2xl bg-purple-50/50 border border-purple-100">
              <span className="w-10 h-10 rounded-2xl bg-pink-600 text-white font-black text-sm flex items-center justify-center shadow-md">
                4
              </span>
              <h4 className="text-sm font-extrabold text-purple-950">导出图纸 & 拼装</h4>
              <p className="text-xs text-purple-800/70 font-medium">
                打印带标号图纸，采购豆子开始拼装！
              </p>
            </div>
          </div>
        </section>

        {/* 5. FEATURED GALLERY EXAMPLES */}
        <section className="space-y-6 landing-anchor-target" id="showcase" aria-label="精选作品预览">
          <div className="flex items-center justify-between border-b border-purple-200/60 pb-4">
            <div>
              <h2 className="text-xl sm:text-2xl font-black text-purple-950 tracking-tight">
                精选拼豆案例与图纸
              </h2>
              <p className="text-xs text-purple-800/80 font-medium">
                点击一键载入工作台直接进行拼装与打印
              </p>
            </div>

            <button
              type="button"
              onClick={() => navigateTab('community')}
              className="text-xs font-black text-purple-700 hover:text-purple-900 flex items-center gap-1 cursor-pointer"
            >
              <span>查看全部 500+ 图纸</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {HERO_EXAMPLES.map(ex => (
              <div
                key={ex.id}
                onClick={createHeroExampleActivation(ex, loadHeroExample)}
                className="group bg-white rounded-2xl border border-purple-200 overflow-hidden shadow-xs hover:shadow-xl hover:border-purple-400 transition-all cursor-pointer p-3 flex flex-col justify-between"
              >
                <div className="aspect-square rounded-xl bg-purple-50 overflow-hidden relative mb-3">
                  <img
                    src={ex.url}
                    alt={ex.name}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-extrabold text-purple-950">{ex.name}</span>
                  <span className="text-[10px] font-black text-purple-600 bg-purple-100 px-2 py-0.5 rounded-md">
                    载入图纸
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* 6. BOTTOM CTA LAUNCH BANNER */}
        <section className="rounded-3xl bg-gradient-to-r from-purple-900 via-indigo-900 to-fuchsia-950 p-8 sm:p-12 text-white shadow-2xl text-center space-y-6 relative overflow-hidden">
          <div className="max-w-2xl mx-auto space-y-3 relative z-10">
            <h2 className="text-2xl sm:text-4xl font-black tracking-tight">
              准备好开启你的第一个拼豆作品了吗？
            </h2>
            <p className="text-xs sm:text-sm text-purple-200/90 font-medium">
              无需安装任何插件，完全免费。导入图片即可开始设计与导出。
            </p>
            <div className="pt-2">
              <button
                type="button"
                onClick={() => navigateTab('studio')}
                className="px-8 py-4 rounded-2xl bg-gradient-to-r from-amber-400 to-amber-500 hover:brightness-110 text-purple-950 font-black text-base shadow-xl transition-all cursor-pointer inline-flex items-center gap-2"
              >
                <Wand2 className="w-5 h-5 text-purple-950 fill-purple-950" />
                <span>立即进入创作桌</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </section>

      </div>

      {/* FOOTER */}
      <footer className="mt-16 border-t border-purple-200/80 bg-white/60 backdrop-blur-md py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs font-extrabold text-purple-900/70">
          <div className="flex items-center gap-2">
            <Grid2X2 className="w-4 h-4 text-purple-600" />
            <span>BEADGRID CREATIVE OS · 豆织星格 © 2026</span>
          </div>
          <div className="flex items-center gap-6">
            <span>隐私保护 (100% 本地运算)</span>
            <span>多品牌色卡标准</span>
            <span>矢量 BOM 导出</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

export const HomeView = LandingView;
