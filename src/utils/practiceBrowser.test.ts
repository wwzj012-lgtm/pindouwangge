import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import react from '@vitejs/plugin-react';
import { createServer } from 'vite';
import { expect, it } from 'vitest';

// Optional real-browser check: no downloaded dependencies, live accounts or production API calls.
const chromePath = process.env.PRACTICE_TEST_CHROME
  ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const harness = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {PracticePanel} from '/src/components/PracticePanel.tsx';
import {UserProfileModal} from '/src/components/UserProfileModal.tsx';
import * as store from '/src/utils/beadInventory.ts';
window.fetch=async()=>{throw new Error('Verification blocks all API requests')};
const colors=[
  {id:'MARD_A1',code:'A1',name:'奶黄',brand:'MARD',hex:'#FAF4C8',rgb:[250,244,200]},
  {id:'COCO_A1',code:'A1',name:'雪白',brand:'COCO',hex:'#FFFFFF',rgb:[255,255,255]},
  {id:'MARD_A2',code:'A2',name:'红色',brand:'MARD',hex:'#FF5555',rgb:[255,85,85]}
];
const stock={A1:{colorId:'MARD_A1',code:'A1',name:'奶黄',hex:'#FAF4C8',count:3,alertThreshold:100}};
const host=document.getElementById('root'),root=createRoot(host);
const defaults={grid:[['MARD_A1','MARD_A1','COCO_A1','MARD_A2']],paletteMap:new Map(colors.map(c=>[c.id,c])),workKey:'browser-test',userId:'alice',detailsUnlocked:true,activeColorId:null,onHighlightColor:id=>window.highlighted=id,onClose:()=>root.render(null),onOpenInventory:()=>window.inventoryOpened=true};
window.probe={store,stock,mount:props=>root.render(React.createElement(PracticePanel,{...defaults,...props})),profile:props=>root.render(React.createElement(UserProfileModal,{isOpen:true,onClose:()=>{},onOpenAccountManagement:()=>{},...props})),size:(w,h)=>{host.style.width=w+'px';host.style.height=h+'px'}};
probe.size(360,800);probe.mount();
`;

it.skipIf(!existsSync(chromePath))('drives real practice UI, live inventory, timer, login guard and container layouts', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'practice-panel-check-'));
  const server = await createServer({
    configFile: false,
    server: { host: '127.0.0.1', port: 0 },
    plugins: [react(), {
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
        if (await evaluate('Boolean(window.probe&&document.querySelector(".practice-panel"))', sessionId)) return sessionId as string;
        await wait(100);
      }
      throw new Error(`Harness failed: ${await evaluate('JSON.stringify(window.probeErrors)', sessionId)}`);
    };
    const session = await tab();
    const run = async (code: string) => {
      checks.push(...await evaluate(`(async()=>{const results=[];const check=(condition,label)=>{if(!condition)throw new Error(label);results.push(label)};const wait=()=>new Promise(r=>setTimeout(r,90));${code};return results})()`, session));
    };

    await run(`
      probe.store.writeBeadInventory(probe.stock);await wait();
      check(document.querySelectorAll('.practice-panel__color').length===3,'all demanded colors');
      check(document.querySelector('.practice-panel__stock-totals').textContent.includes('匹配库存3'),'existing global stock');
      check(document.querySelector('.practice-panel__color').textContent.includes('未录入'),'shortage first');
      document.querySelector('.practice-panel__color').click();check(window.highlighted==='COCO_A1','exact ID highlight');
      const input=document.querySelector('input[type=search]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'COCO');input.dispatchEvent(new Event('input',{bubbles:true}));await wait();
      check(document.querySelectorAll('.practice-panel__color').length===1,'real search input');
      let copied='';Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{copied=value}}});
      document.querySelector('.practice-panel__copy').click();await wait();check(copied.includes('COCO A1')&&copied.includes('MARD A2'),'copy all shortages beyond filter');
      document.querySelector('.practice-panel__text-button').click();check(window.inventoryOpened,'inventory callback');
      probe.mount({detailsUnlocked:false});await wait();check(!document.querySelector('input,textarea,.practice-panel__color,.practice-panel__copy'),'locked detail outlets absent');check(!document.querySelector('.practice-panel').textContent.includes('A1'),'locked DOM no codes');
      probe.mount();await wait();
      document.querySelector('.practice-panel__primary').click();await new Promise(r=>setTimeout(r,1180));
      check(document.querySelector('.practice-panel__time').textContent==='00:00:01','actual elapsed clock');
      document.querySelector('[aria-label="关闭实操面板"]').click();await wait();
      const key='beadgrid_practice_timer_v1:'+encodeURIComponent(JSON.stringify(['alice','browser-test']));const elapsed=JSON.parse(localStorage.getItem(key)).elapsedMs;
      check(elapsed>=1100&&elapsed<2200,'close stores milliseconds');check(window.highlighted==='COCO_A1','close preserves highlight');
      await new Promise(r=>setTimeout(r,500));probe.mount();await wait();check(document.querySelector('.practice-panel__primary').textContent==='开始计时','reopen paused');check(JSON.parse(localStorage.getItem(key)).elapsedMs===elapsed,'closed time excluded');
      probe.mount({workKey:'other'});await wait();check(document.querySelector('.practice-panel__time').textContent==='00:00:00','work isolation');
      probe.mount({userId:'bob'});await wait();check(document.querySelector('.practice-panel__time').textContent==='00:00:00','user isolation');
      probe.mount();await wait();document.querySelector('[aria-label="重置计时"]').click();await wait();
      check(document.querySelector('.practice-reset-dialog').open,'reset confirmation is visible');
      check(document.querySelector('.practice-panel__time').textContent!=='00:00:00','reset waits for user confirmation');
      document.querySelector('.practice-reset-dialog__actions button:last-child').click();await wait();
      check(document.querySelector('.practice-panel__time').textContent==='00:00:00','reset timer after confirmation');
    `);
    const second = await tab();
    await evaluate('probe.store.writeBeadInventory({...probe.stock,A1:{...probe.stock.A1,count:17}})', second);
    await run(`
      await wait();check(document.querySelector('.practice-panel__stock-totals').textContent.includes('匹配库存17'),'cross-window live stock');
      probe.store.writeBeadInventory({...probe.stock,A1:{...probe.stock.A1,count:9}});await wait();check(document.querySelector('.practice-panel__stock-totals').textContent.includes('匹配库存9'),'same-window live stock');
      const original=localStorage.getItem(probe.store.INVENTORY_STORAGE_KEY);let unauthorized=0;window.addEventListener('unauthorized',()=>unauthorized++);
      probe.profile({initialTab:'inventory'});await wait();check(document.body.textContent.includes('豆仓 · 我的库存'),'initialTab inventory');
      document.querySelector('button[aria-label="A1 增加100粒"]').click();await wait();check(unauthorized===1,'anonymous login guard');check(localStorage.getItem(probe.store.INVENTORY_STORAGE_KEY)===original,'guard prevents stock write');
      probe.profile({isOpen:false,initialTab:'library'});await wait();probe.profile({isOpen:true,initialTab:'library'});await wait();check(!document.body.textContent.includes('豆仓 · 我的库存'),'reopen library target');
      probe.profile({isOpen:false,initialTab:'inventory'});await wait();probe.profile({isOpen:true,initialTab:'inventory'});await wait();check(document.body.textContent.includes('豆仓 · 我的库存'),'reopen inventory target');
      probe.mount();await wait();
    `);
    for (const [width, height, containerHeight, label] of [[1280, 1000, 800, 'desktop'], [390, 844, 337, 'phone']] as const) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 768 }, session);
      const containerWidth = width < 768 ? width : 360;
      await evaluate(`probe.size(${containerWidth},${containerHeight})`, session);
      await run(`
        await wait();const p=document.querySelector('.practice-panel'),r=p.getBoundingClientRect();
        check(getComputedStyle(p).position==='relative','${label} relative positioning');
        check(r.height<=${containerHeight}+1&&r.width<=${containerWidth}+1,'${label} parent containment');
        check(p.scrollWidth<=p.clientWidth+1,'${label} no horizontal overflow');
        const body=document.querySelector('.practice-panel__body');check(body.scrollHeight>body.clientHeight,'${label} internal scrolling');
      `);
      if (process.env.PRACTICE_TEST_SCREENSHOTS === '1') {
        const shot = await send('Page.captureScreenshot', { format: 'png' }, session);
        await writeFile(join(tmpdir(), `practice-panel-${label}.png`), Buffer.from(shot.data, 'base64'));
      }
    }
    expect(checks.length).toBeGreaterThanOrEqual(30);
    console.info(`Practice browser: ${checks.length} checks passed; ${checks.join(', ')}`);
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
