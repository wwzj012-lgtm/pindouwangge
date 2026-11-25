// 豆上符号墨色回归：#000000 通道 0 被 `parseInt(...) || 255` 强转 255 的老坑，
// 纯黑豆（H7）误判为亮色 → 深墨印黑豆，色号隐身（2026-11-26 用户反馈）。
import { describe, expect, it, vi } from 'vitest';
import { drawBeadOnCanvas } from './exportUtils';

type CanvasEvent = { name: string; args: unknown[] };

function createRecordingContext() {
  const events: CanvasEvent[] = [];
  const record = (name: string) => vi.fn((...args: unknown[]) => events.push({ name, args }));
  const context = {
    events,
    beginPath: record('beginPath'),
    arc: record('arc'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    fill: record('fill'),
    stroke: record('stroke'),
    fillRect: record('fillRect'),
    strokeRect: record('strokeRect'),
    fillText: record('fillText'),
    save: record('save'),
    restore: record('restore'),
  } as Record<string, unknown>;
  for (const prop of ['fillStyle', 'strokeStyle', 'lineWidth', 'font', 'textAlign', 'textBaseline', 'globalAlpha', 'filter']) {
    Object.defineProperty(context, prop, {
      set: (value: unknown) => events.push({ name: prop, args: [value] }),
    });
  }
  return context as unknown as CanvasRenderingContext2D & { events: CanvasEvent[] };
}

function symbolInk(context: CanvasRenderingContext2D & { events: CanvasEvent[] }): string | undefined {
  // 文字墨色是绘制序列里最后一次 fillStyle 赋值（豆底色在最前）
  const fillStyles = context.events.filter(e => e.name === 'fillStyle').map(e => String(e.args[0]));
  return fillStyles.at(-1);
}

describe('豆上符号墨色（亮度自适应）', () => {
  it('纯黑豆 #000000（H7）必须选白墨——通道 0 不得被 || 255 强转', () => {
    const ctx = createRecordingContext();
    drawBeadOnCanvas(ctx, 0, 0, 20, '#000000', 'square', 'H7');
    expect(symbolInk(ctx)).toBe('rgba(255,255,255,0.92)');
  });

  it('纯白豆 #FFFFFF 选深墨', () => {
    const ctx = createRecordingContext();
    drawBeadOnCanvas(ctx, 0, 0, 20, '#FFFFFF', 'square', 'H2');
    expect(symbolInk(ctx)).toBe('rgba(15,23,42,0.8)');
  });

  it('深青豆 #0B3C43（B22）选白墨', () => {
    const ctx = createRecordingContext();
    drawBeadOnCanvas(ctx, 0, 0, 20, '#0B3C43', 'square', 'B22');
    expect(symbolInk(ctx)).toBe('rgba(255,255,255,0.92)');
  });

  it('导出图例色块文字同样受益：纯黑豆不再配黑字', () => {
    const ctx = createRecordingContext();
    drawBeadOnCanvas(ctx, 0, 0, 20, '#000000', 'square', 'H7');
    const darks = ctx.events.filter(e => e.name === 'fillStyle' && e.args[0] === '#000000');
    // 唯一的 #000000 应是豆底色本身，文字墨色必须不是 #000000
    expect(darks.length).toBeLessThanOrEqual(1);
    expect(symbolInk(ctx)).not.toBe('#000000');
  });
});
