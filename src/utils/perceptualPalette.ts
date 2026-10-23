type Lab = [number, number, number];
export interface WeightedPaletteSample { lab: Lab; weight: number }

/**
 * Select actual available bead colours by reconstruction error, not popularity.
 * The distance matrix is bounded by palette size and reused for every search.
 * A frequency baseline is kept as a floor unless it drops a protected contour.
 */
export function selectPerceptualPalette<T extends { color: { id: string }; lab: Lab }>(
  candidates: readonly T[], samples: readonly WeightedPaletteSample[], limit: number,
  distance: (source: Lab, candidate: T) => number, baselineIds: readonly string[],
  protectedIds: readonly string[] = [],
): T[] {
  if (!candidates.length || !samples.length) return [];
  const count = Math.min(candidates.length, Math.max(1, Math.floor(limit)));
  const costs = samples.map(sample => Float64Array.from(candidates, candidate => {
    const error = distance(sample.lab, candidate);
    return error * error;
  }));
  const weights = samples.map(sample => sample.weight);
  const objective = (selected: readonly number[]) => {
    let total = 0;
    for (let sample = 0; sample < samples.length; sample++) {
      let nearest = Infinity;
      for (const index of selected) nearest = Math.min(nearest, costs[sample][index]);
      total += nearest * weights[sample];
    }
    return total;
  };
  const baseline = baselineIds.map(id => candidates.findIndex(entry => entry.color.id === id)).filter(index => index >= 0).slice(0, count);
  const preferred = new Map(baselineIds.map((id, index) => [id, index]));
  const order = candidates.map((_, index) => index).sort((a, b) =>
    (preferred.get(candidates[a].color.id) ?? Infinity) - (preferred.get(candidates[b].color.id) ?? Infinity) || a - b);
  const required = new Set(protectedIds.map(id => candidates.findIndex(entry => entry.color.id === id)).filter(index => index >= 0).slice(0,count));
  const selected: number[] = [...required];
  const nearest = new Float64Array(samples.length).fill(Infinity);
  for (let sample = 0; sample < samples.length; sample++) {
    for (const index of selected) nearest[sample] = Math.min(nearest[sample], costs[sample][index]);
  }
  while (selected.length < count) {
    let best = -1, bestCost = Infinity;
    for (const candidate of order) {
      if (selected.includes(candidate)) continue;
      let total = 0;
      for (let sample = 0; sample < samples.length; sample++) total += Math.min(nearest[sample], costs[sample][candidate]) * weights[sample];
      if (total < bestCost - 1e-8) { best = candidate; bestCost = total; }
    }
    if (best < 0) break;
    selected.push(best);
    for (let sample = 0; sample < samples.length; sample++) nearest[sample] = Math.min(nearest[sample], costs[sample][best]);
  }
  let result = baseline.length === count && [...required].every(index=>baseline.includes(index)) && objective(baseline) <= objective(selected) + 1e-8 ? [...baseline] : selected;
  // Two deterministic exchange passes refine the greedy result. Large budgets
  // already approach the full palette; avoid an unbounded combinatorial search.
  if (count <= 32) for (let pass = 0; pass < 2; pass++) {
    const first = new Float64Array(samples.length).fill(Infinity);
    const second = new Float64Array(samples.length).fill(Infinity);
    const owner = new Int32Array(samples.length);
    for (let sample = 0; sample < samples.length; sample++) for (let slot = 0; slot < result.length; slot++) {
      const cost = costs[sample][result[slot]];
      if (cost < first[sample]) { second[sample] = first[sample]; first[sample] = cost; owner[sample] = slot; }
      else if (cost < second[sample]) second[sample] = cost;
    }
    let bestCost = objective(result), bestSlot = -1, bestCandidate = -1;
    for (const candidate of order) {
      if (result.includes(candidate)) continue;
      for (let slot = 0; slot < result.length; slot++) {
        if (required.has(result[slot])) continue;
        let total = 0;
        for (let sample = 0; sample < samples.length; sample++) {
          total += Math.min(owner[sample] === slot ? second[sample] : first[sample], costs[sample][candidate]) * weights[sample];
        }
        if (total < bestCost - 1e-8) { bestCost = total; bestSlot = slot; bestCandidate = candidate; }
      }
    }
    if (bestSlot < 0) break;
    result = [...result]; result[bestSlot] = bestCandidate;
  }
  const ids = new Set(result);
  return candidates.filter((_, index) => ids.has(index));
}
