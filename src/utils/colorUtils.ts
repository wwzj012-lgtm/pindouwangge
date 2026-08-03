import { BeadColor, ConvertSettings, ColorMatchAlgo } from '../types';

// Helper: Convert sRGB component (0-255) to Linear RGB (0.0-1.0)
export function srgbToLinear(c: number): number {
  const norm = c / 255;
  return norm <= 0.04045 ? norm / 12.92 : Math.pow((norm + 0.055) / 1.055, 2.4);
}

// Helper: Convert Linear RGB (0.0-1.0) back to sRGB (0-255)
export function linearToSrgb(c: number): number {
  const clamped = Math.max(0, Math.min(1, c));
  const srgb = clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
  return Math.min(255, Math.max(0, Math.round(srgb * 255)));
}

// 1. Convert RGB to CIELAB (D65 White Point)
export function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  let rN = srgbToLinear(r);
  let gN = srgbToLinear(g);
  let bN = srgbToLinear(b);

  let x = (rN * 0.4124 + gN * 0.3576 + bN * 0.1805) * 100;
  let y = (rN * 0.2126 + gN * 0.7152 + bN * 0.0722) * 100;
  let z = (rN * 0.0193 + gN * 0.1192 + bN * 0.9505) * 100;

  // Reference White D65
  x /= 95.047;
  y /= 100.000;
  z /= 108.883;

  x = x > 0.008856 ? Math.pow(x, 1 / 3) : (7.787 * x) + (16 / 116);
  y = y > 0.008856 ? Math.pow(y, 1 / 3) : (7.787 * y) + (16 / 116);
  z = z > 0.008856 ? Math.pow(z, 1 / 3) : (7.787 * z) + (16 / 116);

  const L = (116 * y) - 16;
  const a = 500 * (x - y);
  const B = 200 * (y - z);

  return [L, a, B];
}

// 2. Exact CIEDE2000 Delta E Calculation with customizable weighting factors
export function deltaE2000(
  lab1: [number, number, number],
  lab2: [number, number, number],
  kL = 1,
  kC = 1,
  kH = 1
): number {
  const [L1, a1, b1] = lab1;
  const [L2, a2, b2] = lab2;

  const C1 = Math.sqrt(a1 * a1 + b1 * b1);
  const C2 = Math.sqrt(a2 * a2 + b2 * b2);

  const C_bar = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Math.pow(C_bar, 7) / (Math.pow(C_bar, 7) + Math.pow(25, 7))));

  const a1_prime = (1 + G) * a1;
  const a2_prime = (1 + G) * a2;

  const C1_prime = Math.sqrt(a1_prime * a1_prime + b1 * b1);
  const C2_prime = Math.sqrt(a2_prime * a2_prime + b2 * b2);

  let h1_prime = (Math.atan2(b1, a1_prime) * 180) / Math.PI;
  if (h1_prime < 0) h1_prime += 360;

  let h2_prime = (Math.atan2(b2, a2_prime) * 180) / Math.PI;
  if (h2_prime < 0) h2_prime += 360;

  const delta_L_prime = L2 - L1;
  const delta_C_prime = C2_prime - C1_prime;

  let delta_h_prime = 0;
  if (C1_prime * C2_prime !== 0) {
    if (Math.abs(h2_prime - h1_prime) <= 180) {
      delta_h_prime = h2_prime - h1_prime;
    } else if (h2_prime - h1_prime > 180) {
      delta_h_prime = h2_prime - h1_prime - 360;
    } else {
      delta_h_prime = h2_prime - h1_prime + 360;
    }
  }

  const delta_H_prime = 2 * Math.sqrt(C1_prime * C2_prime) * Math.sin(((delta_h_prime / 2) * Math.PI) / 180);

  const L_bar_prime = (L1 + L2) / 2;
  const C_bar_prime = (C1_prime + C2_prime) / 2;

  let h_bar_prime = 0;
  if (C1_prime * C2_prime !== 0) {
    if (Math.abs(h1_prime - h2_prime) <= 180) {
      h_bar_prime = (h1_prime + h2_prime) / 2;
    } else if (h1_prime + h2_prime < 360) {
      h_bar_prime = (h1_prime + h2_prime + 360) / 2;
    } else {
      h_bar_prime = (h1_prime + h2_prime - 360) / 2;
    }
  }

  const T =
    1 -
    0.17 * Math.cos(((h_bar_prime - 30) * Math.PI) / 180) +
    0.24 * Math.cos(((2 * h_bar_prime) * Math.PI) / 180) +
    0.32 * Math.cos(((3 * h_bar_prime + 6) * Math.PI) / 180) -
    0.20 * Math.cos(((4 * h_bar_prime - 63) * Math.PI) / 180);

  const delta_theta = 30 * Math.exp(-Math.pow((h_bar_prime - 275) / 25, 2));
  const R_C = 2 * Math.sqrt(Math.pow(C_bar_prime, 7) / (Math.pow(C_bar_prime, 7) + Math.pow(25, 7)));
  const S_L = 1 + (0.015 * Math.pow(L_bar_prime - 50, 2)) / Math.sqrt(20 + Math.pow(L_bar_prime - 50, 2));
  const S_C = 1 + 0.045 * C_bar_prime;
  const S_H = 1 + 0.015 * C_bar_prime * T;
  const R_T = -Math.sin(((2 * delta_theta) * Math.PI) / 180) * R_C;

  const dE = Math.sqrt(
    Math.pow(delta_L_prime / (kL * S_L), 2) +
    Math.pow(delta_C_prime / (kC * S_C), 2) +
    Math.pow(delta_H_prime / (kH * S_H), 2) +
    R_T * (delta_C_prime / (kC * S_C)) * (delta_H_prime / (kH * S_H))
  );

  return dE;
}

