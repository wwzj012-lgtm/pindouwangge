import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import react from '@vitejs/plugin-react';
import { createServer } from 'vite';
import { expect, it } from 'vitest';

// Optional native-Chrome interactions: bundled runtime, no installs or API calls.
const runtime = process.env.COMMUNITY_CANVAS_PLAYWRIGHT
  ?? 'C:/Users/Plout/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json';
const chrome = process.env.COMMUNITY_CANVAS_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const harness = "import React,{useState} from 'react';\nimport {createRoot} from 'react-dom/client';\nimport {CommunityPatternCanvas} from '/src/components/CommunityPatternCanvas.tsx';\nconst palette=[{id:'white',code:'A1',name:'白',hex:'#FFFFFF',rgb:[255,255,255],brand:'MARD'},{id:'other-white',code:'A1',name:'近白',hex:'#FEFEFE',rgb:[254,254,254],brand:'COCO'},{id:'red',code:'R1',name:'红',hex:'#FF0000',rgb:[255,0,0],brand:'MARD'}];\nfunction make(width=8,height=6){return {version:2,name:'fixture',width,height,boardSize:29,brand:'MARD',settings:{},createdAt:1,palette,grid:Array.from({length:height},(_,y)=>Array.from({length:width},(_,x)=>[null,'white','other-white','red'][(x+y)%4]))}}\nfunction freeze(v){if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v)}return v}\nconst project=freeze(make());\nwindow.probe={project,before:JSON.stringify(project),events:[],draws:[],sources:[],codes:[],patch:null,large:()=>freeze(make(900,900))};\nconst draw=CanvasRenderingContext2D.prototype.drawImage;CanvasRenderingContext2D.prototype.drawImage=function(source,...args){if(this.canvas.isConnected){probe.draws.push(args);if(!probe.sources.includes(source))probe.sources.push(source)}return draw.call(this,source,...args)};\nconst text=CanvasRenderingContext2D.prototype.fillText;CanvasRenderingContext2D.prototype.fillText=function(code,...args){if(this.canvas.isConnected)probe.codes.push(code);return text.call(this,code,...args)};\nfunction Harness(){const [props,setProps]=useState({project,selecting:true,maxSelectionSide:3,selection:null});probe.patch=next=>setProps(p=>({...p,...next}));return React.createElement(CommunityPatternCanvas,{...props,onSelectionChange:s=>{probe.events.push({...s});setProps(p=>({...p,selection:s}))}})}\ncreateRoot(document.getElementById('root')).render(React.createElement(Harness));";

