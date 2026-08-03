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
  isVip: boolean;
  vipExpireAt: number | null; // ms timestamp
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
    isVip: isAdminEmail, // Admin automatically starts with VIP
    vipExpireAt: isAdminEmail ? Date.now() + 3650 * 86400 * 1000 : null,
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

      if (isAdminEmail && data.role !== 'admin') {
        updates.role = 'admin';
        updates.isVip = true;
        needsUpdate = true;
      }

      // Check VIP Expiration
      if (data.isVip && data.vipExpireAt && data.vipExpireAt < Date.now()) {
        updates.isVip = false;
        needsUpdate = true;
      }

      if (needsUpdate) {
        await updateDoc(userRef, updates).catch(e => console.warn('Offline mode: skipped updateDoc', e));
        return { ...data, ...updates };
      }

      return data;
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
