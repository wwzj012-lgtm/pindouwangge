import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createServer } from 'vite';
import { productionClosure } from './snapshot.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const artifactRoot = path.join(root, 'artifacts/quality-benchmark/stage-attribution-20261027');
const contract = JSON.parse(await readFile(path.join(root, 'artifacts/quality-benchmark/contract.json'), 'utf8'));
const fixtureRoot = path.join(root, 'artifacts/quality-benchmark/fixtures');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const has = file => access(file).then(() => true, () => false);
const writeJson = (name, value) => writeFile(path.join(artifactRoot, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
await mkdir(artifactRoot, { recursive: true });
const chosen = ['user-cat-58x58-cartoon', 'user-cat-100x100-cartoon', 'user-cat-100x114-cartoon', 'user-logo-58x58-logo', 'user-logo-100x100-logo'].map(id => contract.cases.find(c => c.id === id));
assert.ok(chosen.every(Boolean));
const catRois = [{ name: 'eyes', originalRect: [535, 300, 340, 115] }, { name: 'collar', originalRect: [500, 425, 410, 225] }, { name: 'lapel', originalRect: [450, 550, 560, 500] }];
const logoRois = [{ name: 'thin-lines', originalRect: [570, 440, 910, 890] }, { name: 'glyph-counters', originalRect: [530, 1410, 1000, 310] }];
const closure = await productionClosure(root);
const closureHashes = Object.fromEntries([...closure].map(([file, bytes]) => [file, sha(bytes)]));
const plainRoot = path.join(artifactRoot, 'plain-modules'), instrumentedRoot = path.join(artifactRoot, 'instrumented-modules');
const copyClosure = async destination => { for (const [file, bytes] of closure) { const target = path.join(destination, file); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, bytes); } };
await copyClosure(plainRoot); await copyClosure(instrumentedRoot);
const hook = '(globalThis as any).__QB_STAGE__';
const patch = async (file, pairs) => { const target = path.join(instrumentedRoot, file); let text = (await readFile(target, 'utf8')).replaceAll('\r\n', '\n'); for (const [from, to] of pairs) { assert.equal(text.split(from).length - 1, 1, 'anchor count ' + from.slice(0, 50)); text = text.replace(from, to); } await writeFile(target, text); };
await patch('src/utils/pipelineAuxiliaries.ts', [
  ['  // A quantized source receives its formal heatmap after its single global', '  ' + hook + '?.preprocess({ processData, quantizedData, denoised, width: sampleWidth, height: sampleHeight });\n  // A quantized source receives its formal heatmap after its single global']
]);
await patch('src/utils/imagePipeline.ts', [
  ['  const preprocessed = preprocessSourceImage(', '  ' + hook + '?.source(data, sourceWidth, sourceHeight);\n  const preprocessed = preprocessSourceImage('],
  ['      const rgb: Rgb = pipeline', '      ' + hook + '?.cell(gridY * settings.width + gridX, { total, valid, weightedValid, original, dominant, normalRgb: [...normalRgb], shapeRgb: [...shapeRgb], centerRgb, sourceWhiteCoverage, protectedCounter: protectedCounters.has(gridY * settings.width + gridX), candidate, acceptedCandidate: cellCandidates[cellCandidates.length - 1] });\n      const rgb: Rgb = pipeline'],
  ['    resolveCellForeground(cellCandidates, targetPixels, settings.width, settings.height);', '    ' + hook + '?.pixels("sampled", targetPixels);\n    resolveCellForeground(cellCandidates, targetPixels, settings.width, settings.height);\n    ' + hook + '?.pixels("foreground", targetPixels);'],
  ['  // Grid lightness sharpening adds colour bands', '  ' + hook + '?.pixels("projectedInk", targetPixels);\n  // Grid lightness sharpening adds colour bands'],
  ["  const matchAlgorithm: 'cie76' | 'ciede2000' = pipeline", '  ' + hook + '?.pixels("prematch", targetPixels);\n  const matchAlgorithm: \'cie76\' | \'ciede2000\' = pipeline'],
  ['  // Logo conversions never auto-merge islands;', '  ' + hook + '?.grid("palette", grid);\n  // Logo conversions never auto-merge islands;'],
  ['  if (settings.outlineBoost) {\n    applyOutlineProtection(', '  ' + hook + '?.grid("consolidated", grid);\n  if (settings.outlineBoost) {\n    applyOutlineProtection('],
  ['  const summary = summarizeMatches(matches, mappingPalette);', '  ' + hook + '?.grid("final", grid);\n  const summary = summarizeMatches(matches, mappingPalette);']
]);
const vite = async modules => {
  const server = await createServer({ configFile: false, root: modules, optimizeDeps: { noDiscovery: true }, server: { host: '127.0.0.1', port: 0, hmr: false, watch: null, fs: { allow: [root] } }, appType: 'custom' });
  server.middlewares.use(async (req, res, next) => {
    try {
      if (req.url === '/__stage') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><meta charset="utf-8">'); return; }
      if (req.url === '/__probe.mjs') { res.setHeader('Content-Type', 'text/javascript'); res.end(await readFile(new URL('./stage-attribution.browser.mjs', import.meta.url))); return; }
      const fixture = contract.fixtures.find(f => req.url === '/__fixture/' + encodeURIComponent(f.file));
      if (fixture) { res.setHeader('Content-Type', fixture.id === 'user-cat' ? 'image/jpeg' : 'image/png'); res.end(await readFile(path.join(fixtureRoot, fixture.file))); return; }
      next();
    } catch (error) { next(error); }
  });
  await server.listen(); servers.push(server); return server;
};
let chromium; try { ({ chromium } = createRequire(import.meta.url)('playwright')); } catch { ({ chromium } = createRequire('C:/Users/Plout/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json')('./index.js')); }
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const servers = [], errors = [];
try {
  const plain = await vite(plainRoot), instrumented = await vite(instrumentedRoot), plainOrigin = 'http://127.0.0.1:' + plain.httpServer.address().port, instrumentedOrigin = 'http://127.0.0.1:' + instrumented.httpServer.address().port;
  const invoke = async (origin, input, method = 'diagnose') => {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    try { await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort()); const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message)); await page.goto(origin + '/__stage'); return await page.evaluate(async ({ input, method }) => (await import('/__probe.mjs'))[method](input), { input, method }); } finally { await context.close(); }
  };
  const rows = [];
  for (const item of chosen) {
    const fixture = contract.fixtures.find(f => f.id === item.fixture), rois = item.fixture === 'user-cat' ? catRois : logoRois;
    const input = { fixture, settings: item.settings, palette: contract.palette, rois };
    let timing; const timingFile = path.join(artifactRoot, item.id + '-timing.json');
    if (await has(timingFile)) timing = JSON.parse(await readFile(timingFile, 'utf8')); else {
      const knownFile = path.join(root, 'artifacts/quality-benchmark/after-terra', item.id + '.json');
      if (await has(knownFile)) {
        const known = JSON.parse(await readFile(knownFile, 'utf8'));
        const manifest = JSON.parse(await readFile(path.join(root, 'artifacts/quality-benchmark/after-terra/source-capture.json'), 'utf8'));
        assert.deepEqual(manifest.files, closureHashes, 'Saved timing source must match current closure');
        assert.deepEqual(known.settings, item.settings);
        timing = { times: [known.firstCallMs, ...known.warmMs], gridSha256: known.gridSha256, hashes: known.repeatedGridHashes, provenance: path.relative(root, knownFile) };
      } else timing = await invoke(plainOrigin, input, 'timed');
      assert.equal(new Set(timing.hashes).size, 1); await writeJson(item.id + '-timing.json', timing);
    }
    console.log('TIMING ' + item.id + ' ' + timing.times.join(','));
    for (const q of [28, 0]) {
      const resultFile = path.join(artifactRoot, item.id + '-q' + q + '.json');
      if (await has(resultFile)) { console.log('RESUME ' + item.id + ' Q' + q); continue; }
      const result = await invoke(instrumentedOrigin, { ...input, settings: { ...item.settings, quantizationStrength: q } });
      if (q === 28) {
        assert.equal(result.gridSha256, timing.gridSha256, 'instrumentation changed Q28 output ' + item.id);
      }
      const old = JSON.parse(await readFile(path.join(root, 'artifacts/quality-benchmark/before', item.id + '.json'), 'utf8'));
      assert.equal(result.sourcePixelSha256, old.sourcePixelSha256, 'Original Canvas reference changed');
      await writeJson(item.id + '-q' + q + '.json', result);
      console.log('SAVED ' + item.id + ' Q' + q + ' cells=' + result.cells.length);
      rows.push({ id: item.id, q, gridSha256: result.gridSha256, sourcePixelSha256: result.sourcePixelSha256, originalSize: result.originalSize, sourceSize: result.sourceSize, workSize: result.workSize, cellCount: result.cells.length });
    }
  }
  for (const [file, expected] of Object.entries(closureHashes)) assert.equal(sha(await readFile(path.join(root, file))), expected, 'production source changed ' + file);
  await writeJson('run-summary.json', { scope: 'Fixed full-frame original source; Q28 primary, Q0 counterfactual only; no algorithm candidate.', outputEquality: 'Q28 instrumented hash equals saved uninstrumented after-terra-cartoon hash for every selected case.', stageOrder: ['source', 'workBeforeQuantization', 'workQuantized', 'sampling', 'sampled', 'foreground', 'projectedInk', 'prematch', 'palette', 'consolidated', 'final'], timingSource: 'Existing uninstrumented quality-benchmark runs; diagnostic calls are excluded from timing.', timingCases: ['user-cat-58x58-cartoon', 'user-cat-100x100-cartoon', 'user-cat-100x114-cartoon', 'user-logo-58x58-logo', 'user-logo-100x100-logo'], settings: { palette: 'Mard-221', quantizationStrength: 28, sharpening: 40, colorLimit: 0, backgroundRemovalEnabled: false, outlineBoost: false, dither: 'none' }, errors, productionClosure: closureHashes });
  assert.equal(errors.length, 0);
} finally { await browser.close(); for (const server of servers) await server.close(); }
console.log('DONE stage attribution');
