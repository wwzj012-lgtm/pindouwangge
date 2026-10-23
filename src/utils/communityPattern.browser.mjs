// Real Chrome + isolated Vite; only auth and HTTP responses are mocked.
// Run: node src/utils/communityPattern.browser.mjs (120-second hard timeout).
// No production requests, fixture files, saved downloads, or product-code changes.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const require = createRequire('C:/Users/Plout/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json');
const { chromium } = require('./index.js');
const root = fileURLToPath(new URL('../../', import.meta.url));
const prefix = 'virtual:community-pattern-browser/';
const apiOrigin = 'http://community-api.test';
const harnessPath = '/__community-pattern-browser';

/** @type {import('./patternGridCodec').StoredPatternProject} */
const project = {
  version: 2, name: '52×26 原始图纸 · 相近色号与透明格',
  width: 52, height: 26, boardSize: 26, brand: 'MARD', createdAt: 1792713600000,
  settings: {
    width: 52, height: 26, keepAspectRatio: true, brand: 'MARD', dither: 'none', colorLimit: 0,
    brightness: 0, contrast: 0, saturation: 0, transparentCutoff: 128, boardSize: 26,
    colorMatchAlgo: 'ciede2000', sharpening: 0, outlineBoost: false,
    chromaKeyColor: null, chromaKeyTolerance: 0,
  },
  palette: [
    { id: 'light', code: 'A01', name: '近白一', hex: '#FAF9F8', rgb: [250, 249, 248], brand: 'MARD' },
    { id: 'similar', code: 'A02', name: '近白二', hex: '#FAF9F7', rgb: [250, 249, 247], brand: 'MARD' },
  ],
  grid: Array.from({ length: 26 }, (_, y) => Array.from({ length: 52 }, (_, x) => (x + y) % 3 === 0 ? null : x % 2 ? 'light' : 'similar')),
};

const posts = [
  { id: 'post_' + 'a'.repeat(32), assetId: 'asset_' + 'a'.repeat(32), title: '完整快照图纸 52×26' },
  { id: 'post_' + 'b'.repeat(32), assetId: 'asset_' + 'b'.repeat(32), title: '旧版图片 · 无原始快照' },
].map((post) => ({
  ...post, imageUrl: '/api/community/assets/public?id=' + post.assetId, workId: 'work_published_only',
  publishedAt: 1792713600000, author: { uid: 'fixture-author', displayName: '图纸作者', photoUrl: null },
  likeCount: 0, favoriteCount: 0, liked: false, favorited: false,
}));

const modules = {
  auth: "const visitor={uid:'fixture-visitor',displayName:'验证访客',authProvider:'password'};"
    + 'export const useAuth=()=>({currentUser:visitor,userProfile:visitor});',
  entry: [
    "import React from 'react';",
    "import {createRoot} from 'react-dom/client';",
    "import '/src/index.css';",
    "import {CommunityView} from '/src/components/CommunityView.tsx';",
    "import {renderCommunityPattern,readCommunitySnapshot} from '/src/utils/communityPatternSnapshot.ts';",
    'const project=' + JSON.stringify(project) + ';',
    'const png=await renderCommunityPattern(project);',
    'const snapshot=await readCommunitySnapshot(png);',
    'const bitmap=await createImageBitmap(png);',
    "const canvas=document.createElement('canvas');",
    'canvas.width=bitmap.width;canvas.height=bitmap.height;',
    "const context=canvas.getContext('2d',{willReadFrequently:true});",
    "if(!context)throw new Error('Chrome 2D canvas unavailable');",
    'context.drawImage(bitmap,0,0);bitmap.close();',
    'const pixels=context.getImageData(0,0,canvas.width,canvas.height).data;',
    'const scale=canvas.width/project.width;',
    'const colors=new Map(project.palette.map(color=>[color.id,color.rgb]));',
    'let transparentPixels=0;let opaquePixels=0;',
    'for(let y=0;y<canvas.height;y++){',
    '  for(let x=0;x<canvas.width;x++){',
    '    const id=project.grid[Math.floor(y/scale)][Math.floor(x/scale)];',
    '    const expected=id===null?[0,0,0,0]:[...colors.get(id),255];',
    '    const offset=(y*canvas.width+x)*4;',
    '    if(expected.some((value,index)=>pixels[offset+index]!==value))',
    "      throw new Error('Lossless PNG pixel mismatch at '+x+','+y+': '+Array.from(pixels.slice(offset,offset+4))+' != '+expected);",
    '    if(id===null)transparentPixels++;else opaquePixels++;',
    '  }',
    '}',
    // Decode/re-encode strips the snapshot chunk, producing a real image-only legacy PNG.
    "const legacy=await new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Legacy PNG failed')),'image/png'));",
    'async function base64(blob){',
    "  const bytes=new Uint8Array(await blob.arrayBuffer());let binary='';",
    '  for(let start=0;start<bytes.length;start+=0x8000)binary+=String.fromCharCode(...bytes.subarray(start,start+0x8000));',
    '  return btoa(binary);',
    '}',
    'window.communityHarness={project,snapshot,png:await base64(png),legacy:await base64(legacy),',
    '  legacySnapshot:await readCommunitySnapshot(legacy),',
    '  pixels:{width:canvas.width,height:canvas.height,scale,transparentPixels,opaquePixels},',
    '  remixes:[],navigationCount:0,authModalCount:0};',
    "createRoot(document.getElementById('root')).render(React.createElement(CommunityView,{",
    '  onRemixPattern:pattern=>window.communityHarness.remixes.push(structuredClone(pattern)),',
    '  onNavigateToStudio:()=>window.communityHarness.navigationCount++,',
    '  onOpenAuthModal:()=>window.communityHarness.authModalCount++,',
    '}));',
  ].join('\n'),
};

