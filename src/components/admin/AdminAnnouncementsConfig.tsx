import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react';
import type { AdminRequest } from './adminRequest';
import { AdminBadge, AdminButton, AdminEmptyState, AdminErrorState, AdminLoading, AdminToolbar } from './AdminPrimitives';
import { ContentDrawer, parseJsonDraft, useContentWrite } from './AdminContentFlow';
import { LatestRequest, dateText } from './adminUserModel';

type Mode = 'announcements' | 'config';
type AnnouncementStatus = 'draft' | 'scheduled' | 'published' | 'withdrawn';
interface Paginated<T> { items: T[]; total: number; limit: number; offset: number; }
interface Announcement { id: string; title: string; body: string; status: AnnouncementStatus; pinned?: boolean; isPinned?: boolean; audience: string; publishAt?: number | null; expireAt?: number | null; createdAt: number; updatedAt: number; }
interface FeatureFlag { key: string; enabled: boolean; description: string; config: unknown; updatedBy?: string | null; updatedAt?: number; }
interface SystemSetting { key: string; value: unknown; description: string; updatedBy?: string | null; updatedAt?: number; }
const PAGE_SIZE = 20;
const KEY_PATTERN = /^[a-z][a-z0-9_.-]{0,79}$/;
const toInputTime = (value?: number | null) => { if (!value) return ''; const date = new Date(value - new Date(value).getTimezoneOffset() * 60_000); return date.toISOString().slice(0,16); };
const parseInputTime = (value: string) => value ? new Date(value).getTime() : null;
const statusLabel = (status: string) => ({draft:'草稿',scheduled:'定时',published:'已发布',withdrawn:'已撤回'}[status] ?? status);

