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
import { simplifyColorRegions } from './smartReduceRegions';

export type ReductionIntensity = 'light' | 'medium' | 'strong';
export type BeadSavingPercent = 0 | 15 | 25 | 40;

export function savingPercentToScale(percent: BeadSavingPercent): number {
  return Math.sqrt(1 - percent / 100);
}

export interface ReducedGridDimensions {
  width: number;
  height: number;
}

/** Converts an area-saving target's linear scale into proportional grid dimensions. */
export function getReducedGridDimensions(
  originalWidth: number,
  originalHeight: number,
  downscaleRatio: number,
): ReducedGridDimensions {
  const ratio = Number.isFinite(downscaleRatio)
    ? Math.min(1, Math.max(0, downscaleRatio))
    : 1;

  const width = Math.max(1, Math.floor(originalWidth));
  const height = Math.max(1, Math.floor(originalHeight));

  // Both axes must use the same linear scale. Selecting independent integer
  // dimensions to match the target area can preserve one axis and visibly
  // distort the image, especially for non-square source grids.
  return {
    width: Math.min(width, Math.max(1, Math.round(width * ratio))),
    height: Math.min(height, Math.max(1, Math.round(height * ratio))),
  };
}

export interface ReductionOptions {
  intensity: ReductionIntensity;         // Color-region strategy; independent of the resizing target.
  protectSaliencyAndContours: boolean;   // 高对比边缘/五官/瞳孔/核心描边强锁保护 (防止走形糊掉)
  protectVibrantColors: boolean;        // 核心亮点/高饱和色块纯净保护 (防色沉脏色)
  removeBackgroundBeads: boolean;       // 智能抠除无用背景拼豆 (背景设为透明，物理减豆)
  backgroundTolerance?: number;         // CIEDE2000 distance; independent of color simplification.
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
  /** Saving due to resizing; explicit background deletion is excluded. */
  savedPercent: number;
  /** Canvas-area saving, which is the membership target advertised by the UI. */
  gridAreaSavedPercent: number;
  /** Raw material reduction, including explicitly requested background deletion. */
  effectiveBeadSavedPercent: number;
  bgBeadsSaved: number;            // 智能抠除背景省下的拼豆数
  noiseBeadsSaved: number;         // Retained for compatibility; recoloring does not save beads.
  recoloredNoiseCount: number;     // Number of noise cells recolored, not removed.
  patchMergedBeadsSaved: number;   // Retained for compatibility; color merging does not save beads.
  resamplingBeadsSaved: number;    // Actual beads saved by grid resizing, excluding background removal.
  resamplingBeadChangeCount: number; // Signed resizing change: positive means fewer beads.
  materialBudgetBeads: number;
  materialBudgetMet: boolean;
  recoloredSourceBeads: number;
  totalBeadChangeCount: number;    // Signed total material change: positive means fewer beads.
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

interface GridStructure {
  /** 4-neighbour opaque-component id from the immutable source grid. */
  componentIds: number[][];
  /** Cells that must survive all source-grid cleanup and recolouring passes. */
  protectedMask: boolean[][];
  vibrantMask: boolean[][];
  /** Enclosed transparent source cells whose target-space counters must remain empty. */
  holeMask: boolean[][];
}

interface DownsampleCandidate {
  x: number;
  y: number;
  representative: string;
  opaqueCoverage: number;
  opaqueRatio: number;
  score: number;
  /** 0..1; higher means source colours are closer to the chosen representative. */
  colourCoherence: number;
  protectedWeight: number;
  anchorCount: number;
  holeCoverage: number;
  componentIds: Set<number>;
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
  // "Keep original grid" is a no-op in this modal. Controls that simplify,
  // crop, or remove pixels apply only to an actual reduction target.
  const shouldPreserveOriginal = options.downscaleRatio >= 0.999999;

  // Analyse the original grid before any background pixel is discarded. All
  // destructive passes below consult this immutable snapshot instead of the
  // progressively recoloured work grid.
  const rawMetaGrid = createPixelMetaGrid(grid, paletteMap);
  calculateEdgeWeightsAndTiers(rawMetaGrid, origW, origH);
  const structure = buildGridStructure(grid, rawMetaGrid, options);

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

