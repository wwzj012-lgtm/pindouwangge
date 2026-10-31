// Narrative is derived from the selected saved version, never an earlier candidate.
const fmt = (value, digits = 4) => Number(value).toFixed(digits);
export function transparencyChecks(photo) {
  return photo.filter(c => c.id.startsWith('transparent-boundary-')).map(c => ({
    id: c.id, gridMatchesBefore: Boolean(c.gridSha256 && c.gridSha256 === c.baselineGridSha256),
    originalAreaRgbMAENotHigher: c.after.compositeAreaRgbMAE <= c.before.compositeAreaRgbMAE + 1e-9,
    deltaE76NotHigher: c.after.compositeAreaDeltaE76 <= c.before.compositeAreaDeltaE76 + 1e-9,
    lumaSSIMNotLower: c.after.localLumaSSIMWhite >= c.before.localLumaSSIMWhite - 1e-9,
    edgeF1NotLower: c.after.edgeF1_1Cell >= c.before.edgeF1_1Cell - 1e-9,
    alphaMAENotHigher: c.after.alphaMAE <= c.before.alphaMAE + 1e-9,
    before: c.before, after: c.after,
  }));
}

export function renderModeNarrative(a) {
  const rows = ['| Mode | RGB MAE closer/farther/equal | DeltaE76 closer/farther/equal | SSIM closer/farther/equal |', '| --- | --- | --- | --- |'];
  for (const mode of ['cartoon', 'photo', 'auto', 'logo']) {
    rows.push(`| ${mode} | ${['compositeAreaRgbMAE', 'compositeAreaDeltaE76', 'localLumaSSIMWhite'].map(key => {
      const d = a.distributions[mode][key]; return `${d.numericallyCloser}/${d.numericallyFarther}/${d.equalAtNumericalTolerance}`;
    }).join(' | ')} |`);
  }
  const photoTable = ['| Photo case | Original-area MAE before -> after | DeltaE76 before -> after | SSIM before -> after |', '| --- | ---: | ---: | ---: |', ...a.photo.map(c => `| ${c.id} | ${fmt(c.before.compositeAreaRgbMAE)} -> ${fmt(c.after.compositeAreaRgbMAE)} | ${fmt(c.before.compositeAreaDeltaE76)} -> ${fmt(c.after.compositeAreaDeltaE76)} | ${fmt(c.before.localLumaSSIMWhite, 6)} -> ${fmt(c.after.localLumaSSIMWhite, 6)} |`)];
  const transparent = a.transparencyChecks.map(c => `- ${c.id}: MAE ${fmt(c.before.compositeAreaRgbMAE, 6)} -> ${fmt(c.after.compositeAreaRgbMAE, 6)}; DeltaE76 ${fmt(c.before.compositeAreaDeltaE76, 6)} -> ${fmt(c.after.compositeAreaDeltaE76, 6)}; SSIM ${fmt(c.before.localLumaSSIMWhite, 9)} -> ${fmt(c.after.localLumaSSIMWhite, 9)}; edgeF1 ${fmt(c.before.edgeF1_1Cell, 6)} -> ${fmt(c.after.edgeF1_1Cell, 6)}; alphaMAE ${fmt(c.before.alphaMAE, 9)} -> ${fmt(c.after.alphaMAE, 9)}; grid equals before: ${c.gridMatchesBefore}. Numeric non-regression checks: ${JSON.stringify({ rgb: c.originalAreaRgbMAENotHigher, deltaE: c.deltaE76NotHigher, ssim: c.lumaSSIMNotLower, edgeF1: c.edgeF1NotLower, alpha: c.alphaMAENotHigher })}.`).join('\n');
  const routeCounts = Object.fromEntries(['cartoon', 'photo', 'logo'].map(mode => [mode, a.routing.filter(r => r.afterPipeline === mode).length]));
  const changed = a.routing.filter(r => r.changed).length;
  const photoCounts = ['compositeAreaRgbMAE', 'compositeAreaDeltaE76', 'localLumaSSIMWhite'].map(key => {
    const d = a.distributions.photo[key]; return `${key}: ${d.numericallyCloser} closer / ${d.numericallyFarther} farther / ${d.equalAtNumericalTolerance} equal of ${d.count}`;
  }).join('; ');
  return `# ${a.tag}: saved matrix review, no all-mode quality pass

Version ${a.versionSha256}. Exactly60 saved cases; no new conversion or input is executed by this analysis.

${a.reference}

${a.countingPolicy}

## Cartoon first: structure, flat fills and facial features

User priority is cartoon first, photo second, Logo a regression guardrail. Compare the primary cat100x114 and the existing58/100 cartoon sources for connected contours, clean fills and eyes/mouth, using the original/source/before/after PNGs. Earlier candidates showed only small cartoon benefit; if this version remains near baseline, report that plainly. A grid cell cannot preserve arbitrary subcell geometry or every faint hole/line; this physical resolution limit is a disclosure, not an excuse to dismiss new regressions. Aggregate SSIM/color signs alone do not establish useful facial/topological recovery.

${rows.join('\n')}

## Photo second: original-reference distribution and transparent58 check

${photoCounts}. These are correlated material/size cases in a mixed existing fixture set, not independent verified camera photographs. Tiny-component counts include legitimate detail; fewer is not automatically better.

${transparent}

The known A transparent58 regression must be checked against this version's saved output, not an author's earlier report. Exact equality with the before grid is strong evidence of restoring that sampled output. Other numeric non-regression flags are diagnostic only; inspect the PNG for center-stroke contrast and alpha boundaries. A darker stroke can alter edge thresholds without changing the alpha mask. Do not automatically declare the transparent case fixed or regressed from a single score, and do not reuse an A-specific narrative for a new version.

${photoTable.join('\n')}

## Auto routing and Logo guardrail

Auto routing counts: ${JSON.stringify(routeCounts)}; changed from before: ${changed}/${a.routing.length}. Every auto grid equals its selected explicit-mode grid. Auto dispatches among three algorithms, rather than providing a fourth distinct algorithm. Of ${a.modeDifferences.length} input/size groups, ${a.modeDifferences.filter(g => g.distinctExplicitGrids === 3).length} have three different explicit cartoon/photo/logo grids. Requested explicit-mode diagnostics were verified. Per-pair differing-cell ratios and routes are in mode-analysis.json. Classification/output difference is not quality or photo provenance.

Logo review stays bounded to known line/ring and white glyph-counter regressions; no new Logo optimization or material expansion is requested. The wordmark should not become bolder or lose white counters in exchange for higher global SSIM. Do not label four modes as visibly improved across all images.

## Timing boundary

${a.strictTimingStatement}

Observed square-grid maxima: ${a.timings.map(t => `${t.size}x${t.size}: ${fmt(t.maxObservedMs / 1000, 3)}s (${t.maxCase}); all observed within budget: ${t.allObservedWithinBudget}`).join('; ')}. Cat100x114 has no invented square-grid SLA.

This analysis only renders existing evidence. No old D/F conversion repeats, new snapshots, full matrices or deployments are scheduled by it. Next conversion scope requires the coordinator's explicit ready/scope instruction.
`;
}
