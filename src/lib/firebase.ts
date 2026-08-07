import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  User,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  addDoc,
  query,
  getDocs,
  where,
  onSnapshot,
  enableIndexedDbPersistence,
} from 'firebase/firestore';
import firebaseConfigJson from '../../firebase-applet-config.json';

const firebaseConfig = {
  apiKey: firebaseConfigJson.apiKey,
  authDomain: firebaseConfigJson.authDomain,
  projectId: firebaseConfigJson.projectId,
  storageBucket: firebaseConfigJson.storageBucket,
  messagingSenderId: firebaseConfigJson.messagingSenderId,
  appId: firebaseConfigJson.appId,
};

// Initialize App
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

export const auth = getAuth(app);
export const db = getFirestore(app, firebaseConfigJson.firestoreDatabaseId || '(default)');

// Enable offline persistence for Firestore
if (typeof window !== 'undefined') {
  enableIndexedDbPersistence(db).catch((err) => {
    if (err.code === 'failed-precondition') {
      // Multiple tabs open, persistence can only be enabled in one tab at a time.
    } else if (err.code === 'unimplemented') {
      // The current browser does not support offline persistence
    }
  });
}

export const googleProvider = new GoogleAuthProvider();

export interface UserProfile {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  member_type: 0 | 1 | 2; // 0=免费用户, 1=普通VIP, 2=商家Pro
  member_expire: number | null; // ms timestamp
  member_source?: string | null;
  isVip: boolean; // backward compatibility
  vipExpireAt: number | null; // backward compatibility
  freeTrialUsed?: boolean; // New user 1-time free trial used flag
  role: 'user' | 'admin';
  createdAt: number;
  updatedAt: number;
}

export interface AuditLog {
  id?: string;
  operatorUid: string;
  operatorEmail: string;
  action: string;
  details: string;
  timestamp: number;
}

// Simple SHA-256 string hash helper for Card Code storage security
export async function sha256(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message.trim().toUpperCase());
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

const ADMIN_EMAILS = ['2914336737@qq.com', '2914336737@pindou.cn', 'wwzj012@gmail.com'];
export function isSystemAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const lower = email.trim().toLowerCase();
  return ADMIN_EMAILS.includes(lower);
}

