import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Eraser, ShieldCheck, X } from 'lucide-react';
import type { BackgroundCleanupController } from '../hooks/useBackgroundCleanup';

/** 阈值档位：1~32 粒，覆盖从单粒噪点到中等碎块。 */
const THRESHOLD_OPTIONS = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32];

/**
 * 阈值下拉：自绘 listbox 菜单而非原生 <select>——原生弹层脱离浮动卡片的
 * 层叠上下文（系统级渲染），外观与玻璃卡片割裂且无法继承圆角/投影。
 * 菜单绝对定位在按钮正下方，与卡片同层；点击外部或 Escape 关闭。
 */
function ThresholdDropdown({ value, onChange, isEn }: { value: number; onChange: (next: number) => void; isEn: boolean }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); event.stopPropagation(); }
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button type="button" aria-haspopup="listbox" aria-expanded={open}
        aria-label={isEn ? 'Maximum block size' : '小块粒数阈值'}
        onClick={() => setOpen(previous => !previous)}
        className="inline-flex min-h-11 items-center gap-1 rounded-xl border border-slate-300 bg-white pl-3 pr-2 text-[13px] font-semibold text-slate-800 transition-colors hover:border-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/20">
        {value}{isEn ? ' beads' : ' 粒'}
        <ChevronDown aria-hidden="true" size={14}
          className={`text-slate-500 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <ul role="listbox" aria-label={isEn ? 'Maximum block size' : '小块粒数阈值'} tabIndex={-1}
          className="ir-float-card absolute left-0 top-full z-50 mt-1.5 max-h-64 w-28 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-lg shadow-slate-900/15 ring-1 ring-slate-900/5">
          {THRESHOLD_OPTIONS.map(size => {
            const selected = size === value;
            return (
              <li key={size}>
                <button type="button" role="option" aria-selected={selected}
                  onClick={() => { onChange(size); setOpen(false); }}
                  className={`flex min-h-9 w-full items-center justify-between rounded-lg px-2.5 text-[13px] font-medium transition-colors ${
                    selected ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'
                  }`}>
                  <span className="tabular-nums">{size}{isEn ? ' beads' : ' 粒'}</span>
                  {selected && <Check aria-hidden="true" size={13} />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

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
          <ThresholdDropdown value={control.threshold} onChange={next => control.setThreshold(next)} isEn={isEn} />
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
