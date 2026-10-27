import React, { useEffect, useRef } from 'react';
import { ShieldCheck, X } from 'lucide-react';
import type { BackgroundCleanupController } from '../hooks/useBackgroundCleanup';

/**
 * Compact layout: [threshold] [candidate count] / [protect hint] [cancel] [confirm].
 * Wraps on phones, keeps 44px controls, and uses existing workspace typography.
 */
export function BackgroundCleanupPanel({ control, isEn }: { control: BackgroundCleanupController; isEn: boolean }) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { cancelRef.current?.focus({ preventScroll: true }); }, []);
  if (!control.preview) return null;
  return (
    <section role="region" aria-label={isEn ? 'Residual cleanup preview' : '清理残点预览'}
      className="relative z-20 shrink-0 border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-bold">{isEn ? 'Clean residuals' : '清理残点'}</span>
        <label className="inline-flex min-h-11 items-center gap-2">
          {isEn ? 'Small blocks ≤' : '小块不超过'}
          <select aria-label={isEn ? 'Maximum block size' : '小块粒数阈值'} value={control.threshold}
            onChange={event => control.setThreshold(Number(event.target.value))}
            className="min-h-11 rounded-lg border border-amber-300 bg-white px-2 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600">
            {[1, 2, 4, 8, 16].map(size => <option key={size} value={size}>{size}{isEn ? ' beads' : ' 粒'}</option>)}
          </select>
        </label>
        <span role="status" aria-live="polite" className="font-semibold tabular-nums">
          {isEn ? `${control.selectedComponents} blocks · ${control.selectedCells} beads selected`
            : `待清除 ${control.selectedComponents} 块 · ${control.selectedCells} 粒`}
          {control.protectedComponents > 0 && (isEn ? ` · ${control.protectedComponents} protected` : ` · 已保护 ${control.protectedComponents} 块`)}
        </span>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 flex-1 basis-44 text-[11px] leading-relaxed">
          <ShieldCheck aria-hidden="true" size={13} className="mr-1 inline" />
          {isEn ? 'Drawing paused. Tap an orange block to keep it; tap again to undo protection. Subjects and inner details stay.'
            : '绘制已暂停。点橙色小块可保护，再点恢复选中；保留主体及内部细节。'}
          {control.selectedCells === 0 && <span className="ml-1 font-semibold">{isEn ? 'No removable blocks selected.' : '当前没有待清除小块。'}</span>}
        </p>
        <div className="flex shrink-0 gap-2">
          <button ref={cancelRef} type="button" onClick={control.cancel}
            className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-amber-300 bg-white px-3 font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600">
            <X aria-hidden="true" size={14} />{isEn ? 'Cancel' : '取消'}
          </button>
          <button type="button" onClick={control.confirm} disabled={control.selectedCells === 0}
            className="min-h-11 rounded-lg bg-amber-700 px-3 font-bold text-white hover:bg-amber-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40">
            {isEn ? 'Confirm cleanup' : '确认清除'}
          </button>
        </div>
      </div>
    </section>
  );
}
