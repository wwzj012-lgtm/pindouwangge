import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { suggestSubjectBounds, type SubjectBoundsRect, type SubjectBoundsSuggestion } from './subjectBounds';

type RGBA = [number, number, number, number];
type Raster = Pick<ImageData, 'width' | 'height' | 'data'>;
const WHITE: RGBA = [255, 255, 255, 255];
const INK: RGBA = [24, 24, 24, 255];
const CLEAR: RGBA = [255, 0, 128, 0];

function raster(width = 200, height = 200, color: RGBA = WHITE): Raster {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set(color, i);
  return { width, height, data };
}

function paint(image: Raster, x: number, y: number, width: number, height: number, color: RGBA = INK) {
  for (let row = y; row < y + height; row++) for (let col = x; col < x + width; col++) {
    image.data.set(color, (row * image.width + col) * 4);
  }
  return image;
}

function contains(outer: SubjectBoundsRect, inner: SubjectBoundsRect) {
  expect(outer.x).toBeLessThanOrEqual(inner.x);
  expect(outer.y).toBeLessThanOrEqual(inner.y);
  expect(outer.x + outer.width).toBeGreaterThanOrEqual(inner.x + inner.width);
  expect(outer.y + outer.height).toBeGreaterThanOrEqual(inner.y + inner.height);
}

function full(result: SubjectBoundsSuggestion, image: Raster) {
  expect(result.hasSuggestion).toBe(false);
  expect(result.pixelBounds).toEqual({ x: 0, y: 0, width: image.width, height: image.height });
  expect(result.normalizedBounds).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  expect(result.coverage).toBe(1);
  expect(result.mayExcludeDecorations).toBe(false);
}

