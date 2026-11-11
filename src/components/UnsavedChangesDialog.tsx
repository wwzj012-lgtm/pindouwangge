import { useEffect, useRef } from 'react';
import { TriangleAlert } from 'lucide-react';

/**
 * 应用内「未保存修改」确认对话框。
 *
 * 替代 window.confirm / beforeunload 的浏览器原生弹窗：原生框由浏览器渲染，
 * 样式不可控（域名为标题、确定/取消含义也难读），且用户无法一眼看出
 * "放弃的是什么"。这里用与应用一致的卡片样式，把场景写进描述、
 * 把后果写进按钮文案。
 *
 * 可访问性：初始焦点落在确认按钮（唯一破坏性动作，Enter 一击即中但视觉
 * 上独立成行不误触）、Tab 循环困在框内、Escape 取消、关闭后焦点归还
 * 打开前的元素。
 */
export interface UnsavedChangesDialogProps {
  open: boolean;
  /** 场景化描述：放弃的到底是什么（如"识别结果与逐格复核记录"）。 */
  description: string;
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm(): void;
  onCancel(): void;
}

export function UnsavedChangesDialog({
  open,
  description,
  title = '有未保存的修改',
  confirmLabel = '放弃修改并继续',
  cancelLabel = '留在此页',
  onConfirm,
  onCancel,
}: UnsavedChangesDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  // 回调存 ref：调用方的 onCancel/onConfirm 多为内联箭头函数（每次渲染
  // 新引用），进 effect deps 会让焦点逻辑每次渲染都重跑。
  const callbacksRef = useRef({ onConfirm, onCancel });
  callbacksRef.current = { onConfirm, onCancel };

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = requestAnimationFrame(() => confirmRef.current?.focus());
    // capture 阶段拦截 Escape：确认框在上层时，Escape 只关确认框，
    // 不应穿透到下层（如识别向导）触发它自己的关闭逻辑。
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        callbacksRef.current.onCancel();
        return;
      }
      if (event.key !== 'Tab') return;
      // 焦点陷阱：框内只有两个按钮，Tab 不需要走出这张卡片
      const focusable = [cancelRef.current, confirmRef.current].filter((element): element is HTMLButtonElement => element !== null);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onKey, true);
      returnFocusRef.current?.focus();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-md"
      role="presentation"
      onClick={onCancel}
    >
      <section
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="unsaved-changes-title"
        aria-describedby="unsaved-changes-description"
        className="w-full max-w-sm rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl"
        onClick={event => event.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-amber-100 text-amber-600" aria-hidden="true">
            <TriangleAlert size={19} />
          </span>
          <div className="min-w-0">
            <h2 id="unsaved-changes-title" className="text-base font-black text-slate-900">{title}</h2>
            <p id="unsaved-changes-description" className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="min-h-11 rounded-xl border border-slate-300 px-4 py-2.5 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/60"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            className="min-h-11 rounded-xl bg-rose-600 px-4 py-2.5 text-xs font-bold text-white transition-colors hover:bg-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/50"
          >
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
