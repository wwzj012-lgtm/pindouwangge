// Original-coordinate ROI plan and saved-grid rendering only. No converter imports.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { json, sha } from './fixtures.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const base = path.join(root, 'artifacts/quality-benchmark'), tag = process.argv[2] ?? 'before';
assert.ok(tag === 'before' || /^after(?:-[a-z0-9]+)+$/.test(tag));
const contract = JSON.parse(await readFile(path.join(base, 'contract.json'), 'utf8'));
const fixture = contract.fixtures.find(f => f.id === 'user-cat');
const bytes = await readFile(path.join(base, 'fixtures', fixture.file));
assert.equal(sha(bytes), fixture.fileSha256);
const id = 'user-cat-100x114-cartoon';
const before = JSON.parse(await readFile(path.join(base, 'before', id + '.json'), 'utf8'));
const after = tag === 'before' ? null : JSON.parse(await readFile(path.join(base, tag, id + '.json'), 'utf8'));
if (after) {
  assert.deepEqual(after.settings, before.settings); assert.equal(after.sourcePixelSha256, before.sourcePixelSha256);
  assert.equal(after.inputFileSha256, before.inputFileSha256); assert.equal(after.paletteSha256, before.paletteSha256);
}
const out = path.join(base, 'cartoon-roi', tag);
await mkdir(out, { recursive: true });
const definitions = [
  { id: 'eyes', label: 'Eyes / brow / nose bridge', original: { x: 535, y: 300, width: 340, height: 115 }, focus: 'Eye slits, light gray contours on white face, pupils/eye-corner separation; no widening into adjacent cells.' },
  { id: 'collar', label: 'Collar / bow tie / shirt', original: { x: 500, y: 425, width: 410, height: 225 }, focus: 'Connected light-gray/white collar against black, bow-tie separation and shirt detail; avoid inventing connecting runs.' },
  { id: 'clothes', label: 'Jacket / lapel / cuff detail', original: { x: 450, y: 550, width: 560, height: 500 }, focus: 'Gray lapel and seams against dark fills, small buttons, cuffs, clean flat blocks; count recovered supported detail separately from speckles.' },
];
const { width: columns, height: rows } = before.settings, cellScale = 12;
const plan = { sourceLabel: fixture.id, originalSize: { width: fixture.width, height: fixture.height }, originalSha256: fixture.fileSha256,
  browserSourceSize: before.sourceSize, sourcePixelSha256: before.sourcePixelSha256, grid: { columns, rows }, paletteSha256: before.paletteSha256,
  baselineGridSha256: before.gridSha256, settings: before.settings, displayPixelsPerCell: cellScale,
  referencePolicy: 'Requested ROIs are fixed ORIGINAL pixel rectangles. Expand to the same enclosing whole grid cells for source/before/after; store the exact fractional original envelope. Display resampling only, never used as metric/reference input. No recrop/recenter per candidate.', rois: [] };
const sourceDisplay = await sharp(bytes).resize(columns * cellScale, rows * cellScale, { fit: 'fill' }).ensureAlpha().png().toBuffer();
const lookup = new Map(contract.palette.map(c => [c.id, c.rgb]));
async function renderGrid(grid) {
  const data = Buffer.alloc(columns * rows * 4);
  grid.flat().forEach((id, i) => { const rgb = lookup.get(id); if (rgb) data.set([...rgb, 255], i * 4); });
  return sharp(data, { raw: { width: columns, height: rows, channels: 4 } }).resize(columns * cellScale, rows * cellScale, { kernel: 'nearest' }).png().toBuffer();
}
const beforeDisplay = await renderGrid(before.grid), afterDisplay = after ? await renderGrid(after.grid) : null;
const images = []; let top = 0, contactWidth = 0;
for (const def of definitions) {
  const r = def.original;
  assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.width <= fixture.width && r.y + r.height <= fixture.height);
  const x0 = Math.floor(r.x * columns / fixture.width), x1 = Math.ceil((r.x + r.width) * columns / fixture.width);
  const y0 = Math.floor(r.y * rows / fixture.height), y1 = Math.ceil((r.y + r.height) * rows / fixture.height);
  const grid = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  plan.rois.push({ ...def, grid, effectiveOriginal: { x: x0 * fixture.width / columns, y: y0 * fixture.height / rows, width: grid.width * fixture.width / columns, height: grid.height * fixture.height / rows } });
  const rect = { left: grid.x * cellScale, top: grid.y * cellScale, width: grid.width * cellScale, height: grid.height * cellScale };
  const panels = await Promise.all([sourceDisplay, beforeDisplay, ...(afterDisplay ? [afterDisplay] : [])].map(image => sharp(image).extract(rect).png().toBuffer()));
  const width = rect.width * panels.length, height = rect.height + 54;
  const labels = ['Original source', 'Before frozen HEAD', ...(after ? [tag] : [])];
  const header = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#eee"/><text x="8" y="20" font-family="sans-serif" font-size="14">${def.label} | Q28 | Mard-221 | same original ROI</text>${labels.map((label, i) => `<text x="${i * rect.width + 8}" y="43" font-family="sans-serif" font-size="14">${label}</text>`).join('')}</svg>`);
  const png = await sharp(header).composite(panels.map((input, i) => ({ input, left: i * rect.width, top: 54 }))).png().toBuffer();
  await writeFile(path.join(out, def.id + '-comparison.png'), png);
  images.push({ input: png, left: 0, top }); top += height; contactWidth = Math.max(contactWidth, width);
}
await writeFile(path.join(out, 'roi-plan.json'), json(plan));
await sharp({ create: { width: contactWidth, height: top, channels: 4, background: '#eee' } }).composite(images).png().toFile(path.join(out, 'roi-contact.png'));
console.log(json({ tag, converted: 0, source: fixture.id, hash: fixture.fileSha256, rois: plan.rois.map(({ id, original, grid }) => ({ id, original, grid })), output: path.relative(root, out) }));
