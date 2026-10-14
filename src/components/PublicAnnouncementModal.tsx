import React, { useEffect, useRef } from 'react';
import { ArrowLeft, Bell, ChevronRight, ExternalLink, Loader2, RefreshCw, X } from 'lucide-react';
import { announcementReadKey, type AnnouncementSnapshot, type PublicAnnouncementItem } from '../utils/announcementStore';

export type { PublicAnnouncementItem } from '../utils/announcementStore';

interface PublicAnnouncementModalProps {
  state: AnnouncementSnapshot;
  onClose: () => void;
  onRetry: () => void;
  onSelect: (item: PublicAnnouncementItem) => void;
  onBack: () => void;
  onLoadMore: () => void;
}

export function safeAnnouncementUrl(value: string | undefined, origin: string): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim(), origin);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin === origin ? `${url.pathname}${url.search}${url.hash}` : url.toString();
  } catch { return null; }
}

const ended = (item: PublicAnnouncementItem) => item.expireAt !== null && item.expireAt <= Date.now();
const date = (value: number) => new Date(value).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });

export function PublicAnnouncementModal({ state, onClose, onRetry, onSelect, onBack, onLoadMore }: PublicAnnouncementModalProps) {
  const overlay = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLElement>(null);
  const { open, view, selected, history, historyState, historyError, pagination, readIds } = state;

  useEffect(() => {
    if (!open || !overlay.current || !dialog.current) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const locked: { node: HTMLElement; inert: boolean }[] = [];
    let branch: HTMLElement = overlay.current;
    while (branch.parentElement) {
      for (const sibling of branch.parentElement.children) {
        if (sibling !== branch && sibling instanceof HTMLElement) {
          locked.push({ node: sibling, inert: sibling.inert }); sibling.inert = true;
        }
      }
      if (branch.parentElement === document.body) break;
      branch = branch.parentElement;
    }
    document.body.style.overflow = 'hidden';
    const focusable = () => [...(dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? [])]
      .filter(node => node.getClientRects().length && !node.closest('[inert]'));
    const focusFirst = () => (focusable()[0] ?? dialog.current)?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); return; }
      if (event.key !== 'Tab') return;
      const nodes = focusable(), first = nodes[0], last = nodes[nodes.length - 1];
      if (!first) { event.preventDefault(); dialog.current?.focus(); }
      else if (!dialog.current?.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    const onFocus = (event: FocusEvent) => { if (!dialog.current?.contains(event.target as Node)) focusFirst(); };
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('focusin', onFocus);
    focusFirst();
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('focusin', onFocus);
      locked.forEach(({ node, inert }) => { node.inert = inert; });
      document.body.style.overflow = previousOverflow;
      const target = previous?.isConnected && previous !== document.body && !previous.closest('[inert]')
        ? previous : document.querySelector<HTMLElement>('[data-announcement-trigger]');
      target?.focus();
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const heading = dialog.current?.querySelector<HTMLElement>('h3');
    if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
    const scroll = dialog.current?.querySelector<HTMLElement>('.overflow-y-auto');
    if (scroll) scroll.scrollTop = 0;
  }, [open, view, selected?.id]);

  if (!open) return null;
  const actionUrl = selected && typeof window !== 'undefined' ? safeAnnouncementUrl(selected.actionUrl, window.location.origin) : null;
  return (
    <div ref={overlay} className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/55 p-3 backdrop-blur-sm sm:p-5" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) { event.preventDefault(); onClose(); } }}>
      <style>{`@keyframes announcement-fade{from{opacity:0}to{opacity:1}}.announcement-dialog{animation:announcement-fade 180ms ease-out}@media(prefers-reduced-motion:reduce){.announcement-dialog{animation:none}}`}</style>
      <section ref={dialog} role="dialog" aria-modal="true" aria-labelledby="public-announcement-title" aria-describedby="public-announcement-description" tabIndex={-1} className="announcement-dialog flex max-h-[calc(100dvh-1.5rem)] w-full min-w-0 max-w-2xl flex-col overflow-hidden rounded-3xl border border-violet-200 bg-white font-sans text-slate-900 shadow-2xl dark:border-violet-800 dark:bg-slate-900 dark:text-slate-100 sm:max-h-[min(44rem,calc(100dvh-2.5rem))] [&_button]:focus-visible:outline-none [&_button]:focus-visible:ring-2 [&_button]:focus-visible:ring-violet-500 [&_button]:focus-visible:ring-inset">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-violet-100 bg-violet-50 px-4 py-3 dark:border-violet-800 dark:bg-slate-950 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-violet-600 text-white"><Bell className="h-5 w-5" /></span>
            <div className="min-w-0">
              <h2 id="public-announcement-title" className="text-base font-extrabold">公告中心</h2>
              <p id="public-announcement-description" className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">已公开消息，随时回看</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭公告" className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-slate-500 transition-colors duration-150 hover:bg-violet-100 hover:text-violet-800 dark:text-slate-300 dark:hover:bg-slate-800"><X className="h-5 w-5" /></button>
        </header>

        <div className="min-h-0 min-w-0 overflow-y-auto overscroll-contain p-4 [overflow-wrap:anywhere] sm:p-6">
          {view === 'detail' && selected ? (
            <article>
              <button type="button" onClick={onBack} className="mb-4 inline-flex min-h-11 items-center gap-1.5 rounded-xl px-2 text-sm font-bold text-violet-700 hover:bg-violet-50 dark:text-violet-300 dark:hover:bg-slate-800"><ArrowLeft className="h-4 w-4" />返回历史公告</button>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className={`rounded-full px-2.5 py-1 font-bold ${ended(selected) ? 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' : 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300'}`}>{ended(selected) ? '已结束' : selected.pinned ? '置顶公告' : '公告'}</span>
                <time className="text-slate-500 dark:text-slate-400">{date(selected.publishAt)} 发布</time>
              </div>
              <h3 className="mt-4 break-words text-xl font-extrabold leading-snug outline-none sm:text-2xl">{selected.title}</h3>
              {ended(selected) && <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">此公告已结束，仅供历史回看。</p>}
              <div className="mt-5 whitespace-pre-wrap break-words text-sm leading-7 text-slate-700 dark:text-slate-300">{selected.content}</div>
              <div className="mt-6 flex flex-wrap gap-2">
                <button type="button" onClick={onClose} className="min-h-11 rounded-xl bg-violet-600 px-5 text-sm font-bold text-white transition-colors duration-150 hover:bg-violet-700">知道了</button>
                {actionUrl && <a href={actionUrl} rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-violet-200 px-4 text-sm font-bold text-violet-700 dark:border-violet-800 dark:text-violet-300">{selected.actionLabel || '查看相关内容'}<ExternalLink className="h-4 w-4" /></a>}
              </div>
            </article>
          ) : (
            <div>
              <h3 className="font-extrabold outline-none">历史公告</h3>
              <p className="mb-4 mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">包含已结束的公开公告；未读与已读消息均可查看。</p>
              <ul className="space-y-2" aria-label="历史公告列表">
                {history.map(item => (
                  <li key={item.id}>
                    <button type="button" onClick={() => onSelect(item)} className="flex min-h-20 w-full min-w-0 items-center gap-3 rounded-2xl border border-violet-100 bg-white p-3 text-left transition-colors duration-150 hover:border-violet-300 hover:bg-violet-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800">
                      <span className="min-w-0 flex-1">
                        <span className="mb-1.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                          <time>{date(item.publishAt)}</time>
                          {ended(item) && <span className="rounded-full bg-slate-100 px-2 py-0.5 font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">已结束</span>}
                          <span className={readIds.has(announcementReadKey(item)) ? '' : 'font-bold text-violet-700 dark:text-violet-300'}>{readIds.has(announcementReadKey(item)) ? '已读' : '未读'}</span>
                        </span>
                        <span className="block break-words text-sm font-bold leading-6">{item.title}</span>
                      </span>
                      <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-violet-500" />
                    </button>
                  </li>
                ))}
              </ul>
              {historyState === 'loading' && <p role="status" className="flex min-h-24 items-center justify-center gap-2 text-sm text-slate-500 dark:text-slate-400"><Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" />正在加载公告…</p>}
              {historyState === 'error' && <div role="alert" className="mt-4 rounded-2xl border border-violet-200 bg-violet-50 p-4 dark:border-violet-800 dark:bg-slate-950"><p className="text-sm leading-6 text-slate-700 dark:text-slate-300">{historyError}</p><button type="button" onClick={onRetry} className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-bold text-violet-700 hover:bg-violet-100 dark:text-violet-300 dark:hover:bg-slate-800"><RefreshCw className="h-4 w-4" />重试加载</button></div>}
              {historyState === 'ready' && history.length === 0 && <p role="status" className="py-12 text-center text-sm text-slate-500 dark:text-slate-400">暂无公开历史公告。</p>}
              {history.length > 0 && <p className="mt-4 text-center text-xs text-slate-500 dark:text-slate-400">已加载 {history.length} 条公告{!pagination.hasMore && historyState === 'ready' ? ' · 已显示全部' : ''}</p>}
              {pagination.hasMore && historyState === 'ready' && <button type="button" onClick={onLoadMore} className="mt-3 min-h-11 w-full rounded-xl border border-violet-200 px-4 text-sm font-bold text-violet-700 transition-colors duration-150 hover:bg-violet-50 dark:border-violet-800 dark:text-violet-300 dark:hover:bg-slate-800">加载更多公告</button>}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
