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
export interface GenerationDraft { days: number; memberType: 1 | 2; count: number; channel: string; }
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
