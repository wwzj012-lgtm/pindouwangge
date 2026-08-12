/**
 * 通用图像自适应智能降粒与拼豆极简优化引擎
 * (Generic Image-Adaptive Smart Bead Count Reduction Engine)
 *
 * 核心目标：
 * 1. 真实且大幅度减少【拼豆总数量 (Bead Count)】，而不只是精简色卡。
 * 2. 适应任何主题图片（人物、二次元、萌宠、风景、像素画等），不硬编码任何具体颜色。
 * 3. 分层 protection：基于 Sobel 梯度与显著性分析，锁定五官、瞳孔、高对比轮廓与核心亮色。
 * 4. 智能背景抠除：自动识别并清除四周无用背景拼豆，把背景变为 0 拼豆。
 * 5. 保真缩放/降格 (Saliency Resampling)：支持按目标豆子面积缩放，会员档位为 15%/25%/40%。
 */

import { BeadColor } from '../types';
import { rgbToLab, deltaE2000 } from './colorUtils';

export type ReductionIntensity = 'light' | 'medium' | 'strong';
export type BeadSavingPercent = 0 | 15 | 25 | 40;

export function savingPercentToScale(percent: BeadSavingPercent): number {
  return Math.sqrt(1 - percent / 100);
}

export interface ReductionOptions {
  intensity: ReductionIntensity;         // 'light' (15~25%), 'medium' (25~35%), 'strong' (35~50%)
  protectSaliencyAndContours: boolean;   // 高对比边缘/五官/瞳孔/核心描边强锁保护 (防止走形糊掉)
  protectVibrantColors: boolean;        // 核心亮点/高饱和色块纯净保护 (防色沉脏色)
  removeBackgroundBeads: boolean;       // 智能抠除无用背景拼豆 (背景设为透明，物理减豆)
  removeIsolatedNoise: boolean;         // 1~3px 悬空孤立噪点清理
  mergeMinorColors: boolean;            // 合并微量低频杂色
  downscaleRatio: number;               // Linear scale. Use savingPercentToScale() for an exact bead-area target.
  autoCropEmptyBorder: boolean;         // 自动切除四周无豆空白盘
}

export interface ReductionReport {
  optimizedGrid: (string | null)[][];
  originalTotalBeads: number;
  optimizedTotalBeads: number;
  savedBeadCount: number;
  savedPercent: number;
  bgBeadsSaved: number;            // 智能抠除背景省下的拼豆数
  noiseBeadsSaved: number;         // 净化悬空杂豆省下的拼豆数
  patchMergedBeadsSaved: number;    // 色块连片合并省下的拼豆数
  originalColorTypesCount: number;
  optimizedColorTypesCount: number;
  savedColorTypesCount: number;
  beadMaterialSavedRMB: number;    // 抠除背景合并连片减少耗材省约 RMB
  colorPacksSavedRMB: number;       // 少购入整包杂色拼豆省约 RMB
  estimatedMoneySavedRMB: number;   // 汇总总节省金额 (耗材 + 色包)
}

interface PixelMeta {
  colorId: string | null;
  r: number;
  g: number;
  b: number;
  l: number;        // Lab L*
  a: number;        // Lab a*
  labB: number;     // Lab b*
  chroma: number;   // Color chroma C*
  edgeWeight: number; // Gradient/Edge strength 0..1
  isCornerBackground: boolean;
  tier: 1 | 2 | 3 | 4; // 1: Max Protect (Features/Contour), 2: High (Vibrant/Highlights), 3: Mid (Body), 4: Low (BG/Shadows)
}

