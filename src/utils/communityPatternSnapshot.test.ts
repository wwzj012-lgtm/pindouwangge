import { afterEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { communityDraft, embedCommunitySnapshot, readCommunitySnapshot, renderCommunityPattern } from './communityPatternSnapshot';
import type { StoredPatternProject } from './patternGridCodec';

const project = (width = 129, height = 131): StoredPatternProject => ({
  version: 2, name: 'Exact original', width, height, boardSize: 26, brand: 'MARD', createdAt: 1,
  settings: { width, height, keepAspectRatio: true, brand: 'MARD', dither: 'none', colorLimit: 0,
    brightness: 0, contrast: 0, saturation: 0, transparentCutoff: 128, boardSize: 26,
    colorMatchAlgo: 'ciede2000', sharpening: 0, outlineBoost: false, chromaKeyColor: null, chromaKeyTolerance: 0 },
  palette: [
    { id: 'light', code: 'A01', name: 'Light', hex: '#FAF9F8', rgb: [250, 249, 248], brand: 'MARD' },
    { id: 'similar', code: 'A02', name: 'Similar', hex: '#FAF9F7', rgb: [250, 249, 247], brand: 'MARD' },
  ],
  grid: Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => (x + y) % 3 === 0 ? null : x % 2 ? 'light' : 'similar')),
});
const png = async () => new Blob([new Uint8Array(await sharp({ create: { width: 2, height: 3, channels: 4, background: '#ff0000' } }).png().toBuffer())], { type: 'image/png' });

afterEach(() => vi.unstubAllGlobals());

describe('immutable public pattern snapshots', () => {
  it('preserves supported maximum dimensions instead of downsampling a large pattern', async () => {
    const input = project(900, 900);
    const restored = await readCommunitySnapshot(await embedCommunitySnapshot(await png(), input));
    expect(restored?.width).toBe(900);
    expect(restored?.height).toBe(900);
    expect(restored?.grid).toEqual(input.grid);
  });
  it('round trips rectangular grids across chunks without losing null cells or near-identical color IDs', async () => {
    const input = project();
    const file = await embedCommunitySnapshot(await png(), input);
    expect(await readCommunitySnapshot(file)).toEqual(input);
    expect((await sharp(Buffer.from(await file.arrayBuffer())).metadata()).format).toBe('png');
  });

  it('does not publish ownership, source hashes or completion entitlements', async () => {
    const input = { ...project(3, 5), workId: 'private-work', completionStatus: 'COMPLETED', paidNonEmptyBeads: 900, sourceHash: 'private-hash' };
    const restored = await readCommunitySnapshot(await embedCommunitySnapshot(await png(), input));
    expect(restored).toEqual(project(3, 5));
    const draft = communityDraft(input, 'new-draft');
    expect(draft.workId).toBe('new-draft');
    expect(draft).not.toHaveProperty('completionStatus');
    expect(draft).not.toHaveProperty('sourceHash');
    draft.grid[0]![0] = 'light';
    expect(input.grid[0]![0]).toBeNull();
  });

  it('returns no editable grid for old image-only PNG and JPEG publications', async () => {
    expect(await readCommunitySnapshot(await png())).toBeNull();
    expect(await readCommunitySnapshot(new Blob(['old jpeg']))).toBeNull();
  });

  it('rejects corrupt, duplicate, and truncated snapshot chunks instead of regenerating an image', async () => {
    const file = await embedCommunitySnapshot(await png(), project(3, 5));
    const bytes = new Uint8Array(await file.arrayBuffer());
    const start = Buffer.from(bytes).indexOf('bpGd');
    bytes[start + 10] ^= 1;
    await expect(readCommunitySnapshot(new Blob([bytes]))).rejects.toThrow('校验失败');
    await expect(embedCommunitySnapshot(file, project())).rejects.toThrow('新的 PNG');
    await expect(readCommunitySnapshot(file.slice(0, -1))).rejects.toThrow('不完整');
  });

  it('renders a lossless integer-scaled transparent preview of the full grid, never a cached thumbnail', async () => {
    const input = project(300, 2);
    const rects: { color: string; rect: number[] }[] = [];
    const context = { fillStyle: '', fillRect(...rect: number[]) { rects.push({ color: this.fillStyle, rect }); } };
    const canvas = { width: 0, height: 0, getContext: vi.fn(() => context), toBlob: vi.fn(async (callback: (blob: Blob) => void, type: string) => {
      expect(type).toBe('image/png'); callback(await png());
    }) };
    vi.stubGlobal('document', { createElement: vi.fn(() => canvas) });
    const result = await renderCommunityPattern(input);
    expect(canvas.width).toBe(900);
    expect(canvas.height).toBe(6);
    expect(canvas.getContext).toHaveBeenCalledWith('2d');
    expect(rects).toHaveLength(input.grid.flat().filter(Boolean).length);
    expect(rects[0]).toEqual({ color: '#FAF9F8', rect: [3, 0, 3, 3] });
    expect(rects.every(({ rect }) => rect[2] === 3 && rect[3] === 3)).toBe(true);
    expect(await readCommunitySnapshot(result)).toEqual(input);
  });
});
