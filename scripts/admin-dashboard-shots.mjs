/**
 * 仪表盘视觉验收截图（离线、无网络请求）。
 *
 * 做法：esbuild 把真实组件（DashboardView + 各区块 + recharts 懒加载）打成 IIFE，
 * 内联真实 admin.css，用 playwright-core 驱动本机 Chrome：
 * - 等图表真正挂载（.recharts-surface 出现且已布局）后截图，避免截到骨架屏；
 * - tooltip 用真实鼠标 hover（recharts 的 mousemove 路径），峰值/首日/末日三点；
 * - 同时断言 tooltip 不溢出卡片、pointer-events:none。
 *
 * 用法：node scripts/admin-dashboard-shots.mjs [输出目录]
 * 默认输出：C:/Users/Plout/Desktop/pindouwangge
 */
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const { build } = createRequire(require.resolve('vite'))('esbuild');

const outDir = resolve(process.argv[2] ?? 'C:/Users/Plout/Desktop/pindouwangge');
const browserPath = process.env.ADMIN_DASH_BROWSER ?? [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(existsSync);
if (!browserPath) throw new Error('no Chrome/Edge binary found');

const adminCss = readFileSync(join(projectRoot, 'src/components/admin/admin.css'), 'utf8');
const working = mkdtempSync(join(tmpdir(), 'admin-dash-shots-'));
mkdirSync(outDir, { recursive: true });

const bundle = await build({
  absWorkingDir: projectRoot,
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'iife',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"development"' },
  entryPoints: [join(projectRoot, 'scripts/admin-dashboard-shot-fixture.tsx')],
  plugins: [{ name: 'inline-component-css', setup(builder) { builder.onLoad({ filter: /\.css$/ }, () => ({ contents: '', loader: 'text' })); } }],
});
const script = bundle.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const pageUrl = pathToFileURL(join(working, 'dashboard.html')).href;
writeFileSync(join(working, 'dashboard.html'), `<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0;background:#f8fafc}
${adminCss}</style>
<body><div id="root"></div><script>${script}</script></body></html>`);

const browser = await chromium.launch({
  executablePath: browserPath,
  args: ['--force-prefers-reduced-motion', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--host-resolver-rules=MAP * ~NOTFOUND', '--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=<-loopback>'],
});
const evidence = {};
try {
  const open = async (width, height, query) => {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.goto(pageUrl + query, { waitUntil: 'load' });
    await page.waitForSelector('.recharts-surface', { timeout: 20000 });
    await page.waitForFunction(() => {
      const svg = document.querySelector('.recharts-surface');
      return Boolean(svg && svg.getBoundingClientRect().width > 100);
    }, { timeout: 20000 });
    await page.waitForTimeout(150);
    return { context, page, errors };
  };

  const shots = [
    { name: '.tmp-admin-dash-desktop-1440.png', width: 1440, height: 1320, query: '?range=7' },
    { name: '.tmp-admin-dash-range-30.png', width: 1440, height: 1320, query: '?range=30' },
    { name: '.tmp-admin-dash-mobile-390.png', width: 390, height: 1600, query: '?range=7' },
  ];
  for (const shot of shots) {
    const { context, page, errors } = await open(shot.width, shot.height, shot.query);
    await page.screenshot({ path: resolve(outDir, shot.name), fullPage: true });
    evidence[shot.name] = { width: shot.width, height: shot.height, query: shot.query, errors };
    if (errors.length) throw new Error('browser errors in ' + shot.name + ': ' + errors.join('; '));
    await context.close();
    console.log('shot', shot.name, shot.width + 'x' + shot.height);
  }

  // tooltip 三点：真实 hover 首日 / 峰值日 / 末日。
  const { context, page, errors } = await open(1440, 980, '?range=7');
  const geometry = await page.evaluate(() => {
    const bars = Array.from(document.querySelectorAll('.recharts-bar-rectangle')).map(element => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y, height: rect.height, bottom: rect.y + rect.height };
    });
    const surface = document.querySelector('.recharts-surface').getBoundingClientRect();
    return { bars, surface: { x: surface.x, y: surface.y, width: surface.width, height: surface.height }, peakDate: window.__dashPeakDate };
  });
  if (geometry.bars.length < 7) throw new Error('expected at least 7 bars, got ' + geometry.bars.length);
  const tallest = geometry.bars.reduce((best, bar) => (bar.height > best.height ? bar : best), geometry.bars[0]);
  const targets = {
    first: { x: geometry.bars[0].x, y: geometry.bars[0].bottom - 6 },
    peak: { x: tallest.x, y: tallest.bottom - 6 },
    last: { x: geometry.bars[geometry.bars.length - 1].x, y: geometry.bars[geometry.bars.length - 1].bottom - 6 },
  };
  const tipEvidence = {};
  for (const [name, point] of Object.entries(targets)) {
    await page.mouse.move(point.x, point.y);
    await page.waitForTimeout(120);
    const tip = await page.evaluate(() => {
      const element = document.querySelector('[data-dash-tooltip]');
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      const card = element.closest('.admin-dash-panel').getBoundingClientRect();
      return {
        placement: element.getAttribute('data-placement'),
        text: (element.textContent ?? '').trim(),
        insideCard: rect.left >= card.left - 1 && rect.right <= card.right + 1 && rect.top >= card.top - 1 && rect.bottom <= card.bottom + 1,
        pointerEvents: getComputedStyle(element).pointerEvents,
      };
    });
    if (!tip) throw new Error('tooltip not rendered for ' + name);
    if (!tip.insideCard) throw new Error('tooltip overflows its card for ' + name + ' ' + JSON.stringify(tip));
    if (tip.pointerEvents !== 'none') throw new Error('tooltip must not intercept the pointer');
    if (name === 'peak') {
      const [month, day] = geometry.peakDate.slice(5).split('-').map(Number);
      const expected = month + '月' + day + '日';
      if (!tip.text.includes(expected)) throw new Error('peak tooltip expected ' + expected + ', got ' + tip.text);
    }
    tipEvidence[name] = tip;
    await page.screenshot({ path: resolve(outDir, `.tmp-admin-dash-tooltip-${name}.png`) });
    console.log('shot tooltip', name, tip.placement, '->', tip.text.replace(/\s+/g, ' '));
  }
  // C 区两张卡单独出图（30 天），用于目检流失行/结论行与错误率+耗时双线。
  const wide = await open(1440, 1400, '?range=30');
  for (const [file, selector] of [
    ['.tmp-admin-dash-funnel.png', '[data-dashboard-funnel]'],
    ['.tmp-admin-dash-quality.png', '[data-dashboard-quality]'],
  ]) {
    const panel = wide.page.locator(selector).first();
    await panel.scrollIntoViewIfNeeded();
    await panel.screenshot({ path: resolve(outDir, file) });
    console.log('shot panel', file);
  }
  await wide.context.close();

  evidence.tooltips = tipEvidence;
  evidence.peakDate = geometry.peakDate;
  evidence.bars = geometry.bars.length;
  evidence.errors = errors;
  await context.close();
  writeFileSync(resolve(outDir, '.tmp-admin-dash-evidence.json'), JSON.stringify(evidence, null, 2));
} finally {
  await browser.close();
  if (dirname(working) !== resolve(tmpdir()) || !basename(working).startsWith('admin-dash-shots-')) {
    throw new Error('unexpected temp dir ' + working);
  }
  rmSync(working, { recursive: true, force: true });
}
console.log('done ->', outDir);
