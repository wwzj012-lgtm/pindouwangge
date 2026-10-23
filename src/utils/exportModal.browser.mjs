// Isolated browser verification. No production API requests, project writes, or saved downloads.
// Run: node src/utils/exportModal.browser.mjs
// Set PLAYWRIGHT_MODULE to a Playwright package directory when it is not installed locally.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
} catch {
  playwright = require(resolve(process.env.USERPROFILE || '', '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
}
const prefix = 'virtual:export-modal-test/';
const modules = {
  auth: `import {createContext,useContext} from 'react';
    export const TestAuth = createContext({currentUser:null,isVip:false});
    export const useAuth=()=>useContext(TestAuth);`,
  language: `import {createContext,useContext} from 'react';
    export const TestLanguage=createContext({language:'zh'});
    export const useLanguage=()=>useContext(TestLanguage);`,
  history: `export async function saveExportedPatternRecord(data) {
    window.exportArchives.push(data);return {id:'test-pattern',syncState:'local-only'};
  }`,
  output: `import {generatePatternCanvas as generate,downloadCanvasImage as download} from '/src/utils/exportUtils.ts';
    export * from '/src/utils/exportUtils.ts';
    export function generatePatternCanvas(options) {
      window.exportOptions.push(options);
      if(window.exportFailPreview) throw Error('Test preview failure');
      return generate(options);
    }
    export function downloadCanvasImage(...args) {
      if(window.exportFailDownload) throw Error('Test download failure');
      return download(...args);
    }`,
  entry: `import React,{useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {ExportModal} from '/src/components/ExportModal.tsx';
    import {TestAuth} from '${prefix}auth';
    import {TestLanguage} from '${prefix}language';
    window.exportOptions=[];window.exportArchives=[];
    const red={id:'red',code:'A01',name:'红色',hex:'#ff4444',rgb:[255,68,68],brand:'MARD'};
    const blue={...red,id:'blue',code:'A02',name:'蓝色',hex:'#4455ff',rgb:[68,85,255]};
    const grid=[['red',null,'blue'],['red','red',null],[null,'blue','red']];
    const paletteMap=new Map([['red',red],['blue',blue]]);
    function TestApp(){
      const [state,setState]=useState({isOpen:true,unlocked:true,isVip:false,language:'zh'});
      window.setExportTestState=updates=>setState(previous=>({...previous,...updates}));
      return React.createElement(TestAuth.Provider,{value:{currentUser:null,isVip:state.isVip}},
        React.createElement(TestLanguage.Provider,{value:{language:state.language}},
          React.createElement(ExportModal,{
            ...state,grid:state.grid??grid,paletteMap,width:state.width??3,height:state.height??3,boardSize:state.boardSize??2,brandName:'MARD',projectName:'测试图纸',
            beadShape:'square',activePalette:[red,blue],activePatternId:null,settings:{width:3,height:3,boardSize:2},
            onClose:()=>setState(previous=>({...previous,isOpen:false})),
            onPatternArchived:id=>window.exportArchivedId=id,
            onOpenAuthModal:()=>window.exportAuthOpened=true,
            onOpenVipModal:()=>window.exportVipOpened=true,
          })));
    }
    createRoot(document.getElementById('root')).render(React.createElement(TestApp));`,
};

const server = await createServer({
  configFile: false,
  root: process.cwd(),
  logLevel: 'error',
  plugins: [{
    name: 'isolated-export-modal-test',
    enforce: 'pre',
    resolveId(id) { if (id.startsWith(prefix)) return '\0' + id; },
    load(id) { if (id.startsWith('\0' + prefix)) return modules[id.slice(prefix.length + 1)]; },
    transform(source, id) {
      if (!id.split('?')[0].replaceAll('\\', '/').endsWith('/src/components/ExportModal.tsx')) return;
      return source.replace("'../context/AuthContext'", `'${prefix}auth'`)
        .replace("'../context/LanguageContext'", `'${prefix}language'`)
        .replace("'../utils/patternHistory'", `'${prefix}history'`)
        .replace("'../utils/exportUtils'", `'${prefix}output'`);
    },
    configureServer(viteServer) {
      viteServer.middlewares.use('/__export-modal-test', async (_request, response) => {
        response.setHeader('Content-Type', 'text/html');
        response.end(await viteServer.transformIndexHtml('/__export-modal-test',
          '<!doctype html><html lang="zh"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}</style></head><body><button id="before">Before modal</button><div id="root"></div><script type="module" src="/@id/' + prefix + 'entry"></script></body></html>'));
      });
    },
  }, react()],
  server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
});

let browser;
let checks = 0;
const passed = message => { checks++; console.log('PASS ' + message); };
try {
  await server.listen();
  const port = server.httpServer.address().port;
  browser = await playwright.chromium.launch({ channel: process.env.EXPORT_TEST_BROWSER || 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.request().url().startsWith('http://127.0.0.1:') ? route.continue() : route.abort());
  await page.goto('http://127.0.0.1:' + port + '/__export-modal-test');
  const canvas = page.locator('.export-modal-canvas');
  await canvas.waitFor();
  await page.locator('.export-modal').evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
  assert.equal(await page.locator('.export-modal-more[open]').count(),0);
  for (const disclosure of await page.locator('.export-modal-more > summary').all()) await disclosure.click();
  passed('Secondary layout/watermark settings start collapsed and are accessible on demand');
  assert.equal(await page.getByLabel('水印文字').isDisabled(), true);
  assert.equal(await page.getByRole('switch',{name:'无水印导出',exact:true}).getAttribute('aria-checked'),'false');
  assert.equal(await page.getByRole('switch',{name:'无水印导出',exact:true}).getAttribute('data-locked'),'true');
  assert.equal(await page.locator('.export-modal-presets').count(),0);
  assert.equal(await page.getByRole('region',{name:'VIP 导出权益',exact:true}).count(),1);
  passed('Free account keeps watermark and locked controls');
  await page.getByRole('button',{name:'查看权益',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.exportVipOpened),true);
  assert.equal(await page.evaluate(()=>Boolean(window.exportAuthOpened)),false);
  passed('Prominent VIP action opens membership benefits rather than the unrelated login entry');

  const desktop = await page.locator('.export-modal-workspace').evaluate(element => {
    const preview = element.querySelector('.export-modal-preview-panel').getBoundingClientRect();
    const settings = element.querySelector('.export-modal-settings').getBoundingClientRect();
    return { columns: getComputedStyle(element).gridTemplateColumns.split(' ').length, previewRight: preview.right, settingsLeft: settings.left };
  });
  assert.equal(desktop.columns, 2);
  assert.ok(desktop.previewRight <= desktop.settingsLeft + 1);
  passed('Desktop uses distinct preview and settings columns');
  const hierarchy=await page.locator('.export-modal').evaluate(modal=>{
    const panel=modal.querySelector('.export-modal-preview-panel').getBoundingClientRect();
    const viewport=modal.querySelector('.export-modal-preview-viewport').getBoundingClientRect();
    return {previewShare:viewport.height/panel.height,header:modal.querySelector('.export-modal-header').getBoundingClientRect().height,footer:modal.querySelector('.export-modal-footer').getBoundingClientRect().height};
  });
  assert.ok(hierarchy.previewShare>=.8,JSON.stringify(hierarchy));
  assert.ok(hierarchy.header<=56&&hierarchy.footer<=64,JSON.stringify(hierarchy));
  passed('The preview owns at least 80% of its column; title, statistics and footer remain secondary');

  for (const viewport of [{ width: 768, height: 1024 }, { width: 390, height: 844 }, { width: 320, height: 568 }]) {
    await page.setViewportSize(viewport);
    const bounds = await page.locator('.export-modal').evaluate(element => {
      const settings = element.querySelector('.export-modal-settings').getBoundingClientRect();
      const preview = element.querySelector('.export-modal-preview-panel').getBoundingClientRect();
      const footer = element.querySelector('.export-modal-footer').getBoundingClientRect();
      const workspace = element.querySelector('.export-modal-workspace');
      return { stacked: settings.top >= preview.bottom - 1, footerBottom: footer.bottom, horizontalOverflow: workspace.scrollWidth > workspace.clientWidth + 1, modalBottom: element.getBoundingClientRect().bottom };
    });
    assert.ok(bounds.stacked);
    assert.ok(!bounds.horizontalOverflow);
    assert.ok(bounds.footerBottom <= viewport.height + 1 && bounds.modalBottom <= viewport.height + 1, JSON.stringify({ viewport, bounds }));
    passed(viewport.width + 'px layout stacks without horizontal overflow and keeps downloads visible');
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByLabel('导出范围').selectOption('3');
  assert.match(await page.locator('.export-modal-summary').innerText(), /1\s*×\s*1/);
  assert.match(await page.locator('.export-modal-summary').innerText(), /1\s*颗/);
  await page.getByLabel('文件名称').fill('自定义/图纸.PNG');
  assert.equal(await page.locator('.export-modal-filename').textContent(), '自定义_图纸_板4.png');
  await page.locator('.export-modal-materials summary').click();
  assert.equal(await page.locator('.export-modal-materials tbody tr').count(), 1);
  passed('Partial-board dimensions, bead counts, materials and sanitized filename agree');

  await page.getByLabel('显示色号标识').uncheck();
  await page.getByLabel('显示标尺坐标').uncheck();
  assert.equal(await page.getByLabel('显示色号标识').isChecked(), false);
  assert.equal(await page.getByLabel('显示标尺坐标').isChecked(), false);
  assert.equal(await page.getByLabel('隐藏空白豆位').isChecked(), true);
  assert.equal(await page.getByRole('switch',{name:'无水印导出',exact:true}).getAttribute('aria-checked'),'false');
  await page.getByRole('button', { name: '重置', exact: true }).click();
  assert.equal(await page.getByLabel('导出范围').inputValue(), 'full');
  assert.equal(await page.getByLabel('文件名称').inputValue(), '测试图纸');
  assert.equal(await page.getByLabel('显示色号标识').isChecked(), true);
  passed('Direct layout controls leave privileges unchanged; reset restores defaults; redundant presets are gone');

  await page.getByRole('button',{name:'极清图纸',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'高清图纸',exact:true}).getAttribute('aria-pressed'),'true');
  await page.getByRole('switch',{name:'无水印导出',exact:true}).click();
  assert.equal(await page.getByRole('switch',{name:'无水印导出',exact:true}).getAttribute('aria-checked'),'false');
  assert.match(await page.locator('.export-modal-vip-notice').textContent(), /VIP/);
  passed('Free account cannot enable ultra quality');

  await page.getByRole('button', { name: '下载高清 PNG', exact: true }).click();
  await page.locator('[data-export-subdialog]').waitFor();
  assert.equal(await page.locator('.export-modal-shell').evaluate(element => element.inert), true);
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => Boolean(document.activeElement.closest('[data-export-subdialog]'))), true);
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '确认下载带水印文件' }).click();
  const download = await downloadEvent;
  assert.equal(download.suggestedFilename(), '测试图纸_完整图纸.png');
  await download.cancel();
  await page.waitForFunction(() => window.exportArchivedId === 'test-pattern');
  assert.equal(await page.evaluate(() => window.exportArchives[0].title), '测试图纸');
  assert.equal(await page.evaluate(() => window.exportOptions.at(-1).watermarkType), 'double_diagonal');
  passed('Free confirmation produces a real PNG download and archives the original project');

  await page.evaluate(() => window.setExportTestState({ isVip: true }));
  await page.getByRole('switch',{name:'无水印导出',exact:true}).click();
  await page.getByRole('button',{name:'极清图纸',exact:true}).click();
  await page.getByRole('switch',{name:'无水印导出',exact:true}).click();
  await page.getByLabel('水印文字').fill('My store');
  await page.getByRole('switch',{name:'无水印导出',exact:true}).click();
  const vipDownloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载无水印 PNG' }).click();
  await (await vipDownloadEvent).cancel();
  assert.equal(await page.evaluate(() => window.exportOptions.at(-1).watermarkType), 'none');
  assert.equal(await page.evaluate(() => window.exportOptions.at(-1).exportQuality), 'ultra');
  passed('VIP retains watermark-free and ultra-quality downloads');

  await page.waitForFunction(() => document.querySelector('.export-modal-feedback').dataset.state === 'success');
  await page.evaluate(() => window.setExportTestState({ isVip: false }));
  await page.waitForFunction(() => window.exportOptions.at(-1).watermarkType === 'double_diagonal');
  assert.equal(await page.evaluate(() => window.exportOptions.at(-1).exportQuality), 'high');
  assert.equal(await page.evaluate(() => window.exportOptions.at(-1).watermarkText), '豆织星格');
  passed('Membership revocation clamps preview options immediately');

  await page.evaluate(() => { window.exportFailDownload = true; window.setExportTestState({ isVip: true }); });
  await page.getByRole('button', { name: '下载高清 PNG', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.export-modal-feedback').dataset.state === 'error');
  assert.match(await page.locator('.export-modal-feedback').innerText(), /Test download failure/);
  assert.equal(await page.getByRole('button', { name: '下载高清 PNG', exact: true }).isDisabled(), false);
  passed('Download errors are visible and controls recover');

  await page.evaluate(() => { window.exportFailDownload = false; window.exportFailPreview = true; });
  await page.getByLabel('色号字号').selectOption('1.25');
  await page.getByRole('alert').waitFor();
  assert.equal(await canvas.count(), 0);
  await page.evaluate(() => { window.exportFailPreview = false; });
  await page.getByLabel('色号字号').selectOption('1');
  await canvas.waitFor();
  passed('Preview failure clears stale output and can recover');

  const batchNames = [];
  const onBatchDownload = async download => { batchNames.push(download.suggestedFilename()); await download.cancel(); };
  page.on('download', onBatchDownload);
  await page.getByLabel('文件名称').fill('批量文件');
  await page.getByRole('button', { name: '全部分板（5 张）' }).click();
  await page.waitForFunction(() => document.querySelector('.export-modal-feedback').dataset.state === 'success');
  assert.deepEqual(batchNames, ['批量文件_完整图纸.png', '批量文件_板1.png', '批量文件_板2.png', '批量文件_板3.png', '批量文件_板4.png']);
  page.off('download', onBatchDownload);
  assert.equal(await page.evaluate(() => window.exportArchives.at(-1).title), '测试图纸');
  passed('Batch exports keep every board suffix and do not rename the archived project');

  await context.setExtraHTTPHeaders({});
  await page.evaluate(() => Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'MicroMessenger' }));
  await page.getByRole('button', { name: '下载高清 PNG', exact: true }).click();
  await page.getByRole('heading', { name: '微信导出保存指南' }).waitFor();
  assert.match(await page.locator('.export-modal-wechat-image img').getAttribute('src'), /^data:image\/png/);
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('[data-export-subdialog]'));
  assert.equal(await page.evaluate(() => Boolean(document.activeElement.closest('.export-modal'))), true);
  passed('WeChat produces a real long-press PNG and returns focus after closing');
  await page.getByRole('button', { name: '全部分板（5 张）' }).click();
  await page.waitForFunction(()=>document.querySelector('.export-modal-feedback').dataset.state==='error');
  assert.match(await page.locator('.export-modal-feedback').innerText(),/微信.*逐张/);
  assert.equal(await page.locator('[data-export-subdialog]').count(),0);
  passed('WeChat batch is explained instead of silently replacing every saved preview with the last board');

  await page.evaluate(() => window.setExportTestState({ unlocked: false }));
  await page.waitForFunction(() => !document.querySelector('.export-modal'));
  assert.equal(await canvas.count(), 0);
  await page.evaluate(() => window.setExportTestState({ unlocked: true, language: 'en' }));
  await page.getByRole('heading', { name: 'Export pattern', exact: true }).waitFor();
  assert.match(await page.locator('.export-modal-filename').textContent(), /_FullPattern\.png$/);
  passed('Draft lock hides all details and English output keeps naming compatibility');
  await page.evaluate(() => { delete navigator.userAgent; window.setExportTestState({isVip:true,language:'zh'}); });
  for (const [width,height,viewport] of [[79,44,{width:1513,height:1103}],[44,79,{width:1394,height:982}],[104,104,{width:768,height:1024}],[79,44,{width:390,height:844}],[44,79,{width:320,height:568}]]) {
    await page.setViewportSize(viewport);
    await page.evaluate(({width,height}) => window.setExportTestState({width,height,boardSize:26,grid:Array.from({length:height},(_,y)=>Array.from({length:width},(_,x)=>(x===y&&x<10)?'red':null))}),{width,height});
    const layout=page.locator('.export-modal-more').filter({hasText:'排版与标识'});
    if(!await layout.evaluate(d=>d.open))await layout.locator('summary').click();
    await page.getByLabel('色号字号').selectOption('1.25');
    await page.getByLabel('用量清单位置').selectOption('bottom');
    await page.waitForFunction(() => {
      const c=document.querySelector('.export-modal-canvas'),v=document.querySelector('.export-modal-preview-viewport');
      if(!c||!v)return false;
      const a=c.getBoundingClientRect(),b=v.getBoundingClientRect();
      return a.width>0&&a.left>=b.left-1&&a.right<=b.right+1&&a.top>=b.top-1&&a.bottom<=b.bottom+1;
    });
    const contained=await page.locator('.export-modal-canvas').evaluate(c=>{
      const b=c.closest('.export-modal-preview-viewport').getBoundingClientRect(),r=c.getBoundingClientRect();
      return r.left>=b.left-1&&r.top>=b.top-1&&r.right<=b.right+1&&r.bottom<=b.bottom+1;
    });
    assert.equal(contained,true);
    if(width===79&&viewport.width===1513){
      const hd=await canvas.evaluate(c=>({width:c.width,height:c.height}));
      await page.evaluate(()=>{
        window.qualityFrames=[];
        function capture(){const c=document.querySelector('.export-modal-canvas');if(c){const r=c.getBoundingClientRect();window.qualityFrames.push({width:c.width,height:c.height,displayWidth:r.width,displayHeight:r.height});}if(window.qualityFrames.length<40)requestAnimationFrame(capture)}
        requestAnimationFrame(capture);
      });
      await page.getByRole('button',{name:'极清图纸',exact:true}).click();
      await page.waitForFunction(()=>window.qualityFrames.length>=40);
      const ultra=await canvas.evaluate(c=>({width:c.width,height:c.height}));
      assert.ok(ultra.width>hd.width&&ultra.height>hd.height);
      assert.ok(Math.abs(ultra.width/ultra.height-hd.width/hd.height)<.001);
      const distorted=await page.evaluate(()=>window.qualityFrames.filter(f=>f.displayWidth>0&&f.displayHeight>0&&Math.abs((f.displayWidth/f.displayHeight)/(f.width/f.height)-1)>.001));
      assert.deepEqual(distorted,[]);
      assert.equal(await page.getByLabel('用量清单位置').inputValue(),'bottom');
      assert.equal(await page.getByLabel('色号字号').inputValue(),'1.25');
      if(process.env.EXPORT_MODAL_EVIDENCE)await page.screenshot({path:process.env.EXPORT_MODAL_EVIDENCE+'/ultra-unchanged-layout.png',animations:'disabled'});
      await page.getByRole('button',{name:'高清图纸',exact:true}).click();
      await page.waitForFunction(({w,h})=>{const c=document.querySelector('.export-modal-canvas');return c?.width===w&&c?.height===h},{w:hd.width,h:hd.height});
      passed('HD-to-ultra raises pixels only: same page proportions, unchanged controls, and no distorted transition frame');
    }
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),viewport.width);
    if(process.env.EXPORT_MODAL_EVIDENCE){
      await page.locator('.export-modal-more').evaluateAll(ds=>ds.forEach(d=>{d.open=false}));
      await page.evaluate(()=>document.querySelectorAll('.export-modal-settings,.export-modal-preview-panel,.export-modal-workspace').forEach(e=>e.scrollTo(0,0)));
      await page.screenshot({path:process.env.EXPORT_MODAL_EVIDENCE+'/export-'+width+'x'+height+'-'+viewport.width+'.png',animations:'disabled'});
    }
    passed(width+'x'+height+' at '+viewport.width+'px: fit preview stays entirely within its frame, no summary/footer overlap or horizontal overflow');
  }
  const intrinsic=await canvas.evaluate(c=>({width:c.width,height:c.height}));
  const optionsBeforeZoom=await page.evaluate(()=>window.exportOptions.length);
  await page.getByRole('button',{name:'原始比例预览',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.export-modal-preview-viewport').scrollWidth>document.querySelector('.export-modal-preview-viewport').clientWidth);
  assert.deepEqual(await canvas.evaluate(c=>({width:c.width,height:c.height})),intrinsic);
  assert.equal(await page.evaluate(()=>window.exportOptions.length),optionsBeforeZoom);
  await page.getByRole('button',{name:'适应导出预览',exact:true}).click();
  passed('100% scrolls inside the frame and fit restores containment without regenerating/resizing PNG');

  await page.setViewportSize({width:1394,height:982});
  await page.evaluate(()=>window.setExportTestState({width:79,height:44,boardSize:26,grid:Array.from({length:44},()=>Array(79).fill(null))}));
  await page.getByRole('button',{name:'下一块分板',exact:true}).click();
  assert.equal(await page.getByLabel('导出范围').inputValue(),'0');
  await page.getByRole('button',{name:'下一块分板',exact:true}).click();
  assert.equal(await page.getByLabel('导出范围').inputValue(),'1');
  await page.getByRole('button',{name:'上一块分板',exact:true}).click();
  assert.equal(await page.getByLabel('导出范围').inputValue(),'0');
  passed('Board navigation updates range, preview and coordinates together');

  const beforeCancelArchives=await page.evaluate(()=>window.exportArchives.length);
  const cancelDownloads=[];
  const cancelDownload=async d=>{cancelDownloads.push(d.suggestedFilename());await d.cancel()};
  page.on('download',cancelDownload);
  const firstBatchDownload=page.waitForEvent('download');
  await page.getByRole('button',{name:'全部分板（9 张）',exact:true}).click();
  await firstBatchDownload;
  await page.getByRole('button',{name:'停止批量',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.export-modal-feedback').textContent.includes('已停止批量'));
  const stoppedCount=cancelDownloads.length;
  await page.waitForTimeout(350);
  assert.equal(cancelDownloads.length,stoppedCount);assert.ok(stoppedCount<9);
  assert.equal(await page.evaluate(()=>window.exportArchives.length),beforeCancelArchives);
  page.off('download',cancelDownload);
  passed('Stopping batch leaves started files intact, stops further downloads and does not archive an incomplete batch');

  await page.evaluate(()=>window.setExportTestState({width:900,height:900,boardSize:26,grid:Array.from({length:900},()=>Array(900).fill(null))}));
  await page.getByLabel('导出范围').selectOption('full');
  await page.getByRole('alert').waitFor();
  const firstLargeDownload=page.waitForEvent('download');
  await page.getByRole('button',{name:'全部分板（1225 张）',exact:true}).click();
  const largeDownload=await firstLargeDownload;
  assert.match(largeDownload.suggestedFilename(),/_板1\.png$/);await largeDownload.cancel();
  await page.getByRole('button',{name:'停止批量',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.export-modal-feedback').textContent.includes('已停止批量'));
  passed('900-square overview is rejected before allocation, but batch still exports board1 at original grid resolution');
  assert.deepEqual(errors, []);
  console.log('Export modal browser checks passed: ' + checks);
} finally {
  await browser?.close();
  await server.close();
}
