import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

// Render the actual fallback and exercise its button without a DOM dependency.
describe('ErrorBoundary', () => {
  it('implements the React boundary contract instead of watching window.error', () => {
    const boundary = ErrorBoundary as unknown as {
      getDerivedStateFromError?: (error: Error) => { error: Error };
    };
    expect(typeof boundary.getDerivedStateFromError).toBe('function');
  });

  it('turns a thrown error into state, so the fallback can render', () => {
    const boundary = ErrorBoundary as unknown as {
      getDerivedStateFromError: (error: Error) => { error: Error };
    };
    const next = boundary.getDerivedStateFromError(new Error('boom'));
    expect(next.error).toBeInstanceOf(Error);
    expect(next.error.message).toBe('boom');
  });

  it('renders a stable friendly message and keeps raw details in console diagnostics', () => {
    const error = new Error('INTERNAL_PROBE: failed query /private/backend.ts:42');
    const boundary = new ErrorBoundary();
    boundary.props = { children: null, fallbackTitle: '自定义恢复标题' };
    boundary.state = ErrorBoundary.getDerivedStateFromError(error);
    const html = renderToStaticMarkup(boundary.render());
    expect(html).toContain('自定义恢复标题');
    expect(html).not.toContain(error.message);
    expect(html).not.toContain('INTERNAL_PROBE');
    expect(html).not.toContain('/private/backend.ts');
    expect(html).toContain('页面暂时遇到问题，请点击下方按钮重试。');
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      boundary.componentDidCatch(error, { componentStack: 'at InternalChild (/private/child.tsx:8)' });
      expect(log).toHaveBeenCalledWith('[ErrorBoundary]', error, 'at InternalChild (/private/child.tsx:8)');
      expect((log.mock.calls[0][1] as Error).stack).toContain('INTERNAL_PROBE');
    } finally { log.mockRestore(); }
  });

  it.each([false, true])('preserves retry/reload behavior, reloadOnReset=%s', reloadOnReset => {
    const reload = vi.fn();
    vi.stubGlobal('window', { location: { reload } });
    const child = createElement('span', null, 'recovered child');
    const boundary = new ErrorBoundary();
    boundary.props = { children: child, reloadOnReset };
    boundary.state = ErrorBoundary.getDerivedStateFromError(new Error('PRIVATE_RESET_PROBE'));
    boundary.setState = vi.fn(next => { boundary.state = { ...boundary.state, ...next }; });
    try {
      const fallback = boundary.render();
      const html = renderToStaticMarkup(fallback);
      expect(html).toContain(reloadOnReset ? '刷新页面' : '重新载入此界面');
      const button = fallback.props.children.props.children.find((element: any) => element.type === 'button');
      button.props.onClick();
      if (reloadOnReset) {
        expect(reload).toHaveBeenCalledOnce();
        expect(boundary.setState).not.toHaveBeenCalled();
      } else {
        expect(reload).not.toHaveBeenCalled();
        expect(boundary.state.error).toBeNull();
        expect(renderToStaticMarkup(boundary.render())).toContain('recovered child');
      }
    } finally { vi.unstubAllGlobals(); }
  });
});
