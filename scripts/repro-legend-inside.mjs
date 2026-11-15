// 复现：用户把识别区域框到包含图例条时 parseLegend 的行为（UI 报 noLegendBand）
// + 用户框选图例区域（三种版式）+ 边缘回退带
import { createServer } from 'vite';
import sharp from 'sharp';

const vite = await createServer({ root: process.cwd(), appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const { parseLegend, debugLegendLocation } = await vite.ssrLoadModule('/src/utils/importLegend.ts');
const { BRAND_PALETTES } = await vite.ssrLoadModule('/src/data/palettes.ts');

async function load(path) {
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
}

const WB = { originX: 276, originY: 116, cellWidth: 8.79, cellHeight: 8.79, columns: 101, rows: 132 };
const YAO = { originX: 25, originY: 51, cellWidth: 12.5, cellHeight: 12.5, columns: 101, rows: 132 };
const PNG = { originX: 35, originY: 57, cellWidth: 25.75, cellHeight: 25.6, columns: 101, rows: 132 };

const cases = [
  { name: 'A1 water-box 真值标定（回归）', img: 'benchmark/images/water-box.jpg', cal: WB },
  { name: 'A2 water-box 区域框全图 rows=150（用户场景）', img: 'benchmark/images/water-box.jpg', cal: { ...WB, rows: 150 } },
  { name: 'A3 water-box 区域框全图 rows=150+cols=132', img: 'benchmark/images/water-box.jpg', cal: { ...WB, rows: 150, columns: 132 } },
  { name: 'A4 water-box 框选底部条带', img: 'benchmark/images/water-box.jpg', cal: WB, region: { x0: 0, y0: 1270, x1: 1439, y1: 1439 } },
  { name: 'B1 yao 真值标定（回归）', img: 'benchmark/images/yao-dalugou.jpg', cal: YAO },
  { name: 'B2 yao 区域框全图 rows=150+cols=113', img: 'benchmark/images/yao-dalugou.jpg', cal: { ...YAO, rows: 150, columns: 113 } },
  { name: 'B3 yao 框选右侧竖列', img: 'benchmark/images/yao-dalugou.jpg', cal: YAO, region: { x0: 1285, y0: 0, x1: 1439, y1: 1439 } },
  { name: 'C1 PNG 真值标定（右上面板，无框选）', img: 'C:/Users/Plout/Downloads/瑶_完整图纸.png', cal: PNG },
  { name: 'C2 PNG 框选右上面板', img: 'C:/Users/Plout/Downloads/瑶_完整图纸.png', cal: PNG, region: { x0: 2620, y0: 0, x1: 3179, y1: 560 } },
  { name: 'C3 PNG 区域框全图（rows/cols 全包）', img: 'C:/Users/Plout/Downloads/瑶_完整图纸.png', cal: { ...PNG, rows: 135, columns: 122 } },
];

for (const c of cases) {
  const source = await load(c.img);
  const result = parseLegend(source, c.cal, BRAND_PALETTES.MARD, { gridRows: c.cal.rows, gridCols: c.cal.columns, region: c.region });
  const loc = (debugLegendLocation() ?? []).map(l => `${l.region}${l.anchored ? '*' : ''}:${l.lines}行/${l.rawEntries}条`).join('  ');
  let detail = '';
  if (result.ok) {
    const codes = result.entries.map(e => e.code).join(',');
    const counts = result.entries.map(e => e.count).join(',');
    detail = `ok ${result.entries.length}条\n  色号: ${codes}\n  粒数: ${counts}`;
  } else detail = `fail=${result.failureReason}`;
  console.log(`${c.name}\n  候选: ${loc || '(无)'}\n  ${detail}`);
}
await vite.close();
