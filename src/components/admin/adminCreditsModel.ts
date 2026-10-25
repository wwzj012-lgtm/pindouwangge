import type { AdminRequest } from './adminRequest';

export interface AdminCreditsProps { request: AdminRequest; canRead: boolean; canAdjust: boolean; operatorUid: string; }
export interface CreditAccount {
  uid: string; email: string | null; displayName: string | null;
  availableUnits: number; heldUnits: number; version: number; unitsPerPoint: 10;
}
export interface CreditAdjustmentBody {
  uid: string; deltaUnits: number; reason: string; expectedVersion: number;
  expectedAvailableUnits: number; expectedHeldUnits: number; idempotencyKey: string;
}
export interface CreditAdjustment {
  id: string; operatorUid: string; idempotencyKey: string; uid: string; deltaUnits: number; reason: string;
  beforeAvailableUnits: number; afterAvailableUnits: number; heldUnits: number;
  beforeVersion: number; afterVersion: number; createdAt: number; unitsPerPoint: 10;
}
export interface CreditLedgerOperation {
  operationId: string; entryKind: string; type: string; uid: string; email: string | null; displayName: string | null;
  purpose: string; referenceType: string; referenceId: string; deltaAvailableUnits: number; deltaHeldUnits: number;
  consumedUnits: number; createdAt: number; bucketCount: number;
}
export interface CreditPage<T> { items: T[]; total: number; limit: number; offset: number; }
export const CREDIT_PAGE_SIZE = 20;
export const CREDIT_TYPES = {
  consumption: '最近消费', all: '全部变动', adjustment: '管理员调整', grant: '积分发放',
  refund: '积分退还', hold: '冻结', release: '解冻', expire: '过期',
} as const;
export type CreditType = keyof typeof CREDIT_TYPES;

/** Decimal strings -> integer units. No floating point multiplication or silent rounding. */
export function parseCreditPoints(text: string): number | null {
  const match = /^(0|[1-9]\d*)(?:\.(\d))?$/.exec(text.trim());
  if (!match) return null;
  const units = BigInt(match[1]) * 10n + BigInt(match[2] ?? '0');
  return units > 0n && units <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(units) : null;
}
export function formatCreditUnits(units: number): string {
  if (!Number.isSafeInteger(units)) return '金额异常';
  const n = BigInt(units), abs = n < 0n ? -n : n;
  return `${n < 0n ? '-' : ''}${abs / 10n}${abs % 10n ? '.' + String(abs % 10n) : ''}`;
}
export function validCreditAccount(account: CreditAccount | undefined): account is CreditAccount {
  return !!account && typeof account.uid === 'string' && account.unitsPerPoint === 10
    && [account.availableUnits, account.heldUnits, account.version].every(n => Number.isSafeInteger(n) && n >= 0);
}
export function matchesCreditAdjustment(value: CreditAdjustment | undefined, body: CreditAdjustmentBody, operatorUid: string): value is CreditAdjustment {
  return !!value && typeof value.id === 'string' && value.id.length > 0 && value.unitsPerPoint === 10
    && value.operatorUid === operatorUid && value.uid === body.uid && value.idempotencyKey === body.idempotencyKey
    && value.deltaUnits === body.deltaUnits && value.reason === body.reason && value.beforeVersion === body.expectedVersion
    && value.afterVersion === body.expectedVersion + 1 && value.beforeAvailableUnits === body.expectedAvailableUnits
    && value.heldUnits === body.expectedHeldUnits && value.afterAvailableUnits === body.expectedAvailableUnits + body.deltaUnits;
}

const recoveryKey = (operatorUid: string) => 'admin-credit-recovery:v1:' + operatorUid;
export function readCreditRecovery(operatorUid: string): { body: CreditAdjustmentBody | null; error: string } {
  try {
    const raw = sessionStorage.getItem(recoveryKey(operatorUid));
    if (!raw) return { body: null, error: '' };
    const value = JSON.parse(raw) as { operatorUid?: string; body?: CreditAdjustmentBody };
    const b = value.body;
    if (value.operatorUid !== operatorUid || !b || typeof b.uid !== 'string' || !b.uid || typeof b.reason !== 'string'
      || !b.reason.trim() || b.reason.length > 500 || !/^[A-Za-z0-9:_-]{16,128}$/.test(b.idempotencyKey)
      || !Number.isSafeInteger(b.deltaUnits) || b.deltaUnits === 0
      || ![b.expectedVersion,b.expectedAvailableUnits,b.expectedHeldUnits].every(n => Number.isSafeInteger(n) && n >= 0)
      || !Number.isSafeInteger(b.expectedAvailableUnits+b.deltaUnits) || b.expectedAvailableUnits+b.deltaUnits < 0) {
      return { body: null, error: '待核查调整记录损坏，已停用调账，请先核查账本。' };
    }
    return { body: b, error: '' };
  } catch { return { body: null, error: '无法读取待核查记录，已停用调账，请检查浏览器存储。' }; }
}
export function saveCreditRecovery(operatorUid: string, body: CreditAdjustmentBody | null) {
  if (body) sessionStorage.setItem(recoveryKey(operatorUid), JSON.stringify({ operatorUid, body }));
  else sessionStorage.removeItem(recoveryKey(operatorUid));
}

export function creditLedgerQuery(q: string, type: CreditType, from: string, to: string, uid: string, page: number) {
  const params = new URLSearchParams({ type, limit: String(CREDIT_PAGE_SIZE), offset: String(page*CREDIT_PAGE_SIZE) });
  if (q.trim()) params.set('q',q.trim());
  if (uid) params.set('uid',uid);
  if (from) params.set('from', String(new Date(from).getTime()));
  if (to) params.set('to', String(new Date(to).getTime()));
  return params.toString();
}