  if (!shouldPreserveOriginal && options.removeBackgroundBeads && dominantBgColor) {
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

    const requestedTolerance = options.backgroundTolerance ?? 18;
    const bgTolerance = Number.isFinite(requestedTolerance) ? Math.max(0, Math.min(30, requestedTolerance)) : 18;

    while (queue.length > 0) {
      const [qx, qy] = queue.pop()!;
      if (qx < 0 || qx >= origW || qy < 0 || qy >= origH || visited[qy][qx]) continue;
      visited[qy][qx] = true;

      // A colour may be close to the sampled border colour while still being
      // an outlined subject, a narrow bridge, or a small salient component.
      // Never let a background flood cross a source-structure protection cell.
      if (structure.protectedMask[qy][qx]) continue;

      const cid = grid[qy][qx];
      if (!cid) {
        isBgMask[qy][qx] = true;
        queue.push([qx + 1, qy], [qx - 1, qy], [qx, qy + 1], [qx, qy - 1]);
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
  const metaGrid: (PixelMeta | null)[][] = rawMetaGrid.map((row, y) =>
    row.map((meta, x) => (isBgMask[y][x] ? null : meta))
  );

  // Calculate bgBeadsSaved
  let bgBeadsSaved = 0;
  for (let y = 0; y < origH; y++) {
    for (let x = 0; x < origW; x++) {
      if (grid[y][x] && isBgMask[y][x]) {
        bgBeadsSaved++;
      }
    }
  }
  // Background removal is an explicit free operation and is excluded from
  // the advertised resampling target. Base the downsample material budget on
  // what remains after that operation, not on the pre-removal bead count.
  const reductionBaselineBeads = Math.max(0, originalTotalBeads - bgBeadsSaved);
  let materialBudgetBeads = reductionBaselineBeads;

  // Work Grid initialized
  let workGrid: (string | null)[][] = Array.from({ length: origH }, (_, y) =>
    grid[y].map((cid, x) => (isBgMask[y][x] ? null : cid))
  );

  // -------------------------------------------------------------
  // Step 3: Remove Isolated Floating Noise Specks (1-3px)
  // -------------------------------------------------------------
  let recoloredNoiseCount = 0;
  if (!shouldPreserveOriginal && options.removeIsolatedNoise) {
    const passes = options.intensity === 'strong' ? 3 : options.intensity === 'medium' ? 2 : 1;
    for (let pass = 0; pass < passes; pass++) {
      const sourceGrid = workGrid;
      const nextGrid = sourceGrid.map(row => [...row]);
      for (let y = 0; y < origH; y++) {
        for (let x = 0; x < origW; x++) {
          const cid = sourceGrid[y][x];
          if (!cid) continue;
          if (isProtectedColorCell(structure, metaGrid, x, y, options)) continue;

          // Neighbor count check
          const neighborCounts = new Map<string, number>();
          let totalValid = 0;

          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              const nx = x + dx;
              const ny = y + dy;
              if (nx >= 0 && nx < origW && ny >= 0 && ny < origH) {
                const ncid = sourceGrid[ny][nx];
                if (ncid) {
                  totalValid++;
                  neighborCounts.set(ncid, (neighborCounts.get(ncid) || 0) + 1);
                }
              }
            }
          }

          const sameCount = neighborCounts.get(cid) || 0;
          if (sameCount === 0 && totalValid > 0) {
            // Cleanup can simplify a colour but must never turn an opaque source
            // cell transparent. That behavior produced random holes in previews.
            let bestN = cid;
            let maxN = 0;
            neighborCounts.forEach((cnt, ncid) => {
              if (cnt > maxN) {
                maxN = cnt;
                bestN = ncid;
              }
            });
            if (bestN !== cid && maxN >= Math.max(3, totalValid * 0.6)) {
              nextGrid[y][x] = bestN;
              recoloredNoiseCount++;
            }
          }
        }
      }
      workGrid = nextGrid;
    }
  }

  // -------------------------------------------------------------
  // Step 4: Adjacency-aware region simplification
  // -------------------------------------------------------------
  if (!shouldPreserveOriginal && options.mergeMinorColors) {
    const locked = workGrid.map((row, y) => row.map((_, x) =>
      isProtectedColorCell(structure, metaGrid, x, y, options)));
    workGrid = simplifyColorRegions(workGrid, paletteMap, locked, options.intensity);
  }

  // -------------------------------------------------------------
  // Step 6: Saliency-Preserving Grid Downsampling (智能按比例缩小降格度数)
  // -------------------------------------------------------------
  let recoloredSourceBeads = 0;
  for (let y = 0; y < origH; y++) for (let x = 0; x < origW; x++) {
    if (grid[y][x] && workGrid[y][x] && grid[y][x] !== workGrid[y][x]) recoloredSourceBeads++;
  }
  if (options.downscaleRatio < 0.98) {
    const { width: targetW, height: targetH } = getReducedGridDimensions(
      origW,
      origH,
      options.downscaleRatio,
    );

    const scaledGrid: (string | null)[][] = Array.from({ length: targetH }, () => Array(targetW).fill(null));

    const scaleX = origW / targetW;
    const scaleY = origH / targetH;
    // Once background is removed, its old connectivity and enclosed-space
    // labels no longer describe the foreground being resampled.
    const samplingStructure = bgBeadsSaved > 0
      ? buildGridStructure(workGrid, metaGrid, options)
      : structure;

    const candidates: DownsampleCandidate[] = [];
    const projectedProtectedHoleKeys = new Set<string>();

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
        const componentIds = new Set<number>();
        const targetArea = (endX - startX) * (endY - startY);
        let opaqueCoverage = 0;
        let protectedWeight = 0;
        let holeCoverage = 0;
        const centreX = (startX + endX - 1) / 2;
        const centreY = (startY + endY - 1) / 2;

        for (let sy = Math.floor(startY); sy < Math.ceil(endY); sy++) {
          const verticalCoverage = Math.max(0, Math.min(sy + 1, endY) - Math.max(sy, startY));
          for (let sx = Math.floor(startX); sx < Math.ceil(endX); sx++) {
            const horizontalCoverage = Math.max(0, Math.min(sx + 1, endX) - Math.max(sx, startX));
            const coverage = horizontalCoverage * verticalCoverage;
            if (coverage === 0) continue;
            if (samplingStructure.holeMask[sy][sx]) holeCoverage += coverage;
            const cid = workGrid[sy][sx];
            if (cid) {
              opaqueCoverage += coverage;
              const meta = metaGrid[sy][sx];
              const componentId = samplingStructure.componentIds[sy][sx];
              if (componentId >= 0) componentIds.add(componentId);
              if (samplingStructure.protectedMask[sy][sx]) {
                protectedWeight += coverage * (1 + (meta?.edgeWeight ?? 0));
              }
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
        let colourCoherence = 0;
        const representativeColor = representative ? paletteMap.get(representative) : undefined;
        if (representativeColor && bestScore > 0) {
          let weightedDeltaE = 0;
          colorScores.forEach(({ score }, colorId) => {
            const color = paletteMap.get(colorId);
            if (color) {
              weightedDeltaE += deltaE2000(rgbToLab(...representativeColor.rgb), rgbToLab(...color.rgb)) * score;
            }
          });
          colourCoherence = Math.max(0, 1 - weightedDeltaE / bestScore / 35);
        }
        if (holeCoverage > 0) projectedProtectedHoleKeys.add(candidateKey(tx, ty));
        if (representative && opaqueCoverage > 0 && targetArea > 0) {
          candidates.push({
            x: tx,
            y: ty,
            representative,
            opaqueCoverage,
            opaqueRatio: opaqueCoverage / targetArea,
            score: bestScore,
            colourCoherence,
            protectedWeight,
            anchorCount: 0,
            holeCoverage,
            componentIds,
          });
        }
      }
    }

    // Alpha-aware area budget: transparent coverage participates in every
    // sampling region. A sparse source cannot create more opaque output cells
    // than its area warrants after downscaling, even when it crosses boundaries.
    const targetAreaRatio = (targetW * targetH) / (origW * origH);
    const maxOpaqueCells = Math.min(targetW * targetH, Math.ceil(reductionBaselineBeads * targetAreaRatio));
    materialBudgetBeads = maxOpaqueCells;
    projectComponentAnchors(candidates, workGrid, metaGrid, samplingStructure, scaleX, scaleY, targetW, targetH);
    const selectedCandidates = selectConstrainedCandidates(
      candidates,
      maxOpaqueCells,
      targetW,
      targetH,
      projectedProtectedHoleKeys,
    );
    selectedCandidates.forEach(({ x, y, representative }) => {
      scaledGrid[y][x] = representative;
    });

    workGrid = scaledGrid;
  }

  // -------------------------------------------------------------
  // Step 7: Auto-Crop Outer Empty Border
  // -------------------------------------------------------------
  let finalGrid = workGrid;
  // A saving target promises a specific resized canvas. Cropping is only an
  // explicit, unscaled cleanup action and cannot change that target.
  if (options.autoCropEmptyBorder && options.downscaleRatio >= 0.98) {
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

  const totalBeadChangeCount = originalTotalBeads - optimizedTotalBeads;
  const savedBeadCount = Math.max(0, totalBeadChangeCount);
  const resamplingBeadChangeCount = reductionBaselineBeads - optimizedTotalBeads;
  const resamplingBeadsSaved = Math.max(0, resamplingBeadChangeCount);
  const savedPercent = reductionBaselineBeads > 0
    ? Math.round(((reductionBaselineBeads - optimizedTotalBeads) / reductionBaselineBeads) * 1000) / 10
    : 0;
  const originalGridArea = origW * origH;
  const optimizedGridArea = finalGrid.length * (finalGrid[0]?.length ?? 0);
  const gridAreaSavedPercent = originalGridArea > 0
    ? Math.round(((originalGridArea - optimizedGridArea) / originalGridArea) * 1000) / 10
    : 0;
  const effectiveBeadSavedPercent = originalTotalBeads > 0
    ? Math.round((totalBeadChangeCount / originalTotalBeads) * 1000) / 10
    : 0;

  const noiseBeadsSaved = 0;
  const patchMergedBeadsSaved = 0;

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
    gridAreaSavedPercent,
    effectiveBeadSavedPercent,
    bgBeadsSaved,
    noiseBeadsSaved,
    recoloredNoiseCount,
    patchMergedBeadsSaved,
    resamplingBeadsSaved,
    resamplingBeadChangeCount,
    materialBudgetBeads,
    materialBudgetMet: optimizedTotalBeads <= materialBudgetBeads,
    recoloredSourceBeads,
    totalBeadChangeCount,
    originalColorTypesCount,
    optimizedColorTypesCount,
    savedColorTypesCount,
    beadMaterialSavedRMB,
    colorPacksSavedRMB,
    estimatedMoneySavedRMB,
  };
}

function projectComponentAnchors(
  candidates: DownsampleCandidate[],
  grid: (string | null)[][],
  metaGrid: (PixelMeta | null)[][],
  structure: GridStructure,
  scaleX: number,
  scaleY: number,
  targetWidth: number,
  targetHeight: number,
): void {
  const anchors = new Map<number, { x: number; y: number; priority: number }>();
  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < grid[y].length; x++) {
      if (!grid[y][x]) continue;
      const componentId = structure.componentIds[y][x];
      if (componentId < 0) continue;
      const priority = (structure.protectedMask[y][x] ? 10 : 0)
        + (metaGrid[y][x]?.edgeWeight ?? 0)
        + (metaGrid[y][x]?.chroma ?? 0) / 1000;
      const current = anchors.get(componentId);
      if (
        !current
        || priority > current.priority
        || (priority === current.priority && (y < current.y || (y === current.y && x < current.x)))
      ) {
        anchors.set(componentId, { x, y, priority });
      }
    }
  }

