// Subject saliency segmentation (u2netp, ONNX Runtime Web / WASM backend).
//
// Why: every colour-heuristic background remover (edge flood fill, chroma
// distance, island cleanup) is mathematically blind when the subject shares a
// colour family with the background — the recurring navy-on-navy case. A
// trained saliency model separates "what the picture is about" from "what
// surrounds it" by learned semantics instead of colour proximity.
//
// Model: u2netp.onnx (~4.4 MB, from the rembg release). Preprocessing matches
// the rembg U2Net session: squashed 320x320 RGB, /max intensity scale,
// ImageNet mean/std normalisation; the largest output head (d0) is min-max
// normalised into a probability map, upsampled bilinearly back to source
// resolution and thresholded into a binary subject mask.
//
// This module never throws: any failure (model fetch, WASM init, degenerate
// mask) resolves to null so the pipeline silently falls back to the
// edge-connected heuristic.

const MODEL_URL = '/models/u2netp.onnx';
// WASM backend assets. Prod serves the committed copies under /ort; dev cannot
// import modules from /public, so it reads straight out of node_modules. The
// switch is a plain runtime URL — asset imports (`?url`) would break the
// esbuild-IIFE browser harness that bundles the whole App.
const WASM_ASSET_BASE = import.meta.env.DEV
  ? '/node_modules/onnxruntime-web/dist/'
  : '/ort/';
const SEGMENTATION_SIZE = 320;
const SUBJECT_THRESHOLD = 0.5;
// Saliency sanity bounds: outside them the model output is degenerate
// (all-background or all-subject) and a heuristic mask is safer.
const MIN_SUBJECT_COVERAGE = 0.015;
const MAX_SUBJECT_COVERAGE = 0.985;

const IMAGENET_MEAN = [0.485, 0.456, 0.406];
const IMAGENET_STD = [0.229, 0.224, 0.225];

export interface SubjectSegmentationResult {
  /** 1 = subject (keep), 0 = background (remove). Length = width * height. */
  mask: Uint8Array;
  width: number;
  height: number;
  coverage: number;
}

type OrtModule = typeof import('onnxruntime-web/wasm');

let ortModulePromise: Promise<OrtModule> | null = null;
let sessionPromise: Promise<import('onnxruntime-web/wasm').InferenceSession> | null = null;

function loadOrt(): Promise<OrtModule> {
  if (!ortModulePromise) {
    ortModulePromise = import('onnxruntime-web/wasm').then((ort) => {
      ort.env.wasm.wasmPaths = WASM_ASSET_BASE;
      // Single-threaded SIMD: works without cross-origin isolation headers.
      ort.env.wasm.numThreads = 1;
      return ort;
    });
  }
  return ortModulePromise;
}

function loadSession(): Promise<import('onnxruntime-web/wasm').InferenceSession> {
  if (!sessionPromise) {
    sessionPromise = loadOrt().then((ort) => ort.InferenceSession.create(MODEL_URL, { executionProviders: ['wasm'] }));
  }
  return sessionPromise;
}

/** Min-max normalise a probability map in place; degenerate (flat) maps stay zero. */
export function normalizeMinmax(values: Float32Array): Float32Array {
  let min = Infinity;
  let max = -Infinity;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value < min) min = value;
    if (value > max) max = value;
  }
  const range = max - min;
  if (!Number.isFinite(range) || range <= 1e-6) return values;
  for (let index = 0; index < values.length; index += 1) {
    values[index] = (values[index] - min) / range;
  }
  return values;
}

/** Threshold a normalised saliency map into a binary subject mask (1 = subject). */
export function thresholdSubjectMask(probability: Float32Array, threshold = SUBJECT_THRESHOLD): Uint8Array {
  const mask = new Uint8Array(probability.length);
  for (let index = 0; index < probability.length; index += 1) {
    mask[index] = probability[index] >= threshold ? 1 : 0;
  }
  return mask;
}

