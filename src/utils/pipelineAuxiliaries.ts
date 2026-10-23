import type { BeadColor } from '../types';
import { rgbToLab, labToRgb, deltaE2000, type Lab } from './imagePipeline';

export type Rgb = [number, number, number];
export type PreprocessQuantizationMode = 'none' | 'cartoon' | 'photo' | 'logo';

export interface RegionMasks {
  /** 0: smooth region, 1: texture/gradient, 2: strong edge */
  regionType: Uint8Array;
  /** detail / line protection strength [0..1] */
  detailProtection: Float32Array;
  /** local edge magnitude */
  edgeMagnitude: Float32Array;
}

export interface ToneAnchor {
  colorId: string;
  targetLab: Lab;
  weight: number;
}

const EIGHT_NEIGHBOR_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
];
const MAX_DENOISE_PIXELS = 1_000_000;
const MAX_TONE_ANALYSIS_SAMPLES = 65_536;
const MAX_PREPROCESS_AREA = 640_000;
const MAX_KMEANS_SAMPLES = 12_000;
const PHOTO_KMEANS_ITERATIONS = 5;
const PHOTO_KMEANS_CONVERGENCE = 1.5;

interface QuantizationProfile {
  clusters: number;
  centroidDetailWeight: number;
  mergeBase: number;
  detailProtection: number;
  strengthScale: number;
}

function quantizationProfile(mode: Exclude<PreprocessQuantizationMode, 'none'>): QuantizationProfile {
  if (mode === 'cartoon') {
    return {
      // Keep broad fills stable, but retain contour colours and small facial
      // features instead of blending them into a second muddy edge.
      clusters: 16,
      centroidDetailWeight: 0.92,
      mergeBase: 0.48,
      detailProtection: 1.0,
      strengthScale: 0.78,
    };
  }
  if (mode === 'logo') {
    return {
      clusters: 8,
      centroidDetailWeight: 0.82,
      mergeBase: 0.88,
      detailProtection: 0.8,
      strengthScale: 1.55,
    };
  }
  return {
    // Landscapes contain gradual hue/lightness changes. Keep more perceptual
    // centroids and blend gently so skies and foliage are not colour-cast.
    clusters: 24,
    centroidDetailWeight: 0.3,
    mergeBase: 0.46,
    detailProtection: 0.9,
    strengthScale: 1.05,
  };
}

// Fixed storage (448 KiB), independent of image size or distinct colour count.
const LAB_CACHE_CAPACITY = 16_384;

interface ExactLabCache {
  values: Float64Array;
  keys: Uint32Array;
}

function createExactLabCache(): ExactLabCache {
  return {
    values: new Float64Array(LAB_CACHE_CAPACITY * 3),
    keys: new Uint32Array(LAB_CACHE_CAPACITY),
  };
}

function quantizedRgbKey(r: number, g: number, b: number): number {
  return ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
}

function ensureExactLab(cache: ExactLabCache, r: number, g: number, b: number): number {
  const key = (r << 16) | (g << 8) | b;
  const slot = Math.imul(key, 0x9e3779b1) >>> 18;
  const offset = slot * 3;
  // Zero means empty; compare the complete RGB key before every hit. A hash
  // collision only evicts an entry and must never substitute another colour.
  if (cache.keys[slot] !== key + 1) {
    const lab = rgbToLab([r, g, b]);
    cache.values[offset] = lab[0];
    cache.values[offset + 1] = lab[1];
    cache.values[offset + 2] = lab[2];
    cache.keys[slot] = key + 1;
  }
  return offset;
}

function computeDetailMask(data: Uint8ClampedArray, width: number, height: number, alphaCutoff: number): Float32Array {
  const detailMask = new Float32Array(width * height);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const idx = y * width + x;
      const pIdx = idx * 4;
      if (data[pIdx + 3] < alphaCutoff) continue;

      // Invisible RGB must not create detail beside an otherwise flat fill.
      const left = data[(idx - 1) * 4 + 3] >= alphaCutoff ? (idx - 1) * 4 : pIdx;
      const right = data[(idx + 1) * 4 + 3] >= alphaCutoff ? (idx + 1) * 4 : pIdx;
      const up = data[(idx - width) * 4 + 3] >= alphaCutoff ? (idx - width) * 4 : pIdx;
      const down = data[(idx + width) * 4 + 3] >= alphaCutoff ? (idx + width) * 4 : pIdx;
      const lLeft = (data[left] + data[left + 1] * 2 + data[left + 2]) / 4;
      const lRight = (data[right] + data[right + 1] * 2 + data[right + 2]) / 4;
      const lUp = (data[up] + data[up + 1] * 2 + data[up + 2]) / 4;
      const lDown = (data[down] + data[down + 1] * 2 + data[down + 2]) / 4;
      const lumaGradient = Math.hypot(lRight - lLeft, lDown - lUp);
      const chromaGradient = Math.max(
        Math.abs(data[left] - data[right]),
        Math.abs(data[left + 1] - data[right + 1]),
        Math.abs(data[left + 2] - data[right + 2]),
        Math.abs(data[up] - data[down]),
        Math.abs(data[up + 1] - data[down + 1]),
        Math.abs(data[up + 2] - data[down + 2]),
      );
      detailMask[idx] = Math.max(0, Math.min(1, Math.max(lumaGradient / 35, chromaGradient / 55)));
    }
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x > 0 && x + 1 < width && y > 0 && y + 1 < height) continue;
      const idx = y * width + x;
      const offset = idx * 4;
      if (data[offset + 3] < alphaCutoff) continue;
      const currentLuma = (data[offset] + data[offset + 1] * 2 + data[offset + 2]) / 4;
      let maxLumaDifference = 0;
      let maxChannelDifference = 0;
      for (let neighborIndex = 0; neighborIndex < 4; neighborIndex += 1) {
        const nx = neighborIndex === 0 ? x - 1 : neighborIndex === 1 ? x + 1 : x;
        const ny = neighborIndex < 2 ? y : neighborIndex === 2 ? y - 1 : y + 1;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const neighborOffset = (ny * width + nx) * 4;
        if (data[neighborOffset + 3] < alphaCutoff) continue;
        const neighborLuma = (data[neighborOffset] + data[neighborOffset + 1] * 2 + data[neighborOffset + 2]) / 4;
        maxLumaDifference = Math.max(maxLumaDifference, Math.abs(currentLuma - neighborLuma));
        maxChannelDifference = Math.max(
          maxChannelDifference,
          Math.abs(data[offset] - data[neighborOffset]),
          Math.abs(data[offset + 1] - data[neighborOffset + 1]),
          Math.abs(data[offset + 2] - data[neighborOffset + 2]),
        );
      }
      detailMask[idx] = Math.max(0, Math.min(1, Math.max(maxLumaDifference / 35, maxChannelDifference / 55)));
    }
  }
  return detailMask;
}

