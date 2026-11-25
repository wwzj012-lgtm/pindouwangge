/**
 * 最大颜色数（maxColors）限制的裁决单测（2026-11-25 用户需求）。
 *
 * 契约：
 * 1. 未启用 / 未超限时结果逐位一致（返回 null，不改任何格）；
 * 2. 超限时保留「出现格数最多」的前 N 支（并列按色号字典序，结果稳定）；
 * 3. 被删色号的格用**自身 sampleRgb** 在保留色板里重选（不是色板级映射），
 *    distance 更新为真实距离，旧全色板的 runnerUp 语义清空；
 * 4. blank / 无采样色的格不动。
 */
import { describe, expect, it } from 'vitest';
import type { BeadColor } from '../types';
import { deltaE2000, preparePaletteLab, rgbToLab } from './colorUtils';
import { applyMaxColorsLimit, type ImportRecognitionCell } from './importRecognition';

const palette: BeadColor[] = [
  { id: 'red', code: 'R1', name: 'Red', hex: '#ff0000', rgb: [220, 30, 30], brand: 'CUSTOM' },
  { id: 'blue', code: 'B1', name: 'Blue', hex: '#0000ff', rgb: [30, 40, 210], brand: 'CUSTOM' },
  { id: 'green', code: 'G1', name: 'Green', hex: '#00aa00', rgb: [30, 170, 40], brand: 'CUSTOM' },
  { id: 'teal', code: 'T1', name: 'Teal', hex: '#008877', rgb: [20, 140, 120], brand: 'CUSTOM' },
];
const prepared = preparePaletteLab(palette);
const byCode = new Map(palette.map(color => [color.code, color]));

function cell(partial: Partial<ImportRecognitionCell> & { colorId: string | null }): ImportRecognitionCell {
  const color = partial.colorId ? byCode.get(partial.colorId) ?? null : null;
  const base = {
    row: 0,
    column: 0,
    status: 'mapped',
    color,
    colorId: null,
    sampleRgb: null,
    distance: null,
    sampleCount: 16,
    coverage: 16,
    sampledArea: 16,
    dominantRatio: 0.9,
    runnerUpRatio: 0.1,
    confidence: 0.9,
    quality: 'good',
    ...partial,
  } as ImportRecognitionCell;
  // 真实管线的 colorId 是 color.id（≠ code）——2026-11-25 实测保留集按
  // code 建会把整个限制静默打空，这里刻意让 id ≠ code 锁住该契约。
  // partial.colorId 书写的是 code（便捷），落库统一转成 color.id。
  return { ...base, colorId: color ? color.id : null };
}

function grid(colorIds: string[][]): ImportRecognitionCell[][] {
  return colorIds.map((row, y) => row.map((colorId, x) => cell({
    colorId,
    row: y,
    column: x,
    sampleRgb: colorId ? (byCode.get(colorId)?.rgb ?? null) : null,
    runnerUpColorId: colorId ? 'G1' : null,
    runnerUpSeparation: colorId ? 3 : null,
  })));
}

const KEPT = new Set(['R1', 'B1']);
function keptSetFor(code: string | null): boolean {
  return !!code && KEPT.has(code);
}

function countCodes(cells: ImportRecognitionCell[][]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of cells) for (const c of row) if (c.colorId) out[c.colorId] = (out[c.colorId] ?? 0) + 1;
  return out;
}

