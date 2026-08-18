import { describe, expect, it, vi } from 'vitest';
import { HeaderAccountTrigger } from './Header';

describe('Header account entry', () => {
  it('renders only a compact login entry for anonymous visitors and invokes the login callback', () => {
    const onOpenAuthModal = vi.fn();
    const entry = HeaderAccountTrigger({
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
    const entry = HeaderAccountTrigger({
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