/**
 * A deliberately lightweight local protection signal used only while the
 * global photo quantizer is running. This is not the formal region heatmap:
 * it only prevents a cluster centre from swallowing sharp local contrast
 * before the post-quantization image receives the normal region analysis.
 */
function computeKMeansProtectionSignal(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  alphaCutoff: number,
): Float32Array {
  const signal = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const offset = index * 4;
      if (data[offset + 3] < alphaCutoff) continue;
      let strongest = 0;
      const compare = (nextX: number, nextY: number) => {
        if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) return;
        const nextOffset = (nextY * width + nextX) * 4;
        if (data[nextOffset + 3] < alphaCutoff) return;
        strongest = Math.max(
          strongest,
          Math.abs(data[offset] - data[nextOffset]),
          Math.abs(data[offset + 1] - data[nextOffset + 1]),
          Math.abs(data[offset + 2] - data[nextOffset + 2]),
        );
      };
      compare(x - 1, y);
      compare(x + 1, y);
      compare(x, y - 1);
      compare(x, y + 1);
      signal[index] = Math.min(1, strongest / 52);
    }
  }
  return signal;
}

function expandDetailMask(
  mask: Float32Array,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): Float32Array {
  if (sourceWidth === targetWidth && sourceHeight === targetHeight) return mask;
  const expanded = new Float32Array(targetWidth * targetHeight);
  for (let y = 0; y < targetHeight; y += 1) {
    const sourceY = Math.min(sourceHeight - 1, Math.floor((y + 0.5) * sourceHeight / targetHeight));
    for (let x = 0; x < targetWidth; x += 1) {
      const sourceX = Math.min(sourceWidth - 1, Math.floor((x + 0.5) * sourceWidth / targetWidth));
      expanded[y * targetWidth + x] = mask[sourceY * sourceWidth + sourceX];
    }
  }
  return expanded;
}

function resizeRgbaArea(
  data: Uint8ClampedArray,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): Uint8ClampedArray {
  const resized = new Uint8ClampedArray(targetWidth * targetHeight * 4);
  for (let targetY = 0; targetY < targetHeight; targetY += 1) {
    const startY = Math.floor(targetY * sourceHeight / targetHeight);
    const endY = Math.max(startY + 1, Math.ceil((targetY + 1) * sourceHeight / targetHeight));
    for (let targetX = 0; targetX < targetWidth; targetX += 1) {
      const startX = Math.floor(targetX * sourceWidth / targetWidth);
      const endX = Math.max(startX + 1, Math.ceil((targetX + 1) * sourceWidth / targetWidth));
      let alphaTotal = 0;
      let redTotal = 0;
      let greenTotal = 0;
      let blueTotal = 0;
      let pixelCount = 0;
      for (let sourceY = startY; sourceY < Math.min(sourceHeight, endY); sourceY += 1) {
        for (let sourceX = startX; sourceX < Math.min(sourceWidth, endX); sourceX += 1) {
          const offset = (sourceY * sourceWidth + sourceX) * 4;
          const alpha = data[offset + 3];
          alphaTotal += alpha;
          redTotal += data[offset] * alpha;
          greenTotal += data[offset + 1] * alpha;
          blueTotal += data[offset + 2] * alpha;
          pixelCount += 1;
        }
      }
      const targetOffset = (targetY * targetWidth + targetX) * 4;
      resized[targetOffset] = alphaTotal > 0 ? Math.round(redTotal / alphaTotal) : 0;
      resized[targetOffset + 1] = alphaTotal > 0 ? Math.round(greenTotal / alphaTotal) : 0;
      resized[targetOffset + 2] = alphaTotal > 0 ? Math.round(blueTotal / alphaTotal) : 0;
      resized[targetOffset + 3] = pixelCount > 0 ? Math.round(alphaTotal / pixelCount) : 0;
    }
  }
  return resized;
}

interface KMeansCentroid { lab: Lab; }

/** Squared Euclidean distance in Lab; used inside the hot K-Means loop. */
function labDistanceSquared(first: Lab, second: Lab): number {
  const dl = first[0] - second[0];
  const da = first[1] - second[1];
  const db = first[2] - second[2];
  return dl * dl + da * da + db * db;
}

