import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { createServer } from 'vite';

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(moduleDirectory, '..');
const inputPath = path.join(projectDirectory, 'src', 'assets', 'images', 'sample_preset_anya_1786081021182.jpg');
const artifactsDirectory = path.join(projectDirectory, 'artifacts');
const previewPath = path.join(artifactsDirectory, 'anya-v2-preview.png');
const comparisonPath = path.join(artifactsDirectory, 'anya-v2-comparison.png');
const gridWidth = 100;
const gridHeight = 56;
const previewScale = 8;

const settings = {
  width: gridWidth,
  height: gridHeight,
  keepAspectRatio: true,
  brand: 'MARD',
  dither: 'none',
  colorLimit: 0,
  brightness: 0,
  contrast: 0,
  saturation: 0,
  transparentCutoff: 128,
  boardSize: 29,
  colorMatchAlgo: 'ciede2000',
  sharpening: 30,
  outlineBoost: true,
  chromaKeyColor: null,
  chromaKeyTolerance: 20,
  pipelineOverride: 'auto',
};

function decimal(value) {
  return Number(value.toFixed(4));
}

function ratio(count, total) {
  return decimal(count / Math.max(1, total));
}

function makePreview(grid, palette) {
  const colors = new Map(palette.map((color) => [color.id, color.rgb]));
  const buffer = Buffer.alloc(gridWidth * gridHeight * previewScale * previewScale * 4, 0);
  const previewWidth = gridWidth * previewScale;

  for (let gridY = 0; gridY < gridHeight; gridY += 1) {
    for (let gridX = 0; gridX < gridWidth; gridX += 1) {
      const rgb = grid[gridY]?.[gridX] ? colors.get(grid[gridY][gridX]) : undefined;
      for (let pixelY = gridY * previewScale; pixelY < (gridY + 1) * previewScale; pixelY += 1) {
        for (let pixelX = gridX * previewScale; pixelX < (gridX + 1) * previewScale; pixelX += 1) {
          const offset = (pixelY * previewWidth + pixelX) * 4;
          buffer[offset] = rgb?.[0] ?? 0;
          buffer[offset + 1] = rgb?.[1] ?? 0;
          buffer[offset + 2] = rgb?.[2] ?? 0;
          buffer[offset + 3] = rgb ? 255 : 0;
        }
      }
    }
  }
  return buffer;
}

async function run() {
  const vite = await createServer({
    configFile: false,
    root: projectDirectory,
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: 'custom',
  });
  let converter;
  let palette;
  try {
    ({ convertImageDataToGrid: converter } = await vite.ssrLoadModule('/src/utils/imagePipeline.ts'));
    ({ MARD_PALETTE: palette } = await vite.ssrLoadModule('/src/data/palettes.ts'));
  } finally {
    await vite.close();
  }

  const decoded = await sharp(inputPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const imageData = new Uint8ClampedArray(decoded.data.buffer, decoded.data.byteOffset, decoded.data.byteLength);
  const result = converter(imageData, decoded.info.width, decoded.info.height, settings, palette);
  const preview = makePreview(result.grid, palette);
  const previewWidth = gridWidth * previewScale;
  const previewHeight = gridHeight * previewScale;
  const totalCells = gridWidth * gridHeight;
  const codeById = new Map(palette.map((color) => [color.id, color.code]));
  const counts = new Map();
  let transparentCells = 0;

  for (const row of result.grid) {
    for (const id of row) {
      if (id === null) {
        transparentCells += 1;
        continue;
      }
      const code = codeById.get(id);
      if (code) counts.set(code, (counts.get(code) ?? 0) + 1);
    }
  }

  await mkdir(artifactsDirectory, { recursive: true });
  await sharp(preview, { raw: { width: previewWidth, height: previewHeight, channels: 4 } }).png().toFile(previewPath);
  const sourceThumbnail = await sharp(inputPath)
    .resize({ width: previewWidth, height: previewHeight, fit: 'cover', position: 'centre' })
    .png()
    .toBuffer();
  await sharp({
    create: { width: previewWidth * 2, height: previewHeight, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
  })
    .composite([
      { input: sourceThumbnail, left: 0, top: 0 },
      { input: preview, raw: { width: previewWidth, height: previewHeight, channels: 4 }, left: previewWidth, top: 0 },
    ])
    .png()
    .toFile(comparisonPath);

  const darkCodes = ['M37', 'M40', 'M41'];
  const brightCodes = ['M01', 'M03', 'M04', 'M11', 'M12', 'M32', 'M33'];
  const individualDark = Object.fromEntries(darkCodes.map((code) => [code, ratio(counts.get(code) ?? 0, totalCells)]));
  const report = {
    detectedPipeline: result.diagnostics.detectedPipeline,
    effectivePipeline: result.diagnostics.pipeline,
    effectiveColorCount: result.diagnostics.effectiveColorCount,
    meanSourceLightness: decimal(result.diagnostics.meanSourceLightness),
    meanMatchedLightness: decimal(result.diagnostics.meanMatchedLightness),
    lightnessBias: decimal(result.diagnostics.lightnessBias),
    meanDeltaE: decimal(result.diagnostics.meanDeltaE),
    transparentRatio: ratio(transparentCells, totalCells),
    darkColorRatios: {
      ...individualDark,
      combined: decimal(darkCodes.reduce((sum, code) => sum + individualDark[code], 0)),
    },
    brightColorRatio: decimal(brightCodes.reduce((sum, code) => sum + ratio(counts.get(code) ?? 0, totalCells), 0)),
    previewPath,
    comparisonPath,
  };
  console.log(JSON.stringify(report, null, 2));

  const failures = [];
  if (result.diagnostics.pipeline !== 'photo') failures.push('Auto pipeline must classify the Anya JPEG as photo.');
  if (Math.abs(result.diagnostics.lightnessBias) > 8) failures.push('Absolute lightnessBias must be at most 8.');
  if (transparentCells / totalCells > 0.05) failures.push('Transparent grid-cell ratio must be at most 0.05 for this complete scene.');
  if (report.darkColorRatios.combined > 0.35) failures.push('M37/M40/M41 combined ratio must be at most 0.35.');
  if (failures.length > 0) {
    console.error(`Image regression failed:\n- ${failures.join('\n- ')}`);
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
