/**
 * AdminCommunityTagDictionary component tests: dictionary load, rename and
 * hide/restore against an injected request mock.
 *
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { AdminCommunityTagDictionary, tagDictionaryQuery, tagUpdateBody, type TagDictionaryItem } from './AdminCommunityTagDictionary';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) root.unmount();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

function item(patch: Partial<TagDictionaryItem> = {}): TagDictionaryItem {
  return { tag: '像素拼豆', name: '像素拼豆', usageCount: 3, status: 'active', createdAt: '2026-11-01', ...patch };
}

function setInput(selector: string, value: string): void {
  const element = document.querySelector(selector) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => { setter.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); });
}

function clickButton(label: string): void {
  const button = [...document.querySelectorAll('button')].find(item => item.textContent?.trim() === label);
  if (!button) throw new Error(`Button missing: ${label}`);
  act(() => { button.click(); });
}

function clickAria(selector: string): void {
  const element = document.querySelector(selector) as HTMLButtonElement;
  if (!element) throw new Error(`Element missing: ${selector}`);
  act(() => { element.click(); });
}

async function flush(): Promise<void> {
  await act(async () => { await Promise.resolve(); });
}

async function flushN(n = 2): Promise<void> {
  for (let index = 0; index < n; index += 1) await flush();
}

describe('tagDictionaryQuery / tagUpdateBody (pure helpers)', () => {
  it('builds status/limit/offset query parameters', () => {
    expect(tagDictionaryQuery()).toBe('?status=all&limit=500&offset=0');
    expect(tagDictionaryQuery('hidden', 100, 200)).toBe('?status=hidden&limit=100&offset=200');
  });
  it('only includes provided patch fields in the update body', () => {
    expect(tagUpdateBody('像素拼豆', {})).toEqual({ tag: '像素拼豆' });
    expect(tagUpdateBody('像素拼豆', { name: '新名', status: 'hidden' })).toEqual({ tag: '像素拼豆', name: '新名', status: 'hidden' });
  });
});

describe('AdminCommunityTagDictionary flow', () => {
  async function rendered(request: ReturnType<typeof vi.fn>): Promise<HTMLElement> {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => { root.render(<AdminCommunityTagDictionary request={request as never} />); });
    roots.push(root);
    await flushN(2);
    return container;
  }

  it('loads the dictionary and renders tags with usage counts', async () => {
    const request = vi.fn((path: string) => {
      if (path.startsWith('/api/admin/community/tags/dictionary')) {
        return Promise.resolve({ ok: true, data: { items: [item({ usageCount: 7 })], total: 1, limit: 500, offset: 0 } });
      }
      return Promise.resolve({ ok: true, data: { items: [], total: 0, limit: 500, offset: 0 } });
    });
    const container = await rendered(request);
    expect(document.body.textContent).toContain('像素拼豆');
    expect(document.body.textContent).toContain('7');
    expect(request.mock.calls.filter(([path]) => String(path).includes('/dictionary'))).toHaveLength(1);
    void container;
  });

  it('sends only the name patch on rename and refreshes the row', async () => {
    const updates: Record<string, unknown>[] = [];
    const request = vi.fn((path: string, init?: { method?: string; body?: string }) => {
      if (path.startsWith('/api/admin/community/tags/dictionary') && init?.method === 'PUT') {
        updates.push(JSON.parse(init.body!) as Record<string, unknown>);
        return Promise.resolve({ ok: true, data: { tag: '像素拼豆', name: '拼豆像素', status: 'active' } });
      }
      // The list mock always serves the original name so the rename draft
      // differs from item.name (otherwise rename() short-circuits with
      // "display name unchanged").
      if (path.startsWith('/api/admin/community/tags/dictionary')) {
        return Promise.resolve({ ok: true, data: { items: [item()], total: 1, limit: 500, offset: 0 } });
      }
      return Promise.resolve({ ok: true, data: { items: [], total: 0, limit: 500, offset: 0 } });
    });
    await rendered(request);
    setInput('[data-tag-name="像素拼豆"]', '拼豆像素');
    const renameButton = document.querySelector('[data-tag-rename="像素拼豆"]') as HTMLButtonElement;
    expect(renameButton.disabled).toBe(false);
    clickAria('[data-tag-rename="像素拼豆"]');
    await flushN(3);
    expect(updates).toEqual([{ tag: '像素拼豆', name: '拼豆像素' }]);
    expect(document.body.textContent).toContain('拼豆像素');
  });

  it('hides an active tag through the confirm dialog with a status patch', async () => {
    const updates: Record<string, unknown>[] = [];
    const request = vi.fn((path: string, init?: { method?: string; body?: string }) => {
      if (path.startsWith('/api/admin/community/tags/dictionary') && init?.method === 'PUT') {
        updates.push(JSON.parse(init.body!) as Record<string, unknown>);
        return Promise.resolve({ ok: true, data: { tag: '像素拼豆', name: '像素拼豆', status: 'hidden' } });
      }
      if (path.startsWith('/api/admin/community/tags/dictionary')) {
        return Promise.resolve({ ok: true, data: { items: [item()], total: 1, limit: 500, offset: 0 } });
      }
      return Promise.resolve({ ok: true, data: { items: [], total: 0, limit: 500, offset: 0 } });
    });
    await rendered(request);
    clickAria('[aria-label="隐藏标签 像素拼豆"]');
    await flush();
    clickButton('确认隐藏');
    await flushN(3);
    expect(updates).toEqual([{ tag: '像素拼豆', status: 'hidden' }]);
  });

  it('surfaces the server rejection on rename', async () => {
    const request = vi.fn((path: string, init?: { method?: string; body?: string }) => {
      if (path.startsWith('/api/admin/community/tags/dictionary') && init?.method === 'PUT') {
        return Promise.resolve({ ok: false, status: 409, error: '展示名与已有标签冲突。' });
      }
      return Promise.resolve({ ok: true, data: { items: [item()], total: 1, limit: 500, offset: 0 } });
    });
    await rendered(request);
    setInput('[data-tag-name="像素拼豆"]', '冲突名');
    clickAria('[data-tag-rename="像素拼豆"]');
    await flushN(3);
    expect(document.body.textContent).toContain('展示名与已有标签冲突。');
  });
});