  const byKey = new Map(candidates.map(candidate => [candidateKey(candidate.x, candidate.y), candidate]));
  for (const anchor of anchors.values()) {
    const x = Math.min(targetWidth - 1, Math.max(0, Math.floor(anchor.x / scaleX)));
    const y = Math.min(targetHeight - 1, Math.max(0, Math.floor(anchor.y / scaleY)));
    const candidate = byKey.get(candidateKey(x, y));
    if (candidate && !isHoleBlocked(candidate)) {
      candidate.anchorCount++;
    }
  }
}

function selectConstrainedCandidates(
  candidates: DownsampleCandidate[],
  maxOpaqueCells: number,
  targetWidth: number,
  targetHeight: number,
  projectedProtectedHoleKeys: Set<string>,
): DownsampleCandidate[] {
  const byKey = new Map(candidates.map(candidate => [candidateKey(candidate.x, candidate.y), candidate]));
  const selected = new Set<string>();
  const add = (candidate: DownsampleCandidate) => {
    selected.add(candidateKey(candidate.x, candidate.y));
  };
  const eligibleCandidates = candidates.filter(candidate => !isHoleBlocked(candidate));

  // Projected structural seeds have priority over raw density. This preserves
  // anchors, bridges, contours, and small salient pieces when a sparse subject
  // would otherwise lose them to the global material budget.
  for (const candidate of eligibleCandidates
    .filter(isStructuralSeed)
    .sort(compareCandidatePriority)) {
    if (selected.size >= maxOpaqueCells) break;
    add(candidate);
  }

  const hasDenseCandidate = eligibleCandidates.some(candidate => candidate.opaqueRatio >= 0.5);
  for (const candidate of eligibleCandidates
    .filter(candidate => !hasDenseCandidate || candidate.opaqueRatio >= 0.5 || isStructuralSeed(candidate))
    .sort(compareCandidatePriority)) {
    if (selected.size >= maxOpaqueCells) break;
    add(candidate);
  }

  repairSelectionTopology(
    selected,
    byKey,
    maxOpaqueCells,
    targetWidth,
    targetHeight,
    projectedProtectedHoleKeys,
  );
  return [...selected]
    .map(key => byKey.get(key))
    .filter((candidate): candidate is DownsampleCandidate => candidate !== undefined);
}

function repairSelectionTopology(
  selected: Set<string>,
  candidates: Map<string, DownsampleCandidate>,
  maxOpaqueCells: number,
  targetWidth: number,
  targetHeight: number,
  projectedProtectedHoleKeys: Set<string>,
): void {
  const componentIds = new Set<number>();
  for (const key of selected) {
    candidates.get(key)?.componentIds.forEach(componentId => componentIds.add(componentId));
  }

  for (const componentId of componentIds) {
    let groups = selectedGroupsForComponent(selected, candidates, componentId, targetWidth, targetHeight);
    while (groups.length > 1) {
      const path = findComponentPath(groups[0], groups[1], candidates, componentId, targetWidth, targetHeight);
      if (!path) break;
      path.forEach(key => selected.add(key));
      groups = selectedGroupsForComponent(selected, candidates, componentId, targetWidth, targetHeight);
    }
  }

  enforceNoNewInteriorHoles(
    selected,
    candidates,
    targetWidth,
    targetHeight,
    projectedProtectedHoleKeys,
  );

  while (selected.size > maxOpaqueCells) {
    const exteriorBoundaryKeys = findExteriorBoundaryKeys(selected, targetWidth, targetHeight);
    const removable = [...selected]
      .map(key => candidates.get(key))
      .filter((candidate): candidate is DownsampleCandidate => (
        candidate !== undefined
        && candidate.anchorCount === 0
        && exteriorBoundaryKeys.has(candidateKey(candidate.x, candidate.y))
        && !projectedProtectedHoleKeys.has(candidateKey(candidate.x, candidate.y))
      ))
      .sort((left, right) => compareCandidatePriority(right, left));

    let removed = false;
    for (const candidate of removable) {
      const key = candidateKey(candidate.x, candidate.y);
      // Do not notch a continuous horizontal/vertical run just to meet the
      // budget. Prefer peeling corners while keeping thin strokes intact.
      const { x, y } = candidate;
      if ((selected.has(candidateKey(x - 1, y)) && selected.has(candidateKey(x + 1, y)))
        || (selected.has(candidateKey(x, y - 1)) && selected.has(candidateKey(x, y + 1)))) continue;
      selected.delete(key);
      if (selectionIsTopologySafe(
        selected,
        candidates,
        targetWidth,
        targetHeight,
        projectedProtectedHoleKeys,
      )) {
        removed = true;
        break;
      }
      selected.add(key);
    }
    if (!removed) break;
  }

  // A recovered boundary cell must never reintroduce a new counter. This is a
  // final hard gate; protected source holes remain excluded from filling.
  enforceNoNewInteriorHoles(
    selected,
    candidates,
    targetWidth,
    targetHeight,
    projectedProtectedHoleKeys,
  );
}

function selectionIsTopologySafe(
  selected: Set<string>,
  candidates: Map<string, DownsampleCandidate>,
  targetWidth: number,
  targetHeight: number,
  projectedProtectedHoleKeys: Set<string>,
): boolean {
  const componentIds = new Set<number>();
  for (const key of selected) {
    candidates.get(key)?.componentIds.forEach(componentId => componentIds.add(componentId));
  }
  for (const componentId of componentIds) {
    if (selectedGroupsForComponent(selected, candidates, componentId, targetWidth, targetHeight).length > 1) {
      return false;
    }
  }
  return findUnprotectedInteriorHoleCandidates(
    selected,
    candidates,
    targetWidth,
    targetHeight,
    projectedProtectedHoleKeys,
  ).length === 0;
}

function selectedGroupsForComponent(
  selected: Set<string>,
  candidates: Map<string, DownsampleCandidate>,
  componentId: number,
  targetWidth: number,
  targetHeight: number,
): string[][] {
  const remaining = new Set(
    [...selected].filter(key => candidates.get(key)?.componentIds.has(componentId)),
  );
  const groups: string[][] = [];
  while (remaining.size > 0) {
    const start = remaining.values().next().value as string;
    const group: string[] = [];
    const queue = [start];
    remaining.delete(start);
    while (queue.length > 0) {
      const key = queue.pop()!;
      group.push(key);
      const candidate = candidates.get(key)!;
      for (const neighbourKey of targetNeighbourKeys(candidate.x, candidate.y, targetWidth, targetHeight)) {
        if (remaining.has(neighbourKey) && candidates.get(neighbourKey)?.componentIds.has(componentId)) {
          remaining.delete(neighbourKey);
          queue.push(neighbourKey);
        }
      }
    }
    groups.push(group);
  }
  return groups;
}

function findComponentPath(
  startGroup: string[],
  targetGroup: string[],
  candidates: Map<string, DownsampleCandidate>,
  componentId: number,
  targetWidth: number,
  targetHeight: number,
): string[] | null {
  const targetKeys = new Set(targetGroup);
  const queue = [...startGroup];
  const previous = new Map<string, string | null>();
  startGroup.forEach(key => previous.set(key, null));
  let queueIndex = 0;

  while (queueIndex < queue.length) {
    const key = queue[queueIndex++];
    if (targetKeys.has(key)) {
      const path: string[] = [];
      let cursor: string | null = key;
      while (cursor) {
        path.push(cursor);
        cursor = previous.get(cursor) ?? null;
      }
      return path;
    }

    const candidate = candidates.get(key)!;
    for (const neighbourKey of targetNeighbourKeys(candidate.x, candidate.y, targetWidth, targetHeight)) {
      const neighbour = candidates.get(neighbourKey);
      if (
        neighbour
        && !isHoleBlocked(neighbour)
        && neighbour.componentIds.has(componentId)
        && !previous.has(neighbourKey)
      ) {
        previous.set(neighbourKey, key);
        queue.push(neighbourKey);
      }
    }
  }
  return null;
}

function enforceNoNewInteriorHoles(
  selected: Set<string>,
  candidates: Map<string, DownsampleCandidate>,
  targetWidth: number,
  targetHeight: number,
  projectedProtectedHoleKeys: Set<string>,
): void {
  // Fill only target cells backed by real source foreground. The precomputed
  // representative is local to that sampling region, which prevents a nearby
  // background colour from being invented to close a new interior counter.
  for (const key of findUnprotectedInteriorHoleCandidates(
    selected,
    candidates,
    targetWidth,
    targetHeight,
    projectedProtectedHoleKeys,
  )) {
    selected.add(key);
  }
}

function findUnprotectedInteriorHoleCandidates(
  selected: Set<string>,
  candidates: Map<string, DownsampleCandidate>,
  targetWidth: number,
  targetHeight: number,
  projectedProtectedHoleKeys: Set<string>,
): string[] {
  const exterior = findExteriorTransparentCells(selected, targetWidth, targetHeight);
  const gaps: string[] = [];
  for (let y = 0; y < targetHeight; y++) {
    for (let x = 0; x < targetWidth; x++) {
      const key = candidateKey(x, y);
      const candidate = candidates.get(key);
      if (
        !selected.has(key)
        && !exterior[y][x]
        && !projectedProtectedHoleKeys.has(key)
        && candidate
        && !isHoleBlocked(candidate)
      ) {
        gaps.push(key);
      }
    }
  }
  return gaps;
}

function findExteriorBoundaryKeys(
  selected: Set<string>,
  targetWidth: number,
  targetHeight: number,
): Set<string> {
  const exterior = findExteriorTransparentCells(selected, targetWidth, targetHeight);
  const boundary = new Set<string>();
  for (const key of selected) {
    const [x, y] = parseCandidateKey(key);
    if (x === 0 || y === 0 || x === targetWidth - 1 || y === targetHeight - 1) {
      boundary.add(key);
      continue;
    }
    if (cardinalNeighbours(x, y, targetWidth, targetHeight).some(([nx, ny]) => exterior[ny][nx])) {
      boundary.add(key);
    }
  }
  return boundary;
}

function findExteriorTransparentCells(
  selected: Set<string>,
  targetWidth: number,
  targetHeight: number,
): boolean[][] {
  const exterior = Array.from({ length: targetHeight }, () => Array(targetWidth).fill(false));
  const queue: [number, number][] = [];
  for (let x = 0; x < targetWidth; x++) {
    queue.push([x, 0]);
    if (targetHeight > 1) queue.push([x, targetHeight - 1]);
  }
  for (let y = 1; y < targetHeight - 1; y++) {
    queue.push([0, y]);
    if (targetWidth > 1) queue.push([targetWidth - 1, y]);
  }

  while (queue.length > 0) {
    const [x, y] = queue.pop()!;
    if (exterior[y][x] || selected.has(candidateKey(x, y))) continue;
    exterior[y][x] = true;
    for (const [nx, ny] of cardinalNeighbours(x, y, targetWidth, targetHeight)) {
      if (!exterior[ny][nx] && !selected.has(candidateKey(nx, ny))) queue.push([nx, ny]);
    }
  }
  return exterior;
}

function isStructuralSeed(candidate: DownsampleCandidate): boolean {
  return candidate.protectedWeight > 0 || candidate.anchorCount > 0;
}

function isHoleBlocked(candidate: DownsampleCandidate): boolean {
  return candidate.holeCoverage > 0 && candidate.holeCoverage >= candidate.opaqueCoverage;
}

function compareCandidatePriority(left: DownsampleCandidate, right: DownsampleCandidate): number {
  const leftPriority = candidatePriority(left);
  const rightPriority = candidatePriority(right);
  return rightPriority - leftPriority || left.y - right.y || left.x - right.x;
}

function candidatePriority(candidate: DownsampleCandidate): number {
  return candidate.anchorCount * 1_000_000
    + Math.min(100, candidate.protectedWeight) * 10_000
    + candidate.opaqueRatio * 1_000
    + candidate.colourCoherence * 100
    + candidate.opaqueCoverage * 10
    + candidate.score;
}

function candidateKey(x: number, y: number): string {
  return `${x},${y}`;
}

function parseCandidateKey(key: string): [number, number] {
  const [x, y] = key.split(',').map(Number);
  return [x, y];
}

function targetNeighbourKeys(x: number, y: number, width: number, height: number): string[] {
  return cardinalNeighbours(x, y, width, height).map(([nx, ny]) => candidateKey(nx, ny));
}

function createPixelMetaGrid(
  grid: (string | null)[][],
  paletteMap: Map<string, BeadColor>,
): (PixelMeta | null)[][] {
  return grid.map(row => row.map(cid => {
    if (!cid) return null;

    const color = paletteMap.get(cid);
    let r = 255;
    let g = 255;
    let b = 255;
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

    const [l, a, labB] = rgbToLab(r, g, b);
    return {
      colorId: cid,
      r,
      g,
      b,
      l,
      a,
      labB,
      chroma: Math.hypot(a, labB),
      edgeWeight: 0,
      isCornerBackground: false,
      tier: 3,
    };
  }));
}

function calculateEdgeWeightsAndTiers(
  metaGrid: (PixelMeta | null)[][],
  width: number,
  height: number,
): void {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const curr = metaGrid[y][x];
      if (!curr) continue;

      let maxDiff = 0;
      for (const [nx, ny] of cardinalNeighbours(x, y, width, height)) {
        const neighbour = metaGrid[ny][nx];
        if (!neighbour) {
          maxDiff = Math.max(maxDiff, 40); // Subject boundary
        } else {
          const diff = Math.hypot(curr.l - neighbour.l, curr.a - neighbour.a, curr.labB - neighbour.labB);
          maxDiff = Math.max(maxDiff, diff);
        }
      }

      curr.edgeWeight = Math.min(1, maxDiff / 50);
      if (curr.edgeWeight > 0.30) {
        curr.tier = 1;
      } else if (curr.chroma > 25 || curr.l > 82) {
        curr.tier = 2;
      } else if (curr.l < 30 && curr.edgeWeight < 0.15) {
        curr.tier = 4;
      } else {
        curr.tier = 3;
      }
    }
  }
}

