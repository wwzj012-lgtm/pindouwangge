// Summarize existing fixed matrix only. No source imports, conversion or new fixtures.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile } from 'node:fs/promises';
import { json } from './fixtures.mjs';
import { renderModeNarrative, transparencyChecks } from './mode-narrative.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const base = path.join(root, 'artifacts/quality-benchmark');
const tag = process.argv[2] ?? 'after-a';
assert.ok(/^after(?:-[a-z0-9]+)*$/.test(tag));
const out = path.join(base, tag), readJson = async file => JSON.parse(await readFile(file, 'utf8'));
const report = await readJson(path.join(out, 'compact-report.json'));
const baseline = await readJson(path.join(base, 'before/matrix-report.json'));
const version = await readJson(path.join(out, 'probe-version.json'));
assert.equal(report.cases.length, 60);
const metrics = { compositeAreaRgbMAE: 'lower', compositeAreaDeltaE76: 'lower', localLumaSSIMWhite: 'higher', edgeF1_1Cell: 'higher', tinyCellRatio: 'lower' };
const mean = values => values.reduce((a, b) => a + b, 0) / values.length;
const distributions = {};
for (const mode of ['photo', 'auto', 'cartoon', 'logo']) {
  const cases = report.cases.filter(c => c.settings.pipelineOverride === mode);
  if (mode !== 'auto') assert.ok(cases.every(c => c.diagnostics.pipeline === mode), 'Explicit mode unexpectedly rerouted');
  distributions[mode] = Object.fromEntries(Object.entries(metrics).map(([metric, direction]) => {
    const values = cases.map(c => ({ id: c.id, delta: c.metrics[metric] - c.before.metrics[metric] }));
    const sign = direction === 'lower' ? -1 : 1;
    return [metric, { direction, count: values.length, numericallyCloser: values.filter(v => v.delta * sign > 1e-9).length,
      numericallyFarther: values.filter(v => v.delta * sign < -1e-9).length, equalAtNumericalTolerance: values.filter(v => Math.abs(v.delta) <= 1e-9).length,
      meanRawDelta: mean(values.map(v => v.delta)), meanBefore: mean(cases.map(c => c.before.metrics[metric])), meanAfter: mean(cases.map(c => c.metrics[metric])),
      fartherCases: values.filter(v => v.delta * sign < -1e-9) }];
  }));
}
const groups = new Map();
for (const c of report.cases) {
  const key = `${c.fixture}-${c.settings.width}x${c.settings.height}`;
  if (!groups.has(key)) groups.set(key, {});
  groups.get(key)[c.settings.pipelineOverride] = c;
}
const routing = [], modeDifferences = [];
for (const [key, group] of groups) {
  const auto = group.auto, old = baseline.cases.find(c => c.id === auto.id), selected = group[auto.diagnostics.pipeline];
  assert.ok(selected); assert.equal(auto.gridSha256, selected.gridSha256, 'auto output differs from its selected explicit mode');
  routing.push({ id: key, beforePipeline: old.diagnostics.pipeline, afterPipeline: auto.diagnostics.pipeline, detected: auto.diagnostics.detectedPipeline,
    changed: old.diagnostics.pipeline !== auto.diagnostics.pipeline, matchesSelectedExplicitGrid: true });
  const grids = {};
  for (const mode of ['cartoon', 'photo', 'logo']) grids[mode] = (await readJson(path.join(out, group[mode].id + '.json'))).grid.flat();
  const pairs = {};
  for (const [first, second] of [['cartoon', 'photo'], ['cartoon', 'logo'], ['photo', 'logo']]) {
    assert.equal(grids[first].length, grids[second].length);
    const differingCells = grids[first].reduce((sum, id, i) => sum + (id !== grids[second][i] ? 1 : 0), 0);
    pairs[first + '/' + second] = { differingCells, cells: grids[first].length, differingRatio: differingCells / grids[first].length };
  }
  modeDifferences.push({ id: key, distinctExplicitGrids: new Set(['cartoon', 'photo', 'logo'].map(m => group[m].gridSha256)).size, pairs });
}
const timings = [58, 100].map(size => {
  const rows = report.cases.filter(c => c.settings.width === size && c.settings.height === size);
  const worst = [...rows].sort((a, b) => b.maxMs - a.maxMs)[0];
  return { size, count: rows.length, maxObservedMs: worst.maxMs, maxCase: worst.id, allObservedWithinBudget: rows.every(c => c.allObservedWithinBudget) };
});
const photo = report.cases.filter(c => c.settings.pipelineOverride === 'photo').map(c => ({ id: c.id,
  sourcePixelSha256: c.sourcePixelSha256, mode: c.diagnostics.pipeline, gridSha256: c.gridSha256, baselineGridSha256: c.before.gridSha256,
  before: c.before.metrics, after: c.metrics, delta: c.metricDelta }));
const analysis = { tag, versionSha256: version.versionSha256, reference: 'Independent original browser Canvas1200 RGBA exact fractional area, black+white composites. Not pipeline samples.',
  countingPolicy: 'Raw numeric signs with epsilon 1e-9 only to suppress floating arithmetic noise, not a quality acceptance threshold. Cases are correlated: same fixtures at multiple sizes; equal weight per case, no significance or universal improvement claim.',
  distributions, photo, routing, modeDifferences, timings, transparencyChecks: transparencyChecks(photo),
  conclusions: ['Cartoon is first priority: review actual contours, flat fills, facial features and the finite-grid limit; do not inflate small gains into broad improvement.',
    'Photo distributions and transparent58/100 flags are derived from this exact saved version; no verified natural-camera-photo coverage.',
    'Auto is a dispatcher into three pipelines; selected explicit grid equality is checked, and routing changes are recorded rather than assumed absent.',
    'Logo is a bounded regression guardrail. No all-mode quality pass or release recommendation follows automatically from metrics.',
    'Tiny-component counts include legitimate details and dithering; counts alone do not define quality. Original low-contrast line topology requires PNG review.',
    'Await coordinator-ready and scope instruction; no old D/F repeat conversions, mutable captures or automatic full matrices.'],
  strictTimingStatement: 'One synchronous conversion at a time in the browser page, no conversion-worker pool. This describes the JS call path, NOT hardware single-core execution: no CPU affinity pinning, core isolation, calibrated CPU quota, or CPU-time measurement. Canvas/browser internals may use other threads. Host has Ryzen 5 9600X, 6 physical cores/12 logical CPUs; other agents/processes can run concurrently. Wall time includes Canvas1200 readback and the full converter, excludes decode/import/API/UI/reporting/artificial waits. No claim about single-core throughput, phone-wide SLA, memory/thermal/energy behavior or UI responsiveness. First call is fresh-context after import/decode, not OS/browser cold startup.' };
await writeFile(path.join(out, 'mode-analysis.json'), json(analysis));
const routeCounts = Object.fromEntries(['cartoon', 'photo', 'logo'].map(m => [m, routing.filter(r => r.afterPipeline === m).length]));
const text = renderModeNarrative(analysis);
await writeFile(path.join(out, 'MODE-ANALYSIS.md'), text);
console.log(json({ tag, version: version.versionSha256,
  photo: Object.fromEntries(Object.entries(distributions.photo).map(([metric, d]) => [metric, { closer: d.numericallyCloser, farther: d.numericallyFarther, equal: d.equalAtNumericalTolerance }])),
  routeCounts, groups: groups.size, distinctExplicit: modeDifferences.filter(d => d.distinctExplicitGrids === 3).length, timings }));
