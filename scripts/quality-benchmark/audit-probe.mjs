// Untimed, observational wrappers around the frozen candidate. No production edits.
// Every audited grid must equal the previously timed grid byte-for-byte.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'vite';
import { sha, json } from './fixtures.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const artifacts = path.join(root, 'artifacts/quality-benchmark');
const contract = JSON.parse(await readFile(path.join(artifacts, 'contract.json'), 'utf8'));
const output = path.resolve(process.argv[2] ?? path.join(artifacts, 'after'));
const version = JSON.parse(await readFile(path.join(output, 'probe-version.json'), 'utf8'));
const wrappers = {
  preprocessSourceImage: `
    const mask = result.detailMask;
    trace.push({name:'preprocessSourceImage',sourceWidth:args[1],sourceHeight:args[2],mode:args[4],quantizationStrength:args[5],
      sampleWidth:result.sampleWidth,sampleHeight:result.sampleHeight,sourceMaskPixels:mask.length,
      nonzeroDetailPixels:mask.reduce((s,v)=>s+(v>0?1:0),0),strongDetailPixels:mask.reduce((s,v)=>s+(v>=0.65?1:0),0)});`,
  resizeSourceArea: `trace.push({name:'resizeSourceArea',sourceWidth:args[1],sourceHeight:args[2],columns:args[3],rows:args[4],rgbaLength:result.length});`,
  projectSourceStrokes: `
    const cells=[]; const target=args[7];
    result.forEach((rgb,index)=>{if(rgb)cells.push({index,x:index%args[3],y:Math.floor(index/args[3]),rgb,beforeRgb:[target[index].r,target[index].g,target[index].b],targetAlpha:target[index].alpha});});
    trace.push({name:'projectSourceStrokes',sourceWidth:args[1],sourceHeight:args[2],columns:args[3],rows:args[4],proposedCells:cells.length,
      unsupportedAlphaTargets:cells.filter(c=>!c.targetAlpha).length,cells});`,
};
const plugin = { name: 'qb-observe-frozen-coverage', enforce: 'pre', transform(code, id) {
  if (!id.includes('/src/utils/')) return;
  let changed = false;
  for (const [name, observe] of Object.entries(wrappers)) {
    const declaration = `export function ${name}(`;
    if (!code.includes(declaration)) continue;
    changed = true; code = code.replace(declaration, `function __qbOriginal_${name}(`);
    code += `\nexport function ${name}(...args: Parameters<typeof __qbOriginal_${name}>) {\nconst result=__qbOriginal_${name}(...args);\nconst trace=(globalThis as any).__qbCoverage;\nif(trace){${observe}}\nreturn result;\n}\n`;
  }
  if (changed) return { code, map: null };
} };
const vite = await createServer({ configFile: false, root: path.join(output, 'modules'), plugins: [plugin], optimizeDeps: { noDiscovery: true },
  appType: 'custom', server: { host: '127.0.0.1', port: 0, hmr: false, watch: null, fs: { allow: [root] } } });
vite.middlewares.use((req, res, next) => { if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Untimed coverage audit</title>'); } else next(); });
await vite.listen();
const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
const { chromium } = createRequire('C:/Users/Plout/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json')('./index.js');
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const cases = [];
try {
  for (const id of contract.priority) {
    const item = contract.cases.find(c => c.id === id), fixture = contract.fixtures.find(f => f.id === item.fixture);
    const bytes = await readFile(path.join(artifacts, 'fixtures', fixture.file));
    assert.equal(sha(bytes), fixture.fileSha256);
    const page = await browser.newPage();
    try {
      await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
      await page.goto(origin);
      const audit = await page.evaluate(async ({ base64, mime, settings, palette }) => {
        const { imageToGridWithDiagnostics } = await import('/src/utils/colorUtils.ts');
        const img = new Image(); img.src = `data:${mime};base64,${base64}`; await img.decode();
        window.__qbCoverage = [];
        const result = imageToGridWithDiagnostics(img, settings, palette);
        return { trace: window.__qbCoverage, grid: result.grid };
      }, { base64: bytes.toString('base64'), mime: fixture.file.endsWith('.png') ? 'image/png' : 'image/jpeg', settings: item.settings, palette: contract.palette });
      const timed = JSON.parse(await readFile(path.join(output, id + '.json'), 'utf8'));
      assert.equal(sha(JSON.stringify(audit.grid)), timed.gridSha256, 'Observational audit changed output!');
      const strokes = audit.trace.find(t => t.name === 'projectSourceStrokes');
      const palette = new Map(contract.palette.map(c => [c.id, c.rgb]));
      if (strokes) {
        for (const cell of strokes.cells) {
          cell.finalId = audit.grid[cell.y][cell.x]; cell.finalRgb = palette.get(cell.finalId) ?? null;
          cell.finalMaxRgbDistance = cell.finalRgb ? Math.max(...cell.rgb.map((v, i) => Math.abs(v - cell.finalRgb[i]))) : null;
        }
        // A retention diagnostic only: finite physical palette colors and sharpening
        // can alter RGB legitimately; this threshold is not an acceptance criterion.
        strokes.within35RgbOfSuggestedSource = strokes.cells.filter(c => c.finalMaxRgbDistance !== null && c.finalMaxRgbDistance <= 35).length;
      }
      cases.push({ id, outputMatchesTimedGrid: true, sourcePixelSha256: timed.sourcePixelSha256, trace: audit.trace });
      console.log(JSON.stringify({ id, trace: audit.trace.map(({ cells, ...trace }) => trace), outputMatchesTimedGrid: true }));
    } finally { await page.close(); }
  }
  await writeFile(path.join(output, 'sampling-coverage.json'), json({ status: 'non-final untimed observational audit', versionSha256: version.versionSha256,
    method: 'Vite adds observational wrappers in memory around frozen candidate functions; timed output is not instrumented; every audited grid SHA must equal timed grid SHA.',
    caveat: 'Proposed stroke counts are coverage observations, not quality scores. Inspect source/before/after and final palette/structure. Photo intentionally skips stroke projection.', cases }));
} finally { await browser.close(); await vite.close(); }
