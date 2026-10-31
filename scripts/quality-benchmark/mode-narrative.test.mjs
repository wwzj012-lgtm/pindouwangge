import test from 'node:test';
import assert from 'node:assert/strict';
import { transparencyChecks, renderModeNarrative } from './mode-narrative.mjs';
const metrics = { compositeAreaRgbMAE: 7, compositeAreaDeltaE76: 6, localLumaSSIMWhite: 0.95, edgeF1_1Cell: 1, alphaMAE: 0.01 };

test('transparent repair flags use current saved grid/metrics rather than prior A narrative', () => {
  const repaired = { id: 'transparent-boundary-58x58-photo', gridSha256: 'baseline', baselineGridSha256: 'baseline', before: metrics, after: { ...metrics } };
  const old = { ...repaired, gridSha256: 'different', after: { ...metrics, compositeAreaRgbMAE: 7.1, localLumaSSIMWhite: 0.94, edgeF1_1Cell: 0.91 } };
  const [fixed, regressed] = transparencyChecks([repaired, old]);
  assert.equal(fixed.gridMatchesBefore, true); assert.equal(fixed.lumaSSIMNotLower, true);
  assert.equal(regressed.gridMatchesBefore, false); assert.equal(regressed.originalAreaRgbMAENotHigher, false);
  assert.equal(regressed.edgeF1NotLower, false); assert.equal(regressed.alphaMAENotHigher, true);
  assert.equal(transparencyChecks([{ ...repaired, gridSha256: undefined, baselineGridSha256: undefined }])[0].gridMatchesBefore, false);
});

test('new-version prose derives counts and presents cartoon before photo and Logo', () => {
  const distribution = Object.fromEntries(['compositeAreaRgbMAE', 'compositeAreaDeltaE76', 'localLumaSSIMWhite'].map(key => [key, { count: 15, numericallyCloser: 1, numericallyFarther: 2, equalAtNumericalTolerance: 12 }]));
  const analysis = { tag: 'after-test-version', versionSha256: 'new-version-hash', reference: 'original RGBA', countingPolicy: 'raw numeric signs',
    distributions: { cartoon: distribution, photo: distribution, auto: distribution, logo: distribution }, photo: [], transparencyChecks: [], routing: [], modeDifferences: [], timings: [], strictTimingStatement: 'not a hardware single-core test' };
  const text = renderModeNarrative(analysis);
  assert.ok(text.includes('1 closer / 2 farther / 12 equal of 15'));
  assert.ok(text.includes('new-version-hash')); assert.ok(!text.includes('14/15'));
  assert.ok(text.indexOf('## Cartoon first') < text.indexOf('## Photo second'));
  assert.ok(text.indexOf('## Photo second') < text.indexOf('## Auto routing and Logo'));
});
