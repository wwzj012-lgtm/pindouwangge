import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { MARD_PALETTE } from '../../src/data/palettes';
import { deltaE2000, preparePaletteLab, rgbToLab } from '../../src/utils/colorUtils';
import { estimateBeadPitch } from '../../src/utils/importGridPitch';
import {
  recognizeImportImage,
  type ImportImagePixels,
  type ImportRecognitionOptions,
  type ImportRecognitionResult,
} from '../../src/utils/importRecognition';

const SOURCE = process.env.LAB_IMAGE ?? 'C:/Users/Plout/Pictures/12.jpg';
const OUT = path.resolve('.workbuddy/lab/out');

async function loadImage(file: string): Promise<ImportImagePixels> {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8ClampedArray(data), width: info.width, height: info.height };
}

/** 逐格面积平均（真值参考），与识别无关。 */
function cellMeans(source: ImportImagePixels, cal: { originX: number; originY: number; cellWidth: number; cellHeight: number; rows: number; columns: number }) {
  const out: [number, number, number][][] = [];
  const { data, width, height } = source;
  for (let row = 0; row < cal.rows; row += 1) {
    const line: [number, number, number][] = [];
    for (let column = 0; column < cal.columns; column += 1) {
      const left = Math.max(0, Math.floor(cal.originX + column * cal.cellWidth));
      const right = Math.min(width, Math.floor(cal.originX + (column + 1) * cal.cellWidth));
      const top = Math.max(0, Math.floor(cal.originY + row * cal.cellHeight));
      const bottom = Math.min(height, Math.floor(cal.originY + (row + 1) * cal.cellHeight));
      let r = 0, g = 0, b = 0, n = 0;
      for (let y = top; y < bottom; y += 1) {
        for (let x = left; x < right; x += 1) {
          const i = (y * width + x) * 4;
          r += data[i]; g += data[i + 1]; b += data[i + 2]; n += 1;
        }
      }
      line.push(n ? [r / n, g / n, b / n] : [0, 0, 0]);
    }
    out.push(line);
  }
  return out;
}

function cellRgb(result: ImportRecognitionResult) {
  return result.cells.map(row => row.map(cell => (cell.color ? cell.color.rgb : null)));
}

function render(colors: ([number, number, number] | null)[][], scale: number, file: string) {
  const rows = colors.length;
  const columns = colors[0].length;
  const buf = Buffer.alloc(columns * scale * rows * scale * 3);
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < columns; c += 1) {
      const rgb = colors[r][c] ?? [255, 255, 255];
      for (let dy = 0; dy < scale; dy += 1) {
        for (let dx = 0; dx < scale; dx += 1) {
          const i = (((r * scale + dy) * columns * scale) + c * scale + dx) * 3;
          buf[i] = rgb[0]; buf[i + 1] = rgb[1]; buf[i + 2] = rgb[2];
        }
      }
    }
  }
  return sharp(buf, { raw: { width: columns * scale, height: rows * scale, channels: 3 } }).png().toFile(file);
}

interface Metrics {
  meanDE: number;
  speckle: number;
  isolated: number;
  blocks2x2: number;
  detailCorr: number;
  distinctColors: number;
  lowConfidence: number;
}

