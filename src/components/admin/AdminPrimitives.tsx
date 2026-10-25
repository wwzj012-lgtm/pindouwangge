import React, { useEffect, useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CircleAlert, Inbox, Loader2, X } from 'lucide-react';
import { adminErrorText } from './adminPresentation';

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
  const text = adminErrorText(message);
  return <div className="admin-error" role="alert"><CircleAlert aria-hidden="true" /><div><h2>{title}</h2><p>{text.summary}</p>
    {text.detail && <details><summary>技术详情</summary><p className="admin-mono">{text.detail}</p></details>}
    {retry && <AdminButton onClick={retry} busy={busy}>重试</AdminButton>}</div></div>;
}

const dialogStack: HTMLElement[] = [];
let bodyOverflow = '';
let bodyPaddingRight = '';
const backgroundState = new Map<HTMLElement, boolean>();
let backgroundObserver: MutationObserver | null = null;
function syncModalBackground() {
  const top = dialogStack.at(-1);
  for (const child of Array.from(document.body.children)) {
    if (!(child instanceof HTMLElement) || child.matches('script, style, link')) continue;
    if (!backgroundState.has(child)) backgroundState.set(child, child.inert);
    child.inert = top ? !child.contains(top) : backgroundState.get(child)!;
  }
  if (!top) {
    for (const [element, inert] of backgroundState) element.inert = inert;
    backgroundState.clear();
  }
}
const focusableSelector = 'button:not(:disabled), a[href], input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';
function focusables(dialog: HTMLElement): HTMLElement[] {
  return Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector))
    .filter(element => element.tabIndex >= 0 && !element.closest('[inert]') && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden');
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
  footer?: ReactNode;
}

