import { describe, expect, it } from 'vitest';
import { cropPixels, judgeCountConfidence, measureSourceSharpness } from './importLegend';
import { parseEntriesToRows } from '../components/ImportLegendPanel';

/**
 * 数量置信判定（2026-11-25 路线2）契约。
 *
 * 背景：card2 这类缩略图字太小+水印粘连，读出的数字**自信且错**（44 而真值
 * 11、443 而真值 26），比"读不出"更有害。逐条目指标全部实测无区分度（原生
 * 字宽、水印占比、粘连宽度、模板距离、±1px 微扰、填充率、放大后锐度），
 * 唯一可用的判据是**整图清晰度**——所以这里的断言锁的是：
 *   1. 只有「源图糊」才翻 review 标记；
 *   2. 其它诊断指标不得单独触发（否则会把 card1 62/62 全对行也标成待核对）；
 *   3. 没有清晰度信息时不误报。
 */
describe('judgeCountConfidence', () => {
  const base = { digitW: 17, glyphWidths: [18, 19], digitDistances: [0.1] };

  it('源图清晰度低于门（card2 实测 1339）→ 待复核，原因是 blurrySource', () => {
    const v = judgeCountConfidence({ ...base, sourceSharpness: 1339 });
    expect(v.review).toBe(true);
    expect(v.reasons).toContain('blurrySource');
  });

  it('源图清晰（card1 8389 / card3 15171）→ 不待复核，即使字小、水印、粘连全都命中', () => {
    const v = judgeCountConfidence({
      ...base,
      glyphWidths: [18, 40],
      watermarkRatio: 0.34,
      digitDistances: [0.3],
      unstableDigits: 2,
      sourceSharpness: 8389,
    });
    expect(v.review).toBe(false);
    // 诊断原因照常记录（供排查），但不作为触发条件。
    expect(v.reasons).toContain('tinyGlyph');
    expect(v.reasons).toContain('watermark');
  });

  it('没有清晰度信息（0=未测）时不误报', () => {
    const v = judgeCountConfidence({ ...base, sourceSharpness: 0 });
    expect(v.review).toBe(false);
  });

  it('card4 实测 4798 落在门下 → 待复核（其数量本就是 4/22）', () => {
    const v = judgeCountConfidence({ ...base, sourceSharpness: 4798 });
    expect(v.review).toBe(true);
  });

  it('指标原样回传，便于 UI/台账解释', () => {
    const v = judgeCountConfidence({ ...base, watermarkRatio: 0.2, unstableDigits: 1, sourceSharpness: 9000 });
    expect(v.nativeCharPx).toBeCloseTo(17 / 4, 5);
    expect(v.watermarkRatio).toBeCloseTo(0.2, 5);
    expect(v.unstableDigits).toBe(1);
    expect(v.sourceSharpness).toBe(9000);
  });
});

describe('measureSourceSharpness', () => {
  /** w×h 灰度图：8px 周期方波条纹（模拟排字边缘）。 */
  const makeStripes = (w: number, h: number) => {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const v = (x % 8) < 4 ? 25 : 230;
        const i = (y * w + x) * 4;
        data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255;
      }
    }
    return { data, width: w, height: h };
  };
  /** 3×3 均值模糊（模拟重采样/压缩糊化）。 */
  const boxBlur = (img: { data: Uint8ClampedArray; width: number; height: number }) => {
    const { data, width, height } = img;
    const out = new Uint8ClampedArray(data.length);
    const at = (x: number, y: number) => data[(Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))) * 4];
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let sum = 0;
        for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) sum += at(x + dx, y + dy);
        const v = Math.round(sum / 9);
        const i = (y * width + x) * 4;
        out[i] = v; out[i + 1] = v; out[i + 2] = v; out[i + 3] = 255;
      }
    }
    return { data: out, width, height };
  };

  it('同一张图被 3×3 模糊后，清晰度必须显著下降', () => {
    const sharp = measureSourceSharpness(makeStripes(120, 40));
    const soft = measureSourceSharpness(boxBlur(makeStripes(120, 40)));
    expect(sharp).toBeGreaterThan(0);
    expect(soft).toBeLessThan(sharp * 0.6);
  });

  it('过小的图返回 0（不参与判定）', () => {
    expect(measureSourceSharpness(makeStripes(4, 4))).toBe(0);
  });
});

describe('parseEntriesToRows 待核对分支', () => {
  const paletteCodes = new Set(['A1', 'H5']);
  const review = {
    review: true,
    reasons: ['blurrySource'] as const,
    nativeCharPx: 4.25,
    watermarkRatio: 0.2,
    maxGlyphRatio: 1.1,
    meanDistance: 0.1,
    unstableDigits: 0,
    edgeSoftness: 0.5,
    sourceSharpness: 1339,
  };

  it('待核对行：不把猜测值当结果（count 置 0 + 保留原因）', () => {
    const rows = parseEntriesToRows(
      [{ code: 'A1', count: 44, confidence: 0.6, warn: 'countLowConfidence', countReview: { ...review, reasons: ['blurrySource'] } }],
      paletteCodes,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(0);
    expect(rows[0].countReview?.reasons).toContain('blurrySource');
  });

  it('普通行：数量原样透传，不带 countReview', () => {
    const rows = parseEntriesToRows([{ code: 'H5', count: 36, confidence: 0.9 }], paletteCodes);
    expect(rows[0].count).toBe(36);
    expect(rows[0].countReview).toBeUndefined();
  });
});

describe('框选不缩放契约（路线1）', () => {
  it('cropPixels 是纯像素拷贝：尺寸等于框大小、字节等于原图对应区域', () => {
    const width = 10, height = 8;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i += 1) {
      data[i * 4] = i % 251;
      data[i * 4 + 1] = (i * 3) % 253;
      data[i * 4 + 2] = (i * 7) % 255;
      data[i * 4 + 3] = 255;
    }
    const source = { data, width, height };
    const cropped = cropPixels(source, 2, 3, 6, 5);
    expect(cropped.width).toBe(5);
    expect(cropped.height).toBe(3);
    for (let y = 0; y < cropped.height; y += 1) {
      for (let x = 0; x < cropped.width; x += 1) {
        const si = ((y + 3) * width + (x + 2)) * 4;
        const ci = (y * cropped.width + x) * 4;
        expect(cropped.data[ci]).toBe(data[si]);
        expect(cropped.data[ci + 1]).toBe(data[si + 1]);
        expect(cropped.data[ci + 2]).toBe(data[si + 2]);
      }
    }
  });
});