function measure(result: ImportRecognitionResult, truth: [number, number, number][][]): Metrics {
  const colors = cellRgb(result);
  const rows = colors.length;
  const columns = colors[0].length;
  const truthLab = truth.map(row => row.map(rgb => rgbToLab(...rgb)));
  let de = 0, deCount = 0;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < columns; c += 1) {
      const rgb = colors[r][c];
      if (!rgb) continue;
      de += deltaE2000(rgbToLab(...rgb), truthLab[r][c]);
      deCount += 1;
    }
  }
  const same = (a: [number, number, number] | null, b: [number, number, number] | null) => {
    if (!a || !b) return a === b;
    return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) <= 6;
  };
  let speckle = 0, isolated = 0, counted = 0;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < columns; c += 1) {
      const self = colors[r][c];
      if (!self) continue;
      counted += 1;
      const neighbours = [colors[r - 1]?.[c], colors[r + 1]?.[c], colors[r]?.[c - 1], colors[r]?.[c + 1]].filter(v => v !== undefined);
      const differs = neighbours.filter(v => !same(self, v ?? null)).length;
      if (differs >= 3) speckle += 1;
      if (differs === neighbours.length) isolated += 1;
    }
  }
  let blocks = 0, blockTotal = 0;
  for (let r = 0; r + 1 < rows; r += 1) {
    for (let c = 0; c + 1 < columns; c += 1) {
      blockTotal += 1;
      const a = colors[r][c];
      if (a && same(a, colors[r][c + 1]) && same(a, colors[r + 1][c]) && same(a, colors[r + 1][c + 1])) blocks += 1;
    }
  }
  // 细节保留：高一频能量与真值的高通相关性
  const hp = (field: number[][]) => field.map((row, r) => row.map((v, c) => {
    let sum = 0, n = 0;
    for (let dr = -2; dr <= 2; dr += 1) for (let dc = -2; dc <= 2; dc += 1) {
      const value = field[r + dr]?.[c + dc];
      if (value === undefined) continue;
      sum += value; n += 1;
    }
    return v - sum / n;
  }));
  const lumaOf = (colorsField: ([number, number, number] | null)[][]) =>
    colorsField.map(row => row.map(rgb => (rgb ? 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2] : 0)));
  const hpOut = hp(lumaOf(colors)).flat();
  const hpTruth = hp(lumaOf(truth)).flat();
  const meanA = hpOut.reduce((a, b) => a + b, 0) / hpOut.length;
  const meanB = hpTruth.reduce((a, b) => a + b, 0) / hpTruth.length;
  let cov = 0, varA = 0, varB = 0;
  for (let i = 0; i < hpOut.length; i += 1) {
    const a = hpOut[i] - meanA; const b = hpTruth[i] - meanB;
    cov += a * b; varA += a * a; varB += b * b;
  }
  return {
    meanDE: de / Math.max(1, deCount),
    speckle: speckle / Math.max(1, counted) * 100,
    isolated: isolated / Math.max(1, counted) * 100,
    blocks2x2: blocks / Math.max(1, blockTotal) * 100,
    detailCorr: cov / Math.sqrt(Math.max(1e-9, varA * varB)),
    distinctColors: result.summary.distinctColors,
    lowConfidence: result.summary.lowConfidence,
  };
}

describe('recognition lab', () => {
  it('baseline vs tuned', async () => {
    if (!fs.existsSync(SOURCE)) {
      console.log('skip: no source image');
      return;
    }
    fs.mkdirSync(OUT, { recursive: true });
    const source = await loadImage(SOURCE);
    const pitch = estimateBeadPitch(source);
    console.log('pitch', pitch);
    const cell = pitch?.cellX ?? 9;
    const cellY = pitch?.cellY ?? 9;
    const columns = Math.round(source.width / cell);
    const rows = Math.round(source.height / cellY);
    const cal = {
      originX: (source.width - columns * cell) / 2,
      originY: (source.height - rows * cellY) / 2,
      cellWidth: cell,
      cellHeight: cellY,
      columns,
      rows,
    };
    console.log('calibration', cal);
    const truth = cellMeans(source, cal);
    await render(truth.map(row => row.map(rgb => rgb.map(v => Math.round(v)) as [number, number, number])), 6, `${OUT}/truth.png`);

    const runs: Array<{ name: string; options: ImportRecognitionOptions }> = [
      { name: '01-plain', options: {} },
      { name: '02-bead', options: { beadPhoto: true } },
      { name: '03-bead-smooth', options: { beadPhoto: true, smooth: true } },
      { name: '04-bead-twin', options: { beadPhoto: true, unifyTwins: true } },
      { name: '05-bead-smooth-twin', options: { beadPhoto: true, smooth: true, unifyTwins: true } },
    ];

    const report: Record<string, Metrics> = {};
    for (const run of runs) {
      const started = Date.now();
      const result = recognizeImportImage(source, cal, MARD_PALETTE, 'precision', 24, run.options);
      report[run.name] = measure(result, truth);
      console.log(run.name, (Date.now() - started) + 'ms', JSON.stringify(report[run.name], (key, value) =>
        typeof value === 'number' ? Math.round(value * 100) / 100 : value));
      await render(cellRgb(result), 6, `${OUT}/${run.name}.png`);
    }
    fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
    expect(report['01-plain']).toBeDefined();
  });
});