describe('pure subject bounds preview suggestions', () => {
  it('fails closed for missing, empty, truncated and unsafe RGBA images', () => {
    for (const image of [null, undefined, { width: 0, height: 0, data: new Uint8ClampedArray() },
      { width: -1, height: 10 }, { width: 1.5, height: 20 }, { width: Infinity, height: 10 },
      { width: Number.MAX_SAFE_INTEGER, height: 2 }, { width: 10, height: 10, data: new Uint8ClampedArray(3) },
      { width: 2, height: 2, data: new Uint8Array(16) }]) {
      const result = suggestSubjectBounds(image as Raster);
      expect(result.reason).toBe('invalid-image');
      expect(result.hasSuggestion).toBe(false);
      expect(result.detected).toBe(false);
      expect(result.confidence).toBe(0);
      expect(result.normalizedBounds).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    }
  });

  it.each([
    { name: 'opaque white', color: WHITE },
    { name: 'near-white', color: [247, 246, 245, 255] as RGBA },
    { name: 'transparent with hidden RGB', color: CLEAR },
  ])('keeps empty $name background whole', ({ color }) => {
    const image = raster(200, 200, color);
    const result = suggestSubjectBounds(image);
    full(result, image);
    expect(result.reason).toBe('empty');
    expect(result.detected).toBe(false);
  });

  it('suggests a padded central block, with consistent pixel/normalized coordinates', () => {
    const image = paint(raster(), 60, 40, 80, 120);
    const result = suggestSubjectBounds(image);
    expect(result.hasSuggestion).toBe(true);
    expect(result.detected).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(0.82);
    expect(result.pixelBounds).toEqual({ x: 56, y: 34, width: 88, height: 132 });
    expect(result.normalizedBounds).toEqual({ x: 0.28, y: 0.17, width: 0.44, height: 0.66 });
    expect(result.coverage).toBeCloseTo(0.44 * 0.66);
    expect(result.retainedForeground).toBe(1);
    expect(result.mayExcludeDecorations).toBe(false);
  });

  it('supports stable near-white paper without assuming exact white', () => {
    const image = paint(raster(200, 200, [242, 244, 246, 255]), 60, 40, 80, 120, [205, 170, 190, 255]);
    const result = suggestSubjectBounds(image);
    expect(result.background).toBe('near-white');
    expect(result.hasSuggestion).toBe(true);
    contains(result.pixelBounds, { x: 60, y: 40, width: 80, height: 120 });
  });

  it('unions connected differently colored parts instead of isolating dark details', () => {
    const image = paint(raster(), 50, 45, 50, 100, [220, 40, 50, 255]);
    paint(image, 100, 45, 50, 100, [40, 140, 230, 255]);
    paint(image, 70, 145, 60, 15, [240, 220, 130, 255]);
    const result = suggestSubjectBounds(image);
    expect(result.hasSuggestion).toBe(true);
    contains(result.pixelBounds, { x: 50, y: 45, width: 100, height: 115 });
  });

  it.each([50, 25, 12])('keeps a second substantial figure of width %i', secondWidth => {
    const image = paint(raster(300, 200), 40, 40, 80, 120);
    paint(image, 210, 60, secondWidth, 80, [60, 90, 180, 255]);
    const result = suggestSubjectBounds(image);
    expect(result.hasSuggestion).toBe(true);
    contains(result.pixelBounds, { x: 40, y: 40, width: 210 + secondWidth - 40, height: 120 });
    expect(result.mayExcludeDecorations).toBe(false);
  });

  it('protects a much sparser outlined second figure by its spatial extent', () => {
    const image = paint(raster(400, 240), 50, 50, 100, 140);
    paint(image, 240, 50, 70, 1); paint(image, 240, 189, 70, 1);
    paint(image, 240, 50, 1, 140); paint(image, 309, 50, 1, 140);
    const result = suggestSubjectBounds(image);
    expect(result.hasSuggestion).toBe(true);
    contains(result.pixelBounds, { x: 50, y: 50, width: 260, height: 140 });
  });

  it('preserves detached logo lettering below its larger icon', () => {
    const image = paint(raster(300, 300), 90, 40, 120, 120, [160, 135, 180, 255]);
    for (const x of [65, 110, 155, 200]) paint(image, x, 205, 30, 40, [100, 90, 115, 255]);
    const result = suggestSubjectBounds(image);
    expect(result.hasSuggestion).toBe(true);
    contains(result.pixelBounds, { x: 65, y: 40, width: 165, height: 205 });
    expect(result.retainedForeground).toBe(1);
  });

  it('can omit two small paper decorations and star dots, but explicitly warns', () => {
    const image = paint(raster(400, 400), 140, 50, 120, 300);
    for (const x of [30, 330]) {
      paint(image, x, 100, 30, 30, [213, 213, 213, 255]);
      paint(image, x + 10, 250, 5, 5);
    }
    const result = suggestSubjectBounds(image);
    expect(result.hasSuggestion).toBe(true);
    contains(result.pixelBounds, { x: 140, y: 50, width: 120, height: 300 });
    expect(result.pixelBounds.x).toBeGreaterThan(60);
    expect(result.pixelBounds.x + result.pixelBounds.width).toBeLessThan(330);
    expect(result.mayExcludeDecorations).toBe(true);
    expect(result.retainedForeground).toBeCloseTo(36000 / 37850);
  });

  it('does not warn for unselected small details that remain inside the padded rectangle', () => {
    const image = paint(raster(), 60, 40, 80, 120);
    paint(image, 57, 70, 1, 1);
    const result = suggestSubjectBounds(image);
    expect(result.hasSuggestion).toBe(true);
    expect(result.mayExcludeDecorations).toBe(false);
    expect(result.retainedForeground).toBe(1);
  });

  it.each([255, 128, 16])('keeps an all-white alpha subject at opacity %i', alpha => {
    const image = paint(raster(200, 200, CLEAR), 50, 40, 100, 120, [255, 255, 255, alpha]);
    const result = suggestSubjectBounds(image);
    expect(result.hasSuggestion).toBe(true);
    expect(result.background).toBe('transparent');
    contains(result.pixelBounds, { x: 50, y: 40, width: 100, height: 120 });
  });

  it('keeps white alpha limbs attached to a dark torso, including a thin extension', () => {
    const image = paint(raster(200, 200, CLEAR), 80, 60, 40, 100);
    paint(image, 40, 75, 40, 20, WHITE); paint(image, 120, 80, 45, 1, WHITE);
    const result = suggestSubjectBounds(image);
    expect(result.hasSuggestion).toBe(true);
    contains(result.pixelBounds, { x: 40, y: 60, width: 125, height: 100 });
  });

  it('does not lose a white subject that reaches the transparent image edge', () => {
    const image = paint(raster(200, 200, CLEAR), 0, 90, 90, 3, WHITE);
    const result = suggestSubjectBounds(image);
    full(result, image);
    expect(result.detected).toBe(true);
    expect(result.reason).toBe('subject-touches-edge');
  });

  it('treats undetectable white-on-white content conservatively', () => {
    const image = paint(raster(), 40, 40, 120, 120, WHITE);
    full(suggestSubjectBounds(image), image);
  });

  it('handles half-transparent colored antialiasing on white without mutating alpha', () => {
    const image = paint(raster(), 60, 40, 80, 120, [220, 50, 80, 128]);
    paint(image, 59, 40, 1, 120, [220, 50, 80, 32]);
    const before = image.data.slice();
    const result = suggestSubjectBounds(image);
    expect(result.hasSuggestion).toBe(true);
    contains(result.pixelBounds, { x: 59, y: 40, width: 81, height: 120 });
    expect(image.data).toEqual(before);
  });

  it.each([[0, 70, 3, 60], [197, 70, 3, 60], [70, 0, 60, 3], [70, 197, 60, 3]])(
    'keeps narrow boundary content whole (%j)', (x, y, width, height) => {
      const image = paint(raster(), x, y, width, height);
      const result = suggestSubjectBounds(image);
      full(result, image);
      expect(['subject-touches-edge', 'unsupported-background']).toContain(result.reason);
    },
  );

  it('offers no crop when already filled', () => {
    const image = paint(raster(), 4, 4, 192, 192);
    const result = suggestSubjectBounds(image);
    full(result, image);
    expect(result.reason).toBe('already-filled');
  });

  it('does not crop a photograph or arbitrary colored background using a flat-background fallback', () => {
    const image = paint(raster(200, 200, [80, 140, 160, 255]), 50, 40, 100, 120);
    const result = suggestSubjectBounds(image);
    full(result, image);
    expect(result.reason).toBe('unsupported-background');
  });

  it.each([{ name: 'white', background: WHITE }, { name: 'transparent', background: CLEAR }])(
    'rejects continuous-tone material even with uniform $name margins', ({ background }) => {
    const image = raster(200, 200, background);
    for (let y = 40; y < 160; y++) for (let x = 40; x < 160; x++) {
      image.data.set([(x * 17 + y * 13) % 256, (x * 37 + y * 7) % 256, (x * 11 + y * 31) % 256, 255], (y * 200 + x) * 4);
    }
    const result = suggestSubjectBounds(image);
    full(result, image);
    expect(result.reason).toBe('complex-content');
    },
  );

  it('requires the whole perimeter to be stable, not just white corners', () => {
    const image = paint(raster(), 0, 40, 200, 120, [70, 120, 160, 255]);
    const result = suggestSubjectBounds(image);
    full(result, image);
    expect(result.reason).toBe('unsupported-background');
  });

  it.each(['horizontal', 'vertical', 'textured'] as const)(
    'rejects low-palette monochrome %s material inside white margins', mode => {
      const image = raster();
      for (let y = 40; y < 160; y++) for (let x = 40; x < 160; x++) {
        const gray = mode === 'horizontal' ? x : mode === 'vertical' ? y : 40 + (x * 7 + y * 11) % 128;
        image.data.set([gray, gray, gray, 255], (y * 200 + x) * 4);
      }
      const result = suggestSubjectBounds(image);
      full(result, image);
      expect(result.reason).toBe('complex-content');
    },
  );

  it('fails closed when numerous small marks make the main subject uncertain', () => {
    const image = paint(raster(300, 300), 100, 100, 60, 60);
    for (let y = 10; y < 290; y += 10) for (let x = 10; x < 290; x += 10) {
      if (x >= 90 && x <= 170 && y >= 90 && y <= 170) continue;
      paint(image, x, y, 2, 2);
    }
    const result = suggestSubjectBounds(image);
    full(result, image);
    expect(result.reason).toBe('ambiguous-components');
  });

  it('does not promote a tiny isolated speck into a confident crop', () => {
    const image = paint(raster(), 100, 100, 2, 2);
    const result = suggestSubjectBounds(image);
    full(result, image);
    expect(result.reason).toBe('low-confidence');
  });

  it('bounds work memory on a large odd-sized image and maps thin extremities outward', () => {
    const image = paint(raster(5003, 3001, CLEAR), 1701, 701, 1601, 1601, WHITE);
    paint(image, 3302, 1500, 699, 1, WHITE);
    paint(image, 1303, 1498, 398, 1, WHITE);
    const result = suggestSubjectBounds(image, { maxWorkingPixels: 16384 });
    expect(result.hasSuggestion).toBe(true);
    expect(result.workingSize.width * result.workingSize.height).toBeLessThanOrEqual(16384);
    contains(result.pixelBounds, { x: 1303, y: 701, width: 2698, height: 1601 });
    expect(result.pixelBounds.x + result.pixelBounds.width).toBeLessThanOrEqual(image.width);
    expect(result.pixelBounds.y + result.pixelBounds.height).toBeLessThanOrEqual(image.height);
  });

  it('handles extreme aspect ratios with bounded memory and finite full bounds', () => {
    const image = paint(raster(200003, 3, CLEAR), 50000, 1, 100000, 1, WHITE);
    const result = suggestSubjectBounds(image);
    full(result, image);
    expect(result.workingSize.width).toBeLessThanOrEqual(512);
    expect(result.workingSize.height).toBe(1);
    const limited = suggestSubjectBounds(image, { maxWorkingPixels: 64 });
    expect(limited.workingSize.width * limited.workingSize.height).toBeLessThanOrEqual(64);
    full(limited, image);
  });

  it('does not bias the box when transposing a downsampled odd-sized image', () => {
    const landscape = paint(raster(1003, 607, CLEAR), 211, 111, 431, 321, WHITE);
    const portrait = paint(raster(607, 1003, CLEAR), 111, 211, 321, 431, WHITE);
    const a = suggestSubjectBounds(landscape, { maxWorkingPixels: 4096 });
    const b = suggestSubjectBounds(portrait, { maxWorkingPixels: 4096 });
    expect(a.hasSuggestion && b.hasSuggestion).toBe(true);
    expect(b.pixelBounds).toEqual({ x: a.pixelBounds.y, y: a.pixelBounds.x, width: a.pixelBounds.height, height: a.pixelBounds.width });
  });

  it('clamps working budget and margin options, including nonfinite values', () => {
    const image = paint(raster(501, 301), 170, 80, 160, 140);
    for (const budget of [-1, 0, NaN, Infinity, 1e12]) {
      const result = suggestSubjectBounds(image, { maxWorkingPixels: budget, marginRatio: NaN });
      expect(result.workingSize.width * result.workingSize.height).toBeLessThanOrEqual(262144);
      contains(result.pixelBounds, { x: 170, y: 80, width: 160, height: 140 });
    }
    expect(suggestSubjectBounds(image, { marginRatio: -10 })).toEqual(suggestSubjectBounds(image, { marginRatio: 0.03 }));
    expect(suggestSubjectBounds(image, { marginRatio: 10 })).toEqual(suggestSubjectBounds(image, { marginRatio: 0.2 }));
  });

  it('is deterministic, ignores transparent RGB, and leaves input/options unchanged', () => {
    const image = paint(raster(200, 200, CLEAR), 60, 40, 80, 120, WHITE);
    const before = image.data.slice();
    const options = Object.freeze({ maxWorkingPixels: 4096, marginRatio: 0.06 });
    const result = suggestSubjectBounds(Object.freeze(image), options);
    expect(suggestSubjectBounds(image, options)).toEqual(result);
    expect(image.data).toEqual(before);
    for (let i = 0; i < image.data.length; i += 4) if (!image.data[i + 3]) {
      image.data[i] = 3; image.data[i + 1] = 250; image.data[i + 2] = 20;
    }
    expect(suggestSubjectBounds(image, options)).toEqual(result);
  });
});

