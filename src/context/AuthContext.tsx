import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  type AuthSession,
  type UserProfile,
} from '../lib/accountApi';
import { apiGet, apiPost, clearAdminSession, clearApiToken, setApiToken } from '../utils/api';

interface SessionUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
}

export type AuthSessionPersistence = 'persistent' | 'session';

interface AuthContextType {
  currentUser: SessionUser | null;
  userProfile: UserProfile | null;
  loading: boolean;
  memberType: 0 | 1 | 2;
  isVip: boolean;
  isPro: boolean;
  isAdmin: boolean;
  memberExpire: number | null;
  hasFreeTrial: boolean;
  refreshProfile: () => Promise<void>;
  redeemVipCode: (code: string) => Promise<{ success: boolean; message: string; newType?: 1 | 2 }>;
  consumeFreeTrial: () => Promise<boolean>;
  setLocalCustomUser: (session: AuthSession, persistence?: AuthSessionPersistence) => Promise<void>;
  logoutUser: () => Promise<void>;
}

const LOCAL_SESSION_KEY = 'beadgrid_local_session';

function getStorage(persistence: AuthSessionPersistence): Storage | null {
  try {
    if (persistence === 'persistent') {
      return typeof localStorage === 'undefined' ? null : localStorage;
    }
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

function isAuthSession(value: unknown): value is AuthSession {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { token?: unknown; profile?: unknown };
  if (typeof candidate.token !== 'string' || !candidate.token || !candidate.profile) return false;
  if (typeof candidate.profile !== 'object') return false;
  return typeof (candidate.profile as { uid?: unknown }).uid === 'string';
}

function readStoredSession(persistence: AuthSessionPersistence): AuthSession | null {
  try {
    const raw = getStorage(persistence)?.getItem(LOCAL_SESSION_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isAuthSession(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function clearStoredSessions(): void {
  for (const persistence of ['persistent', 'session'] as const) {
    try {
      getStorage(persistence)?.removeItem(LOCAL_SESSION_KEY);
    } catch {
      // Storage can be unavailable in private browsing contexts.
    }
  }
}

function writeStoredSession(session: AuthSession, persistence: AuthSessionPersistence): void {
  clearStoredSessions();
  try {
    getStorage(persistence)?.setItem(LOCAL_SESSION_KEY, JSON.stringify(session));
  } catch {
    // The in-memory auth state remains usable when Web Storage is blocked.
  }
}

const AuthContext = createContext<AuthContextType>({
  currentUser: null,
  userProfile: null,
  loading: true,
  memberType: 0,
  isVip: false,
  isPro: false,
  isAdmin: false,
  memberExpire: null,
  hasFreeTrial: false,
  refreshProfile: async () => undefined,
  redeemVipCode: async () => ({ success: false, message: '' }),
  consumeFreeTrial: async () => false,
  setLocalCustomUser: async () => undefined,
  logoutUser: async () => undefined,
});

export const useAuth = (): AuthContextType => useContext(AuthContext);

function sessionUser(profile: UserProfile): SessionUser {
  return {
    uid: profile.uid,
    email: profile.email,
    displayName: profile.displayName,
    photoURL: profile.photoURL,
  };
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<SessionUser | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const sessionPersistenceRef = useRef<AuthSessionPersistence | null>(null);

  const applySession = (session: AuthSession, persistence: AuthSessionPersistence): void => {
    setApiToken(session.token, persistence === 'persistent');
    sessionPersistenceRef.current = persistence;
    setCurrentUser(sessionUser(session.profile));
    setUserProfile(session.profile);
    writeStoredSession(session, persistence);
  };

  useEffect(() => {
    const restoreSession = async (): Promise<void> => {
      try {
        const persistentSession = readStoredSession('persistent');
        const sessionSession = readStoredSession('session');
        const saved = persistentSession
          ? { session: persistentSession, persistence: 'persistent' as const }
          : sessionSession
          ? { session: sessionSession, persistence: 'session' as const }
          : null;
        if (saved) {
          applySession(saved.session, saved.persistence);
          await refreshProfileFromServer(saved.session.profile);
        }
      } catch (error) {
        console.error('Authentication initialization failed:', error);
        clearApiToken();
        clearAdminSession();
        clearStoredSessions();
        sessionPersistenceRef.current = null;
        setCurrentUser(null);
        setUserProfile(null);
      } finally {
        setLoading(false);
      }
    };
    void restoreSession();
  }, []);

  const refreshProfileFromServer = async (fallback?: UserProfile): Promise<void> => {
    const result = await apiGet<UserProfile>('/api/user-profile');
    if (!result.ok || !result.data) {
      if (!fallback) throw new Error(result.error ?? '用户资料加载失败');
      return;
    }
    setUserProfile(result.data);
    setCurrentUser(sessionUser(result.data));
    const persistence = sessionPersistenceRef.current;
    if (persistence) {
      const saved = readStoredSession(persistence);
      if (saved) writeStoredSession({ ...saved, profile: result.data }, persistence);
    }
  };

  const refreshProfile = async (): Promise<void> => {
    if (currentUser) await refreshProfileFromServer();
  };

  const setLocalCustomUser = async (
    session: AuthSession,
    persistence: AuthSessionPersistence = 'persistent',
  ): Promise<void> => {
    applySession(session, persistence);
  };

  const logoutUser = async (): Promise<void> => {
    clearApiToken();
    clearAdminSession();
    clearStoredSessions();
    sessionPersistenceRef.current = null;
    setCurrentUser(null);
    setUserProfile(null);
  };

  const consumeFreeTrial = async (): Promise<boolean> => {
    if (!currentUser || userProfile?.freeTrialUsed) return false;
    const result = await apiPost<{ consumed: boolean }>('/api/auth/consume-free-trial');
    if (!result.ok) return false;
    await refreshProfile();
    return true;
  };

  const redeemVipCode = async (code: string): Promise<{ success: boolean; message: string; newType?: 1 | 2 }> => {
    if (!currentUser) return { success: false, message: '请先登录账号' };
    const result = await apiPost<{ profile: UserProfile }>('/api/redeem-code', {
      code: code.trim().toUpperCase(),
    });
    if (!result.ok || !result.data) return { success: false, message: result.error ?? '兑换失败' };
    setUserProfile(result.data.profile);
    return {
      success: true,
      message: '兑换成功',
      newType: result.data.profile.member_type === 0 ? undefined : result.data.profile.member_type,
    };
  };

  const now = Date.now();
  const memberExpire = userProfile?.member_expire ?? null;
  const active = Boolean(
    userProfile
      && userProfile.isVip
      && (memberExpire === null || memberExpire > now),
  );
  const memberType: 0 | 1 | 2 = active ? userProfile?.member_type ?? 0 : 0;

  return (
    <AuthContext.Provider value={{
      currentUser,
      userProfile,
      loading,
      memberType,
      isVip: memberType >= 1,
      isPro: memberType === 2,
      isAdmin: userProfile?.role === 'admin',
      memberExpire,
      hasFreeTrial: Boolean(currentUser && !active && !userProfile?.freeTrialUsed),
      refreshProfile,
      redeemVipCode,
      consumeFreeTrial,
      setLocalCustomUser,
      logoutUser,
    }}>
      {children}
    </AuthContext.Provider>
  );
};
