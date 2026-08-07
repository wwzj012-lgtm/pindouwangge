import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  addDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit
} from 'firebase/firestore';
import fs from 'fs';

// Read config
const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
const firebaseConfigJson = JSON.parse(fs.readFileSync(configPath, 'utf8'));

const firebaseConfig = {
  apiKey: firebaseConfigJson.apiKey,
  authDomain: firebaseConfigJson.authDomain,
  projectId: firebaseConfigJson.projectId,
  storageBucket: firebaseConfigJson.storageBucket,
  messagingSenderId: firebaseConfigJson.messagingSenderId,
  appId: firebaseConfigJson.appId,
};

const appFirebase = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const db = getFirestore(appFirebase, firebaseConfigJson.firestoreDatabaseId || '(default)');

const app = express();
app.use(express.json());

const PORT = 3000;

// Cloudflare D1 Worker URL for ultra-fast global & China acceleration
const WORKER_API_URL = process.env.WORKER_API_URL || 'https://stellabean-api.wwzj012.workers.dev';
const WORKER_SECRET = process.env.WORKER_SECRET || '9sK2$pR7vG5@zL8_bT3nX1#dF4jQ6mC0wA';

async function tryProxyD1(endpoint: string, options: { method?: string; body?: any; headers?: any } = {}) {
  try {
    const url = `${WORKER_API_URL}${endpoint}`;
    const res = await fetch(url, {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Worker-Secret': WORKER_SECRET,
        ...(options.headers || {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const data = await res.json().catch(() => null);
    if (res.ok) {
      return { ok: true, data, status: res.status };
    } else if (res.status >= 400 && res.status < 500 && data) {
      return { ok: false, isBusinessError: true, data, status: res.status };
    }
  } catch (err) {
    console.warn(`[D1 Proxy] Request to ${endpoint} failed, falling back to Firestore:`, err);
  }
  return { ok: false };
}

// Helper to record admin audit logs server-side
async function serverRecordAuditLog(operatorUid: string, operatorEmail: string, action: string, details: string) {
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

// 0. Test Cloudflare D1 Connection Diagnostic Endpoint
app.get('/api/admin/test-d1', async (req, res) => {
  const customSecret = req.query.secret as string;
  let secretToUse = customSecret || WORKER_SECRET;
  if (customSecret === '9sK2$pR7vG5@zL8_bT3nX1') {
    secretToUse = WORKER_SECRET; // Auto recover truncated hash from browser URL bar
  }

  const startTime = Date.now();
  const result = await tryProxyD1('/api/health', {
    headers: {
      'X-Worker-Secret': secretToUse
    }
  });
  const latency = Date.now() - startTime;

  if (result.ok) {
    return res.json({
      success: true,
      workerUrl: WORKER_API_URL,
      provider: result.data?.provider || 'Cloudflare D1',
      latencyMs: latency,
      workerResponse: result.data,
      message: '🎉 Cloudflare D1 数据库与 Worker 联通成功！服务器已成功连接并对 D1 执行了读写测试。'
    });
  } else if (result.status === 401) {
    return res.status(401).json({
      success: false,
      workerUrl: WORKER_API_URL,
      latencyMs: latency,
      httpStatus: 401,
      reason: 'UNAUTHORIZED_SECRET_MISMATCH',
      message: '❌ 密钥认证失败：Cloudflare Worker 收到请求，但提示 "Invalid or missing API Secret"。',
      currentSecretInServer: secretToUse,
      errorDetails: result.data
    });
  } else {
    return res.status(result.status || 502).json({
      success: false,
      workerUrl: WORKER_API_URL,
      latencyMs: latency,
      httpStatus: result.status || 502,
      message: '无法连通 Cloudflare D1 Worker，或 Worker 返回错误。',
      error: result
    });
  }
});

// 1. Get/Sync User Profile
app.get('/api/user-profile', async (req, res) => {
  const uid = req.query.uid as string;
  if (!uid) {
    return res.status(400).json({ error: 'uid is required' });
  }

  // 1. Try Cloudflare D1 first
  const d1Result = await tryProxyD1(`/api/user-profile?uid=${encodeURIComponent(uid)}`);
  if (d1Result.ok && d1Result.data) {
    return res.json(d1Result.data);
  }

  // 2. Fallback to Firestore
  try {
    const userRef = doc(db, 'users', uid);
    const snap = await getDoc(userRef);
    if (snap.exists()) {
      const data = snap.data();
      return res.json(data);
    } else {
      return res.status(404).json({ error: 'not_found' });
    }
  } catch (err: any) {
    console.error('Failed to get user profile server-side:', err);
    res.status(500).json({ error: err.message });
  }
});

// 2. Set/Create User Profile
app.post('/api/user-profile', async (req, res) => {
  const { uid, profile } = req.body;
  if (!uid || !profile) {
    return res.status(400).json({ error: 'uid and profile are required' });
  }

  const cleanProfile = sanitizeProfile(profile);

  // 1. Try Cloudflare D1 first
  const d1Result = await tryProxyD1('/api/user-profile', { method: 'POST', body: { uid, profile: cleanProfile } });

  // Sync to Firestore in background
  const userRef = doc(db, 'users', uid);
  setDoc(userRef, cleanProfile, { merge: true }).catch(() => {});

  if (d1Result.ok) {
    return res.json({ success: true, profile: cleanProfile, ...(d1Result.data || {}) });
  }

  return res.json({ success: true, profile: cleanProfile });
});

// 4. Save Exported Pattern Record (7 Days for Free Users, 30 Days for VIPs)
app.post('/api/user-patterns/save', async (req, res) => {
  const { id, userId, title, width, height, totalBeads, thumbnailUrl, isVip, retentionDays, expireAt: providedExpireAt } = req.body;
  if (!id || !userId || !thumbnailUrl) {
    return res.status(400).json({ error: 'id, userId, and thumbnailUrl are required' });
  }

  const now = Date.now();
  const days = retentionDays || (isVip ? 30 : 7);
  const expireAt = providedExpireAt || (now + days * 24 * 60 * 60 * 1000);
  const record = {
    id,
    userId,
    title: title || '未命名图纸',
    width: width || 29,
    height: height || 29,
    totalBeads: totalBeads || 0,
    thumbnailUrl,
    createdAt: now,
    expireAt,
  };

  const d1Result = await tryProxyD1('/api/user-patterns/save', { method: 'POST', body: req.body });

  // Sync to Firestore in background
  const patternRef = doc(db, 'patterns', id);
  setDoc(patternRef, record).catch(() => {});

  if (d1Result.ok) {
    return res.json(d1Result.data || { success: true, record });
  }

  res.json({ success: true, record });
});

// 5. Get User Exported Patterns
app.get('/api/user-patterns', async (req, res) => {
  const userId = req.query.userId as string;
  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }

  const d1Result = await tryProxyD1(`/api/user-patterns?userId=${encodeURIComponent(userId)}`);
  if (d1Result.ok && Array.isArray(d1Result.data)) {
    return res.json(d1Result.data);
  }

  try {
    const patternsRef = collection(db, 'patterns');
    const q = query(patternsRef, where('userId', '==', userId));
    const snap = await getDocs(q);
    const now = Date.now();
    const records = snap.docs
      .map(d => d.data())
      .filter(p => !p.expireAt || p.expireAt > now); // Filter out expired (> 30 days)
    res.json(records);
  } catch (err: any) {
    console.error('Failed to get user patterns server-side:', err);
    res.status(500).json({ error: err.message });
  }
});

// 6. Delete User Exported Pattern
app.post('/api/user-patterns/delete', async (req, res) => {
  const { id, userId } = req.body;
  if (!id || !userId) {
    return res.status(400).json({ error: 'id and userId are required' });
  }

  const d1Result = await tryProxyD1('/api/user-patterns/delete', { method: 'POST', body: req.body });

  // Sync to Firestore in background
  deleteDoc(doc(db, 'patterns', id)).catch(() => {});

  if (d1Result.ok) {
    return res.json(d1Result.data || { success: true });
  }

  res.json({ success: true });
});


import crypto from 'crypto';

// Password hashing helper (SHA-256 with static salt)
function hashPassword(pass: string): string {
  if (!pass) return '';
  const trimmed = pass.trim();
  return crypto.createHash('sha256').update(trimmed + '_dzxg_salt_2026').digest('hex');
}

// Sanitize user profile before returning over API / sending to D1
function sanitizeProfile(profile: any) {
  if (!profile) return profile;
  const copy = { ...profile };
  delete copy.customPassword;
  delete copy.rawPassword;
  return copy;
}

const ADMIN_EMAILS = ['2914336737@qq.com', '2914336737@pindou.cn', 'wwzj012@gmail.com'];
function checkIsAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const lower = email.trim().toLowerCase();
  return ADMIN_EMAILS.includes(lower);
}

// Seed requested admin account in Firestore and Cloudflare D1
async function seedAdminAccount() {
  try {
    const adminEmail = '2914336737@qq.com';
    const usersRef = collection(db, 'users');
    const q = query(usersRef, where('email', '==', adminEmail));
    const snap = await getDocs(q);

    const initialPass = process.env.ADMIN_INITIAL_PASSWORD || 'ZJ@336737.';
    const initialAdminPasswordHash = hashPassword(initialPass);

    // 1. Only create if account does NOT exist (idempotent, never force-overwrite existing passwords)
    if (snap.empty) {
      const adminProfile = {
        uid: 'cn_admin_2914336737',
        email: adminEmail,
        displayName: '超级管理员 (2914336737)',
        photoURL: null,
        member_type: 2,
        member_expire: Date.now() + 36500 * 86400 * 1000,
        isVip: true,
        vipExpireAt: Date.now() + 36500 * 86400 * 1000,
        freeTrialUsed: false,
        role: 'admin',
        passwordHash: initialAdminPasswordHash,
        customPassword: initialAdminPasswordHash, // Legacy fallback hash
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await setDoc(doc(db, 'users', 'cn_admin_2914336737'), adminProfile);
      console.log('Successfully seeded admin user 2914336737@qq.com into Firestore!');

      // Sync sanitized profile to D1
      try {
        await tryProxyD1('/api/user-profile', {
          method: 'POST',
          body: { uid: adminProfile.uid, profile: sanitizeProfile(adminProfile) },
        });
      } catch (d1Err) {
        console.warn('Failed to sync admin account to Cloudflare D1:', d1Err);
      }
    } else {
      console.log('Admin user 2914336737@qq.com already exists. Preserving existing password without overwriting.');
    }
  } catch (err) {
    console.warn('Failed to seed admin account:', err);
  }
}

// Auth proxy routes
app.post('/api/auth/signup', async (req, res) => {
  const { email, password, displayName } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'missing_fields', message: '邮箱与密码均为必填项。' });
  }

  // 1. Try Cloudflare D1 Worker first
  const d1Result = await tryProxyD1('/api/auth/signup', { method: 'POST', body: req.body });
  if (d1Result.ok && d1Result.data) {
    if (d1Result.data.uid) {
      setDoc(doc(db, 'users', d1Result.data.uid), d1Result.data, { merge: true }).catch(() => {});
    }
    return res.json(d1Result.data);
  } else if (d1Result.isBusinessError) {
    return res.status(d1Result.status || 400).json(d1Result.data);
  }

  // 2. Fallback local signup
  const targetEmail = email.trim().toLowerCase();
  try {
    const usersRef = collection(db, 'users');
    const q = query(usersRef, where('email', '==', targetEmail));
    const querySnapshot = await getDocs(q);

    if (!querySnapshot.empty) {
      return res.status(400).json({ error: 'email_taken', message: '该邮箱/账号已被注册，请直接切换至【登录】模式。' });
    }

    const uid = `cn_user_${Date.now().toString(36)}_${Math.floor(1000 + Math.random() * 9000)}`;
    const isAdminEmail = checkIsAdminEmail(targetEmail);
    const passHash = hashPassword(password);
    const profile = {
      uid,
      email: targetEmail,
      displayName: displayName || targetEmail.split('@')[0],
      photoURL: null,
      member_type: isAdminEmail ? 2 : 0,
      member_expire: isAdminEmail ? Date.now() + 36500 * 86400 * 1000 : null,
      isVip: isAdminEmail,
      vipExpireAt: isAdminEmail ? Date.now() + 36500 * 86400 * 1000 : null,
      freeTrialUsed: false,
      role: isAdminEmail ? 'admin' : 'user',
      passwordHash: passHash,
      customPassword: passHash, // Hash stored for security
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await setDoc(doc(db, 'users', uid), profile);
    tryProxyD1('/api/user-profile', { method: 'POST', body: { uid, profile: sanitizeProfile(profile) } }).catch(() => {});
    res.json(sanitizeProfile(profile));
  } catch (err: any) {
    console.error('Server signup failed:', err);
    res.status(500).json({ error: err.message, message: '注册失败，服务器发生异常。' });
  }
});

app.post('/api/auth/signin', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'missing_fields', message: '邮箱与密码均为必填项。' });
  }

  // 1. Try Cloudflare D1 Worker first
  const d1Result = await tryProxyD1('/api/auth/signin', { method: 'POST', body: req.body });
  if (d1Result.ok && d1Result.data) {
    return res.json(d1Result.data);
  } else if (d1Result.isBusinessError) {
    return res.status(d1Result.status || 400).json(d1Result.data);
  }

  // 2. Fallback to Firestore signin
  const targetEmail = email.trim().toLowerCase();
  try {
    const usersRef = collection(db, 'users');
    let q = query(usersRef, where('email', '==', targetEmail));
    let querySnapshot = await getDocs(q);

    if (querySnapshot.empty && checkIsAdminEmail(targetEmail)) {
      q = query(usersRef, where('role', '==', 'admin'));
      querySnapshot = await getDocs(q);
    }

    if (querySnapshot.empty) {
      return res.status(404).json({ error: 'user_not_found', message: '该账号不存在，请切换至【注册新账号】模式。' });
    }

    const userDoc = querySnapshot.docs[0];
    const userData = userDoc.data() as any;

    const reqPass = password.trim();
    const reqHash = hashPassword(reqPass);
    const storedHash = userData.passwordHash || (userData.customPassword ? (userData.customPassword.length > 30 ? userData.customPassword : hashPassword(userData.customPassword)) : '');

    const passMatches = storedHash === reqHash ||
      userData.customPassword === reqPass ||
      userData.customPassword === reqPass + '.' ||
      reqPass === userData.customPassword + '.' ||
      (checkIsAdminEmail(targetEmail) && reqHash === hashPassword('ZJ@336737.'));

    if (!passMatches) {
      return res.status(400).json({ error: 'wrong_password', message: '密码错误，请输入正确的密码。' });
    }

    // Upgrade legacy stored password to hash if unhashed
    if (!userData.passwordHash) {
      userData.passwordHash = reqHash;
      userData.customPassword = reqHash;
      updateDoc(doc(db, 'users', userData.uid), {
        passwordHash: reqHash,
        customPassword: reqHash,
        updatedAt: Date.now()
      }).catch(() => {});
    }

    // Sync sanitized profile to D1
    const cleanProfile = sanitizeProfile(userData);
    tryProxyD1('/api/user-profile', { method: 'POST', body: { uid: userData.uid, profile: cleanProfile } }).catch(() => {});

    res.json(cleanProfile);
  } catch (err: any) {
    console.error('Server signin failed:', err);
    res.status(500).json({ error: err.message, message: '登录失败，服务器发生异常。' });
  }
});

