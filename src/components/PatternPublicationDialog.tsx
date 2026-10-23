import React, { useEffect, useRef, useState } from 'react';
import { EyeOff, Globe2, LockKeyhole, RotateCcw, ShieldCheck, Undo2, X } from 'lucide-react';
import type { ExportedPatternRecord } from '../utils/patternHistory';
import type { CommunityPostVisibility } from '../utils/communityApi';

type PublicationState = 'public' | 'private' | 'unpublished';

interface PatternPublicationDialogProps {
  record: ExportedPatternRecord | null;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onSetVisibility: (visibility: CommunityPostVisibility) => void;
  onWithdraw: () => void;
  onRepublish: () => void;
}

export function patternPublicationState(record: ExportedPatternRecord): PublicationState {
  if (record.communityPost) return record.communityPost.visibility;
  return record.status === 1 ? 'public' : 'unpublished';
}

export const PatternPublicationDialog: React.FC<PatternPublicationDialogProps> = ({
  record,
  busy = false,
  error = null,
  onClose,
  onSetVisibility,
  onWithdraw,
  onRepublish,
}) => {
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!record) return undefined;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, onClose, record]);

  useEffect(() => {
    setConfirmWithdraw(false);
  }, [record?.id]);

  if (!record) return null;

  const state = patternPublicationState(record);
  const isActive = state === 'public' || state === 'private';
  const canManage = Boolean(record.communityPost);
  const isPublic = state === 'public';

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-sm" role="presentation">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="pattern-publication-title"
        className="w-full max-w-md overflow-hidden rounded-3xl border border-[#eadff4] bg-white shadow-[0_24px_90px_rgba(55,30,77,0.24)]"
      >
        <header className="flex items-start gap-3 border-b border-[#f0eaf5] bg-gradient-to-br from-white to-[#faf5ff] px-5 py-5">
          <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${isPublic ? 'bg-emerald-50 text-emerald-600' : state === 'private' ? 'bg-amber-50 text-amber-600' : 'bg-[#f2e9fb] text-[#8459a7]'}`}>
            {isPublic ? <Globe2 className="h-5 w-5" /> : state === 'private' ? <LockKeyhole className="h-5 w-5" /> : <EyeOff className="h-5 w-5" />}
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="pattern-publication-title" className="truncate text-[15px] font-extrabold text-[#453052]">发布管理</h2>
            <p className="mt-1 truncate text-xs text-[#8c7b98]" title={record.title}>{record.title}</p>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} disabled={busy} className="grid h-8 w-8 shrink-0 place-items-center rounded-xl text-[#a18eac] transition hover:bg-[#f7f1fb] hover:text-[#5a3d6f] disabled:opacity-40" aria-label="关闭发布管理">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="space-y-4 px-5 py-5">
          <div className="rounded-2xl border border-[#eee6f4] bg-[#fcfaff] p-4">
            <div className="flex items-center gap-2 text-xs font-extrabold text-[#5e416f]">
              <ShieldCheck className="h-4 w-4 text-[#9b73bc]" />
              {isPublic ? '公开作品' : state === 'private' ? '私密作品' : '尚未发布'}
            </div>
            <p className="mt-2 text-xs leading-5 text-[#8c7b98]">
              {isPublic
                ? '所有用户都可以在豆社看到；作品本体仍保留在你的图库。'
                : state === 'private'
                  ? '仅你自己可以查看，不会出现在豆社公开列表；作品仍保留在你的图库。'
                  : '当前仅保存在你的图库。重新发布后，仍然不会删除或移动图库工程。'}
            </p>
          </div>

          {isActive && canManage ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => onSetVisibility(isPublic ? 'private' : 'public')}
                disabled={busy}
                className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 text-xs font-extrabold transition disabled:opacity-50 ${isPublic ? 'border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100' : 'bg-emerald-600 text-white hover:bg-emerald-700'}`}
              >
                {isPublic ? <LockKeyhole className="h-4 w-4" /> : <Globe2 className="h-4 w-4" />}
                {isPublic ? '转为私密' : '公开作品'}
              </button>
              <button
                type="button"
                onClick={() => setConfirmWithdraw(true)}
                disabled={busy}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 text-xs font-extrabold text-rose-700 transition hover:bg-rose-100 disabled:opacity-50"
              >
                <Undo2 className="h-4 w-4" />
                撤回作品
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={onRepublish}
              disabled={busy}
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#8054a4] px-3 text-xs font-extrabold text-white transition hover:bg-[#70438f] disabled:opacity-50"
            >
              <RotateCcw className="h-4 w-4" />
              发布到豆社
            </button>
          )}

          {confirmWithdraw && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50/70 p-3">
              <p className="text-xs font-bold text-rose-800">撤回后，其他用户将无法在豆社看到它，但图库中的工程不会被删除。</p>
              <div className="mt-3 flex justify-end gap-2">
                <button type="button" onClick={() => setConfirmWithdraw(false)} disabled={busy} className="rounded-lg px-3 py-2 text-xs font-bold text-[#806d8d] hover:bg-white">暂不撤回</button>
                <button type="button" onClick={onWithdraw} disabled={busy} className="rounded-lg bg-rose-600 px-3 py-2 text-xs font-extrabold text-white hover:bg-rose-700 disabled:opacity-50">确认撤回</button>
              </div>
            </div>
          )}

          {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold leading-5 text-rose-700">{error}</p>}

          <div className="flex items-center gap-2 text-[11px] text-[#a08fa9]">
            <EyeOff className="h-3.5 w-3.5" />
            <span>删除图库工程与撤回豆社作品是两件不同的操作。</span>
          </div>
        </div>
      </section>
    </div>
  );
};