function nearestCentroidIndex(lab: Lab, centroids: KMeansCentroid[]): number {
  let nearest = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < centroids.length; index += 1) {
    const centroid = centroids[index];
    const distance = labDistanceSquared(lab, centroid.lab);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = index;
    }
  }
  return nearest;
}

/**
 * One global, bounded K-Means pass for an explicitly selected conversion
 * mode. It is always outside the output-grid loop. Each profile keeps
 * high-detail pixels closer to their source colors while allowing smooth
 * regions to merge according to the requested quantization strength.
 */
function quantizeBuffer(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  alphaCutoff: number,
  detailMask: Float32Array,
  detailWidth: number,
  detailHeight: number,
  mode: Exclude<PreprocessQuantizationMode, 'none'>,
  quantizationStrength = 55,
): Uint8ClampedArray {
  const total = width * height;
  const quantized = new Uint8ClampedArray(data);
  if (total === 0) return quantized;
  const normalizedStrength = Math.min(100, Math.max(0, quantizationStrength)) / 100;
  if (normalizedStrength === 0) return quantized;
  if (mode === 'cartoon') return stabilizeCartoonColors(data, alphaCutoff, normalizedStrength);
  const profile = quantizationProfile(mode);
  const mergeScale = normalizedStrength * profile.strengthScale;
  const labCache = createExactLabCache();
  const cachedLab = (r: number, g: number, b: number): Lab => {
    const offset = ensureExactLab(labCache, r, g, b);
    return [labCache.values[offset], labCache.values[offset + 1], labCache.values[offset + 2]];
  };

  const stride = Math.max(1, Math.ceil(Math.sqrt(total / MAX_KMEANS_SAMPLES)));
  const samples: Array<{ lab: Lab; detail: number }> = [];
  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      const offset = (y * width + x) * 4;
      if (data[offset + 3] < alphaCutoff) continue;
      const detailX = Math.min(detailWidth - 1, Math.floor((x + 0.5) * detailWidth / width));
      const detailY = Math.min(detailHeight - 1, Math.floor((y + 0.5) * detailHeight / height));
      samples.push({
        lab: cachedLab(data[offset], data[offset + 1], data[offset + 2]),
        detail: detailMask[detailY * detailWidth + detailX] ?? 0,
      });
    }
  }
  if (samples.length < 2) return quantized;

  const clusterCount = Math.min(profile.clusters, samples.length);
  const centroids: KMeansCentroid[] = [];
  for (let index = 0; index < clusterCount; index += 1) {
    const sample = samples[Math.floor(index * samples.length / clusterCount)];
    centroids.push({ lab: [...sample.lab] as Lab });
  }

  for (let iteration = 0; iteration < PHOTO_KMEANS_ITERATIONS; iteration += 1) {
    const sums = centroids.map(() => ({ l: 0, a: 0, b: 0, weight: 0 }));
    for (const sample of samples) {
      const index = nearestCentroidIndex(sample.lab, centroids);
      // Smooth regions contribute more to shared centroids. Cartoon and logo
      // profiles use stronger detail protection than the photographic path.
      const weight = 1 - Math.min(1, Math.max(0, sample.detail)) * profile.centroidDetailWeight;
      const sum = sums[index];
      sum.l += sample.lab[0] * weight;
      sum.a += sample.lab[1] * weight;
      sum.b += sample.lab[2] * weight;
      sum.weight += weight;
    }
    let maximumShift = 0;
    for (let index = 0; index < centroids.length; index += 1) {
      const sum = sums[index];
      if (sum.weight <= 0) continue;
      const next = {
        lab: [sum.l / sum.weight, sum.a / sum.weight, sum.b / sum.weight] as Lab,
      };
      maximumShift = Math.max(
        maximumShift,
        Math.sqrt(labDistanceSquared(next.lab, centroids[index].lab)),
      );
      centroids[index] = next;
    }
    if (maximumShift <= PHOTO_KMEANS_CONVERGENCE) break;
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      if (data[offset + 3] < alphaCutoff) continue;
      const detailX = Math.min(detailWidth - 1, Math.floor((x + 0.5) * detailWidth / width));
      const detailY = Math.min(detailHeight - 1, Math.floor((y + 0.5) * detailHeight / height));
      const detail = Math.min(1, Math.max(0, detailMask[detailY * detailWidth + detailX] ?? 0));
      const merge = Math.max(0, Math.min(1, (profile.mergeBase - detail * profile.detailProtection) * mergeScale));
      // Fully protected pixels retain their exact source bytes, without a
      // negative blend extrapolation or an unnecessary Lab round trip.
      if (merge === 0) continue;
      const sourceLab = cachedLab(data[offset], data[offset + 1], data[offset + 2]);
      const centroid = centroids[nearestCentroidIndex(sourceLab, centroids)];
      const blendedLab: Lab = [
        sourceLab[0] * (1 - merge) + centroid.lab[0] * merge,
        sourceLab[1] * (1 - merge) + centroid.lab[1] * merge,
        sourceLab[2] * (1 - merge) + centroid.lab[2] * merge,
      ];
      const blendedRgb = labToRgb(blendedLab);
      quantized[offset] = Math.round(blendedRgb[0]);
      quantized[offset + 1] = Math.round(blendedRgb[1]);
      quantized[offset + 2] = Math.round(blendedRgb[2]);
    }
  }
  return quantized;
}

