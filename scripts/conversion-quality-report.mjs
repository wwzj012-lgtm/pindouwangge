import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { createServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const label = args.includes('--label') ? args[args.indexOf('--label') + 1] : 'baseline';
if (!['baseline', 'after'].includes(label)) throw new Error('Use --label baseline|after');
const base = path.join(root, 'artifacts/conversion-quality/baseline');
const out = path.join(root, 'artifacts/conversion-quality', label);
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const hash = value => createHash('sha256').update(value).digest('hex');
const exists = file => access(file).then(() => true, () => false);
const git = (...params) => execFileSync('git', params, { cwd: root, encoding: 'utf8' }).trim();
const defaults = { width: 79, height: 44, keepAspectRatio: true, brand: 'MARD', dither: 'none', colorLimit: 0,
  brightness: 0, contrast: 0, saturation: 0, transparentCutoff: 128, boardSize: 29, sharpening: 30,
  outlineBoost: false, chromaKeyColor: null, chromaKeyTolerance: 20, colorMatchAlgo: 'ciede2000',
  kmeansClustering: true, quantizationStrength: 28, pipelineOverride: 'auto' };
const notes = 'Diagnostic measurements, not aesthetic scores. App defaults except requested widths 52/104 (App initial width 79); height=max(10,round(width*sourceHeight/sourceWidth)). Limits 0, 8 and 16 exercise unrestricted and user-limited palettes. Source PNGs preserve decoded RGBA without resizing. Grid PNGs use nearest-neighbour only. Durations measure converter calls, not decoding or reporting. No aesthetic pass thresholds.';

function synthetic(name) {
  const width = 312, height = 208, data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let rgba = [245, 240, 225, 255];
    if (name === 'alpha-edge') {
      const distance = Math.hypot(x - 156, y - 104);
      rgba = [210, 65, 100, Math.round(255 * Math.max(0, Math.min(1, (83 - distance) / 9)))];
      if (x > 125 && x < 187 && y > 93 && y < 97) rgba = [20, 20, 25, 255];
    } else if (name === 'logo-eyes') {
      const eyes = [119, 193].some(cx => Math.hypot((x - cx) / 12, (y - 87) / 19) < 1);
      const ring = Math.abs(Math.hypot(x - 156, y - 103) - 72) < 2;
      const mouth = x > 137 && x < 176 && Math.abs(y - (132 + (x - 156) ** 2 / 130)) < 1.5;
      if (eyes || ring || mouth) rgba = [22, 24, 30, 255];
      if ([117, 191].includes(x) && y > 78 && y < 83) rgba = [255, 255, 255, 255];
    } else {
      const line = [38, 68, 98, 128, 158].some((yy, i) => y >= yy && y < yy + 1 + i % 3 && x > 20 && x < 292);
      if (line || Math.abs(y - 0.52 * x - 12) < 0.7 || (x > 244 && x < 247)) rgba = [23, 26, 32, 255];
    }
    data.set(rgba, (y * width + x) * 4);
  }
  return { data, info: { width, height } };
}

function diagnostics(source, grid, palette, settings) {
  const { width, height } = source.info, { data } = source;
  const colors = new Map(palette.map(c => [c.id, c.rgb]));
  const luma = rgb => rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  let rgbError = 0, alphaError = 0, darkPixels = 0, recalled = 0, isolated = 0;
  const alphaSums = new Float64Array(settings.width * settings.height);
  const stride = Math.max(1, Math.round(width / settings.width));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4, a = data[i + 3] / 255;
    const gx = Math.min(settings.width - 1, Math.floor(x * settings.width / width));
    const gy = Math.min(settings.height - 1, Math.floor(y * settings.height / height));
    const rgb = colors.get(grid[gy][gx]), b = rgb ? 1 : 0;
    alphaSums[gy * settings.width + gx] += a;
    // Compare the original pixels with the projected grid on BOTH white and black.
    // This penalizes missing opaque pixels and never uses processed pipeline samples.
    for (const background of [0, 255]) for (let c = 0; c < 3; c++)
      rgbError += Math.abs(data[i + c] * a + background * (1 - a) - ((rgb?.[c] ?? 0) * b + background * (1 - b)));
    alphaError += Math.abs(a - b);
    if (a >= settings.transparentCutoff / 255 && luma(data.subarray(i, i + 3)) < 80) {
      const contrast = [[-stride, 0], [stride, 0], [0, -stride], [0, stride]].some(([dx, dy]) => {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) return false;
        const j = (ny * width + nx) * 4;
        return data[j + 3] >= settings.transparentCutoff && luma(data.subarray(j, j + 3)) > luma(data.subarray(i, i + 3)) + 60;
      });
      if (contrast) { darkPixels++; if (rgb && luma(rgb) < 100) recalled++; }
    }
  }
  const ids = new Set(grid.flat().filter(id => id !== null));
  let transparentCells = 0, opaqueCellsOverFullyTransparentSource = 0;
  for (let y = 0; y < grid.length; y++) for (let x = 0; x < grid[y].length; x++) {
    const id = grid[y][x];
    if (id === null) { transparentCells++; continue; }
    if (!colors.has(id)) throw new Error(`Unknown palette ID: ${id}`);
    if (alphaSums[y * settings.width + x] === 0) opaqueCellsOverFullyTransparentSource++;
    const neighbours = [[-1, 0], [1, 0], [0, -1], [0, 1]].filter(([dx, dy]) => grid[y + dy]?.[x + dx] !== undefined);
    if (neighbours.every(([dx, dy]) => grid[y + dy][x + dx] !== id)) isolated++;
  }
  return { sourceCompositeRgbMAE: rgbError / (width * height * 6), alphaMAE: alphaError / (width * height),
    darkLineReferencePixels: darkPixels, darkLineRecalledPixels: recalled, darkLineRecall: darkPixels ? recalled / darkPixels : null,
    isolatedCells4Neighbours: isolated, usedColors: ids.size, transparentCells, opaqueCellsOverFullyTransparentSource,
    colorLimitSatisfied: settings.colorLimit === 0 || ids.size <= settings.colorLimit };
}

