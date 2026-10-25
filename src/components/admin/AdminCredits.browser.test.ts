import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';

const projectRoot=fileURLToPath(new URL('../../../',import.meta.url));
const browser=process.env.ADMIN_CREDITS_TEST_BROWSER??[
  'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(existsSync);
it.skipIf(!browser).each([1280,390])('verifies dedicated credits UI with real offline DOM (%i px)',async width=>{
  const working=mkdtempSync(join(tmpdir(),'admin-credits-'));
  const require=createRequire(import.meta.url),{build}=createRequire(require.resolve('vite'))('esbuild');
  try {
    const bundle=await build({absWorkingDir:projectRoot,bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',
      define:{'process.env.NODE_ENV':'"development"'},stdin:{contents:`import { runAdminCreditsChecks } from './src/components/admin/AdminCredits.browser.fixture';
        runAdminCreditsChecks().then(report=>{parent.document.body.dataset.result='passed';parent.document.getElementById('result').textContent=JSON.stringify(report);})
        .catch(error=>{parent.document.body.dataset.result='failed';parent.document.getElementById('result').textContent=String(error.stack);});`,resolveDir:projectRoot,loader:'tsx'},
      plugins:[{name:'offline-css',setup(builder:any){builder.onLoad({filter:/\.css$/},()=>({contents:'',loader:'text'}));}}],
    });
    const script=bundle.outputFiles[0].text.replace(/<\/script/gi,'<\\/script');
    const css=['admin.css','AdminCredits.css'].map(file=>readFileSync(join(projectRoot,'src/components/admin',file),'utf8')).join('\n');
    const page=join(working,'admin.html');
    writeFileSync(page,`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none';">
      <style>body{margin:0}*{box-sizing:border-box}${css}</style><body><div id="root" class="admin-root"></div><script>${script}</script></body>`);
    const harness=join(working,'harness.html');
    writeFileSync(harness,`<!doctype html><meta charset="utf-8"><body><iframe style="width:${width}px;height:900px;border:0" src="${pathToFileURL(page).href}"></iframe><pre id="result">pending</pre></body>`);
    const output=execFileSync(browser!,['--headless=new','--allow-file-access-from-files','--disable-gpu','--disable-background-networking','--disable-component-update',
      '--disable-default-apps','--disable-extensions','--disable-sync','--no-first-run','--no-default-browser-check','--metrics-recording-only','--disable-breakpad',
      '--disable-domain-reliability','--disable-quic','--disable-features=NetworkPrediction,OptimizationHints,MediaRouter,AutofillServerCommunication',
      '--host-resolver-rules=MAP * ~NOTFOUND','--proxy-server=http://127.0.0.1:9','--proxy-bypass-list=<-loopback>',
      `--user-data-dir=${join(working,'browser-profile')}`,`--window-size=${width},900`,'--dump-dom','--virtual-time-budget=18000',pathToFileURL(harness).href],
      {encoding:'utf8',timeout:45000,maxBuffer:5*1024*1024,windowsHide:true,stdio:['ignore','pipe','pipe']});
    const reportText=output.match(/<pre id="result">([\s\S]*?)<\/pre>/)?.[1]??'browser did not finish';
    expect(output.includes('data-result="passed"'),reportText).toBe(true);
    const report=JSON.parse(reportText.replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&'));
    expect(report.checks.length).toBeGreaterThanOrEqual(45);expect(report.viewportWidth).toBe(width);expect(report.browserErrors).toEqual([]);
    console.log(`Credits browser ${width}px: ${report.checks.length} checks, ${report.writeCount} mock writes; no live requests.`);
  } finally {
    if(dirname(resolve(working))!==resolve(tmpdir())||!basename(working).startsWith('admin-credits-'))throw Error('Unexpected credits temp path');
    rmSync(working,{recursive:true,force:true});
  }
},60000);
