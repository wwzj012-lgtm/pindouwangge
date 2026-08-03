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
  try {
    const userRef = doc(db, 'users', uid);
    await setDoc(userRef, profile, { merge: true });
    res.json({ success: true });
  } catch (err: any) {
    console.error('Failed to set user profile server-side:', err);
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
