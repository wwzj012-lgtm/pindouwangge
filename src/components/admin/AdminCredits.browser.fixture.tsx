import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { AdminCredits } from './AdminCredits';
import type { AdminRequest } from './adminRequest';
import { readCreditRecovery, saveCreditRecovery, type CreditAccount, type CreditAdjustmentBody } from './adminCreditsModel';

export async function runAdminCreditsChecks() {
  const checks:string[]=[],browserErrors:string[]=[];
  window.addEventListener('error',e=>browserErrors.push(e.message));
  const check=(condition:unknown,label:string)=>{if(!condition)throw Error(label);checks.push(label);};
  const tick=()=>new Promise(r=>setTimeout(r,20));
  const wait=async(predicate:()=>unknown,label='DOM wait')=>{for(let i=0;i<100;i++){if(predicate())return;await tick();}throw Error(label);};
  const text=()=>document.getElementById('root')!.textContent??'';
  const requests:Array<{path:string;body?:CreditAdjustmentBody}>=[],writes:CreditAdjustmentBody[]=[];
  let operator='credit-operator',canRead=true,canAdjust=true,liveAvailable=123;
  let mode:'success'|'unknown'|'throw'|'malformed'|'deny'|'pending'='success';
  let lookup:'not_found'|'completed'|'fail'='not_found';
  let pendingPost:((result:unknown)=>void)|undefined;
  let delayA=false,lateA:((result:unknown)=>void)|undefined;
  const account=(uid='target'):CreditAccount=>({uid,email:uid+'@test.invalid',displayName:uid==='target'?'张三':'李四',availableUnits:liveAvailable,heldUnits:20,version:writes.filter(w=>w.uid===uid).length,unitsPerPoint:10});
  const adjustment=(body:CreditAdjustmentBody)=>({id:'audit-'+writes.length,operatorUid:operator,...body,
    beforeAvailableUnits:body.expectedAvailableUnits,afterAvailableUnits:body.expectedAvailableUnits+body.deltaUnits,
    heldUnits:body.expectedHeldUnits,beforeVersion:body.expectedVersion,afterVersion:body.expectedVersion+1,createdAt:Date.now(),unitsPerPoint:10});
  const success=(data:unknown)=>({ok:true,status:200,data});
  const request=(async(path:string,init?:RequestInit)=>{
    const body=init?.body?JSON.parse(String(init.body)) as CreditAdjustmentBody:undefined;requests.push({path,body});
    if(path.startsWith('/api/admin/credits/adjustment?')) {
      if(lookup==='fail')return {ok:false,status:503,error:'服务不可用'};
      return success(lookup==='completed'?{status:'completed',adjustment:adjustment(writes.at(-1)!)}:{status:'not_found'});
    }
    if(body){
      writes.push(body);
      if(mode==='pending')return new Promise(resolve=>{pendingPost=resolve;});
      if(mode==='throw')throw Error('offline');
      if(mode==='unknown')return {ok:false,status:0};
      if(mode==='malformed')return success({notAnAdjustment:true});
      if(mode==='deny')return {ok:false,status:409,error:'账户余额或版本已变化'};
      liveAvailable=body.expectedAvailableUnits+body.deltaUnits;return {ok:true,status:201,data:adjustment(body)};
    }
    if(path.includes('/credits/accounts?'))return success({items:[account(),account('other')],total:40,limit:20,offset:Number(new URL('https://x'+path).searchParams.get('offset'))});
    if(path.includes('/credits/account?')){
      const uid=new URL('https://x'+path).searchParams.get('uid')!;
      if(delayA&&uid==='target')return new Promise(resolve=>{lateA=resolve;});
      return success({account:account(uid)});
    }
    return success({items:[{operationId:'operation-1',entryKind:'SETTLE',type:'consumption',uid:'target',email:'target@test.invalid',displayName:'张三',purpose:'图纸完成或升级',referenceType:'pattern_entitlement',referenceId:'pattern-1',deltaAvailableUnits:-7,deltaHeldUnits:0,consumedUnits:7,createdAt:Date.UTC(2026,9,25),bucketCount:2}],total:25,limit:20,offset:0,unitsPerPoint:10});
  }) as AdminRequest;
  const root=createRoot(document.getElementById('root')!);
  const render=()=>flushSync(()=>root.render(<AdminCredits request={request} canRead={canRead} canAdjust={canAdjust} operatorUid={operator}/>));
  const button=(label:string,container:ParentNode|null=document)=>container?Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(b=>b.textContent?.trim()===label):undefined;
  const click=(label:string,container:ParentNode=document)=>{const b=button(label,container);if(!b)throw Error('Missing button '+label);flushSync(()=>b.click());};
  const field=(label:string)=>Array.from(document.querySelectorAll<HTMLLabelElement>('.admin-credits label')).find(l=>l.textContent?.startsWith(label))?.querySelector<HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement>('input,select,textarea');
  const set=(label:string,value:string)=>{
    const el=field(label);if(!el)throw Error('Missing field '+label);
    const proto=el instanceof HTMLSelectElement?HTMLSelectElement.prototype:el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
    flushSync(()=>{Object.getOwnPropertyDescriptor(proto,'value')!.set!.call(el,value);el.dispatchEvent(new Event(el instanceof HTMLSelectElement?'change':'input',{bubbles:true}));});
  };
  const submit=(label:string)=>{const form=document.querySelector<HTMLFormElement>(`form[aria-label="${label}"]`)!;flushSync(()=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));};
  const selectUser=async(uid='target')=>{const b=document.querySelector<HTMLButtonElement>(`[data-credit-user="${uid}"]`)!;flushSync(()=>b.click());await wait(()=>document.querySelector('[data-credit-selected]')?.textContent?.includes(uid));};
  const prepare=async(amount='0.1',reason='核实积分补偿')=>{await selectUser();set('调整积分',amount);set('调整原因',reason);submit('填写积分调整');await wait(()=>document.querySelector('[role="dialog"]'));};
  const dialog=()=>document.querySelector<HTMLElement>('[role="dialog"]')!;

  saveCreditRecovery(operator,null);saveCreditRecovery('second-operator',null);
  render();await wait(()=>document.querySelector('[data-credit-user="target"]'));
  check(text().includes('图纸完成或升级')&&text().includes('张三'),'real consumer purpose and identity rendered');
  check(text().includes('-0.7'),'consumption units convert to 0.7 points');
  check(!text().includes('NaN'),'no invalid amount on initial render');
  await selectUser();check(text().includes('12.3')&&text().includes('冻结积分')&&text().includes('2'),'available and held amounts use ten-unit scale');
  set('调整积分','0.01');set('调整原因','测试');submit('填写积分调整');
  check(text().includes('最多一位小数'),'reject precision without request');check(writes.length===0,'invalid precision sends no write');
  set('调整积分','0.1');set('调整原因','   ');submit('填写积分调整');check(text().includes('调整原因'),'reason required');check(!dialog(),'missing reason has no confirmation');
  set('调整方式','subtract');set('调整积分','99');set('调整原因','不能动冻结');submit('填写积分调整');
  check(text().includes('不能为负数'),'reject overdraft');check(writes.length===0,'overdraft sends no write');
  set('调整积分','0.1');set('调整原因','核实调减');submit('填写积分调整');await wait(()=>dialog());
  check(dialog().textContent?.includes('12.3 → 12.2'),'confirmation shows exact before and after');
  check(dialog().textContent?.includes('冻结积分保持 2'),'confirmation preserves held units');
  check(dialog().textContent?.includes('target')&&dialog().textContent?.includes('核实调减'),'confirmation shows target and reason');
  click('取消',dialog());check(writes.length===0,'cancel sends no write');
  submit('填写积分调整');await wait(()=>dialog());mode='pending';click('确认调整',dialog());
  check(!!button('确认调整',dialog())?.disabled,'pending submit disables double click');
  button('确认调整',dialog())?.click();check(writes.length===1,'one confirmed write despite repeated click');
  check(writes[0].deltaUnits===-1&&writes[0].expectedHeldUnits===20,'body has integer unit and held snapshot');
  check(writes[0].expectedAvailableUnits===123&&writes[0].idempotencyKey.length>=16,'body has confirmation and unique key');
  check(readCreditRecovery(operator).body?.idempotencyKey===writes[0].idempotencyKey,'intent persisted before response');
  liveAvailable=122;pendingPost!(success(adjustment(writes[0])));await wait(()=>document.querySelector('[data-credit-success]'));
  check(text().includes('12.3 → 12.2'),'success reports real before and after');check(readCreditRecovery(operator).body===null,'confirmed completion clears recovery');

  mode='unknown';await prepare('0.1','网络中断补偿');click('确认调整',dialog());await wait(()=>!dialog()&&text().includes('有一笔调整等待核查'));
  const frozen={...writes.at(-1)!};check(!!document.querySelector('fieldset:disabled'),'unknown outcome blocks new adjustment');
  const writeCount=writes.length;await tick();check(writes.length===writeCount,'no automatic write retry');
  lookup='not_found';click('查询原请求结果');await wait(()=>text().includes('尚未查到'));
  check(readCreditRecovery(operator).body?.idempotencyKey===frozen.idempotencyKey,'not_found keeps original key');
  check(!!document.querySelector('fieldset:disabled'),'not_found cannot unlock fresh debit');
  canRead=false;render();check(!text().includes('target@test.invalid'),'read permission loss clears private content');
  check(text().includes('没有查看积分的权限'),'missing read permission denies UI');
  const beforeNoAccess=requests.length;await tick();check(requests.length===beforeNoAccess,'missing read permission sends no requests');
  canRead=true;render();await wait(()=>text().includes('有一笔调整等待核查'));
  check(readCreditRecovery(operator).body?.idempotencyKey===frozen.idempotencyKey,'remount recovers original request');
  click('原样重试（同一请求）');await wait(()=>dialog());check(dialog().textContent?.includes('复用原请求及幂等键'),'retry has explicit same-key confirmation');
  mode='deny';click('确认原样重试',dialog());await wait(()=>!dialog());
  check(JSON.stringify(writes.at(-1))===JSON.stringify(frozen),'retry sends byte-equivalent original body');
  check(readCreditRecovery(operator).body!==null,'retry rejection cannot erase uncertain original');
  lookup='fail';click('查询原请求结果');await wait(()=>text().includes('暂时无法确认'));
  check(readCreditRecovery(operator).body!==null,'failed lookup retains intent');
  lookup='completed';click('查询原请求结果');await wait(()=>document.querySelector('[data-credit-success]'));
  check(readCreditRecovery(operator).body===null,'lookup completion clears intent');

  mode='deny';await prepare('0.1','余额冲突');click('确认调整',dialog());await wait(()=>!dialog()&&text().includes('账户余额或版本已变化'));
  check(readCreditRecovery(operator).body===null,'definitive first-request 409 releases intent');
  mode='malformed';await prepare('0.1','错误响应');click('确认调整',dialog());await wait(()=>!dialog()&&text().includes('有一笔调整等待核查'));
  check(readCreditRecovery(operator).body!==null,'malformed success treated as unknown');
  const originalOperator=operator;operator='second-operator';render();
  check(!text().includes('错误响应')&&!text().includes('待核查积分调整'),'operator switch hides original adjustment immediately');
  await wait(()=>document.querySelector('[data-credit-user="target"]'));check(!document.querySelector('[aria-label="待核查积分调整"]'),'operator switch isolates recovery');
  await selectUser();check(!document.querySelector('fieldset:disabled'),'new operator has independent adjustment scope');
  canAdjust=false;render();await wait(()=>document.querySelector('[data-credit-user="target"]'));await selectUser();
  check(text().includes('当前为只读权限'),'write permission loss shows read-only state');check(!document.querySelector('form[aria-label="填写积分调整"]'),'read-only has no editable adjustment form');
  const beforeReadonly=writes.length;await tick();check(writes.length===beforeReadonly,'readonly never sends writes');

  canAdjust=true;render();await wait(()=>document.querySelector('[data-credit-user="target"]'));
  delayA=true;flushSync(()=>document.querySelector<HTMLButtonElement>('[data-credit-user="target"]')!.click());await wait(()=>lateA);
  await selectUser('other');lateA!(success({account:account('target')}));await tick();
  check(document.querySelector('[data-credit-selected]')?.textContent?.includes('other'),'late account detail never replaces new selection');
  delayA=false;click('查看全部用户记录');
  set('搜索用户',' 张三 ');set('记录类型','adjustment');set('开始时间','2026-10-20T12:00');set('结束时间','2026-10-26T12:00');submit('积分筛选');
  await wait(()=>requests.some(r=>r.path.includes('type=adjustment')));
  const lastLedger=[...requests].reverse().find(r=>r.path.includes('/ledger?'))!;
  const query=new URL('https://x'+lastLedger.path).searchParams;
  check(query.get('q')==='张三'&&query.get('type')==='adjustment','user and type filters sent');
  check(query.get('from')===String(new Date('2026-10-20T12:00').getTime()),'from uses local date converted to epoch milliseconds');
  check(query.get('to')===String(new Date('2026-10-26T12:00').getTime()),'to is exclusive epoch boundary');
  check(!query.has('uid'),'all-user view clears selected uid filter');
  await wait(()=>button('下一页',document.querySelector('[aria-label="记录分页"]')!));click('下一页',document.querySelector('[aria-label="记录分页"]')!);
  await wait(()=>requests.some(r=>r.path.includes('/ledger?')&&r.path.includes('offset=20')));check(true,'ledger pagination requests actual next page');
  await wait(()=>button('下一页',document.querySelector('[aria-label="账户分页"]')!));click('下一页',document.querySelector('[aria-label="账户分页"]')!);
  await wait(()=>requests.some(r=>r.path.includes('/accounts?')&&r.path.includes('offset=20')));check(true,'account pagination requests actual next page');
  set('开始时间','2026-10-27T12:00');submit('积分筛选');check(text().includes('开始时间必须早于结束时间'),'invalid time range rejected locally');
  check(document.documentElement.scrollWidth<=window.innerWidth,'responsive page has no horizontal viewport overflow');
  saveCreditRecovery(originalOperator,null);saveCreditRecovery(operator,null);flushSync(()=>root.unmount());
  return {checks,browserErrors,viewportWidth:window.innerWidth,writeCount:writes.length};
}
