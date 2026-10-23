// Real browser permission/crop/export checks. Only auth, history writes and HTTP are mocked.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
const {chromium}=createRequire('C:/Users/Plout/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json')('./index.js');
const prefix='virtual:community-access/';
const api='http://community-api.test';
const post={id:'post_'+'c'.repeat(32),assetId:'asset_'+'c'.repeat(32),title:'跨会员大图',publishedAt:1792713600000,author:{uid:'vip-author',displayName:'VIP作者',photoUrl:null},likeCount:0,favoriteCount:0,liked:false,favorited:false};
const modules={
  auth:"import{createContext,useContext}from'react';export const Auth=createContext({});export const useAuth=()=>useContext(Auth);",
  language:"export const useLanguage=()=>({language:'zh'});",
  history:"export async function saveExportedPatternRecord(){window.probe.archives++;return{id:'unexpected',syncState:'local-only'}}",
  entry:[
    "import React from'react';import{createRoot}from'react-dom/client';import'/src/index.css';",
    "import{Auth}from'"+prefix+"auth';import{CommunityView}from'/src/components/CommunityView.tsx';import{renderCommunityPattern}from'/src/utils/communityPatternSnapshot.ts';",
    "const palette=[{id:'a',code:'A01',name:'近白一',hex:'#FAF9F8',rgb:[250,249,248],brand:'MARD'},{id:'b',code:'A02',name:'近白二',hex:'#FAF9F7',rgb:[250,249,247],brand:'MARD'}];",
    "window.probe={archives:0,remixes:[],attempts:[],accept:true,upgrades:0,inventory:0};",
    "window.prepare=async(width,height)=>{const p={version:2,name:'原图',width,height,boardSize:26,brand:'MARD',createdAt:1,palette,settings:{width,height,brand:'MARD',boardSize:26,keepAspectRatio:true,dither:'none',colorLimit:0,brightness:0,contrast:0,saturation:0,transparentCutoff:128,colorMatchAlgo:'ciede2000',sharpening:0,outlineBoost:false,chromaKeyColor:null,chromaKeyTolerance:0},grid:Array.from({length:height},(_,y)=>Array.from({length:width},(_,x)=>(x+y)%3===0?null:x%2?'a':'b'))};probe.project=p;probe.before=JSON.stringify(p);return Array.from(new Uint8Array(await(await renderCommunityPattern(p)).arrayBuffer()))};",
    "function Harness(){const[auth,setAuth]=React.useState({currentUser:{uid:'viewer'},userProfile:{uid:'viewer'},isVip:false,isPro:false});window.setTier=(isVip,isPro=false)=>setAuth(a=>({...a,isVip,isPro}));return React.createElement(Auth.Provider,{value:auth},React.createElement(CommunityView,{onRemixPattern:p=>{probe.attempts.push(structuredClone(p));if(!probe.accept)return false;probe.remixes.push(structuredClone(p));return true},onNavigateToStudio:()=>{},onOpenAuthModal:()=>{},onOpenVipModal:()=>probe.upgrades++,onOpenInventory:()=>probe.inventory++}))};createRoot(document.getElementById('root')).render(React.createElement(Harness));",
  ].join('\n'),
};
let browser;
const errors=[];
const unexpected=[];
const server=await createServer({root:fileURLToPath(new URL('../../',import.meta.url)),configFile:false,envDir:false,logLevel:'error',define:{'import.meta.env.VITE_WORKER_API_URL':JSON.stringify(api)},plugins:[{name:'community-access',enforce:'pre',resolveId(id,importer){
  if(id.startsWith(prefix))return '\0'+id;
  if(id==='../context/AuthContext')return '\0'+prefix+'auth';
  if(id==='../context/LanguageContext')return '\0'+prefix+'language';
  if(importer?.endsWith('/ExportModal.tsx')&&id==='../utils/patternHistory')return '\0'+prefix+'history';
},load(id){if(id.startsWith('\0'+prefix))return modules[id.slice(prefix.length+1)]},configureServer(vite){vite.middlewares.use(async(q,res,next)=>{
  if(q.url!=='/__access')return next();res.setHeader('Content-Type','text/html');res.end(await vite.transformIndexHtml('/__access','<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/@id/'+prefix+'entry"></script></body></html>'));
})}},react(),tailwindcss()],server:{host:'127.0.0.1',port:0,hmr:false,watch:null}});
const deadline=setTimeout(()=>{console.error('Community access verification timeout');process.exit(1)},90000);deadline.unref();
try{
  await server.listen();const origin='http://127.0.0.1:'+server.httpServer.address().port;
  browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const page=await browser.newPage({viewport:{width:1394,height:982},acceptDownloads:true});page.setDefaultTimeout(8000);
  page.on('pageerror',e=>errors.push(e.message));
  let png;
  await page.route('**/*',async route=>{const req=route.request(),url=new URL(req.url());
    if(url.origin===origin&&!url.pathname.startsWith('/api/'))return route.continue();
    if(url.origin!==api||req.method()!=='GET'){unexpected.push(req.url());return route.abort()}
    const headers={'Access-Control-Allow-Origin':origin,'Cache-Control':'no-store'};
    if(url.pathname.endsWith('/assets/public'))return route.fulfill({headers,body:png,contentType:'image/png'});
    return route.fulfill({headers,json:{success:true,data:url.pathname.endsWith('/detail')?{post}:{posts:[post],nextCursor:null}}});
  });
  await page.goto(origin+'/__access',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.prepare&&window.setTier);
  const open=async(w,h,vip=false,pro=false)=>{await page.evaluate(({vip,pro})=>window.setTier(vip,pro),{vip,pro});png=Buffer.from(await page.evaluate(({w,h})=>window.prepare(w,h),{w,h}));await page.getByRole('button',{name:'查看图纸',exact:true}).click();await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='查看与实操'&&!b.disabled))};
  const practice=async()=>{await page.getByRole('button',{name:'查看与实操',exact:true}).click();await page.locator('.community-workspace[open]').waitFor()};
  const closeDetail=()=>page.getByRole('button',{name:'✕',exact:true}).click();
  await open(104,52);
  assert.equal(await page.getByRole('button',{name:'超出当前账号编辑上限',exact:true}).isDisabled(),true);
  await practice();assert.match(await page.locator('.community-workspace__identity').innerText(),/104 × 52/);
  assert.equal(await page.evaluate(()=>probe.remixes.length),0);
  await page.getByRole('button',{name:'开始计时',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.practice-panel__time').textContent!=='00:00:00');
  await page.getByRole('button',{name:'暂停计时',exact:true}).click();
  await page.locator('.practice-panel__color').first().click();assert.equal(await page.locator('.practice-panel__color[aria-pressed=true]').count(),1);
  assert.equal(await page.evaluate(()=>JSON.stringify(probe.project)===probe.before),true);
  console.log('PASS ordinary104x52 full read-only practice/timer/highlight; no editor import or original mutation');

  await page.getByRole('button',{name:'导出图纸',exact:true}).click();
  await page.locator('.export-modal-more').filter({hasText:'水印细节'}).locator('summary').click();
  assert.equal(await page.getByRole('switch',{name:'无水印导出',exact:true}).getAttribute('aria-checked'),'false');assert.equal(await page.getByLabel('水印文字').isDisabled(),true);
  await page.getByRole('button',{name:'极清图纸',exact:true}).click();assert.equal(await page.getByRole('button',{name:'高清图纸',exact:true}).getAttribute('aria-pressed'),'true');
  await page.getByRole('button',{name:'下载高清 PNG',exact:true}).click();const downloading=page.waitForEvent('download');
  await page.getByRole('button',{name:'确认下载带水印文件'}).click();await(await downloading).cancel();
  assert.equal(await page.evaluate(()=>probe.archives),0);await page.keyboard.press('Escape');
  await page.locator('.export-modal').waitFor({state:'detached'});assert.equal(await page.locator('.community-workspace[open]').count(),1);
  console.log('PASS real ordinary public PNG: own watermark/quality; zero editable auto-archives; Escape closes only export');

  await page.getByRole('tab',{name:'区域副本',exact:true}).click();
  for(const[label,value]of[['起始列','2'],['起始行','3'],['区域宽度','10'],['区域高度','8']])await page.getByLabel(label,{exact:true}).fill(value);
  await page.evaluate(()=>{probe.accept=false});await page.getByRole('button',{name:'创建区域副本并编辑',exact:true}).click();
  assert.equal(await page.locator('.community-workspace[open]').count(),1);assert.equal(await page.evaluate(()=>probe.remixes.length),0);
  await page.evaluate(()=>{probe.accept=true});await page.getByRole('button',{name:'创建区域副本并编辑',exact:true}).click();
  await page.locator('.community-workspace').waitFor({state:'detached'});
  const result=await page.evaluate(()=>({copy:probe.remixes.at(-1).project,source:probe.project,before:probe.before}));
  assert.deepEqual(result.copy.grid,result.source.grid.slice(2,10).map(row=>row.slice(1,11)));assert.deepEqual(result.copy.palette,result.source.palette);
  assert.equal(result.copy.width,10);assert.equal(result.copy.height,8);assert.match(result.copy.name,/区域副本/);assert.equal(JSON.stringify(result.source),result.before);
  assert.equal(result.copy.workId,undefined);assert.equal(result.copy.completionStatus,undefined);
  console.log('PASS exact10x8 crop at column2,row3 preserves IDs/nulls/palette; cancelled edit stays open; original unchanged');

  await open(400,1,true);assert.equal(await page.getByRole('button',{name:'载入完整图纸',exact:true}).isEnabled(),true);await closeDetail();
  await open(401,1,true);assert.equal(await page.getByRole('button',{name:'超出当前账号编辑上限',exact:true}).isDisabled(),true);await closeDetail();
  await open(900,1,true,true);assert.equal(await page.getByRole('button',{name:'载入完整图纸',exact:true}).isEnabled(),true);await closeDetail();
  await open(104,52,true);await page.getByRole('button',{name:'框选区域副本',exact:true}).click();await page.locator('.community-workspace[open]').waitFor();
  assert.equal(await page.getByLabel('区域宽度',{exact:true}).inputValue(),'104');await page.evaluate(()=>window.setTier(false,false));
  await page.waitForFunction(()=>document.querySelector('input[max="100"]')?.value==='100');
  assert.equal(await page.getByLabel('区域宽度',{exact:true}).inputValue(),'100');assert.equal(await page.getByRole('button',{name:'载入整张图纸编辑',exact:true}).count(),0);
  console.log('PASS VIP400 allowed/401 denied; Pro900 allowed; live downgrade clamps crop and removes full edit');

  await page.setViewportSize({width:390,height:844});
  assert.deepEqual(await page.locator('.community-workspace').evaluate(d=>({document:document.documentElement.scrollWidth,width:d.clientWidth,scroll:d.scrollWidth})),{document:390,width:390,scroll:390});
  if(process.env.COMMUNITY_PATTERN_EVIDENCE)await page.screenshot({path:process.env.COMMUNITY_PATTERN_EVIDENCE+'/large-crop-mobile.png',animations:'disabled'});
  await page.locator('.community-workspace').getByRole('button',{name:'查看会员权益',exact:true}).click();await page.locator('.community-workspace').waitFor({state:'detached'});assert.equal(await page.evaluate(()=>probe.upgrades),1);
  await open(104,52);await practice();await page.getByRole('button',{name:'管理豆仓',exact:true}).click();await page.locator('.community-workspace').waitFor({state:'detached'});
  assert.equal(await page.evaluate(()=>probe.inventory),1);assert.equal(await page.evaluate(()=>probe.archives),0);assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
  console.log('PASS mobile390; upgrade/inventory transitions; zero pageerror, production traffic, or project writes');
}finally{await browser?.close();await server.close();clearTimeout(deadline)}