describe('applyMaxColorsLimit', () => {
  it('未启用（0/undefined）与未超限时返回 null，不改任何格', () => {
    const cells = grid([['R1', 'B1'], ['G1', 'T1']]);
    expect(applyMaxColorsLimit(cells, { preparedPalette: prepared }, 0)).toBeNull();
    expect(applyMaxColorsLimit(cells, { preparedPalette: prepared }, undefined)).toBeNull();
    expect(applyMaxColorsLimit(cells, { preparedPalette: prepared }, 4)).toBeNull();
    expect(applyMaxColorsLimit(cells, { preparedPalette: prepared }, 99)).toBeNull();
  });

  it('超限时保留出现最多的 N 支，其余格按 sampleRgb 重选', () => {
    // R1×6、B1×3、G1×2、T1×1 → limit 2 保留 R1/B1；G1、T1 的格子重选。
    const cells = grid([
      ['R1', 'R1', 'R1'],
      ['R1', 'R1', 'R1'],
      ['B1', 'B1', 'B1'],
      ['G1', 'G1', 'T1'],
    ]);
    const result = applyMaxColorsLimit(cells, { preparedPalette: prepared }, 2);
    expect(result).not.toBeNull();
    expect(result!.kept).toBe(2);
    expect(result!.requested).toBe(2);
    expect(result!.remapped).toBe(3);
    const counts = countCodes(result!.cells);
    const idOf = (code: string) => byCode.get(code)!.id;
    expect(Object.keys(counts).sort()).toEqual([idOf('B1'), idOf('R1')].sort());
    expect(counts[idOf('R1')]).toBe(6);
    // 重选去向不预判（ΔE2000 的色相权重并不直觉），只要求与
    // "sampleRgb 对保留色板逐支算 ΔE2000 取 argmin"的独立计算一致。
    const keptPalette = prepared.filter(p => p.color.code === 'R1' || p.color.code === 'B1');
    for (const [y, row] of result!.cells.entries()) {
      for (const [x, c] of row.entries()) {
        if (!cells[y]![x] || keptSetFor(cells[y]![x]!.colorId)) continue;
        const nearest = keptPalette
          .map(p => ({ id: p.color.id, d: deltaE2000(rgbToLab(...cells[y]![x]!.sampleRgb!), p.lab) }))
          .sort((l, r) => l.d - r.d)[0]!;
        expect(c.colorId).toBe(nearest.id);
      }
    }
    const remappedCell = result!.cells[3]![0]!;
    expect(remappedCell.colorId).not.toBe('G1');
    const dToBlue = deltaE2000(rgbToLab(...remappedCell.sampleRgb!), rgbToLab(...byCode.get('B1')!.rgb));
    const dToRed = deltaE2000(rgbToLab(...remappedCell.sampleRgb!), rgbToLab(...byCode.get('R1')!.rgb));
    expect(remappedCell.colorId).toBe(dToBlue < dToRed ? idOf('B1') : idOf('R1'));
    // 距离语义更新为"采样色 → 新色号"的真实距离。
    expect(remappedCell.distance).toBeCloseTo(Math.min(dToBlue, dToRed), 6);
    // 旧 runnerUp 语义失效，清空。
    expect(remappedCell.runnerUpColorId).toBeNull();
    expect(remappedCell.runnerUpSeparation).toBeNull();
    // 保留色号的格子逐位不变。
    expect(result!.cells[0]![0]).toBe(cells[0]![0]);
    expect(result!.cells[2]![1]).toBe(cells[2]![1]);
  });

  it('并列格数按色号字典序决胜（同一输入结果稳定）', () => {
    const cells = grid([['B1', 'R1'], ['G1', 'T1']]);
    const a = applyMaxColorsLimit(cells, { preparedPalette: prepared }, 2)!;
    const b = applyMaxColorsLimit(cells, { preparedPalette: prepared }, 2)!;
    expect(countCodes(a.cells)).toEqual(countCodes(b.cells));
    // B1 与 R1 都是 1 格，字典序 B1 < G1 < R1 < T1 → 保留 B1、G1。
    const idOf = (code: string) => byCode.get(code)!.id;
    expect(Object.keys(countCodes(a.cells)).sort()).toEqual([idOf('B1'), idOf('G1')].sort());
  });

  it('blank 与无采样色的 mapped 格不动', () => {
    const cells: ImportRecognitionCell[][] = [
      [cell({ colorId: null, status: 'blank', color: null, sampleRgb: null, runnerUpColorId: null, runnerUpSeparation: null }), cell({ colorId: 'T1', sampleRgb: null })],
      [cell({ colorId: 'R1', sampleRgb: byCode.get('R1')!.rgb }), cell({ colorId: 'R1', sampleRgb: byCode.get('R1')!.rgb })],
    ];
    const result = applyMaxColorsLimit(cells, { preparedPalette: prepared }, 1);
    expect(result).not.toBeNull();
    // T1 无采样色 → 无法重选，保持原样（不编造）。
    expect(result!.cells[0]![1]!.colorId).toBe(byCode.get('T1')!.id);
    expect(result!.cells[0]![0]!.status).toBe('blank');
    expect(result!.remapped).toBe(0);
  });
});