let server;
let browser;
let page;
let checks = 0;
const pageErrors = [];
const unexpectedRequests = [];
const requests = [];
const passed = (message) => { checks++; console.log('PASS ' + message); };
const deadline = setTimeout(() => {
  console.error('FAIL community browser verification exceeded 120 seconds');
  void browser?.close();
  void server?.close();
  process.exit(1);
}, 120_000);
deadline.unref();

try {
  server = await createServer({
    root, configFile: false, envDir: false, logLevel: 'error',
    define: { 'import.meta.env.VITE_WORKER_API_URL': JSON.stringify(apiOrigin) },
    plugins: [{
      name: 'isolated-community-pattern-browser', enforce: 'pre',
      resolveId(id, importer) {
        if (id.startsWith(prefix)) return '\0' + id;
        if (id === '../context/AuthContext' && importer?.includes('/src/components/')) return '\0' + prefix + 'auth';
      },
      load(id) {
        if (id.startsWith('\0' + prefix)) return modules[id.slice(prefix.length + 1)];
      },
      configureServer(vite) {
        vite.middlewares.use(async (request, response, next) => {
          if (request.url !== harnessPath) return next();
          try {
            const html = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">'
              + '<meta name="viewport" content="width=device-width,initial-scale=1"></head>'
              + '<body><div id="root"></div><script type="module" src="/@id/' + prefix + 'entry"></script></body></html>';
            response.setHeader('Content-Type', 'text/html; charset=utf-8');
            response.end(await vite.transformIndexHtml(harnessPath, html));
          } catch (error) { next(error); }
        });
      },
    }, react(), tailwindcss()],
    server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
  });
  await server.listen();
  const origin = 'http://127.0.0.1:' + server.httpServer.address().port;
  browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, timeout: 20_000,
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  page = await context.newPage();
  page.setDefaultTimeout(10_000);
  page.setDefaultNavigationTimeout(20_000);
  page.on('pageerror', (error) => pageErrors.push(error.message));
  let resolveAssets;
  const assetsReady = new Promise((resolve) => { resolveAssets = resolve; });
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/')) {
      requests.push({ method: request.method(), path: url.pathname, id: url.searchParams.get('id') });
      const headers = { 'Access-Control-Allow-Origin': origin, 'Cache-Control': 'no-store' };
      if (url.origin === apiOrigin && request.method() === 'GET') {
        if (url.pathname === '/api/community/posts') {
          return route.fulfill({ json: { success: true, data: { posts, nextCursor: null } }, headers });
        }
        if (url.pathname === '/api/community/posts/detail') {
          const post = posts.find((post) => post.id === url.searchParams.get('id'));
          if (post) return route.fulfill({ json: { success: true, data: { post } }, headers });
        }
        if (url.pathname === '/api/community/assets/public') {
          const assets = await assetsReady;
          const body = assets.get(url.searchParams.get('id'));
          if (body) return route.fulfill({ body, contentType: 'image/png', headers });
        }
      }
      unexpectedRequests.push(request.method() + ' ' + request.url());
      return route.fulfill({ status: 500, json: { success: false, message: 'Unexpected test API request' }, headers });
    }
    if (url.origin === origin) return route.continue();
    unexpectedRequests.push(request.method() + ' ' + request.url());
    return route.abort('blockedbyclient');
  });

  await page.goto(origin + harnessPath, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.communityHarness));
  const fixture = await page.evaluate(() => window.communityHarness);
  resolveAssets(new Map([
    [posts[0].assetId, Buffer.from(fixture.png, 'base64')],
    [posts[1].assetId, Buffer.from(fixture.legacy, 'base64')],
  ]));
  assert.deepEqual(fixture.project, project);
  assert.deepEqual(fixture.snapshot, project);
  assert.equal(fixture.legacySnapshot, null);
  const scale = Math.floor(900 / 52);
  const beadCount = project.grid.flat().filter((cell) => cell !== null).length;
  assert.deepEqual(fixture.pixels, {
    width: 52 * scale, height: 26 * scale, scale,
    transparentPixels: (52 * 26 - beadCount) * scale ** 2, opaquePixels: beadCount * scale ** 2,
  });
  passed('real PNG ' + fixture.pixels.width + '×' + fixture.pixels.height + ': every pixel has exact RGB/alpha; snapshot equals the 52×26 original');

  const viewButtons = page.getByRole('button', { name: '查看图纸', exact: true });
  await viewButtons.first().waitFor();
  assert.equal(await viewButtons.count(), 2);
  async function checkPreview(title, count) {
    const images = page.getByRole('img', { name: title, exact: true });
    assert.equal(await images.count(), count);
    for (const image of await images.all()) {
      await image.evaluate(async (element) => { await element.decode(); });
      assert.equal(await image.evaluate((element) => getComputedStyle(element).objectFit), 'contain');
      assert.equal(await image.evaluate((element) => getComputedStyle(element).imageRendering), 'pixelated');
      assert.equal(await image.evaluate((element) => element.naturalWidth / element.naturalHeight), 2);
    }
  }
  await checkPreview(posts[0].title, 1);
  await viewButtons.first().click();
  const load = page.getByRole('button', { name: '载入完整图纸', exact: true });
  await page.waitForFunction(() => Array.from(document.querySelectorAll('button'))
    .some((button) => button.textContent.trim() === '载入完整图纸' && !button.disabled));
  await checkPreview(posts[0].title, 2);
  assert.match(await page.locator('body').innerText(), /52 × 26 格.*2 种颜色/);
  await page.getByRole('button', { name: '查看与实操', exact: true }).click();
  await page.locator('.community-workspace[open]').waitFor();
  await page.getByRole('button', { name: '开始计时', exact: true }).waitFor();
  assert.equal(await page.locator('.community-pattern-canvas__surface').count(), 1);
  assert.deepEqual(await page.evaluate(() => window.communityHarness.remixes), []);
  if (process.env.COMMUNITY_PATTERN_EVIDENCE) await page.screenshot({ path: process.env.COMMUNITY_PATTERN_EVIDENCE + '/readonly-desktop.png', animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => document.querySelector('.community-workspace').clientWidth === 390);
  const mobileViewer = await page.locator('.community-workspace').evaluate(dialog => {
    const area = dialog.querySelector('.community-workspace__canvas').getBoundingClientRect();
    const viewport = dialog.querySelector('.community-pattern-canvas__viewport').getBoundingClientRect();
    return { width: dialog.scrollWidth, areaBottom: area.bottom, viewportBottom: viewport.bottom, viewportHeight: viewport.height };
  });
  assert.equal(mobileViewer.width, 390);
  assert.ok(mobileViewer.viewportHeight > 60 && mobileViewer.viewportBottom <= mobileViewer.areaBottom + 1, JSON.stringify(mobileViewer));
  if (process.env.COMMUNITY_PATTERN_EVIDENCE) await page.screenshot({ path: process.env.COMMUNITY_PATTERN_EVIDENCE + '/readonly-mobile.png', animations: 'disabled' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: '关闭只读图纸', exact: true }).click();
  assert.equal(await page.locator('.community-workspace').count(), 0);
  passed('read-only practice opens the full original with timer and a separate canvas, then closes without importing an editor draft');
  await load.click();
  const [remix] = await page.evaluate(() => window.communityHarness.remixes);
  assert.deepEqual(remix.project, project);
  assert.equal(remix.width, 52);
  assert.equal(remix.height, 26);
  assert.equal(remix.colorCount, 2);
  assert.equal(remix.boardCount, 2);
  assert.equal(remix.beadCount, beadCount);
  assert.equal(remix.id, posts[0].id);
  passed('real list/detail API envelopes → 查看图纸 → 载入完整图纸: onRemixPattern preserves every field, null cell and both similar color IDs');
  passed('card and detail previews use actual object-fit: contain and pixelated rendering');

  // Accepting an editor import now closes the detail; reopen it for viewport QA.
  assert.equal(await page.getByRole('button', { name: '查看与实操', exact: true }).count(), 0);
  await viewButtons.first().click();
  await page.waitForFunction(() => Array.from(document.querySelectorAll('button'))
    .some((button) => button.textContent.trim() === '载入完整图纸' && !button.disabled));

  async function noHorizontalOverflow(label) {
    const bounds = await page.evaluate(() => {
      const root = document.getElementById('root');
      const modal = document.querySelector('.fixed.inset-0.z-50 > div');
      return {
        viewport: window.innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth,
        root: root.scrollWidth, rootWidth: root.clientWidth,
        modal: modal ? { scroll: modal.scrollWidth, width: modal.clientWidth, left: modal.getBoundingClientRect().left, right: modal.getBoundingClientRect().right } : null,
      };
    });
    assert.equal(bounds.viewport, 390);
    assert.ok(bounds.document <= 390 && bounds.body <= 390 && bounds.root <= bounds.rootWidth, label + ': ' + JSON.stringify(bounds));
    if (bounds.modal) {
      assert.ok(bounds.modal.scroll <= bounds.modal.width && bounds.modal.left >= 0 && bounds.modal.right <= 390, label + ': ' + JSON.stringify(bounds));
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await noHorizontalOverflow('snapshot detail');
  await checkPreview(posts[0].title, 2);
  const close = page.getByRole('button', { name: '✕', exact: true });
  await close.scrollIntoViewIfNeeded();
  const closeHit = await close.evaluate((button) => {
    const rect = button.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return { clickable: button.contains(hit), interceptingTag: hit?.tagName, interceptingAlt: hit?.getAttribute('alt') };
  });
  assert.ok(closeHit.clickable, '390px detail close button must not be covered: ' + JSON.stringify(closeHit));
  await close.click();
  await page.getByRole('heading', { name: posts[0].title, exact: true, level: 2 }).waitFor({ state: 'detached' });
  passed('390px detail close button passes hit testing and a normal click closes the modal');
  await noHorizontalOverflow('community list');
  const remixesBeforeLegacy = await page.evaluate(() => window.communityHarness.remixes.length);
  await viewButtons.nth(1).click();
  await page.getByRole('status').filter({ hasText: '没有原始网格和色号' }).waitFor();
  await load.waitFor();
  assert.equal(await load.isDisabled(), true);
  await checkPreview(posts[1].title, 2);
  assert.equal(await page.evaluate(() => window.communityHarness.remixes.length), remixesBeforeLegacy);
  passed('legacy PNG without snapshot shows the original-grid warning and disables 载入完整图纸; no fabricated remix');
  await noHorizontalOverflow('legacy detail');
  passed('390px list, snapshot detail and legacy detail have no document/root/modal horizontal overflow');

  for (const post of posts) {
    assert.ok(requests.some((request) => request.path === '/api/community/posts/detail' && request.id === post.id));
    assert.ok(requests.filter((request) => request.path === '/api/community/assets/public' && request.id === post.assetId).length >= 2,
      'both preview image and real blob fetch must use the public asset API');
  }
  assert.ok(requests.some((request) => request.path === '/api/community/posts'));
  assert.equal(await page.evaluate(() => window.communityHarness.authModalCount), 0);
  assert.deepEqual(unexpectedRequests, []);
  assert.deepEqual(pageErrors, []);
  passed('no pageerror, no private-project requests, no mutation requests, and no production/external network traffic');
  console.log('Community pattern browser checks passed: ' + checks + '; Chrome ' + browser.version() + '; ' + requests.length + ' mocked GET requests');
} catch (error) {
  console.error('FAIL', error);
  console.error('pageerrors:', pageErrors, 'unexpected requests:', unexpectedRequests);
  if (page) console.error('page text:', await page.locator('body').innerText({ timeout: 2000 }).catch(() => '(unavailable)'));
  process.exitCode = 1;
} finally {
  try { await browser?.close(); }
  finally { try { await server?.close(); } finally { clearTimeout(deadline); } }
}
