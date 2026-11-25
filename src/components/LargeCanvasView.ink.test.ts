// codeInkFor：色号文字墨色按豆色亮度自适应（2026-11-26 用户反馈 H7 深豆上看不见色号）
import { describe, expect, it } from 'vitest';
import { codeInkFor } from './LargeCanvasView';

describe('codeInkFor（豆色自适应墨色）', () => {
  it('深豆选白墨（真实色板值：H7 纯黑、H6 近黑、B22 深青、D4 深蓝）', () => {
    expect(codeInkFor('#000000')).toContain('255,255,255');
    expect(codeInkFor('#2F2B2F')).toContain('255,255,255');
    expect(codeInkFor('#0B3C43')).toContain('255,255,255');
    expect(codeInkFor('#182A84')).toContain('255,255,255');
  });

  it('浅豆选深墨（M9 米白、H2 纸白、G11 浅灰、兜底色）', () => {
    expect(codeInkFor('#F2E8CF')).toContain('15,23,42');
    expect(codeInkFor('#EDEDED')).toContain('15,23,42');
    expect(codeInkFor('#D8D8D8')).toContain('15,23,42');
    expect(codeInkFor('#CBD5E1')).toContain('15,23,42');
    expect(codeInkFor('#FFFFFF')).toContain('15,23,42');
  });

  it('异常输入兜底走深墨（不炸渲染循环）', () => {
    expect(codeInkFor(undefined)).toContain('15,23,42');
    expect(codeInkFor('#fff')).toContain('15,23,42');
    expect(codeInkFor('nothex')).toContain('15,23,42');
  });

  it('中等亮度边界两侧分属黑白（阈值 150 与向导 swatchInk 同口径）', () => {
    // 0.299*128+0.587*128+0.114*128 = 128 < 150 → 白墨
    expect(codeInkFor('#808080')).toContain('255,255,255');
    // 0.299*168+0.587*168+0.114*168 = 168 ≥ 150 → 深墨
    expect(codeInkFor('#A8A8A8')).toContain('15,23,42');
  });
});