// 3. Find closest BeadColor in active palette with selectable distance algorithm
export function findClosestBeadColor(
  r: number,
  g: number,
  b: number,
  palette: BeadColor[],
  algo: ColorMatchAlgo = 'ciede2000_bright'
): BeadColor {
  if (palette.length === 0) {
    throw new Error('Palette cannot be empty');
  }

  const isLabAlgo = algo === 'ciede2000' || algo === 'ciede2000_vivid' || algo === 'ciede2000_bright' || algo === 'cie76';
  const targetLab = isLabAlgo ? rgbToLab(r, g, b) : null;
  let minDistance = Infinity;
  let closest = palette[0];

  for (const color of palette) {
    if (color.enabled === false) continue;

    let dist = Infinity;

    if (algo === 'ciede2000_bright') {
      // High-Fidelity Brightness & Skin Tone Mode:
      // Heightens lightness and hue sensitivity in high lightness regions (L* > 65 / bright colors / skin / white hair)
      // Ensures white, off-white, light peach/skin tones, and light gray shading remain distinctly matched to correct beads
      const colorLab = rgbToLab(color.rgb[0], color.rgb[1], color.rgb[2]);
      const targetL = targetLab![0];
      if (targetL > 65) {
        dist = deltaE2000(targetLab!, colorLab, 0.8, 0.85, 0.85);
      } else {
        dist = deltaE2000(targetLab!, colorLab, 1.0, 0.85, 1.0);
      }
    } else if (algo === 'ciede2000_vivid') {
      // Vivid mode:
      // Avoids squashing bright skin/hair colors into pure white by keeping kL reasonable when L* > 75
      const colorLab = rgbToLab(color.rgb[0], color.rgb[1], color.rgb[2]);
      const targetL = targetLab![0];
      if (targetL > 75) {
        dist = deltaE2000(targetLab!, colorLab, 0.9, 0.7, 0.9);
      } else {
        dist = deltaE2000(targetLab!, colorLab, 1.35, 0.65, 1.0);
      }
    } else if (algo === 'ciede2000') {
      const colorLab = rgbToLab(color.rgb[0], color.rgb[1], color.rgb[2]);
      dist = deltaE2000(targetLab!, colorLab, 1.0, 1.0, 1.0);
    } else if (algo === 'cie76') {
      const colorLab = rgbToLab(color.rgb[0], color.rgb[1], color.rgb[2]);
      const dL = targetLab![0] - colorLab[0];
      const da = targetLab![1] - colorLab[1];
      const db = targetLab![2] - colorLab[2];
      dist = dL * dL + da * da + db * db;
    } else {
      // Weighted RGB (fast & sharp)
      const dr = r - color.rgb[0];
      const dg = g - color.rgb[1];
      const db = b - color.rgb[2];
      const meanR = (r + color.rgb[0]) / 2;
      dist = (2 + meanR / 256) * dr * dr + 4 * dg * dg + (2 + (255 - meanR) / 256) * db * db;
    }

    if (dist < minDistance) {
      minDistance = dist;
      closest = color;
    }
  }

  return closest;
}

