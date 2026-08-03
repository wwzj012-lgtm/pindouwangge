import React, { createContext, useContext, useState, useEffect } from 'react';
import { User } from 'firebase/auth';
import {
  auth,
  db,
  syncUserProfile,
  UserProfile,
  onAuthStateChanged,
  doc,
  getDoc,
  updateDoc,
  collection,
  query,
  getDocs,
  where,
  sha256,
  recordAuditLog,
} from '../lib/firebase';

import { verifyCardChecksum, getMemberTypeFromCode } from '../utils/vipCodeUtils';

interface AuthContextType {
  currentUser: User | null;
  userProfile: UserProfile | null;
  loading: boolean;
  memberType: 0 | 1 | 2; // 0=免费, 1=普通VIP, 2=商家Pro
  isVip: boolean; // memberType >= 1
  isPro: boolean; // memberType === 2
  isAdmin: boolean;
  memberExpire: number | null;
  hasFreeTrial: boolean;
  refreshProfile: () => Promise<void>;
  redeemVipCode: (code: string) => Promise<{ success: boolean; message: string; newType?: 1 | 2 }>;
  consumeFreeTrial: () => Promise<boolean>;
  setLocalCustomUser: (userData: { uid: string; email: string; displayName: string }) => Promise<void>;
  logoutUser: () => Promise<void>;
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
  refreshProfile: async () => {},
  redeemVipCode: async () => ({ success: false, message: '' }),
  consumeFreeTrial: async () => false,
  setLocalCustomUser: async () => {},
  logoutUser: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const fetchProfile = async (user: User | any) => {
    try {
      const profile = await syncUserProfile(user);
      setUserProfile(profile);
    } catch (err) {
      console.error('Failed to sync user profile:', err);
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setCurrentUser(user);
        await fetchProfile(user);
      } else {
        // Check if there is a local custom user session stored in localStorage
        try {
          const rawLocal = localStorage.getItem('dzxg_local_session');
          if (rawLocal) {
            const parsed = JSON.parse(rawLocal);
            if (parsed && parsed.uid) {
              setCurrentUser(parsed as User);
              await fetchProfile(parsed as User);
              setLoading(false);
              return;
            }
          }
        } catch (e) {
          console.warn('Failed to parse local user session:', e);
        }
        setCurrentUser(null);
        setUserProfile(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const setLocalCustomUser = async (userData: { uid: string; email: string; displayName: string }) => {
    const localUserObj = {
      uid: userData.uid,
      email: userData.email,
      displayName: userData.displayName,
      photoURL: null,
    } as any;
    try {
      localStorage.setItem('dzxg_local_session', JSON.stringify(localUserObj));
    } catch (e) {
      console.warn('Failed to save local session:', e);
    }
    setCurrentUser(localUserObj);
    await fetchProfile(localUserObj);
  };

  const logoutUser = async () => {
    try {
      localStorage.removeItem('dzxg_local_session');
    } catch (e) {}
    try {
      await auth.signOut();
    } catch (e) {}
    setCurrentUser(null);
    setUserProfile(null);
  };

  const refreshProfile = async () => {
    if (currentUser) {
      await fetchProfile(currentUser);
    }
  };

  const consumeFreeTrial = async (): Promise<boolean> => {
    if (!currentUser || !userProfile || userProfile.freeTrialUsed) {
      return false;
    }
    try {
      const userRef = doc(db, 'users', currentUser.uid);
      await updateDoc(userRef, {
        freeTrialUsed: true,
        updatedAt: Date.now(),
      });
      setUserProfile(prev => prev ? { ...prev, freeTrialUsed: true } : null);
      return true;
    } catch (err) {
      console.error('Failed to consume free trial:', err);
      return false;
    }
  };

  // Anti-brush rate limiter: Max 5 redemption attempts per hour
  const checkRedeemRateLimit = (): boolean => {
    try {
      const now = Date.now();
      const raw = localStorage.getItem('dzxg_redeem_attempts') || '[]';
      const attempts: number[] = JSON.parse(raw);
      const validAttempts = attempts.filter(t => now - t < 3600 * 1000);
      if (validAttempts.length >= 5) {
        return false;
      }
      validAttempts.push(now);
      localStorage.setItem('dzxg_redeem_attempts', JSON.stringify(validAttempts));
      return true;
    } catch {
      return true;
    }
  };

  const redeemVipCode = async (
    code: string
  ): Promise<{ success: boolean; message: string; newType?: 1 | 2 }> => {
    if (!currentUser || !userProfile) {
      return { success: false, message: '请先登录账号' };
    }

    const trimmedCode = code.trim().toUpperCase();
    if (!trimmedCode) {
      return { success: false, message: '请输入兑换码' };
    }

    // Check anti-brush rate limit
    if (!checkRedeemRateLimit()) {
      return {
        success: false,
        message: '1小时内最多尝试兑换 5 次，请稍后再试，防止非法盗刷',
      };
    }

    // Commercial code checksum verification
    if (trimmedCode.includes('-')) {
      const parts = trimmedCode.split('-');
      if ((parts.length === 3 || parts.length === 4) && !verifyCardChecksum(trimmedCode)) {
        return { success: false, message: '兑换码校验失败，可能已被非法修改或输入错误' };
      }
    }

    try {
      const qCol = collection(db, 'vipCodes');
      let snap = await getDocs(query(qCol, where('code', '==', trimmedCode)));

      if (snap.empty) {
        const hashed = await sha256(trimmedCode);
        snap = await getDocs(query(qCol, where('codeHash', '==', hashed)));
      }

      if (snap.empty) {
        return { success: false, message: '无效的兑换码，请核对卡密无误后重试' };
      }

      const codeDoc = snap.docs[0];
      const codeData = codeDoc.data() as {
        used?: boolean;
        days?: number;
        expireAt?: number;
        channel?: string;
        member_type?: 1 | 2; // 1=普通VIP, 2=商家Pro
        codeMemberType?: 1 | 2;
      };

      if (codeData.used) {
        return { success: false, message: '该兑换码已被其他人核销使用' };
      }

      if (codeData.expireAt && codeData.expireAt < Date.now()) {
        return { success: false, message: '该兑换码已超过有效期截止时间，已失效' };
      }

      // Determine target member_type from code data or code prefix
      const codeType: 1 | 2 =
        codeData.member_type ??
        codeData.codeMemberType ??
        getMemberTypeFromCode(trimmedCode);

      const daysToAdd = codeData.days || 30;
      const isPermanent = daysToAdd >= 3650; // Permanent membership (>10 yrs)
      const addedMs = daysToAdd * 86400 * 1000;

      const currentExpire =
        userProfile.member_expire && userProfile.member_expire > Date.now()
          ? userProfile.member_expire
          : Date.now();

      let targetMemberType: 0 | 1 | 2 = userProfile.member_type || 0;
      let newExpireAt: number | null = null;

      // Upgrade / Renewal Rules
      if (codeType === 2) {
        // Upgrading or Renewing Merchant Pro (BP)
        targetMemberType = 2;
        newExpireAt = isPermanent ? null : currentExpire + addedMs;
      } else {
        // Normal VIP (PV)
        if (targetMemberType === 2) {
          // Keep Pro status, just extend duration
          newExpireAt = isPermanent ? null : currentExpire + addedMs;
        } else {
          // Normal VIP status
          targetMemberType = 1;
          newExpireAt = isPermanent ? null : currentExpire + addedMs;
        }
      }

      const memberSourceText = codeType === 2 ? '商家Pro兑换码' : '普通VIP兑换码';

      // Update User Profile in Firestore
      const userRef = doc(db, 'users', currentUser.uid);
      await updateDoc(userRef, {
        member_type: targetMemberType,
        member_expire: newExpireAt,
        member_source: memberSourceText,
        isVip: true,
        vipExpireAt: newExpireAt,
        updatedAt: Date.now(),
      });

      // Mark Code as Used
      await updateDoc(codeDoc.ref, {
        used: true,
        usedBy: currentUser.uid,
        usedAt: Date.now(),
      });

      await recordAuditLog(
        currentUser.uid,
        currentUser.email || 'unknown',
        'REDEEM_CODE',
        `核销兑换码 [${trimmedCode}] 激活 ${
          targetMemberType === 2 ? '商家Pro' : '普通VIP'
        } (${isPermanent ? '永久' : daysToAdd + '天'})，渠道: ${codeData.channel || '普通发行'}`
      );

      await refreshProfile();

      const typeName = targetMemberType === 2 ? '商家Pro会员' : '普通VIP会员';
      const durationText = isPermanent ? '永久有效' : `${daysToAdd} 天`;

      return {
        success: true,
        message: `兑换成功！已为您成功激活 ${typeName} (${durationText}) 专属权益！`,
        newType: targetMemberType as 1 | 2,
      };
    } catch (err: any) {
      console.error('Redeem error:', err);
      return { success: false, message: err.message || '兑换过程发生网络异常，请重试' };
    }
  };

  const isAdmin = userProfile?.role === 'admin';

  let rawMemberType: 0 | 1 | 2 = userProfile?.member_type ?? (userProfile?.isVip ? 1 : 0);
  if (isAdmin) {
    rawMemberType = 2; // Admin gets full Merchant Pro privileges
  }

  const memberExpire = userProfile?.member_expire ?? userProfile?.vipExpireAt ?? null;
  const isExpired = !isAdmin && memberExpire !== null && memberExpire < Date.now();

  const memberType: 0 | 1 | 2 = isExpired ? 0 : rawMemberType;
  const isVip = memberType >= 1;
  const isPro = memberType === 2;

  const hasFreeTrial = !isVip && !!currentUser && !userProfile?.freeTrialUsed;

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        userProfile,
        loading,
        memberType,
        isVip,
        isPro,
        isAdmin,
        memberExpire,
        hasFreeTrial,
        refreshProfile,
        redeemVipCode,
        consumeFreeTrial,
        setLocalCustomUser,
        logoutUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