/** Bounded colour histogram: share fills without spatially blurring their boundaries. */
function stabilizeCartoonColors(data: Uint8ClampedArray, alphaCutoff: number, strength: number): Uint8ClampedArray {
  const buckets = new Map<number, { rgb: Rgb; count: number }>();
  for (let offset = 0; offset < data.length; offset += 4) {
    if (data[offset + 3] < alphaCutoff) continue;
    const key = quantizedRgbKey(data[offset], data[offset + 1], data[offset + 2]);
    const bucket = buckets.get(key) ?? { rgb: [0, 0, 0] as Rgb, count: 0 };
    for (let channel = 0; channel < 3; channel++) bucket.rgb[channel] += data[offset + channel];
    bucket.count++;
    buckets.set(key, bucket);
  }
  const entries = Array.from(buckets, ([key, bucket]) => {
    const rgb = bucket.rgb.map(value => Math.round(value / bucket.count)) as Rgb;
    return { key, rgb, lab: rgbToLab(rgb), count: bucket.count };
  }).sort((a, b) => b.count - a.count || a.key - b.key);
  const radius = 3 + strength * 18;
  const anchors: typeof entries = [];
  const replacements = new Map<number, Rgb>();
  for (const entry of entries) {
    let nearest: typeof entry | undefined;
    let distance = Number.POSITIVE_INFINITY;
    for (const anchor of anchors) {
      const next = Math.sqrt(labDistanceSquared(entry.lab, anchor.lab));
      if (next < distance) { distance = next; nearest = anchor; }
    }
    if (nearest && distance <= radius) replacements.set(entry.key, nearest.rgb);
    else {
      if (anchors.length < 16) anchors.push(entry);
      replacements.set(entry.key, entry.rgb);
    }
  }
  const result = new Uint8ClampedArray(data);
  for (let offset = 0; offset < data.length; offset += 4) {
    if (data[offset + 3] < alphaCutoff) continue;
    const rgb = replacements.get(quantizedRgbKey(data[offset], data[offset + 1], data[offset + 2]))!;
    result.set(rgb, offset);
  }
  return result;
}

/** Classifies original-resolution detail before any grid downsampling. */
export function classifySourceRegions(detailMask: Float32Array, width: number, height: number): RegionMasks {
  const total = width * height;
  const regionType = new Uint8Array(total);
  const detailProtection = new Float32Array(total);
  const edgeMagnitude = new Float32Array(total);
  for (let index = 0; index < total; index += 1) {
    const detail = Math.max(0, Math.min(1, detailMask[index] ?? 0));
    detailProtection[index] = detail;
    edgeMagnitude[index] = detail * 35;
    regionType[index] = detail >= 0.65 ? 2 : detail >= 0.25 ? 1 : 0;
  }
  return { regionType, detailProtection, edgeMagnitude };
}

/**
 * 辅助0 & 辅助2 & 辅助3:
 * 原图预处理（弱高斯去压缩噪点） + 局部细节保护掩码 + 色调锚点提取
 */
