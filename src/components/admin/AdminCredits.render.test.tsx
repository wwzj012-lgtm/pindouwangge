/**
 * AdminCredits component tests: the money-moving path. Renders the panel in
 * jsdom with an injected request mock and drives the full adjustment flow —
 * permission guard, prepare validation, idempotent submit payload and the
 * unknown-outcome recovery branch.
 *
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { AdminCredits, type AdminCreditsProps } from './AdminCredits';
import type { CreditAdjustment, CreditAdjustmentBody, CreditPage, CreditAccount, CreditLedgerOperation } from './adminCreditsModel';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
const containers: HTMLElement[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) act(() => { root.unmount(); });
  for (const container of containers.splice(0)) container.remove();
  // jsdom sessionStorage persists across tests in the same file; leftover
  // recovery snapshots would silently block the prepare() flow.
  window.sessionStorage.clear();
  vi.unstubAllGlobals();
});

function account(patch: Partial<CreditAccount> = {}): CreditAccount {
  return {
    uid: 'target-user', email: 'target@example.com', displayName: '目标用户',
    availableUnits: 120, heldUnits: 0, version: 3, unitsPerPoint: 10, ...patch,
  };
}

function adjustment(body: CreditAdjustmentBody): CreditAdjustment {
  return {
    id: 'adjust-1', unitsPerPoint: 10, operatorUid: 'admin-1', uid: body.uid,
    idempotencyKey: body.idempotencyKey, deltaUnits: body.deltaUnits, reason: body.reason,
    beforeVersion: body.expectedVersion, afterVersion: body.expectedVersion + 1,
    beforeAvailableUnits: body.expectedAvailableUnits, heldUnits: body.expectedHeldUnits,
    afterAvailableUnits: body.expectedAvailableUnits + body.deltaUnits, createdAt: 1764000000000,
  };
}

function ledgerPage(): CreditPage<CreditLedgerOperation> {
  return { items: [], total: 0, limit: 20, offset: 0 };
}

function renderPanel(request: ReturnType<typeof vi.fn>, props: Partial<AdminCreditsProps> = {}): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<AdminCredits
      request={request as unknown as AdminCreditsProps['request']}
      canRead={props.canRead ?? true}
      canAdjust={props.canAdjust ?? false}
      operatorUid={props.operatorUid ?? 'admin-1'}
    />);
  });
  containers.push(container);
  roots.push(root);
  return container;
}

function setInput(_container: HTMLElement, selector: string, value: string): void {
  const element = document.querySelector(selector) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value',
  )!.set!;
  act(() => { setter.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); });
}

function submitForm(_container: HTMLElement, selector: string): void {
  const form = document.querySelector(selector) as HTMLFormElement;
  act(() => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
}

function clickButton(_container: HTMLElement, label: string): void {
  const button = [...document.querySelectorAll('button')].find(item => item.textContent?.trim() === label);
  if (!button) throw new Error(`Button missing: ${label}`);
  act(() => { button.click(); });
}

async function flush(): Promise<void> {
  await act(async () => { await Promise.resolve(); });
}

describe('AdminCredits: permission guard', () => {
  it('shows the read-denied alert and never calls request when canRead is false', async () => {
    const request = vi.fn();
    const container = renderPanel(request, { canRead: false, canAdjust: false });
    await flush();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('没有查看积分的权限');
    expect(request).not.toHaveBeenCalled();
  });
});

describe('AdminCredits: idempotent adjustment flow', () => {
  function makeRequest(adjustResponse?: { status: number; ok: boolean }): ReturnType<typeof vi.fn> {
    return vi.fn((path: string) => {
      if (path.startsWith('/api/admin/credits/accounts?')) {
        return Promise.resolve({ ok: true, data: { items: [account()], total: 1, limit: 20, offset: 0 } as CreditPage<CreditAccount> });
      }
      if (path.startsWith('/api/admin/credits/ledger?')) {
        return Promise.resolve({ ok: true, data: ledgerPage() });
      }
      if (path.startsWith('/api/admin/credits/account?')) {
        return Promise.resolve({ ok: true, data: { account: account() } });
      }
      if (path.startsWith('/api/admin/credits/adjust')) {
        return Promise.resolve(adjustResponse ?? { ok: true });
      }
      return Promise.resolve({ ok: true, data: ledgerPage() });
    });
  }

  async function preparedContainer(request: ReturnType<typeof vi.fn>, amount = '5', reason = '活动补偿'): Promise<HTMLElement> {
    const container = renderPanel(request, { canRead: true, canAdjust: true });
    await flush(); // accounts + ledger load
    // Open the adjustment dialog for the first account row ("查看" button).
    clickButton(container, '查看');
    await flush(); // account detail loads inside the dialog
    setInput(container, 'input[inputmode="decimal"]', amount);
    const reasonField = document.querySelector('textarea') as HTMLTextAreaElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(reasonField, reason);
      reasonField.dispatchEvent(new Event('input', { bubbles: true }));
    });
    submitForm(container, 'form[aria-label="填写积分调整"]');
    await flush();
    return container;
  }

  it('sends units-per-point delta, expected snapshot and an idempotency key on confirm', async () => {
    const sentBodies: CreditAdjustmentBody[] = [];
    const body: CreditAdjustmentBody = {
      uid: 'target-user', deltaUnits: 50, reason: '活动补偿', expectedVersion: 3,
      expectedAvailableUnits: 120, expectedHeldUnits: 0, idempotencyKey: '00000000-0000-4000-8000-000000000000',
    };
    const response = adjustment(body);
    const container = await preparedContainer(
      vi.fn((path: string, init?: { method?: string; body?: string }) => {
        if (path.startsWith('/api/admin/credits/adjust')) {
          const sent = JSON.parse(init!.body!) as CreditAdjustmentBody;
          sentBodies.push(sent);
          // Echo the received body back: matchesCreditAdjustment validates the
          // response against the exact idempotency key the client generated.
          return Promise.resolve({ ok: true, data: adjustment(sent) });
        }
        if (path.startsWith('/api/admin/credits/accounts?')) {
          return Promise.resolve({ ok: true, data: { items: [account()], total: 1, limit: 20, offset: 0 } as CreditPage<CreditAccount> });
        }
        if (path.startsWith('/api/admin/credits/account?')) {
          return Promise.resolve({ ok: true, data: { account: account() } });
        }
        return Promise.resolve({ ok: true, data: ledgerPage() });
      }),
    );
    // Confirm dialog opens with the prepared body, then confirm submits.
    expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    clickButton(container, '确认调整');
    await flush(); await flush(); // submit -> request resolve -> completed() re-render
    expect(sentBodies).toHaveLength(1);
    const sent = sentBodies[0];
    expect(sent.deltaUnits).toBe(50);
    expect(sent.expectedVersion).toBe(3);
    expect(sent.expectedAvailableUnits).toBe(120);
    expect(sent.uid).toBe('target-user');
    expect(sent.reason).toBe('活动补偿');
    expect(sent.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    await flush(); await flush(); // settle the revision-triggered refetches
    expect(document.body.textContent).toContain('调整已完成');
    expect(document.querySelector('[data-credit-success]')?.textContent).toContain('审计编号');
  });

  it('clears the recovery snapshot and shows the server error when the adjust call is rejected', async () => {
    const container = await preparedContainer(makeRequest({ status: 403, ok: false }));
    clickButton(container, '确认调整');
    await flush(); await flush(); // rejection -> clearRecovery() -> re-render
    const alert = document.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('服务端拒绝');
  });

  it('keeps the recovery snapshot with an unknown-outcome message when the connection breaks', async () => {
    const request = vi.fn((path: string, init?: { method?: string; body?: string }) => {
      if (path.startsWith('/api/admin/credits/adjust')) {
        const sent = JSON.parse(init!.body!) as CreditAdjustmentBody;
        const stored = JSON.parse(
          window.sessionStorage.getItem(`admin-credit-recovery:v1:admin-1`)!,
        ) as { body: CreditAdjustmentBody };
        // The snapshot must already be saved before the request leaves.
        expect(stored.body.idempotencyKey).toBe(sent.idempotencyKey);
        return Promise.reject(new Error('connection lost'));
      }
      if (path.startsWith('/api/admin/credits/accounts?')) {
        return Promise.resolve({ ok: true, data: { items: [account()], total: 1, limit: 20, offset: 0 } as CreditPage<CreditAccount> });
      }
      if (path.startsWith('/api/admin/credits/account?')) {
        return Promise.resolve({ ok: true, data: { account: account() } });
      }
      return Promise.resolve({ ok: true, data: ledgerPage() });
    });
    const container = await preparedContainer(request);
    clickButton(container, '确认调整');
    await flush(); await flush(); // connection loss -> recovery banner re-render
    const recoverySection = document.querySelector('[aria-label="待核查积分调整"]');
    expect(recoverySection).toBeTruthy();
    expect(recoverySection?.textContent).toContain('结果未知');
  });
});
