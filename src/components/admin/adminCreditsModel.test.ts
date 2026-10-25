import { afterEach, describe, expect, it, vi } from 'vitest';
import { creditLedgerQuery, formatCreditUnits, matchesCreditAdjustment, parseCreditPoints, readCreditRecovery, saveCreditRecovery,
  type CreditAdjustmentBody } from './adminCreditsModel';

afterEach(()=>vi.unstubAllGlobals());
describe('integer credit amounts',()=>{
  it('converts decimal strings exactly with ten units per point',()=>{
    for (const [text,units] of [['0.1',1],['1',10],['12.3',123],['900719925474099.1',Number.MAX_SAFE_INTEGER]] as const) {
      expect(parseCreditPoints(text)).toBe(units); expect(formatCreditUnits(units)).toBe(text);
    }
    expect(formatCreditUnits(-1)).toBe('-0.1'); expect(formatCreditUnits(0)).toBe('0');
    expect(parseCreditPoints('1.0')).toBe(10);
  });
  it.each(['','0','0.0','0.01','1.11','1e3','+1','-1','01','NaN','Infinity','900719925474099.2'])('rejects invalid/unsafe amount %s',text=>{
    expect(parseCreditPoints(text)).toBeNull();
  });
});
describe('unknown adjustment recovery',()=>{
  const body: CreditAdjustmentBody = { uid:'target',deltaUnits:-1,reason:'原因',expectedAvailableUnits:10,
    expectedHeldUnits:5,expectedVersion:2,idempotencyKey:'credit-key-123456789' };
  const storage = () => {
    const map=new Map<string,string>();
    vi.stubGlobal('sessionStorage',{getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>map.set(k,v),removeItem:(k:string)=>map.delete(k)});
    return map;
  };
  it('persists original immutable payload per operator and never exposes it to another operator',()=>{
    storage(); saveCreditRecovery('one',body);
    expect(readCreditRecovery('one').body).toEqual(body); expect(readCreditRecovery('two').body).toBeNull();
    saveCreditRecovery('one',null); expect(readCreditRecovery('one').body).toBeNull();
  });
  it('fails closed on corrupt or inaccessible storage',()=>{
    const map=storage(); map.set('admin-credit-recovery:v1:one','malformed'); expect(readCreditRecovery('one').error).toBeTruthy();
    vi.stubGlobal('sessionStorage',{getItem:()=>{throw Error('blocked');}});
    expect(readCreditRecovery('one').error).toBeTruthy(); expect(()=>saveCreditRecovery('one',body)).toThrow();
  });
  it('accepts only exact original operator, key, amount and confirmation in the response',()=>{
    const adjustment = { id:'audit',operatorUid:'one',...body,beforeAvailableUnits:10,afterAvailableUnits:9,heldUnits:5,
      beforeVersion:2,afterVersion:3,createdAt:1,unitsPerPoint:10 as const };
    expect(matchesCreditAdjustment(adjustment,body,'one')).toBe(true);
    for(const change of [{operatorUid:'two'},{uid:'other'},{deltaUnits:-2},{afterAvailableUnits:8},{heldUnits:0},{beforeVersion:3},{idempotencyKey:'other'},{reason:'other'}]) {
      expect(matchesCreditAdjustment({...adjustment,...change},body,'one')).toBe(false);
    }
  });
});
it('builds bounded query filters with exact epoch-millisecond boundaries and selected user',()=>{
  const q=new URLSearchParams(creditLedgerQuery(' 张三 ','consumption','2026-10-20T12:30','2026-10-21T12:30','user/a',2));
  expect(q.get('q')).toBe('张三'); expect(q.get('uid')).toBe('user/a'); expect(q.get('offset')).toBe('40');
  expect(q.get('from')).toBe(String(new Date('2026-10-20T12:30').getTime())); expect(q.get('limit')).toBe('20');
});
