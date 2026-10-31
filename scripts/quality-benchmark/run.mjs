import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { createServer } from 'vite';
import { prepareFixtures, sha, json } from './fixtures.mjs';
import { measure, metricDefinitions } from './metrics.mjs';
import { captureProductionClosure } from './snapshot.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2), arg = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const phase = arg('--phase', 'before'), scope = arg('--scope', 'priority'), warm = Number(arg('--warm', '2'));
assert.ok(['before', 'after'].includes(phase)); assert.ok(['priority', 'cartoon-focus', 'matrix', 'compact'].includes(scope)); assert.ok(Number.isInteger(warm) && warm >= 1);
const tag = arg('--tag', phase);
assert.ok(phase === 'before' ? tag === 'before' : tag === 'final-retained' || /^after(?:-[a-z0-9]+)*$/.test(tag), 'Use before, final-retained, or an explicit after-* output tag');
const artifacts = path.join(root, 'artifacts/quality-benchmark'), out = path.join(artifacts, tag);
const fixturesDir = path.join(artifacts, 'fixtures'), contractFile = path.join(artifacts, 'contract.json');
const exists = file => access(file).then(() => true, () => false);
const git = (...params) => execFileSync('git', params, { cwd: root, encoding: 'utf8' }).trim();
const beforeModules = path.join(artifacts, 'before/modules');
const modules = phase === 'before' ? beforeModules : path.join(out, 'modules');
const readJson = async file => JSON.parse(await readFile(file, 'utf8'));
const startedAt = new Date().toISOString();

// Canonical SettingsPanel ON action sets sharpening to at least 40. Screenshot exposes
// a boolean, not the previous numeric value. Keep 40 identical before/after; never 0.
const fixedSettings = { width: 100, height: 100, keepAspectRatio: false, brand: 'MARD', dither: 'none', ditherStrength: 0.65,
  colorLimit: 0, brightness: 0, contrast: 0, saturation: 0, transparentCutoff: 128, boardSize: 29,
  colorMatchAlgo: 'ciede2000', sharpening: 40, outlineBoost: false, chromaKeyColor: null, chromaKeyTolerance: 20,
  backgroundRemovalEnabled: false, kmeansClustering: true, quantizationStrength: 28, pipelineOverride: 'auto' };

