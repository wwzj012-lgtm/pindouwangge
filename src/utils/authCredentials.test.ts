import { describe, expect, it, vi } from 'vitest';
import {
  AUTH_AUTOCOMPLETE,
  type BrowserCredential,
  saveBrowserPasswordCredential,
} from './authCredentials';

describe('authentication form and browser credential integration', () => {
  it('uses password-manager-compatible autocomplete values', () => {
    expect(AUTH_AUTOCOMPLETE).toEqual({
      username: 'username',
      signinPassword: 'current-password',
      signupPassword: 'new-password',
    });
  });

  it('stores a credential through the browser API without app storage', async () => {
    const store = vi.fn().mockResolvedValue(undefined);
    const createPasswordCredential = vi.fn((data: { id: string; password: string }): BrowserCredential => ({
      id: data.id,
    }));

    await expect(saveBrowserPasswordCredential('user@example.com', 'password', {
      credentials: { store },
      createPasswordCredential,
    })).resolves.toBe(true);

    expect(createPasswordCredential).toHaveBeenCalledWith({
      id: 'user@example.com',
      password: 'password',
    });
    expect(store).toHaveBeenCalledWith({ id: 'user@example.com' });
  });

  it('silently falls back when PasswordCredential is unavailable', async () => {
    const store = vi.fn();

    await expect(saveBrowserPasswordCredential('user@example.com', 'password', {
      credentials: { store },
    })).resolves.toBe(false);

    expect(store).not.toHaveBeenCalled();
  });

  it('silently falls back when the browser rejects credential storage', async () => {
    const store = vi.fn().mockRejectedValue(new Error('not supported'));

    await expect(saveBrowserPasswordCredential('user@example.com', 'password', {
      credentials: { store },
      createPasswordCredential: data => ({ id: data.id }),
    })).resolves.toBe(false);
  });
});
