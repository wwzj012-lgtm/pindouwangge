/**
 * B11 下钻验收（离线、真实组件、真实导航语义）。
 *
 * 逐项点击待办卡 → 断言目标页首屏页签/筛选正确 → 截图；
 * 再验证「刷新仍生效」与「切页签后 preset 从 URL 消失」。
 * 附 brands 页 10px→11px 的排版回归（字号实测 + 无横向溢出）。
 *
 * 用法：node scripts/admin-drill-shots.mjs [输出目录]
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

const css = [
  readFileSync(join(projectRoot, 'src/components/admin/admin.css'), 'utf8'),
  readFileSync(join(projectRoot, 'src/components/admin/AdminCommunityPosts.css'), 'utf8'),
  readFileSync(join(projectRoot, 'src/components/admin/AdminCredits.css'), 'utf8'),
  readFileSync(join(projectRoot, 'src/components/admin/AdminBrandsColors.css'), 'utf8'),
].join('\n');

const working = mkdtempSync(join(tmpdir(), 'admin-drill-shots-'));
mkdirSync(outDir, { recursive: true });

const bundle = await build({
  absWorkingDir: projectRoot,
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'iife',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"development"' },
  entryPoints: [join(projectRoot, 'scripts/admin-drill-shot-fixture.tsx')],
  plugins: [{ name: 'inline-css', setup(builder) { builder.onLoad({ filter: /\.css$/ }, () => ({ contents: '', loader: 'text' })); } }],
});
const pageUrl = pathToFileURL(join(working, 'drill.html')).href;
writeFileSync(join(working, 'drill.html'), `<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0;background:#f8fafc}
${css}</style>
<body><div id="root"></div><script>${bundle.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script></body></html>`);

const browser = await chromium.launch({
  executablePath: browserPath,
  args: ['--force-prefers-reduced-motion', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--host-resolver-rules=MAP * ~NOTFOUND', '--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=<-loopback>'],
});
const evidence = {};
const check = (condition, label) => { if (!condition) throw new Error('check failed: ' + label); evidence[label] = 'ok'; };

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error)));

  const selectedTab = async () => page.evaluate(() => {
    const button = document.querySelector('[role="tab"][aria-selected="true"]');
    return button ? button.textContent.trim() : null;
  });
  // 状态下拉是「含 available 选项」的那个 select（页面上还有搜索/渠道等下拉）。
  const codesStatus = async () => page.evaluate(() => {
    const select = Array.from(document.querySelectorAll('select'))
      .find(element => Array.from(element.options).some(option => option.value === 'available'));
    return select ? select.value : null;
  });

  // 1) 待办条本身
  await page.goto(pageUrl + '?module=community', { waitUntil: 'load' });
  await page.waitForSelector('[data-dashboard-todo]');
  await page.screenshot({ path: resolve(outDir, '.tmp-admin-dd-todo.png') });
  evidence['todo cards'] = await page.evaluate(() => Array.from(document.querySelectorAll('[data-todo-value]')).map(el => el.getAttribute('data-todo-value') + '=' + el.textContent));

  // 2) 待处理举报 → 举报页签
  await page.click('[data-todo-card="reports"]');
  await page.waitForTimeout(150);
  check(new URL(page.url()).searchParams.get('preset') === 'reports', 'reports card writes preset=reports');
  check((await selectedTab()) === '举报', 'reports card opens 举报 tab first paint');
  await page.screenshot({ path: resolve(outDir, '.tmp-admin-dd-community-reports.png') });

  // 3) 刷新仍生效
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('[role="tab"][aria-selected="true"]');
  check((await selectedTab()) === '举报', 'reload keeps 举报 tab');
  await page.screenshot({ path: resolve(outDir, '.tmp-admin-dd-refresh-reports.png') });

  // 4) 用户自己切页签 → preset 从 URL 消失（刷新不再被劫持）
  await page.click('[role="tab"]:has-text("帖子列表")');
  await page.waitForTimeout(150);
  check(!new URL(page.url()).searchParams.has('preset'), 'switching tab clears preset from URL');
  check((await selectedTab()) === '帖子列表', 'switching tab actually switches');
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('[role="tab"][aria-selected="true"]');
  check((await selectedTab()) === '帖子列表', 'after clearing, reload stays on 帖子列表');

  // 5) 待审核帖子 → 审核队列
  await page.goto(pageUrl + '?module=community', { waitUntil: 'load' });
  await page.waitForSelector('[data-todo-card="reviews"]');
  await page.click('[data-todo-card="reviews"]');
  await page.waitForTimeout(150);
  check((await selectedTab()) === '审核队列', 'reviews card opens 审核队列 tab first paint');
  await page.screenshot({ path: resolve(outDir, '.tmp-admin-dd-community-queue.png') });

  // 6) 兑换码可用库存 → status=available
  await page.goto(pageUrl + '?module=codes', { waitUntil: 'load' });
  await page.waitForSelector('[data-todo-card="codes"]');
  await page.click('[data-todo-card="codes"]');
  await page.waitForTimeout(200);
  check((await codesStatus()) === 'available', 'codes card opens status=available filter first paint');
  await page.screenshot({ path: resolve(outDir, '.tmp-admin-dd-codes-low-stock.png') });

  // 7) brands 页字号/溢出回归（10px → 11px）
  await page.goto(pageUrl + '?module=brands', { waitUntil: 'load' });
  await page.waitForSelector('.admin-brand-layout');
  const brandCheck = await page.evaluate(() => {
    const selectors = ['.admin-brand-eyebrow', '.admin-brand-list small', '.admin-brand-series button small', '.admin-brand-color-copy'];
    const sizes = selectors.flatMap(selector => Array.from(document.querySelectorAll(selector)).map(el => ({
      selector, px: parseFloat(getComputedStyle(el).fontSize),
    })));
    return { sizes, docOverflow: document.documentElement.scrollWidth > window.innerWidth + 1 };
  });
  check(brandCheck.sizes.length > 0 && brandCheck.sizes.every(item => item.px >= 11), 'brands labels are >= 11px: ' + JSON.stringify(brandCheck.sizes));
  check(!brandCheck.docOverflow, 'brands page has no horizontal overflow');
  await page.screenshot({ path: resolve(outDir, '.tmp-admin-dd-brands.png') });

  check(pageErrors.length === 0, 'no page errors');
  await context.close();
  writeFileSync(resolve(outDir, '.tmp-admin-dd-evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await browser.close();
  if (dirname(working) !== resolve(tmpdir()) || !basename(working).startsWith('admin-drill-shots-')) throw new Error('unexpected temp dir ' + working);
  rmSync(working, { recursive: true, force: true });
}
console.log('done ->', outDir);
