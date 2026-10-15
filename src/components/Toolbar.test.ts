import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Toolbar } from './Toolbar';
import { LanguageProvider } from '../context/LanguageContext';

const noop = () => {};
const props: React.ComponentProps<typeof Toolbar> = {
  activeTool: 'pencil', setActiveTool: noop,
  selectedColor: { id: 'mock', code: 'A1', symbol: 'A1', name: 'A1', brand: 'MARD', hex: '#F5F1C5', rgb: [245, 241, 197] },
  onOpenColorPicker: noop, canUndo: false, canRedo: false, onUndo: () => false, onRedo: () => false,
  zoom: 1, onZoomIn: noop, onZoomOut: noop, onResetZoom: noop,
  beadShape: 'fuse_3d', setBeadShape: noop,
  showSymbols: true, setShowSymbols: noop, showGridLines: true, setShowGridLines: noop,
  showCoordinates: true, setShowCoordinates: noop, symmetryMode: 'none', setSymmetryMode: noop,
  canvasBackdrop: 'dark_grid', setCanvasBackdrop: noop, onClearOuterBackground: noop,
  hasImage: false, showOverlay: false, setShowOverlay: noop, overlayOpacity: 0.3, setOverlayOpacity: noop,
  onSavePattern: noop, isSavingPattern: false, onOpenExport: noop, canExport: false,
  onOpenPatterns: noop,
};
const render = (overrides: Partial<typeof props> = {}) => renderToStaticMarkup(
  React.createElement(LanguageProvider, { children: React.createElement(Toolbar, { ...props, ...overrides }) }),
);

describe('desktop editor toolbar presentation', () => {
  beforeEach(() => vi.stubGlobal('localStorage', { getItem: () => null, setItem: noop }));
  afterEach(() => vi.unstubAllGlobals());

  it('shows the active code once rather than repeating name and symbol', () => {
    const html = render();
    expect(html.match(/>A1</g)).toHaveLength(1);
    expect(html).toContain('aria-label="选择当前颜色"');
  });

  it('exposes common tools, the active shape, symmetry and separate view controls accessibly', () => {
    const html = render({ activeTool: 'rectangle' });
    for (const label of ['画笔', '平移', '填充', '擦除', '吸管', '全图替色', '对称方式', '画布背景', '显示选项', '我的图纸']) {
      expect(html).toContain('aria-label="' + label + '"');
    }
    expect(html).toMatch(/aria-label="形状：矩形"[^>]*aria-pressed="true"/);
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('role="group" aria-label="绘制工具"');
  });

  it('keeps existing history, save and export disabled states', () => {
    const html = render({ isSavingPattern: true });
    for (const label of ['撤销', '重做', '保存', '导出']) {
      expect(html).toMatch(new RegExp('aria-label="' + label + '"[^>]*disabled=""'));
    }
    expect(html).toContain('Ctrl+Z');
    expect(html).toContain('Ctrl+Y');
    expect(html).not.toContain('Ctrl+S');
    expect(html).toContain('保存中');
  });

  it('keeps a long color code complete in the tooltip, including English mode', () => {
    const code = 'LONG-COLOR-CODE-1234567890';
    vi.stubGlobal('localStorage', { getItem: () => 'en', setItem: noop });
    const html = render({ selectedColor: { ...props.selectedColor!, code, name: 'Long English color name' } });
    expect(html).toContain(code);
    expect(html).toContain('aria-label="Select active color"');
    expect(html).toContain('aria-label="Symmetry mode"');
  });
});
