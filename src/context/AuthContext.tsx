import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  type AuthSession,
  type UserProfile,
} from '../lib/accountApi';
import {
  apiGet,
  apiGetCreditsSummary,
  apiCheckinCredits,
  apiPost,
  clearAdminSession,
  clearApiToken,
  getApiToken,
  setApiToken,
  type CreditSummary,
} from '../utils/api';

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
  creditSummary: CreditSummary | null;
  refreshProfile: () => Promise<void>;
  refreshCreditSummary: () => Promise<void>;
  checkinCredits: () => Promise<{
    success: boolean;
    message?: string;
    alreadyCheckedIn?: boolean;
    grantedUnits?: number;
    streakDays?: number;
  }>;
  updateUserProfile: (updates: { displayName?: string; photoURL?: string; password?: string }) => Promise<{ success: boolean; message: string }>;
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
  creditSummary: null,
  refreshProfile: async () => undefined,
  refreshCreditSummary: async () => undefined,
  checkinCredits: async () => ({ success: false, message: '' }),
  updateUserProfile: async () => ({ success: false, message: '' }),
  redeemVipCode: async () => ({ success: false, message: '' }),
  consumeFreeTrial: async () => false,
  setLocalCustomUser: async () => undefined,
  logoutUser: async () => undefined,
});

export const useAuth = (): AuthContextType => useContext(AuthContext);

export function deriveMembershipState(userProfile: UserProfile | null, now = Date.now()) {
  const memberExpire = userProfile?.member_expire ?? null;
  const active = Boolean(
    userProfile
      && userProfile.isVip
      && (memberExpire === null || memberExpire > now),
  );
  const isAdmin = userProfile?.role === 'admin';
  const memberType: 0 | 1 | 2 = isAdmin ? 2 : active ? userProfile?.member_type ?? 0 : 0;

  return {
    active,
    // Role-based benefits do not change the raw profile or paid-active trial rules.
    memberExpire: isAdmin ? null : memberExpire,
    memberType,
    isVip: isAdmin || memberType >= 1,
    isPro: memberType === 2,
    isAdmin,
  };
}

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
  const [creditSummary, setCreditSummary] = useState<CreditSummary | null>(null);
  const sessionPersistenceRef = useRef<AuthSessionPersistence | null>(null);

  const applySession = (session: AuthSession, persistence: AuthSessionPersistence): void => {
    setApiToken(session.token, persistence === 'persistent');
    sessionPersistenceRef.current = persistence;
    setCurrentUser(sessionUser(session.profile));
    setUserProfile(session.profile);
    writeStoredSession(session, persistence);
  };

  useEffect(() => {
    const handleUnauthorized = () => {
      clearApiToken();
      clearAdminSession();
      clearStoredSessions();
      sessionPersistenceRef.current = null;
      setCurrentUser(null);
      setUserProfile(null);
      setCreditSummary(null);
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('unauthorized', handleUnauthorized);
      return () => window.removeEventListener('unauthorized', handleUnauthorized);
    }
  }, []);

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
          // Keep session restoration responsive when an older Worker has not
          // deployed the credits endpoint yet.
          void refreshCreditSummaryFromServer();
        }
      } catch (error) {
        console.error('Authentication initialization failed:', error);
        clearApiToken();
        clearAdminSession();
        clearStoredSessions();
        sessionPersistenceRef.current = null;
        setCurrentUser(null);
        setUserProfile(null);
        setCreditSummary(null);
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

  const refreshCreditSummaryFromServer = async (): Promise<void> => {
    if (!getApiToken()) {
      setCreditSummary(null);
      return;
    }
    const result = await apiGetCreditsSummary();
    if (!result.ok || !result.data) {
      // apiRequest already handles 401 by clearing the auth token and emitting
      // the shared unauthorized event. Keep the last successful summary for
      // transient failures so the account panel does not flicker.
      if (result.status === 401) setCreditSummary(null);
      return;
    }
    setCreditSummary(result.data);
  };

  const refreshCreditSummary = async (): Promise<void> => {
    if (!currentUser) {
      setCreditSummary(null);
      return;
    }
    await refreshCreditSummaryFromServer();
  };

  const checkinCredits = async (): Promise<{
    success: boolean;
    message?: string;
    alreadyCheckedIn?: boolean;
    grantedUnits?: number;
    streakDays?: number;
  }> => {
    if (!currentUser) return { success: false, message: '请先登录账号' };
    try {
      const response = await apiCheckinCredits();
      if (!response.ok || !response.data) {
        if (response.status === 401) return { success: false, message: '请先登录账号' };
        return { success: false, message: response.error ?? '签到失败，请稍后重试' };
      }
      const payload = response.data as unknown as Record<string, unknown>;
      const result = {
        success: payload.success === true,
        message: typeof payload.message === 'string' ? payload.message : undefined,
        alreadyCheckedIn: payload.alreadyCheckedIn === true,
        grantedUnits: typeof payload.grantedUnits === 'number' ? payload.grantedUnits : undefined,
        streakDays: typeof payload.streakDays === 'number' ? payload.streakDays : undefined,
      };
      if (result.success || result.alreadyCheckedIn) {
        await refreshCreditSummaryFromServer();
      }
      return result;
    } catch (error) {
      console.error('Credit check-in failed:', error);
      return { success: false, message: '签到失败，请检查网络后重试' };
    }
  };

  const setLocalCustomUser = async (
    session: AuthSession,
    persistence: AuthSessionPersistence = 'persistent',
  ): Promise<void> => {
    applySession(session, persistence);
    void refreshCreditSummaryFromServer();
  };

  const logoutUser = async (): Promise<void> => {
    clearApiToken();
    clearAdminSession();
    clearStoredSessions();
    sessionPersistenceRef.current = null;
    setCurrentUser(null);
    setUserProfile(null);
    setCreditSummary(null);
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

  const updateUserProfile = async (updates: { displayName?: string; photoURL?: string; password?: string }): Promise<{ success: boolean; message: string }> => {
    if (!userProfile) return { success: false, message: '尚未登录账号' };
    const result = await apiPost<UserProfile>('/api/user-profile/update', updates);
    if (!result.ok || !result.data) {
      return { success: false, message: result.error ?? '个人资料保存失败，请稍后重试' };
    }
    const updatedProfile = result.data;
    setUserProfile(updatedProfile);
    setCurrentUser(sessionUser(updatedProfile));
    const persistence = sessionPersistenceRef.current || 'persistent';
    const saved = readStoredSession(persistence);
    if (saved) writeStoredSession({ ...saved, profile: updatedProfile }, persistence);
    return { success: true, message: '个人资料修改成功！' };
  };

  const { active, memberExpire, memberType, isVip, isPro, isAdmin } = deriveMembershipState(userProfile);

  return (
    <AuthContext.Provider value={{
      currentUser,
      userProfile,
      loading,
      memberType,
      isVip,
      isPro,
      isAdmin,
      memberExpire,
      hasFreeTrial: Boolean(currentUser && !active && !userProfile?.freeTrialUsed),
      creditSummary,
      refreshProfile,
      refreshCreditSummary,
      checkinCredits,
      updateUserProfile,
      redeemVipCode,
      consumeFreeTrial,
      setLocalCustomUser,
      logoutUser,
    }}>
      {children}
    </AuthContext.Provider>
  );
};