// Hysteresis refinement. A plain 0.5 cut carves bays out of dark subject
// regions the model is unsure about (the street-boy boombox lost most of its
// body while pure background sits at exactly 0 probability). Strong seeds grow
// through weak pixels, then every hole fully enclosed by the result is filled,
// which keeps genuinely dark subject parts without opening a path into the
// background.
const STRONG_PROBABILITY = 0.5;
// 0.1 keeps only ~33% of the street-boy boombox (dark parts sit at 0.13-0.15
// and the seam below the sleeve drops under 0.1, so growth cannot reach it);
// 0.05 recovers ~67% of the boombox bbox with zero background leakage, because
// true background sits at ~0 probability. 0.03 adds almost nothing beyond it.
const WEAK_PROBABILITY = 0.05;
// Second pass: re-run the model on the subject bounding box (plus padding) so
// small dark accessories (the street-boy boombox) fill more of the 320x320
// input and cross the saliency threshold. The pass only ever ADDS pixels that
// are connected to the first-pass subject, so clean background cannot leak in.
const ZOOM_PADDING = 0.12;

/**
 * Refine a normalised [0,1] probability map (any resolution) into a binary
 * subject mask: 0.5-strong seeds, flood through >=0.1 weak pixels, fill
 * enclosed holes. 1 = subject, 0 = background.
 */
export function refineSubjectMask(probability: Float32Array, width: number, height: number): Uint8Array {
  const size = width * height;
  const mask = new Uint8Array(size);
  const stack = new Int32Array(size);
  let top = 0;
  for (let index = 0; index < size; index += 1) {
    if (probability[index] >= STRONG_PROBABILITY) {
      mask[index] = 1;
      stack[top++] = index;
    }
  }
  const grow = (index: number) => {
    if (!mask[index] && probability[index] >= WEAK_PROBABILITY) {
      mask[index] = 1;
      stack[top++] = index;
    }
  };
  while (top > 0) {
    const index = stack[--top];
    const x = index % width;
    const y = Math.floor(index / width);
    if (x > 0) grow(index - 1);
    if (x < width - 1) grow(index + 1);
    if (y > 0) grow(index - width);
    if (y < height - 1) grow(index + width);
  }
  // Hole fill: flood the background from the image border; every unreached
  // non-subject pixel is enclosed by subject and belongs to it.
  const visited = new Uint8Array(size);
  top = 0;
  const push = (index: number) => {
    if (!visited[index] && !mask[index]) {
      visited[index] = 1;
      stack[top++] = index;
    }
  };
  for (let x = 0; x < width; x += 1) {
    push(x);
    push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    push(y * width);
    push(y * width + width - 1);
  }
  while (top > 0) {
    const index = stack[--top];
    const x = index % width;
    const y = Math.floor(index / width);
    if (x > 0) push(index - 1);
    if (x < width - 1) push(index + 1);
    if (y > 0) push(index - width);
    if (y < height - 1) push(index + width);
  }
  for (let index = 0; index < size; index += 1) {
    if (!visited[index]) mask[index] = 1;
  }
  return mask;
}

