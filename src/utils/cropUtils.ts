/**
 * Smart Auto-Crop Utility for Perler Bead Pattern Generation
 * Automatically detects the main subject/character in an image by removing
 * blank, transparent, or solid outer background margins (e.g. large black/white borders).
 * This maximizes grid resolution for the main subject while drastically reducing required bead count!
 */

export interface CropResult {
  croppedCanvas: HTMLCanvasElement;
  croppedImage: HTMLImageElement;
  cropBox: { x: number; y: number; w: number; h: number };
  originalSize: { w: number; h: number };
  savedPixelRatioPercent: number; // e.g. 45 -> 45% background area saved!
}

export async function smartCropSubject(
  sourceImg: HTMLImageElement | HTMLCanvasElement,
  marginPercent: number = 0.03
): Promise<CropResult | null> {
  const origW = 'naturalWidth' in sourceImg ? sourceImg.naturalWidth || sourceImg.width : sourceImg.width;
  const origH = 'naturalHeight' in sourceImg ? sourceImg.naturalHeight || sourceImg.height : sourceImg.height;

  if (origW < 10 || origH < 10) return null;

  // Render to offscreen canvas
  const canvas = document.createElement('canvas');
  canvas.width = origW;
  canvas.height = origH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  ctx.drawImage(sourceImg, 0, 0);
  const imgData = ctx.getImageData(0, 0, origW, origH);
  const data = imgData.data;

  // Sample 8 outer edge points to detect background color
  const corners = [
    [0, 0],
    [origW - 1, 0],
    [0, origH - 1],
    [origW - 1, origH - 1],
    [Math.floor(origW / 2), 0],
    [Math.floor(origW / 2), origH - 1],
    [0, Math.floor(origH / 2)],
    [origW - 1, Math.floor(origH / 2)],
  ];

  let sumR = 0, sumG = 0, sumB = 0, bgCount = 0;
  for (const [cx, cy] of corners) {
    const idx = (cy * origW + cx) * 4;
    const a = data[idx + 3];
    if (a > 30) {
      sumR += data[idx];
      sumG += data[idx + 1];
      sumB += data[idx + 2];
      bgCount++;
    }
  }

  const bgR = bgCount > 0 ? sumR / bgCount : 0;
  const bgG = bgCount > 0 ? sumG / bgCount : 0;
  const bgB = bgCount > 0 ? sumB / bgCount : 0;

  // Check if pixel is background
  const isBackground = (x: number, y: number): boolean => {
    const idx = (y * origW + x) * 4;
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    const a = data[idx + 3];

    // Transparent
    if (a < 30) return true;

    // Matches corner background color
    if (bgCount > 0) {
      const diff = Math.hypot(r - bgR, g - bgG, b - bgB);
      if (diff < 45) return true;
    }

    // Pure black / dark margin (#000000 - #1C1C1C)
    if (bgR < 35 && bgG < 35 && bgB < 35) {
      if (r < 28 && g < 28 && b < 28) return true;
    }

    // Pure white / light margin (#F2F2F2 - #FFFFFF)
    if (bgR > 220 && bgG > 220 && bgB > 220) {
      if (r > 225 && g > 225 && b > 225) return true;
    }

    return false;
  };

  // Find bounding box
  let minX = origW, maxX = 0, minY = origH, maxY = 0;
  let foundAny = false;

  for (let y = 0; y < origH; y++) {
    for (let x = 0; x < origW; x++) {
      if (!isBackground(x, y)) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        foundAny = true;
      }
    }
  }

  if (!foundAny || maxX <= minX || maxY <= minY) {
    return null;
  }

  // Add slight margin around subject
  const marginX = Math.round(origW * marginPercent);
  const marginY = Math.round(origH * marginPercent);

  const cropX = Math.max(0, minX - marginX);
  const cropY = Math.max(0, minY - marginY);
  const cropW = Math.min(origW - cropX, (maxX - minX + 1) + marginX * 2);
  const cropH = Math.min(origH - cropY, (maxY - minY + 1) + marginY * 2);

  // If crop is practically the same size (> 96% area), no need to crop
  const cropArea = cropW * cropH;
  const origArea = origW * origH;
  if (cropArea / origArea > 0.96) {
    return null;
  }

  // Draw cropped image
  const croppedCanvas = document.createElement('canvas');
  croppedCanvas.width = cropW;
  croppedCanvas.height = cropH;
  const croppedCtx = croppedCanvas.getContext('2d');
  if (!croppedCtx) return null;

  croppedCtx.drawImage(
    sourceImg,
    cropX, cropY, cropW, cropH,
    0, 0, cropW, cropH
  );

  const croppedImage = new Image();
  await new Promise((resolve) => {
    croppedImage.onload = resolve;
    croppedImage.src = croppedCanvas.toDataURL('image/png');
  });

  const savedPixelPercent = Math.round((1 - cropArea / origArea) * 100);

  return {
    croppedCanvas,
    croppedImage,
    cropBox: { x: cropX, y: cropY, w: cropW, h: cropH },
    originalSize: { w: origW, h: origH },
    savedPixelRatioPercent: savedPixelPercent,
  };
}
