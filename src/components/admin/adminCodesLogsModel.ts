import { generateCommercialVipCode } from '../../utils/vipCodeUtils';

/** Frontend-only scope: one generation batch, or independent per-code writes. */
export class CodeWriteLocks {
  private rows = new Set<string>();
  private batch = false;
  rowBusy(id: string): boolean { return this.batch || this.rows.has(id); }
  any(): boolean { return this.batch || this.rows.size > 0; }
  beginRow(id: string): boolean { if (this.rowBusy(id)) return false; this.rows.add(id); return true; }
  endRow(id: string): void { this.rows.delete(id); }
  beginBatch(): boolean { if (this.any()) return false; this.batch = true; return true; }
  endBatch(): void { this.batch = false; }
  snapshot() { return { batch: this.batch, rows: new Set(this.rows) }; }
}

export function codeSaleRowClassName(copied: boolean | undefined): string {
  return copied ? 'admin-code-row--sale-marked' : '';
}

export function codeSaleLabel(copied: boolean | undefined): string {
  return copied ? '已标记发售' : '未标记发售';
}

export function codeWriteFeedback(label: string, rereadSucceeded: boolean): { success?: string; warning?: string } {
  return rereadSucceeded
    ? { success: label + '已确认。' }
    : { warning: label + '已提交，但列表刷新失败；当前仍显示旧状态，请刷新确认。' };
}

export interface GenerationDraft { days: number; memberType: 1 | 2; count: number; channel: string; }
/**
 * 发行渠道建议值（datalist）：从已加载的兑换码与兑换记录里去重收集既有渠道，
 * 让"发行渠道"这个可选输入框能给出真实的可选值（用户反馈："可选呢？？"）。
 * 保持首次出现顺序；非字符串/纯空白渠道忽略；渠道是自由字符串，不校验白名单。
 */
export function collectKnownChannels(...sources: Array<ReadonlyArray<{ channel?: string | null }>>): string[] {
  const seen = new Set<string>();
  for (const source of sources) {
    for (const item of source) {
      const channel = typeof item?.channel === 'string' ? item.channel.trim() : '';
      if (channel) seen.add(channel);
    }
  }
  return Array.from(seen);
}
export function freezeGeneration(draft: GenerationDraft) {
  if (draft.days === 7 && draft.memberType !== 1) throw new Error('7天体验卡仅支持普通VIP。');
  const quantity = Number.isFinite(draft.count) ? Math.min(500, Math.max(1, Math.floor(draft.count))) : 1;
  const days = draft.days, memberType = draft.memberType, channel = draft.channel;
  const codes = Array.from({ length: quantity }, () => ({
    code: generateCommercialVipCode(channel || '后台', memberType === 2 ? 'BP' : 'PV'),
    days, member_type: memberType, channel: channel || null,
  }));
  return { quantity, days, memberType, channel, codes };
}
export function metadataObject(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') { try { return metadataObject(JSON.parse(value)); } catch { return {}; } }
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function logDuration(metadata: unknown): string {
  const value = metadataObject(metadata).durationMs;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value + ' ms' : '—';
}
export function logOutcome(type: string, metadata: unknown, resolvedAt?: number | null): string {
  if (type === 'error') return resolvedAt ? '已处理' : '未处理';
  const success = metadataObject(metadata).success;
  return success === true ? '记录为成功' : success === false ? '记录为失败' : '已记录 · 结果未提供';
}
export function logDates(from: string, to: string) {
  const start = from ? new Date(from + 'T00:00:00').getTime() : null;
  const end = to ? new Date(to + 'T23:59:59.999').getTime() : null;
  return { start, end, error: start !== null && !Number.isFinite(start) || end !== null && !Number.isFinite(end) ? '日期无效。' : start !== null && end !== null && start > end ? '开始日期不能晚于结束日期。' : '' };
}
