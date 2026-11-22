/**
 * Shared jsdom render-test helpers. Encapsulates the patterns proven in the
 * admin/AuthModal/ExportModal suites: act-wrapped render/unmount, microtask
 * flushing, native-controlled-input setters, click-by-text and a canvas stub
 * with the style/setAttribute surface the preview pipelines touch.
 *
 * @vitest-environment jsdom
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

export interface RenderScope {
  container: HTMLElement;
  root: Root;
  unmount: () => void;
}

const openScopes: RenderScope[] = [];

export function actRender(markup: React.ReactNode): RenderScope {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(markup); });
  const scope: RenderScope = {
    container,
    root,
    unmount: () => act(() => { root.unmount(); }),
  };
  openScopes.push(scope);
  return scope;
}

export function actUnmountAll(): void {
  for (const scope of openScopes.splice(0)) scope.unmount();
  document.body.innerHTML = '';
}

export async function flush(n = 2): Promise<void> {
  for (let index = 0; index < n; index += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

export function setInputValue(selector: string, value: string): void {
  const element = document.querySelector(selector) as HTMLInputElement | null;
  if (!element) throw new Error(`Element missing: ${selector}`);
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')!.set!;
  act(() => { setter.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); });
}

export function clickByText(label: string | RegExp): void {
  const button = [...document.querySelectorAll('button')].find(item =>
    typeof label === 'string' ? item.textContent?.trim() === label : label.test(item.textContent ?? ''));
  if (!button) throw new Error(`Button missing: ${String(label)}`);
  act(() => { button.click(); });
}

export function clickAriaLabel(label: string): void {
  const element = document.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement | null;
  if (!element) throw new Error(`Element missing: [aria-label="${label}"]`);
  act(() => { element.click(); });
}

export function bodyText(): string {
  return document.body.textContent ?? '';
}

export function stubCanvas(): HTMLCanvasElement {
  const noop = () => {};
  return {
    width: 64, height: 64,
    style: {} as CSSStyleDeclaration,
    getContext: () => new Proxy({}, { get: () => noop }),
    setAttribute: noop,
    toDataURL: () => 'data:image/png;base64,mock',
  } as unknown as HTMLCanvasElement;
}

export function stubLayoutEnvironment(): void {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:mock'), revokeObjectURL: vi.fn() });
}