/** Shared modal lifecycle: topmost focus trap, safe dismissal, scroll lock and focus return. */
function AdminDialog({ open, title, description, children, onClose, pending = false, dismissible = true, kind = 'dialog', side = 'right', className = '', footer }: DialogProps) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef({ onClose, pending, dismissible });
  closeRef.current = { onClose, pending, dismissible };
  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialogStack.length === 0) {
      bodyOverflow = document.body.style.overflow;
      bodyPaddingRight = document.body.style.paddingRight;
      const scrollbar = window.innerWidth - document.documentElement.clientWidth;
      if (scrollbar > 0) document.body.style.paddingRight = `${parseFloat(getComputedStyle(document.body).paddingRight) + scrollbar}px`;
      document.body.style.overflow = 'hidden';
    }
    dialogStack.push(dialog);
    if (!backgroundObserver) {
      backgroundObserver = new MutationObserver(syncModalBackground);
      backgroundObserver.observe(document.body, { childList: true });
    }
    const overlay = dialog.closest<HTMLElement>('.admin-overlay');
    if (overlay) overlay.style.zIndex = String(2147483000 + dialogStack.length);
    // Activate this portal before focusing it: parent and confirmation may mount
    // in the same commit, when the parent has just made this sibling inert.
    syncModalBackground();
    const targets = focusables(dialog);
    const initial = targets.find(element => element.hasAttribute('data-admin-autofocus'))
      ?? targets.find(element => element.getAttribute('aria-current') === 'page') ?? targets[0] ?? dialog;
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
    const retainFocus = () => {
      if (isTop() && dialog.isConnected && !dialog.contains(document.activeElement))
        (closeRef.current.pending ? dialog : focusables(dialog)[0] ?? dialog).focus({ preventScroll: true });
    };
    const focusin = () => retainFocus();
    // blur() and pointer focus defaults can leave BODY active without a focusin.
    // Check after the browser has completed the focus transition as well.
    const focusout = () => queueMicrotask(retainFocus);
    document.addEventListener('keydown', keydown, true);
    document.addEventListener('focusin', focusin, true);
    document.addEventListener('focusout', focusout, true);
    return () => {
      document.removeEventListener('keydown', keydown, true); document.removeEventListener('focusin', focusin, true); document.removeEventListener('focusout', focusout, true);
      const index = dialogStack.indexOf(dialog); if (index >= 0) dialogStack.splice(index, 1);
      if (dialogStack.length === 0) {
        document.body.style.overflow = bodyOverflow; document.body.style.paddingRight = bodyPaddingRight;
        backgroundObserver?.disconnect(); backgroundObserver = null;
      }
      syncModalBackground();
      const parent = dialogStack.at(-1);
      if (previous?.isConnected && previous.getClientRects().length && !previous.closest('[inert]') && (!parent || parent.contains(previous))) previous.focus({ preventScroll: true });
      else (parent ? focusables(parent)[0] ?? parent : document.querySelector<HTMLElement>('[data-admin-focus-fallback]'))?.focus({ preventScroll: true });
    };
  }, [open]);
  useLayoutEffect(() => {
    const dialog = ref.current;
    // Disabling the focused submit button can silently move focus to BODY;
    // that blur does not necessarily emit a focusin event for the trap.
    if (open && pending && dialog && dialogStack.at(-1) === dialog) dialog.focus({ preventScroll: true });
  }, [open, pending]);
  if (!open) return null;
  const close = () => { if (dialogStack.at(-1) === ref.current && !closeRef.current.pending && closeRef.current.dismissible) closeRef.current.onClose(); };
  const content = <div className="admin-root admin-portal-root" data-admin-portal>
    <div className={`admin-overlay admin-overlay--${kind}`}>
    <div className="admin-backdrop" aria-hidden="true" onPointerDown={event => {
      // Keep the native pointer default from blurring the active dialog. The
      // subsequent click retains the ordinary non-pending dismissal semantics.
      event.preventDefault();
    }} onClick={close} />
    <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-busy={pending || undefined} aria-labelledby={`${id}-title`} aria-describedby={description ? `${id}-description` : undefined}
      className={`admin-dialog admin-${kind} admin-drawer--${side} ${className}`}>
      <div className="admin-dialog-header"><div><h2 id={`${id}-title`}>{title}</h2>{description && <p id={`${id}-description`}>{description}</p>}</div>
        <AdminButton iconOnly variant="ghost" aria-label={`关闭${title}`} onClick={close} disabled={pending || !dismissible}><X aria-hidden="true" /></AdminButton>
      </div><div className="admin-dialog-body">{children}</div>{footer && <div className="admin-dialog-footer">{footer}</div>}
    </div>
  </div></div>;
  // Keep semantic static rendering available to SSR and existing security fixtures.
  return typeof document === 'undefined' ? content : createPortal(content, document.body);
}

export function AdminDrawer(props: Omit<DialogProps, 'kind'>) { return <AdminDialog {...props} kind="drawer" />; }

export function AdminConfirmDialog({ open, title, description, confirmLabel = '确认', onConfirm, onClose, pending = false, confirmDisabled = false, children, subject, impact, reason, tone = 'danger' }: {
  open: boolean; title: string; description: string; confirmLabel?: string; onConfirm: () => void; onClose: () => void; pending?: boolean; confirmDisabled?: boolean; children?: ReactNode;
  subject?: ReactNode; impact?: ReactNode; reason?: ReactNode; tone?: 'danger' | 'primary';
}) {
  return <AdminDialog open={open} title={title} description={description} onClose={onClose} pending={pending} className={`admin-confirm admin-confirm--${tone}`}
    footer={<><p className="admin-dialog-hint" role="status">{pending ? '正在提交，请等待结果，勿重复操作。' : '请核对对象与影响后再确认。'}</p><div className="admin-dialog-actions"><AdminButton data-admin-autofocus onClick={onClose} disabled={pending}>取消</AdminButton>
      <AdminButton variant={tone} onClick={onConfirm} busy={pending} disabled={confirmDisabled}>{confirmLabel}</AdminButton></div></>}>
    {(subject || impact || reason) && <dl className="admin-confirm-facts">{subject && <div><dt>操作对象</dt><dd>{subject}</dd></div>}{impact && <div><dt>影响范围</dt><dd>{impact}</dd></div>}{reason && <div><dt>操作原因</dt><dd>{reason}</dd></div>}</dl>}{children}
  </AdminDialog>;
}
