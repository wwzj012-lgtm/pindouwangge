// Quality benchmark for the conversion pipeline.
//
// Usage:
//   node scripts/quality-benchmark.mjs            run suite, write benchmark/results/latest.json
//   node scripts/quality-benchmark.mjs --save     also copy latest.json to baseline.json
//   node scripts/quality-benchmark.mjs --compare  diff latest.json against baseline.json
//
// Add samples by dropping images into benchmark/images/. Every image runs
// through convertImageDataToGrid with the standard 100-grid settings, then two
// independent metrics are recorded:
//
//  cellDeltaE   per-cell CIEDE2000 against a premultiplied area-average
//               reference (classic conversion error, rewards flat accuracy).
//  viewDeltaE   the rendered bead artwork and the source are downscaled to the
//               same small size and blurred, approximating the artwork seen
//               from viewing distance where beads merge into continuous tone.
//               This is the perceptual metric: it rewards what a viewer sees.
//  pixelDeltaE  every opaque source pixel (subsampled) is compared with the
//               bead colour of the cell covering it, at full resolution with
//               no averaging or blur. This is the fair metric for hard-edged
//               art: the other two use blend references that structurally
//               reward turning hard edges into mush, and therefore punished
//               dominant-colour sampling even though it looks better.
//
// All are reported as mean and p95. The p95 tail catches halo/outline damage
// that a mean happily averages away.

