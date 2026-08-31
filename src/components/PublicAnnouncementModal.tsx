import React, { useEffect, useMemo, useState } from 'react';
import { Bell, ExternalLink, Loader2, Megaphone, RefreshCw, X } from 'lucide-react';

export interface PublicAnnouncementItem {
  id: string;
  title: string;
  content: string;
  pinned: boolean;
  publishAt: number;
  actionLabel?: string;
  actionUrl?: string;
}

export type AnnouncementLoadState = 'loading' | 'ready' | 'error';

interface PublicAnnouncementModalProps {
  open: boolean;
  state: AnnouncementLoadState;
  announcement: PublicAnnouncementItem | null;
  error?: string | null;
  onClose: () => void;
  onRetry: () => void;
}

function safeActionUrl(value?: string): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw, window.location.origin);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (parsed.origin === window.location.origin) return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    return parsed.toString();
  } catch {
    return null;
  }
}

export const PublicAnnouncementModal: React.FC<PublicAnnouncementModalProps> = ({
  open,
  state,
  announcement,
  error,
  onClose,
  onRetry,
}) => {
  const [expanded, setExpanded] = useState(false);
  const actionUrl = useMemo(() => safeActionUrl(announcement?.actionUrl), [announcement?.actionUrl]);

  useEffect(() => {
    if (!open) return;
    setExpanded(false);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose, announcement?.id]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="public-announcement-title"
        className="w-full max-w-lg overflow-hidden rounded-3xl border border-violet-200 bg-white shadow-[0_24px_80px_rgba(76,29,149,0.25)]"
      >
        <header className="flex items-center justify-between gap-3 border-b border-violet-100 bg-gradient-to-r from-violet-50 via-white to-fuchsia-50 px-5 py-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-violet-600 text-white shadow-lg shadow-violet-200">
              <Megaphone className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-violet-500">豆织星格 · 最新消息</p>
              <h2 id="public-announcement-title" className="truncate text-base font-black text-slate-900">公告通知</h2>
            </div>
          </div>
          <button type="button" onClick={onClose} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-slate-400 transition hover:bg-violet-100 hover:text-violet-700" aria-label="关闭公告" title="关闭公告">
            <X className="h-5 w-5" />
          </button>
        </header>

        {state === 'loading' && (
          <div className="grid min-h-48 place-items-center gap-3 px-6 py-10 text-center text-slate-500">
            <Loader2 className="h-7 w-7 animate-spin text-violet-500" aria-hidden="true" />
            <p className="text-sm font-medium">正在加载最新公告…</p>
          </div>
        )}

        {state === 'error' && (
          <div className="space-y-4 px-6 py-10 text-center">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-rose-50 text-rose-500"><Bell className="h-6 w-6" /></div>
            <div><p className="font-bold text-slate-900">公告暂时无法加载</p><p className="mt-1 text-sm leading-6 text-slate-500">{error || '请检查网络后重试。'}</p></div>
            <button type="button" onClick={onRetry} className="mx-auto inline-flex min-h-11 items-center gap-2 rounded-xl bg-violet-600 px-5 text-sm font-bold text-white transition hover:bg-violet-700 active:scale-[0.98]"><RefreshCw className="h-4 w-4" />重新加载</button>
          </div>
        )}

        {state === 'ready' && !announcement && (
          <div className="px-6 py-12 text-center text-sm text-slate-500">暂时没有新的公告。</div>
        )}

        {state === 'ready' && announcement && (
          <div className="space-y-5 px-5 py-5 sm:px-6 sm:py-6">
            <div className="flex items-start gap-3">
              <span className={`mt-1 shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${announcement.pinned ? 'bg-amber-100 text-amber-700' : 'bg-violet-100 text-violet-700'}`}>{announcement.pinned ? '置顶' : '公告'}</span>
              <h3 className="min-w-0 flex-1 text-xl font-black leading-tight text-slate-900">{announcement.title}</h3>
            </div>
            <div className={`whitespace-pre-wrap break-words text-sm leading-7 text-slate-600 ${expanded ? '' : 'line-clamp-5'}`}>{announcement.content}</div>
            {announcement.content.length > 240 && <button type="button" onClick={() => setExpanded(value => !value)} className="text-xs font-bold text-violet-600 hover:text-violet-800">{expanded ? '收起内容' : '查看详情'}</button>}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={onClose} className="min-h-11 rounded-xl border border-slate-200 px-4 text-sm font-bold text-slate-600 transition hover:border-violet-200 hover:bg-violet-50">知道了</button>
              {actionUrl && <button type="button" onClick={() => { window.location.assign(actionUrl); onClose(); }} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 text-sm font-bold text-white transition hover:bg-violet-700 active:scale-[0.98]">{announcement.actionLabel || '立即查看'}<ExternalLink className="h-4 w-4" /></button>}
            </div>
          </div>
        )}
      </section>
    </div>
  );
};
