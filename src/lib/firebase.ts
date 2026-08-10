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
import { safeFetchJson } from './safeFetch';
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

// Enable offline persistence for Firestore safely
if (typeof window !== 'undefined') {
  try {
    enableIndexedDbPersistence(db).catch((err) => {
      // Ignore multi-tab or closing/hidden persistence errors in iframe sandboxes
      console.warn('Firestore persistence disabled/warning:', err?.message || err);
    });
  } catch (e) {
    console.warn('Firestore enableIndexedDbPersistence error ignored:', e);
  }
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

  // Server-Side API Proxy (Worker / D1 - 100% reliable GFW-bypass for Chinese Users)
  try {
    const res = await safeFetchJson<UserProfile>(`/api/user-profile?uid=${user.uid}`);
    if (res.ok && res.data) {
      try {
        localStorage.setItem(`dzxg_user_profile_${user.uid}`, JSON.stringify(res.data));
      } catch (e) {}
      return res.data;
    } else if (res.status === 404) {
      // Create profile on server
      await safeFetchJson('/api/user-profile', {
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
    console.warn('Server API failed, using cached/default profile:', apiErr);
  }

  return defaultProfile;
}

// Helper to record admin audit logs via Worker API
export async function recordAuditLog(operatorUid: string, operatorEmail: string, action: string, details: string) {
  try {
    safeFetchJson('/api/admin/record-audit-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operatorUid,
        operatorEmail,
        action,
        details,
        timestamp: Date.now(),
      })
    }).catch(err => console.warn('Audit log write skipped:', err));
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
