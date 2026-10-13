import { describe, expect, it } from 'vitest';
import { CodeWriteLocks, freezeGeneration, logDates, logDuration, logOutcome } from './adminCodesLogsModel';
import { verifyCardChecksum } from '../../utils/vipCodeUtils';

describe('per-code frontend write scope', () => {
  it('allows different rows to write concurrently', () => { const locks = new CodeWriteLocks(); expect(locks.beginRow('a')).toBe(true); expect(locks.beginRow('b')).toBe(true); expect(locks.snapshot().rows.size).toBe(2); });
  it('rejects duplicate writes to the same row', () => { const locks = new CodeWriteLocks(); locks.beginRow('a'); expect(locks.beginRow('a')).toBe(false); });
  it('finishing b cannot unlock pending a', () => { const locks = new CodeWriteLocks(); locks.beginRow('a'); locks.beginRow('b'); locks.endRow('b'); expect(locks.rowBusy('a')).toBe(true); expect(locks.rowBusy('b')).toBe(false); });
  it('blocks generation while any row writes', () => { const locks = new CodeWriteLocks(); locks.beginRow('a'); expect(locks.beginBatch()).toBe(false); });
  it('generation blocks row writes and duplicate batches', () => { const locks = new CodeWriteLocks(); expect(locks.beginBatch()).toBe(true); expect(locks.beginRow('a')).toBe(false); expect(locks.beginBatch()).toBe(false); });
  it('releases a failed generation batch for explicit retry', () => { const locks = new CodeWriteLocks(); locks.beginBatch(); locks.endBatch(); expect(locks.any()).toBe(false); expect(locks.beginBatch()).toBe(true); });
});
describe('unchanged generation rules and frozen submission', () => {
  it('retains original PV generator and checksum for seven-day VIP', () => { const result = freezeGeneration({ days:7, memberType:1, count:2, channel:'淘宝旗舰店' }); expect(result.codes).toHaveLength(2); expect(result.codes.every(c=>c.code.startsWith('PVTB-')&&verifyCardChecksum(c.code)&&c.days===7&&c.member_type===1)).toBe(true); });
  it('retains BP and checksum for Pro', () => { const result = freezeGeneration({ days:30, memberType:2, count:1, channel:'微信私域社群' }); expect(result.codes[0].code.startsWith('BPWX-')).toBe(true); expect(verifyCardChecksum(result.codes[0].code)).toBe(true); });
  it('rejects seven-day Pro without changing the rule', () => { expect(()=>freezeGeneration({ days:7, memberType:2, count:1, channel:'' })).toThrow('7天'); });
  it('keeps original floor/clamp behavior and 500 upper bound', () => { expect(freezeGeneration({ days:30, memberType:1, count:2.8, channel:'' }).quantity).toBe(2); expect(freezeGeneration({ days:30, memberType:1, count:501, channel:'' }).quantity).toBe(500); });
  it('keeps original non-finite quantity fallback to one', () => { expect(freezeGeneration({ days:30, memberType:1, count:NaN, channel:'' }).quantity).toBe(1); });
  it('freezes type, duration, channel and codes before confirmation', () => { const draft = { days:30, memberType:1 as const, count:2, channel:'活动赠送卡' }; const result = freezeGeneration(draft); const payload = JSON.stringify(result.codes); draft.days=365; draft.channel='other'; expect(result.days).toBe(30); expect(result.channel).toBe('活动赠送卡'); expect(JSON.stringify(result.codes)).toBe(payload); });
  it('does not include copied/sale mutation in generation payload', () => { const result = freezeGeneration({ days:30, memberType:1, count:1, channel:'' }); expect(result.codes[0]).not.toHaveProperty('copied'); });
});
describe('log results are actual collected fields', () => {
  it('does not invent a zero duration for missing samples', () => { expect(logDuration(undefined)).toBe('—'); expect(logDuration({})).toBe('—'); });
  it('renders a real zero and finite duration sample', () => { expect(logDuration({ durationMs:0 })).toBe('0 ms'); expect(logDuration({ durationMs:120 })).toBe('120 ms'); });
  it('supports existing stored JSON metadata', () => { expect(logDuration('{"durationMs":25}')).toBe('25 ms'); });
  it('rejects invalid, negative and string samples', () => { for(const value of [-1,NaN,Infinity,'20']) expect(logDuration({ durationMs:value })).toBe('—'); });
  it('does not claim every recorded action succeeded', () => { expect(logOutcome('admin',{})).toBe('已记录 · 结果未提供'); expect(logOutcome('user',{success:false})).toBe('记录为失败'); });
  it('distinguishes controlled error resolution metadata', () => { expect(logOutcome('error',{},null)).toBe('未处理'); expect(logOutcome('error',{},123)).toBe('已处理'); });
  it('keeps original local day bounds and rejects inverted ranges', () => { const valid=logDates('2026-10-13','2026-10-13'); expect(valid.error).toBe(''); expect(valid.end! - valid.start!).toBe(86_400_000-1); expect(logDates('2026-10-14','2026-10-13').error).toContain('开始日期'); });
});
