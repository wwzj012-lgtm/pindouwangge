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

// 1. Get/Sync User Profile
app.get('/api/user-profile', async (req, res) => {
  const uid = req.query.uid as string;
  if (!uid) {
    return res.status(400).json({ error: 'uid is required' });
  }

  const d1Result = await tryProxyD1(`/api/user-profile?uid=${encodeURIComponent(uid)}`);
  if (d1Result.ok) {
    return res.json(d1Result.data);
  }

  try {
    const userRef = doc(db, 'users', uid);
    const snap = await getDoc(userRef);
    if (snap.exists()) {
      res.json(snap.data());
    } else {
      res.status(404).json({ error: 'not_found' });
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

  const d1Result = await tryProxyD1('/api/user-profile', { method: 'POST', body: req.body });

  try {
    const userRef = doc(db, 'users', uid);
    await setDoc(userRef, profile, { merge: true });
  } catch (err) {
    console.warn('Firestore fallback setDoc failed:', err);
  }

  if (d1Result.ok) {
    return res.json(d1Result.data);
  }
  res.json({ success: true });
});

// 4. Save Exported Pattern Record (7 Days for Free Users, 30 Days for VIPs)
app.post('/api/user-patterns/save', async (req, res) => {
  const { id, userId, title, width, height, totalBeads, thumbnailUrl, isVip, retentionDays, expireAt: providedExpireAt } = req.body;
  if (!id || !userId || !thumbnailUrl) {
    return res.status(400).json({ error: 'id, userId, and thumbnailUrl are required' });
  }

  const d1Result = await tryProxyD1('/api/user-patterns/save', { method: 'POST', body: req.body });
  if (d1Result.isBusinessError) {
    return res.status(d1Result.status).json(d1Result.data);
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

  try {
    const patternRef = doc(db, 'patterns', id);
    await setDoc(patternRef, record);
  } catch (err) {
    console.warn('Firestore fallback pattern save failed:', err);
  }

  if (d1Result.ok) {
    return res.json(d1Result.data);
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
  if (d1Result.ok) {
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
  if (d1Result.isBusinessError) {
    return res.status(d1Result.status).json(d1Result.data);
  }

  try {
    await deleteDoc(doc(db, 'patterns', id));
  } catch (err) {
    console.warn('Firestore fallback delete failed:', err);
  }

  if (d1Result.ok) {
    return res.json(d1Result.data);
  }
  res.json({ success: true });
});


// Auth proxy routes
app.post('/api/auth/signup', async (req, res) => {
  const { email, password, displayName } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'missing_fields', message: '邮箱与密码均为必填项。' });
  }

  const targetEmail = email.trim().toLowerCase();
  try {
    const usersRef = collection(db, 'users');
    const q = query(usersRef, where('email', '==', targetEmail));
    const querySnapshot = await getDocs(q);

    if (!querySnapshot.empty) {
      return res.status(400).json({ error: 'email_taken', message: '该邮箱/账号已被注册，请直接切换至【登录】模式。' });
    }

    const uid = `cn_user_${Date.now().toString(36)}_${Math.floor(1000 + Math.random() * 9000)}`;
    const isAdminEmail = targetEmail === 'wwzj012@gmail.com';
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
      customPassword: password,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await setDoc(doc(db, 'users', uid), profile);
    res.json(profile);
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

  const targetEmail = email.trim().toLowerCase();
  try {
    const usersRef = collection(db, 'users');
    const q = query(usersRef, where('email', '==', targetEmail));
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) {
      return res.status(404).json({ error: 'user_not_found', message: '该账号不存在，请切换至【注册新账号】模式。' });
    }

    const userDoc = querySnapshot.docs[0];
    const userData = userDoc.data() as any;

    if (userData.customPassword && userData.customPassword !== password) {
      return res.status(400).json({ error: 'wrong_password', message: '密码错误，请输入正确的密码。' });
    }

    // Auto set custom password if user existed without one
    if (!userData.customPassword) {
      await updateDoc(doc(db, 'users', userData.uid), {
        customPassword: password,
        updatedAt: Date.now()
      });
      userData.customPassword = password;
    }

    res.json(userData);
  } catch (err: any) {
    console.error('Server signin failed:', err);
    res.status(500).json({ error: err.message, message: '登录失败，服务器发生异常。' });
  }
});

app.post('/api/auth/quick-login', async (req, res) => {
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

    await setDoc(doc(db, 'users', uid), profile);
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
  try {
    await updateDoc(doc(db, 'users', uid), {
      freeTrialUsed: true,
      updatedAt: Date.now(),
    });
    res.json({ success: true });
  } catch (err: any) {
    console.error('Server consume-free-trial failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// 3. Redeem VIP Code safely server-side
app.post('/api/redeem-code', async (req, res) => {
  const { uid, email, displayName, code, userProfile } = req.body;
  if (!uid || !code) {
    return res.status(400).json({ error: 'uid and code are required' });
  }

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
  try {
    const snap = await getDocs(collection(db, 'users'));
    const users = snap.docs.map(d => d.data());
    res.json(users);
  } catch (err: any) {
    console.error('Failed to get users list server-side:', err);
    res.status(500).json({ error: err.message });
  }
});

// 2. Get all codes
app.get('/api/admin/codes', async (req, res) => {
  try {
    const snap = await getDocs(collection(db, 'vipCodes'));
    const codes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json(codes);
  } catch (err: any) {
    console.error('Failed to get codes list server-side:', err);
    res.status(500).json({ error: err.message });
  }
});

// 3. Get audit logs
app.get('/api/admin/audit-logs', async (req, res) => {
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
  try {
    const userRef = doc(db, 'users', uid);
    await updateDoc(userRef, updates);

    if (operatorUid && operatorEmail) {
      const typeNameMap = { 0: '免费用户', 1: '普通VIP', 2: '商家Pro' };
      const actionDesc = updates.member_type !== undefined 
        ? `手动设置用户为 【${typeNameMap[updates.member_type as 0 | 1 | 2]}】`
        : `更新用户资料`;
      await serverRecordAuditLog(operatorUid, operatorEmail, 'MANUAL_SET_MEMBER_TYPE', `用户 [${uid}]: ${actionDesc}`);
    }

    res.json({ success: true });
  } catch (err: any) {
    console.error('Failed to update user profile server-side:', err);
    res.status(500).json({ error: err.message });
  }
});

// 5. Batch grant VIP
app.post('/api/admin/batch-grant-vip', async (req, res) => {
  const { uids, targetType, days, operatorUid, operatorEmail } = req.body;
  if (!uids || !Array.isArray(uids)) {
    return res.status(400).json({ error: 'uids array is required' });
  }
  try {
    const addMs = (days || 30) * 86400 * 1000;
    const typeName = targetType === 2 ? '商家Pro' : '普通VIP';

    for (const uid of uids) {
      const userRef = doc(db, 'users', uid);
      const snap = await getDoc(userRef);
      if (!snap.exists()) continue;

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
      });
    }

    if (operatorUid && operatorEmail) {
      await serverRecordAuditLog(
        operatorUid,
        operatorEmail,
        'BATCH_GRANT_VIP',
        `批量授予 ${uids.length} 名用户 ${days || 30} 天 ${typeName} 权限`
      );
    }

    res.json({ success: true });
  } catch (err: any) {
    console.error('Failed to batch grant VIP server-side:', err);
    res.status(500).json({ error: err.message });
  }
});

// 6. Delete users
app.post('/api/admin/delete-users', async (req, res) => {
  const { uids, operatorUid, operatorEmail } = req.body;
  if (!uids || !Array.isArray(uids)) {
    return res.status(400).json({ error: 'uids array is required' });
  }
  try {
    for (const uid of uids) {
      await deleteDoc(doc(db, 'users', uid));
    }

    if (operatorUid && operatorEmail) {
      await serverRecordAuditLog(
        operatorUid,
        operatorEmail,
        'ADMIN_DELETE_USERS',
        `批量永久删除了 ${uids.length} 个玩家账号`
      );
    }

    res.json({ success: true });
  } catch (err: any) {
    console.error('Failed to delete users server-side:', err);
    res.status(500).json({ error: err.message });
  }
});

// 7. Add user
app.post('/api/admin/add-user', async (req, res) => {
  const { profile, operatorUid, operatorEmail } = req.body;
  if (!profile || !profile.uid) {
    return res.status(400).json({ error: 'profile and profile.uid are required' });
  }
  try {
    const userRef = doc(db, 'users', profile.uid);
    await setDoc(userRef, profile);

    if (operatorUid && operatorEmail) {
      await serverRecordAuditLog(
        operatorUid,
        operatorEmail,
        'ADMIN_ADD_USER',
        `后台添加用户 [${profile.displayName}]（邮箱: ${profile.email}, 角色: ${profile.role}, 会员类型: ${profile.member_type}）`
      );
    }

    res.json({ success: true });
  } catch (err: any) {
    console.error('Failed to add user server-side:', err);
    res.status(500).json({ error: err.message });
  }
});

// 8. Generate codes batch
app.post('/api/admin/generate-codes', async (req, res) => {
  const { codes, operatorUid, operatorEmail, logDesc } = req.body;
  if (!codes || !Array.isArray(codes)) {
    return res.status(400).json({ error: 'codes array is required' });
  }
  try {
    for (const c of codes) {
      const codeRef = doc(db, 'vipCodes', c.code);
      await setDoc(codeRef, c);
    }

    if (operatorUid && operatorEmail && logDesc) {
      await serverRecordAuditLog(
        operatorUid,
        operatorEmail,
        'BATCH_GEN_CODES',
        logDesc
      );
    }

    res.json({ success: true });
  } catch (err: any) {
    console.error('Failed to generate codes server-side:', err);
    res.status(500).json({ error: err.message });
  }
});

// Start Server asynchronously to support Vite dev middleware and avoid top-level await in CJS bundling
async function startServer() {
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