export function preprocessSourceImage(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  alphaCutoff: number,
  quantizationMode: PreprocessQuantizationMode | boolean = 'none',
  quantizationStrength = 55,
): {
  denoised: Uint8ClampedArray;
  detailMask: Float32Array;
  toneAnchors: ToneAnchor[];
  sampleData: Uint8ClampedArray;
  sampleWidth: number;
  sampleHeight: number;
} {
  const total = width * height;
  // Preserve the former boolean signature for callers outside this module:
  // true means the established photo profile and false disables quantization.
  const selectedMode: PreprocessQuantizationMode = typeof quantizationMode === 'boolean'
    ? (quantizationMode ? 'photo' : 'none')
    : quantizationMode;
  const quantizationEnabled = selectedMode !== 'none'
    && Math.max(0, Math.min(100, quantizationStrength)) > 0;
  // This lightweight local signal only protects centroids while clustering.
  // The formal heatmap is produced from the final quantized source.
  const kMeansProtection = quantizationEnabled
    ? computeKMeansProtectionSignal(data, width, height, alphaCutoff)
    : null;
  const originalDetailMask = !quantizationEnabled && total > MAX_PREPROCESS_AREA
    ? computeDetailMask(data, width, height, alphaCutoff)
    : null;
  const scale = total > MAX_PREPROCESS_AREA ? Math.sqrt(MAX_PREPROCESS_AREA / total) : 1;
  const sampleWidth = Math.max(1, Math.floor(width * scale));
  const sampleHeight = Math.max(1, Math.floor(height * scale));
  const processData = total > MAX_PREPROCESS_AREA
    ? resizeRgbaArea(data, width, height, sampleWidth, sampleHeight)
    : data;
  const quantizedData = quantizationEnabled
    ? quantizeBuffer(
      processData,
      sampleWidth,
      sampleHeight,
      alphaCutoff,
      kMeansProtection ?? new Float32Array(0),
      width,
      height,
      selectedMode as Exclude<PreprocessQuantizationMode, 'none'>,
      quantizationStrength,
    )
    : processData;
  const processTotal = sampleWidth * sampleHeight;
  const denoised = new Uint8ClampedArray(processData.length);
  denoised.set(quantizedData);
  const labCache = createExactLabCache();

  // Keep detail analysis at source resolution. For very large sources, the
  // denoise and tone passes operate on the bounded work buffer instead.
  if (selectedMode !== 'cartoon' && sampleWidth >= 8 && sampleHeight >= 8 && processTotal <= MAX_DENOISE_PIXELS) {
    for (let y = 1; y < sampleHeight - 1; y++) {
      for (let x = 1; x < sampleWidth - 1; x++) {
        const idx = (y * sampleWidth + x) * 4;
        if (quantizedData[idx + 3] < alphaCutoff) continue;

        let rSum = quantizedData[idx] * 6;
        let gSum = quantizedData[idx + 1] * 6;
        let bSum = quantizedData[idx + 2] * 6;
        let weightSum = 6;

        const centerLabOffset = ensureExactLab(labCache, quantizedData[idx], quantizedData[idx + 1], quantizedData[idx + 2]);
        // Neighbour lookups can evict the centre's slot; keep its exact Lab
        // components locally throughout this bilateral filter calculation.
        const centerL = labCache.values[centerLabOffset];
        const centerA = labCache.values[centerLabOffset + 1];
        const centerB = labCache.values[centerLabOffset + 2];
        for (let neighborIndex = 0; neighborIndex < 4; neighborIndex += 1) {
          const nIdx = neighborIndex === 0
            ? idx - 4
            : neighborIndex === 1
              ? idx + 4
              : neighborIndex === 2
                ? idx - sampleWidth * 4
                : idx + sampleWidth * 4;
          if (quantizedData[nIdx + 3] < alphaCutoff) continue;
          const neighborLabOffset = ensureExactLab(labCache, quantizedData[nIdx], quantizedData[nIdx + 1], quantizedData[nIdx + 2]);
          const dE = Math.hypot(
            centerL - labCache.values[neighborLabOffset],
            centerA - labCache.values[neighborLabOffset + 1],
            centerB - labCache.values[neighborLabOffset + 2],
          );

          // 双边滤波思想：色差小于8才极轻微平滑（仅去除JPEG压缩伪影）
          if (dE < 8) {
            const w = 1.0 - (dE / 8) * 0.6;
            rSum += quantizedData[nIdx] * w;
            gSum += quantizedData[nIdx + 1] * w;
            bSum += quantizedData[nIdx + 2] * w;
            weightSum += w;
          }
        }

        denoised[idx] = Math.round(rSum / weightSum);
        denoised[idx + 1] = Math.round(gSum / weightSum);
        denoised[idx + 2] = Math.round(bSum / weightSum);
        denoised[idx + 3] = quantizedData[idx + 3];
      }
    }
  }

  // A quantized source receives its formal heatmap after its single global
  // clustering pass. The bounded work buffer is expanded to source
  // coordinates so every later grid sample uses the same region reference.
  const detailMask = quantizationEnabled
    ? expandDetailMask(
      computeDetailMask(denoised, sampleWidth, sampleHeight, alphaCutoff),
      sampleWidth,
      sampleHeight,
      width,
      height,
    )
    : originalDetailMask ?? computeDetailMask(denoised, sampleWidth, sampleHeight, alphaCutoff);

  // 3. 辅助3: 色调锚点提取（提取原图高频主要代表色中心）
  const toneAnchors: ToneAnchor[] = [];
  const colorBuckets = new Map<number, { r: number; g: number; b: number; count: number }>();
  const toneStride = Math.max(1, Math.ceil(Math.sqrt(processTotal / MAX_TONE_ANALYSIS_SAMPLES)));
  const toneSampleScale = toneStride * toneStride;
  for (let y = 0; y < sampleHeight; y += toneStride) {
    for (let x = 0; x < sampleWidth; x += toneStride) {
      const i = y * sampleWidth + x;
    const o = i * 4;
    if (denoised[o + 3] < alphaCutoff) continue;
    const rQ = denoised[o] >> 4;
    const gQ = denoised[o + 1] >> 4;
    const bQ = denoised[o + 2] >> 4;
    const key = (rQ << 8) | (gQ << 4) | bQ;
    const entry = colorBuckets.get(key) ?? { r: 0, g: 0, b: 0, count: 0 };
    entry.r += denoised[o];
    entry.g += denoised[o + 1];
    entry.b += denoised[o + 2];
    entry.count += 1;
    colorBuckets.set(key, entry);
    }
  }

  const sortedBuckets = Array.from(colorBuckets.values()).sort((a, b) => b.count - a.count);
  for (let i = 0; i < Math.min(8, sortedBuckets.length); i++) {
    const b = sortedBuckets[i];
    const meanR = Math.round(b.r / b.count);
    const meanG = Math.round(b.g / b.count);
    const meanB = Math.round(b.b / b.count);
    toneAnchors.push({
      colorId: `anchor_${i}`,
      targetLab: rgbToLab([meanR, meanG, meanB]),
      weight: b.count * toneSampleScale / Math.max(1, processTotal),
    });
  }

  return {
    denoised,
    detailMask,
    toneAnchors,
    sampleData: denoised,
    sampleWidth,
    sampleHeight,
  };
}

/**
 * 辅助7: 亚像素边界二次 Snapping 网格吸附重采样
 * 精准对齐强对比度边缘或透明轮廓，避免把一条1px的清晰边缘切成模糊的跨网格两半
 */