// User Profile Listener / Helper with Offline Support (Server-Side Proxy First for GFW Bypass)
export async function syncUserProfile(user: User): Promise<UserProfile> {
  const isAdminEmail = isSystemAdminEmail(user.email);

  // Load cached profile from localStorage if available
  let cachedProfile: UserProfile | null = null;
  try {
    const rawCached = localStorage.getItem(`dzxg_user_profile_${user.uid}`);
    if (rawCached) {
      cachedProfile = JSON.parse(rawCached);
    }
  } catch (e) {
    console.warn('Failed to read cached profile:', e);
  }

  const defaultProfile: UserProfile = cachedProfile || {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName || user.email?.split('@')[0] || '拼豆玩家',
    photoURL: user.photoURL,
    member_type: isAdminEmail ? 2 : 0,
    member_expire: isAdminEmail ? Date.now() + 36500 * 86400 * 1000 : null,
    member_source: isAdminEmail ? '系统管理员' : null,
    isVip: isAdminEmail,
    vipExpireAt: isAdminEmail ? Date.now() + 36500 * 86400 * 1000 : null,
    freeTrialUsed: false,
    role: isAdminEmail ? 'admin' : 'user',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  // Try Server-Side API Proxy First (100% reliable GFW-bypass for Chinese Users)
  try {
    const res = await fetch(`/api/user-profile?uid=${user.uid}`);
    if (res.ok) {
      const serverProfile = await res.json() as UserProfile;
      try {
        localStorage.setItem(`dzxg_user_profile_${user.uid}`, JSON.stringify(serverProfile));
      } catch (e) {}
      return serverProfile;
    } else if (res.status === 404) {
      // Create profile on server
      await fetch('/api/user-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid: user.uid, profile: defaultProfile })
      });
      try {
        localStorage.setItem(`dzxg_user_profile_${user.uid}`, JSON.stringify(defaultProfile));
      } catch (e) {}
      return defaultProfile;
    }
  } catch (apiErr) {
    console.warn('Server API failed or timed out, falling back to direct Firestore SDK:', apiErr);
  }

  // Skip Firestore entirely for guest/local-fallback users to be fast, but sync in background if online
  if (user.uid.startsWith('cn_guest_') && cachedProfile) {
    const userRef = doc(db, 'users', user.uid);
    setDoc(userRef, cachedProfile, { merge: true }).catch(e => console.warn('Background sync failed for guest user:', e));
    return cachedProfile;
  }

  // Fast connection timeout for Firestore (1.5 seconds)
  const timeoutMs = isAdminEmail ? 3000 : 1500;

  try {
    const userRef = doc(db, 'users', user.uid);
    
    // Race getDoc against a fast timeout
    const snap = await Promise.race([
      getDoc(userRef),
      new Promise<null>((_, reject) => setTimeout(() => reject(new Error('Firestore connection timeout')), timeoutMs))
    ]).catch((err) => {
      console.warn('getDoc timed out or failed, utilizing fallback profile:', err);
      return null;
    });

    if (!snap || !snap.exists()) {
      // Create profile in Firestore asynchronously so we don't block
      setDoc(userRef, defaultProfile).catch(e => console.warn('Offline mode: skipped setDoc', e));
      
      try {
        localStorage.setItem(`dzxg_user_profile_${user.uid}`, JSON.stringify(defaultProfile));
      } catch (e) {}
      
      return defaultProfile;
    } else {
      const data = snap.data() as UserProfile;
      let needsUpdate = false;
      const updates: Partial<UserProfile> = { updatedAt: Date.now() };

      if (isAdminEmail && (data.role !== 'admin' || data.member_type !== 2)) {
        updates.role = 'admin';
        updates.member_type = 2;
        updates.isVip = true;
        updates.member_expire = Date.now() + 36500 * 86400 * 1000;
        updates.vipExpireAt = updates.member_expire;
        needsUpdate = true;
      }

      // Check VIP / Pro Expiration
      const effectiveExpire = data.member_expire || data.vipExpireAt;
      if (data.role !== 'admin' && data.member_type > 0 && effectiveExpire && effectiveExpire < Date.now()) {
        updates.member_type = 0;
        updates.isVip = false;
        updates.member_expire = null;
        updates.vipExpireAt = null;
        needsUpdate = true;
      }

      const mergedProfile: UserProfile = {
        ...data,
        member_type: data.member_type ?? (data.isVip ? 1 : 0),
        member_expire: data.member_expire ?? data.vipExpireAt ?? null,
        ...(needsUpdate ? updates : {}),
      };

      if (needsUpdate) {
        updateDoc(userRef, updates).catch(e => console.warn('Offline mode: skipped updateDoc', e));
      }

      // Update cache
      try {
        localStorage.setItem(`dzxg_user_profile_${user.uid}`, JSON.stringify(mergedProfile));
      } catch (e) {}

      return mergedProfile;
    }
  } catch (err) {
    console.warn('Firestore unreachable, using local fallback user profile:', err);
    return defaultProfile;
  }
}

// Helper to record admin audit logs
export async function recordAuditLog(operatorUid: string, operatorEmail: string, action: string, details: string) {
  try {
    Promise.race([
      addDoc(collection(db, 'auditLogs'), {
        operatorUid,
        operatorEmail,
        action,
        details,
        timestamp: Date.now(),
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Audit log timeout')), 2000))
    ]).catch(err => console.warn('Client audit log write skipped or timed out:', err));
  } catch (err) {
    console.error('Failed to write audit log:', err);
  }
}

export {
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  addDoc,
  query,
  getDocs,
  where,
  onSnapshot,
};
