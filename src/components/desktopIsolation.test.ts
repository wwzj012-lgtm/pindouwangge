import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8');

/**
 * The mobile pass of the UI rework touched shared components (HomeView,
 * SettingsPanel, StatsPanel). Every mobile-only size must be paired with a
 * desktop counterpart, otherwise the phone scale leaks into the desktop layout
 * — which is exactly how the desktop hero headline once ended up at 16px.
 */
describe('desktop layout is insulated from the mobile type scale', () => {
  const home = read('./HomeView.tsx');
  const settings = read('./SettingsPanel.tsx');
  const stats = read('./StatsPanel.tsx');
  const app = read('../App.tsx');

  it('keeps the hero headline sized for desktop instead of overriding it to a phone size', () => {
    const headline = home.split('\n').find(line => line.includes('<h1'));
    expect(headline).toBeDefined();
    expect(headline).toContain('text-[22px]');
    expect(headline).toContain('lg:text-5xl');
    // A second lg:text-[..px] on the same element wins over lg:text-5xl
    // depending on utilities order — the hero collapsed to 16px that way.
    expect(headline).not.toMatch(/lg:text-\[\d/);
  });

  it('routes every control size in the side panels through the shared scale', () => {
    // 两个面板曾经各自用 `h-11 sm:h-auto sm:min-h-0`、裸 `h-12`、`text-sm` 互相打架，
    // 桌面侧栏里出现 16/20/23/25/30/32/34/44/48px 九种控件高度，下拉框被压成 20px。
    // 现在只允许从 ui/panelScale 取尺寸，断点类不得再承担控件尺寸。
    for (const [name, source] of [['SettingsPanel', settings], ['StatsPanel', stats]] as const) {
      expect(source, name).toContain('createPanelScale');
      expect(source, name).not.toMatch(/\bsm:h-(auto|1[12])\b/);
      expect(source, name).not.toMatch(/\bsm:min-h-0\b/);
      expect(source, name).not.toMatch(/\bmin-h-11\b/);
      // 控件高度必须是整数 token，不允许在 JSX 里写死 h-11 / h-12
      expect(source, name).not.toMatch(/className=[^>]*\bh-1[12]\b/);
    }
  });

  it('keeps offline catalog feedback in a fixed, accessible toast outside the layout', () => {
    const toast = app.match(/\{catalogToast && <div data-brand-catalog-toast[\s\S]*?<\/div>\}/)?.[0];
    expect(toast).toBeDefined();
    expect(toast).toContain('data-brand-catalog-toast');
    expect(toast).toContain('role="status"');
    expect(toast).toContain('aria-live="polite"');
    // Fixed positioning keeps the transient notice out of the flex layout; its
    // dimensions must not inherit the retired banner's phone/desktop heights.
    expect(toast).toMatch(/className="fixed\b/);
    expect(toast).not.toMatch(/\b(?:h-11|lg:h-7)\b/);
    expect(toast).not.toContain('border-amber-300 bg-white');
  });

  it('deduplicates catalog notices by key and expires only the matching toast after two seconds', () => {
    const showToast = app.match(
      /const showCatalogToast = useCallback\(\(key(?:\s*:\s*string)?,\s*message(?:\s*:\s*string)?,\s*force = false\) => \{[\s\S]*?\n  \}, \[\]\);/,
    )?.[0];
    expect(showToast).toBeDefined();
    expect(showToast).toContain('if (!force && lastCatalogToastKeyRef.current === key) return;');
    expect(showToast).toContain('lastCatalogToastKeyRef.current = key;');
    expect(showToast).toMatch(/setTimeout\(\(\) => \{\s*setCatalogToast\(current => current\?\.key === key \? null : current\);[\s\S]*?\}, 2000\);/);
  });

  it('reports offline catalog fallback without blocking conversion behind a banner', () => {
    const offlineGate = app.match(
      /if \(brandCatalog\.origin === 'offline' && brandCatalog\.backgroundError\) \{[\s\S]*?\n    \}/,
    )?.[0];
    expect(offlineGate).toBeDefined();
    expect(offlineGate).toContain("showCatalogToast('offline:' + brandCatalog.source");
    expect(offlineGate).toContain('新转换仍可继续');
    expect(offlineGate).not.toMatch(/setIsConverting|throw\s|return\s+false/);
  });

  it('never lets the panel flex column squash its children', () => {
    // 侧栏是 flex flex-col h-full：内容一旦超出，所有子元素默认 flex-shrink:1 会被一起压扁。
    // 底部「重新计算拼豆图纸」因此从 36px 被压到 16px（只剩内容高度），看起来像被切掉。
    // 溢出应该交给 overflow-y-auto 滚动，而不是把每个控件压短。
    expect(settings).toContain('[&>*]:shrink-0');
  });

  it('never lets header or toolbar labels wrap into a vertical stack', () => {
    // 1280 下导航只有 50px 宽却 52px 高——四个字被压成一字一行，
    // 工具条的「形状 / 视图 / 辅助」同样折成两行。原因是这些按钮没有 shrink-0，
    // 空间不够时先被压窄再折行。宽度不够应该整个隐藏文字（min-[1300px]），而不是折行。
    const header = read('./Header.tsx');
    const toolbar = read('./Toolbar.tsx');
    const navButtons = header.split('\n').filter(line => line.includes('px-3.5 py-1.5 rounded-xl text-sm font-extrabold'));
    expect(navButtons.length).toBeGreaterThanOrEqual(4);
    for (const line of navButtons) {
      expect(line).toContain('shrink-0');
      expect(line).toContain('whitespace-nowrap');
    }
    const base = toolbar.split('\n').find(line => line.includes('const buttonBase'));
    expect(base).toContain('shrink-0');
    expect(base).toContain('whitespace-nowrap');
  });
});
