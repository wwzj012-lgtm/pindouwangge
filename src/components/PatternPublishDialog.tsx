import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Sparkles, X } from 'lucide-react';
import type { ExportedPatternRecord } from '../utils/patternHistory';
import {
  COMMUNITY_MAX_TAG_LENGTH,
  COMMUNITY_MAX_TAGS,
  COMMUNITY_TAG_OPTIONS,
  validateCommunityPublicationMetadata,
  type CommunityPublicationMetadata,
} from '../utils/communityPatternPublication';
import { checkCommunityModeration, fetchCommunityTags, type CommunityModerationViolation, type CommunityTagSummary } from '../utils/communityApi';

/** 渐进披露：默认只渲染前 12 个标签 chips，其余收进"更多 (n)"。 */
const TAG_OPTION_PREVIEW_COUNT = 12;

/** 编辑模式：预填已发布内容的值；发布模式：空表单。patternId 用于编辑保存后同步图库图纸名。 */
export interface PatternEditingPost {
  id: string;
  patternId: string;
  title: string;
  description: string;
  visibility: 'public' | 'private';
  tags: string[];
}

interface PatternPublishDialogProps {
  record: ExportedPatternRecord | null;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (metadata: CommunityPublicationMetadata) => void;
  editingPost?: PatternEditingPost | null;
}

/** 违禁词预检命中 → 逐词提示（双层校验的前端层；后端发布路径仍强校验兜底）。 */
export function moderationViolationMessage(violations: readonly CommunityModerationViolation[]): string {
  const parts = violations.map((violation) =>
    `${violation.field === 'title' ? '作品名称' : '标签'}包含违禁词“${violation.word}”`);
  return `内容未通过安全校验：${[...new Set(parts)].join('；')}。请修改后重试。`;
}

