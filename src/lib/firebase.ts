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

// User Profile Listener / Helper with Offline Support
export async function syncUserProfile(user: User): Promise<UserProfile> {
  const isAdminEmail = user.email === 'wwzj012@gmail.com';
  const defaultProfile: UserProfile = {
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

  try {
    const userRef = doc(db, 'users', user.uid);
    const snap = await getDoc(userRef);

    if (!snap.exists()) {
      await setDoc(userRef, defaultProfile).catch(e => console.warn('Offline mode: skipped setDoc', e));
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

      if (needsUpdate) {
        await updateDoc(userRef, updates).catch(e => console.warn('Offline mode: skipped updateDoc', e));
        return { ...data, ...updates };
      }

      return {
        ...data,
        member_type: data.member_type ?? (data.isVip ? 1 : 0),
        member_expire: data.member_expire ?? data.vipExpireAt ?? null,
      };
    }
  } catch (err) {
    console.warn('Firestore unreachable, using local fallback user profile:', err);
    return defaultProfile;
  }
}

// Helper to record admin audit logs
export async function recordAuditLog(operatorUid: string, operatorEmail: string, action: string, details: string) {
  try {
    await addDoc(collection(db, 'auditLogs'), {
      operatorUid,
      operatorEmail,
      action,
      details,
      timestamp: Date.now(),
    });
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
  collection,
  addDoc,
  query,
  getDocs,
  where,
  onSnapshot,
};
