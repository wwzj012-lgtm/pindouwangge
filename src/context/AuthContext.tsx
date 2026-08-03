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

import { verifyCardChecksum } from '../utils/vipCodeUtils';

interface AuthContextType {
  currentUser: User | null;
  userProfile: UserProfile | null;
  loading: boolean;
  isVip: boolean;
  isAdmin: boolean;
  hasFreeTrial: boolean;
  refreshProfile: () => Promise<void>;
  redeemVipCode: (code: string) => Promise<{ success: boolean; message: string }>;
  consumeFreeTrial: () => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType>({
  currentUser: null,
  userProfile: null,
  loading: true,
  isVip: false,
  isAdmin: false,
  hasFreeTrial: false,
  refreshProfile: async () => {},
  redeemVipCode: async () => ({ success: false, message: '' }),
  consumeFreeTrial: async () => false,
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const fetchProfile = async (user: User) => {
    try {
      const profile = await syncUserProfile(user);
      setUserProfile(profile);
    } catch (err) {
      console.error('Failed to sync user profile:', err);
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);
      if (user) {
        await fetchProfile(user);
      } else {
        setUserProfile(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

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

  const redeemVipCode = async (code: string): Promise<{ success: boolean; message: string }> => {
    if (!currentUser || !userProfile) {
      return { success: false, message: '请先登录账号' };
    }

    const trimmedCode = code.trim().toUpperCase();
    if (!trimmedCode) {
      return { success: false, message: '请输入VIP兑换码' };
    }

    // Commercial 3-segment code checksum verification
    if (trimmedCode.includes('-')) {
      const parts = trimmedCode.split('-');
      if (parts.length === 3 && !verifyCardChecksum(trimmedCode)) {
        return { success: false, message: '兑换码校验失败，可能已被非法修改或输入错误' };
      }
    }

    try {
      const qCol = collection(db, 'vipCodes');
      // 1. Try finding by code directly
      let snap = await getDocs(query(qCol, where('code', '==', trimmedCode)));
      
      // 2. If not found by plain text, try finding by SHA256 hash
      if (snap.empty) {
        const hashed = await sha256(trimmedCode);
        snap = await getDocs(query(qCol, where('codeHash', '==', hashed)));
      }

      if (snap.empty) {
        return { success: false, message: '无效的VIP兑换码，请核对卡密后重试' };
      }

      const codeDoc = snap.docs[0];
      const codeData = codeDoc.data() as {
        used?: boolean;
        days?: number;
        expireAt?: number;
        channel?: string;
      };

      if (codeData.used) {
        return { success: false, message: '该兑换码已被其他人核销使用' };
      }

      // Check card expiration
      if (codeData.expireAt && codeData.expireAt < Date.now()) {
        return { success: false, message: '该兑换码已超过有效期截止时间，已失效' };
      }

      const daysToAdd = codeData.days || 30;
      const addedMs = daysToAdd * 86400 * 1000;
      const currentExpire = (userProfile.vipExpireAt && userProfile.vipExpireAt > Date.now())
        ? userProfile.vipExpireAt
        : Date.now();

      const newExpireAt = currentExpire + addedMs;

      // Update User Profile
      const userRef = doc(db, 'users', currentUser.uid);
      await updateDoc(userRef, {
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
        `核销兑换码 [${trimmedCode}] 获得 ${daysToAdd} 天 VIP，渠道: ${codeData.channel || '普通发行'}`
      );

      await refreshProfile();
      return { success: true, message: `兑换成功！已成功激活 ${daysToAdd} 天 VIP/PRO 智能拼豆算法权限！` };
    } catch (err: any) {
      console.error('Redeem error:', err);
      return { success: false, message: err.message || '兑换过程发生错误，请检查网络后重试' };
    }
  };

  const isVip = !!(
    userProfile?.isVip ||
    userProfile?.role === 'admin' ||
    (userProfile?.vipExpireAt && userProfile.vipExpireAt > Date.now())
  );

  const isAdmin = userProfile?.role === 'admin';
  const hasFreeTrial = !isVip && !!currentUser && !userProfile?.freeTrialUsed;

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        userProfile,
        loading,
        isVip,
        isAdmin,
        hasFreeTrial,
        refreshProfile,
        redeemVipCode,
        consumeFreeTrial,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
