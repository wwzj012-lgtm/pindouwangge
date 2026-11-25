import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BeadColor } from '../types';
import type { LegendEntry } from '../utils/importLegend';
import {
  lockAllDisabled,
  lockableCountSum,
  parseEntriesToRows,
  parseSkippedCount,
  shouldAutoWhitelist,
  unlockAllDisabled,
  type LegendLockRow,
} from './ImportLegendPanel';

/**
 * 图例锁定面板的裁决口径单测（数量锁定改用户显式勾选）：
 * 1. handleAutoParse 的装配步骤 parseEntriesToRows 对所有解析行
 *    countLocked === false（色板白名单 enabled 默认开不变）；
 * 2. 「全部锁定数量」在 Σ粒数 > 网格格数时禁用；
 * 3. 源码契约：面板里不允许再出现 countLocked: true 的默认装配。
 */

const here = dirname(fileURLToPath(import.meta.url));

const PALETTE_CODES = new Set(['C15', 'D24', 'F3']);

function entry(partial: Partial<LegendEntry> & { code: string }): LegendEntry {
  return { count: 10, confidence: 0.9, ...partial };
}

describe('parseEntriesToRows (handleAutoParse 装配)', () => {
  it('leaves every parsed row count-unlocked by default (adjudication: explicit opt-in only)', () => {
    const entries: LegendEntry[] = [
      entry({ code: 'C15', count: 953, confidence: 0.93 }),
      entry({ code: 'D24', count: 53, confidence: 0.42, warn: 'lowConfidence' }),
      entry({ code: 'ZZ9', count: 7, confidence: 0.5, warn: 'codeNotInPalette' }),
    ];
    const rows = parseEntriesToRows(entries, PALETTE_CODES);
    expect(rows).toHaveLength(3);
    // 裁决主修点：全部行数量默认不锁——错配额不再驱动平衡改写。
    expect(rows.map(row => row.countLocked)).toEqual([false, false, false]);
    expect(rows.map(row => row.count)).toEqual([953, 53, 7]);
    // 色板白名单默认开不变。
    expect(rows.map(row => row.enabled)).toEqual([true, true, false]);
    // 低置信行保留置信度与 warn，UI 标黄提示不受影响。
    expect(rows[1].confidence).toBe(0.42);
    expect(rows[1].warn).toBe('lowConfidence');
  });

  it('keeps parsed counts as reference values even when they exceed the grid', () => {
    const rows = parseEntriesToRows([entry({ code: 'C15', count: 6331 })], PALETTE_CODES);
    expect(rows[0].countLocked).toBe(false);
    expect(rows[0].count).toBe(6331);
    expect(rows[0].enabled).toBe(true);
  });

  it('prefills a swatch-based suggestion for unread codes instead of emitting blank rows', () => {
    // 空白行治理（2026-11-14 用户实测）：色号未读出的条目不再生成空行占 UI。
    const palette: BeadColor[] = [
      { id: 'p-c15', code: 'C15', name: '天蓝', hex: '#88ccee', rgb: [136, 204, 238], brand: 'MARD' },
      { id: 'p-d24', code: 'D24', name: '深蓝', hex: '#224488', rgb: [34, 68, 136], brand: 'MARD' },
    ];
    const entries: LegendEntry[] = [
      // 色点颜色贴近 C15：预填建议 + codeFromSwatch 警示，参与白名单。
      entry({ code: '', count: 0, confidence: 0.3, warn: 'countUnread', dotRgb: [140, 200, 230] }),
      // 无色点、无 code：连建议都给不出，整行省略。
      entry({ code: '', count: 0, confidence: 0.2, warn: 'countUnread' }),
      // 正常条目不受影响。
      entry({ code: 'D24', count: 377, confidence: 0.9 }),
    ];
    const codes = new Set(palette.map(color => color.code));
    const rows = parseEntriesToRows(entries, codes, palette);
    expect(rows).toHaveLength(2);
    expect(rows[0].code).toBe('C15');
    expect(rows[0].enabled).toBe(true);
    expect(rows[0].warn).toContain('codeFromSwatch');
    expect(rows[0].countLocked).toBe(false);
    expect(rows[1].code).toBe('D24');
    expect(parseSkippedCount(entries, palette)).toBe(1);
    // 不带色板参数时（旧调用口径）未读条目一律省略，不产生空白行。
    expect(parseEntriesToRows(entries, codes)).toHaveLength(1);
    expect(parseSkippedCount(entries)).toBe(2);
  });
});

function row(partial: Partial<LegendLockRow> & { code: string }): LegendLockRow {
  return { code: partial.code, count: 10, countLocked: false, enabled: true, ...partial };
}