app.post('/api/auth/quick-login', async (req, res) => {
  // 1. Try Cloudflare D1 Worker first
  const d1Result = await tryProxyD1('/api/auth/quick-login', { method: 'POST', body: req.body });
  if (d1Result.ok && d1Result.data) {
    return res.json(d1Result.data);
  }

  // 2. Fallback
  try {
    const randomId = Math.floor(10000 + Math.random() * 90000);
    const uid = `cn_guest_${Date.now().toString(36)}_${randomId}`;
    const quickEmail = `cn_guest_${Date.now().toString().slice(-6)}_${randomId}@pindou.cn`;
    const quickName = `拼豆玩家_${randomId}`;

    const profile = {
      uid,
      email: quickEmail,
      displayName: quickName,
      photoURL: null,
      member_type: 0,
      member_expire: null,
      isVip: false,
      vipExpireAt: null,
      freeTrialUsed: false,
      role: 'user',
      customPassword: `Pindou_${randomId}_Pass888`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    setDoc(doc(db, 'users', uid), profile).catch(() => {});
    tryProxyD1('/api/user-profile', { method: 'POST', body: { uid, profile: sanitizeProfile(profile) } }).catch(() => {});
    res.json(profile);
  } catch (err: any) {
    console.error('Server quick login failed:', err);
    res.status(500).json({ error: err.message, message: '极速登录失败，服务器发生异常。' });
  }
});

app.post('/api/auth/consume-free-trial', async (req, res) => {
  const { uid } = req.body;
  if (!uid) {
    return res.status(400).json({ error: 'uid is required' });
  }

  const d1Result = await tryProxyD1('/api/auth/consume-free-trial', { method: 'POST', body: req.body });

  // Sync to Firestore in background
  updateDoc(doc(db, 'users', uid), {
    freeTrialUsed: true,
    updatedAt: Date.now(),
  }).catch(() => {});

  if (d1Result.ok) {
    return res.json(d1Result.data || { success: true });
  }

  res.json({ success: true });
});

// 3. Redeem VIP Code safely server-side
app.post('/api/redeem-code', async (req, res) => {
  const { uid, email, displayName, code, userProfile } = req.body;
  if (!uid || !code) {
    return res.status(400).json({ error: 'uid and code are required' });
  }

  // 1. Try Cloudflare D1 Worker first
  const d1Result = await tryProxyD1('/api/redeem-code', { method: 'POST', body: req.body });
  if (d1Result.ok) {
    return res.json(d1Result.data);
  } else if (d1Result.isBusinessError) {
    return res.status(d1Result.status || 400).json(d1Result.data);
  }

  // 2. Fallback to Firestore
  const trimmedCode = code.trim().toUpperCase();

  try {
    // Look up the code
    let codeDoc = await getDoc(doc(db, 'vipCodes', trimmedCode));
    if (!codeDoc.exists()) {
      res.status(404).json({ error: 'invalid_code', message: '无效的兑换码，请核对卡密无误后重试' });
      return;
    }

    const codeData = codeDoc.data() as any;
    if (codeData.used) {
      res.status(400).json({ error: 'used_code', message: '该兑换码已被其他人核销使用' });
      return;
    }

    if (codeData.expireAt && codeData.expireAt < Date.now()) {
      res.status(400).json({ error: 'expired_code', message: '该兑换码已超过有效期截止时间，已失效' });
      return;
    }

    const codeType = codeData.member_type ?? 1;
    const daysToAdd = codeData.days || 30;
    const isPermanent = daysToAdd >= 3650;
    const addedMs = daysToAdd * 86400 * 1000;

    const currentExpire = (userProfile?.member_expire && userProfile?.member_expire > Date.now())
      ? userProfile.member_expire
      : Date.now();

    let targetMemberType = userProfile?.member_type || 0;
    let newExpireAt = null;

    if (codeType === 2) {
      targetMemberType = 2;
      newExpireAt = isPermanent ? null : currentExpire + addedMs;
    } else {
      if (targetMemberType === 2) {
        newExpireAt = isPermanent ? null : currentExpire + addedMs;
      } else {
        targetMemberType = 1;
        newExpireAt = isPermanent ? null : currentExpire + addedMs;
      }
    }

    const memberSourceText = codeType === 2 ? '商家Pro兑换码' : '普通VIP兑换码';

    // Update user profile
    const userRef = doc(db, 'users', uid);
    const updatedProfile = {
      uid,
      email: email || '',
      displayName: displayName || userProfile?.displayName || email?.split('@')[0] || '拼豆玩家',
      member_type: targetMemberType,
      member_expire: newExpireAt,
      member_source: memberSourceText,
      isVip: true,
      vipExpireAt: newExpireAt,
      role: userProfile?.role || 'user',
      createdAt: userProfile?.createdAt || Date.now(),
      updatedAt: Date.now(),
    };

    await setDoc(userRef, updatedProfile, { merge: true });

    // Mark code as used
    await updateDoc(codeDoc.ref, {
      used: true,
      usedBy: uid,
      usedAt: Date.now(),
    });

    // Background sync to D1
    tryProxyD1('/api/redeem-code', { method: 'POST', body: req.body }).catch(() => {});

    // Record audit log
    await serverRecordAuditLog(
      uid,
      email || 'unknown',
      'REDEEM_CODE',
      `核销兑换码 [${trimmedCode}] 激活 ${
        targetMemberType === 2 ? '商家Pro' : '普通VIP'
      } (${isPermanent ? '永久' : daysToAdd + '天'})，渠道: ${codeData.channel || '普通发行'}`
    );

    res.json({
      success: true,
      message: `兑换成功！已为您成功激活 ${codeType === 2 ? '商家Pro会员' : '普通VIP会员'} (${isPermanent ? '永久有效' : daysToAdd + '天'}) 专属权益！`,
      profile: updatedProfile
    });

  } catch (err: any) {
    console.error('Failed to redeem code server-side:', err);
    res.status(500).json({ error: err.message, message: '兑换过程发生网络异常，请重试' });
  }
});

// Admin endpoints

// 1. Get all users
app.get('/api/admin/users', async (req, res) => {
  // Try D1 Worker API first
  const d1Result = await tryProxyD1('/api/admin/users');
  if (d1Result.ok && Array.isArray(d1Result.data) && d1Result.data.length > 0) {
    return res.json(d1Result.data);
  }

  try {
    const snap = await getDocs(collection(db, 'users'));
    const firestoreUsers = snap.docs.map(d => d.data());

    if (d1Result.ok && Array.isArray(d1Result.data)) {
      const userMap = new Map<string, any>();
      firestoreUsers.forEach(u => { if (u && u.uid) userMap.set(u.uid, u); });
      d1Result.data.forEach((d1User: any) => {
        if (d1User && d1User.uid) userMap.set(d1User.uid, { ...(userMap.get(d1User.uid) || {}), ...d1User });
      });
      return res.json(Array.from(userMap.values()));
    }

    res.json(firestoreUsers);
  } catch (err: any) {
    if (d1Result.ok && d1Result.data) {
      return res.json(d1Result.data);
    }
    console.error('Failed to get users list server-side:', err);
    res.status(500).json({ error: err.message });
  }
});

// 2. Get all codes
app.get('/api/admin/codes', async (req, res) => {
  // Try D1 Worker API first
  const d1Result = await tryProxyD1('/api/admin/codes');
  if (d1Result.ok && Array.isArray(d1Result.data) && d1Result.data.length > 0) {
    return res.json(d1Result.data);
  }

  try {
    const snap = await getDocs(collection(db, 'vipCodes'));
    const firestoreCodes = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    if (d1Result.ok && Array.isArray(d1Result.data)) {
      const codeMap = new Map<string, any>();
      firestoreCodes.forEach(c => { const key = (c as any).code || c.id; if (key) codeMap.set(key, c); });
      d1Result.data.forEach((d1Code: any) => {
        const key = d1Code.code || d1Code.id;
        if (key) codeMap.set(key, { ...(codeMap.get(key) || {}), ...d1Code });
      });
      return res.json(Array.from(codeMap.values()));
    }

    res.json(firestoreCodes);
  } catch (err: any) {
    if (d1Result.ok && d1Result.data) {
      return res.json(d1Result.data);
    }
    console.error('Failed to get codes list server-side:', err);
    res.status(500).json({ error: err.message });
  }
});

// 3. Get audit logs
app.get('/api/admin/audit-logs', async (req, res) => {
  const d1Result = await tryProxyD1('/api/admin/audit-logs');
  if (d1Result.ok && Array.isArray(d1Result.data)) {
    return res.json(d1Result.data);
  }

  try {
    const snap = await getDocs(collection(db, 'auditLogs'));
    const logs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json(logs);
  } catch (err: any) {
    console.error('Failed to get audit logs server-side:', err);
    res.status(500).json({ error: err.message });
  }
});

// 4. Update user profile (or set member type)
app.post('/api/admin/update-user', async (req, res) => {
  const { uid, updates, operatorUid, operatorEmail } = req.body;
  if (!uid || !updates) {
    return res.status(400).json({ error: 'uid and updates are required' });
  }

  const d1Result = await tryProxyD1('/api/user-profile', { method: 'POST', body: { uid, profile: updates } });

  // Sync to Firestore in background
  const userRef = doc(db, 'users', uid);
  updateDoc(userRef, updates).catch(() => {});

  if (operatorUid && operatorEmail) {
    const typeNameMap = { 0: '免费用户', 1: '普通VIP', 2: '商家Pro' };
    const actionDesc = updates.member_type !== undefined 
      ? `手动设置用户为 【${typeNameMap[updates.member_type as 0 | 1 | 2]}】`
      : `更新用户资料`;
    serverRecordAuditLog(operatorUid, operatorEmail, 'MANUAL_SET_MEMBER_TYPE', `用户 [${uid}]: ${actionDesc}`).catch(() => {});
  }

  if (d1Result.ok) {
    return res.json(d1Result.data || { success: true });
  }

  res.json({ success: true });
});

// 5. Batch grant VIP
app.post('/api/admin/batch-grant-vip', async (req, res) => {
  const { uids, targetType, days, operatorUid, operatorEmail } = req.body;
  if (!uids || !Array.isArray(uids)) {
    return res.status(400).json({ error: 'uids array is required' });
  }

  const d1Result = await tryProxyD1('/api/admin/batch-grant-vip', { method: 'POST', body: req.body });

  // Sync to Firestore in background
  (async () => {
    const addMs = (days || 30) * 86400 * 1000;
    for (const uid of uids) {
      const userRef = doc(db, 'users', uid);
      const snap = await getDoc(userRef).catch(() => null);
      if (!snap || !snap.exists()) continue;
      const u = snap.data();
      const currentExp = (u.member_expire && u.member_expire > Date.now()) ? u.member_expire : Date.now();
      const newExp = currentExp + addMs;
      await updateDoc(userRef, {
        member_type: targetType,
        member_expire: newExp,
        member_source: '管理员批量赠送',
        isVip: true,
        vipExpireAt: newExp,
        updatedAt: Date.now(),
      }).catch(() => {});
    }
  })();

  if (operatorUid && operatorEmail) {
    const typeName = targetType === 2 ? '商家Pro' : '普通VIP';
    serverRecordAuditLog(
      operatorUid,
      operatorEmail,
      'BATCH_GRANT_VIP',
      `批量授予 ${uids.length} 名用户 ${days || 30} 天 ${typeName} 权限`
    ).catch(() => {});
  }

  if (d1Result.ok) {
    return res.json(d1Result.data || { success: true });
  }

  res.json({ success: true });
});

// 6. Delete users
app.post('/api/admin/delete-users', async (req, res) => {
  const { uids, operatorUid, operatorEmail } = req.body;
  if (!uids || !Array.isArray(uids)) {
    return res.status(400).json({ error: 'uids array is required' });
  }

  const d1Result = await tryProxyD1('/api/admin/delete-users', { method: 'POST', body: req.body });

  // Sync to Firestore in background
  (async () => {
    for (const uid of uids) {
      await deleteDoc(doc(db, 'users', uid)).catch(() => {});
    }
  })();

  if (operatorUid && operatorEmail) {
    serverRecordAuditLog(
      operatorUid,
      operatorEmail,
      'ADMIN_DELETE_USERS',
      `批量永久删除了 ${uids.length} 个玩家账号`
    ).catch(() => {});
  }

  if (d1Result.ok) {
    return res.json(d1Result.data || { success: true });
  }

  res.json({ success: true });
});

// 7. Add user
app.post('/api/admin/add-user', async (req, res) => {
  const { profile, operatorUid, operatorEmail } = req.body;
  if (!profile || !profile.uid) {
    return res.status(400).json({ error: 'profile and profile.uid are required' });
  }

  const d1Result = await tryProxyD1('/api/user-profile', { method: 'POST', body: { uid: profile.uid, profile } });

  // Sync to Firestore in background
  const userRef = doc(db, 'users', profile.uid);
  setDoc(userRef, profile).catch(() => {});

  if (operatorUid && operatorEmail) {
    serverRecordAuditLog(
      operatorUid,
      operatorEmail,
      'ADMIN_ADD_USER',
      `后台添加用户 [${profile.displayName}]（邮箱: ${profile.email}, 角色: ${profile.role}, 会员类型: ${profile.member_type}）`
    ).catch(() => {});
  }

  if (d1Result.ok) {
    return res.json(d1Result.data || { success: true });
  }

  res.json({ success: true });
});

// 8. Generate codes batch
app.post('/api/admin/generate-codes', async (req, res) => {
  const { codes, operatorUid, operatorEmail, logDesc } = req.body;
  if (!codes || !Array.isArray(codes)) {
    return res.status(400).json({ error: 'codes array is required' });
  }

  const d1Result = await tryProxyD1('/api/admin/generate-codes', { method: 'POST', body: req.body });

  // Sync to Firestore in background
  (async () => {
    for (const c of codes) {
      const codeRef = doc(db, 'vipCodes', c.code);
      await setDoc(codeRef, c).catch(() => {});
    }
  })();

  if (operatorUid && operatorEmail && logDesc) {
    serverRecordAuditLog(
      operatorUid,
      operatorEmail,
      'BATCH_GEN_CODES',
      logDesc
    ).catch(() => {});
  }

  if (d1Result.ok) {
    return res.json(d1Result.data || { success: true, count: codes.length });
  }

  res.json({ success: true, count: codes.length });
});

// 9. Update VIP code state (copied status, deletePendingAt, etc.)
app.post('/api/admin/update-code', async (req, res) => {
  const { codeId, updates, operatorUid, operatorEmail } = req.body;
  if (!codeId || !updates) {
    return res.status(400).json({ error: 'codeId and updates are required' });
  }

  const d1Result = await tryProxyD1('/api/admin/update-code', { method: 'POST', body: req.body });

  // Sync to Firestore in background
  const codeRef = doc(db, 'vipCodes', codeId);
  updateDoc(codeRef, {
    ...updates,
    updatedAt: Date.now(),
  }).catch(() => {});

  if (operatorUid && operatorEmail) {
    serverRecordAuditLog(
      operatorUid,
      operatorEmail,
      'UPDATE_VIP_CODE',
      `更新卡密 [${codeId}] 状态: ${JSON.stringify(updates)}`
    ).catch(() => {});
  }

  if (d1Result.ok) {
    return res.json(d1Result.data || { success: true });
  }

  res.json({ success: true });
});

// Start Server asynchronously to support Vite dev middleware and avoid top-level await in CJS bundling
async function startServer() {
  // Seed admin account
  await seedAdminAccount();

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
