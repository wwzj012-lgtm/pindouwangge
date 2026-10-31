// Render saved evidence only. Never calls a converter or updates frozen results.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { json, sha } from './fixtures.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const base = path.join(root, 'artifacts/quality-benchmark');
const tag = process.argv[2] ?? 'before';
assert.ok(tag === 'before' || /^after(?:-[a-z0-9]+)*$/.test(tag));
const out = path.join(base, tag), compact = ['user-cat', 'user-logo', 'spiderman', 'anya', 'xiaoxin', 'thin-text-contours', 'transparent-boundary'];
const readJson = async file => JSON.parse(await readFile(file, 'utf8'));
const report = await readJson(path.join(out, tag === 'before' ? 'matrix-report.json' : 'compact-report.json'));
const contract = await readJson(path.join(base, 'contract.json'));
assert.equal(report.contractSha256, sha(json(contract)), 'Frozen contract changed');
const cases = report.cases.filter(c => compact.includes(c.fixture));
assert.equal(cases.length, 60, 'Final reporting contract has exactly 60 existing cases');
const timing = [58, 100].map(size => {
  const rows = cases.filter(c => c.settings.width === size && c.settings.height === size), worst = [...rows].sort((a, b) => b.maxMs - a.maxMs)[0];
  return { size, count: rows.length, allObservedWithinBudget: rows.every(c => c.allObservedWithinBudget), maximumMs: worst.maxMs, maximumCase: worst.id };
});
const rect = cases.filter(c => c.settings.width !== c.settings.height);
const summary = { tag, cases: 60, modes: ['auto', 'cartoon', 'photo', 'logo'], fixtures: compact,
  contractSha256: report.contractSha256, paletteSha256: report.paletteSha256, environment: report.environment, timing,
  rectangularCases: rect.map(c => ({ id: c.id, maxMs: c.maxMs, budgetMs: null })), photoCoverage: contract.photoCoverage,
  caveats: ['Original browser RGBA after unchanged Canvas1200 path is independently integrated for all fidelity references. Pipeline samples/internal meanDeltaE are NOT the reference.',
    'Independent metrics describe different tradeoffs; lower color error or fewer colors/tiny components alone does not establish visual quality.',
    'Square stress cases map the original source to the requested exact square; the primary cat100x114 uses its approximately original aspect ratio.',
    'Cold means fresh-context first conversion, not OS cold start; warm samples and first sample are all retained; desktop measurements do not certify phones.',
    'After candidates are non-final, immutable captures. No implementation automatically passes on timing or mean metrics.'],
  casesData: cases };
await writeFile(path.join(out, 'compact-summary.json'), json(summary));
const fmt = (v, n = 4) => v === null || v === undefined ? 'n/a' : Number(v).toFixed(n);
const metrics = ['compositeAreaRgbMAE', 'compositeAreaDeltaE76', 'localLumaSSIMWhite', 'edgeF1_1Cell', 'darkInkPrecision', 'darkInkRecall', 'darkInkF1', 'alphaMAE', 'softAlphaIoU', 'opaqueOverFullyTransparent', 'usedColors', 'isolatedCells4', 'tinyComponentCells4'];
const headers = ['case', 'firstMs', 'warmMedianMs', 'maxMs', ...metrics];
await writeFile(path.join(out, 'compact-metrics.csv'), [headers.join(','), ...cases.map(c => [c.id, c.firstCallMs, c.warmMedianMs, c.maxMs, ...metrics.map(key => c.metrics[key] ?? '')].join(','))].join('\n') + '\n');
const title = `${tag}: 60 paired conversion cases`;
const times = timing.map(t => `| ${t.size}x${t.size} | ${t.count} | ${fmt(t.maximumMs / 1000, 3)} s | ${t.maximumCase} | ${t.allObservedWithinBudget ? 'yes' : 'NO'} |`).join('\n');
const markdown = `# ${title}\n\nFrozen HEAD before: ${contract.head}. Fixed Mard-221 / Q28 / unlimited / clarity ON sharpening40 / dither NONE / background OFF / outline OFF.\n\nReference: ORIGINAL browser-decoded RGBA after the unchanged Canvas1200 input path, independently integrated with exact fractional area on black and white. Never pipeline-preprocessed samples.\n\n| Grid | Cases | Max of all observed samples | Case | Budget satisfied on this host |\n| --- | ---: | ---: | --- | --- |\n${times}\n\nCat100x114 has four additional mode cases and no invented square-grid SLA. All first and two warm calls are retained.\n\n${summary.caveats.map(t => '- ' + t).join('\n')}\n\nPhoto coverage: ${contract.photoCoverage}\n\nEnvironment: ${report.environment.cpu.trim()}, ${report.environment.logicalCpus} logical CPUs, ${report.environment.platform} ${report.environment.release}, headless Chrome ${report.environment.browser}, CPU throttle1. Includes production Canvas render/readback plus all preprocessing/sampling/quantization/postprocessing. Excludes image decode/import/API refresh/UI/reporting/artificial timeout. Host load is not controlled and other agents can run concurrently.\n\nPrimary evidence: user-cat-100x114-photo-comparison.png, user-cat-100x114-cartoon-comparison.png, user-logo-100x100-logo-comparison.png. See index.html and compact-metrics.csv.\n`;
await writeFile(path.join(out, 'SUMMARY.md'), markdown);
const escape = s => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const articles = cases.map(c => `<article><h2>${c.id}</h2><p>Source / ${tag === 'before' ? 'Before' : 'Before / After'}; first ${fmt(c.firstCallMs, 1)} ms; warm median ${fmt(c.warmMedianMs, 1)} ms; max ${fmt(c.maxMs, 1)} ms</p><a href="${c.id}-comparison.png"><img loading="lazy" src="${c.id}-comparison.png"></a><pre>${escape(JSON.stringify({ metrics: c.metrics, before: c.before?.metrics, delta: c.metricDelta }, null, 2))}</pre><a href="${c.id}.json">Saved grid + hashes + settings</a></article>`);
await writeFile(path.join(out, 'index.html'), `<!doctype html><meta charset="utf-8"><title>${title}</title><style>body{font:15px system-ui;margin:24px;background:#eee;color:#222}article{background:#fff;margin:20px 0;padding:16px}img{max-width:100%;background:conic-gradient(#ddd 25%,white 0 50%,#ddd 0 75%,white 0) 0/16px 16px}pre{white-space:pre-wrap}</style><h1>${title}</h1><pre>${escape(markdown)}</pre>${articles.join('\n')}`);
// Primary contact sheet keeps the SAME native 4px/cell comparison PNGs, no resizing.
const images = [];
let top = 0, width = 0;
const orderedPriority = contract.priority.slice().sort((a, b) => {
  const order = { cartoon: 0, photo: 1, logo: 2 };
  const mode = id => contract.cases.find(c => c.id === id).settings.pipelineOverride;
  return order[mode(a)] - order[mode(b)];
});
for (const id of orderedPriority) {
  const input = await readFile(path.join(out, id + '-comparison.png')), meta = await sharp(input).metadata();
  images.push({ input, left: 0, top }); top += meta.height; width = Math.max(width, meta.width);
}
await sharp({ create: { width, height: top, channels: 4, background: '#ededed' } }).composite(images).png().toFile(path.join(out, 'priority-contact.png'));
console.log(`${tag}: saved 60-case JSON/CSV/Markdown/HTML and native-scale primary contact PNG; no conversions executed`);