function buildGridStructure(
  grid: (string | null)[][],
  metaGrid: (PixelMeta | null)[][],
  options: ReductionOptions,
): GridStructure {
  const height = grid.length;
  const width = grid[0]?.length ?? 0;
  const componentIds = Array.from({ length: height }, () => Array(width).fill(-1));
  const protectedMask = Array.from({ length: height }, () => Array(width).fill(false));
  const vibrantMask = Array.from({ length: height }, () => Array(width).fill(false));
  const holeMask = Array.from({ length: height }, () => Array(width).fill(false));
  let componentId = 0;
  let opaqueCount = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!grid[y][x]) continue;
      opaqueCount++;
      if (componentIds[y][x] !== -1) continue;

      const queue: [number, number][] = [[x, y]];
      componentIds[y][x] = componentId;
      while (queue.length > 0) {
        const [cx, cy] = queue.pop()!;
        for (const [nx, ny] of cardinalNeighbours(cx, cy, width, height)) {
          if (grid[ny][nx] && componentIds[ny][nx] === -1) {
            componentIds[ny][nx] = componentId;
            queue.push([nx, ny]);
          }
        }
      }
      componentId++;
    }
  }

  if (options.protectSaliencyAndContours || options.protectVibrantColors) {
    // Same-colour components expose thin strokes, endpoints, and small salient
    // features that a raw opaque foreground mask cannot see on a fully filled
    // pixel-art canvas.
    const visited = Array.from({ length: height }, () => Array(width).fill(false));
    const smallComponentLimit = Math.max(4, Math.min(64, Math.ceil(opaqueCount * 0.0065)));
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const colorId = grid[y][x];
        if (!colorId || visited[y][x]) continue;

        const cells = collectColorComponent(grid, x, y, colorId, visited);
        const averageEdgeWeight = cells.reduce((sum, [cx, cy]) => (
          sum + (metaGrid[cy][cx]?.edgeWeight ?? 0)
        ), 0) / cells.length;
        const isSmallSalientComponent = cells.length <= smallComponentLimit && averageEdgeWeight >= 0.18;

        for (const [cx, cy] of cells) {
          const sameColourNeighbours = cardinalNeighbours(cx, cy, width, height)
            .filter(([nx, ny]) => grid[ny][nx] === colorId)
            .length;
          // A corner of a filled color block also has two neighbors, but is
          // not a thin stroke. Locking those corners made low-contrast blocks
          // immune to every simplification level.
          const belongsToSolidBlock = [-1, 1].some(dx => [-1, 1].some(dy => (
            grid[cy]?.[cx + dx] === colorId
            && grid[cy + dy]?.[cx] === colorId
            && grid[cy + dy]?.[cx + dx] === colorId
          )));
          const isEndpointOrNarrowBridge = cells.length > 1
            && sameColourNeighbours >= 1
            && sameColourNeighbours <= 2
            && !belongsToSolidBlock;
          if (options.protectSaliencyAndContours && (isSmallSalientComponent || isEndpointOrNarrowBridge)) {
            protectedMask[cy][cx] = true;
          }
          if (options.protectVibrantColors
            && cells.length <= Math.max(2, Math.min(32, Math.ceil(opaqueCount * 0.005)))
            && (metaGrid[cy][cx]?.chroma ?? 0) > 25) vibrantMask[cy][cx] = true;
        }
      }
    }
  }

  // Protect the occupied rim of every enclosed transparent hole. This prevents
  // cleanup from opening or filling a ring/letter counter before resampling.
  const exteriorEmpty = Array.from({ length: height }, () => Array(width).fill(false));
  const emptyQueue: [number, number][] = [];
  for (let x = 0; x < width; x++) {
    if (!grid[0]?.[x]) emptyQueue.push([x, 0]);
    if (height > 1 && !grid[height - 1]?.[x]) emptyQueue.push([x, height - 1]);
  }
  for (let y = 1; y < height - 1; y++) {
    if (!grid[y][0]) emptyQueue.push([0, y]);
    if (width > 1 && !grid[y][width - 1]) emptyQueue.push([width - 1, y]);
  }

  while (emptyQueue.length > 0) {
    const [x, y] = emptyQueue.pop()!;
    if (exteriorEmpty[y][x] || grid[y][x]) continue;
    exteriorEmpty[y][x] = true;
    for (const [nx, ny] of cardinalNeighbours(x, y, width, height)) {
      if (!exteriorEmpty[ny][nx] && !grid[ny][nx]) emptyQueue.push([nx, ny]);
    }
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (grid[y][x] || exteriorEmpty[y][x]) continue;
      holeMask[y][x] = true;
      for (const [nx, ny] of cardinalNeighbours(x, y, width, height)) {
        if (grid[ny][nx] && options.protectSaliencyAndContours) protectedMask[ny][nx] = true;
      }
    }
  }

  return { componentIds, protectedMask, vibrantMask, holeMask };
}

