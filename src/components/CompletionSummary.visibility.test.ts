import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CompletionSummary, type CompletionSummaryProps } from './CompletionSummary';
import { StatsPanel } from './StatsPanel';
import { LanguageProvider } from '../context/LanguageContext';
import type { BeadColor } from '../types';

const noop = () => {};
const base: CompletionSummaryProps = { isEn: false, isUnlocked: false, needsSupplement: false, nonEmptyBeads: 3, quotedPoints: 0.7, estimatedPoints: null, quoteStatus: 'idle', hasFormalLogin: true, completionStatus: 'DRAFT', onQuote: noop, onRetryQuote: noop, quote: null, onCancelQuote: noop, onComplete: noop, balance: '100.0' };
const summary = (props: Partial<CompletionSummaryProps>) => renderToStaticMarkup(React.createElement(CompletionSummary, { ...base, ...props }));

describe('always-visible completion estimates and existing details gate', () => {
  beforeEach(() => vi.stubGlobal('localStorage', { getItem: () => null, setItem: noop }));
  afterEach(() => vi.unstubAllGlobals());
  it.each([false, true])('does not repeat bead counts in the summary, keeping the server quote visible, unlocked=%s', isUnlocked => {
    const html = summary({ isUnlocked, quotedPoints: isUnlocked ? 0 : 0.7 });
    expect(html).not.toContain('总有效豆数');
    expect(html).not.toContain('总用豆数');
    expect(summary({ isEn: true, isUnlocked })).not.toContain('Total non-empty beads');
    expect(html).toContain('aria-label="积分报价"');
    expect(html).toContain(isUnlocked ? '追加需 0 积分' : '本次需 0.7 积分');
    expect(html).toContain('服务端报价');
    expect(html).toContain('积分 100.0');
    expect(html).not.toContain('积分 1000');
    expect(html).not.toContain('确认并解锁');
  });
  it('identifies the existing anonymous estimate, not a server-approved zero', () => {
    const html = summary({ hasFormalLogin: false, quotedPoints: null, estimatedPoints: 0.2 });
    expect(html).toContain('预估 0.2 积分 · 登录核准');
    expect(html).not.toContain('服务端报价');
    expect(summary({ hasFormalLogin: false, estimatedPoints: null, quotedPoints: null })).toContain('登录后核准积分报价');
  });
  it('marks a manually created canvas free and omits all credit quoting and payment actions', () => {
    const html = summary({ isFreehand: true, isUnlocked: true, quotedPoints: null, estimatedPoints: null });
    expect(html).toContain('手工画板 · 免费使用');
    expect(html).not.toContain('积分报价');
    expect(html).not.toContain('查看解锁确认');
    expect(html).not.toContain('确认并解锁');
  });
  it.each(['loading', 'invalid', 'error'] as const)('does not display the previous amount in %s state', quoteStatus => {
    const html = summary({ quoteStatus });
    expect(html).not.toContain('0.7');
    expect(html).toContain('disabled');
    if (quoteStatus === 'error') expect(html).toContain('重试报价');
  });
  it('confirms only the current delta, never a receipt/total or a fabricated zero', () => {
    expect(summary({ needsSupplement: true, quotedPoints: 0.4, completionStatus: 'AWAITING_CONFIRMATION', quote: { nonEmptyBeads: 4, chargedPoints: 1.1 } })).toContain('确认支付 0.4 积分');
    const invalid = summary({ quotedPoints: null, completionStatus: 'AWAITING_CONFIRMATION', quote: { nonEmptyBeads: 4 } });
    expect(invalid).toContain('确认支付 — 积分');
    expect(invalid).not.toContain('确认支付 0 积分');
    expect(invalid).toMatch(/disabled=""[^>]*>确认并解锁/);
  });
  it.each([false, true])('keeps the actual StatsPanel total visible in locked and unlocked states, detailsUnlocked=%s', detailsUnlocked => {
    const color: BeadColor = { id: 'local-color', code: 'SECRET-M01', name: 'SECRET-NAME', hex: '#AABBCC', rgb: [170, 187, 204], symbol: 'A', brand: 'MARD' };
    const grid: (string | null)[][] = Array.from({ length: 35 }, () => Array(35).fill(null));
    grid[17][17] = color.id; grid[17][18] = color.id; grid[17][19] = 'unknown-palette-id';
    const panel = React.createElement(StatsPanel, { grid, paletteMap: new Map([[color.id, color]]), width: 35, height: 35, boardSize: 29, onOpenReplaceModal: noop, onSelectColor: noop, detailsUnlocked });
    const html = renderToStaticMarkup(React.createElement(LanguageProvider, { children: panel }));
    expect(html).toMatch(/aria-label="总用豆数"[\s\S]*?>3<\/div>/);
    expect(html).toMatch(/aria-label="颜色种类数量"[\s\S]*?>2<\/div>/);
    const combined = summary({ isUnlocked: detailsUnlocked }) + html;
    expect(combined.match(/aria-label="总用豆数"/g)).toHaveLength(1);
    expect(combined).not.toContain('总有效豆数');
    expect(html).not.toContain('1225');
    if (detailsUnlocked) expect(html).toContain('SECRET-M01');
    else { expect(html).not.toContain('SECRET-M01'); expect(html).not.toContain('SECRET-NAME'); expect(html).toContain('完成图纸后即可解锁'); }
  });
});