import { createServer } from 'vite';
import sharp from 'sharp';
import { readdir, mkdir, writeFile, readFile, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';

const ROOT = process.cwd();
const IMAGES_DIR = path.join(ROOT, 'benchmark', 'images');
const RESULTS_DIR = path.join(ROOT, 'benchmark', 'results');
const TARGET_W = 256;

const SETTINGS = {
  width: 100,
  height: 100,
  keepAspectRatio: true,
  brand: 'MARD',
  dither: 'none',
  colorLimit: 32,
  brightness: 0,
  contrast: 0,
  saturation: 0,
  transparentCutoff: 128,
  boardSize: 29,
  sharpening: 30,
  outlineBoost: false,
  chromaKeyColor: null,
  chromaKeyTolerance: 20,
  colorMatchAlgo: 'ciede2000',
  backgroundRemovalEnabled: true,
  kmeansClustering: true,
  quantizationStrength: 28,
  pipelineOverride: 'auto',
};

function gitShort() {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim();
  } catch {
    return 'unknown';
  }
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

async function main() {
  const argv = process.argv.slice(2);
  const saveBaseline = argv.includes('--save');
  const compare = argv.includes('--compare');

  if (!existsSync(IMAGES_DIR)) {
    console.error(`No ${IMAGES_DIR}. Drop sample images there first.`);
    process.exit(1);
  }
  await mkdir(RESULTS_DIR, { recursive: true });

  const vite = await createServer({
    root: ROOT,
    appType: 'custom',
    server: { middlewareMode: true },
    logLevel: 'error',
    optimizeDeps: { noDiscovery: true },
  });

  try {
    const { convertImageDataToGrid } = await vite.ssrLoadModule('/src/utils/imagePipeline.ts');
    const { MARD_PALETTE } = await vite.ssrLoadModule('/src/data/palettes.ts');
    const { rgbToLab, deltaE2000 } = await vite.ssrLoadModule('/src/utils/colorUtils.ts');

    const colorById = new Map(MARD_PALETTE.map((c) => [c.id, c]));
    const files = (await readdir(IMAGES_DIR)).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).sort();
    if (files.length === 0) {
      console.error('benchmark/images/ is empty.');
      process.exit(1);
    }

    const results = [];
    for (const file of files) {
      const imgPath = path.join(IMAGES_DIR, file);
      const { data, info } = await sharp(imgPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const srcW = info.width;
      const srcH = info.height;
      const px = (x, y) => {
        const i = (y * srcW + x) * 4;
        return [data[i], data[i + 1], data[i + 2], data[i + 3]];
      };

      // --- background reference colour: median of border samples ---
      const border = [];
      for (let x = 0; x < srcW; x += 7) {
        border.push(px(x, 0), px(x, srcH - 1));
      }
      for (let y = 0; y < srcH; y += 7) {
        border.push(px(0, y), px(srcW - 1, y));
      }
      const bg = [0, 1, 2].map((c) => {
        const vals = border.map((p) => p[c]).sort((a, b) => a - b);
        return vals[Math.floor(vals.length / 2)];
      });

      // --- convert ---
      const t0 = performance.now();
      const result = convertImageDataToGrid(
        new Uint8ClampedArray(data.buffer, data.byteOffset, data.length),
        srcW,
        srcH,
        { ...SETTINGS },
        MARD_PALETTE,
      );
      const convertMs = Math.round(performance.now() - t0);
      const grid = result.grid;
      const rows = grid.length;
      const cols = grid[0].length;

      // --- metric 1: per-cell deltaE vs premultiplied area-average reference ---
      const cellDe = [];
      for (let gy = 0; gy < rows; gy += 1) {
        for (let gx = 0; gx < cols; gx += 1) {
          const id = grid[gy][gx];
          if (!id) continue;
          let r = 0;
          let g = 0;
          let b = 0;
          let a = 0;
          const y0 = Math.floor((gy * srcH) / rows);
          const y1 = Math.min(srcH, Math.ceil(((gy + 1) * srcH) / rows));
          const x0 = Math.floor((gx * srcW) / cols);
          const x1 = Math.min(srcW, Math.ceil(((gx + 1) * srcW) / cols));
          for (let y = y0; y < y1; y += 1) {
            for (let x = x0; x < x1; x += 1) {
              const [pr, pg, pb, pa] = px(x, y);
              const al = pa / 255;
              r += pr * al;
              g += pg * al;
              b += pb * al;
              a += al;
            }
          }
          if (a <= 0) continue;
          const cell = rgbToLab(Math.round(r / a), Math.round(g / a), Math.round(b / a));
          const bead = rgbToLab(...colorById.get(id).rgb);
          cellDe.push(deltaE2000(cell, bead));
        }
      }
      cellDe.sort((a, b) => a - b);

      // --- render the artwork at source resolution, empty cells over bg ---
      const render = Buffer.alloc(srcW * srcH * 3);
      for (let y = 0; y < srcH; y += 1) {
        const gy = Math.min(rows - 1, Math.floor((y * rows) / srcH));
        for (let x = 0; x < srcW; x += 1) {
          const gx = Math.min(cols - 1, Math.floor((x * cols) / srcW));
          const id = grid[gy][gx];
          const rgb = id ? colorById.get(id).rgb : bg;
          const i = (y * srcW + x) * 3;
          render[i] = rgb[0];
          render[i + 1] = rgb[1];
          render[i + 2] = rgb[2];
        }
      }

      // --- metric 2: view-distance deltaE ---
      const targetH = Math.max(1, Math.round((TARGET_W * rows) / cols));
      const smallSrc = await sharp(imgPath).flatten({ background: { r: bg[0], g: bg[1], b: bg[2] } })
        .resize(TARGET_W, targetH, { fit: 'fill' }).blur(1.0).raw().toBuffer();
      const smallRender = await sharp(render, { raw: { width: srcW, height: srcH, channels: 3 } })
        .resize(TARGET_W, targetH, { fit: 'fill' }).blur(1.0).raw().toBuffer();
      const viewDe = [];
      for (let i = 0; i < smallSrc.length; i += 3) {
        const d = deltaE2000(
          rgbToLab(smallSrc[i], smallSrc[i + 1], smallSrc[i + 2]),
          rgbToLab(smallRender[i], smallRender[i + 1], smallRender[i + 2]),
        );
        viewDe.push(d);
      }
      viewDe.sort((a, b) => a - b);

      // --- metric 3: per-pixel deltaE at full source resolution ---
      // No averaging, no blur: each opaque source pixel is compared against
      // the bead colour of the cell that covers it. Fair to hard-edged art.
      const PX_STRIDE = 2;
      const pxDe = [];
      for (let y = 0; y < srcH; y += PX_STRIDE) {
        const gy = Math.min(rows - 1, Math.floor((y * rows) / srcH));
        for (let x = 0; x < srcW; x += PX_STRIDE) {
          const [pr, pg, pb, pa] = px(x, y);
          if (pa < 128) continue;
          const gx = Math.min(cols - 1, Math.floor((x * cols) / srcW));
          const id = grid[gy][gx];
          const rgb = id ? colorById.get(id).rgb : bg;
          pxDe.push(deltaE2000(rgbToLab(pr, pg, pb), rgbToLab(rgb[0], rgb[1], rgb[2])));
        }
      }
      pxDe.sort((a, b) => a - b);

      // --- side-by-side visual ---
      const visH = 420;
      const visW = Math.round((visW_safe(cols, rows, visH)));
      const srcVis = await sharp(imgPath).flatten({ background: { r: bg[0], g: bg[1], b: bg[2] } })
        .resize(visW, visH, { fit: 'fill' }).png().toBuffer();
      const renderVis = await sharp(render, { raw: { width: srcW, height: srcH, channels: 3 } })
        .resize(visW, visH, { fit: 'fill' }).png().toBuffer();
      await sharp({ create: { width: visW * 2 + 8, height: visH, channels: 3, background: { r: 255, g: 255, b: 255 } } })
        .composite([
          { input: srcVis, left: 0, top: 0 },
          { input: renderVis, left: visW + 8, top: 0 },
        ])
        .jpeg({ quality: 90 })
        .toFile(path.join(RESULTS_DIR, `${path.parse(file).name}-side.jpg`));

      const entry = {
        image: file,
        pipeline: result.diagnostics?.pipeline ?? 'unknown',
        grid: `${cols}x${rows}`,
        filledCells: cellDe.length,
        convertMs,
        cellDeltaE: {
          mean: round(cellDe.reduce((s, v) => s + v, 0) / cellDe.length),
          p95: round(percentile(cellDe, 95)),
        },
        viewDeltaE: {
          mean: round(viewDe.reduce((s, v) => s + v, 0) / viewDe.length),
          p95: round(percentile(viewDe, 95)),
        },
        pixelDeltaE: {
          mean: round(pxDe.reduce((s, v) => s + v, 0) / pxDe.length),
          p95: round(percentile(pxDe, 95)),
        },
      };
      results.push(entry);
      console.log(
        `${file.padEnd(22)} ${entry.pipeline.padEnd(8)} ${entry.grid.padEnd(8)}`
        + ` cellΔE ${entry.cellDeltaE.mean}/${entry.cellDeltaE.p95}`
        + `  viewΔE ${entry.viewDeltaE.mean}/${entry.viewDeltaE.p95}`
        + `  pixelΔE ${entry.pixelDeltaE.mean}/${entry.pixelDeltaE.p95}`
        + `  ${convertMs}ms`,
      );
    }

    const aggregate = {
      rev: gitShort(),
      ranAt: new Date().toISOString(),
      settings: SETTINGS,
      samples: results.length,
      cellMean: round(avg(results.map((r) => r.cellDeltaE.mean))),
      cellP95: round(avg(results.map((r) => r.cellDeltaE.p95))),
      viewMean: round(avg(results.map((r) => r.viewDeltaE.mean))),
      viewP95: round(avg(results.map((r) => r.viewDeltaE.p95))),
      pixelMean: round(avg(results.map((r) => r.pixelDeltaE.mean))),
      pixelP95: round(avg(results.map((r) => r.pixelDeltaE.p95))),
      results,
    };

    const latestPath = path.join(RESULTS_DIR, 'latest.json');
    await writeFile(latestPath, JSON.stringify(aggregate, null, 2));
    console.log(`\nrev ${aggregate.rev} | cellΔE ${aggregate.cellMean} (p95 ${aggregate.cellP95})`
      + ` | viewΔE ${aggregate.viewMean} (p95 ${aggregate.viewP95})`
      + ` | pixelΔE ${aggregate.pixelMean} (p95 ${aggregate.pixelP95}) | -> benchmark/results/latest.json`);

    if (saveBaseline) {
      await copyFile(latestPath, path.join(RESULTS_DIR, 'baseline.json'));
      console.log('baseline saved.');
    }

    if (compare) {
      const baselinePath = path.join(RESULTS_DIR, 'baseline.json');
      if (!existsSync(baselinePath)) {
        console.error('No baseline.json yet — run with --save first.');
        process.exit(1);
      }
      const baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
      const base = new Map(baseline.results.map((r) => [r.image, r]));
      console.log(`\nvs baseline rev ${baseline.rev}:`);
      for (const r of results) {
        const b = base.get(r.image);
        if (!b) {
          console.log(`  ${r.image}: NEW SAMPLE (no baseline)`);
          continue;
        }
        const dCell = r.cellDeltaE.mean - b.cellDeltaE.mean;
        const dView = r.viewDeltaE.mean - b.viewDeltaE.mean;
        const mark = (v) => (v <= -0.15 ? 'BETTER' : v >= 0.15 ? 'WORSE' : '~same');
        let line = `  ${r.image}: cellΔE ${b.cellDeltaE.mean} -> ${r.cellDeltaE.mean} (${sign(dCell)}, ${mark(dCell)})`
          + ` | viewΔE ${b.viewDeltaE.mean} -> ${r.viewDeltaE.mean} (${sign(dView)}, ${mark(dView)})`;
        if (r.pixelDeltaE && b.pixelDeltaE) {
          const dPx = r.pixelDeltaE.mean - b.pixelDeltaE.mean;
          line += `\n    pixelΔE ${b.pixelDeltaE.mean} -> ${r.pixelDeltaE.mean} (${sign(dPx)}, ${mark(dPx)})`
            + ` | p95 ${b.pixelDeltaE.p95} -> ${r.pixelDeltaE.p95}`;
        } else {
          line += ' | pixelΔE: no baseline value';
        }
        console.log(line);
      }
    }
  } finally {
    await vite.close();
  }
}

function visW_safe(cols, rows, visH) {
  return Math.max(80, Math.round((visH * cols) / rows));
}
function avg(list) {
  return list.length ? list.reduce((s, v) => s + v, 0) / list.length : 0;
}
function round(v) {
  return Math.round(v * 1000) / 1000;
}
function sign(v) {
  return (v >= 0 ? '+' : '') + v.toFixed(3);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
