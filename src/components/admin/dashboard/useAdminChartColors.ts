/**
 * 图表序列色只从 CSS 变量取值（PRD §5 / 架构 §3.4）：
 * 源码里禁止出现 `#` 颜色字面量，暗色主题只需换变量即可，组件零改动。
 */

import { useEffect, useState } from 'react';

/** 亮色 5 条序列的变量名（最多 5 条，超了改小多图，不再加色）。 */
export const CHART_SERIES_VARS = [
  '--admin-series-1',
  '--admin-series-2',
  '--admin-series-3',
  '--admin-series-4',
  '--admin-series-5',
] as const;

/** CSS 变量读不到时的兜底（与 admin.css 亮色 token 同值，保证首帧不是透明）。 */
const FALLBACKS: Record<string, string> = {
  '--admin-series-1': '#4f46e5',
  '--admin-series-2': '#0d9488',
  '--admin-series-3': '#b45309',
  '--admin-series-4': '#7c3aed',
  '--admin-series-5': '#be123c',
  '--admin-grid': '#e2e8f0',
  '--admin-axis-text': '#64748b',
};

/**
 * 纯函数版：给定「读变量」函数返回 5 个序列色 + 网格/轴文字色。
 * 单测注入假 readVar 即可，无需真实 DOM。
 */
export function resolveChartColors(readVar: (name: string) => string): {
  series: string[];
  grid: string;
  axis: string;
} {
  const pick = (name: string): string => {
    const raw = readVar(name).trim();
    return raw.length > 0 ? raw : FALLBACKS[name]!;
  };
  return {
    series: CHART_SERIES_VARS.map(pick),
    grid: pick('--admin-grid'),
    axis: pick('--admin-axis-text'),
  };
}

/** 从 `.admin-root` 上读计算样式（挂载后调用，SSR 下用兜底色）。 */
export function readAdminChartColorsFromDom(scope: Element | null): ReturnType<typeof resolveChartColors> {
  if (!scope || typeof getComputedStyle !== 'function') return resolveChartColors(() => '');
  const style = getComputedStyle(scope);
  return resolveChartColors(name => style.getPropertyValue(name));
}

/**
 * 组件用 hook：挂载后读一次 `.admin-root` 的 CSS 变量并缓存。
 * 首次渲染用兜底色，避免图表首帧透明/闪烁。
 */
export function useAdminChartColors(): ReturnType<typeof resolveChartColors> {
  const [colors, setColors] = useState<ReturnType<typeof resolveChartColors>>(() => resolveChartColors(() => ''));
  useEffect(() => {
    setColors(readAdminChartColorsFromDom(document.querySelector('.admin-root')));
  }, []);
  return colors;
}