export function snapSubpixelGridBounds(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
  data: Uint8ClampedArray,
  alphaCutoff: number
): {
  getSampleWindow: (gx: number, gy: number) => { startX: number; endX: number; startY: number; endY: number };
} {
  const scaleX = sourceWidth / targetWidth;
  const scaleY = sourceHeight / targetHeight;

  // 针对每个网格计算最优亚像素窗口
  return {
    getSampleWindow: (gx: number, gy: number) => {
      let startX = gx * scaleX;
      let endX = (gx + 1) * scaleX;
      let startY = gy * scaleY;
      let endY = (gy + 1) * scaleY;

      // 仅在原图大幅缩放时 (scale > 1.25) 在网格分界线上检测微小的微调吸附
      if (scaleX > 1.25 || scaleY > 1.25) {
        const midX = Math.floor((startX + endX) / 2);
        const midY = Math.floor((startY + endY) / 2);

        if (midX > 1 && midX < sourceWidth - 1 && midY > 1 && midY < sourceHeight - 1) {
          const cIdx = (midY * sourceWidth + midX) * 4;
          const rIdx = (midY * sourceWidth + midX + 1) * 4;
          if (data[cIdx + 3] >= alphaCutoff && data[rIdx + 3] >= alphaCutoff) {
            const lDiff = Math.abs(data[cIdx] - data[rIdx]) + Math.abs(data[cIdx + 1] - data[rIdx + 1]);
            if (lDiff > 50) {
              // 边缘吸附微调
              startX = Math.max(0, startX - 0.15 * scaleX);
              endX = Math.min(sourceWidth, endX + 0.15 * scaleX);
            }
          }
        }
      }

      return { startX, endX, startY, endY };
    }
  };
}

/**
 * 步骤3: 区域掩码划分（0: 平滑区, 1: 纹理渐变区, 2: 强边缘区）
 * 调优后的梯度判定阈值：
 * 让人脸皮肤、纯色背景、大面积平缓光照能够更准确、广泛地落入平滑掩码（0: 平滑区），
 * 强边缘则精准锁定真正的轮廓黑线与高反差特征。
 */
export function classifyGridRegions(
  targetLabs: Array<Lab | null>,
  width: number,
  height: number
): RegionMasks {
  const total = width * height;
  const regionType = new Uint8Array(total);
  const detailProtection = new Float32Array(total);
  const edgeMagnitude = new Float32Array(total);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const c = targetLabs[idx];
      if (!c) continue;

      let maxDiff = 0;
      let avgDiff = 0;
      let validNeighbors = 0;

      for (const [ox, oy] of EIGHT_NEIGHBOR_OFFSETS) {
        const nx = x + ox;
        const ny = y + oy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const nLab = targetLabs[ny * width + nx];
        if (!nLab) continue;
        const dE = deltaE2000(c, nLab);
        maxDiff = Math.max(maxDiff, dE);
        avgDiff += dE;
        validNeighbors++;
      }

      const meanDE = validNeighbors > 0 ? avgDiff / validNeighbors : 0;
      edgeMagnitude[idx] = maxDiff;

      // 强边缘：明显的轮廓线与高对比度分界 (maxDiff > 22 或 meanDE > 14)
      if (maxDiff > 22 || (meanDE > 14 && validNeighbors >= 2)) {
        regionType[idx] = 2; // 强边缘
        detailProtection[idx] = 1.0;
      } else if (maxDiff > 14 || (meanDE > 10.0 && validNeighbors >= 2)) {
        regionType[idx] = 1; // 丰富纹理/渐变过渡区
        detailProtection[idx] = 0.5;
      } else {
        // 平滑平坦区（人脸、皮肤、天空、纯色底色与大色块：梯度低，充分落入平滑区）
        regionType[idx] = 0;
        detailProtection[idx] = 0.0;
      }
    }
  }

  return { regionType, detailProtection, edgeMagnitude };
}

/**
 * 辅助5: 抖动-色卡距离自适应调节器
 * 预计算每个像素与色卡最近颜色的CIEDE2000距离
 * 在平滑区（皮肤/背景），只要色卡有合理匹配色 (dE <= 6.5，涵盖全色盘模式下的绝大多数皮肤与平滑像素)，
 * 则将抖动扩散系数直接置为 0.0，从源头消灭高频棋盘噪点；
 * 当色卡缺失或色差过大时，自适应微弱扩散以避免大面积色彩断层。
 */
export function computeDitherAdaptationMap(
  targetLabs: Array<Lab | null>,
  paletteLabs: Lab[],
  regionMasks?: RegionMasks
): Float32Array {
  const map = new Float32Array(targetLabs.length);
  for (let i = 0; i < targetLabs.length; i++) {
    const lab = targetLabs[i];
    if (!lab) {
      map[i] = 0;
      continue;
    }

    let minDE = Number.POSITIVE_INFINITY;
    for (const pLab of paletteLabs) {
      const dE = deltaE2000(lab, pLab);
      if (dE < minDE) {
        minDE = dE;
        if (minDE < 0.8) break;
      }
    }

    const regType = regionMasks ? regionMasks.regionType[i] : 1;

    // 强边缘像素：大幅降低抖动误差扩散，仍允许极少量误差沿同色连续区传递
    // so adjacent low-contrast cells retain tonal continuity without creating edge chatter.
    if (regType === 2) {
      map[i] = 0.10;
    } else if (regType === 0) {
      // 平滑平坦区（皮肤、天空、平滑纯色背景）：
      // 适度放大 ΔE 判定阈值：允许中等偏小色差 (minDE <= 7.5) 即可完全置 0 (0.0)，关闭抖动
      // 色差在 7.5 ~ 15.0 之间时自适应渐进扩散，消灭高频棋盘噪点
      if (minDE <= 7.5) {
        map[i] = 0.0;
      } else if (minDE <= 15.0) {
        map[i] = 0.25 * ((minDE - 7.5) / 7.5);
      } else {
        map[i] = 0.60;
      }
    } else {
      // 纹理渐变区 (regType === 1)：根据匹配差距自适应
      if (minDE <= 2.5) {
        map[i] = 0.25;
      } else if (minDE <= 10.0) {
        map[i] = 0.25 + 0.45 * ((minDE - 2.5) / 7.5);
      } else {
        map[i] = 0.85;
      }
    }
  }
  return map;
}

