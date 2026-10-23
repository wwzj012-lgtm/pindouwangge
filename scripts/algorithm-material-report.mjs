import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { createServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = path.join(root, 'artifacts');
const gridWidth = 48;
const gridHeight = 48;

const baseSettings = {
  width: gridWidth,
  height: gridHeight,
  keepAspectRatio: false,
  brand: 'MARD',
  colorLimit: 0,
  brightness: 0,
  contrast: 0,
  saturation: 0,
  transparentCutoff: 16,
  boardSize: 29,
  colorMatchAlgo: 'ciede2000',
  sharpening: 0,
  outlineBoost: false,
  chromaKeyColor: null,
  chromaKeyTolerance: 20,
  backgroundRemovalEnabled: false,
};

const modes = {
  cartoon: {
    label: '卡通模式',
    settings: { ...baseSettings, pipelineOverride: 'cartoon', dither: 'none', sharpening: 25, outlineBoost: true },
    suitability: '适合Q版插画、表情包和大色块卡通图；优先保持轮廓，抑制细碎噪点。',
  },
  photo: {
    label: '照片模式',
    settings: { ...baseSettings, pipelineOverride: 'photo', dither: 'floyd', ditherStrength: 0.65, sharpening: 15 },
    suitability: '适合人像、风景和连续色调；用Lab匹配与误差扩散保留明暗层次。',
  },
  logo: {
    label: 'Logo文字模式',
    settings: { ...baseSettings, pipelineOverride: 'logo', dither: 'none', sharpening: 55, outlineBoost: true },
    suitability: '适合Logo、文字和图标；关闭抖动并保护边缘，避免文字出现杂点。',
  },
};

async function decodeImage(input) {
  const decoded = await sharp(input).ensureAlpha().resize({ width: 128, height: 128, fit: 'cover' }).raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8ClampedArray(decoded.data.buffer, decoded.data.byteOffset, decoded.data.byteLength), width: decoded.info.width, height: decoded.info.height };
}

function synthetic(width, height, painter) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = painter(x, y);
      data.set([r, g, b, 255], (y * width + x) * 4);
    }
  }
  return { data, width, height };
}

const syntheticMaterials = {
  'logo-noisy-background': synthetic(64, 64, (x, y) => {
    const isLetter = x > 18 && x < 46 && (y < 14 || y > 49 || x < 25 || (x > 38 && y > 27));
    const noise = (x * 17 + y * 31) % 7;
    return isLetter ? [24, 24, 28] : [245 - noise, 245 - noise, 240 - noise];
  }),
  'photo-with-text': synthetic(64, 64, (x, y) => {
    const gradient = Math.round(35 + (x / 63) * 170 + (y / 63) * 25);
    const text = y > 25 && y < 34 && x > 8 && x < 56 && x % 5 < 3;
    return text ? [18, 20, 28] : [gradient, Math.min(255, gradient + 18), Math.min(255, gradient + 35)];
  }),
  'cartoon-soft-gradient': synthetic(64, 64, (x, y) => {
    const body = x > 12 && x < 52 && y > 10 && y < 54;
    if (!body) return [250, 250, 250];
    const shade = Math.round((x + y) / 8);
    return [240, 110 + shade, 130 + Math.min(20, shade)];
  }),
};

function gridMetrics(grid) {
  const cells = grid.length * (grid[0]?.length ?? 0);
  const filled = grid.flat().filter(Boolean).length;
  const ids = new Set(grid.flat().filter(Boolean));
  let transitions = 0;
  let comparisons = 0;
  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < (grid[y]?.length ?? 0); x += 1) {
      if (x + 1 < grid[y].length) {
        comparisons += 1;
        if (grid[y][x] !== grid[y][x + 1]) transitions += 1;
      }
      if (y + 1 < grid.length) {
        comparisons += 1;
        if (grid[y][x] !== grid[y + 1][x]) transitions += 1;
      }
    }
  }
  return {
    effectiveColorCount: ids.size,
    filledRatio: Number((filled / Math.max(1, cells)).toFixed(4)),
    edgeTransitionRatio: Number((transitions / Math.max(1, comparisons)).toFixed(4)),
  };
}

async function run() {
  const vite = await createServer({ configFile: false, root, optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, hmr: false, watch: null }, appType: 'custom' });
  let convertImageDataToGrid;
  let palette;
  try {
    ({ convertImageDataToGrid } = await vite.ssrLoadModule('/src/utils/imagePipeline.ts'));
    ({ MARD_PALETTE: palette } = await vite.ssrLoadModule('/src/data/palettes.ts'));
  } finally {
    await vite.close();
  }

  const assets = [
    ['八条猫', path.join(root, 'public/images/batiao-cat.webp'), 'cartoon'],
    ['霸总小新', path.join(root, 'public/images/boss-xiaoxin.jpg'), 'cartoon'],
    ['蜘蛛侠', path.join(root, 'public/images/spiderman.webp'), 'photo'],
    ['Q版人物', path.join(root, 'public/images/chibi-character.jpg'), 'cartoon'],
    ...Object.entries(syntheticMaterials).map(([name, material]) => [name, material, name.startsWith('logo') ? 'logo' : name.startsWith('photo') ? 'photo' : 'cartoon']),
  ];
  const results = [];
  for (const [name, input, recommended] of assets) {
    const source = typeof input === 'string' ? await decodeImage(input) : input;
    for (const [mode, config] of Object.entries(modes)) {
      const result = convertImageDataToGrid(source.data, source.width, source.height, config.settings, palette);
      results.push({
        material: name,
        mode,
        recommended: mode === recommended,
        detectedPipeline: result.diagnostics.detectedPipeline,
        effectivePipeline: result.diagnostics.pipeline,
        meanDeltaE: Number(result.diagnostics.meanDeltaE.toFixed(4)),
        lightnessBias: Number(result.diagnostics.lightnessBias.toFixed(4)),
        ...gridMetrics(result.grid),
      });
    }
  }
  const report = {
    generatedAt: new Date().toISOString(),
    grid: { width: gridWidth, height: gridHeight },
    modes: Object.fromEntries(Object.entries(modes).map(([key, value]) => [key, { label: value.label, suitability: value.suitability }])),
    results,
  };
  try {
    await mkdir(artifacts, { recursive: true });
    await writeFile(path.join(artifacts, 'algorithm-material-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  } catch (error) {
    console.warn(`Unable to persist report file; JSON is still printed below: ${error instanceof Error ? error.message : String(error)}`);
  }
  console.log(JSON.stringify(report, null, 2));
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
