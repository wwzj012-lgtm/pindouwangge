/**
 * AdminBannedWords component tests: list load, add validation, toggle and
 * delete against an injected request mock.
 *
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { AdminBannedWords, bannedWordDraftError } from './AdminBannedWords';
import type { AdminBannedWordItem } from './AdminBannedWords';

interface BannedWordsPage { items: AdminBannedWordItem[] }

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) root.unmount();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

function item(patch: Partial<AdminBannedWordItem> = {}): AdminBannedWordItem {
  return {
    id: 1, word: '赌博', status: 'active', createdAt: '2026-11-22T10:00:00Z',
    updatedAt: '2026-11-22T10:00:00Z', ...patch,
  };
}

function page(items: AdminBannedWordItem[]): BannedWordsPage {
  return { items, total: items.length } as BannedWordsPage;
}

function setInput(selector: string, value: string): void {
  const element = document.querySelector(selector) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => { setter.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); });
}

function clickAdd(): void {
  const button = [...document.querySelectorAll('button')].find(item => item.textContent?.trim() === '添加违禁词');
  if (!button) throw new Error('Button missing: 添加违禁词');
  act(() => { button.click(); });
}

async function flush(): Promise<void> {
  await act(async () => { await Promise.resolve(); });
}

async function flushN(n = 2): Promise<void> {
  for (let index = 0; index < n; index += 1) await flush();
}

describe('bannedWordDraftError', () => {
  it('validates length and emptiness', () => {
    expect(bannedWordDraftError('')).toBe('请输入违禁词。');
    expect(bannedWordDraftError('   ')).toBe('请输入违禁词。');
    expect(bannedWordDraftError('x'.repeat(101))).toBe('违禁词长度需在 1-100 个字符之间。');
    expect(bannedWordDraftError('  违禁示例  ')).toBe(null);
  });
});

describe('AdminBannedWords flow', () => {
  async function rendered(request: ReturnType<typeof vi.fn>): Promise<HTMLElement> {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => { root.render(<AdminBannedWords request={request as never} />); });
    roots.push(root);
    await flushN(2);
    return container;
  }

  it('loads the list and renders every word with its state', async () => {
    const request = vi.fn((path: string) => {
      if (path === '/api/admin/community/banned-words') {
        return Promise.resolve({ ok: true, data: page([item(), item({ id: 2, word: '诈骗', status: 'disabled' })]) });
      }
      return Promise.resolve({ ok: true, data: page([]) });
    });
    const container = await rendered(request);
    expect(document.body.textContent).toContain('赌博');
    expect(document.body.textContent).toContain('诈骗');
    expect(request.mock.calls.filter(([path]) => String(path).includes('banned-words'))).toHaveLength(1);
    void container;
  });

  it('rejects an invalid draft locally without any request', async () => {
    const request = vi.fn((path: string) => Promise.resolve({ ok: true, data: page([item()]) }));
    await rendered(request);
    const before = request.mock.calls.length;
    setInput('[aria-label="新违禁词"]', '');
    clickAdd();
    await flushN(2);
    expect(document.body.textContent).toContain('请输入违禁词。');
    expect(request.mock.calls.length).toBe(before);
  });

  it('adds a trimmed word and reloads the list', async () => {
    const request = vi.fn((path: string, init?: { method?: string; body?: string }) => {
      if (path === '/api/admin/community/banned-words' && init?.method === 'POST') {
        const sent = JSON.parse(init.body!) as { word: string };
        expect(sent.word).toBe('洗钱');
        return Promise.resolve({ ok: true, data: { item: item({ id: 2, word: '洗钱' }) } });
      }
      return Promise.resolve({ ok: true, data: page([item(), item({ word: '洗钱' })]) });
    });
    await rendered(request);
    setInput('[aria-label="新违禁词"]', '  洗钱  ');
    clickAdd();
    await flushN(3);
    expect(document.body.textContent).toContain('洗钱');
    const sent = request.mock.calls.filter(([path, init]) => String(path) === '/api/admin/community/banned-words' && init?.method === 'POST');
    expect(sent).toHaveLength(1);
  });

  it('surfaces the server rejection without losing the list', async () => {
    const request = vi.fn((path: string, init?: { method?: string }) => {
      if (path === '/api/admin/community/banned-words' && init?.method === 'POST') {
        return Promise.resolve({ ok: false, status: 409, error: '违禁词已存在。' });
      }
      return Promise.resolve({ ok: true, data: page([item()]) });
    });
    await rendered(request);
    setInput('[aria-label="新违禁词"]', '赌博');
    clickAdd();
    await flushN(3);
    expect(document.body.textContent).toContain('违禁词已存在。');
  });
});
