import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { UserProfileModal } from '../components/UserProfileModal';
import { PracticePanel, type PracticePanelProps, type PracticePanelProgress } from '../components/PracticePanel';
import type { BeadColor } from '../types';
import { practiceSectionLabel } from './practiceProgress';

const color: BeadColor = { id: 'COCO_SECRET987', code: 'SECRET987', name: '隐藏颜色', brand: 'COCO', hex: '#123456', rgb: [18, 52, 86] };
const props: PracticePanelProps = {
  grid: [[color.id, null, color.id]], paletteMap: new Map([[color.id, color]]),
  workKey: 'work', userId: 'user', detailsUnlocked: false, activeColorId: color.id,
  onHighlightColor: () => {}, onClose: () => {}, onOpenInventory: () => {},
};

describe('practice panel detail gate', () => {
  it('shows one useful empty state instead of zero-value stats and disabled tools', () => {
    const html = renderToStaticMarkup(createElement(PracticePanel, { ...props, grid: [], detailsUnlocked: true }));
    // A pattern with no beads must never send the user off to draw one.
    expect(html).toContain('这张图纸还没有豆子');
    expect(html).toContain('换一张有内容的图纸开始拼豆');
    expect(html).toContain('>返回</button>');
    expect(html).not.toContain('先在画板中绘制');
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

describe('practice progress and section cards', () => {
  const progress: PracticePanelProgress = {
    total: 6, placed: 2,
    sections: [
      { col: 0, row: 0, label: 'A1', x: 0, y: 0, width: 2, height: 1, beads: 4, placed: 2 },
      { col: 1, row: 0, label: 'A2', x: 2, y: 0, width: 1, height: 1, beads: 2, placed: 0 },
      { col: 0, row: 1, label: 'B1', x: 0, y: 1, width: 3, height: 1, beads: 0, placed: 0 },
    ],
    sectionSize: 20, focusedSection: 'A2', hasNext: true, canUndo: true, persistenceAvailable: true,
    onToggleSectionSize: () => {}, onFocusSection: () => {}, onNextSection: () => {},
    onUndo: () => {}, onLocateNext: () => {}, onReset: () => {},
  };
  // 40 columns / 20-cell blocks = 2 real block columns, matching A1 + A2.
  const wideProps: PracticePanelProps = {
    ...props,
    grid: Array.from({ length: 2 }, () => Array.from({ length: 40 }, () => color.id)),
  };

  it('renders total progress, the current section and one button per section', () => {
    const html = renderToStaticMarkup(createElement(PracticePanel, { ...wideProps, detailsUnlocked: true, progress }));
    expect(html).toContain('拼豆进度');
    expect(html).toContain('已拼 <strong>2</strong> / 6（33%）');
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuemax="6"');
    expect(html).toContain('aria-valuenow="2"');
    expect(html).toContain('A2 · 需 2 粒 · 已拼 0');
    expect(html).toContain('撤销上一颗');
    expect(html).toContain('定位下一颗');
    expect(html).toContain('重置进度');
    expect(html).toContain('区块推进');
    for (const label of ['A1', 'A2', 'B1']) expect(html).toContain(`>${label}</span>`);
    // Bead-free blocks stay clickable (they answer with a hint) and read as "—".
    expect(html).toContain('区块 B1，无豆，可直接跳过');
    expect(html).toContain('is-empty');
    expect(html).toContain('待拼');
    expect(html).toContain('aria-pressed="true"');
    // The minimap grid mirrors the real geometry: 40 cells / 20 = 2 columns.
    expect(html).toContain('--minimap-cols:2');
  });

  it('omits the progress cards when no binding is supplied', () => {
    const html = renderToStaticMarkup(createElement(PracticePanel, { ...props, detailsUnlocked: true }));
    expect(html).not.toContain('拼豆进度');
    expect(html).not.toContain('role="progressbar"');
    expect(html).not.toContain('practice-progress-dialog');
  });

  it('swaps "locate next" for a disabled "already finished" label when nothing is left', () => {
    const html = renderToStaticMarkup(createElement(PracticePanel, {
      ...wideProps, detailsUnlocked: true,
      progress: { ...progress, placed: 6, hasNext: false, canUndo: false },
    }));
    expect(html).toContain('已全部拼完');
    expect(html).not.toContain('定位下一颗');
    expect(html).toContain('已拼 <strong>6</strong> / 6（100%）');
    expect(html).toContain('待拼 0 粒');
  });

  it('falls back to a grouped dropdown that still lists every block', () => {
    const sections = Array.from({ length: 420 }, (_, index) => {
      const col = index % 140;
      const row = Math.floor(index / 140);
      return {
        col, row, label: practiceSectionLabel(col, row),
        x: col * 10, y: row * 10, width: 10, height: 10, beads: 1, placed: 0,
      };
    });
    const html = renderToStaticMarkup(createElement(PracticePanel, {
      ...wideProps, detailsUnlocked: true,
      progress: { ...progress, sections, focusedSection: null },
    }));
    expect(html).toContain('<optgroup label="A 行">');
    expect(html).toContain('<optgroup label="B 行">');
    expect(html).toContain('<optgroup label="C 行">');
    // The very last block is reachable: nothing is truncated.
    expect(html).toContain('C140');
    expect(html).not.toContain('仅列出前');
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