export interface SubjectBoundingBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Tight bounding box of subject pixels, or null for an empty mask. */
export function subjectBoundingBox(mask: Uint8Array, width: number, height: number): SubjectBoundingBox | null {
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      if (mask[row + x]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

/**
 * Merge a zoom-pass mask (computed on the crop at [offsetX, offsetY]) into the
 * full-resolution mask: pixels the zoom pass calls subject are added only when
 * 8-connected to the existing subject, so stray background blobs the zoom pass
 * might hallucinate far from the subject never enter the mask.
 */
export function mergeConnectedSubject(
  mask: Uint8Array,
  width: number,
  height: number,
  addition: Uint8Array,
  cropWidth: number,
  cropHeight: number,
  offsetX: number,
  offsetY: number,
): number {
  const cropSize = cropWidth * cropHeight;
  const enqueued = new Uint8Array(cropSize);
  const queue = new Int32Array(cropSize);
  let rear = 0;
  for (let y = 0; y < cropHeight; y += 1) {
    const cropRow = y * cropWidth;
    const fullRow = (offsetY + y) * width;
    for (let x = 0; x < cropWidth; x += 1) {
      if (mask[fullRow + offsetX + x]) {
        enqueued[cropRow + x] = 1;
        queue[rear++] = cropRow + x;
      }
    }
  }
  const visit = (cropIndex: number) => {
    if (!enqueued[cropIndex] && addition[cropIndex]) {
      enqueued[cropIndex] = 1;
      queue[rear++] = cropIndex;
    }
  };
  let head = 0;
  while (head < rear) {
    const cropIndex = queue[head++];
    const x = cropIndex % cropWidth;
    const y = Math.floor(cropIndex / cropWidth);
    if (x > 0) visit(cropIndex - 1);
    if (x < cropWidth - 1) visit(cropIndex + 1);
    if (y > 0) visit(cropIndex - cropWidth);
    if (y < cropHeight - 1) visit(cropIndex + cropWidth);
    if (x > 0 && y > 0) visit(cropIndex - cropWidth - 1);
    if (x < cropWidth - 1 && y > 0) visit(cropIndex - cropWidth + 1);
    if (x > 0 && y < cropHeight - 1) visit(cropIndex + cropWidth - 1);
    if (x < cropWidth - 1 && y < cropHeight - 1) visit(cropIndex + cropWidth + 1);
  }
  let added = 0;
  for (let cropIndex = 0; cropIndex < cropSize; cropIndex += 1) {
    if (addition[cropIndex] && enqueued[cropIndex]) {
      const fullIndex = (offsetY + Math.floor(cropIndex / cropWidth)) * width + offsetX + (cropIndex % cropWidth);
      if (!mask[fullIndex]) {
        mask[fullIndex] = 1;
        added += 1;
      }
    }
  }
  return added;
}

function drawToCanvas(
  source: HTMLImageElement | HTMLCanvasElement,
  width: number,
  height: number,
  sourceX = 0,
  sourceY = 0,
  sourceWidth = source instanceof HTMLImageElement ? source.naturalWidth || source.width : source.width,
  sourceHeight = source instanceof HTMLImageElement ? source.naturalHeight || source.height : source.height,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('canvas 2d unavailable');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, width, height);
  return canvas;
}

/** Run one u2netp inference on a 320x320 canvas; returns the min-max normalised d0 map. */
async function runInference(
  session: import('onnxruntime-web/wasm').InferenceSession,
  ort: OrtModule,
  inputCanvas: HTMLCanvasElement,
): Promise<Float32Array> {
  const context = inputCanvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('canvas 2d unavailable');
  const raw = context.getImageData(0, 0, SEGMENTATION_SIZE, SEGMENTATION_SIZE).data;
  let maxIntensity = 0;
  for (let index = 0; index < raw.length; index += 4) {
    if (raw[index] > maxIntensity) maxIntensity = raw[index];
    if (raw[index + 1] > maxIntensity) maxIntensity = raw[index + 1];
    if (raw[index + 2] > maxIntensity) maxIntensity = raw[index + 2];
  }
  const scale = maxIntensity > 0 ? 1 / maxIntensity : 1;
  const pixels = SEGMENTATION_SIZE * SEGMENTATION_SIZE;
  const tensorData = new Float32Array(pixels * 3);
  for (let index = 0; index < pixels; index += 1) {
    const offset = index * 4;
    tensorData[index] = (raw[offset] * scale - IMAGENET_MEAN[0]) / IMAGENET_STD[0];
    tensorData[pixels + index] = (raw[offset + 1] * scale - IMAGENET_MEAN[1]) / IMAGENET_STD[1];
    tensorData[pixels * 2 + index] = (raw[offset + 2] * scale - IMAGENET_MEAN[2]) / IMAGENET_STD[2];
  }
  const inputTensor = new ort.Tensor('float32', tensorData, [1, 3, SEGMENTATION_SIZE, SEGMENTATION_SIZE]);
  const inputName = session.inputNames[0] ?? 'input.1';
  const outputs = await session.run({ [inputName]: inputTensor });
  const primaryName = session.outputNames[0] ?? Object.keys(outputs)[0];
  const primary = outputs[primaryName];
  if (!primary || !primary.data || primary.data.length !== pixels) throw new Error('unexpected model output');
  return normalizeMinmax(new Float32Array(primary.data as Float32Array));
}

/** Upsample a normalised 320x320 probability map to width x height (bilinear via canvas). */
function upsampleProbability(probability: Float32Array, width: number, height: number): Float32Array {
  const context = drawToCanvas(probabilityToCanvas(probability), width, height).getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('canvas 2d unavailable');
  const upsampled = context.getImageData(0, 0, width, height).data;
  const result = new Float32Array(width * height);
  for (let index = 0; index < result.length; index += 1) {
    // Red channel of the grayscale upsample encodes the probability.
    result[index] = upsampled[index * 4] / 255;
  }
  return result;
}

/**
 * Compute the binary subject mask for a source image at source resolution.
 * Returns null (never throws) when the model or output is unusable.
 */
export async function computeSubjectMask(source: HTMLImageElement | HTMLCanvasElement): Promise<SubjectSegmentationResult | null> {
  try {
    const sourceWidth = source instanceof HTMLImageElement ? source.naturalWidth || source.width : source.width;
    const sourceHeight = source instanceof HTMLImageElement ? source.naturalHeight || source.height : source.height;
    if (!sourceWidth || !sourceHeight) return null;

    const [ort, session] = await Promise.all([loadOrt(), loadSession()]);

    // Pass 1: whole image at 320x320, upsampled back and refined.
    const inputCanvas = drawToCanvas(source, SEGMENTATION_SIZE, SEGMENTATION_SIZE);
    const probability = normalizeMinmax(await runInference(session, ort, inputCanvas));
    const mask = refineSubjectMask(upsampleProbability(probability, sourceWidth, sourceHeight), sourceWidth, sourceHeight);

    // Pass 2: re-run on the subject bounding box (plus padding). Small dark
    // accessories fill more of the 320x320 input and cross the saliency
    // threshold; additions merge only where 8-connected to the subject.
    const bbox = subjectBoundingBox(mask, sourceWidth, sourceHeight);
    if (bbox) {
      const pad = Math.round(Math.max(bbox.x1 - bbox.x0, bbox.y1 - bbox.y0) * ZOOM_PADDING);
      const cropX = Math.max(0, bbox.x0 - pad);
      const cropY = Math.max(0, bbox.y0 - pad);
      const cropWidth = Math.min(sourceWidth, bbox.x1 + pad) - cropX;
      const cropHeight = Math.min(sourceHeight, bbox.y1 + pad) - cropY;
      if (cropWidth > 0 && cropHeight > 0 && (cropWidth < sourceWidth || cropHeight < sourceHeight)) {
        const cropCanvas = drawToCanvas(source, SEGMENTATION_SIZE, SEGMENTATION_SIZE, cropX, cropY, cropWidth, cropHeight);
        const cropProbability = normalizeMinmax(await runInference(session, ort, cropCanvas));
        const cropMask = refineSubjectMask(upsampleProbability(cropProbability, cropWidth, cropHeight), cropWidth, cropHeight);
        const added = mergeConnectedSubject(mask, sourceWidth, sourceHeight, cropMask, cropWidth, cropHeight, cropX, cropY);
        if (import.meta.env.DEV) console.info(`[subjectSegmentation] zoom pass: crop ${cropWidth}x${cropHeight}, +${added}px`);
      }
    }

    let subjectCount = 0;
    for (let index = 0; index < mask.length; index += 1) {
      subjectCount += mask[index];
    }
    const coverage = subjectCount / mask.length;
    if (coverage < MIN_SUBJECT_COVERAGE || coverage > MAX_SUBJECT_COVERAGE) return null;
    return { mask, width: sourceWidth, height: sourceHeight, coverage };
  } catch (error) {
    console.warn('[subjectSegmentation] falling back to heuristic background removal:', error);
    return null;
  }
}

/** Render a normalised [0,1] probability map as a grayscale canvas for upsampling. */
function probabilityToCanvas(probability: Float32Array): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = SEGMENTATION_SIZE;
  canvas.height = SEGMENTATION_SIZE;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('canvas 2d unavailable');
  const image = context.createImageData(SEGMENTATION_SIZE, SEGMENTATION_SIZE);
  for (let index = 0; index < probability.length; index += 1) {
    const value = Math.max(0, Math.min(255, Math.round(probability[index] * 255)));
    const offset = index * 4;
    image.data[offset] = value;
    image.data[offset + 1] = value;
    image.data[offset + 2] = value;
    image.data[offset + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  return canvas;
}
