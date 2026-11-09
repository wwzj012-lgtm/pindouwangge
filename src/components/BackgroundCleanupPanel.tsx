import React, { useEffect, useRef } from 'react';
import { Eraser, ShieldCheck, X } from 'lucide-react';
import type { BackgroundCleanupController } from '../hooks/useBackgroundCleanup';

/**
 * Floating glass card over the canvas (absolutely positioned by the caller, so
 * opening the preview never shifts the layout). Compact two-line layout:
 * [title] [threshold] [status pill] [cancel] [confirm] over a hint line.
 * Wraps on phones, keeps 44px controls, rose destructive action.
 */
export function BackgroundCleanupPanel({ control, isEn }: { control: BackgroundCleanupController; isEn: boolean }) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { cancelRef.current?.focus({ preventScroll: true }); }, []);
  if (!control.preview) return null;
  const empty = control.selectedCells === 0;
  return (
    <section role="region" aria-label={isEn ? 'Residual cleanup preview' : '清理残点预览'}
      className="ir-float-card pointer-events-auto w-full max-w-3xl rounded-2xl bg-white/95 shadow-lg shadow-slate-900/10 ring-1 ring-slate-900/10 backdrop-blur-md px-3.5 py-2.5 text-sm text-slate-700">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <span className="inline-flex items-center gap-1.5 font-bold text-slate-900">
          <Eraser aria-hidden="true" size={15} className="text-slate-500" />
          {isEn ? 'Clean residuals' : '清理残点'}
        </span>
        <label className="inline-flex min-h-11 items-center gap-1.5 text-[13px]">
          {isEn ? 'Small blocks ≤' : '小块不超过'}
          <select aria-label={isEn ? 'Maximum block size' : '小块粒数阈值'} value={control.threshold}
            onChange={event => control.setThreshold(Number(event.target.value))}
            className="min-h-11 rounded-xl border border-slate-300 bg-white px-2 text-[13px] font-semibold text-slate-800 transition-colors hover:border-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/20">
            {[1, 2, 4, 8, 16].map(size => <option key={size} value={size}>{size}{isEn ? ' beads' : ' 粒'}</option>)}
          </select>
        </label>
        <span role="status" aria-atomic="true"
          className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums ${
            empty ? 'bg-slate-100 text-slate-500' : 'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200'
          }`}>
          {empty ? (isEn ? 'No removable blocks' : '没有待清除的残点')
            : (isEn
              ? `${control.selectedComponents} blocks · ${control.selectedCells} beads`
              : `待清除 ${control.selectedComponents} 块 · ${control.selectedCells} 粒`)}
          {control.protectedComponents > 0 && (isEn ? ` · ${control.protectedComponents} kept` : ` · 已保护 ${control.protectedComponents} 块`)}
        </span>
        <div className="ml-auto flex shrink-0 gap-2">
          <button ref={cancelRef} type="button" onClick={control.cancel}
            className="inline-flex min-h-11 items-center gap-1 rounded-xl border border-slate-300 bg-white px-3.5 font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/20">
            <X aria-hidden="true" size={14} />{isEn ? 'Cancel' : '取消'}
          </button>
          <button type="button" onClick={control.confirm} disabled={empty}
            className="inline-flex min-h-11 items-center rounded-xl bg-rose-600 px-3.5 font-bold text-white shadow-sm transition-colors hover:bg-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-600/40 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40">
            {isEn ? 'Clean up' : '确认清除'}
          </button>
        </div>
      </div>
      <p className="mt-1 flex min-w-0 items-center gap-1.5 text-xs leading-relaxed text-slate-500">
        <ShieldCheck aria-hidden="true" size={13} className="shrink-0 text-slate-400" />
        {isEn
          ? 'Drawing paused. Tap an orange block to keep it; tap again to undo. Subjects and inner details stay.'
          : '绘制已暂停：点橙色小块可保留，再点恢复清除；主体与内部细节自动保留。'}
      </p>
    </section>
  );
}
