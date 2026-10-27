import { describe, expect, it } from 'vitest';
import { rgbToLab } from './imagePipeline';
import { preprocessSourceImage, type PreprocessQuantizationMode } from './pipelineAuxiliaries';
import { analyzeSourceStrokes } from './sourceSampling';

type Rgba = [number, number, number, number];

function raster(width: number, height: number, pixel: (x: number, y: number) => Rgba): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data.set(pixel(x, y), (y * width + x) * 4);
  }
  return data;
}

function rotate(data: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  return raster(height, width, (x, y) => {
    const offset = ((height - 1 - x) * width + y) * 4;
    return Array.from(data.subarray(offset, offset + 4)) as Rgba;
  });
}

function expectSamePixels(actual: Uint8ClampedArray, expected: Uint8ClampedArray): void {
  expect(actual.length).toBe(expected.length);
  const mismatch = actual.findIndex((value, index) => value !== expected[index]);
  expect(mismatch, mismatch < 0 ? '' : `byte ${mismatch}: ${actual[mismatch]} versus ${expected[mismatch]}`).toBe(-1);
}

const modes: Array<[PreprocessQuantizationMode, number]> = [
  ['none', 55], ['photo', 0], ['photo', 1], ['photo', 28], ['photo', 100],
];

describe('source preprocessing colour fidelity', () => {
  it.each(['cartoon', 'logo'] as const)('%s carries real pale stroke support through colour merging and denoising at strength 28', mode => {
    const width = 100, height = 100;
    const data = raster(width, height, (x, y) => x >= 43 && x < 46 && y >= 10 && y < 90
      ? [234, 234, 234, 255] : [255, 255, 255, 255]);
    const structure = analyzeSourceStrokes(data, width, height, 10, 10, 128, new Uint8Array(width * height));
    expect(structure.mask[40 * width + 44]).toBe(1);
    const result = preprocessSourceImage(data, width, height, 128, mode, 28, structure.mask);
    expect([...result.sampleData.slice((40 * width + 44) * 4, (40 * width + 44) * 4 + 4)]).toEqual([234, 234, 234, 255]);
    expect(result.detailMask[40 * width + 44]).toBe(1);
    expect(structure.mask[40 * width + 20]).toBe(0);
    // The same setting still merges ordinary unprotected near-white fills.
    if (mode === 'cartoon') {
      const ordinary = preprocessSourceImage(data, width, height, 128, mode, 28);
      expect(ordinary.sampleData[(40 * width + 44) * 4]).toBe(255);
    }
  });

  it('photo preserves fully protected source colours without bright or saturated halos', () => {
    // More distinct colours than the photo profile has centroids. Every pixel has
    // a strong neighbour, so centroid approximation must never extrapolate it.
    // Height < 8 deliberately excludes denoising from this regression.
    const data = raster(80, 3, (x, y) => x % 2 === 0
      ? [35 + x, 20 + y * 8, 25 + x % 13, 255]
      : [180 + x % 70, 130 + (x * 13 + y) % 50, 100 + (x * 7) % 40, 255]);
    for (const strength of [28, 100]) {
      const result = preprocessSourceImage(data, 80, 3, 16, 'photo', strength);
      let excessLightness = 0;
      let excessChroma = 0;
      for (let offset = 0; offset < data.length; offset += 4) {
        const source = rgbToLab([data[offset], data[offset + 1], data[offset + 2]]);
        const output = rgbToLab([result.denoised[offset], result.denoised[offset + 1], result.denoised[offset + 2]]);
        excessLightness = Math.max(excessLightness, output[0] - source[0]);
        excessChroma = Math.max(excessChroma, Math.hypot(output[1], output[2]) - Math.hypot(source[1], source[2]));
      }
      expect(excessLightness, `strength ${strength}`).toBe(0);
      expect(excessChroma, `strength ${strength}`).toBe(0);
      expectSamePixels(result.denoised, data);
    }
  });

  it.each(modes)('%s strength %s keeps perceptually distinct colours inside the same 4bit bin', (mode, strength) => {
    const first: Rgba = [16, 31, 16, 255];
    const second: Rgba = [31, 16, 31, 255];
    const firstLab = rgbToLab([first[0], first[1], first[2]]);
    const secondLab = rgbToLab([second[0], second[1], second[2]]);
    expect(Math.hypot(...firstLab.map((value, index) => value - secondLab[index]))).toBeGreaterThan(8);
    const data = raster(12, 12, x => x < 6 ? first : second);
    const before = data.slice();
    const result = preprocessSourceImage(data, 12, 12, 16, mode, strength);
    // Both exact colours are present in the initial 24 seeds. Clustering has
    // no approximation to make; the bilateral colour threshold excludes the
    // other colour even though all six RGB nibbles are identical.
    expectSamePixels(result.denoised, data);
    expectSamePixels(data, before);
  });

  it.each(modes)('%s strength %s is invariant to rotation when centroid direction is irrelevant', (mode, strength) => {
    const data = raster(12, 12, x => x < 6 ? [16, 31, 16, 255] : [31, 16, 31, 255]);
    const original = preprocessSourceImage(data, 12, 12, 16, mode, strength);
    let turnedSource = data;
    let expected = original.denoised;
    // 180 degrees reverses which exact colour is encountered first. There
    // are only two exact colours, each seeded, so K-Means has no directional
    // clustering ambiguity to confuse with cache-order contamination.
    for (let turn = 0; turn < 3; turn++) {
      turnedSource = rotate(turnedSource, 12, 12);
      expected = rotate(expected, 12, 12);
      const turned = preprocessSourceImage(turnedSource, 12, 12, 16, mode, strength);
      expectSamePixels(turned.denoised, expected);
    }
    expectSamePixels(preprocessSourceImage(data, 12, 12, 16, mode, strength).denoised, original.denoised);
  });

  it('denoising stays independent of cache eviction and raster order on many exact colours', () => {
    const width = 192;
    const height = 128;
    const data = raster(width, height, (x, y) => [x, y, (x * 13 + y * 7) % 256, 255]);
    const original = preprocessSourceImage(data, width, height, 16, 'none');
    const turned = preprocessSourceImage(rotate(data, width, height), height, width, 16, 'none');
    expectSamePixels(turned.denoised, rotate(original.denoised, width, height));
  });

  it('a colliding neighbour cannot overwrite the centre Lab during denoising', () => {
    // These distinct 24bit keys collide in the bounded cache. They must stay
    // far apart perceptually, including when a neighbour evicts the centre.
    const data = raster(12, 12, x => x < 6 ? [0, 0, 0, 255] : [0, 42, 194, 255]);
    const result = preprocessSourceImage(data, 12, 12, 16, 'none');
    expectSamePixels(result.denoised, data);
    const reversed = rotate(rotate(data, 12, 12), 12, 12);
    expectSamePixels(preprocessSourceImage(reversed, 12, 12, 16, 'none').denoised, reversed);
  });

  it.each(modes)('%s strength %s excludes hidden RGB and includes alpha exactly at cutoff', (mode, strength) => {
    const cutoff = 16;
    const image = (hidden: Rgba) => raster(12, 12, (x, y) => {
      if (x < 6) return [hidden[0], hidden[1], hidden[2], y % 2 ? cutoff - 1 : 0];
      return [31, 16, 31, x === 6 ? cutoff : x === 7 ? cutoff + 1 : 255];
    });
    const first = image([16, 31, 16, 0]);
    const second = image([250, 240, 5, 0]);
    const output = preprocessSourceImage(first, 12, 12, cutoff, mode, strength);
    const changedHidden = preprocessSourceImage(second, 12, 12, cutoff, mode, strength);
    for (let pixel = 0; pixel < 12 * 12; pixel++) {
      const offset = pixel * 4;
      expect(output.denoised[offset + 3]).toBe(first[offset + 3]);
      expectSamePixels(output.denoised.subarray(offset, offset + 4), first.subarray(offset, offset + 4));
      if (first[offset + 3] >= cutoff) {
        expectSamePixels(changedHidden.denoised.subarray(offset, offset + 4), output.denoised.subarray(offset, offset + 4));
      }
    }
    expect(output.detailMask).toEqual(changedHidden.detailMask);
    expect(Array.from(output.detailMask).every(value => value === 0)).toBe(true);
    expect(output.toneAnchors).toEqual(changedHidden.toneAnchors);
    // Exactly half of all pixels survive, including the entire x=6 column
    // whose alpha equals cutoff. A <= comparison would incorrectly omit it.
    expect(output.toneAnchors).toHaveLength(1);
    expect(output.toneAnchors[0].weight).toBe(0.5);
  });
});
