// node src/utils/exportPreviewStability.browser.mjs (real Chrome; no downloads or production API).
// Optional: PLAYWRIGHT_MODULE, EXPORT_STABILITY_WIDTHS=1394, EXPORT_STABILITY_EVIDENCE=/absolute/directory
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require(process.env.PLAYWRIGHT_MODULE || 'playwright'); }
catch { playwright = require(resolve(process.env.USERPROFILE || '', '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')); }
// Reuse exportModal.browser.mjs's isolation pattern, not its self-running tests or evaluated source.
const prefix = 'virtual:export-stability/';
const modules = {
  auth: "import {createContext,useContext} from 'react'; const c=createContext({currentUser:null,isVip:true}); export const useAuth=()=>useContext(c);",
  language: "export const useLanguage=()=>({language:'zh'});",
  history: "export async function saveExportedPatternRecord(){throw Error('Unexpected archive');}",
  output: "import {generatePatternCanvas as generate} from '/src/utils/exportUtils.ts'; export * from '/src/utils/exportUtils.ts'; export function generatePatternCanvas(o){window.pngCalls++;return generate(o);}",
  entry: ["import React from 'react'; import {createRoot} from 'react-dom/client';",
    "import {ExportModal} from '/src/components/ExportModal.tsx'; window.pngCalls=0;",
    "const red={id:'red',code:'A01',name:'红色',hex:'#ff4444',rgb:[255,68,68],brand:'MARD'};",
    "const grid=Array.from({length:44},(_,y)=>Array.from({length:79},(_,x)=>x===y&&x<10?'red':null));",
    "createRoot(document.getElementById('root')).render(React.createElement(ExportModal,{",
    "isOpen:true,unlocked:true,grid,paletteMap:new Map([['red',red]]),width:79,height:44,boardSize:26,",
    "brandName:'MARD',projectName:'79x44 sparse',beadShape:'square',activePalette:[red],activePatternId:null,",
    "settings:{width:79,height:44,boardSize:26},onClose:()=>{},onOpenAuthModal:()=>{}}));"].join('\n'),
};
const server = await createServer({ configFile: false, root: process.cwd(), logLevel: 'error',
  plugins: [{ name: 'isolated-export-stability', enforce: 'pre',
    resolveId(id) { if (id.startsWith(prefix)) return '\0' + id; },
    load(id) { if (id.startsWith('\0' + prefix)) return modules[id.slice(prefix.length + 1)]; },
    transform(source, id) {
      if (!id.split('?')[0].replaceAll('\\', '/').endsWith('/src/components/ExportModal.tsx')) return;
      for (const [path, fixture] of [['context/AuthContext','auth'],['context/LanguageContext','language'],['utils/patternHistory','history'],['utils/exportUtils','output']])
        source = source.replace("'../"+path+"'", "'"+prefix+fixture+"'");
      return source;
    },
    configureServer(vite) { vite.middlewares.use('/__export-stability', async (_request, response) => {
      response.setHeader('Content-Type', 'text/html');
      response.end(await vite.transformIndexHtml('/__export-stability', '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}*,*::before,*::after{box-sizing:border-box}</style></head><body><div id="root"></div><script type="module" src="/@id/' + prefix + 'entry"></script></body></html>'));
    }); },
  }, react()], server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
});
let browser, checks = 0;
const failures = [];
const widths = (process.env.EXPORT_STABILITY_WIDTHS || '1394,1200,768,390').split(',').map(Number);
const evidence = process.env.EXPORT_STABILITY_EVIDENCE;
const selector = '.export-modal-preview-viewport';
const check = (condition, name, detail) => {
  checks++; if (!condition) failures.push(name);
  console.log((condition ? 'PASS ' : 'FAIL ')+name+' '+JSON.stringify(detail));
};
async function sample(page, name, expectedCalls, fit = false, drag) {
  const result = await page.evaluate(async ({ selector, drag }) => {
    const v = document.querySelector(selector), c = v.querySelector('canvas'), frames = [], started = performance.now();
    let mutations = 0;
    const observer = new MutationObserver(records => { mutations += records.length; });
    observer.observe(document.querySelector('.export-modal-preview-panel'), {subtree:true,attributes:true,attributeFilter:['style']});
    const rect = e => { const r = e.getBoundingClientRect(); return [r.x,r.y,r.width,r.height].map(n => +n.toFixed(3)); };
    for (let frame = 0; frame < 120; frame++) {
      await new Promise(requestAnimationFrame);
      const style = getComputedStyle(v), bx = parseFloat(style.borderLeftWidth)+parseFloat(style.borderRightWidth);
      const by = parseFloat(style.borderTopWidth)+parseFloat(style.borderBottomWidth);
      frames.push({outer:rect(v),client:[v.clientWidth,v.clientHeight],scroll:[v.scrollWidth,v.scrollHeight],
        bars:[v.offsetWidth-v.clientWidth-bx,v.offsetHeight-v.clientHeight-by],canvas:rect(c),
        intrinsic:[c.width,c.height],position:[v.scrollLeft,v.scrollTop],mutations,png:window.pngCalls});
    }
    observer.disconnect();
    const tail = frames.slice(60), geometry = tail.map(({mutations,png,...g}) => JSON.stringify(g));
    return {states:new Set(geometry).size,first:tail[0],last:tail.at(-1),elapsedMs:Math.round(performance.now()-started),
      styleWrites:tail.at(-1).mutations-frames[59].mutations,pngDelta:tail.at(-1).png-frames[59].png,
      backingHeld:tail.every(f => JSON.stringify(f.intrinsic)===JSON.stringify(window.stabilityIntrinsic)),
      zoom:Number(getComputedStyle(document.documentElement).zoom),
      alternations:geometry.slice(2).filter((g,i) => g===geometry[i] && g!==geometry[i+1]).length,
      dragHeld:!drag || tail.every(f => f.position.every((n,i) => Math.abs(n-drag[i])<=1))};
  }, {selector,drag});
  const {first,last} = result;
  const fitContained = !fit || (last.canvas[0]>=last.outer[0]-1 && last.canvas[1]>=last.outer[1]-1
    && last.canvas[0]+last.canvas[2]<=last.outer[0]+last.outer[2]+1 && last.canvas[1]+last.canvas[3]<=last.outer[1]+last.outer[3]+1
    && last.scroll.every((n,i) => n<=last.client[i]+1));
  const redundantBars = (last.bars[0]>0 && last.canvas[3]/result.zoom+40<=last.client[1]+1)
    || (last.bars[1]>0 && last.canvas[2]/result.zoom+40<=last.client[0]+1);
  check(result.states===1 && result.styleWrites===0 && result.pngDelta===0 && last.png===expectedCalls && result.backingHeld && result.dragHeld && fitContained && !redundantBars,name,
    {frames:120,tail:60,elapsedMs:result.elapsedMs,states:result.states,alternations:result.alternations,styleWrites:result.styleWrites,pngDelta:result.pngDelta,png:last.png,
      first:{outer:first.outer,client:first.client,bars:first.bars,canvas:first.canvas},
      last:{outer:last.outer,client:last.client,bars:last.bars,canvas:last.canvas,scroll:last.scroll,position:last.position},backingHeld:result.backingHeld,dragHeld:result.dragHeld,fitContained,redundantBars});
  if (name.endsWith('100percent')) check(last.bars.every(n => n>0),name+'-classicScrollbars',{bars:last.bars});
  if (evidence && (name.endsWith('numeric20') || !fitContained || result.states>1)) await page.screenshot({path:resolve(evidence,name+'.png')});
}
async function run(dsf, zoom) {
  const context = await browser.newContext({deviceScaleFactor:dsf,viewport:{width:1394,height:982}});
  try {
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (/ResizeObserver.*loop/i.test(m.text())) errors.push(m.text()); });
    await page.addInitScript(zoom => {
      window.addEventListener('error', e => { (window.stabilityErrors??=[]).push(e.message); });
      document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.zoom=zoom; });
    }, zoom);
    const origin = 'http://127.0.0.1:'+server.httpServer.address().port;
    await page.route('**/*', route => route.request().url().startsWith(origin+'/') ? route.continue() : route.abort());
    for (const width of widths) {
      const name = 'dsf'+dsf+'-zoom'+zoom+'-w'+width;
      await page.setViewportSize({width,height:width===390?844:982});
      await page.goto(origin+'/__export-stability');
      await page.locator('.export-modal-canvas').waitFor();
      await page.evaluate(() => Promise.all(document.querySelector('.export-modal').getAnimations().map(a => a.finished)));
      const calls = await page.evaluate(() => { const c=document.querySelector('.export-modal-canvas'); window.stabilityIntrinsic=[c.width,c.height]; return window.pngCalls; });
      check(calls===1,name+'-initialPNG',{calls});
      await sample(page,name+'-defaultFit',calls,true);
      const scale = async () => parseInt(await page.getByLabel('预览比例',{exact:true}).textContent(),10);
      // Enter numeric zoom below 20%, then exercise several actual plus clicks.
      for (let i=0; i<12 && await scale()>7; i++) await page.getByRole('button',{name:'缩小导出预览',exact:true}).click();
      for (let i=0; i<8 && await scale()<20; i++) {
        await page.getByRole('button',{name:'放大导出预览',exact:true}).click();
        await sample(page,name+'-plus'+i,calls);
      }
      check(await scale()>=20 && await scale()<=29,name+'-numericScale',{percent:await scale()});
      await sample(page,name+'-numeric20',calls);
      for (const [i,delta] of [-81,0,-81,0].entries()) {
        await page.setViewportSize({width:width+delta,height:width===390?844:982});
        await sample(page,name+'-numericResize'+i,calls);
      }
      await page.getByRole('button',{name:'原始比例预览',exact:true}).click();
      await sample(page,name+'-100percent',calls);
      await page.locator(selector).scrollIntoViewIfNeeded();
      const box = await page.locator(selector).boundingBox();
      await page.mouse.move(box.x+box.width*.7,box.y+box.height*.7);
      await page.mouse.down(); await page.mouse.move(box.x+box.width*.3,box.y+box.height*.3,{steps:8}); await page.mouse.up();
      const drag = await page.locator(selector).evaluate(v => [v.scrollLeft,v.scrollTop]);
      check(drag.some(n => n>10),name+'-dragMoved',{position:drag});
      await sample(page,name+'-dragHeld',calls,false,drag);
      for (const [i,delta] of [-81,0,-81,0].entries()) {
        await page.setViewportSize({width:width+delta,height:width===390?844:982});
        await sample(page,name+'-resize'+i,calls);
      }
      await page.getByRole('button',{name:'适应导出预览',exact:true}).click();
      await sample(page,name+'-fitRestored',calls,true);
      const hdShape=await page.locator('.export-modal-canvas').evaluate(c=>({width:c.width,height:c.height}));
      for(const quality of ['极清图纸','高清图纸']){
        await page.getByRole('button',{name:quality,exact:true}).click();
        const qualityCalls=await page.evaluate(()=>{
          const c=document.querySelector('.export-modal-canvas');
          window.stabilityIntrinsic=[c.width,c.height];return window.pngCalls;
        });
        await sample(page,name+'-'+quality+'-fit',qualityCalls,true);
        const shape=await page.locator('.export-modal-canvas').evaluate(c=>({width:c.width,height:c.height}));
        check(Math.abs(shape.width/shape.height-hdShape.width/hdShape.height)<.001,name+'-'+quality+'-proportions',{hd:hdShape,current:shape});
      }
      const runtime = await page.evaluate(() => ({dsf:devicePixelRatio,zoom:getComputedStyle(document.documentElement).zoom,errors:window.stabilityErrors??[]}));
      check(runtime.dsf===dsf && Number(runtime.zoom)===zoom && runtime.errors.length===0 && errors.length===0,name+'-runtime',{...runtime,pageErrors:errors});
    }
  } finally { await context.close(); }
}
try {
  if (evidence) await mkdir(evidence,{recursive:true});
  await server.listen();
  browser = await playwright.chromium.launch({channel:'chrome',headless:true,ignoreDefaultArgs:['--hide-scrollbars'],args:['--disable-features=OverlayScrollbar']});
  console.log('Chrome '+browser.version()+'; classic scrollbars; real 79x44 sparse PNG; 120 rAF / last 60 per state');
  await Promise.all([1.25,1.5].flatMap(dsf => [1.25,1.5].map(zoom => run(dsf,zoom))));
  console.log('Export preview stability: '+(checks-failures.length)+'/'+checks+' passed; '+failures.length+' failed');
  assert.equal(failures.length,0,failures.join(', '));
} finally { await browser?.close(); await server.close(); }
