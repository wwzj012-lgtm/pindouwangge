export const AUTH_AUTOCOMPLETE = {
  username: 'username',
  signinPassword: 'current-password',
  signupPassword: 'new-password',
} as const;

export interface PasswordCredentialData {
  id: string;
  password: string;
}

export interface BrowserCredential {
  readonly id: string;
}

export interface CredentialStore {
  store(credential: BrowserCredential): Promise<unknown>;
}

interface PasswordCredentialConstructor {
  new (data: PasswordCredentialData): BrowserCredential;
}

export interface CredentialSaveDependencies {
  credentials?: CredentialStore;
  createPasswordCredential?: (data: PasswordCredentialData) => BrowserCredential;
}

function getDefaultDependencies(): CredentialSaveDependencies {
  const nativeCredentials = typeof navigator !== 'undefined' ? navigator.credentials : undefined;
  const credentialStore = nativeCredentials && typeof nativeCredentials.store === 'function'
    ? {
        store: (credential: BrowserCredential): Promise<unknown> => (
          nativeCredentials.store(credential as Credential)
        ),
      }
    : undefined;
  const nativePasswordCredential = (
    globalThis as typeof globalThis & { PasswordCredential?: PasswordCredentialConstructor }
  ).PasswordCredential;
  const createPasswordCredential = typeof nativePasswordCredential === 'function'
    ? (data: PasswordCredentialData): BrowserCredential => new nativePasswordCredential(data)
    : undefined;

  return {
    credentials: credentialStore,
    createPasswordCredential,
  };
}

export async function saveBrowserPasswordCredential(
  identifier: string,
  password: string,
  dependencies?: CredentialSaveDependencies,
): Promise<boolean> {
  if (!identifier.trim() || !password) return false;

  const resolved = dependencies ?? getDefaultDependencies();
  if (!resolved.credentials || !resolved.createPasswordCredential) return false;

  try {
    const credential = resolved.createPasswordCredential({ id: identifier, password });
    await resolved.credentials.store(credential);
    return true;
  } catch {
    // Unsupported browsers and denied credential prompts must not block login.
    return false;
  }
}