// Local user-owned originals are decoded in memory only; never copied into git.
// CI runs all synthetic tests; these two tests skip when originals are absent.
const catPath = process.env.SUBJECT_BOUNDS_CAT_PATH ?? 'C:/Users/Plout/Pictures/绅士猫1.jpeg';
const logoPath = process.env.SUBJECT_BOUNDS_LOGO_PATH ?? 'C:/Users/Plout/Pictures/豆织星格.png';
async function decode(path: string): Promise<Raster> {
  const require = createRequire(resolve(process.cwd(), 'package.json'));
  const sharp = require('sharp');
  const { data, info } = await sharp(path).rotate().toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data) };
}

describe('local real-material subject bounds (sources stay outside git)', () => {
  it.runIf(existsSync(catPath))('keeps the cat ears, body, feet and tail while warning about paper/star details', async () => {
    const image = await decode(catPath);
    const result = suggestSubjectBounds(image);
    console.info('subjectBounds cat', JSON.stringify({ size: [image.width, image.height], ...result }));
    expect(result.hasSuggestion).toBe(true);
    // Manually reviewed semantic ROI in normalized coordinates, not algorithm input.
    contains(result.normalizedBounds, { x: 0.31, y: 0.045, width: 0.58, height: 0.92 });
    expect(result.normalizedBounds.x).toBeGreaterThan(0.2);
    expect(result.coverage).toBeLessThan(0.85);
    expect(result.mayExcludeDecorations).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(0.82);
  });

  it.runIf(existsSync(logoPath))('keeps the entire logo icon and all detached Chinese lettering', async () => {
    const image = await decode(logoPath);
    const result = suggestSubjectBounds(image);
    console.info('subjectBounds logo', JSON.stringify({ size: [image.width, image.height], ...result }));
    expect(result.hasSuggestion).toBe(true);
    contains(result.normalizedBounds, { x: 0.27, y: 0.205, width: 0.465, height: 0.60 });
    expect(result.coverage).toBeLessThan(0.75);
    expect(result.retainedForeground).toBeGreaterThan(0.98);
  });
});
