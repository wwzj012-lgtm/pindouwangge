import React, { useRef, useState } from 'react';
import {
  Sparkles,
  Image as ImageIcon,
  Palette,
  Compass,
  FileDown,
  ArrowRight,
  Zap,
  ChevronRight,
  Grid2X2,
  Code2,
  Wand2,
  CheckCircle2,
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

const VIBE_PROMPTS = [
  { label: '像素角色', prompt: '把灵感变成一只会发光的像素角色', color: 'from-fuchsia-500 to-violet-600' },
  { label: '配色实验', prompt: '试试一组适合拼豆的糖果色配色', color: 'from-cyan-500 to-blue-600' },
  { label: '场景拼豆', prompt: '为你的下一张风景图加一点星格氛围', color: 'from-amber-400 to-orange-600' },
] as const;

export function createHeroExampleActivation(
  example: HeroExample,
  onLoadHeroExample: (example: HeroExample) => void,
): () => void {
  return () => onLoadHeroExample(example);
}

interface HomeViewProps {
  onNavigateTab: (tab: 'home' | 'community' | 'studio' | 'largeCanvas') => void;
  onStartPhotoToBead: (file: File) => void;
  onLoadHeroExample: (example: HeroExample) => void;
  onImportPattern: () => void;
}

export const HomeView: React.FC<HomeViewProps> = ({
  onNavigateTab,
  onStartPhotoToBead,
  onLoadHeroExample,
  onImportPattern,
}) => {
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [vibeIndex, setVibeIndex] = useState(0);
  const [isVibeLoading, setIsVibeLoading] = useState(false);
  const choosePhoto = () => photoInputRef.current?.click();
  const vibe = VIBE_PROMPTS[vibeIndex];
  const inspire = () => {
    if (isVibeLoading) return;
    setIsVibeLoading(true);
    window.setTimeout(() => {
      setVibeIndex(index => (index + 1) % VIBE_PROMPTS.length);
      setIsVibeLoading(false);
    }, 520);
  };

  return (
    <div className="flex-1 overflow-y-auto bg-[#F5F0FD] min-h-screen text-purple-950 pb-20 select-none">
      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={event => {
          const file = consumeSelectedImageFile(event.target);
          if (file) onStartPhotoToBead(file);
        }}
      />
      <div className="max-w-[1600px] w-full mx-auto px-4 sm:px-6 lg:px-8 pt-3 sm:pt-5 space-y-5">
        
        {/* 1. HERO BANNER CARD */}
        <div className="relative rounded-3xl bg-gradient-to-r from-purple-800 via-purple-700 to-indigo-800 text-white p-5 sm:p-6 md:p-8 shadow-xl overflow-hidden border border-purple-500/20">
          {/* Ambient Glow Effects */}
          <div className="absolute -top-16 -right-16 w-64 h-64 bg-pink-500/15 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-16 -left-16 w-64 h-64 bg-indigo-500/20 rounded-full blur-3xl pointer-events-none" />

          <div className="relative z-10 grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-center">
            {/* Left Content */}
            <div className="lg:col-span-7 space-y-4">
              {/* Tag Pill */}
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 backdrop-blur-md border border-white/20 text-xs font-bold text-purple-100 shadow-xs">
                <Sparkles className="w-3.5 h-3.5 text-amber-300 fill-amber-300" />
                <span>豆织星格 · 拼豆像素艺术与图纸工作台</span>
              </div>

              {/* Main Headline */}
              <h1 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-black tracking-tight leading-tight text-white drop-shadow-xs">
                一粒一粒<br />织出像素星格
              </h1>

              {/* Subtitle */}
              <p className="text-xs sm:text-sm text-purple-100/90 leading-relaxed max-w-2xl font-medium">
                专业的 Perler / Artkal / Mard 拼豆网格转换与像素画板。包含智能图像转图、精准色号匹配、1:1 实物比对与高清图纸导出。
              </p>

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center gap-3.5 pt-2">
                <button
                  onClick={() => onNavigateTab('studio')}
                  className="px-6 py-3 sm:px-7 sm:py-3.5 rounded-full bg-white hover:bg-purple-50 text-purple-950 font-black text-sm sm:text-base shadow-lg transition-all hover:scale-102 active:scale-98 flex items-center gap-2.5 cursor-pointer"
                >
                  <Palette className="w-5 h-5 text-purple-700 fill-purple-700" />
                  <span>进入画板创作</span>
                </button>

                <button
                  onClick={choosePhoto}
                  className="px-6 py-3 sm:px-7 sm:py-3.5 rounded-full bg-white/15 hover:bg-white/25 border border-white/30 text-white font-bold text-sm sm:text-base backdrop-blur-md transition-all hover:scale-102 active:scale-98 flex items-center gap-2.5 cursor-pointer"
                >
                  <Zap className="w-5 h-5 text-amber-300 fill-amber-300" />
                  <span>照片一键转拼豆</span>
                </button>

                <button
                  onClick={() => onNavigateTab('community')}
                  className="px-5 py-3 sm:py-3.5 rounded-full bg-transparent hover:bg-white/10 text-purple-200 font-bold text-sm sm:text-base transition-all cursor-pointer flex items-center gap-1.5"
                >
                  <span>探索社区作品</span>
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>

              {/* Stats Footer */}
              <div className="flex flex-wrap items-center gap-4 sm:gap-6 pt-3 border-t border-white/15 text-xs text-purple-100 font-bold">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  <span className="text-purple-200">支持 4 大主流色卡品牌</span>
                </div>
                <div className="hidden sm:block w-px h-3 bg-white/20" />
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-amber-400" />
                  <span className="text-purple-200">智能省豆色盘优化</span>
                </div>
                <div className="hidden sm:block w-px h-3 bg-white/20" />
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-pink-400" />
                  <span className="text-purple-200">1:1 实物对号导出</span>
                </div>
              </div>
            </div>

            {/* Official Studio starting examples, not community activity. */}
            <div className="lg:col-span-5 flex justify-center lg:justify-end">
              <div className="bg-white/10 backdrop-blur-md p-3 sm:p-4 rounded-3xl border border-white/20 grid grid-cols-2 gap-3 shadow-2xl max-w-md w-full relative">
                <span className="absolute top-2 left-3 text-[10px] font-bold text-purple-100 z-10">官方起始示例</span>
                {HERO_EXAMPLES.map((example) => (
                  <button
                    key={example.id}
                    type="button"
                    onClick={createHeroExampleActivation(example, onLoadHeroExample)}
                    className="group relative aspect-square min-w-0 cursor-pointer overflow-hidden rounded-2xl border border-white/30 bg-purple-900/50 text-left shadow-inner outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-white"
                    title={`转换示例：${example.name}`}
                  >
                    <img src={example.url} alt={example.name} className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" />
                    <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent p-2 text-[11px] font-bold text-white">
                      示例：{example.name}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* 2. QUICK WORKSPACE SECTION (快捷工作台 - PRIORITIZING LEFT-RIGHT ALIGNMENT) */}
        <div className="space-y-3 pt-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-4 bg-purple-600 rounded-full" />
              <h2 className="text-base font-black text-purple-950">快捷工作台</h2>
            </div>
            <span className="text-xs font-bold text-purple-400">高效创建与导入图纸</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {/* Card 1: 智能照片转拼豆 */}
            <div
              onClick={choosePhoto}
              className="bg-white border border-purple-100 hover:border-purple-300 rounded-2xl p-4 shadow-2xs hover:shadow-md transition-all cursor-pointer flex items-center justify-between group"
            >
              <div className="flex items-center gap-3.5">
                <div className="w-11 h-11 rounded-2xl bg-indigo-50 border border-indigo-100 text-indigo-600 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                  <ImageIcon className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-extrabold text-purple-950">智能转拼豆</h3>
                  <p className="text-xs text-purple-500 font-medium">照片一键识别量化</p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-purple-300 group-hover:text-purple-600 group-hover:translate-x-0.5 transition-all" />
            </div>

            {/* Card 2: 新建空白画板 */}
            <div
              onClick={() => onNavigateTab('studio')}
              className="bg-white border border-purple-100 hover:border-purple-300 rounded-2xl p-4 shadow-2xs hover:shadow-md transition-all cursor-pointer flex items-center justify-between group"
            >
              <div className="flex items-center gap-3.5">
                <div className="w-11 h-11 rounded-2xl bg-purple-50 border border-purple-100 text-purple-600 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                  <Palette className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-extrabold text-purple-950">进入画板</h3>
                  <p className="text-xs text-purple-500 font-medium">自定义画布自由绘制</p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-purple-300 group-hover:text-purple-600 group-hover:translate-x-0.5 transition-all" />
            </div>

            {/* Card 3: 逛豆社 */}
            <div
              onClick={() => onNavigateTab('community')}
              className="bg-white border border-purple-100 hover:border-purple-300 rounded-2xl p-4 shadow-2xs hover:shadow-md transition-all cursor-pointer flex items-center justify-between group"
            >
              <div className="flex items-center gap-3.5">
                <div className="w-11 h-11 rounded-2xl bg-amber-50 border border-amber-100 text-amber-600 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                  <Compass className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-extrabold text-purple-950">豆社灵感</h3>
                  <p className="text-xs text-purple-500 font-medium">发现图纸并 Remix</p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-purple-300 group-hover:text-purple-600 group-hover:translate-x-0.5 transition-all" />
            </div>

            {/* Card 4: 图纸导入 */}
            <div
              onClick={onImportPattern}
              className="bg-white border border-purple-100 hover:border-purple-300 rounded-2xl p-4 shadow-2xs hover:shadow-md transition-all cursor-pointer flex items-center justify-between group"
            >
              <div className="flex items-center gap-3.5">
                <div className="w-11 h-11 rounded-2xl bg-emerald-50 border border-emerald-100 text-emerald-600 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                  <FileDown className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-extrabold text-purple-950">本地图纸导入</h3>
                  <p className="text-xs text-purple-500 font-medium">JSON/网格图载入</p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-purple-300 group-hover:text-purple-600 group-hover:translate-x-0.5 transition-all" />
            </div>

            {/* Card 5: 大画板 */}
            <div
              onClick={() => onNavigateTab('largeCanvas')}
              className="bg-white border border-purple-100 hover:border-purple-300 rounded-2xl p-4 shadow-2xs hover:shadow-md transition-all cursor-pointer flex items-center justify-between group"
            >
              <div className="flex items-center gap-3.5">
                <div className="w-11 h-11 rounded-2xl bg-violet-50 border border-violet-100 text-violet-600 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                  <Grid2X2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-extrabold text-purple-950">大画板</h3>
                  <p className="text-xs text-purple-500 font-medium">多图框批量生成图纸</p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-purple-300 group-hover:text-purple-600 group-hover:translate-x-0.5 transition-all" />
            </div>
          </div>
        </div>

        {/* 4. COMMUNITY POPULAR & ACTIVE CREATORS */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 pt-2">
          <section className="lg:col-span-3 rounded-2xl border border-purple-200/80 bg-white p-5 shadow-2xs flex flex-col justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-4 bg-pink-500 rounded-full" />
                <h2 className="text-base font-black text-purple-950">社区作品</h2>
              </div>
              <p className="mt-3 text-sm text-purple-600 leading-relaxed">公开作品、互动数据和创作者信息仅在豆社连接到真实社区服务后展示。</p>
            </div>
            <button
              onClick={() => onNavigateTab('community')}
              className="self-start text-xs font-bold text-purple-600 hover:text-purple-800 flex items-center gap-0.5 cursor-pointer"
            >
              <span>前往豆社查看</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </section>

          <aside className="lg:col-span-1 rounded-2xl border border-purple-200/80 bg-white p-5 shadow-2xs">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-4 bg-pink-500 rounded-full" />
              <h2 className="text-base font-black text-purple-950">创作者榜单</h2>
            </div>
            <p className="mt-3 text-xs text-purple-500 leading-relaxed">榜单需要真实的聚合数据支持，当前暂不展示排名或关注数。</p>
          </aside>
        </div>

      </div>
    </div>
  );
};
