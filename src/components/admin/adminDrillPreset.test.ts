import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DRILL_PRESET_PARAM, clearDrillPreset, codeStatusFromPreset, communityTabFromPreset,
  drillPresetFromLocation, parseDrillPreset, readDrillPreset,
} from './adminDrillPreset';
import { todoDrillQuery } from './adminDashboardModel';

/**
 * QA B11 回归：仪表盘待办卡写进 URL 的 `preset=...` 必须被目标模块消费。
 * 这里把「生产端 todoDrillQuery → 消费端 communityTabFromPreset/codeStatusFromPreset」
 * 串成一条断言链：任何一端改名/漏接都会红。
 */

describe('drill preset parsing', () => {
  it('accepts exactly the three presets the dashboard cards emit', () => {
    expect(parseDrillPreset('review-queue')).toBe('review-queue');
    expect(parseDrillPreset('reports')).toBe('reports');
    expect(parseDrillPreset('low-stock')).toBe('low-stock');
    expect(parseDrillPreset(' review-queue ')).toBe('review-queue');
  });
  it('returns null for unknown presets instead of guessing a tab', () => {
    for (const raw of [null, undefined, '', 'queue', 'REPORTS', 'lowstock', 'reports,queue']) {
      expect(parseDrillPreset(raw)).toBeNull();
    }
  });
  it('reads the preset out of a query string without touching window', () => {
    expect(readDrillPreset('?section=community&preset=reports')).toBe('reports');
    expect(readDrillPreset('section=community&preset=review-queue')).toBe('review-queue');
    expect(readDrillPreset('?section=codes&preset=low-stock')).toBe('low-stock');
    expect(readDrillPreset('?section=codes')).toBeNull();
    expect(readDrillPreset('')).toBeNull();
    expect(readDrillPreset(null)).toBeNull();
  });
  it('tolerates a missing browser location (SSR / renderToStaticMarkup)', () => {
    expect(drillPresetFromLocation()).toBeNull();
  });
});

describe('drill preset → target module initial state (B11 loop closes)', () => {
  it('opens the review queue tab for the 待审核帖子 card', () => {
    const query = todoDrillQuery('reviews');
    expect(query[DRILL_PRESET_PARAM]).toBe('review-queue');
    expect(communityTabFromPreset(parseDrillPreset(query[DRILL_PRESET_PARAM]))).toBe('queue');
  });
  it('opens the reports tab for the 待处理举报 card', () => {
    const query = todoDrillQuery('reports');
    expect(query[DRILL_PRESET_PARAM]).toBe('reports');
    expect(communityTabFromPreset(parseDrillPreset(query[DRILL_PRESET_PARAM]))).toBe('reports');
  });
  it('filters the codes list to available stock for the 兑换码库存 card', () => {
    const query = todoDrillQuery('codes');
    expect(query[DRILL_PRESET_PARAM]).toBe('low-stock');
    expect(codeStatusFromPreset(parseDrillPreset(query[DRILL_PRESET_PARAM]))).toBe('available');
  });
  it('leaves the default tab/filter alone for unrelated or absent presets', () => {
    // 社区页不会因为兑换码 preset 而跳页签；兑换码页也不会因为审核 preset 而筛可用。
    expect(communityTabFromPreset(parseDrillPreset('low-stock'))).toBeNull();
    expect(communityTabFromPreset(null)).toBeNull();
    expect(codeStatusFromPreset(parseDrillPreset('review-queue'))).toBeNull();
    expect(codeStatusFromPreset(parseDrillPreset('reports'))).toBeNull();
    expect(codeStatusFromPreset(null)).toBeNull();
  });
});

describe('drill preset is actually wired into the target components', () => {
  const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');
  it('community page initialises its tab from the preset', () => {
    const source = read('./AdminCommunityPosts.tsx');
    expect(source).toContain("from './adminDrillPreset'");
    expect(source).toContain('useState<AdminCommunityTab>(() => communityTabFromPreset(drillPresetFromLocation()) ?? ');
  });
  it('clears the preset once the operator switches tab / status filter', () => {
    // 首次进入生效，但用户自己切页签/改筛选后要把 preset 抹掉，避免刷新又被劫持。
    expect(read('./AdminCommunityPosts.tsx')).toContain("setTab(value); setTabMessage(''); clearDrillPreset();");
    const codes = read('./AdminLogsCodes.tsx');
    expect(codes).toContain('clearDrillPreset(); setDraft(value => ({ ...value, status:');
    expect(codes).toContain('clearDrillPreset(); setDraft(emptyCodeQuery());');
  });
  it('codes page initialises its status filter from the preset', () => {
    const source = read('./AdminLogsCodes.tsx');
    expect(source).toContain("from './adminDrillPreset'");
    expect(source).toContain('const initialCodeQuery = (): CodeQuery =>');
    expect(source).toContain('useState(initialCodeQuery)');
  });
});

describe('preset lifetime: applies on entry, clears when the user takes over', () => {
  const originalWindow = (globalThis as { window?: unknown }).window;
  afterEach(() => { (globalThis as { window?: unknown }).window = originalWindow; });

  const stubWindow = (href: string) => {
    const replaced: string[] = [];
    (globalThis as { window?: unknown }).window = {
      location: { href, search: new URL(href).search },
      history: { state: { keep: true }, replaceState: (_state: unknown, _title: string, url: URL) => { replaced.push(url.toString()); } },
    };
    return replaced;
  };

  it('removes the preset from the URL after a tab/filter switch, keeping other params', () => {
    const replaced = stubWindow('https://admin.test/?section=community&preset=reports');
    clearDrillPreset();
    expect(replaced).toHaveLength(1);
    expect(replaced[0]).not.toContain('preset=');
    expect(replaced[0]).toContain('section=community');
  });

  it('does nothing (no history write) when there is no preset to clear', () => {
    const replaced = stubWindow('https://admin.test/?section=community');
    clearDrillPreset();
    expect(replaced).toHaveLength(0);
  });

  it('is a no-op without a window (SSR)', () => {
    (globalThis as { window?: unknown }).window = undefined;
    expect(() => clearDrillPreset()).not.toThrow();
  });
});