/**
 * 辅助1: 边缘区域色号连续性稳定器（增强边缘线条连续性，防断线）
 */
export function stabilizeEdgeContinuity(
  grid: (string | null)[][],
  regionMasks: RegionMasks,
  width: number,
  height: number
): void {
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      // 仅作用于强边缘像素
      if (regionMasks.regionType[idx] !== 2) continue;

      const current = grid[y][x];
      if (!current) continue;

      // 检查水平或垂直走向的连续性
      const left = grid[y][x - 1];
      const right = grid[y][x + 1];
      const up = grid[y - 1][x];
      const down = grid[y + 1][x];

      // 如果左右同色且当前不一致，且当前属于边缘走势，稳定为左右同色
      if (left && right && left === right && current !== left) {
        const leftType = regionMasks.regionType[y * width + (x - 1)];
        const rightType = regionMasks.regionType[y * width + (x + 1)];
        if (leftType === 2 && rightType === 2) {
          grid[y][x] = left;
          continue;
        }
      }

      // 上下同色同理
      if (up && down && up === down && current !== up) {
        const upType = regionMasks.regionType[(y - 1) * width + x];
        const downType = regionMasks.regionType[(y + 1) * width + x];
        if (upType === 2 && downType === 2) {
          grid[y][x] = up;
        }
      }
    }
  }
}

/**
 * 辅助6: 平滑区孤立杂斑分类器（只清理单像素棋盘散斑，保护多像素细节连通域）
 * 严格约束：仅在【原图平滑掩码 regionType === 0】内部执行回填修复，高梯度/纹理区跳过，保护真实细节
 * 返回实际修复的杂斑像素总数
 */
export function suppressSmoothAreaClutterClusters(
  grid: (string | null)[][],
  regionMasks: RegionMasks,
  sourceLabs: Array<Lab | null>,
  paletteMap: Map<string, { lab: Lab; color: BeadColor }>,
  width: number,
  height: number,
  onReplacement?: (x: number, y: number, replacementId: string) => void,
): number {
  let fixedCount = 0;
  // Only remove single-cell islands. Multi-cell components, including diagonal
  // pairs, can be intentional linework and must survive cleanup.
  const visited = new Uint8Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const startIdx = y * width + x;
      if (visited[startIdx] || !grid[y][x]) continue;

      // 仅在平滑掩码区域寻找单像素孤岛
      if (regionMasks.regionType[startIdx] !== 0) continue;

      const colorId = grid[y][x]!;
      const queue = [startIdx];
      let queueCursor = 0;
      let clusterSize = 0;
      visited[startIdx] = 1;

      let isClusterAllInSmooth = true;
      const surroundingColors = new Map<string, number>();

      while (queueCursor < queue.length) {
        const cIdx = queue[queueCursor++];
        const cx = cIdx % width;
        const cy = (cIdx - cx) / width;
        clusterSize += 1;

        if (regionMasks.regionType[cIdx] !== 0) {
          isClusterAllInSmooth = false;
        }

        for (const [ox, oy] of EIGHT_NEIGHBOR_OFFSETS) {
          const nx = cx + ox;
          const ny = cy + oy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const nIdx = ny * width + nx;
          const nColor = grid[ny][nx];
          if (!nColor) continue;

          if (nColor === colorId) {
            if (!visited[nIdx]) {
              visited[nIdx] = 1;
              queue.push(nIdx);
            }
          } else {
            surroundingColors.set(nColor, (surroundingColors.get(nColor) ?? 0) + 1);
          }
        }
      }

      // Only a fully smooth, isolated single cell is eligible for recoloring.
      if (isClusterAllInSmooth && clusterSize === 1 && surroundingColors.size > 0) {
        // 找到包围的主导邻色
        let dominantSurrounding = '';
        let dominantCount = -1;
        for (const [colorId, count] of surroundingColors) {
          if (count > dominantCount) {
            dominantSurrounding = colorId;
            dominantCount = count;
          }
        }
        const dominantEntry = paletteMap.get(dominantSurrounding);

        // 验证源像素在该区域是否与 dominantSurrounding 在视觉容差内
        if (dominantEntry) {
          const src = sourceLabs[startIdx];
          if (src) {
            const dE = deltaE2000(src, dominantEntry.lab);
            if (dE < 36 && grid[y][x] !== dominantSurrounding) {
              grid[y][x] = dominantSurrounding;
              fixedCount++;
              onReplacement?.(x, y, dominantSurrounding);
            }
          }
        }
      }
    }
  }

  return fixedCount;
}

/**
 * 步骤6.3: 伪边缘抑制与像素修正器（False Edge Suppression）
 * 严格约束：仅在【原图平滑掩码 regionType === 0】内部执行回填，高梯度纹理区域禁止回填
 * 将因抖动生成的孤立阶跃/噪点伪边缘像素，回填为局部平滑主色。
 * 返回实际触发伪边缘回填修复的像素总数
 */