describe('lockAllDisabled (「全部锁定数量」禁用态)', () => {
  it('disables when the projected sum of lockable rows exceeds the grid cells', () => {
    const rows = [row({ code: 'C15', count: 600, enabled: true }), row({ code: 'D24', count: 400, enabled: true })];
    expect(lockableCountSum(rows)).toBe(1000);
    expect(lockAllDisabled(rows, 576)).toBe(true); // 24×24 网格
    expect(lockAllDisabled(rows, 1000)).toBe(false); // 恰好等于格数不禁用
    expect(lockAllDisabled(rows, 1024)).toBe(false);
  });

  it('also disables when the currently locked rows alone already exceed the grid', () => {
    const rows = [row({ code: 'C15', count: 600, countLocked: true }), row({ code: 'D24', count: 10, countLocked: false })];
    // 投影合计 ≥ 已锁定合计，超格的已锁定状态同样被禁用覆盖。
    expect(lockAllDisabled(rows, 576)).toBe(true);
  });

  it('ignores disabled rows and zero counts in the projection', () => {
    const rows = [row({ code: 'C15', count: 700, enabled: false }), row({ code: 'D24', count: 0 })];
    expect(lockableCountSum(rows)).toBe(0);
    expect(lockAllDisabled(rows, 576)).toBe(false);
  });

  it('disables when there are no rows at all', () => {
    expect(lockAllDisabled([], 576)).toBe(true);
  });

  it('skips the over-grid guard when the grid size is unknown (0)', () => {
    const rows = [row({ code: 'C15', count: 9999 })];
    expect(lockAllDisabled(rows, 0)).toBe(false);
  });
});

describe('unlockAllDisabled (「全部解锁」禁用态)', () => {
  it('disables when no row is count-locked', () => {
    expect(unlockAllDisabled([row({ code: 'C15' }), row({ code: 'D24' })])).toBe(true);
    expect(unlockAllDisabled([])).toBe(true);
  });

  it('enables when at least one row is count-locked', () => {
    expect(unlockAllDisabled([row({ code: 'C15' }), row({ code: 'D24', countLocked: true })])).toBe(false);
  });
});

describe('shouldAutoWhitelist (解析可信时自动启用白名单)', () => {
  // 用户实测场景（2026-11-14）：27 色解析基本正确时必须自动开白名单，
  // 否则识别照样吐 70+ 杂色，功能形同虚设。
  it('auto-enables when most parsed codes hit the palette', () => {
    const rows = [
      row({ code: 'C15' }),
      row({ code: 'D24' }),
      row({ code: 'F3' }),
      row({ code: 'ZZ9', enabled: false }),
    ];
    expect(shouldAutoWhitelist(rows, undefined)).toBe(true);
  });

  it('auto-enables on header color-count self-consistency', () => {
    const rows = [row({ code: 'C15' }), row({ code: 'D24' })];
    expect(shouldAutoWhitelist(rows, 2)).toBe(true);
  });

  it('keeps whitelist off when parse codes mostly miss the palette (3-of-28 disaster)', () => {
    // 瑶图灾难场景：28 行解析只有 3 个色号有效——开白名单会把整图压成 3 色。
    const rows = [
      row({ code: 'C15' }),
      row({ code: 'D24' }),
      row({ code: 'F3' }),
      ...Array.from({ length: 25 }, (_, i) => row({ code: `X${i}`, enabled: false })),
    ];
    expect(shouldAutoWhitelist(rows, undefined)).toBe(false);
    // 头部色数自洽也救不了命中率过低：自洽条件要求 usable === headerCount。
    expect(shouldAutoWhitelist(rows, 28)).toBe(false);
  });

  it('keeps whitelist off with no usable rows', () => {
    expect(shouldAutoWhitelist([], undefined)).toBe(false);
    expect(shouldAutoWhitelist([row({ code: 'ZZ9', enabled: false })], undefined)).toBe(false);
  });
});

describe('source contract (面板默认装配不再锁数量)', () => {
  it('handleAutoParse assembles rows via parseEntriesToRows and never hard-codes countLocked: true', () => {
    const source = readFileSync(join(here, 'ImportLegendPanel.tsx'), 'utf8');
    expect(source).toContain('parseEntriesToRows(result.entries');
    // 源码里 countLocked: true 只允许出现一次——「全部锁定数量」回调里的
    // 显式置位；解析装配/手动加行一律 false。
    expect(source.match(/countLocked: true/g)).toHaveLength(1);
    expect(source).toContain('? { ...row, countLocked: true } : row');
    // 常驻提示：一键锁定旁的核对提醒。
    expect(source).toContain('粒数自动识别准确率有限，锁定前请核对数字');
    expect(source).toContain('全部锁定数量');
    expect(source).toContain('全部解锁');
  });
});

describe('source contract (lastParse 允许为 null)', () => {
  /**
   * 2026-11-25 线上崩溃：第一次识别 → 返回 → 再进来时，value.rows 由父组件
   * 恢复而 lastParse 是 null，`lastParse.sourceQuality` 直接抛
   * TypeError: Cannot read properties of null，整个导入面板进错误边界。
   * 契约：每一处 lastParse 字段访问，其前文必须有 `lastParse &&` 或
   * `lastParse?.` 形式的守卫。
   */
  it('never dereferences lastParse fields without a null guard', () => {
    const source = readFileSync(join(here, 'ImportLegendPanel.tsx'), 'utf8');
    const offenders: string[] = [];
    for (const match of source.matchAll(/lastParse\.([A-Za-z_$][\w$]*)/g)) {
      const at = match.index ?? 0;
      // 向前回溯 400 字符找守卫（JSX 条件可能跨多行，如 `{lastParse && ...}`）。
      const context = source.slice(Math.max(0, at - 400), at);
      const guarded = /lastParse\s*&&[\s\S]*$/.test(context) || /lastParse\?\.[\s\S]*$/.test(context);
      if (!guarded) offenders.push(source.slice(at, at + 60).split('\n')[0]);
    }
    expect(offenders).toEqual([]);
    // 源图质量提示必须走派生常量（null 安全）。
    expect(source).toContain('lastParse?.sourceQuality');
  });
});