function Pager({ page, total, busy, change }: { page: number; total: number; busy: boolean; change: (page: number) => void }) {
  return <div className="admin-pagination"><span>共{total}条 · {page}/{Math.max(1,Math.ceil(total/PAGE_SIZE))}页</span><div><AdminButton iconOnly aria-label="上一页" disabled={busy || page<=1} onClick={()=>change(page-1)}><ChevronLeft aria-hidden="true" /></AdminButton><AdminButton iconOnly aria-label="下一页" disabled={busy || page>=Math.ceil(total/PAGE_SIZE)} onClick={()=>change(page+1)}><ChevronRight aria-hidden="true" /></AdminButton></div></div>;
}
interface AnnouncementForm { id?: string; title: string; content: string; status: AnnouncementStatus; publishAt: string; expireAt: string; audience: string; pinned: boolean; }
const emptyAnnouncement = (): AnnouncementForm => ({title:'',content:'',status:'draft',publishAt:'',expireAt:'',audience:'all',pinned:false});
function AnnouncementEditor({ form, setForm, close, save, busy }: { form: AnnouncementForm; setForm: (value: any) => void; close: ()=>void; save: ()=>void; busy: boolean }) {
  const [preview,setPreview]=useState(false);
  const start=parseInputTime(form.publishAt),end=parseInputTime(form.expireAt);
  const timeError=start!==null&&!Number.isFinite(start)||end!==null&&!Number.isFinite(end)?'日期无效。':start!==null&&end!==null&&end<=start?'结束时间必须晚于发布时间。':'';
  return <ContentDrawer title={form.id?'编辑公告内容':'新建公告草稿'} description="编辑与发布操作分开。保存保留现有发布状态；发布/撤回通过独立复核按钮。" busy={busy} onClose={close}>
    <div className="admin-final-fields"><label>标题<input data-announcement-title value={form.title} maxLength={160} disabled={busy} onChange={e=>setForm((f:AnnouncementForm)=>({...f,title:e.target.value}))}/></label><label>内容<textarea data-announcement-body value={form.content} maxLength={10000} disabled={busy} onChange={e=>setForm((f:AnnouncementForm)=>({...f,content:e.target.value}))}/></label>
      <div className="admin-form-grid"><label>草稿安排{form.status==='draft'||form.status==='scheduled'?<select value={form.status} disabled={busy} onChange={e=>setForm((f:AnnouncementForm)=>({...f,status:e.target.value as AnnouncementStatus}))}><option value="draft">草稿（不发布）</option><option value="scheduled">按既有规则定时发布</option></select>:<AdminBadge>{statusLabel(form.status)} · 本次保留</AdminBadge>}</label><label>受众<select value={form.audience} disabled={busy} onChange={e=>setForm((f:AnnouncementForm)=>({...f,audience:e.target.value}))}><option value="all">所有用户</option><option value="vip">VIP</option><option value="pro">商家Pro</option></select></label><label>发布时间<input type="datetime-local" value={form.publishAt} disabled={busy} onChange={e=>setForm((f:AnnouncementForm)=>({...f,publishAt:e.target.value}))}/></label><label>结束时间<input type="datetime-local" value={form.expireAt} disabled={busy} onChange={e=>setForm((f:AnnouncementForm)=>({...f,expireAt:e.target.value}))}/></label></div>
      <label className="admin-final-check"><input type="checkbox" checked={form.pinned} disabled={busy} onChange={e=>setForm((f:AnnouncementForm)=>({...f,pinned:e.target.checked}))}/>置顶公告</label>
      {timeError&&<p className="admin-field-error" role="alert">{timeError}</p>}
      <div className="admin-filter-actions"><AdminButton onClick={()=>setPreview(!preview)}>编辑 / 预览</AdminButton><AdminButton data-announcement-review variant="primary" disabled={busy||!form.title.trim()||!form.content.trim()||Boolean(timeError)} onClick={save}>复核内容变更</AdminButton></div>
      {preview&&<article className="admin-final-preview"><h3>{form.title}</h3><p>{form.content}</p><small>{form.audience} · {statusLabel(form.status)}</small></article>}
    </div>
  </ContentDrawer>;
}
function AnnouncementsPanel({request}:{request:AdminRequest}) {
  const [snapshot,setSnapshot]=useState<Paginated<Announcement>|null>(null),[page,setPage]=useState(1),[status,setStatus]=useState('all');
  const [loading,setLoading]=useState(false),[error,setError]=useState(''),[form,setForm]=useState<AnnouncementForm|null>(null),[before,setBefore]=useState<Announcement|null>(null);
  const epoch=useRef(new LatestRequest()),write=useContentWrite(request);
  const load=useCallback(async()=>{const version=epoch.current.next();setLoading(true);setError('');
    try {const params=new URLSearchParams({page:String(page),limit:String(PAGE_SIZE)});if(status!=='all')params.set('status',status);const result=await request<Paginated<Announcement>>('/api/admin/announcements?'+params);if(!epoch.current.current(version))return;if(!result.ok||!result.data){setError((result.status===403?'读取公告被服务端拒绝（403）：':'公告读取失败：')+(result.error??'请重试'));return;}setSnapshot(result.data);}
    catch {if(epoch.current.current(version))setError('读取失败，原列表保留。');}finally {if(epoch.current.current(version))setLoading(false);}
  },[request,page,status]);
  useEffect(()=>{void load();return()=>epoch.current.invalidate();},[load]);
  const save=()=>{if(!form)return;const publishAt=parseInputTime(form.publishAt),expireAt=parseInputTime(form.expireAt);const payload={...(form.id?{id:form.id}:{}),title:form.title.trim(),body:form.content.trim(),content:form.content.trim(),status:form.status,publishAt,expireAt,audience:form.audience,pinned:form.pinned};
    write.review({path:'/api/admin/announcements',method:form.id?'PUT':'POST',body:payload,before,title:form.id?'保存公告内容':'创建公告草稿',object:form.title+' · '+(form.id??'新草稿'),impact:'只提交上述内容/时间/受众；保存保留既有状态。定时安排沿服务端规则，发布/撤回另行复核。',done:async()=>{setForm(null);await load();}});
  };
  const publish=(item:Announcement,enabled:boolean)=>write.review({path:'/api/admin/announcements/publish',method:'POST',body:{id:item.id,publish:enabled},before:{status:item.status},after:{id:item.id,publish:enabled},title:enabled?'发布公告':'撤回公告',object:item.title+' · '+item.id,impact:'修改这个公告的发布状态与站内可见性，受众和时间规则以服务端为准。',done:load});
  return <section><AdminToolbar actions={<><AdminButton busy={loading} disabled={write.busy} onClick={()=>void load()}>刷新公告</AdminButton><AdminButton data-announcement-new disabled={write.busy} variant="primary" onClick={()=>{setBefore(null);setForm(emptyAnnouncement());}}><Plus aria-hidden="true"/>新建草稿</AdminButton></>}><h2>站内公告</h2><p>内容编辑、预览与发布/撤回分别复核，不以保存冒充发布。</p></AdminToolbar>
    <div className="admin-module-tabs" role="group" aria-label="公告状态">{['all','draft','scheduled','published','withdrawn'].map(value=><AdminButton key={value} disabled={write.busy} variant={status===value?'primary':'secondary'} onClick={()=>{setStatus(value);setPage(1);}}>{value==='all'?'全部':statusLabel(value)}</AdminButton>)}</div>
    {error&&<AdminErrorState message={error} retry={()=>void load()} busy={loading}/>} {write.success&&<p className="admin-success-message" role="status">{write.success}</p>}
    <div className="admin-stage-panel" aria-busy={loading}>{!snapshot?loading?<AdminLoading/>:<AdminEmptyState title="尚无成功读取结果"/>:snapshot.items.length?<><div className="admin-table-scroll"><table className="admin-stage-table" aria-label="公告列表"><thead><tr><th>标题 / 摘要</th><th>发布状态</th><th>时间 / 受众</th><th>明确操作</th></tr></thead><tbody>{snapshot.items.map(item=><tr key={item.id}><td><strong>{item.title}</strong><small className="admin-final-excerpt">{item.body}</small></td><td><AdminBadge>{statusLabel(item.status)}</AdminBadge></td><td>{dateText(item.publishAt)}<small>截止 {dateText(item.expireAt)} · {item.audience}</small></td><td><div className="admin-final-actions"><AdminButton data-announcement-edit={item.id} disabled={write.busy} onClick={()=>{setBefore(item);setForm({id:item.id,title:item.title,content:item.body,status:item.status,publishAt:toInputTime(item.publishAt),expireAt:toInputTime(item.expireAt),audience:item.audience??'all',pinned:item.pinned??item.isPinned??false});}}>编辑内容</AdminButton><AdminButton data-announcement-publish={item.id} disabled={write.busy} onClick={()=>publish(item,item.status!=='published')}>{item.status==='published'?'撤回':'发布'}</AdminButton><AdminButton iconOnly variant="danger" aria-label="删除公告" disabled={write.busy} onClick={()=>write.review({path:'/api/admin/announcements?id='+encodeURIComponent(item.id),method:'DELETE',before:item,title:'删除公告',object:item.title+' · '+item.id,impact:'删除指定公告记录，无法通过此界面恢复；不会删除其它公告。',done:load})}><Trash2 aria-hidden="true"/></AdminButton></div></td></tr>)}</tbody></table></div><Pager page={page} total={snapshot.total} busy={loading||write.busy} change={setPage}/></>:<AdminEmptyState title="暂无匹配公告"/>}</div>
    {form&&<AnnouncementEditor form={form} setForm={setForm} close={()=>setForm(null)} save={save} busy={write.busy}/>}
    {write.confirmation}
  </section>;
}
function ConfigEditor({kind,initial,close,save,busy}:{kind:'flag'|'setting';initial?:FeatureFlag|SystemSetting;close:()=>void;save:(body:Record<string,unknown>)=>void;busy:boolean}) {
  const isFlag=kind==='flag',flag=initial&&'enabled'in initial?initial:null,setting=initial&&'value'in initial?initial:null;
  const [key,setKey]=useState(initial?.key??''),[description,setDescription]=useState(initial?.description??''),[enabled,setEnabled]=useState(flag?.enabled??false);
  const [raw,setRaw]=useState(()=>JSON.stringify(flag?flag.config:setting?setting.value:{},null,2)??'{}');
  const parsed=parseJsonDraft(raw),keyError=!KEY_PATTERN.test(key)?'key仅支持小写字母开头及原有数字/点/连字符/下划线格式。':'';
  return <ContentDrawer title={(initial?'编辑':'新建')+(isFlag?'功能开关':'系统参数')} description="JSON错误内联；复核前后字段、作用范围，再冻结提交。不会新增服务端功能。" busy={busy} onClose={close}>
    <div className="admin-final-fields"><label>配置key<input value={key} maxLength={80} disabled={Boolean(initial)||busy} onChange={e=>setKey(e.target.value)}/></label>{keyError&&<p className="admin-field-error">{keyError}</p>}<label>说明<input value={description} maxLength={500} disabled={busy} onChange={e=>setDescription(e.target.value)}/></label>
    {isFlag&&<label className="admin-final-check"><input type="checkbox" checked={enabled} disabled={busy} onChange={e=>setEnabled(e.target.checked)}/>启用（提交既有enabled字段）</label>}
    <label>JSON值<textarea data-config-json value={raw} disabled={busy} spellCheck={false} onChange={e=>setRaw(e.target.value)}/></label>
    {parsed.error&&<p className="admin-field-error" role="alert" data-json-error>{parsed.error}</p>}
    <AdminButton data-config-review variant="primary" disabled={busy||Boolean(keyError)||Boolean(parsed.error)} onClick={()=>save(isFlag?{key,enabled,description,config:parsed.value}:{key,description,value:parsed.value})}>复核保存差异</AdminButton></div>
  </ContentDrawer>;
}
function ConfigPanel({request}:{request:AdminRequest}) {
  const [tab,setTab]=useState<'flag'|'setting'>('flag'),[flags,setFlags]=useState<FeatureFlag[]|null>(null),[settings,setSettings]=useState<SystemSetting[]|null>(null);
  const [search,setSearch]=useState(''),[loading,setLoading]=useState(false),[errors,setErrors]=useState(''),[editor,setEditor]=useState<{kind:'flag'|'setting';initial?:FeatureFlag|SystemSetting}|null>(null);
  const epoch=useRef(new LatestRequest()),write=useContentWrite(request);
  const load=useCallback(async()=>{const id=epoch.current.next();setLoading(true);setErrors('');try {
    const [f,s]=await Promise.all([request<{items:FeatureFlag[]}>('/api/admin/feature-flags?page=1&limit=100'),request<{items:SystemSetting[]}>('/api/admin/system-settings?page=1&limit=100')]);if(!epoch.current.current(id))return;
    const messages:string[]=[];if(f.ok&&f.data)setFlags(f.data.items);else messages.push('读取开关'+(f.status===403?'被拒绝（403）':'失败')+'：'+(f.error??'请重试'));if(s.ok&&s.data)setSettings(s.data.items);else messages.push('读取参数'+(s.status===403?'被拒绝（403）':'失败')+'：'+(s.error??'请重试'));setErrors(messages.join(' '));
  }catch{if(epoch.current.current(id))setErrors('配置读取失败，原数据保留。');}finally{if(epoch.current.current(id))setLoading(false);}},[request]);
  useEffect(()=>{void load();return()=>epoch.current.invalidate();},[load]);
  const current=tab==='flag'?flags:settings;
  const visible=useMemo(()=>(current??[]).filter(item=>(item.key+' '+item.description).toLowerCase().includes(search.toLowerCase())),[current,search]);
  return <section><AdminToolbar actions={<><AdminButton busy={loading} onClick={()=>void load()}>刷新配置</AdminButton><AdminButton data-config-new disabled={write.busy} onClick={()=>setEditor({kind:tab})}>新建配置</AdminButton></>}><h2>平台开关与参数</h2><p>只维护现有配置；搜索范围为当前已读取的各类最多100条，不冒充全库查询。</p></AdminToolbar>
    <div className="admin-module-tabs"><AdminButton variant={tab==='flag'?'primary':'secondary'} onClick={()=>setTab('flag')}>功能开关</AdminButton><AdminButton variant={tab==='setting'?'primary':'secondary'} onClick={()=>setTab('setting')}>系统参数</AdminButton></div>
    <div className="admin-stage-panel" role="search"><label>当前列表搜索<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="搜索key或说明"/></label></div>
    {errors&&<AdminErrorState message={errors} retry={()=>void load()} busy={loading}/>} {write.success&&<p className="admin-success-message" role="status">{write.success}</p>}
    <div className="admin-stage-panel">{current===null?loading?<AdminLoading/>:<AdminEmptyState title="尚无成功读取结果"/>:visible.length?<div className="admin-table-scroll"><table className="admin-stage-table" aria-label="配置列表"><thead><tr><th>key</th><th>说明 / 更新</th><th>当前读取值</th><th>操作</th></tr></thead><tbody>{visible.map(item=><tr key={item.key}><td className="admin-mono">{item.key}</td><td>{item.description||'未提供'}<small>{dateText(item.updatedAt)}</small></td><td>{'enabled'in item?<AdminBadge tone={item.enabled?'success':'neutral'}>{item.enabled?'启用':'关闭'}</AdminBadge>:<span className="admin-mono admin-final-excerpt">{JSON.stringify(item.value)}</span>}</td><td><AdminButton data-config-edit={item.key} disabled={write.busy} onClick={()=>setEditor({kind:tab,initial:item})}>编辑</AdminButton></td></tr>)}</tbody></table></div>:<AdminEmptyState title="没有匹配配置"/>}</div>
    {editor&&<ConfigEditor kind={editor.kind} initial={editor.initial} close={()=>setEditor(null)} busy={write.busy} save={body=>write.review({path:editor.kind==='flag'?'/api/admin/feature-flags':'/api/admin/system-settings',method:'PUT',body,before:editor.initial,title:'保存配置',object:String(body.key),impact:'更新这个现有开关/参数及JSON值；具体生效范围以服务端应用该key的逻辑为准，不增加新功能或权限。',done:async()=>{setEditor(null);await load();}})}/>}
    {write.confirmation}
  </section>;
}
export function AdminAnnouncementsConfig({mode,request}:{mode:Mode;request:AdminRequest}) {
  return <div className="admin-final-modules">{mode==='announcements'?<AnnouncementsPanel request={request}/>:<ConfigPanel request={request}/>}</div>;
}