// 4. Pre-process image pixels with Brightness, Contrast, Saturation adjustments
function adjustColor(
  r: number,
  g: number,
  b: number,
  brightness: number,
  contrast: number,
  saturation: number
): [number, number, number] {
  // 1. Brightness (-100 to 100)
  r += (brightness / 100) * 255;
  g += (brightness / 100) * 255;
  b += (brightness / 100) * 255;

  // 2. Contrast (-100 to 100) with soft highlight protection
  if (contrast !== 0) {
    const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));
    let cr = factor * (r - 128) + 128;
    let cg = factor * (g - 128) + 128;
    let cb = factor * (b - 128) + 128;

    // Soft roll-off above 225 to prevent harsh white clipping
    if (contrast > 0) {
      if (cr > 225) cr = 225 + (cr - 225) * 0.5;
      if (cg > 225) cg = 225 + (cg - 225) * 0.5;
      if (cb > 225) cb = 225 + (cb - 225) * 0.5;
    }

    r = cr;
    g = cg;
    b = cb;
  }

  // 3. Saturation boost & protection (-100 to 100)
  if (saturation !== 0) {
    const gray = 0.2989 * r + 0.5870 * g + 0.1140 * b;
    const satFactor = (saturation + 100) / 100;
    r = gray + satFactor * (r - gray);
    g = gray + satFactor * (g - gray);
    b = gray + satFactor * (b - gray);
  }

  return [
    Math.min(255, Math.max(0, Math.round(r))),
    Math.min(255, Math.max(0, Math.round(g))),
    Math.min(255, Math.max(0, Math.round(b))),
  ];
}

// Helper: Convert Hex to RGB tuple
function hexToRgb(hex: string): [number, number, number] | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)]
    : null;
}

// 5. Apply Unsharp Mask Sharpening Filter to Pixel Buffer
function applySharpening(
  bufferR: Float32Array,
  bufferG: Float32Array,
  bufferB: Float32Array,
  width: number,
  height: number,
  amount: number // 0 to 100
) {
  if (amount <= 0) return;
  const factor = (amount / 100) * 1.5;

  const origR = new Float32Array(bufferR);
  const origG = new Float32Array(bufferG);
  const origB = new Float32Array(bufferB);

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;

      const top = (y - 1) * width + x;
      const bottom = (y + 1) * width + x;
      const left = y * width + (x - 1);
      const right = y * width + (x + 1);

      const lapR = origR[idx] * 5 - (origR[top] + origR[bottom] + origR[left] + origR[right]);
      const lapG = origG[idx] * 5 - (origG[top] + origG[bottom] + origG[left] + origG[right]);
      const lapB = origB[idx] * 5 - (origB[top] + origB[bottom] + origB[left] + origB[right]);

      bufferR[idx] = Math.min(255, Math.max(0, origR[idx] + lapR * factor));
      bufferG[idx] = Math.min(255, Math.max(0, origG[idx] + lapG * factor));
      bufferB[idx] = Math.min(255, Math.max(0, origB[idx] + lapB * factor));
    }
  }
}