export function PatternPublishDialog({ record, busy, error, onClose, onSubmit, editingPost }: PatternPublishDialogProps): React.ReactElement | null {
  const isEditing = editingPost !== null && editingPost !== undefined;
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [moderating, setModerating] = useState(false);
  // 标签字典来自服务端（GET /api/community/tags，已按 usage_count 降序）；
  // 拉取失败时回退 COMMUNITY_TAG_OPTIONS 硬编码顺序，保证弹窗可用。
  const [tagDictionary, setTagDictionary] = useState<CommunityTagSummary[]>([]);
  const [showAllTagOptions, setShowAllTagOptions] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    setShowAllTagOptions(false);
    if (isEditing && editingPost) {
      setTitle(editingPost.title.trim().slice(0, 60));
      setDescription(editingPost.description ?? '');
      setVisibility(editingPost.visibility);
      setTags([...editingPost.tags]); setTagDraft(''); setLocalError(null);
      return;
    }
    if (!record) return;
    setTitle(record.title.trim().slice(0, 60));
    setDescription(''); setVisibility('public'); setTags([]); setTagDraft(''); setLocalError(null);
  }, [record?.id, isEditing, editingPost?.id]);

  useEffect(() => {
    if (!record && !isEditing) return;
    let cancelled = false;
    fetchCommunityTags()
      .then((result) => {
        if (cancelled) return;
        if (result.ok && result.data && result.data.tags.length > 0) setTagDictionary(result.data.tags);
        else setTagDictionary([]);
      })
      .catch(() => { if (!cancelled) setTagDictionary([]); });
    return () => { cancelled = true; };
  }, [record?.id, isEditing, editingPost?.id]);

  useEffect(() => {
    if (!record) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    titleRef.current?.focus();
    return () => { if (previousFocus?.isConnected) previousFocus.focus(); };
  }, [record?.id]);

  useEffect(() => {
    if (!record) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); if (!busy) onClose(); }
      if (event.key !== 'Tab') return;
      const controls = Array.from<HTMLElement>(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled)') ?? []);
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first) { event.preventDefault(); dialogRef.current?.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || !dialogRef.current?.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialogRef.current?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [busy, onClose, record]);

  if (!record && !isEditing) return null;
  const displayTitle = isEditing ? editingPost.title : record.title;
  const message = localError ?? error;
  // 标签 chips 数据源：服务端标签字典（热度降序）；失败/为空回退硬编码预设，保证可用性。
  const dictionaryOptions: string[] = tagDictionary.length > 0
    ? tagDictionary.map((entry) => entry.name)
    : COMMUNITY_TAG_OPTIONS;
  const dictionarySet = new Set(dictionaryOptions);
  const visibleTagOptions = showAllTagOptions ? dictionaryOptions : dictionaryOptions.slice(0, TAG_OPTION_PREVIEW_COUNT);
  const addTag = (value: string): void => {
    const tag = value.trim();
    if (!tag) return;
    if (tag.length > COMMUNITY_MAX_TAG_LENGTH) { setLocalError(`每个标签不能超过 ${COMMUNITY_MAX_TAG_LENGTH} 个字符。`); return; }
    if (tags.includes(tag)) { setTagDraft(''); return; }
    if (tags.length >= COMMUNITY_MAX_TAGS) { setLocalError(`最多可添加 ${COMMUNITY_MAX_TAGS} 个标签。`); return; }
    setTags((current) => [...current, tag]); setTagDraft(''); setLocalError(null);
  };
  const submit = async (): Promise<void> => {
    if (busy || moderating) return;
    const validation = validateCommunityPublicationMetadata({ title, description, visibility, tags });
    if (validation.ok === false) { setLocalError(validation.error); return; }
    setModerating(true);
    try {
      const result = await checkCommunityModeration({ title: validation.metadata.title, tags: validation.metadata.tags });
      if (result.ok && result.data && result.data.violations.length > 0) {
        setLocalError(moderationViolationMessage(result.data.violations));
        return;
      }
      // 预检服务不可用（网络/网关错误）不阻塞发布：后端强校验会兜底拦截。
    } catch {
      // ignore: fall through to onSubmit
    } finally {
      setModerating(false);
    }
    setLocalError(null);
    onSubmit(validation.metadata);
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/45 p-3 backdrop-blur-sm" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !busy) onClose(); }}>
      <section ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="profile-publish-title" className="max-h-[calc(100vh-1.5rem)] w-full max-w-lg overflow-y-auto rounded-2xl border border-purple-200 bg-white p-4 shadow-2xl sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0"><h3 id="profile-publish-title" className="text-base font-black text-slate-900">{isEditing ? '编辑已发布作品' : '发布到豆社'}</h3><p className="mt-1 truncate text-xs text-slate-500">{isEditing ? editingPost.title : record.title}</p><p className="mt-1 text-[11px] font-medium text-emerald-700">{isEditing ? '修改保存后社区页面立即生效。' : '云端同步与发布均不收费。'}</p></div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="关闭发布窗口" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50"><X className="h-5 w-5" /></button>
        </div>
        <label className="mt-5 block text-xs font-bold text-slate-700">作品名称<input ref={titleRef} value={title} maxLength={60} disabled={busy} onChange={(event) => { setTitle(event.target.value); setLocalError(null); }} onKeyDown={(event) => { if (event.key === 'Enter') submit(); }} className="mt-2 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition-colors focus:border-purple-500 focus:ring-2 focus:ring-purple-200 disabled:opacity-60" aria-describedby="profile-publish-name-help" /></label>
        <p id="profile-publish-name-help" className="mt-1.5 text-[11px] text-slate-500">{title.trim().length}/60</p>
        <label className="mt-4 block text-xs font-bold text-slate-700">作品简介<textarea value={description} maxLength={500} disabled={busy} rows={3} onChange={(event) => { setDescription(event.target.value); setLocalError(null); }} className="mt-2 w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm leading-5 text-slate-900 outline-none transition-colors focus:border-purple-500 focus:ring-2 focus:ring-purple-200 disabled:opacity-60" aria-describedby="profile-publish-description-help" /></label>
        <p id="profile-publish-description-help" className="mt-1.5 text-[11px] text-slate-500">{description.trim().length}/500</p>
        <fieldset className="mt-4"><legend className="text-xs font-bold text-slate-700">可见范围</legend><div className="mt-2 grid grid-cols-2 gap-2">{(['public', 'private'] as const).map((item) => <button key={item} type="button" disabled={busy} aria-pressed={visibility === item} onClick={() => { setVisibility(item); setLocalError(null); }} className={`min-h-11 rounded-xl border px-3 text-xs font-bold transition-colors disabled:opacity-50 ${visibility === item ? 'border-purple-500 bg-purple-100 text-purple-900' : 'border-slate-200 bg-white text-slate-600 hover:border-purple-300 hover:bg-purple-50'}`}>{item === 'public' ? '公开' : '私密'}</button>)}</div></fieldset>
        <fieldset className="mt-4"><legend className="text-xs font-bold text-slate-700">标签（{tags.length}/{COMMUNITY_MAX_TAGS}）</legend><div className={`mt-2 flex flex-wrap gap-2 ${showAllTagOptions && dictionaryOptions.length > TAG_OPTION_PREVIEW_COUNT ? 'max-h-64 overflow-y-auto pr-1' : ''}`}>{visibleTagOptions.map((tag) => { const selected = tags.includes(tag); return <button key={tag} type="button" disabled={busy || (!selected && tags.length >= COMMUNITY_MAX_TAGS)} aria-pressed={selected} onClick={() => selected ? setTags((current) => current.filter((item) => item !== tag)) : addTag(tag)} className={`min-h-11 rounded-xl border px-3 text-xs font-bold transition-colors disabled:opacity-50 ${selected ? 'border-purple-500 bg-purple-100 text-purple-900' : 'border-slate-200 bg-white text-slate-600 hover:border-purple-300 hover:bg-purple-50'}`}>{tag}</button>; })}{dictionaryOptions.length > TAG_OPTION_PREVIEW_COUNT && (<button type="button" aria-expanded={showAllTagOptions} onClick={() => setShowAllTagOptions((value) => !value)} className="min-h-11 shrink-0 rounded-xl border border-dashed border-slate-300 bg-white px-3 text-xs font-bold text-slate-600 transition-colors hover:bg-slate-50">{showAllTagOptions ? '收起' : `更多 (${dictionaryOptions.length - TAG_OPTION_PREVIEW_COUNT})`}</button>)}</div>
          {/* 自定义标签不在标签字典里，必须单独渲染成可移除的 chip，
              否则加入 tags 后没有任何可见反馈（看起来像“点了没反应”）。 */}
          {tags.filter((tag) => !dictionarySet.has(tag)).length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {tags.filter((tag) => !dictionarySet.has(tag)).map((tag) => (
                <span key={tag} className="inline-flex min-h-11 items-center gap-1 rounded-xl border border-purple-500 bg-purple-100 px-3 text-xs font-bold text-purple-900">
                  {tag}
                  <button type="button" disabled={busy} onClick={() => setTags((current) => current.filter((item) => item !== tag))} aria-label={`移除标签 ${tag}`} className="grid h-6 w-6 place-items-center rounded-lg text-purple-700 transition-colors hover:bg-purple-200 hover:text-purple-950 disabled:opacity-50"><X className="h-3.5 w-3.5" /></button>
                </span>
              ))}
            </div>
          )}
          <div className="mt-2 flex gap-2"><input value={tagDraft} maxLength={COMMUNITY_MAX_TAG_LENGTH} disabled={busy || tags.length >= COMMUNITY_MAX_TAGS} onChange={(event) => { setTagDraft(event.target.value); setLocalError(null); }} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addTag(tagDraft); } }} aria-label="自定义标签" placeholder="自定义标签" className="min-h-11 min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-900 outline-none transition-colors focus:border-purple-500 focus:ring-2 focus:ring-purple-200 disabled:opacity-60" /><button type="button" disabled={busy || !tagDraft.trim() || tags.length >= COMMUNITY_MAX_TAGS} onClick={() => addTag(tagDraft)} className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl border border-purple-300 px-4 text-xs font-bold text-purple-700 transition-colors hover:bg-purple-50 disabled:opacity-50" aria-label="添加标签">添加</button></div></fieldset>
        {message && <div role="alert" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs leading-5 text-rose-700">{message}</div>}
        <div className="mt-5 grid grid-cols-2 gap-3"><button type="button" onClick={onClose} disabled={busy} className="min-h-11 rounded-xl border border-slate-200 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50">取消</button><button type="button" onClick={() => void submit()} disabled={busy || moderating} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-purple-600 px-3 text-sm font-bold text-white transition-colors hover:bg-purple-700 disabled:opacity-50">{busy || moderating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}{isEditing ? '保存修改' : '确认发布'}</button></div>
      </section>
    </div>
  );
}
