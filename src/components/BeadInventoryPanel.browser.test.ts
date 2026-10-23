import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { createServer } from 'vite';
import { expect, it } from 'vitest';

// Optional real-browser check: no downloaded dependencies, live accounts or production API calls.
const chromePath = process.env.PRACTICE_TEST_CHROME
  ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const harness = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {UserProfileModal} from '/src/components/UserProfileModal.tsx';
import {PracticePanel} from '/src/components/PracticePanel.tsx';
import {BRAND_PALETTES} from '/src/data/palettes.ts';
import * as store from '/src/utils/beadInventory.ts';
import '/src/index.css';
window.fetch=async()=>{throw new Error('Verification blocks all API requests')};
window.formalUser=true;
const root=createRoot(document.getElementById('root'));
const colors=[BRAND_PALETTES.MARD[0],BRAND_PALETTES.MARD_291[0],BRAND_PALETTES.COCO[0]];
let practiceColors=colors;
function mount(){root.render(React.createElement(React.Fragment,null,React.createElement(UserProfileModal,{isOpen:true,initialTab:'inventory',onClose:()=>{},onOpenAccountManagement:()=>{}}),React.createElement('aside',{style:{width:'min(360px,100%)',height:500}},React.createElement(PracticePanel,{grid:[practiceColors.map(c=>c.id)],paletteMap:new Map(practiceColors.map(c=>[c.id,c])),workKey:'inventory-check',userId:'fixture',detailsUnlocked:true,activeColorId:null,onHighlightColor:()=>{},onClose:()=>{},onOpenInventory:()=>{}}))))}
window.probe={store,mount,catalog:BRAND_PALETTES,practiceSubset:ids=>{practiceColors=ids.map(id=>Object.values(BRAND_PALETTES).flat().find(color=>color.id===id));mount()}};
mount();
`;

it.skipIf(!existsSync(chromePath))('drives real brand inventory UI, legacy migration, practice updates and phone layout', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'practice-panel-check-'));
  const server = await createServer({
    configFile: false,
    server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
    plugins: [react(), tailwindcss(), {
      name: 'inventory-auth-fixture', enforce: 'pre',
      resolveId(id) { if (/[/\\]context[/\\]AuthContext(?:\.tsx?)?$/.test(id)) return '\0inventory-auth'; },
      load(id) { if (id === '\0inventory-auth') return 'export const useAuth=()=>({currentUser:window.formalUser?{uid:"fixture",displayName:"测试"}:null,userProfile:null,isVip:true,isPro:false})'; },
    }, {
      name: 'practice-browser-check',
      resolveId(id) { if (id === '/__practice-check.js') return '\0practice-check'; },
      load(id) { if (id === '\0practice-check') return harness; },
      configureServer(vite) {
        vite.middlewares.use(async (req, res, next) => {
          if (req.url !== '/__practice-check') return next();
          res.setHeader('Content-Type', 'text/html');
          // The React development preamble must be injected for actual TSX imports.
          res.end(await vite.transformIndexHtml(req.url,
            '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#080d17"><div id="root"></div><script type="module" src="/__practice-check.js"></script></body></html>'));
        });
      },
    }],
  });
  let chrome: ChildProcess | undefined;
  let socket: WebSocket | undefined;
  const checks: string[] = [];
  try {
    await server.listen();
    const address = server.httpServer!.address();
    if (!address || typeof address === 'string') throw new Error('Missing verification port');
    chrome = spawn(chromePath, [
      '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu',
      '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
    ], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    const endpoint = await new Promise<string>((accept, reject) => {
      let output = '';
      const timeout = setTimeout(() => reject(new Error('Chrome startup timeout')), 15000);
      chrome!.stderr!.on('data', chunk => {
        output += chunk;
        const found = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (found) { clearTimeout(timeout); accept(found[1]); }
      });
      chrome!.on('error', error => { clearTimeout(timeout); reject(error); });
    });
    socket = new WebSocket(endpoint);
    await new Promise<void>((accept, reject) => {
      socket!.addEventListener('open', () => accept(), { once: true });
      socket!.addEventListener('error', reject, { once: true });
    });
    let serial = 0;
    const pending = new Map<number, { accept: (value: any) => void; reject: (error: Error) => void }>();
    socket.addEventListener('message', event => {
      const message = JSON.parse(String(event.data));
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.error) request.reject(new Error(JSON.stringify(message.error)));
      else request.accept(message.result);
    });
    const send = (method: string, params = {}, sessionId?: string): Promise<any> => new Promise((accept, reject) => {
      const id = ++serial;
      pending.set(id, { accept, reject });
      socket!.send(JSON.stringify({ id, method, params, sessionId }));
    });
    const evaluate = async (expression: string, sessionId: string) => {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    const wait = (ms: number) => new Promise(accept => setTimeout(accept, ms));
    const tab = async () => {
      const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
      await send('Page.enable', {}, sessionId);
      await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.probeErrors=[];window.addEventListener("error",e=>probeErrors.push(e.message))' }, sessionId);
      await send('Page.navigate', { url: `http://127.0.0.1:${address.port}/__practice-check` }, sessionId);
      for (let i = 0; i < 100; i++) {
        if (await evaluate('Boolean(window.probe&&document.querySelector(".bead-stock"))', sessionId)) return sessionId as string;
        await wait(100);
      }
      throw new Error(`Harness failed: ${await evaluate('JSON.stringify(window.probeErrors)', sessionId)}`);
    };
    const session = await tab();
    const run = async (code: string) => {
      checks.push(...await evaluate(`(async()=>{const results=[];const check=(condition,label)=>{if(!condition)throw new Error(label);results.push(label)};const wait=()=>new Promise(r=>setTimeout(r,90));${code};return results})()`, session));
    };

    await run(`
      const select=(label,value)=>{const el=document.querySelector('[aria-label="'+label+'"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('change',{bubbles:true}))};
      const input=(label,value)=>{const el=document.querySelector('[aria-label="'+label+'"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}))};
      const button=text=>[...document.querySelectorAll('.bead-stock button')].find(el=>el.textContent===text);
      const count=()=>Number(document.querySelector('[aria-label="A1 库存数量"]').value);
      const snapshot=()=>probe.store.getBeadInventorySnapshot();
      check(document.querySelector('[aria-label="拼豆品牌"]').value==='MARD_291','default complete Mard-291 catalog');
      check(document.querySelector('[aria-label="拼豆品牌"]').options.length===7,'all fixed brands without custom');
      check(count()===0,'unrecorded stock renders zero');
      check(localStorage.getItem(probe.store.INVENTORY_STORAGE_KEY)===null,'initial display never populates storage');
      check(document.querySelectorAll('.bead-stock__card').length===36,'bounded first page');
      check(!document.querySelector('.bead-stock').textContent.includes('添加新色号'),'no custom color creation');
      for(const option of [...document.querySelector('[aria-label="拼豆品牌"]').options]) {
        select('拼豆品牌',option.value);await wait();
        check(document.querySelector('.bead-stock__card').dataset.colorId===probe.catalog[option.value][0].id,'real first catalog color for '+option.value);
        check([...document.querySelectorAll('.bead-stock__quantity input')].every(el=>el.value==='0'),'default zero for '+option.value);
      }
      check(localStorage.getItem(probe.store.INVENTORY_STORAGE_KEY)===null,'browsing every brand never writes storage');
      select('拼豆品牌','MARD_291');await wait();
      input('A1 库存数量','123');await wait();document.querySelector('[aria-label="保存 A1 库存"]').click();await wait();
      check(count()===123&&snapshot().MARD_291_A1?.count===123,'save exact quantity through real form: '+document.querySelector('.bead-stock__message').textContent+'; '+document.querySelector('.profile-header').textContent+'; '+JSON.stringify(snapshot()));
      check(document.querySelector('.practice-panel__stock-totals').textContent.includes('匹配库存123'),'practice live sync after exact edit');
      select('拼豆品牌','MARD');await wait();check(count()===0,'same A1 isolated between Mard variants');
      input('A1 库存数量','17');await wait();document.querySelector('[aria-label="保存 A1 库存"]').click();await wait();check(count()===17,'second brand own quantity');
      select('拼豆品牌','MARD_291');await wait();check(count()===123,'switch back preserves first brand');
      select('拼豆品牌','COCO');await wait();check(document.querySelectorAll('.bead-stock__card').length===36,'other manufacturer full paged catalog');
      check(document.querySelector('.bead-stock__card').dataset.colorId===probe.catalog.COCO[0].id,'other manufacturer uses real IDs');
      input('批量数量','2');await wait();button('批量设置').click();await wait();
      check(probe.catalog.COCO.every(color=>snapshot()[color.id]?.count===2),'whole-brand batch includes every offscreen page');
      check(snapshot().MARD_A1.count===17&&snapshot().MARD_291_A1.count===123,'whole-brand batch leaves other brands intact');
      button('批量减少').click();await wait();
      check(probe.catalog.COCO.every(color=>snapshot()[color.id]?.count===0),'whole-brand subtract floors every page at zero');
      select('拼豆品牌','MARD_291');await wait();
      const search=document.querySelector('.bead-stock input[type=search]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(search,'ZG8');search.dispatchEvent(new Event('input',{bubbles:true}));await wait();
      check(document.querySelectorAll('.bead-stock__card').length===1&&document.querySelector('.bead-stock__card').dataset.colorId==='MARD_291_ZG8','search reaches real special color ZG8 beyond first page');
      input('批量数量','8');await wait();button('批量设置').click();await wait();check(snapshot().MARD_291_ZG8.count===8,'batch set filtered real special color');
      button('批量增加').click();await wait();check(snapshot().MARD_291_ZG8.count===16,'batch increase');
      button('批量减少').click();await wait();check(snapshot().MARD_291_ZG8.count===8,'batch decrease');
      check(snapshot().MARD_291_A1.count===123&&snapshot().MARD_A1.count===17,'batch leaves other colors and brands intact');
      input('批量数量','1.5');await wait();check(button('批量设置').disabled,'fractional batch rejected');
      input('批量数量','1000001');await wait();check(button('批量设置').disabled,'oversized batch rejected');
      input('批量数量','0');await wait();button('批量设置').click();await wait();check(snapshot().MARD_291_ZG8.count===0,'explicit zero edit persists');
      select('拼豆品牌','MARD');await wait();input('A1 库存数量','-1');await wait();check(document.querySelector('[aria-label="保存 A1 库存"]').disabled,'negative single quantity rejected');
      select('拼豆品牌','MARD_291');await wait();
      const groups=document.querySelectorAll('.bead-stock__groups button');[...groups].find(el=>el.textContent==='ZG').click();await wait();
      check(document.querySelectorAll('.bead-stock__card').length===probe.catalog.MARD_291.filter(c=>c.code.startsWith('ZG')).length,'dynamic multi-letter group contains full real catalog group');
      select('拼豆品牌','MARD');await wait();
      const kept=snapshot();probe.store.writeBeadInventory({...kept,oldA2:{colorId:'MARD_A2',code:'A2',name:'旧记录',hex:'#fff',count:31,alertThreshold:100},custom:{colorId:'CUSTOM_A3',code:'A3',name:'自定义旧记录',hex:'#fff',count:42,alertThreshold:100,note:'keep'}});await wait();
      check(document.querySelector('[aria-label="A2 库存数量"]').value==='31','unbranded true colorId automatically compatible');
      check(document.querySelector('.bead-stock__legacy').textContent.includes('不自动归属'),'unbranded custom compatibility rule visible');
      document.querySelector('.bead-stock__legacy').open=true;select('待确认旧库存','custom');select('旧库存目标色号','MARD_A3');await wait();button('确认归入 Mard-221').click();await wait();
      check(snapshot().custom.count===42&&snapshot().custom.colorId==='MARD_A3'&&snapshot().custom.note==='keep','explicit legacy migration preserves key quantity metadata');
      check(document.querySelector('[aria-label="A3 库存数量"]').value==='42','migrated stock visible in true catalog');
      check(document.querySelector('.practice-panel__stock-totals').textContent.includes('匹配库存140'),'practice matches two brand-specific A1 pools');
      const before=localStorage.getItem(probe.store.INVENTORY_STORAGE_KEY);let unauthorized=0;window.addEventListener('unauthorized',()=>unauthorized++);window.formalUser=false;probe.mount();await wait();
      document.querySelector('[aria-label="A1 增加100粒"]').click();await wait();
      check(unauthorized===1&&localStorage.getItem(probe.store.INVENTORY_STORAGE_KEY)===before,'anonymous guard prevents inventory write');
      window.formalUser=true;probe.mount();await wait();
    `);
    await run(`
      const select=(label,value)=>{const el=document.querySelector('[aria-label="'+label+'"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('change',{bubbles:true}))};
      const input=(label,value)=>{const el=document.querySelector('[aria-label="'+label+'"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}))};
      const button=text=>[...document.querySelectorAll('.bead-stock button')].find(el=>el.textContent===text);
      const totals=()=>[...document.querySelectorAll('.practice-panel__stock-totals dd')].map(el=>Number(el.textContent.replaceAll(',','')));
      const snapshot=()=>probe.store.getBeadInventorySnapshot();
      const original=snapshot();
      const legacy={colorId:'MARD_A1',brand:'COCO',code:'E02',name:'冲突旧库存',hex:'#FAF4C8',count:123,alertThreshold:100};
      probe.store.writeBeadInventory({legacy});probe.practiceSubset(['COCO_E02']);select('拼豆品牌','COCO');await wait();
      check(document.querySelectorAll('.practice-panel__color').length===1,'regression work uses real COCO-only palette subset');
      check(document.querySelector('[aria-label="E02 库存数量"]').value==='0','cross-brand conflict inventory stays zero');
      check(document.querySelector('.bead-stock__legacy').textContent.includes('待确认旧库存'),'cross-brand conflict remains pending');
      check(totals()[0]===0&&totals()[2]===1,'cross-brand conflict subset practice stock zero and shortage one');
      check(JSON.stringify(snapshot())===JSON.stringify({legacy}),'reading conflicting stock never rewrites original');
      input('E02 库存数量','4');await wait();document.querySelector('[aria-label="保存 E02 库存"]').click();await wait();
      check(totals()[0]===4&&snapshot().legacy.count===123,'new catalog edit syncs practice without counting pending legacy');
      input('批量数量','3');await wait();button('批量减少').click();await wait();
      check(totals()[0]===1&&totals()[2]===0&&snapshot().legacy.count===123,'subset practice follows catalog batch only');
      button('批量减少').click();await wait();check(totals()[0]===0&&totals()[2]===1,'subset shortage returns when real stock reaches zero');
      probe.store.writeBeadInventory({legacy});await wait();document.querySelector('.bead-stock__legacy').open=true;
      select('待确认旧库存','legacy');select('旧库存目标色号','COCO_E02');await wait();button('确认归入 Coco-291').click();await wait();
      check(snapshot().legacy.colorId==='COCO_E02'&&snapshot().legacy.count===123,'explicitly confirmed conflict preserves quantity');
      check(document.querySelector('[aria-label="E02 库存数量"]').value==='123'&&totals()[0]===123&&totals()[2]===0,'confirmed inventory becomes available to subset practice');
      const stale={...legacy,colorId:'MARD_A1',brand:'MARD',code:'A2'};
      probe.store.writeBeadInventory({legacy:stale});probe.practiceSubset(['MARD_A2']);select('拼豆品牌','MARD');await wait();
      check(document.querySelector('[aria-label="A1 库存数量"]').value==='123'&&document.querySelector('[aria-label="A2 库存数量"]').value==='0','same-brand conflicting code follows authoritative global ID');
      check(totals()[0]===0&&totals()[2]===1,'same-brand wrong code cannot leak to A2-only work');
      probe.practiceSubset(['MARD_A1']);await wait();check(totals()[0]===123&&totals()[2]===0,'same record belongs only to globally resolved A1 work');
      const unknown={...legacy,colorId:'CUSTOM_E02',brand:undefined};
      probe.store.writeBeadInventory({legacy:unknown});probe.practiceSubset(['COCO_E02']);select('拼豆品牌','COCO');await wait();
      check(document.querySelector('[aria-label="E02 库存数量"]').value==='0'&&totals()[0]===0&&totals()[2]===1,'unknown unbranded legacy never counts in either UI');
      check(snapshot().legacy.count===123&&snapshot().legacy.colorId==='CUSTOM_E02','unknown legacy retained unchanged');
      probe.store.writeBeadInventory(original);probe.practiceSubset(['MARD_A1','MARD_291_A1','COCO_E02']);select('拼豆品牌','MARD');await wait();
    `);
    for (const [width,height,label] of [[1280,1000,'desktop'],[390,844,'phone'],[320,740,'small-phone']] as const) {
      await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<768},session);
      await run(`
        await wait();const panel=document.querySelector('.bead-stock'),dialog=document.querySelector('.profile-dialog');
        check(panel.scrollWidth<=panel.clientWidth+1,'${label} inventory no horizontal overflow');
        check(dialog.getBoundingClientRect().width<=${width},'${label} modal fits viewport');
        check(document.querySelector('.profile-content').scrollHeight>document.querySelector('.profile-content').clientHeight,'${label} inventory internally scrolls');
        check(document.querySelectorAll('.bead-stock__card').length<=36,'${label} bounded rendering');
        check([...document.querySelectorAll('.bead-stock button')].filter(el=>el.getBoundingClientRect().height>0).every(el=>el.getBoundingClientRect().height>=44),'${label} touch targets');
      `);
      if (process.env.INVENTORY_TEST_SCREENSHOTS==='1') {
        const shot=await send('Page.captureScreenshot',{format:'png'},session);
        await writeFile(join(tmpdir(),`bead-inventory-${label}.png`),Buffer.from(shot.data,'base64'));
        await evaluate("(()=>{const content=document.querySelector('.profile-content');content.scrollTop=document.querySelector('.bead-stock__grid').getBoundingClientRect().top-content.getBoundingClientRect().top+content.scrollTop})()",session);
        const cards=await send('Page.captureScreenshot',{format:'png'},session);
        await writeFile(join(tmpdir(),`bead-inventory-${label}-cards.png`),Buffer.from(cards.data,'base64'));
        await evaluate("document.querySelector('.profile-content').scrollTop=0",session);
      }
    }
    expect(checks.length).toBeGreaterThanOrEqual(30);
    console.info(`Inventory browser: ${checks.length} checks passed; ${checks.join(', ')}`);
    await send('Browser.close');
  } finally {
    socket?.close();
    if (chrome && chrome.exitCode === null) { chrome.kill(); await new Promise(accept => setTimeout(accept, 500)); }
    await server.close();
    // Delete only the dedicated temporary profile allocated above, never an existing browser profile.
    if (resolve(profile).startsWith(`${resolve(tmpdir())}${sep}practice-panel-check-`)) {
      await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  }
}, 45000);
