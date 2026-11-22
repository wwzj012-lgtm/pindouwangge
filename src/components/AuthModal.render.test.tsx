/**
 * AuthModal component tests: the sign-in/sign-up money-adjacent path.
 * useAuth is mocked at module level; apiPost is partially mocked so the
 * request-option constants stay real. Covers the required-field guard, the
 * successful sign-in payload (normalised email, persistence, browser
 * credential save), sign-up persistence, the ambiguous-network sign-up state
 * and the credential-error surface.
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { AuthModal } from './AuthModal';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  saveBrowserPasswordCredential: vi.fn(),
}));

const setLocalCustomUser = vi.fn();
const logoutUser = vi.fn();
const redeemVipCode = vi.fn();
const saveBrowserPasswordCredential = vi.fn();
let apiPostResult: Record<string, unknown> = { ok: true };
const apiPostCalls: { path: string; body: Record<string, unknown> }[] = [];

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    currentUser: null,
    userProfile: null,
    loading: false,
    isVip: false,
    isPro: false,
    isAdmin: false,
    canAccessAdmin: false,
    redeemVipCode,
    setLocalCustomUser,
    logoutUser,
  }),
}));

vi.mock('../utils/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/api')>();
  return {
    ...actual,
    apiPost: (path: string, body?: unknown) => {
      apiPostCalls.push({ path, body: body as Record<string, unknown> });
      return Promise.resolve(apiPostResult);
    },
  };
});

vi.mock('../utils/authCredentials', () => ({
  saveBrowserPasswordCredential: mocks.saveBrowserPasswordCredential,
  AUTH_AUTOCOMPLETE: {},
}));

const roots: Root[] = [];
let closeCalls = 0;
afterEach(() => {
  closeCalls = 0;
  for (const root of roots.splice(0)) act(() => { root.unmount(); });
  document.body.innerHTML = '';
  setLocalCustomUser.mockClear();
  logoutUser.mockClear();
  redeemVipCode.mockClear();
  mocks.saveBrowserPasswordCredential.mockClear();
  apiPostCalls.length = 0;
  apiPostResult = { ok: true };
});

function setInput(selector: string, value: string): void {
  const element = document.querySelector(selector) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype, 'value',
  )!.set!;
  act(() => { setter.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); });
}

function submit(): void {
  const form = document.querySelector('form[autocomplete="on"], form') as HTMLFormElement;
  act(() => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
}

async function flush(n = 2): Promise<void> {
  for (let index = 0; index < n; index += 1) await act(async () => { await Promise.resolve(); });
}

async function rendered(): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<AuthModal isOpen onClose={() => { closeCalls += 1; }} />);
  });
  roots.push(root);
  await flush();
  return container;
}

async function fillCredentials(email = ' Creator@Example.COM ', password = 'secret123'): Promise<void> {
  setInput('[aria-label="手机号 / 邮箱 / 账号"]', email);
  setInput('[aria-label="登录密码"]', password);
  submit();
  await flush(3); // apiPost resolve -> throw -> parse -> setStructuredError -> render
}

describe('AuthModal: required-field guard', () => {
  it('shows the required-fields error and never calls the API on an empty submit', async () => {
    await rendered();
    submit();
    await flush();
    expect(document.body.textContent).toContain('请完整填写登录信息');
    expect(apiPostCalls).toHaveLength(0);
  });
});

describe('AuthModal: sign-in', () => {
  it('normalises the email, persists by default and saves the browser credential', async () => {
    const session = { uid: 'user-1', token: 't', email: 'creator@example.com', displayName: '创作者' };
    apiPostResult = { ok: true, data: session };
    await rendered();
    await fillCredentials();
    expect(apiPostCalls).toHaveLength(1);
    expect(apiPostCalls[0].path).toBe('/api/auth/signin');
    expect(apiPostCalls[0].body.email).toBe('Creator@Example.COM');
    expect(apiPostCalls[0].body.password).toBe('secret123');
    expect(setLocalCustomUser).toHaveBeenCalledWith(session, 'persistent');
    expect(mocks.saveBrowserPasswordCredential).toHaveBeenCalledWith('Creator@Example.COM', 'secret123');
    expect(closeCalls).toBe(1);
  });

  it('keeps the session-scoped persistence when remember-login is unchecked', async () => {
    const session = { uid: 'user-1', token: 't', email: 'creator@example.com', displayName: '创作者' };
    apiPostResult = { ok: true, data: session };
    await rendered();
    setInput('[aria-label="手机号 / 邮箱 / 账号"]', 'creator@example.com');
    setInput('[aria-label="登录密码"]', 'secret123');
    const checkbox = document.querySelector('input[type="checkbox"]') as HTMLInputElement;
    act(() => { checkbox.click(); });
    submit();
    await flush();
    expect(setLocalCustomUser).toHaveBeenCalledWith(session, 'session');
    expect(mocks.saveBrowserPasswordCredential).not.toHaveBeenCalled();
  });

  it('surfaces the credential error for a wrong password', async () => {
    apiPostResult = { ok: false, status: 401, error: 'code: auth/invalid-credential' };
    await rendered();
    await fillCredentials('creator@example.com', 'wrong-password');
    expect(document.body.textContent).toContain('登录异常，请稍后重试');
    expect(setLocalCustomUser).not.toHaveBeenCalled();
  });
});

describe('AuthModal: sign-up', () => {
  it('posts the signup endpoint and always persists the session', async () => {
    const session = { uid: 'user-2', token: 't2', email: 'new@example.com', displayName: 'new' };
    apiPostResult = { ok: true, data: session };
    await rendered();
    // Switch to signup mode.
    const modeButton = [...document.querySelectorAll('button')].find(item => item.textContent?.includes('没有账号？点此注册'));
    if (!modeButton) throw new Error('signup mode button missing');
    act(() => { modeButton.click(); });
    await fillCredentials('new@example.com', 'secret123');
    expect(apiPostCalls[0].path).toBe('/api/auth/signup');
    expect(setLocalCustomUser).toHaveBeenCalledWith(session, 'persistent');
  });

  it('tells the user the sign-up outcome is unknown on a network failure', async () => {
    apiPostResult = { ok: false, isNetworkError: true, error: 'network' };
    await rendered();
    const modeButton = [...document.querySelectorAll('button')].find(item => item.textContent?.includes('没有账号？点此注册'));
    if (!modeButton) throw new Error('signup mode button missing');
    act(() => { modeButton.click(); });
    await fillCredentials('new@example.com', 'secret123');
    expect(document.body.textContent).toContain('注册结果待确认');
    expect(setLocalCustomUser).not.toHaveBeenCalled();
  });
});