function isProtectedColorCell(
  structure: GridStructure,
  metaGrid: (PixelMeta | null)[][],
  x: number,
  y: number,
  options: ReductionOptions,
): boolean {
  return structure.protectedMask[y][x]
    || (options.protectVibrantColors && structure.vibrantMask[y][x]);
}

function collectColorComponent(
  grid: (string | null)[][],
  startX: number,
  startY: number,
  colorId: string,
  visited: boolean[][],
): [number, number][] {
  const height = grid.length;
  const width = grid[0]?.length ?? 0;
  const cells: [number, number][] = [];
  const queue: [number, number][] = [[startX, startY]];
  visited[startY][startX] = true;

  while (queue.length > 0) {
    const [x, y] = queue.pop()!;
    cells.push([x, y]);
    for (const [nx, ny] of cardinalNeighbours(x, y, width, height)) {
      if (!visited[ny][nx] && grid[ny][nx] === colorId) {
        visited[ny][nx] = true;
        queue.push([nx, ny]);
      }
    }
  }

  return cells;
}

function cardinalNeighbours(x: number, y: number, width: number, height: number): [number, number][] {
  const neighbours: [number, number][] = [];
  if (x > 0) neighbours.push([x - 1, y]);
  if (x + 1 < width) neighbours.push([x + 1, y]);
  if (y > 0) neighbours.push([x, y - 1]);
  if (y + 1 < height) neighbours.push([x, y + 1]);
  return neighbours;
}

function createEmptyReport(grid: (string | null)[][]): ReductionReport {
  return {
    optimizedGrid: grid,
    originalTotalBeads: 0,
    optimizedTotalBeads: 0,
    savedBeadCount: 0,
    savedPercent: 0,
    gridAreaSavedPercent: 0,
    effectiveBeadSavedPercent: 0,
    bgBeadsSaved: 0,
    noiseBeadsSaved: 0,
    recoloredNoiseCount: 0,
    patchMergedBeadsSaved: 0,
    resamplingBeadsSaved: 0,
    resamplingBeadChangeCount: 0,
    materialBudgetBeads: 0,
    materialBudgetMet: true,
    recoloredSourceBeads: 0,
    totalBeadChangeCount: 0,
    originalColorTypesCount: 0,
    optimizedColorTypesCount: 0,
    savedColorTypesCount: 0,
    beadMaterialSavedRMB: 0,
    colorPacksSavedRMB: 0,
    estimatedMoneySavedRMB: 0,
  };
}