async function gridPng(grid, palette) {
  const width = grid[0].length, height = grid.length;
  const colors = new Map(palette.map(c => [c.id, c.rgb])), data = Buffer.alloc(width * height * 4);
  grid.forEach((row, y) => row.forEach((id, x) => { const rgb = colors.get(id); if (rgb) data.set([...rgb, 255], (y * width + x) * 4); }));
  return sharp(data, { raw: { width, height, channels: 4 } }).resize(width * 6, height * 6, { kernel: 'nearest' }).png().toBuffer();
}

async function main() {
  await mkdir(out, { recursive: true });
  const frozen = await exists(path.join(base, 'report.json')) ? JSON.parse(await readFile(path.join(base, 'report.json'), 'utf8')) : null;
  if (label === 'baseline' && frozen && !args.includes('--extend-baseline')) throw new Error('Baseline is frozen; use --label after, or --extend-baseline to append missing cases from the frozen module.');
  if (label === 'after' && !frozen) throw new Error('Generate baseline first.');
  const baseline = label === 'after' ? frozen : null;
  if (!baseline && !await exists(path.join(base, 'modules/src/utils/imagePipeline.ts'))) {
    const head = git('rev-parse', 'HEAD');
    git('archive', head, 'src', '-o', path.join(base, 'modules.zip'));
    execFileSync('powershell.exe', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${path.join(base, 'modules.zip').replaceAll("'", "''")}' -DestinationPath '${path.join(base, 'modules').replaceAll("'", "''")}' -Force`]);
    await writeFile(path.join(base, 'head.txt'), `${head}\n`);
  }
  const moduleRoot = baseline ? root : path.join(base, 'modules');
  const vite = await createServer({ configFile: false, root: moduleRoot, optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom' });
  let converter, palette;
  try {
    ({ convertImageDataToGrid: converter } = await vite.ssrLoadModule('/src/utils/imagePipeline.ts'));
    ({ MARD_PALETTE: palette } = await vite.ssrLoadModule('/src/data/palettes.ts'));
  } finally { await vite.close(); } // Retain this one loaded converter for the entire run.
  if (baseline && hash(json(palette)) !== baseline.paletteSha256) throw new Error('Palette changed; comparison requires the frozen baseline palette.');
  const files = ['public/images/batiao-cat.webp', 'public/images/boss-xiaoxin.jpg', 'public/images/spiderman.webp',
    'public/images/chibi-character.jpg', 'src/assets/images/sample_preset_anya_1786081021182.jpg'];
  const materials = [...files.map(file => ({ id: path.parse(file).name, file })), ...['alpha-edge', 'logo-eyes', 'thin-lines'].map(id => ({ id }))];
  const cases = baseline?.cases ?? materials.flatMap(material => [52, 104].flatMap(width => [0, 8, 16].map(colorLimit => ({
    id: `${material.id}-w${width}-c${colorLimit}`, material, settings: { ...defaults, width, colorLimit } }))));
  const report = { label, generatedAt: !baseline && frozen ? frozen.generatedAt : new Date().toISOString(), head: baseline ? git('rev-parse', 'HEAD') : (await readFile(path.join(base, 'head.txt'), 'utf8')).trim(),
    workingTreeStatus: baseline ? git('status', '--short') : 'HEAD snapshot via git archive; working tree excluded', notes,
    metricDefinitions: { sourceCompositeRgbMAE: 'Original RGBA vs projected grid, average absolute sRGB channel error on black AND white (0..255).',
      darkLineRecall: 'Original alpha>=128, luma<80 with an opaque neighbour brighter by >60 at one grid-cell stride; recalled when projected bead luma<100. No tolerance dilation.',
      isolatedCells4Neighbours: 'Non-null cells with no identical ID among in-bounds four-neighbours; fine details may legitimately count.',
      alphaMAE: 'Mean absolute original alpha minus binary grid alpha (0..1).' },
    palette, paletteSha256: hash(json(palette)), baselineHead: baseline?.head ?? null, cases: [] };
  const rows = [], sources = new Map();
  for (const item of cases) {
    const { id, material } = item;
    if (!sources.has(material.id)) {
      const input = frozen ? path.join(base, `${material.id}-source.png`) : material.file ? path.join(root, material.file) : null;
      const source = input ? await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true }) : synthetic(material.id);
      sources.set(material.id, source);
      await sharp(source.data, { raw: { ...source.info, channels: 4 } }).png().toFile(path.join(out, `${material.id}-source.png`));
    }
    const source = sources.get(material.id), sourceSha256 = hash(source.data);
    if (baseline && sourceSha256 !== item.sourceSha256) throw new Error(`Source changed: ${id}`);
    const previous = !baseline ? frozen?.cases.find(c => c.id === id) : null;
    const settings = previous?.settings ?? (baseline ? item.settings : { ...item.settings, height: Math.max(10, Math.round(item.settings.width * source.info.height / source.info.width)) });
    const started = performance.now();
    const result = previous ?? converter(new Uint8ClampedArray(source.data), source.info.width, source.info.height, settings, palette);
    const durationMs = previous?.durationMs ?? performance.now() - started;
    if (result.grid.length !== settings.height || result.grid.some(row => row.length !== settings.width)) throw new Error(`Invalid grid dimensions: ${id}`);
    const metrics = previous?.metrics ?? diagnostics(source, result.grid, palette, settings);
    const entry = previous ?? { id, material, settings, sourceSize: { width: source.info.width, height: source.info.height }, sourceSha256,
      durationMs, metrics, grid: result.grid, palette, diagnostics: result.diagnostics };
    await writeFile(path.join(out, `${id}.json`), json(entry));
    const current = await gridPng(result.grid, palette);
    await writeFile(path.join(out, `${id}-grid.png`), current);
    const width = settings.width * 6, height = settings.height * 6;
    const panels = [await sharp(source.data, { raw: { ...source.info, channels: 4 } }).resize(width, height, { fit: 'fill' }).png().toBuffer()];
    if (baseline) panels.push(await gridPng(item.grid, item.palette)); // Saved Before grid, never re-converted.
    panels.push(current);
    await sharp({ create: { width: width * panels.length, height, channels: 4, background: '#00000000' } })
      .composite(panels.map((input, i) => ({ input, left: i * width, top: 0 }))).png().toFile(path.join(out, `${id}-comparison.png`));
    report.cases.push(entry);
    rows.push(`<article><h2>${id} · ${settings.width}×${settings.height}</h2><p>Source / ${baseline ? 'Before / After' : 'Baseline'}</p><a href="${id}-comparison.png"><img src="${id}-comparison.png"></a><pre>${JSON.stringify({ durationMs, metrics, before: baseline ? { durationMs: item.durationMs, metrics: item.metrics } : undefined }, null, 2)}</pre><a href="${id}.json">Raw grid / palette / diagnostics JSON</a></article>`);
    await writeFile(path.join(out, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Conversion quality ${label}</title><style>body{font:15px system-ui;margin:24px;background:#eee;color:#222}article{background:white;padding:16px;margin:20px 0}img{max-width:100%;background:conic-gradient(#ddd 25%,#fff 0 50%,#ddd 0 75%,#fff 0) 0/16px 16px}pre{white-space:pre-wrap}</style><h1>Conversion quality: ${label}</h1><p>${notes}</p><p>HEAD ${report.head}</p>${rows.join('\n')}`);
    console.log(`${id}: ${durationMs.toFixed(0)} ms; ${metrics.usedColors} colors; ${path.join(out, 'index.html')}`);
  }
  await writeFile(path.join(out, 'report.json'), json(report));
  await writeFile(path.join(out, 'summary.json'), json({ ...report, palette: undefined,
    cases: report.cases.map(({ grid, palette, diagnostics, ...entry }) => entry) }));
  console.log(`Saved ${report.cases.length} cases: ${path.join(out, 'index.html')}`);
  if (report.cases.some(c => !c.metrics.colorLimitSatisfied)) { console.error('User colorLimit violated; raw failures preserved.'); process.exitCode = 1; }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
