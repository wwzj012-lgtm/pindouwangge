import { describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { HeaderAccountTrigger } from './Header';

// React 19 的 FC 返回类型是 ReactNode | Promise<ReactNode>；本测试直接函数调用取元素树，
// 断言为 ReactElement 属类型收窄，不改变任何运行时行为。
const trigger = (props: Parameters<typeof HeaderAccountTrigger>[0]): ReactElement<any> =>
  HeaderAccountTrigger(props) as ReactElement<any>;

describe('Header account entry', () => {
  it('renders only a compact login entry for anonymous visitors and invokes the login callback', () => {
    const onOpenAuthModal = vi.fn();
    const entry = trigger({
      isAuthenticated: false,
      displayName: null,
      photoURL: null,
      onOpenAuthModal,
      loginLabel: '登录',
    });

    expect(entry.props.children[1].props.children).toBe('登录');
    expect(JSON.stringify(entry)).not.toContain('Pluto');
    entry.props.onClick();
    expect(onOpenAuthModal).toHaveBeenCalledOnce();
  });

  it('keeps the authenticated user avatar, nickname, and personal-center interaction', () => {
    const onOpenUserProfileModal = vi.fn();
    const entry = trigger({
      isAuthenticated: true,
      displayName: '星格创作者',
      photoURL: 'https://example.test/avatar.png',
      onOpenUserProfileModal,
      loginLabel: '登录',
    });

    expect(JSON.stringify(entry)).toContain('星格创作者');
    expect(JSON.stringify(entry)).toContain('https://example.test/avatar.png');
    entry.props.onClick();
    expect(onOpenUserProfileModal).toHaveBeenCalledOnce();
  });
});