// 6. High-Precision Linear-RGB Area Downsampling & Grid Conversion
export function imageToGrid(
  img: HTMLImageElement | HTMLCanvasElement,
  settings: ConvertSettings,
  palette: BeadColor[]
): (string | null)[][] {
  const activePalette = palette.filter(c => c.enabled !== false);
  if (activePalette.length === 0) return [];

  const {
    width: targetW,
    height: targetH,
    dither,
    brightness,
    contrast,
    saturation,
    transparentCutoff,
    colorMatchAlgo = 'ciede2000_vivid',
    sharpening = 0,
    outlineBoost = false,
    chromaKeyColor = null,
    chromaKeyTolerance = 30,
  } = settings;

  // Render original image onto high-resolution source canvas
  const srcW = img instanceof HTMLImageElement ? (img.naturalWidth || img.width) : img.width;
  const srcH = img instanceof HTMLImageElement ? (img.naturalHeight || img.height) : img.height;

  if (srcW === 0 || srcH === 0) return [];

  // Limit max source dimensions for fast computation while keeping precision
  const maxDim = 1200;
  let renderW = srcW;
  let renderH = srcH;
  if (renderW > maxDim || renderH > maxDim) {
    if (renderW >= renderH) {
      renderH = Math.round((renderH * maxDim) / renderW);
      renderW = maxDim;
    } else {
      renderW = Math.round((renderW * maxDim) / renderH);
      renderH = maxDim;
    }
  }

  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = renderW;
  srcCanvas.height = renderH;
  const srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true });
  if (!srcCtx) return [];

  srcCtx.drawImage(img, 0, 0, renderW, renderH);
  const srcImgData = srcCtx.getImageData(0, 0, renderW, renderH);
  const srcData = srcImgData.data;

  // Prepare target grid buffers
  const bufferR = new Float32Array(targetW * targetH);
  const bufferG = new Float32Array(targetW * targetH);
  const bufferB = new Float32Array(targetW * targetH);
  const bufferA = new Uint8Array(targetW * targetH);

  const keyRgb = chromaKeyColor ? hexToRgb(chromaKeyColor) : null;
  const maxChromaDist = (chromaKeyTolerance / 100) * 441.67;

  // Perform Linear-RGB Area Box Downsampling
  for (let gy = 0; gy < targetH; gy++) {
    for (let gx = 0; gx < targetW; gx++) {
      const gIdx = gy * targetW + gx;

      const x0 = Math.floor((gx * renderW) / targetW);
      const x1 = Math.max(x0 + 1, Math.floor(((gx + 1) * renderW) / targetW));
      const y0 = Math.floor((gy * renderH) / targetH);
      const y1 = Math.max(y0 + 1, Math.floor(((gy + 1) * renderH) / targetH));

      let sumR_lin = 0;
      let sumG_lin = 0;
      let sumB_lin = 0;
      let validPixelCount = 0;
      let totalAlpha = 0;

      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const sIdx = (sy * renderW + sx) * 4;
          let alpha = srcData[sIdx + 3];
          const sr = srcData[sIdx];
          const sg = srcData[sIdx + 1];
          const sb = srcData[sIdx + 2];

          // Chroma key background check
          if (keyRgb && alpha >= transparentCutoff) {
            const dist = Math.sqrt(
              Math.pow(sr - keyRgb[0], 2) +
              Math.pow(sg - keyRgb[1], 2) +
              Math.pow(sb - keyRgb[2], 2)
            );
            if (dist <= maxChromaDist) {
              alpha = 0;
            }
          }

          totalAlpha += alpha;

          if (alpha >= transparentCutoff) {
            sumR_lin += srgbToLinear(sr);
            sumG_lin += srgbToLinear(sg);
            sumB_lin += srgbToLinear(sb);
            validPixelCount++;
          }
        }
      }

      const avgAlpha = validPixelCount > 0 ? 255 : 0;
      bufferA[gIdx] = avgAlpha;

      if (validPixelCount > 0) {
        // Linear RGB average
        const avgR_lin = sumR_lin / validPixelCount;
        const avgG_lin = sumG_lin / validPixelCount;
        const avgB_lin = sumB_lin / validPixelCount;

        // Convert back to sRGB
        const sR = linearToSrgb(avgR_lin);
        const sG = linearToSrgb(avgG_lin);
        const sB = linearToSrgb(avgB_lin);

        // Apply brightness, contrast, saturation adjustments
        const [ar, ag, ab] = adjustColor(
          sR,
          sG,
          sB,
          brightness,
          contrast,
          saturation
        );

        bufferR[gIdx] = ar;
        bufferG[gIdx] = ag;
        bufferB[gIdx] = ab;
      } else {
        bufferR[gIdx] = 0;
        bufferG[gIdx] = 0;
        bufferB[gIdx] = 0;
      }
    }
  }

  // Apply sharpening filter
  if (sharpening > 0) {
    applySharpening(bufferR, bufferG, bufferB, targetW, targetH, sharpening);
  }

  const resultGrid: (string | null)[][] = Array.from({ length: targetH }, () =>
    Array(targetW).fill(null)
  );

  // Outline protection: Find darkest palette color
  let darkestColor = activePalette[0];
  if (outlineBoost) {
    let minL = Infinity;
    for (const c of activePalette) {
      const lab = rgbToLab(c.rgb[0], c.rgb[1], c.rgb[2]);
      if (lab[0] < minL) {
        minL = lab[0];
        darkestColor = c;
      }
    }
  }

  // Map to closest bead colors with error diffusion
  for (let y = 0; y < targetH; y++) {
    for (let x = 0; x < targetW; x++) {
      const idx = y * targetW + x;
      if (bufferA[idx] < transparentCutoff) {
        resultGrid[y][x] = null;
        continue;
      }

      let curR = Math.min(255, Math.max(0, bufferR[idx]));
      let curG = Math.min(255, Math.max(0, bufferG[idx]));
      let curB = Math.min(255, Math.max(0, bufferB[idx]));

      // Dark outline protection
      if (outlineBoost && (curR * 0.299 + curG * 0.587 + curB * 0.114) < 42) {
        resultGrid[y][x] = darkestColor.id;
        continue;
      }

      const closest = findClosestBeadColor(curR, curG, curB, activePalette, colorMatchAlgo);
      resultGrid[y][x] = closest.id;

      if (dither !== 'none') {
        const errR = curR - closest.rgb[0];
        const errG = curG - closest.rgb[1];
        const errB = curB - closest.rgb[2];

        const addError = (nx: number, ny: number, weight: number) => {
          if (nx >= 0 && nx < targetW && ny >= 0 && ny < targetH) {
            const nIdx = ny * targetW + nx;
            if (bufferA[nIdx] >= transparentCutoff) {
              bufferR[nIdx] += errR * weight;
              bufferG[nIdx] += errG * weight;
              bufferB[nIdx] += errB * weight;
            }
          }
        };

        if (dither === 'floyd') {
          addError(x + 1, y, 7 / 16);
          addError(x - 1, y + 1, 3 / 16);
          addError(x, y + 1, 5 / 16);
          addError(x + 1, y + 1, 1 / 16);
        } else if (dither === 'atkinson') {
          addError(x + 1, y, 1 / 8);
          addError(x + 2, y, 1 / 8);
          addError(x - 1, y + 1, 1 / 8);
          addError(x, y + 1, 1 / 8);
          addError(x + 1, y + 1, 1 / 8);
          addError(x, y + 2, 1 / 8);
        }
      }
    }
  }

  // Apply color limit if configured (> 0)
  if (settings.colorLimit > 0) {
    return applyColorLimit(resultGrid, activePalette, settings.colorLimit, colorMatchAlgo);
  }

  return resultGrid;
}

// Reduce color count to capped limit if requested
function applyColorLimit(
  grid: (string | null)[][],
  palette: BeadColor[],
  maxColors: number,
  algo: ColorMatchAlgo
): (string | null)[][] {
  const counts = new Map<string, number>();
  for (const row of grid) {
    for (const cell of row) {
      if (cell) {
        counts.set(cell, (counts.get(cell) || 0) + 1);
      }
    }
  }

  if (counts.size <= maxColors) return grid;

  const topColorIds = new Set(
    Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxColors)
      .map(entry => entry[0])
  );

  const restrictedPalette = palette.filter(c => topColorIds.has(c.id));
  if (restrictedPalette.length === 0) return grid;

  const paletteMap = new Map(palette.map(c => [c.id, c]));

  return grid.map(row =>
    row.map(cellId => {
      if (!cellId || topColorIds.has(cellId)) return cellId;
      const curColor = paletteMap.get(cellId);
      if (!curColor) return cellId;
      const closest = findClosestBeadColor(
        curColor.rgb[0],
        curColor.rgb[1],
        curColor.rgb[2],
        restrictedPalette,
        algo
      );
      return closest.id;
    })
  );
}
