/**
 * 上传图片的硬门槛。
 *
 * 主流程（智能转拼豆）此前是「只要能 FileReader 读出来就转」：
 * 一张 8000×6000 的手机原图是 4800 万像素，画到 canvas 再逐像素匹配色卡，
 * 移动端直接卡死，而且不给任何提示——用户只会觉得「点了没反应」。
 *
 * 这里只做纯判断，不做 UI，方便单测；文案由调用方按语言选择。
 */

/** 单文件上限：30MB。手机原图普遍 3-8MB，30MB 足够，超过基本是 RAW 或截图拼接。 */
export const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;

/** 解码后的像素上限：4000 万（约 7300×5500）。超过就拒绝，不尝试降采样。 */
export const MAX_UPLOAD_PIXELS = 40_000_000;

export type UploadRejection = 'too-large' | 'too-many-pixels';

/** 读取前的体积判断。 */
export function checkUploadSize(bytes: number): UploadRejection | null {
  if (!Number.isFinite(bytes) || bytes <= 0) return null;
  return bytes > MAX_UPLOAD_BYTES ? 'too-large' : null;
}

/** 解码后的尺寸判断。宽高拿不到（0/NaN）时放行，交给后续流程自己报错。 */
export function checkUploadPixels(width: number, height: number): UploadRejection | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return width * height > MAX_UPLOAD_PIXELS ? 'too-many-pixels' : null;
}

export function describeUploadRejection(reason: UploadRejection, isEn: boolean): string {
  if (reason === 'too-large') {
    return isEn
      ? `This image is over ${MAX_UPLOAD_BYTES / 1024 / 1024} MB. Please compress or crop it first.`
      : `图片超过 ${MAX_UPLOAD_BYTES / 1024 / 1024} MB，请先压缩或裁剪后再上传。`;
  }
  const megapixels = Math.round(MAX_UPLOAD_PIXELS / 1_000_000);
  const wanPixels = Math.round(MAX_UPLOAD_PIXELS / 10_000);
  return isEn
    ? `This image is over ${megapixels} megapixels. Please crop or shrink it first.`
    : `图片超过 ${wanPixels} 万像素，请先裁剪或缩小后再上传。`;
}
