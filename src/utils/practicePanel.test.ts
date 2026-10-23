import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { UserProfileModal } from '../components/UserProfileModal';
import { PracticePanel, type PracticePanelProps } from '../components/PracticePanel';
import type { BeadColor } from '../types';

const color: BeadColor = { id: 'COCO_SECRET987', code: 'SECRET987', name: '隐藏颜色', brand: 'COCO', hex: '#123456', rgb: [18, 52, 86] };
const props: PracticePanelProps = {
  grid: [[color.id, null, color.id]], paletteMap: new Map([[color.id, color]]),
  workKey: 'work', userId: 'user', detailsUnlocked: false, activeColorId: color.id,
  onHighlightColor: () => {}, onClose: () => {}, onOpenInventory: () => {},
};

describe('practice panel detail gate', () => {
  it('shows one useful empty state instead of zero-value stats and disabled tools', () => {
    const html = renderToStaticMarkup(createElement(PracticePanel, { ...props, grid: [], detailsUnlocked: true }));
    expect(html).toContain('从一张图纸开始');
    expect(html).toContain('返回画板');
    expect(html).not.toContain('匹配库存');
    expect(html).not.toContain('type="search"');
    expect(html).not.toContain('复制补货清单');
  });
  it('renders only aggregate counts and the unlock message, with no hidden DOM or clipboard outlet', () => {
    const html = renderToStaticMarkup(createElement(PracticePanel, props));
    expect(html).toContain('解锁后开启实操');
    expect(html).toContain('作品用豆');
    expect(html).toContain('使用颜色');
    expect(html).not.toContain(color.code);
    expect(html).not.toContain(color.name);
    expect(html).not.toContain(color.id);
    expect(html).not.toContain(color.hex);
    expect(html).not.toContain('textarea');
    expect(html).not.toContain('type="search"');
    expect(html).not.toContain('复制补货清单');
    expect(html).not.toContain('开始计时');
  });

  it('renders explicit missing stock, need, remaining and shortage only after unlock', () => {
    const html = renderToStaticMarkup(createElement(PracticePanel, { ...props, detailsUnlocked: true }));
    for (const text of [color.code, color.name, '未录入', '需求', '预计剩余', '缺口', '缺 2', '复制补货清单', '开始计时']) expect(html).toContain(text);
    expect(html).toContain('aria-pressed="true"');
    expect(html).not.toContain('解锁后开启实操');
  });
});

describe('profile initial inventory tab', () => {
  it('opens directly into inventory when initialTab is inventory', () => {
    const html = renderToStaticMarkup(createElement(UserProfileModal, {
      isOpen: true, initialTab: 'inventory', onClose: () => {}, onOpenAccountManagement: () => {},
    }));
    expect(html).toContain('豆仓 · 我的库存');
  });

  it('preserves the existing library default', () => {
    const html = renderToStaticMarkup(createElement(UserProfileModal, {
      isOpen: true, onClose: () => {}, onOpenAccountManagement: () => {},
    }));
    expect(html).not.toContain('豆仓 · 我的库存');
  });
});
