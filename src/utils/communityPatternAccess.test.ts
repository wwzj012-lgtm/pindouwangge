import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConvertSettings } from '../types';
import { SettingsPanel } from '../components/SettingsPanel';
import * as access from './communityPatternAccess';
import { validateStoredProject, type StoredPatternProject } from './patternGridCodec';
import type { CanvasMembership, CommunityCropRect } from './communityPatternAccess';

const auth = vi.hoisted(() => ({ isVip: false, isPro: false }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../context/LanguageContext', () => ({ useLanguage: () => ({ language: 'zh' }) }));

function project(width = 7, height = 5): StoredPatternProject {
  const settings: ConvertSettings = {
    width, height, keepAspectRatio: true, brand: 'CUSTOM', boardSize: 14,
    dither: 'floyd', colorLimit: 3, brightness: -12, contrast: 18, saturation: 27,
    transparentCutoff: 77, colorMatchAlgo: 'oklab', sharpening: 66, outlineBoost: true,
    vividBoost: true, chromaKeyColor: '#123456', chromaKeyTolerance: 23,
    backgroundRemovalEnabled: true, kmeansClustering: false, pipelineOverride: 'logo',
    ditherStrength: 0.4, quantizationStrength: 17,
  };
  return {
    version: 2, name: '原图', width, height, brand: 'CUSTOM', boardSize: 14, settings,
    grid: Array.from({ length: height }, (_, y) =>
      Array.from({ length: width }, (_, x) => [null, 'near-01', 'near-02'][(x + y) % 3])),
    palette: [
      { id: 'near-01', code: '原色号001', name: '近似色一', hex: '#AABBCC', rgb: [170, 187, 204], brand: 'CUSTOM', symbol: 'A', enabled: false },
      { id: 'near-02', code: '原色号002', name: '近似色二', hex: '#AABBCD', rgb: [170, 187, 205], brand: 'CUSTOM', symbol: 'B', screenReferenceOnly: true },
      { id: 'unused', code: '未使用色', name: '保留完整色板', hex: '#AABBCC', rgb: [170, 187, 204], brand: 'CUSTOM' },
    ],
    createdAt: 123456789,
  };
}

const tiers: { name: string; membership: CanvasMembership; limit: number }[] = [
  { name: '普通', membership: {}, limit: 100 },
  { name: '显式非会员', membership: { isVip: false, isPro: false }, limit: 100 },
  { name: 'VIP', membership: { isVip: true }, limit: 400 },
  { name: 'Pro 独立标记', membership: { isVip: false, isPro: true }, limit: 900 },
  { name: 'VIP + Pro', membership: { isVip: true, isPro: true }, limit: 900 },
];

describe('community canvas membership', () => {
  for (const { name, membership, limit } of tiers) {
    it(`${name} uses a ${limit} per-axis limit`, () => {
      expect(access.canvasLimitForMembership(membership)).toBe(limit);
    });

    it.each([100, 101, 400, 401, 900, 901])(`${name}: boundary %i in square/landscape/portrait`, size => {
      for (const [width, height] of [[size, size], [size, 1], [1, size]]) {
        expect(access.canEditCommunityPattern({ width, height }, membership)).toBe(size <= limit);
      }
    });

    it(`${name} permits the 1x1 minimum`, () => {
      expect(access.canEditCommunityPattern({ width: 1, height: 1 }, membership)).toBe(true);
    });
  }

  for (const axis of ['width', 'height'] as const) {
    it.each([0, -1, -100, 0.5, 100.1, 400.1, 899.9, 900.1, 901, NaN, Infinity, -Infinity])(
      `rejects invalid ${axis}=%s even for Pro`, value => {
        expect(access.canEditCommunityPattern({ width: 1, height: 1, [axis]: value }, { isPro: true })).toBe(false);
      },
    );
    it.each(['100', null, undefined])(`rejects non-number ${axis}=%s`, value => {
      expect(access.canEditCommunityPattern({ width: 1, height: 1, [axis]: value } as unknown as StoredPatternProject, { isPro: true })).toBe(false);
    });
  }

  it('rechecks the current user instead of inheriting author/paid/completion privileges', () => {
    const source = { width: 401, height: 1, isPro: true, paid: true, completion: 'COMPLETED', workId: 'author-work' };
    expect(access.canEditCommunityPattern(source, { isPro: true })).toBe(true);
    expect(access.canEditCommunityPattern(source, { isVip: true })).toBe(false);
    expect(access.canEditCommunityPattern(source, {})).toBe(false);
    expect(access.canEditCommunityPattern({ width: 101, height: 1 }, { isVip: true })).toBe(true);
    expect(access.canEditCommunityPattern({ width: 101, height: 1 }, {})).toBe(false);
  });
});

describe('cropCommunityPattern', () => {
  it('takes an exact independent slice including nulls and near-identical color IDs', () => {
    const source = project();
    const before = JSON.stringify(source);
    const rect = { x: 2, y: 1, width: 4, height: 3 };
    const cropped = access.cropCommunityPattern(source, rect, {});
    const expectedGrid = source.grid.slice(1, 4).map(row => row.slice(2, 6));
    expect(cropped).toEqual({
      ...source, name: '原图（区域副本）', width: 4, height: 3,
      settings: { ...source.settings, width: 4, height: 3 }, grid: expectedGrid,
    });
    expect(new TextEncoder().encode(JSON.stringify(cropped.grid)))
      .toEqual(new TextEncoder().encode(JSON.stringify(expectedGrid)));
    expect(cropped.grid.flat()).toContain(null);
    expect(cropped.grid.flat()).toContain('near-01');
    expect(cropped.grid.flat()).toContain('near-02');
    expect(cropped.palette).toEqual(source.palette);
    expect(() => validateStoredProject(cropped)).not.toThrow();
    expect(JSON.stringify(source)).toBe(before);

    expect(cropped).not.toBe(source);
    expect(cropped.settings).not.toBe(source.settings);
    expect(cropped.grid).not.toBe(source.grid);
    cropped.grid.forEach((row, index) => expect(row).not.toBe(source.grid[rect.y + index]));
    expect(cropped.palette).not.toBe(source.palette);
    cropped.palette.forEach((color, index) => {
      expect(color).not.toBe(source.palette[index]);
      expect(color.rgb).not.toBe(source.palette[index].rgb);
    });
    cropped.grid[0][0] = 'unused';
    cropped.settings.brightness = 99;
    cropped.palette[0].rgb[0] = 0;
    cropped.palette[0].code = '新色号';
    expect(JSON.stringify(source)).toBe(before);
  });

  it('whitelists project fields without carrying work, paid, completion, or source provenance', () => {
    const source = {
      ...project(), workId: 'private-work', id: 'private-id', ownerId: 'author', userId: 'author',
      paid: true, isPaid: true, isVip: true, isPro: true, completion: { unlocked: true },
      completionStatus: 'COMPLETED', detailsUnlocked: true, sourceHash: 'original-hash',
      sourceImageHash: 'image-hash', chargedPoints: 12, privateFutureField: 'must not transfer',
    };
    const before = JSON.stringify(source);
    const cropped = access.cropCommunityPattern(source, { x: 0, y: 0, width: 1, height: 1 }, {});
    expect(Object.keys(cropped).sort()).toEqual([
      'version', 'name', 'width', 'height', 'boardSize', 'brand', 'settings', 'grid', 'palette', 'createdAt',
    ].sort());
    expect(JSON.stringify(source)).toBe(before);
  });

  it('copies all conversion settings while changing only their width/height', () => {
    const source = project();
    const cropped = access.cropCommunityPattern(source, { x: 1, y: 1, width: 2, height: 3 }, {});
    expect(cropped.settings).toEqual({ ...source.settings, width: 2, height: 3 });
    expect(cropped.settings).toHaveProperty('backgroundRemovalEnabled', true);
    expect(cropped.brand).toBe('CUSTOM');
    expect(cropped.boardSize).toBe(14);
    expect(cropped.createdAt).toBe(source.createdAt);
    expect(cropped.version).toBe(source.version);
  });

  it.each(['原图', '图'.repeat(60), '图'.repeat(200), ''])('retains a region-copy suffix within 60 characters', name => {
    const source = { ...project(), name };
    const cropped = access.cropCommunityPattern(source, { x: 0, y: 0, width: 1, height: 1 }, {});
    expect(cropped.name).toMatch(/区域副本）$/);
    expect(cropped.name.length).toBeLessThanOrEqual(60);
    expect(source.name).toBe(name);
  });

  it.each([
    { x: 0, y: 0, width: 7, height: 5 },
    { x: 6, y: 4, width: 1, height: 1 },
    { x: 0, y: 4, width: 7, height: 1 },
    { x: 6, y: 0, width: 1, height: 5 },
  ])('allows exact full/edge/landscape/portrait bounds: %j', rect => {
    const source = project();
    const cropped = access.cropCommunityPattern(source, rect, {});
    expect(cropped.grid).toEqual(source.grid.slice(rect.y, rect.y + rect.height).map(row => row.slice(rect.x, rect.x + rect.width)));
    expect(cropped.width).toBe(rect.width);
    expect(cropped.height).toBe(rect.height);
  });

  for (const field of ['x', 'y', 'width', 'height'] as const) {
    const invalid = [NaN, Infinity, -Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER, '1', null, undefined];
    if (field === 'width' || field === 'height') invalid.push(0);
    it.each(invalid)(`rejects invalid rectangle ${field}=%s with a Chinese error and no mutation`, value => {
      const source = project();
      const before = JSON.stringify(source);
      const rect = { x: 0, y: 0, width: 1, height: 1, [field]: value } as unknown as CommunityCropRect;
      expect(() => access.cropCommunityPattern(source, rect, {})).toThrow(/[\u4e00-\u9fff]/);
      expect(JSON.stringify(source)).toBe(before);
    });
  }

  it.each([
    { x: 7, y: 0, width: 1, height: 1 },
    { x: 0, y: 5, width: 1, height: 1 },
    { x: 6, y: 0, width: 2, height: 1 },
    { x: 0, y: 4, width: 1, height: 2 },
    { x: 0, y: 0, width: 8, height: 5 },
    { x: 0, y: 0, width: 7, height: 6 },
  ])('rejects out-of-bounds %j instead of clamping/resizing', rect => {
    const source = project();
    const before = JSON.stringify(source);
    expect(() => access.cropCommunityPattern(source, rect, { isPro: true })).toThrow(/超出.*原图|原图.*范围/);
    expect(JSON.stringify(source)).toBe(before);
  });

  for (const { name, membership, limit } of tiers) {
    it(`${name} may crop at exactly ${limit} from a larger author's canvas`, () => {
      const source = project(900, 2);
      const before = JSON.stringify(source);
      const cropped = access.cropCommunityPattern(source, { x: 900 - limit, y: 0, width: limit, height: 2 }, membership);
      expect(cropped.width).toBe(limit);
      expect(cropped.grid[0]).toHaveLength(limit);
      expect(cropped.grid).toEqual(source.grid.map(row => row.slice(900 - limit)));
      expect(access.canEditCommunityPattern(cropped, membership)).toBe(true);
      expect(JSON.stringify(source)).toBe(before);
    });
    it(`${name} may crop a portrait at exactly ${limit}`, () => {
      const source = project(2, 900);
      const cropped = access.cropCommunityPattern(source, { x: 0, y: 900 - limit, width: 2, height: limit }, membership);
      expect(cropped.grid).toEqual(source.grid.slice(900 - limit));
      expect(cropped.height).toBe(limit);
    });
    if (limit < 900) {
      it.each(['width', 'height'] as const)(`${name} rejects %s above ${limit} without resizing`, axis => {
        const source = axis === 'width' ? project(limit + 1, 1) : project(1, limit + 1);
        const before = JSON.stringify(source);
        expect(() => access.cropCommunityPattern(source, { x: 0, y: 0, width: source.width, height: source.height }, membership))
          .toThrow(new RegExp(`(权益|上限|升级).*${limit}|${limit}.*(权益|上限|升级)`));
        expect(JSON.stringify(source)).toBe(before);
      });
    }
  }

  it('rejects a 901-cell source even when the requested crop fits Pro', () => {
    expect(() => access.cropCommunityPattern(project(901, 1), { x: 0, y: 0, width: 900, height: 1 }, { isPro: true })).toThrow();
  });

  it('copies a full 900x900 Pro canvas without recomputing any cells', () => {
    const source = project(900, 900);
    const cropped = access.cropCommunityPattern(source, { x: 0, y: 0, width: 900, height: 900 }, { isPro: true });
    expect(cropped.width).toBe(900);
    expect(cropped.height).toBe(900);
    expect(cropped.grid).toEqual(source.grid);
    expect(cropped.grid[899]).not.toBe(source.grid[899]);
    expect(cropped.palette).toEqual(source.palette);
    expect(() => validateStoredProject(cropped)).not.toThrow();
  });

  it.each([
    { x: 0, y: 0, width: 901, height: 1 },
    { x: 0, y: 0, width: 1, height: 901 },
  ])('rejects a 901-cell rectangle for Pro with a Chinese bounds error: %j', rect => {
    const source = rect.width > 900 ? project(900, 1) : project(1, 900);
    expect(() => access.cropCommunityPattern(source, rect, { isPro: true })).toThrow(/超出.*原图|原图.*范围/);
  });

  it.each([
    (source: StoredPatternProject) => { source.version = 1 as 2; },
    (source: StoredPatternProject) => { source.grid[4].pop(); },
    (source: StoredPatternProject) => { source.grid[4][6] = 'unknown-color'; },
    (source: StoredPatternProject) => { source.settings.width = 6; },
    (source: StoredPatternProject) => { source.settings.brightness = NaN; },
    (source: StoredPatternProject) => { source.palette.push({ ...source.palette[0] }); },
    (source: StoredPatternProject) => { source.boardSize = 0; },
  ])('validates the entire original project before slicing (%#)', corrupt => {
    const source = project();
    corrupt(source);
    const before = JSON.stringify(source);
    expect(() => access.cropCommunityPattern(source, { x: 0, y: 0, width: 1, height: 1 }, {})).toThrow();
    expect(JSON.stringify(source)).toBe(before);
  });
});

describe('SettingsPanel shared membership limit', () => {
  afterEach(() => vi.restoreAllMocks());

  function renderPanel() {
    return renderToStaticMarkup(React.createElement(SettingsPanel, {
      settings: project().settings, setSettings: () => {}, conversionDiagnostics: null,
      onReconvert: () => {}, hasImage: false, onOpenImageStudio: () => {},
    }));
  }

  it.each(tiers)('$name renders the shared $limit width and height limits', ({ membership, limit }) => {
    Object.assign(auth, { isVip: false, isPro: false }, membership);
    const html = renderPanel();
    expect(html.match(new RegExp(`type="number"[^>]*max="${limit}"`, 'g'))).toHaveLength(2);
  });

  it('delegates its limit to the helper rather than retaining a second tier expression', () => {
    Object.assign(auth, { isVip: true, isPro: false });
    const limit = vi.spyOn(access, 'canvasLimitForMembership').mockReturnValue(137);
    const html = renderPanel();
    expect(limit).toHaveBeenCalledWith({ isVip: true, isPro: false });
    expect(html.match(/type="number"[^>]*max="137"/g)).toHaveLength(2);
  });
});
