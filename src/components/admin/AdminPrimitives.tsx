import React, { useEffect, useId, useRef, type ReactNode } from 'react';
import { CircleAlert, Inbox, Loader2, X } from 'lucide-react';

type Tone = 'neutral' | 'success' | 'warning' | 'danger';
interface ButtonProps {
  children?: ReactNode;
  className?: string;
  disabled?: boolean;
  type?: 'button' | 'submit' | 'reset';
  onClick?: (event: unknown) => void;
  [attribute: string]: unknown;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  busy?: boolean;
  iconOnly?: boolean;
}

export function AdminButton({ variant = 'secondary', busy = false, iconOnly = false, className = '', disabled, children, type = 'button', ...props }: ButtonProps) {
  return <button {...props} type={type} disabled={disabled || busy} aria-busy={busy || undefined}
    className={`admin-button admin-button--${variant}${iconOnly ? ' admin-button--icon' : ''} ${className}`}>
    {busy && <Loader2 className="admin-spin" aria-hidden="true" />}{children}
  </button>;
}

export function AdminBadge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode; key?: string }) {
  return <span className={`admin-badge admin-badge--${tone}`}>{children}</span>;
}

export function AdminToolbar({ children, actions, label = '页面操作' }: { children?: ReactNode; actions?: ReactNode; label?: string }) {
  return <div className="admin-toolbar" role="group" aria-label={label}>
    <div className="admin-toolbar-copy">{children}</div><div className="admin-toolbar-actions">{actions}</div>
  </div>;
}

export function AdminLoading({ label = '正在加载数据…' }: { label?: string }) {
  return <div className="admin-state" role="status" aria-live="polite"><Loader2 className="admin-spin" aria-hidden="true" /><p>{label}</p></div>;
}

export function AdminEmptyState({ title = '暂无数据', description, action }: { title?: string; description?: string; action?: ReactNode }) {
  return <div className="admin-state"><Inbox aria-hidden="true" /><h2>{title}</h2>{description && <p>{description}</p>}{action}</div>;
}

export function AdminErrorState({ title = '暂时无法加载', message, retry, busy = false }: { title?: string; message: string; retry?: () => void; busy?: boolean }) {
  return <div className="admin-error" role="alert"><CircleAlert aria-hidden="true" /><div><h2>{title}</h2><p>{message}</p>
    {retry && <AdminButton onClick={retry} busy={busy}>重试</AdminButton>}</div></div>;
}

const dialogStack: HTMLElement[] = [];
let bodyOverflow = '';
const focusableSelector = 'button:not(:disabled), a[href], input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';
function focusables(dialog: HTMLElement): HTMLElement[] {
  return Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector))
    .filter(element => element.tabIndex >= 0 && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden');
}

interface DialogProps {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  pending?: boolean;
  dismissible?: boolean;
  kind?: 'dialog' | 'drawer';
  side?: 'left' | 'right';
  className?: string;
}

/** Shared modal lifecycle: topmost focus trap, safe dismissal, scroll lock and focus return. */
function AdminDialog({ open, title, description, children, onClose, pending = false, dismissible = true, kind = 'dialog', side = 'right', className = '' }: DialogProps) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef({ onClose, pending, dismissible });
  useEffect(() => { closeRef.current = { onClose, pending, dismissible }; }, [onClose, pending, dismissible]);
  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialogStack.length === 0) { bodyOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; }
    dialogStack.push(dialog);
    const initial = dialog.querySelector<HTMLElement>('[data-admin-autofocus]')
      ?? dialog.querySelector<HTMLElement>('[aria-current="page"]') ?? focusables(dialog)[0] ?? dialog;
    initial.focus({ preventScroll: true });
    const isTop = () => dialogStack[dialogStack.length - 1] === dialog;
    const keydown = (event: KeyboardEvent) => {
      if (!isTop()) return;
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation();
        if (!closeRef.current.pending && closeRef.current.dismissible) closeRef.current.onClose();
      }
      if (event.key === 'Tab') {
        const targets = focusables(dialog);
        const first = targets[0] ?? dialog;
        const last = targets[targets.length - 1] ?? dialog;
        if (targets.length === 0 || !dialog.contains(document.activeElement) || (event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
          event.preventDefault(); (event.shiftKey ? last : first).focus({ preventScroll: true });
        }
      }
    };
    const focusin = (event: FocusEvent) => { if (isTop() && !dialog.contains(event.target as Node)) (focusables(dialog)[0] ?? dialog).focus({ preventScroll: true }); };
    document.addEventListener('keydown', keydown, true);
    document.addEventListener('focusin', focusin);
    return () => {
      document.removeEventListener('keydown', keydown, true); document.removeEventListener('focusin', focusin);
      const index = dialogStack.indexOf(dialog); if (index >= 0) dialogStack.splice(index, 1);
      if (dialogStack.length === 0) document.body.style.overflow = bodyOverflow;
      if (previous?.isConnected && previous.getClientRects().length) previous.focus({ preventScroll: true });
      else document.querySelector<HTMLElement>('[data-admin-focus-fallback]')?.focus({ preventScroll: true });
    };
  }, [open]);
  if (!open) return null;
  const close = () => { if (!pending && dismissible) onClose(); };
  return <div className={`admin-overlay admin-overlay--${kind}`}>
    <div className="admin-backdrop" aria-hidden="true" onClick={close} />
    <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-busy={pending || undefined} aria-labelledby={`${id}-title`} aria-describedby={description ? `${id}-description` : undefined}
      className={`admin-dialog admin-${kind} admin-drawer--${side} ${className}`}>
      <div className="admin-dialog-header"><div><h2 id={`${id}-title`}>{title}</h2>{description && <p id={`${id}-description`}>{description}</p>}</div>
        <AdminButton iconOnly variant="ghost" aria-label={`关闭${title}`} onClick={close} disabled={pending || !dismissible}><X aria-hidden="true" /></AdminButton>
      </div><div className="admin-dialog-body">{children}</div>
    </div>
  </div>;
}

export function AdminDrawer(props: Omit<DialogProps, 'kind'>) { return <AdminDialog {...props} kind="drawer" />; }

export function AdminConfirmDialog({ open, title, description, confirmLabel = '确认', onConfirm, onClose, pending = false, children }: {
  open: boolean; title: string; description: string; confirmLabel?: string; onConfirm: () => void; onClose: () => void; pending?: boolean; children?: ReactNode;
}) {
  return <AdminDialog open={open} title={title} description={description} onClose={onClose} pending={pending}>
    {children}<div className="admin-dialog-actions"><AdminButton data-admin-autofocus onClick={onClose} disabled={pending}>取消</AdminButton>
      <AdminButton variant="danger" onClick={onConfirm} busy={pending}>{confirmLabel}</AdminButton></div>
  </AdminDialog>;
}
