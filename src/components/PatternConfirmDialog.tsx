import React, { useEffect, useRef } from 'react';
import { AlertTriangle, Loader2, X } from 'lucide-react';

interface PatternConfirmDialogProps {
  isOpen: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onClose: () => void;
}

/** A small in-app confirmation surface for destructive gallery actions. */
export const PatternConfirmDialog: React.FC<PatternConfirmDialogProps> = ({
  isOpen,
  title,
  description,
  confirmLabel,
  cancelLabel = '取消',
  busy = false,
  error = null,
  onConfirm,
  onClose,
}) => {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return undefined;
    cancelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-sm" role="presentation">
      <section
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="pattern-confirm-title"
        aria-describedby="pattern-confirm-description"
        className="w-full max-w-sm overflow-hidden rounded-3xl border border-[#eadff4] bg-white shadow-[0_24px_80px_rgba(55,30,77,0.22)]"
      >
        <div className="flex items-start gap-3 border-b border-[#f0eaf5] px-5 py-5">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-rose-50 text-rose-600">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="pattern-confirm-title" className="text-[15px] font-extrabold text-[#453052]">{title}</h2>
            <p id="pattern-confirm-description" className="mt-1.5 text-xs leading-5 text-[#8c7b98]">{description}</p>
          </div>
          <button
            ref={cancelRef}
            type="button"
            onClick={onClose}
            disabled={busy}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-xl text-[#a18eac] transition hover:bg-[#f7f1fb] hover:text-[#5a3d6f] disabled:opacity-40"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {error && <p role="alert" className="mx-5 mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold leading-5 text-rose-700">{error}</p>}
        <div className="flex items-center justify-end gap-2 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="min-h-10 rounded-xl border border-[#e9e0f0] bg-white px-4 text-xs font-bold text-[#806d8d] transition hover:bg-[#faf7fd] disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 text-xs font-extrabold text-white transition hover:bg-rose-700 disabled:opacity-55"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
};