async function ensureContract() {
  if (await exists(contractFile)) return readJson(contractFile);
  assert.equal(phase, 'before', 'Freeze before contract first');
  const fixtures = await prepareFixtures(root, fixturesDir, { cat: arg('--cat', process.env.QB_CAT), logo: arg('--logo', process.env.QB_LOGO) });
  assert.ok(fixtures.some(f => f.id === 'user-cat') && fixtures.some(f => f.id === 'user-logo'), 'First run needs --cat and --logo external originals');
  const vite = await createServer({ configFile: false, root: beforeModules, optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom' });
  let palette;
  try { ({ MARD_PALETTE: palette } = await vite.ssrLoadModule('/src/data/palettes.ts')); } finally { await vite.close(); }
  assert.equal(palette.length, 221, 'Freeze Mard-221, do not substitute another palette');
  const modes = ['auto', 'cartoon', 'photo', 'logo'];
  const cases = fixtures.flatMap(f => [58, 100].flatMap(size => modes.map(mode => ({ id: `${f.id}-${size}x${size}-${mode}`, fixture: f.id, settings: { ...fixedSettings, width: size, height: size, pipelineOverride: mode } }))));
  for (const mode of modes) cases.unshift({ id: `user-cat-100x114-${mode}`, fixture: 'user-cat', settings: { ...fixedSettings, width: 100, height: 114, pipelineOverride: mode } });
  const priority = ['user-cat-100x114-photo', 'user-cat-100x114-cartoon', 'user-logo-100x100-logo'];
  const contract = { schema: 1, frozenAt: new Date().toISOString(), head: (await readFile(path.join(artifacts, 'before/head.txt'), 'utf8')).trim(),
    archiveSha256: sha(await readFile(path.join(artifacts, 'before/head-src.zip'))), palette, paletteSha256: sha(json(palette)),
    screenshotSettings: { palette: 'Mard-221', quantizationStrength: 28, colorLimit: 0, clarity: 'ON', sharpening: 40,
      sharpeningRationale: 'Screenshot only shows ON. The UI toggle ON action sets max(40, previous); initial App value 30 is also ON. Numeric value 40 is an explicit reproducibility assumption, held equal before/after.',
      dither: 'none', ditherStrengthInactive: 0.65, backgroundRemoval: false, connectedOutlineProtection: false },
    sourcePolicy: 'Original bytes frozen only under ignored artifacts; no preprocessing resize. Browser HTMLImage decode -> production imageToGridWithDiagnostics Canvas cap 1200. Original source AR is mapped to exact requested grid; 100x114 cat preserves AR approximately, square stress cases can distort AR.',
    photoCoverage: 'No verified camera photograph found. User-cat is pixel-art, user-logo is vector-like raster. Spider-Man is photo-like with unverified camera provenance. Synthetic smooth-tones is NOT a photo; no general natural-photo improvement claim.',
    fixtures, priority, cases };
  await writeFile(contractFile, json(contract), { flag: 'wx' });
  return contract;
}

async function captureAfter() {
  const manifestFile = path.join(out, 'source-capture.json');
  if (await exists(manifestFile)) return readJson(manifestFile);
  const files = await captureProductionClosure(root, modules);
  const versionFiles = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
  const versionSha256 = sha(json(versionFiles));
  await writeFile(path.join(out, 'probe-version.json'), json({ status: 'non-final implementation candidate', tag, versionSha256, files: versionFiles }), { flag: 'wx' });
  const manifest = { capturedAt: new Date().toISOString(), head: git('rev-parse', 'HEAD'), files, status: git('status', '--short'), notes: 'Immutable production dependency closure of colorUtils.ts and palettes.ts, including type-only imports and untracked implementation dependencies; no tests or App/UI copied.' };
  await writeFile(manifestFile, json(manifest), { flag: 'wx' }); return manifest;
}

function loadPlaywright() {
  try { return createRequire(import.meta.url)('playwright'); } catch {
    return createRequire('C:/Users/Plout/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json')('./index.js');
  }
}

function textSvg(width, height, labels) {
  const escape = s => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  return Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#ededed"/>${labels.map(({ text, x, y }) => `<text x="${x}" y="${y}" font-family="sans-serif" font-size="16" fill="#222">${escape(text)}</text>`).join('')}</svg>`);
}
async function gridPng(grid, palette, scale = 4) {
  const height = grid.length, width = grid[0].length, lookup = new Map(palette.map(c => [c.id, c.rgb])), data = Buffer.alloc(width * height * 4);
  grid.flat().forEach((id, i) => { const rgb = lookup.get(id); if (rgb) data.set([...rgb, 255], i * 4); });
  return sharp(data, { raw: { width, height, channels: 4 } }).resize(width * scale, height * scale, { kernel: 'nearest' }).png().toBuffer();
}
async function render(entry, contract, fixture) {
  const { width, height } = entry.settings, scale = 4, panelW = width * scale, panelH = height * scale;
  const current = await gridPng(entry.grid, contract.palette, scale);
  await writeFile(path.join(out, `${entry.id}-grid.png`), current);
  const panels = [await sharp(path.join(fixturesDir, fixture.file)).resize(panelW, panelH, { fit: 'fill' }).png().toBuffer()];
  const labels = ['Original source'];
  if (phase === 'after') {
    const previous = await readJson(path.join(artifacts, 'before', `${entry.id}.json`));
    assert.equal(previous.sourcePixelSha256, entry.sourcePixelSha256, 'Browser source pixels differ');
    assert.deepEqual(previous.settings, entry.settings, 'Settings differ');
    assert.equal(previous.paletteSha256, entry.paletteSha256, 'Palette differs');
    panels.push(await gridPng(previous.grid, contract.palette, scale)); labels.push('Before frozen HEAD');
  }
  panels.push(current); labels.push(phase === 'before' ? 'Before frozen HEAD' : 'After');
  const header = textSvg(panelW * panels.length, panelH + 58, [
    { text: `${entry.id} | Mard-221 | Q28 | unlimited | clarity ON | no dither`, x: 10, y: 20 },
    ...labels.map((text, i) => ({ text, x: i * panelW + 10, y: 45 })),
  ]);
  await sharp(header).composite(panels.map((input, i) => ({ input, left: i * panelW, top: 58 }))).png().toFile(path.join(out, `${entry.id}-comparison.png`));
}

async function main() {
  await mkdir(out, { recursive: true });
  const contract = await ensureContract();
  for (const fixture of contract.fixtures) assert.equal(sha(await readFile(path.join(fixturesDir, fixture.file))), fixture.fileSha256, `Fixture changed: ${fixture.id}`);
  assert.equal(sha(json(contract.palette)), contract.paletteSha256);
  if (phase === 'before') assert.equal(sha(await readFile(path.join(artifacts, 'before/head-src.zip'))), contract.archiveSha256);
  const afterCapture = phase === 'after' ? await captureAfter() : null;
  const vite = await createServer({ configFile: false, root: modules, optimizeDeps: { noDiscovery: true },
    server: { host: '127.0.0.1', port: 0, hmr: false, watch: null, fs: { allow: [root] } }, appType: 'custom' });
  vite.middlewares.use(async (request, response, next) => {
    try {
      if (request.url === '/__qb') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><meta charset="utf-8"><title>Local independent benchmark</title>'); return; }
      const fixture = contract.fixtures.find(f => request.url === '/__qb/' + encodeURIComponent(f.file));
      if (fixture) { response.setHeader('Content-Type', /\.png$/.test(fixture.file) ? 'image/png' : /\.webp$/.test(fixture.file) ? 'image/webp' : 'image/jpeg'); response.end(await readFile(path.join(fixturesDir, fixture.file))); return; }
      next();
    } catch (e) { next(e); }
  });
  await vite.listen();
  const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ headless: true, executablePath: arg('--chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe') });
  const environment = { node: process.version, browser: browser.version(), platform: os.platform(), release: os.release(), arch: os.arch(), cpu: os.cpus()[0].model,
    logicalCpus: os.cpus().length, ramBytes: os.totalmem(), headless: true, cpuThrottle: 1, host: os.hostname(), browserEntry: 'colorUtils.imageToGridWithDiagnostics(HTMLImageElement, frozenSettings, frozenPalette)',
    timing: 'Synchronous converter wall ms, including Canvas1200 render/readback + all preprocessing, sampling, quantization, matching, diagnostics and postprocess. Excludes image decode, module imports, artificial App delay, API refresh, PNG/metric/report generation.',
    coldDefinition: 'First conversion in a new browser context/page after imports+image decode; browser process/OS caches may already be warm. Not OS cold start.',
    warmDefinition: `${warm} subsequent same-page calls; all samples retained. No discarded slow samples, no inserted sleeps.`,
    limits: 'Desktop Chrome host only; not a mobile SLA. 58x58 budget 10000ms; 100x100 budget15000ms. 100x114 reported separately without inventing an SLA.' };
  const compactFixtures = ['user-cat', 'user-logo', 'spiderman', 'anya', 'xiaoxin', 'thin-text-contours', 'transparent-boundary'];
  // Presentation/execution order only. Frozen case IDs/settings/references stay unchanged.
  const modePriority = { cartoon: 0, photo: 1, auto: 2, logo: 3 };
  const priorityCases = contract.priority.map(id => contract.cases.find(c => c.id === id)).sort((a, b) => modePriority[a.settings.pipelineOverride] - modePriority[b.settings.pipelineOverride]);
  const cartoonFocusIds = ['user-cat-100x114-cartoon', 'cat-58x58-cartoon', 'cat-100x100-cartoon', 'xiaoxin-58x58-cartoon', 'xiaoxin-100x100-cartoon'];
  const selected = scope === 'cartoon-focus' ? cartoonFocusIds.map(id => contract.cases.find(c => c.id === id)) : scope === 'priority' ? priorityCases : [...priorityCases, ...contract.cases.filter(c => !contract.priority.includes(c.id) && (scope !== 'compact' || compactFixtures.includes(c.fixture)))];
  assert.ok(selected.every(Boolean), 'Requested cases must exist in the frozen contract');
  const errors = [], rows = [], sources = new Map();
  try {
    for (const item of selected) {
      const fixture = contract.fixtures.find(f => f.id === item.fixture), entryFile = path.join(out, item.id + '.json');
      if (await exists(entryFile)) { const entry = await readJson(entryFile); rows.push(entry); await render(entry, contract, fixture); console.log(`RESUME ${item.id}`); continue; }
      if (phase === 'after') assert.ok(await exists(path.join(artifacts, 'before', item.id + '.json')), 'Run this before case first: ' + item.id);
      const context = await browser.newContext({ serviceWorkers: 'block' });
      try {
        await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
        const page = await context.newPage(); page.on('pageerror', error => errors.push({ id: item.id, error: error.message }));
        await page.goto(origin + '/__qb');
        const measured = await page.evaluate(async ({ fixture, settings, palette, warm, includeSource }) => {
          const { imageToGridWithDiagnostics } = await import('/src/utils/colorUtils.ts');
          const image = new Image(); image.src = '/__qb/' + encodeURIComponent(fixture.file); await image.decode();
          const canvas = document.createElement('canvas'), scale = Math.min(1, 1200 / Math.max(image.naturalWidth, image.naturalHeight));
          canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
          const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
          const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          const digest = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(v => v.toString(16).padStart(2, '0')).join('');
          const sourcePixelSha256 = await digest(rgba), times = [], gridHashes = []; let result;
          for (let i = 0; i <= warm; i++) {
            const t = performance.now(); result = imageToGridWithDiagnostics(image, settings, palette); times.push(performance.now() - t);
            gridHashes.push(await digest(new TextEncoder().encode(JSON.stringify(result.grid))));
          }
          let sourceBase64;
          if (includeSource) { let str = ''; for (let i = 0; i < rgba.length; i += 32768) str += String.fromCharCode(...rgba.subarray(i, i + 32768)); sourceBase64 = btoa(str); }
          const { matches, ...diagnostics } = result.diagnostics;
          return { grid: result.grid, diagnostics, times, gridHashes, sourcePixelSha256, sourceBase64, sourceSize: { width: canvas.width, height: canvas.height }, originalSize: { width: image.naturalWidth, height: image.naturalHeight } };
        }, { fixture, settings: item.settings, palette: contract.palette, warm, includeSource: !sources.has(fixture.id) });
        assert.equal(measured.grid.length, item.settings.height); assert.ok(measured.grid.every(row => row.length === item.settings.width));
        if (item.settings.pipelineOverride !== 'auto') assert.equal(measured.diagnostics.pipeline, item.settings.pipelineOverride);
        assert.equal(new Set(measured.gridHashes).size, 1, 'Non-deterministic repeated grid: ' + item.id);
        if (measured.sourceBase64) sources.set(fixture.id, { data: Buffer.from(measured.sourceBase64, 'base64'), ...measured.sourceSize });
        const metrics = measure(sources.get(fixture.id), measured.grid, contract.palette, { lineProbe: fixture.id === 'thin-text-contours', colorLimit: item.settings.colorLimit });
        assert.ok(metrics.colorLimitSatisfied);
        const sorted = measured.times.slice(1).sort((a, b) => a - b), budgetMs = item.settings.width === item.settings.height ? (item.settings.width === 58 ? 10000 : 15000) : null;
        const entry = { id: item.id, fixture: fixture.id, settings: item.settings, paletteSha256: contract.paletteSha256, inputFileSha256: fixture.fileSha256,
          sourcePixelSha256: measured.sourcePixelSha256, sourceSize: measured.sourceSize, originalSize: measured.originalSize,
          firstCallMs: measured.times[0], warmMs: measured.times.slice(1), warmMedianMs: (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.ceil((sorted.length - 1) / 2)]) / 2,
          maxMs: Math.max(...measured.times), budgetMs, allObservedWithinBudget: budgetMs === null ? null : measured.times.every(ms => ms <= budgetMs),
          gridSha256: measured.gridHashes[0], repeatedGridHashes: measured.gridHashes, metrics, diagnostics: measured.diagnostics, grid: measured.grid };
        if (phase === 'after') {
          const old = await readJson(path.join(artifacts, 'before', item.id + '.json'));
          assert.deepEqual(old.settings, entry.settings); assert.equal(old.paletteSha256, entry.paletteSha256); assert.equal(old.inputFileSha256, entry.inputFileSha256); assert.equal(old.sourcePixelSha256, entry.sourcePixelSha256);
          entry.before = { firstCallMs: old.firstCallMs, warmMedianMs: old.warmMedianMs, maxMs: old.maxMs, metrics: old.metrics, gridSha256: old.gridSha256 };
          entry.metricDelta = Object.fromEntries(Object.entries(metrics).filter(([key, value]) => typeof value === 'number' && typeof old.metrics[key] === 'number').map(([key, value]) => [key, value - old.metrics[key]]));
        }
        await writeFile(entryFile, json(entry), { flag: 'wx' });
        await render(entry, contract, fixture); rows.push(entry);
        await writeFile(path.join(out, 'progress.json'), json({ phase, startedAt, updatedAt: new Date().toISOString(), completed: rows.map(e => e.id), nextScope: scope }));
        console.log(`SAVED ${item.id}: first ${entry.firstCallMs.toFixed(1)}ms warm ${entry.warmMedianMs.toFixed(1)}ms; colors ${metrics.usedColors}; ${path.join(out, item.id + '-comparison.png')}`);
      } finally { await context.close(); }
    }
    const report = { phase, tag, scope, startedAt, completedAt: new Date().toISOString(), baselineHead: contract.head, archiveSha256: contract.archiveSha256,
      contractSha256: sha(json(contract)), paletteSha256: contract.paletteSha256, metricScriptSha256: sha(await readFile(new URL('./metrics.mjs', import.meta.url))), environment, afterCapture,
      settings: contract.screenshotSettings, photoCoverage: contract.photoCoverage, metricDefinitions, errors, cases: rows.map(({ grid, ...entry }) => entry) };
    await writeFile(path.join(out, scope + '-report.json'), json(report));
    console.log(`DONE ${rows.length} cases: ${path.join(out, scope + '-report.json')}`);
    if (errors.length) process.exitCode = 1;
  } finally { await browser.close(); await vite.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
