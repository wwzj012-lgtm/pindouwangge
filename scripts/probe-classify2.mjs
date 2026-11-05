// 复制 classifyImageColors 内部逻辑，打印全部判定指标
import { createServer } from 'vite';
import sharp from 'sharp';
const vite = await createServer({ root: process.cwd(), appType: 'custom', server: { middlewareMode: true }, logLevel: 'error', optimizeDeps: { noDiscovery: true }, configFile: 'vite.config.ts' });
const { rgbToLab, deltaE76 } = await vite.ssrLoadModule('/src/utils/imagePipeline.ts');
const MAX_ANALYSIS_SAMPLES = 4096, COLOR_CLUSTER_DELTA_E = 7;
for (const img of ['benchmark/images/spongebob-patrick.jpg', 'benchmark/images/street-boy.jpg']) {
  const { data, info } = await sharp(img).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height;
  const stride = Math.max(1, Math.floor(Math.sqrt(W * H / MAX_ANALYSIS_SAMPLES)));
  const clusters = [];
  let sampled = 0;
  for (let y = 0; y < H; y += stride) for (let x = 0; x < W; x += stride) {
    const o = (y * W + x) * 4;
    if (data[o + 3] < 128) continue;
    sampled++;
    const lab = rgbToLab([data[o], data[o+1], data[o+2]]);
    let nearest = -1, nd = Infinity;
    for (let i = 0; i < clusters.length; i++) { const d = deltaE76(lab, clusters[i].lab); if (d < nd) { nd = d; nearest = i; } }
    if (nearest >= 0 && nd <= COLOR_CLUSTER_DELTA_E) { const c = clusters[nearest]; c.lab = c.lab.map((v, k) => (v * (c.count - 1) + lab[k]) / c.count); c.count++; }
    else if (clusters.length < 64) clusters.push({ lab, count: 1 });
    else if (nearest >= 0) clusters[nearest].count++;
  }
  const significant = clusters.filter(c => c.count / Math.max(1, sampled) >= 0.003);
  const eff = significant.length;
  let flat = 0, strong = 0, darkOutline = 0, analysed = 0;
  for (let y = 0; y < H; y += stride) for (let x = 0; x < W; x += stride) {
    const o = (y * W + x) * 4;
    if (data[o + 3] < 128) continue;
    const lab = rgbToLab([data[o], data[o+1], data[o+2]]);
    let nb = 0, maxD = 0, maxL = 0;
    for (const [nx, ny] of [[x-1,y],[x+1,y],[x,y-1],[x,y+1]]) {
      if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
      const no = (ny * W + nx) * 4;
      if (data[no + 3] < 128) continue;
      const nl = rgbToLab([data[no], data[no+1], data[no+2]]);
      nb++; maxD = Math.max(maxD, deltaE76(lab, nl)); maxL = Math.max(maxL, Math.abs(lab[0] - nl[0]));
    }
    if (!nb) continue;
    analysed++;
    if (maxD <= 8) flat++;
    if (maxD >= 22) strong++;
    if (lab[0] <= 30 && maxL >= 28 && maxD >= 24) darkOutline++;
  }
  const flatRatio = flat / Math.max(1, analysed), strongRatio = strong / Math.max(1, analysed), darkRatio = darkOutline / Math.max(1, analysed);
  console.log(img.split('/').pop());
  console.log(`  effectiveColors=${eff} (需>5 且 <=32 ${eff <= 32 ? 'PASS' : 'FAIL'})`);
  console.log(`  flatRatio=${flatRatio.toFixed(3)} (需>=0.78 ${flatRatio >= 0.78 ? 'PASS' : 'FAIL'})`);
  console.log(`  strongEdgeRatio=${strongRatio.toFixed(3)} (需>=0.025 ${strongRatio >= 0.025 ? 'PASS' : 'FAIL'})`);
  console.log(`  darkOutlineRatio=${darkRatio.toFixed(4)} (需>=0.006 ${darkRatio >= 0.006 ? 'PASS' : 'FAIL'})`);
}
await vite.close();