export function smartReduceGrid(
  grid: (string | null)[][],
  palette: BeadColor[],
  options: ReductionOptions
): ReductionReport {
  const origH = grid.length;
  if (origH === 0) return createEmptyReport(grid);
  const origW = grid[0].length;
  if (origW === 0) return createEmptyReport(grid);

  // Palette Lookup
  const paletteMap = new Map<string, BeadColor>();
  palette.forEach(c => paletteMap.set(c.id, c));

  // Initial bead & color counts
  let originalTotalBeads = 0;
  const initialColorCounts = new Map<string, number>();

  for (let y = 0; y < origH; y++) {
    for (let x = 0; x < origW; x++) {
      const cid = grid[y][x];
      if (cid) {
        originalTotalBeads++;
        initialColorCounts.set(cid, (initialColorCounts.get(cid) || 0) + 1);
      }
    }
  }

  const originalColorTypesCount = initialColorCounts.size;
  if (originalTotalBeads === 0) return createEmptyReport(grid);

  // -------------------------------------------------------------
  // Step 1: Detect Corner/Border Background Color & Background Flood Mask
  // -------------------------------------------------------------
  const borderColors = new Map<string, number>();
  const cornerCoords = [
    [0, 0], [origW - 1, 0], [0, origH - 1], [origW - 1, origH - 1],
    [Math.floor(origW / 2), 0], [Math.floor(origW / 2), origH - 1],
    [0, Math.floor(origH / 2)], [origW - 1, Math.floor(origH / 2)],
  ];

  cornerCoords.forEach(([cx, cy]) => {
    const cid = grid[cy]?.[cx];
    if (cid) {
      borderColors.set(cid, (borderColors.get(cid) || 0) + 1);
    }
  });

  // Dominant border background color
  let dominantBgColor: string | null = null;
  let maxBgFreq = 0;
  borderColors.forEach((freq, cid) => {
    if (freq > maxBgFreq) {
      maxBgFreq = freq;
      dominantBgColor = cid;
    }
  });

  // Background Mask (True = Outer Background)
  const isBgMask: boolean[][] = Array.from({ length: origH }, () =>
    Array(origW).fill(false)
  );

  if (options.removeBackgroundBeads && dominantBgColor) {
    const bgObj = paletteMap.get(dominantBgColor);
    const bgLab = bgObj ? rgbToLab(...bgObj.rgb) : null;

    // Queue-based BFS flood fill from edges
    const queue: [number, number][] = [];
    const visited: boolean[][] = Array.from({ length: origH }, () =>
      Array(origW).fill(false)
    );

    // Push edge pixels that match background color closely
    for (let x = 0; x < origW; x++) {
      queue.push([x, 0]);
      queue.push([x, origH - 1]);
    }
    for (let y = 0; y < origH; y++) {
      queue.push([0, y]);
      queue.push([origW - 1, y]);
    }

    const bgTolerance = options.intensity === 'strong' ? 25 : options.intensity === 'medium' ? 18 : 12;

    while (queue.length > 0) {
      const [qx, qy] = queue.pop()!;
      if (qx < 0 || qx >= origW || qy < 0 || qy >= origH || visited[qy][qx]) continue;
      visited[qy][qx] = true;

      const cid = grid[qy][qx];
      if (!cid) {
        isBgMask[qy][qx] = true;
      } else if (bgLab && paletteMap.has(cid)) {
        const cLab = rgbToLab(...paletteMap.get(cid)!.rgb);
        const dist = deltaE2000(bgLab, cLab);
        if (dist <= bgTolerance) {
          isBgMask[qy][qx] = true;
          // Spread to neighbors
          queue.push([qx + 1, qy], [qx - 1, qy], [qx, qy + 1], [qx, qy - 1]);
        }
      }
    }
  }

  // -------------------------------------------------------------
  // Step 2: Pixel Metadata & Saliency / Gradient Feature Extraction
  // -------------------------------------------------------------
  const metaGrid: (PixelMeta | null)[][] = Array.from({ length: origH }, () =>
    Array(origW).fill(null)
  );

  for (let y = 0; y < origH; y++) {
    for (let x = 0; x < origW; x++) {
      if (isBgMask[y][x]) continue; // Skip background

      const cid = grid[y][x];
      if (!cid) continue;

      const color = paletteMap.get(cid);
      let r = 255, g = 255, b = 255;
      if (color) {
        [r, g, b] = color.rgb;
      } else {
        const hex = cid.replace('#', '');
        if (hex.length === 6) {
          r = parseInt(hex.substring(0, 2), 16) || 255;
          g = parseInt(hex.substring(2, 4), 16) || 255;
          b = parseInt(hex.substring(4, 6), 16) || 255;
        }
      }

      const [labL, labA, labBVal] = rgbToLab(r, g, b);
      const chroma = Math.hypot(labA, labBVal);

      metaGrid[y][x] = {
        colorId: cid,
        r, g, b,
        l: labL,
        a: labA,
        labB: labBVal,
        chroma,
        edgeWeight: 0,
        isCornerBackground: false,
        tier: 3,
      };
    }
  }

  // Calculate Gradient & Sobel Edge Weight
  for (let y = 0; y < origH; y++) {
    for (let x = 0; x < origW; x++) {
      const curr = metaGrid[y][x];
      if (!curr) continue;

      let maxDiff = 0;
      const neighbors = [
        [x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1],
      ];

      for (const [nx, ny] of neighbors) {
        if (nx >= 0 && nx < origW && ny >= 0 && ny < origH) {
          const nb = metaGrid[ny][nx];
          if (!nb) {
            maxDiff = Math.max(maxDiff, 40); // Subject Boundary
          } else {
            const diff = Math.hypot(curr.l - nb.l, curr.a - nb.a, curr.labB - nb.labB);
            maxDiff = Math.max(maxDiff, diff);
          }
        }
      }

      curr.edgeWeight = Math.min(1.0, maxDiff / 50);

      // Classify Tiers dynamically without hardcoding color names
      if (curr.edgeWeight > 0.30) {
        curr.tier = 1; // Ultra High Protection: High Contrast Edge / Facial contours / Eyes
      } else if (curr.chroma > 25 || curr.l > 82) {
        curr.tier = 2; // High Protection: Vibrant focal colors & high highlights
      } else if (curr.l < 30 && curr.edgeWeight < 0.15) {
        curr.tier = 4; // Low Protection: Dark inner shadows
      } else {
        curr.tier = 3; // Mid Protection: Standard clothing/fill
      }
    }
  }

  // Calculate bgBeadsSaved
  let bgBeadsSaved = 0;
  for (let y = 0; y < origH; y++) {
    for (let x = 0; x < origW; x++) {
      if (grid[y][x] && isBgMask[y][x]) {
        bgBeadsSaved++;
      }
    }
  }

  // Work Grid initialized
  let workGrid: (string | null)[][] = Array.from({ length: origH }, (_, y) =>
    grid[y].map((cid, x) => (isBgMask[y][x] ? null : cid))
  );

  // -------------------------------------------------------------
  // Step 3: Remove Isolated Floating Noise Specks (1-3px)
  // -------------------------------------------------------------
  let noiseBeadsSaved = 0;
  if (options.removeIsolatedNoise) {
    const passes = options.intensity === 'strong' ? 3 : options.intensity === 'medium' ? 2 : 1;
    for (let pass = 0; pass < passes; pass++) {
      for (let y = 0; y < origH; y++) {
        for (let x = 0; x < origW; x++) {
          const cid = workGrid[y][x];
          if (!cid) continue;

          const meta = metaGrid[y][x];
          if (meta && meta.tier === 1 && options.protectSaliencyAndContours) continue; // Face / Contour lock

          // Neighbor count check
          const neighborCounts = new Map<string, number>();
          let totalValid = 0;

          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              const nx = x + dx;
              const ny = y + dy;
              if (nx >= 0 && nx < origW && ny >= 0 && ny < origH) {
                const ncid = workGrid[ny][nx];
                if (ncid) {
                  totalValid++;
                  neighborCounts.set(ncid, (neighborCounts.get(ncid) || 0) + 1);
                }
              }
            }
          }

          // If completely isolated or surrounded by blank background => Clear it
          if (totalValid <= 1) {
            workGrid[y][x] = null; // Clear floating bead
            noiseBeadsSaved++;
          } else {
            const sameCount = neighborCounts.get(cid) || 0;
            if (sameCount === 0 && totalValid >= 3) {
              // Adopt dominant neighbor
              let bestN = cid;
              let maxN = 0;
              neighborCounts.forEach((cnt, ncid) => {
                if (cnt > maxN) {
                  maxN = cnt;
                  bestN = ncid;
                }
              });
              workGrid[y][x] = bestN;
            }
          }
        }
      }
    }
  }

  // -------------------------------------------------------------
  // Step 4: Regional Color Smoothing & Patch Consolidation
  // -------------------------------------------------------------
  const colorMergeThreshold = options.intensity === 'strong' ? 20 : options.intensity === 'medium' ? 14 : 8;
  const boxRadius = options.intensity === 'strong' ? 2 : 1;

  for (let y = 0; y < origH; y++) {
    for (let x = 0; x < origW; x++) {
      const cid = workGrid[y][x];
      if (!cid) continue;

      const meta = metaGrid[y][x];
      if (!meta) continue;

      if (meta.tier === 1 && options.protectSaliencyAndContours) continue; // Lock facial & contour

      let tierThreshold = colorMergeThreshold;
      if (meta.tier === 2 && options.protectVibrantColors) tierThreshold *= 0.6; // High protection gentle
      if (meta.tier === 4) tierThreshold *= 1.5; // Aggressive for low-weight shadows

      // Check surrounding window
      const neighborColors = new Map<string, number>();
      for (let dy = -boxRadius; dy <= boxRadius; dy++) {
        for (let dx = -boxRadius; dx <= boxRadius; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < origW && ny >= 0 && ny < origH) {
            const ncid = workGrid[ny][nx];
            if (ncid) {
              neighborColors.set(ncid, (neighborColors.get(ncid) || 0) + 1);
            }
          }
        }
      }

      let dominantColor = cid;
      let maxCount = neighborColors.get(cid) || 0;

      neighborColors.forEach((cnt, ncid) => {
        if (ncid !== cid && cnt > maxCount + 1) {
          const c1 = paletteMap.get(cid);
          const c2 = paletteMap.get(ncid);
          if (c1 && c2) {
            const lab1 = rgbToLab(...c1.rgb);
            const lab2 = rgbToLab(...c2.rgb);
            if (deltaE2000(lab1, lab2) < tierThreshold) {
              maxCount = cnt;
              dominantColor = ncid;
            }
          }
        }
      });

      if (dominantColor !== cid) {
        workGrid[y][x] = dominantColor;
      }
    }
  }

  // -------------------------------------------------------------
  // Step 5: Merge Minor Low-Frequency Colors
  // -------------------------------------------------------------
  if (options.mergeMinorColors) {
    const postCounts = new Map<string, number>();
    for (let y = 0; y < origH; y++) {
      for (let x = 0; x < origW; x++) {
        const cid = workGrid[y][x];
        if (cid) {
          postCounts.set(cid, (postCounts.get(cid) || 0) + 1);
        }
      }
    }

    const minorThreshold = options.intensity === 'strong' ? 8 : options.intensity === 'medium' ? 5 : 3;
    const replacementMap = new Map<string, string>();

    postCounts.forEach((count, cid) => {
      if (count <= minorThreshold) {
        const targetObj = paletteMap.get(cid);
        if (!targetObj) return;
        const targetLab = rgbToLab(...targetObj.rgb);

        let bestReplacement = cid;
        let minDist = Infinity;

        postCounts.forEach((dCount, dominantCid) => {
          if (dCount > minorThreshold && dominantCid !== cid) {
            const dObj = paletteMap.get(dominantCid);
            if (dObj) {
              const dLab = rgbToLab(...dObj.rgb);
              const dist = deltaE2000(targetLab, dLab);
              if (dist < minDist) {
                minDist = dist;
                bestReplacement = dominantCid;
              }
            }
          }
        });

        if (bestReplacement !== cid) {
          replacementMap.set(cid, bestReplacement);
        }
      }
    });

    if (replacementMap.size > 0) {
      for (let y = 0; y < origH; y++) {
        for (let x = 0; x < origW; x++) {
          const cid = workGrid[y][x];
          if (cid && replacementMap.has(cid)) {
            workGrid[y][x] = replacementMap.get(cid)!;
          }
        }
      }
    }
  }

  // -------------------------------------------------------------
  // Step 6: Saliency-Preserving Grid Downsampling (智能按比例缩小降格度数)
  // -------------------------------------------------------------
  if (options.downscaleRatio < 0.98) {
    const targetW = Math.max(10, Math.round(origW * options.downscaleRatio));
    const targetH = Math.max(10, Math.round(origH * options.downscaleRatio));

    const scaledGrid: (string | null)[][] = Array.from({ length: targetH }, () =>
      Array(targetW).fill(null)
    );

    const scaleX = origW / targetW;
    const scaleY = origH / targetH;

    for (let ty = 0; ty < targetH; ty++) {
      for (let tx = 0; tx < targetW; tx++) {
        const startX = tx * scaleX;
        const endX = Math.min(origW, (tx + 1) * scaleX);
        const startY = ty * scaleY;
        const endY = Math.min(origH, (ty + 1) * scaleY);

        // Pick the region representative instead of allowing a single edge pixel
        // to replace the whole sample block. Repeated colors remain dominant while
        // contours, highlights and the block centre receive bounded extra weight.
        const colorScores = new Map<string, { score: number; count: number }>();
        const centreX = (startX + endX - 1) / 2;
        const centreY = (startY + endY - 1) / 2;

        for (let sy = Math.floor(startY); sy < Math.ceil(endY); sy++) {
          const verticalCoverage = Math.max(0, Math.min(sy + 1, endY) - Math.max(sy, startY));
          for (let sx = Math.floor(startX); sx < Math.ceil(endX); sx++) {
            const horizontalCoverage = Math.max(0, Math.min(sx + 1, endX) - Math.max(sx, startX));
            const coverage = horizontalCoverage * verticalCoverage;
            if (coverage === 0) continue;
            const cid = workGrid[sy][sx];
            if (cid) {
              const meta = metaGrid[sy][sx];
              const distance = Math.hypot(sx - centreX, sy - centreY);
              const centreWeight = Math.max(0, 0.25 - distance * 0.08);
              const edgeWeight = options.protectSaliencyAndContours ? Math.min(0.35, (meta?.edgeWeight ?? 0) * 0.35) : 0;
              const featureWeight = meta?.tier === 1 ? 0.25 : meta?.tier === 2 ? 0.12 : 0;
              const vibrantWeight = options.protectVibrantColors && meta ? Math.min(0.15, meta.chroma / 400) : 0;
              // A feature bonus can refine a close regional vote, but cannot make one
              // edge pixel outweigh two ordinary pixels from the sampled region.
              const weight = coverage * (1 + Math.min(0.85, centreWeight + edgeWeight + featureWeight + vibrantWeight));
              const current = colorScores.get(cid) ?? { score: 0, count: 0 };
              current.score += weight;
              current.count += 1;
              colorScores.set(cid, current);
            }
          }
        }

        let representative: string | null = null;
        let bestScore = -1;
        let bestCount = -1;
        colorScores.forEach(({ score, count }, cid) => {
          if (score > bestScore || (score === bestScore && count > bestCount)) {
            bestScore = score;
            bestCount = count;
            representative = cid;
          }
        });
        scaledGrid[ty][tx] = representative;
      }
    }

    workGrid = scaledGrid;
  }

  // -------------------------------------------------------------
  // Step 7: Auto-Crop Outer Empty Border
  // -------------------------------------------------------------
  let finalGrid = workGrid;
  if (options.autoCropEmptyBorder) {
    const curH = workGrid.length;
    const curW = workGrid[0].length;
    let minX = curW, maxX = 0, minY = curH, maxY = 0;
    let found = false;

    for (let y = 0; y < curH; y++) {
      for (let x = 0; x < curW; x++) {
        if (workGrid[y][x] !== null) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          found = true;
        }
      }
    }

    if (found && (maxX - minX + 1 < curW || maxY - minY + 1 < curH)) {
      const croppedH = maxY - minY + 1;
      const croppedW = maxX - minX + 1;
      const croppedGrid: (string | null)[][] = Array.from({ length: croppedH }, () =>
        Array(croppedW).fill(null)
      );

      for (let y = 0; y < croppedH; y++) {
        for (let x = 0; x < croppedW; x++) {
          croppedGrid[y][x] = workGrid[minY + y][minX + x];
        }
      }
      finalGrid = croppedGrid;
    }
  }

  // -------------------------------------------------------------
  // Final Statistics Output
  // -------------------------------------------------------------
  let optimizedTotalBeads = 0;
  const finalColorCounts = new Map<string, number>();

  for (let y = 0; y < finalGrid.length; y++) {
    for (let x = 0; x < finalGrid[0].length; x++) {
      const cid = finalGrid[y][x];
      if (cid) {
        optimizedTotalBeads++;
        finalColorCounts.set(cid, (finalColorCounts.get(cid) || 0) + 1);
      }
    }
  }

  const savedBeadCount = Math.max(0, originalTotalBeads - optimizedTotalBeads);
  const savedPercent = originalTotalBeads > 0
    ? Math.round((savedBeadCount / originalTotalBeads) * 100)
    : 0;

  const patchMergedBeadsSaved = Math.max(0, savedBeadCount - bgBeadsSaved - noiseBeadsSaved);

  const optimizedColorTypesCount = finalColorCounts.size;
  const savedColorTypesCount = originalColorTypesCount - optimizedColorTypesCount;

  // 1. Bead material saved estimate (3 RMB per 1000 beads = 0.003 RMB per bead)
  const beadMaterialSavedRMB = Math.round(savedBeadCount * 0.003 * 10) / 10;

  // 2. Color pack procurement saved estimate (3 RMB per 1000-bead color pack)
  const colorPacksSavedRMB = Math.max(0, savedColorTypesCount) * 3;

  // Total estimated RMB saved
  const estimatedMoneySavedRMB = Math.round((beadMaterialSavedRMB + colorPacksSavedRMB) * 10) / 10;

  return {
    optimizedGrid: finalGrid,
    originalTotalBeads,
    optimizedTotalBeads,
    savedBeadCount,
    savedPercent,
    bgBeadsSaved,
    noiseBeadsSaved,
    patchMergedBeadsSaved,
    originalColorTypesCount,
    optimizedColorTypesCount,
    savedColorTypesCount,
    beadMaterialSavedRMB,
    colorPacksSavedRMB,
    estimatedMoneySavedRMB,
  };
}

function createEmptyReport(grid: (string | null)[][]): ReductionReport {
  return {
    optimizedGrid: grid,
    originalTotalBeads: 0,
    optimizedTotalBeads: 0,
    savedBeadCount: 0,
    savedPercent: 0,
    bgBeadsSaved: 0,
    noiseBeadsSaved: 0,
    patchMergedBeadsSaved: 0,
    originalColorTypesCount: 0,
    optimizedColorTypesCount: 0,
    savedColorTypesCount: 0,
    beadMaterialSavedRMB: 0,
    colorPacksSavedRMB: 0,
    estimatedMoneySavedRMB: 0,
  };
}
