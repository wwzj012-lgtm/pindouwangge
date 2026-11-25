/**
 * 图例面板「识别结果为空但已有行」的渲染回归（2026-11-25 线上崩溃）。
 *
 * 复现路径：用户第一次识别出条目 → 点返回上一步 → 再进来。此时 value.rows
 * 由父组件恢复（非空），面板是重新挂载的、lastParse 为 null。旧代码在提示区
 * 直接读 `lastParse.sourceQuality`，抛
 * `TypeError: Cannot read properties of null (reading 'sourceQuality')`，
 * 被错误边界捕获后整块导入界面变成「豆织里格加载遇到错误」白屏。
 *
 * 契约：lastParse 为 null 时面板必须正常渲染，且不显示"源图质量"提示。
 *
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { ImportLegendPanel, type LegendLockState } from './ImportLegendPanel';
import { BRAND_PALETTES } from '../data/palettes';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const palette = BRAND_PALETTES.MARD.slice(0, 3);

const state: LegendLockState = {
  rows: [
    { code: palette[0]!.code, count: 12, countLocked: false, enabled: true, confidence: 0.8 },
    { code: palette[1]!.code, count: 34, countLocked: false, enabled: true, confidence: 0.7 },
  ],
  whitelist: false,
};

describe('ImportLegendPanel 在 lastParse 为 null 时渲染', () => {
  it('已有行（返回上一步再进来）不会抛错，也不出现源图质量提示', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    expect(() => {
      act(() => {
        root.render(
          <ImportLegendPanel
            imageElement={null}
            dimensions={null}
            calibration={null}
            palette={palette}
            value={state}
            onChange={() => {}}
            legendRegion={null}
            onFrameRequest={() => {}}
            onClearRegion={() => {}}
          />,
        );
      });
    }).not.toThrow();
    expect(container.textContent).not.toContain('识别精度会明显下降');
    act(() => root.unmount());
    container.remove();
  });
});