it.skipIf(!existsSync(runtime) || !existsSync(chrome))('drives raw pixels, bounded crops, pan/zoom, touch pinch, DPR and 900² viewport', async () => {
  const { chromium } = createRequire(runtime)('./index.js');
  const server = await createServer({ configFile: false, server: { host: '127.0.0.1', port: 0 }, plugins: [react(), {
    name: 'community-canvas-check',
    resolveId(id) { if (id === '/__canvas_harness.js') return '\0canvas-harness'; },
    load(id) { if (id === '\0canvas-harness') return harness; },
    configureServer(vite) { vite.middlewares.use(async (req,res,next) => {
      if (req.url !== '/__canvas_check') return next();
      res.setHeader('Content-Type','text/html');
      res.end(await vite.transformIndexHtml(req.url,'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:12px;box-sizing:border-box}#root{width:100%;max-width:800px}</style></head><body><div id="root"></div><script type="module" src="/__canvas_harness.js"></script></body></html>'));
    }); },
  }] });
  let browser: any;
  try {
    await server.listen(); const address=server.httpServer!.address();
    const origin='http://127.0.0.1:'+(typeof address==='object'&&address?address.port:0);
    browser=await chromium.launch({executablePath:chrome,headless:true});
    const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:3,hasTouch:true});
    const page=await context.newPage(); const errors:string[]=[];
    page.on('pageerror',(e:Error)=>errors.push(e.message));
    await context.route('**/*',(r:any)=>r.request().url().startsWith(origin)?r.continue():r.abort());
    await page.goto(origin+'/__canvas_check'); await page.waitForFunction(()=>(window as any).probe?.sources.length>0);
    const settle=()=>page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
    const patch=async(value:Record<string,unknown>)=>{await page.evaluate(v=>(window as any).probe.patch(v),value);await settle();};
    const fit=async()=>{await page.getByRole('button',{name:'适应图纸'}).click();await settle();};
    const cell=async(x:number,y:number)=>page.locator('canvas').evaluate((canvas:HTMLCanvasElement,xy:number[])=>{
      const p=(window as any).probe.project,r=canvas.getBoundingClientRect();
      const z=Math.min(64,(r.width-40)/p.width,(r.height-40)/p.height);
      return {x:r.x+(r.width-p.width*z)/2+(xy[0]+0.5)*z,y:r.y+(r.height-p.height*z)/2+(xy[1]+0.5)*z};
    },[x,y]);
    const drag=async(a:any,b:any,button='left')=>{await page.mouse.move(a.x,a.y);await page.mouse.down({button});await page.mouse.move(b.x,b.y,{steps:4});await page.mouse.up({button});await settle();};
    const events=()=>page.evaluate(()=>(window as any).probe.events);
    await settle();
    const raw=await page.evaluate(()=>{
      const p=(window as any).probe,s=p.sources[0],c=document.querySelector('canvas')!;
      return {source:[s.width,s.height],pixels:Array.from(s.getContext('2d').getImageData(0,0,4,1).data),codes:p.codes,
        css:[c.clientWidth,c.clientHeight],backing:[c.width,c.height],overflow:document.documentElement.scrollWidth>innerWidth,
        targets:Array.from(document.querySelectorAll('button')).map(b=>[b.offsetWidth,b.offsetHeight])};
    });
    expect(raw.source).toEqual([8,6]);
    expect(raw.pixels).toEqual([0,0,0,0,255,255,255,255,254,254,254,255,255,0,0,255]);
    expect(raw.codes).toContain('A1');expect(raw.codes).toContain('R1');expect(raw.overflow).toBe(false);
    expect(raw.backing).toEqual(raw.css.map((n:number)=>n*2));
    expect(raw.targets.every((s:number[])=>s.every(n=>n>=44))).toBe(true);
    const hover=await cell(2,0);await page.mouse.move(hover.x,hover.y);
    await expect.poll(()=>page.locator('.community-pattern-canvas__status').textContent()).toContain('列 3 · 行 1 · A1 (other-white)');
    await patch({highlightColorId:'white'});
    const mask:number[]=await page.evaluate(()=>Array.from((window as any).probe.sources.at(-1).getContext('2d').getImageData(0,0,4,1).data));
    expect(mask[7]).toBe(255);expect(mask[4]).toBeLessThan(250);expect(mask[5]).toBeLessThan(mask[6]);
    expect(mask.slice(8,16)).toEqual([0,0,0,0,0,0,0,0]);await patch({highlightColorId:null});
    for(const [ax,ay,bx,by] of [[1,1,5,4],[5,4,1,1],[1,4,5,1],[5,1,1,4]]){
      await drag(await cell(ax,ay),await cell(bx,by));
      expect((await events()).at(-1)).toEqual({x:bx>ax?ax:ax-2,y:by>ay?ay:ay-2,width:3,height:3});
    }
    await patch({maxSelectionSide:900});await drag(await cell(3,2),{x:-200,y:-200});
    expect((await events()).at(-1)).toEqual({x:0,y:0,width:4,height:3});
    await patch({maxSelectionSide:0});const from=await cell(3,2),to=await cell(6,5);
    await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(to.x,to.y);await settle();
    expect((await events()).at(-1)).toEqual({x:3,y:2,width:1,height:1});
    await expect.poll(()=>page.locator('.community-pattern-canvas__status').textContent()).toContain('选区 1 × 1 格');await page.mouse.up();
    const count=(await events()).length;
    await page.getByRole('button',{name:'放大图纸'}).click();await page.getByRole('button',{name:'缩小图纸'}).click();await fit();
    await page.keyboard.down('Shift');await drag(from,{x:from.x+15,y:from.y+10});await page.keyboard.up('Shift');
    await drag(from,{x:-3000,y:-3000},'right');await page.mouse.move(150,250);await page.mouse.wheel(0,-100);await settle();
    expect((await events()).length).toBe(count);
    expect(await page.evaluate(()=>{const a=(window as any).probe.draws.at(-1);return a[2]>0&&a[3]>0;})).toBe(true);
    expect(await page.locator('canvas').evaluate((c:HTMLCanvasElement)=>!c.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true})))).toBe(true);
    await fit();await expect.poll(()=>page.getByLabel('视图缩放').textContent()).toBe('100%');
    const client=await context.newCDPSession(page),center=await cell(3,2);
    const touch=(x:number,y:number,id:number)=>({x,y,id,radiusX:2,radiusY:2});
    await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[touch(center.x-25,center.y,1)]});
    await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[touch(center.x-25,center.y,1),touch(center.x+25,center.y,2)]});
    await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[touch(center.x-50,center.y,1),touch(center.x+50,center.y,2)]});
    await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await settle();
    expect((await events()).length).toBe(count);expect(parseInt(await page.getByLabel('视图缩放').textContent())).toBeGreaterThan(100);
    await fit();const start=await cell(1,1),end=await cell(3,3);await patch({maxSelectionSide:3});
    await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[touch(start.x,start.y,1)]});
    await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[touch(end.x,end.y,1)]});
    await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await settle();
    expect((await events()).at(-1)).toEqual({x:1,y:1,width:3,height:3});
    await page.setViewportSize({width:650,height:800});await settle();await expect.poll(()=>page.getByLabel('视图缩放').textContent()).toBe('100%');
    await page.evaluate(()=>{const p=(window as any).probe;p.sources=[];p.draws=[];p.patch({project:p.large(),selecting:false});});await settle();
    expect(await page.locator('canvas').count()).toBe(1);
    expect(await page.evaluate(()=>{const s=(window as any).probe.sources.at(-1);return [s.width,s.height];})).toEqual([900,900]);
    for(let i=0;i<18;i++)await page.getByRole('button',{name:'放大图纸'}).click();await settle();
    const drawn=await page.evaluate(()=>(window as any).probe.draws.at(-1));
    expect(drawn[2]).toBeLessThan(100);expect(drawn[3]).toBeLessThan(100);
    expect(await page.locator('.community-pattern-canvas *').count()).toBeLessThan(25);
    expect(await page.evaluate(()=>JSON.stringify((window as any).probe.project)===(window as any).probe.before)).toBe(true);
    expect(errors).toEqual([]);
  }finally{await browser?.close();await server.close();}
},60_000);
