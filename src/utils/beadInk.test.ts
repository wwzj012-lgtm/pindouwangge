// beadInk 通用墨色模块单测：全应用唯一入口，锁口径
import { describe, expect, it } from 'vitest';
import { beadInkFor, beadLuma, parseHexRgb } from './beadInk';

describe('parseHexRgb', () => {
  it('6 位 / 3 位 hex 都能解析', () => {
    expect(parseHexRgb('#000000')).toEqual({ r: 0, g: 0, b: 0 });
    expect(parseHexRgb('#fff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseHexRgb('#0B3C43')).toEqual({ r: 11, g: 60, b: 67 });
  });
  it('非法输入返回 null（不伪造通道值）', () => {
    expect(parseHexRgb(undefined)).toBeNull();
    expect(parseHexRgb('nothex')).toBeNull();
    expect(parseHexRgb('#12')).toBeNull();
  });
});

describe('beadLuma', () => {
  it('纯黑 0、纯白 255', () => {
    expect(beadLuma('#000000')).toBe(0);
    expect(beadLuma('#FFFFFF')).toBe(255);
  });
  it('非法输入按最暗 0（历史 `|| 255` 坑的反面教材）', () => {
    expect(beadLuma(undefined)).toBe(0);
  });
});

describe('beadInkFor', () => {
  it('深豆白墨 / 浅豆深墨（真实色板 hex）', () => {
    expect(beadInkFor('#000000')).toBe('rgba(255,255,255,0.92)');
    expect(beadInkFor('#0B3C43')).toBe('rgba(255,255,255,0.92)');
    expect(beadInkFor('#182A84')).toBe('rgba(255,255,255,0.92)');
    expect(beadInkFor('#F2E8CF')).toBe('rgba(15,23,42,0.8)');
    expect(beadInkFor('#FFFFFF')).toBe('rgba(15,23,42,0.8)');
  });
  it('阈值 150：128 灰属深豆、168 灰属浅豆', () => {
    expect(beadInkFor('#808080')).toBe('rgba(255,255,255,0.92)');
    expect(beadInkFor('#A8A8A8')).toBe('rgba(15,23,42,0.8)');
  });
  it('可覆盖墨色（导出纯色 / 向导主题墨）', () => {
    expect(beadInkFor('#000000', { darkInk: '#FFFFFF' })).toBe('#FFFFFF');
    expect(beadInkFor('#FFFFFF', { lightInk: '#271d32' })).toBe('#271d32');
  });
  it('非法 hex 兜底深墨（调用方兜底底色是浅中性色）', () => {
    expect(beadInkFor(undefined)).toBe('rgba(15,23,42,0.8)');
    expect(beadInkFor('nothex')).toBe('rgba(15,23,42,0.8)');
    expect(beadInkFor('#fff')).toBe('rgba(15,23,42,0.8)');
  });
});
