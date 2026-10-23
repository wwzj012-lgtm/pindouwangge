// Full guest App, UI actions only. React state is inspected read-only; no auth/payment overrides.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidence = 'D:/Build_Apps/pindouwangge-change-history/2026-10-23-conversion-quality';
const { chromium } = createRequire('C:/Users/Plout/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json')('./index.js');
const origin = 'http://localhost:3000';
const digest = data => createHash('sha256').update(data).digest('hex');
const results = [], errors = [], blocked = [];
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const deadline = setTimeout(() => { console.error('Browser verification exceeded 150s'); process.exit(1); }, 150000); deadline.unref();
async function snapshot(page, expectedPipeline = null) {
  const read = async expected => {
    const root = document.getElementById('root');
    const handle = root[Object.keys(root).find(k => k.startsWith('__reactContainer'))];
    const find = node => !node ? null : node.type?.name === 'StudioApp' ? node : find(node.child) || find(node.sibling);
    const app = find(handle.stateNode?.current || handle.current || handle);
    if (!app) return null;
    const values = []; for (let h = app.memoizedState; h; h = h.next) values.push(h.memoizedState);
    const settings = values.find(v => v?.quantizationStrength !== undefined && v?.boardSize && v?.brand);
    if (!settings) return null;
    const grid = values.find(v => Array.isArray(v) && v.length === settings.height && v.every(row => Array.isArray(row) && row.length === settings.width && row.every(id => id === null || typeof id === 'string')));
    const palette = values.find(v => Array.isArray(v) && v[0]?.rgb && v[0]?.id);
    const diagnostics = values.find(v => v?.matches && v?.detectedPipeline);
    const source = values.find(v => v instanceof HTMLImageElement);
    if (!source || !grid || !palette || !diagnostics || (expected && diagnostics.pipeline !== expected)) return null;
    const ids = [...new Set(grid.flat().filter(id => id !== null))];
    if (!ids.length || (settings.colorLimit > 0 && ids.length > settings.colorLimit)) return null;
    const sha = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(b => b.toString(16).padStart(2, '0')).join('');
    const canvas = document.createElement('canvas'); canvas.width = source.naturalWidth; canvas.height = source.naturalHeight;
    const ctx = canvas.getContext('2d'); ctx.drawImage(source, 0, 0);
    return { settings, width: grid[0].length, height: grid.length, ids,
      paletteIds: palette.map(c => c.id), gridSha256: await sha(new TextEncoder().encode(JSON.stringify(grid))),
      source: { width: canvas.width, height: canvas.height, pixelSha256: await sha(ctx.getImageData(0, 0, canvas.width, canvas.height).data) },
      diagnostics: { pipeline: diagnostics.pipeline, detectedPipeline: diagnostics.detectedPipeline, meanDeltaE: diagnostics.meanDeltaE,
        lightnessBias: diagnostics.lightnessBias, matchesHeight: diagnostics.matches.length }, heartbeat: window.qualityHeartbeat };
  };
  await page.waitForFunction(read, expectedPipeline);
  return page.evaluate(read, expectedPipeline);
}
function validate(state, limit, mode) {
  assert.equal(state.width, state.settings.width); assert.equal(state.height, state.settings.height);
  assert.ok(state.ids.length > 0 && state.ids.every(id => state.paletteIds.includes(id)));
  if (limit) assert.ok(state.ids.length <= limit, `${state.ids.length} exceeds ${limit}`);
  if (mode) assert.equal(state.settings.pipelineOverride, mode);
  assert.ok(Number.isFinite(state.diagnostics.meanDeltaE) && Number.isFinite(state.diagnostics.lightnessBias));
  assert.ok(['cartoon', 'photo', 'logo'].includes(state.diagnostics.pipeline));
}
try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
    await context.routeWebSocket('**', socket => socket.close()); // Prevent concurrent edits triggering Vite HMR reloads.
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url()), method = request.method();
      // Local GET assets only. All API traffic is intercepted, including local Vite proxies.
      if (url.origin === origin && ['GET', 'HEAD'].includes(method) && !/^\/api(?:\/|$)/.test(url.pathname)) return route.continue();
      blocked.push({ url: request.url(), method });
      if (url.origin === origin && method === 'GET' && url.pathname === '/api/public/feature-flags')
        return route.fulfill({ json: { success: true, data: {} } });
      if (url.origin === origin && method === 'GET' && url.pathname === '/api/public/announcements')
        return route.fulfill({ json: { success: true, data: [] } });
      return route.abort('blockedbyclient');
    });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => { window.qualityHeartbeat = 0; setInterval(() => window.qualityHeartbeat++, 100); });
    const files = viewport.width === 390 ? ['public/images/boss-xiaoxin.jpg'] : ['public/images/batiao-cat.webp', 'public/images/boss-xiaoxin.jpg', 'artifacts/conversion-quality/baseline/thin-lines-source.png'];
    for (const [index, file] of files.entries()) {
      await page.goto(origin + '/workspace?tab=studio', { waitUntil: 'domcontentloaded' });
      const input = page.locator('input[type=file]').first(); await input.waitFor({ state: 'attached' });
      const inputHash = digest(await readFile(path.join(root, file))), start = Date.now();
      await input.setInputFiles(path.join(root, file));
      const apply = page.getByRole('button', { name: '生成预览 · 免费', exact: true }); await apply.waitFor();
      const initial = await snapshot(page); validate(initial);
      if (viewport.width === 390) await page.getByRole('button', { name: /2\./ }).click();
      const mode = index === 1 ? 'photo' : 'logo', limit = index === 1 ? 16 : 8;
      await page.getByRole('button', { name: mode === 'photo' ? 'Photo' : 'LOGO', exact: true }).click();
      const colorSelect = page.locator('select').filter({ has: page.locator('option[value="8"]') });
      await colorSelect.selectOption(String(limit));
      await apply.click(); await apply.waitFor({ state: 'detached' });
      const applied = await snapshot(page, mode); validate(applied, limit, mode);
      assert.equal(applied.diagnostics.pipeline, mode);
      assert.deepEqual(applied.source, initial.source, 'Applying mode/color limit rewrote original pixels');
      assert.equal(applied.settings.colorLimit, limit);
      // Real SettingsPanel recompute (its supported minimum is 12; Studio supports 8/16).
      if (viewport.width === 1440) {
        await page.getByRole('button', { name: '照片', exact: true }).click();
        await page.locator('select').filter({ has: page.locator('option[value="12"]') }).selectOption('12');
        await page.getByRole('button', { name: '重新计算拼豆图纸', exact: true }).click();
        await page.waitForFunction(() => !document.body.innerText.includes('正在转换'));
        const recomputed = await snapshot(page, 'photo'); validate(recomputed, 12, 'photo');
        assert.equal(recomputed.diagnostics.pipeline, 'photo'); assert.equal(recomputed.settings.colorLimit, 12);
        assert.deepEqual(recomputed.source, initial.source); assert.equal(recomputed.diagnostics.matchesHeight, recomputed.height);
        results.push({ file, viewport, phase: 'settings-recomputed', ...recomputed });
      }
      await page.waitForFunction(previous => window.qualityHeartbeat > previous, applied.heartbeat);
      const overflow = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
      assert.ok(overflow.scroll <= overflow.width + 1, JSON.stringify(overflow));
      assert.equal(digest(await readFile(path.join(root, file))), inputHash, 'Input file changed');
      const screenshot = path.join(evidence, `${viewport.width}-${path.parse(file).name}.png`);
      await page.screenshot({ path: screenshot, fullPage: true, animations: 'disabled' });
      results.push({ file, viewport, phase: 'studio-applied', elapsedMs: Date.now() - start, overflow, screenshot, ...applied });
      console.log(`PASS full App ${viewport.width}px ${file}: ${mode}, limit ${limit}, ${applied.width}x${applied.height}, original pixels unchanged`);
    }
    await context.close();
  }
  assert.deepEqual(errors, []);
  assert.equal(blocked.filter(r => !['GET', 'HEAD', 'OPTIONS'].includes(r.method)).length, 0, 'Unexpected cloud mutation attempt was blocked');
} catch (error) {
  errors.push(error.stack); console.error(error); process.exitCode = 1;
} finally {
  await writeFile(path.join(evidence, 'browser-report.json'), JSON.stringify({ fullApp: true, results, errors, blockedRequests: blocked }, null, 2));
  clearTimeout(deadline); await browser.close();
}
