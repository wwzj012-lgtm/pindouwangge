import { describe, expect, it } from 'vitest';
import type { ImportRecognitionCell } from './importRecognition';
import { estimateChannelGains, isClippedRgb } from './importColorBalance';

const cell = (rgb: [number, number, number]): ImportRecognitionCell => ({
  row: 0,
  column: 0,
  status: 'mapped',
  color: null,
  colorId: 'x',
  sampleRgb: rgb,
  distance: 2,
  sampleCount: 16,
  coverage: 16,
  sampledArea: 16,
  dominantRatio: 0.9,
  runnerUpRatio: 0.1,
  confidence: 0.9,
  quality: 'good',
});

const grid = (colors: Array<[number, number, number]>): ImportRecognitionCell[][] => [colors.map(cell)];

describe('white patch channel gains', () => {
  it('refuses to guess when the picture has no near-neutral bright area', () => {
    // 深蓝背景 + 深色衣装：整体均值本来就是蓝的。
    // 灰世界会在这里给出 R1.10 / G1.03 / B0.89，把白珠和肤色一起推黄——本次要杜绝的正是它。
    // 实测原图均值 RGB(86, 92, 107)，而画面里最亮的近中性像素只有 (60, 65, 78) 这种暗调。
    const scene = grid(Array.from({ length: 40 }, (_, index) => (
      index % 5 === 0 ? [40, 52, 70] : [26, 40, 60]
    ) as [number, number, number]));
    expect(estimateChannelGains(scene)).toBeNull();
  });

  it('corrects a warm light when white beads are present', () => {
    // 白珠 210 在暖光下变成 (231, 210, 189)；其余是深色内容，不参与白片。
    const scene = grid([
      [231, 210, 189], [230, 209, 188], [232, 211, 190],
      [229, 208, 187], [231, 210, 190], [228, 207, 186],
      [40, 34, 30], [22, 19, 17], [70, 60, 52], [33, 28, 24],
    ]);
    const gains = estimateChannelGains(scene);
    expect(gains).not.toBeNull();
    // 把红压下来、把蓝抬上去，方向必须对
    expect(gains!.r).toBeLessThan(1);
    expect(gains!.b).toBeGreaterThan(1);
    expect(gains!.g).toBeGreaterThan(0.94);
    expect(gains!.g).toBeLessThan(1.03);
  });

  it('leaves a neutral picture untouched', () => {
    const scene = grid([
      [232, 232, 231], [228, 229, 228], [236, 235, 233],
      [30, 31, 33], [120, 121, 120],
    ]);
    expect(estimateChannelGains(scene)).toBeNull();
  });

  it('refuses when the correction would exceed the allowed range', () => {
    // 深米黄 250/230/180：要拉成中性得把蓝抬 22%，超出 [0.88, 1.14]。
    // 这种幅度更可能是"画面本身就是浅黄"，硬掰只会把作品改色——整体放弃。
    const scene = grid([
      [250, 230, 180], [248, 229, 179], [251, 231, 181],
      [249, 230, 180], [250, 232, 182], [248, 228, 178],
      [60, 55, 48], [40, 38, 33],
    ]);
    expect(estimateChannelGains(scene)).toBeNull();
  });

  it('ignores over-exposed and pure black cells', () => {
    const scene = grid([
      [255, 255, 255], [252, 252, 252], [0, 0, 0],
      [220, 200, 178], [218, 199, 176], [222, 201, 180],
      [219, 200, 177], [221, 200, 179], [217, 198, 175],
      [50, 45, 40], [64, 58, 51], [38, 34, 29],
    ]);
    const gains = estimateChannelGains(scene);
    expect(gains).not.toBeNull();
    expect(isClippedRgb([255, 255, 255])).toBe(true);
    expect(isClippedRgb([220, 200, 178])).toBe(false);
  });
});