export function suppressFalseEdges(
  grid: (string | null)[][],
  regionMasks: RegionMasks,
  sourceLabs: Array<Lab | null>,
  paletteMap: Map<string, { lab: Lab; color: BeadColor }>,
  width: number,
  height: number
): number {
  let fixedCount = 0;

  // 执行两轮扫描修正，确保连带生成的伪边缘也被彻底消除
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        // 严格约束：仅在原图平滑掩码区域内部执行回填；高梯度纹理区跳过，保护真实轮廓
        if (regionMasks.regionType[idx] !== 0) continue;

        const currentId = grid[y][x];
        if (!currentId) continue;
        const currentEntry = paletteMap.get(currentId);
        if (!currentEntry) continue;

        const srcLab = sourceLabs[idx];
        if (!srcLab) continue;

        const neighbors = [
          [x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]
        ];

        let highContrastNeighbors = 0;
        const neighborColorCounts = new Map<string, number>();

        for (const [nx, ny] of neighbors) {
          const nId = grid[ny][nx];
          if (!nId) continue;
          neighborColorCounts.set(nId, (neighborColorCounts.get(nId) ?? 0) + 1);
          const nEntry = paletteMap.get(nId);
          if (nEntry) {
            // 色号不同且色差 > 3.0 视为阶跃
            if (nId !== currentId) {
              const dE = deltaE2000(currentEntry.lab, nEntry.lab);
              if (dE > 3.0) {
                highContrastNeighbors++;
              }
            }
          }
        }

        // 如果平滑区内的该像素与 >= 1 个邻居产生了阶跃色差
        if (highContrastNeighbors >= 1 && neighborColorCounts.size > 0) {
          const dominantId = Array.from(neighborColorCounts.entries()).sort((a, b) => b[1] - a[1])[0][0];
          const dominantEntry = paletteMap.get(dominantId);
          if (dominantEntry && dominantId !== currentId) {
            const dEToSrc = deltaE2000(srcLab, dominantEntry.lab);
            if (dEToSrc < 36) {
              grid[y][x] = dominantId;
              fixedCount++;
            }
          }
        }
      }
    }
  }

  return fixedCount;
}

/**
 * 辅助3: 色调锚定回拉校正
 * 确保图纸在抖动与后处理后，全图核心色相/亮度重心不偏离原图全局基调
 */
export function applyToneAnchorCorrection(
  grid: (string | null)[][],
  sourceLabs: Array<Lab | null>,
  paletteMap: Map<string, { lab: Lab; color: BeadColor }>,
  toneAnchors: ToneAnchor[],
  width: number,
  height: number
): void {
  if (toneAnchors.length === 0) return;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const currentId = grid[y][x];
      if (!currentId) continue;
      const idx = y * width + x;
      const srcLab = sourceLabs[idx];
      if (!srcLab) continue;

      // 检查当前像素是否属于某个主色调锚点，但被抖动误推到偏差过大的颜色
      for (const anchor of toneAnchors) {
        const dEToAnchor = deltaE2000(srcLab, anchor.targetLab);
        if (dEToAnchor < 6.0) {
          const currentEntry = paletteMap.get(currentId);
          if (currentEntry) {
            const currDE = deltaE2000(currentEntry.lab, anchor.targetLab);
            if (currDE > 16.0) {
              // 寻找与 anchor 最接近的色卡色号进行回拉校正
              let bestId = currentId;
              let bestDE = currDE;
              for (const [pId, pEntry] of paletteMap.entries()) {
                const dist = deltaE2000(srcLab, pEntry.lab);
                if (dist < bestDE && dist < 6.0) {
                  bestDE = dist;
                  bestId = pId;
                }
              }
              grid[y][x] = bestId;
            }
          }
          break;
        }
      }
    }
  }
}

/**
 * 辅助4: 实体拼豆介质模拟校正（可开关）
 * 模拟塑料拼豆在经过高温熨烫熔接后的表面漫反射、亚表面散射与相邻豆的视觉色彩互融
 */
export function applyBeadMediumSimulation(
  grid: (string | null)[][],
  sourceLabs: Array<Lab | null>,
  paletteMap: Map<string, { lab: Lab; color: BeadColor }>,
  width: number,
  height: number
): void {
  // 物理拼豆在密集深浅交界处存在光学融合
  // 对比度过高的相邻散豆会产生刺眼塑料光斑，通过轻微光学融合微调使其更温润自然
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const curId = grid[y][x];
      if (!curId) continue;
      const curEntry = paletteMap.get(curId);
      if (!curEntry) continue;

      const idx = y * width + x;
      const srcLab = sourceLabs[idx];
      if (!srcLab) continue;

      // 计算四邻域的平均亮度
      let neighborLightnessSum = 0;
      let count = 0;
      const nIds = [grid[y - 1][x], grid[y + 1][x], grid[y][x - 1], grid[y][x + 1]];
      for (const nid of nIds) {
        if (!nid) continue;
        const ne = paletteMap.get(nid);
        if (ne) {
          neighborLightnessSum += ne.lab[0];
          count++;
        }
      }

      if (count === 4) {
        const meanNLightness = neighborLightnessSum / 4;
        const curL = curEntry.lab[0];
        // 如果当前豆与周围有极高反差（如周围全黑只有中间1颗高亮，但原图其实是中间灰阶）
        if (Math.abs(curL - meanNLightness) > 40 && Math.abs(srcLab[0] - meanNLightness) < 25) {
          // 介质融色校正：在色卡中寻找更符合漫反射平滑过渡的中间色
          let bestFitId = curId;
          let bestFitDiff = Math.abs(curL - srcLab[0]);
          for (const [pId, pEntry] of paletteMap.entries()) {
            const pL = pEntry.lab[0];
            const dE = deltaE2000(srcLab, pEntry.lab);
            if (dE < 10 && Math.abs(pL - srcLab[0]) < bestFitDiff) {
              bestFitDiff = Math.abs(pL - srcLab[0]);
              bestFitId = pId;
            }
          }
          grid[y][x] = bestFitId;
        }
      }
    }
  }
}
