import { describe, expect, it } from 'vitest';
import {
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_PIXELS,
  checkUploadPixels,
  checkUploadSize,
  describeUploadRejection,
} from './uploadGuards';

/**
 * 这几条对应的是「上传后没反应」那一类线上体验：不是崩溃，是卡死且无提示。
 * 门槛必须在下发 FileReader 之前就判断完，不能等画到 canvas 才失败。
 */
describe('image upload guards', () => {
  it('accepts ordinary phone photos', () => {
    // 12MP 手机原图 ≈ 4MB，属于最常见的输入
    expect(checkUploadSize(4 * 1024 * 1024)).toBeNull();
    expect(checkUploadPixels(4032, 3024)).toBeNull();
  });

  it('rejects files over the byte ceiling', () => {
    expect(checkUploadSize(MAX_UPLOAD_BYTES + 1)).toBe('too-large');
    expect(checkUploadSize(MAX_UPLOAD_BYTES)).toBeNull();
  });

  it('rejects decoded images over the pixel ceiling', () => {
    expect(checkUploadPixels(8000, 6000)).toBe('too-many-pixels'); // 48MP
    expect(checkUploadPixels(7300, 5400)).toBeNull(); // 39.4MP
  });

  it('lets unknown or broken dimensions through instead of blocking the upload', () => {
    // 宽高读不出来时不要抢着拒绝——后续 img.onerror 会给出真正的错误
    expect(checkUploadPixels(0, 0)).toBeNull();
    expect(checkUploadPixels(Number.NaN, 100)).toBeNull();
    expect(checkUploadSize(Number.NaN)).toBeNull();
    expect(checkUploadSize(0)).toBeNull();
  });

  it('tells the user which limit was hit, in their language', () => {
    expect(describeUploadRejection('too-large', false)).toContain('30 MB');
    expect(describeUploadRejection('too-many-pixels', false)).toContain('4000 万像素');
    expect(describeUploadRejection('too-large', true)).toContain('30 MB');
    expect(describeUploadRejection('too-many-pixels', true)).toContain('40 megapixels');
  });
});
