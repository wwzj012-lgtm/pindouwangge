import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { AdminButton, AdminConfirmDialog, AdminDrawer, AdminErrorState } from './AdminPrimitives';

export async function runAdminDialogChecks() {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const checks: string[] = [], browserErrors: string[] = [];
  window.addEventListener('error', event => browserErrors.push(event.message));
  const assert = (value: unknown, label: string) => { if (!value) throw new Error(label); checks.push(label); };
  const rootNode = document.getElementById('root')!;
  let root = createRoot(rootNode);
  const oldOverflow = document.body.style.overflow;
  document.body.style.overflow = 'scroll';
  let drawer = false, confirm = false, busy = false, failed = false, long = true, closes = 0, submissions = 0;
  const flush = async (action?: () => void) => {
    await act(async () => { action?.(); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  };
  const render = () => root.render(<div className="admin-root" style={{ transform: 'translateZ(0)', overflow: 'hidden', height: 120 }}>
    <AdminButton data-trigger onClick={() => { drawer = true; render(); }}>打开用户操作</AdminButton>
    <AdminDrawer open={drawer} title="用户操作" onClose={() => { drawer = false; closes++; render(); }}>
      <label className="admin-field">内部备注<input data-note defaultValue="保留输入" /></label>
      <AdminButton data-review onClick={() => { confirm = true; render(); }}>复核封禁</AdminButton>
    </AdminDrawer>
    <AdminConfirmDialog open={confirm} title="确认封禁用户" description="请核对目标和原因。" subject="测试用户 · UID：user-dialog-fixture" impact="限制此账号，保留图纸。" reason="重复违规" pending={busy} confirmDisabled={failed}
      onClose={() => { confirm = false; closes++; render(); }} onConfirm={() => { submissions++; busy = true; render(); }}>
      <label className="admin-stage-field">补充说明<textarea data-reason defaultValue="原始原因" disabled={busy} /></label>
      {long && <div style={{ height: 1000 }}>较长的核对内容</div>}
      {failed && <AdminErrorState title="写入结果不确定" message="请先重读并核对；当前输入保留。" />}
    </AdminConfirmDialog>
  </div>);
  const dialogs = () => Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'));
  const top = () => dialogs().at(-1)!;
  const button = (text: string) => Array.from(top().querySelectorAll<HTMLButtonElement>('button')).find(node => node.textContent?.trim() === text)!;
  const key = async (value: string, shiftKey = false) => flush(() => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: value, shiftKey, bubbles: true, cancelable: true })));
  const fits = (label: string) => {
    const rect = top().getBoundingClientRect();
    assert(rect.left >= 0 && rect.right <= innerWidth + 1 && rect.top >= 0 && rect.bottom <= innerHeight + 1, label + ': dialog within viewport');
    assert(document.documentElement.scrollWidth <= innerWidth + 1, label + ': no page overflow');
  };
  await flush(render);
  const trigger = document.querySelector<HTMLButtonElement>('[data-trigger]')!;
  trigger.focus(); await flush(() => trigger.click());
  assert(dialogs().length === 1 && !rootNode.contains(top()), 'drawer portals outside clipped transformed mount');
  assert(top().closest('[data-admin-portal]')?.parentElement === document.body, 'portal attaches directly to body');
  assert(rootNode.inert, 'background root is inert');
  assert(document.body.style.overflow === 'hidden', 'body scroll locks');
  const lateBackground = document.createElement('button');
  lateBackground.textContent = '外部新增按钮'; document.body.append(lateBackground);
  await flush();
  assert(lateBackground.inert, 'background nodes inserted while open also become inert');
  assert(top().contains(document.activeElement), 'initial focus enters drawer');
  fits('drawer');
  const review = document.querySelector<HTMLButtonElement>('[data-review]')!;
  review.focus(); await flush(() => review.click());
  assert(dialogs().length === 2, 'nested confirmation keeps editor mounted');
  assert(document.activeElement === button('取消'), 'danger confirmation initially focuses cancel');
  assert(dialogs()[0].closest<HTMLElement>('[data-admin-portal]')!.inert, 'underlying drawer becomes inert');
  assert(!top().closest<HTMLElement>('[data-admin-portal]')!.inert, 'top confirmation stays interactive');
  assert(Number(top().closest<HTMLElement>('.admin-overlay')!.style.zIndex) > Number(dialogs()[0].closest<HTMLElement>('.admin-overlay')!.style.zIndex), 'nested confirmation stacks over drawer');
  assert(top().textContent?.includes('操作对象') && top().textContent?.includes('user-dialog-fixture') && top().textContent?.includes('影响范围') && top().textContent?.includes('操作原因'), 'confirmation exposes Chinese object impact and reason');
  fits('confirmation');
  const reasonField = top().querySelector<HTMLTextAreaElement>('[data-reason]')!;
  assert(getComputedStyle(reasonField.closest('label')!).display === 'grid', 'portal field label retains shared grid layout');
  assert(reasonField.clientHeight >= 100 && parseFloat(getComputedStyle(reasonField).borderTopWidth) >= 1, 'portal reason retains multiline height and visible border');
  assert(reasonField.getBoundingClientRect().width >= top().querySelector('.admin-dialog-body')!.clientWidth - 50, 'portal reason expands to the available body width');
  const content = top().querySelector<HTMLElement>('.admin-dialog-body')!;
  assert(content.scrollHeight > content.clientHeight, 'long body scrolls internally');
  const footerRect = top().querySelector<HTMLElement>('.admin-dialog-footer')!.getBoundingClientRect();
  assert(footerRect.bottom <= innerHeight && footerRect.top >= 0, 'cancel and submit footer remains within viewport');
  button('确认').focus(); await key('Tab');
  assert(document.activeElement?.getAttribute('aria-label') === '关闭确认封禁用户', 'Tab wraps to first focusable');
  await key('Tab', true); assert(document.activeElement === button('确认'), 'Shift Tab wraps to last focusable');
  trigger.focus(); assert(top().contains(document.activeElement), 'background cannot steal focus');
  await key('Escape');
  assert(dialogs().length === 1 && rootNode.inert, 'Escape closes only top confirmation');
  assert(document.activeElement === review, 'closing confirmation returns focus to review trigger');
  assert(!dialogs()[0].closest<HTMLElement>('[data-admin-portal]')!.inert, 'underlying drawer restores interaction');
  assert(document.body.style.overflow === 'hidden', 'nested close preserves scroll lock');
  await flush(() => review.click());
  button('确认').focus();
  await flush(() => button('确认').click());
  assert(submissions === 1 && Array.from(top().querySelectorAll('button')).every(node => node.disabled), 'busy confirm disables close cancel and submit');
  assert(document.activeElement === top(), 'disabling a focused submit keeps pending focus on the top dialog container');
  const before = closes;
  await key('Escape');
  await flush(() => top().closest('.admin-overlay')!.querySelector<HTMLElement>('.admin-backdrop')!.click());
  assert(closes === before && dialogs().length === 2, 'busy Escape and backdrop cannot dismiss');
  assert(top().contains(document.activeElement), 'pending Escape and backdrop preserve focus inside dialog');
  await flush(() => button('确认').click());
  assert(submissions === 1, 'disabled submit cannot repeat');
  await flush(() => { busy = false; failed = true; render(); });
  assert(top().querySelector('[role="alert"]')?.textContent?.includes('写入结果不确定'), 'error remains inside confirmation');
  assert(button('确认').disabled && !button('取消').disabled, 'uncertain error blocks submission but permits cancel');
  assert(top().querySelector<HTMLTextAreaElement>('[data-reason]')?.value === '原始原因', 'error rerender preserves entered reason');
  await flush(() => button('取消').click());
  assert(document.querySelector<HTMLInputElement>('[data-note]')?.value === '保留输入', 'cancel preserves underlying editor');
  await key('Escape');
  assert(dialogs().length === 0 && !rootNode.inert, 'last close removes dialogs and restores background');
  assert(!lateBackground.inert, 'last close restores dynamically inserted background');
  lateBackground.remove();
  assert(document.body.style.overflow === 'scroll', 'last close restores original body overflow');
  assert(document.activeElement === trigger, 'last close returns focus to original trigger');
  await flush(() => trigger.click());
  await flush(() => root.unmount());
  assert(!document.querySelector('[data-admin-portal]') && !rootNode.inert && document.body.style.overflow === 'scroll', 'unmount cleans portal inert and scroll lock');
  document.body.style.overflow = oldOverflow;
  // Leave the current error confirmation mounted for the independent UI reviewer.
  // ADMIN_DIALOGS_EVIDENCE_DIR enables the harness's 390 / 1280 screenshots.
  root = createRoot(rootNode); drawer = true; confirm = true; long = false;
  await flush(render);
  assert(document.activeElement === button('取消'), 'simultaneously mounted drawer and confirmation focus the top cancel');
  fits('error evidence');
  return { checks, browserErrors, viewportWidth: innerWidth, writeCount: 0 };
}
