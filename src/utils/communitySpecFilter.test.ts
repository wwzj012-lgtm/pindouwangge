import { describe, expect, it } from 'vitest';
import { SPEC_FILTER_OPTIONS, matchesSpecFilter, type SpecFilter } from './communitySpecFilter';

const LE_FILTERS: SpecFilter[] = ['le500', 'le1000', 'le2000', 'le3000', 'le5000', 'le8000'];

describe('communitySpecFilter — 累计上限语义（用户反馈 Bug 的回归）', () => {
  it('keeps the chip order and copy stable', () => {
    expect(SPEC_FILTER_OPTIONS.map(({ value }) => value)).toEqual([
      'all', 'le500', 'le1000', 'le2000', 'le3000', 'le5000', 'le8000', 'gt8000',
    ]);
    expect(SPEC_FILTER_OPTIONS.map(({ label }) => label)).toEqual([
      '全部', '≤500', '≤1k', '≤2k', '≤3k', '≤5k', '≤8k', '>8k',
    ]);
  });

  it('removes the reported bug: ≤8k contains every smaller bucket (500/1000/2000/3000/5000/8000)', () => {
    // 旧实现的区间桶在这里只会命中 8000（5000 < n ≤ 8000），其余 5 个全部 false。
    for (const beads of [500, 1000, 2000, 3000, 5000, 8000]) {
      expect(matchesSpecFilter(beads, 'le8000')).toBe(true);
    }
    // 更直观的断言：≤2k 的每一份作品都必须出现在 ≤8k 里。
    for (const beads of [1, 250, 500, 999, 1000, 1500, 2000]) {
      if (matchesSpecFilter(beads, 'le2000')) expect(matchesSpecFilter(beads, 'le8000')).toBe(true);
    }
  });

  it('treats each ≤ bucket as an inclusive upper bound', () => {
    expect(matchesSpecFilter(2000, 'le2000')).toBe(true);
    expect(matchesSpecFilter(2001, 'le2000')).toBe(false);
    expect(matchesSpecFilter(500, 'le500')).toBe(true);
    expect(matchesSpecFilter(501, 'le500')).toBe(false);
    expect(matchesSpecFilter(1000, 'le1000')).toBe(true);
    expect(matchesSpecFilter(1001, 'le1000')).toBe(false);
    expect(matchesSpecFilter(3000, 'le3000')).toBe(true);
    expect(matchesSpecFilter(3001, 'le3000')).toBe(false);
    expect(matchesSpecFilter(5000, 'le5000')).toBe(true);
    expect(matchesSpecFilter(5001, 'le5000')).toBe(false);
    expect(matchesSpecFilter(8000, 'le8000')).toBe(true);
    expect(matchesSpecFilter(8001, 'le8000')).toBe(false);
    expect(matchesSpecFilter(0, 'le500')).toBe(true);
  });

  it('keeps >8k as the strict complement of ≤8k', () => {
    expect(matchesSpecFilter(8000, 'gt8000')).toBe(false);
    expect(matchesSpecFilter(8001, 'gt8000')).toBe(true);
    expect(matchesSpecFilter(0, 'gt8000')).toBe(false);
  });

  it('keeps posts without specs out of every non-all bucket', () => {
    for (const filter of [...LE_FILTERS, 'gt8000'] as SpecFilter[]) {
      expect(matchesSpecFilter(undefined, filter)).toBe(false);
      expect(matchesSpecFilter(null, filter)).toBe(false);
      expect(matchesSpecFilter(Number.NaN, filter)).toBe(false);
    }
    expect(matchesSpecFilter(undefined, 'all')).toBe(true);
    expect(matchesSpecFilter(null, 'all')).toBe(true);
  });

  it('is monotonic: a match in a smaller bucket matches every larger bucket', () => {
    const samples = [0, 400, 500, 900, 1000, 1500, 2000, 2500, 4000, 6000, 8500];
    const ladder: SpecFilter[] = ['le1000', 'le2000', 'le3000', 'le5000', 'le8000'];
    for (const beads of samples) {
      const firstHit = ladder.findIndex(filter => matchesSpecFilter(beads, filter));
      if (firstHit < 0) continue;
      for (const filter of ladder.slice(firstHit)) {
        expect(matchesSpecFilter(beads, filter), `beads=${beads} filter=${filter}`).toBe(true);
      }
    }
    // 反向：命中大桶不代表命中所有小桶（区间确实有大小之分）。
    expect(matchesSpecFilter(6000, 'le8000')).toBe(true);
    expect(matchesSpecFilter(6000, 'le5000')).toBe(false);
  });

  it('partitions specs-bearing works into ≤8k ∪ >8k with no overlap', () => {
    const samples = [1, 500, 1000, 2000, 3000, 5000, 8000, 8001, 12_000];
    for (const beads of samples) {
      const le = matchesSpecFilter(beads, 'le8000');
      const gt = matchesSpecFilter(beads, 'gt8000');
      expect(le !== gt, `beads=${beads} must land in exactly one of ≤8k / >8k`).toBe(true);
    }
  });
});
