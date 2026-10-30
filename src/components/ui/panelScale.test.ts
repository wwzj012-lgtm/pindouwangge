import { describe, expect, it } from 'vitest';
import { createPanelScale } from './panelScale';

const desktop = createPanelScale(false);
const mobile = createPanelScale(true);

/** 从 token 里取出 h-<n> 的像素数；没有高度就返回 null。 */
const heightOf = (token: string): number | null => {
  const m = token.match(/\bh-(\d+(?:\.\d+)?)\b/);
  return m ? Number(m[1]) * 4 : null;
};

const fontOf = (token: string): string | null => {
  const arbitrary = token.match(/\btext-\[(\d+(?:\.\d+)?)px\]/);
  if (arbitrary) return `${arbitrary[1]}px`;
  const named = token.match(/\btext-(xs|sm|base|lg)\b/);
  if (!named) return null;
  return { xs: '12px', sm: '14px', base: '16px', lg: '18px' }[named[1] as 'xs' | 'sm' | 'base' | 'lg'] ?? null;
};

/**
 * 这两组值就是侧栏面板的全部尺寸真相。之前面板里高度有 9 种、字号有 5 种，
 * 下拉框只有 20px 高，抖动按钮却是 34px / 14px，肉眼就能看出「有的按钮大有的小」。
 */
describe('side panel scale', () => {
  it('gives the desktop sidebar one single control height', () => {
    const heights = new Set(
      [desktop.control, desktop.numberInput, desktop.headerBtn].map(heightOf),
    );
    expect([...heights]).toEqual([32]);
    // 下拉框过去被 sm:h-auto + py-0 压成 20px，必须显式带高度
    expect(desktop.control).toContain('h-8');
    expect(desktop.control).not.toContain('h-auto');
  });

  it('keeps every phone control at or above the 44px touch target', () => {
    for (const token of [mobile.control, mobile.numberInput, mobile.headerBtn, mobile.iconBtn]) {
      expect(heightOf(token)).toBeGreaterThanOrEqual(40);
    }
  });

  it('only uses a three-step type scale on each side', () => {
    const desktopSizes = new Set(
      [desktop.panelTitle, desktop.sectionTitle, desktop.cardTitle, desktop.body, desktop.micro, desktop.control, desktop.primary]
        .map(fontOf)
        .filter(Boolean),
    );
    const mobileSizes = new Set(
      [mobile.panelTitle, mobile.sectionTitle, mobile.cardTitle, mobile.body, mobile.micro, mobile.control, mobile.primary]
        .map(fontOf)
        .filter(Boolean),
    );
    // 13 / 12 / 11 / 10 与 15 / 14 / 13 / 12：都是四级，不再出现 9px 和 14px 混排
    expect(desktopSizes.size).toBeLessThanOrEqual(4);
    expect(mobileSizes.size).toBeLessThanOrEqual(4);
    expect(desktopSizes.has('9px')).toBe(false);
  });

  it('never sizes the desktop panel larger than the phone panel', () => {
    const px = (token: string) => Number(fontOf(token)?.replace('px', '') ?? 0);
    for (const key of ['panelTitle', 'sectionTitle', 'cardTitle', 'body'] as const) {
      expect(px(desktop[key]), key).toBeLessThanOrEqual(px(mobile[key]));
    }
    expect(heightOf(desktop.control)!).toBeLessThan(heightOf(mobile.control)!);
  });

  it('keeps the two-line preset chip taller than a single-line control but not by much', () => {
    expect(heightOf(desktop.chip)!).toBeGreaterThan(heightOf(desktop.control)!);
    expect(heightOf(desktop.chip)!).toBeLessThanOrEqual(heightOf(desktop.control)! + 12);
  });
});
