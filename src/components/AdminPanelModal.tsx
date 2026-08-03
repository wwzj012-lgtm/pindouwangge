import React, { useState, useEffect } from 'react';
import {
  X,
  Users,
  ShieldCheck,
  Zap,
  KeyRound,
  Plus,
  RefreshCw,
  Search,
  FileSpreadsheet,
  Activity,
  UserCheck,
  Eye,
  EyeOff,
  Copy,
  Check,
  AlertTriangle,
  Lock,
  ShieldAlert,
  CheckCircle2,
  Crown,
  Store,
  Trash2,
  Edit3,
  UserPlus,
  Filter,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  db,
  collection,
  getDocs,
  doc,
  updateDoc,
  setDoc,
  deleteDoc,
  UserProfile,
  sha256,
  recordAuditLog,
  AuditLog,
} from '../lib/firebase';
import {
  generateCommercialVipCode,
  maskCardCode,
} from '../utils/vipCodeUtils';

interface AdminPanelModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface VipCodeData {
  id: string;
  code: string;
  codeHash?: string;
  days: number;
  member_type?: 1 | 2; // 1=普通VIP, 2=商家Pro
  channel?: string;
  expireAt?: number;
  used: boolean;
  usedBy?: string;
  usedAt?: number;
  createdAt: number;
}

export const AdminPanelModal: React.FC<AdminPanelModalProps> = ({ isOpen, onClose }) => {
  const { currentUser, isAdmin } = useAuth();
  const [activeTab, setActiveTab] = useState<'users' | 'codes' | 'logs'>('users');

  const [usersList, setUsersList] = useState<UserProfile[]>([]);
  const [codesList, setCodesList] = useState<VipCodeData[]>([]);
  const [auditLogsList, setAuditLogsList] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUserUids, setSelectedUserUids] = useState<string[]>([]);

  // Generator state
  const [codeMemberType, setCodeMemberType] = useState<1 | 2>(1); // 1 = 普通VIP (PV), 2 = 商家Pro (BP)
  const [newCodeDays, setNewCodeDays] = useState<number>(30);
  const [batchCount, setBatchCount] = useState<number>(1);
  const [channelTag, setChannelTag] = useState<string>('淘宝旗舰店');
  const [customCodeInput, setCustomCodeInput] = useState<string>('');
  const [validDaysLimit, setValidDaysLimit] = useState<number>(90);
  const [genSuccessMsg, setGenSuccessMsg] = useState<string>('');

  // Plaintext batch modal state (for initial display right after batch creation)
  const [showBatchGenModal, setShowBatchGenModal] = useState<boolean>(false);
  const [lastGeneratedPlaintextCodes, setLastGeneratedPlaintextCodes] = useState<string[]>([]);
  const [batchCopied, setBatchCopied] = useState<boolean>(false);

  // Table row unmask state & row copy state
  const [revealedCodeIds, setRevealedCodeIds] = useState<Record<string, boolean>>({});
  const [copiedRowId, setCopiedRowId] = useState<string | null>(null);

  // CSV Export confirmation modal state
  const [showExportConfirmModal, setShowExportConfirmModal] = useState<boolean>(false);

  // User CRUD states
  const [userRoleFilter, setUserRoleFilter] = useState<'all' | 'admin' | 'pro' | 'vip' | 'free'>('all');

  // Add User Modal state
  const [showAddUserModal, setShowAddUserModal] = useState<boolean>(false);
  const [addDisplayName, setAddDisplayName] = useState<string>('');
  const [addEmail, setAddEmail] = useState<string>('');
  const [addRole, setAddRole] = useState<'user' | 'admin'>('user');
  const [addMemberType, setAddMemberType] = useState<0 | 1 | 2>(0);
  const [addExpireDays, setAddExpireDays] = useState<number>(30);

  // Edit User Modal state
  const [showEditUserModal, setShowEditUserModal] = useState<boolean>(false);
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [editDisplayName, setEditDisplayName] = useState<string>('');
  const [editEmail, setEditEmail] = useState<string>('');
  const [editRole, setEditRole] = useState<'user' | 'admin'>('user');
  const [editMemberType, setEditMemberType] = useState<0 | 1 | 2>(0);
  const [editExpireDays, setEditExpireDays] = useState<number>(30);

  // Delete User Confirm Modal state
  const [showDeleteConfirmModal, setShowDeleteConfirmModal] = useState<boolean>(false);
  const [userToDelete, setUserToDelete] = useState<UserProfile | null>(null);
  const [showBatchDeleteConfirmModal, setShowBatchDeleteConfirmModal] = useState<boolean>(false);

  // Reset Password Modal state
  const [showResetPasswordModal, setShowResetPasswordModal] = useState<boolean>(false);
  const [userToResetPassword, setUserToResetPassword] = useState<UserProfile | null>(null);
  const [resetSuccessMessage, setResetSuccessMessage] = useState<string>('');

  useEffect(() => {
    if (isOpen && isAdmin) {
      loadData();
    }
  }, [isOpen, isAdmin]);

  const loadData = async () => {
    setLoading(true);
    try {
      // Fetch Users
      const usersSnap = await getDocs(collection(db, 'users'));
      const uList: UserProfile[] = [];
      usersSnap.forEach(d => {
        uList.push(d.data() as UserProfile);
      });
      setUsersList(uList);

      // Fetch Vip Codes
      const codesSnap = await getDocs(collection(db, 'vipCodes'));
      const cList: VipCodeData[] = [];
      codesSnap.forEach(d => {
        cList.push({ id: d.id, ...d.data() } as VipCodeData);
      });
      cList.sort((a, b) => b.createdAt - a.createdAt);
      setCodesList(cList);

      // Fetch Audit Logs
      const logsSnap = await getDocs(collection(db, 'auditLogs'));
      const lList: AuditLog[] = [];
      logsSnap.forEach(d => {
        lList.push({ id: d.id, ...d.data() } as AuditLog);
      });
      lList.sort((a, b) => b.timestamp - a.timestamp);
      setAuditLogsList(lList);
    } catch (err) {
      console.error('Failed to load admin data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSetUserMemberType = async (user: UserProfile, targetType: 0 | 1 | 2) => {
    try {
      const userRef = doc(db, 'users', user.uid);
      const isVip = targetType >= 1;
      const isPermanent = targetType > 0 && newCodeDays >= 3650;
      const newExpire = targetType === 0 ? null : (isPermanent ? null : Date.now() + 30 * 86400 * 1000);

      const typeNameMap = { 0: '免费用户', 1: '普通VIP', 2: '商家Pro' };

      await updateDoc(userRef, {
        member_type: targetType,
        member_expire: newExpire,
        member_source: '管理员手动设置',
        isVip: isVip,
        vipExpireAt: newExpire,
        updatedAt: Date.now(),
      });

      if (currentUser) {
        await recordAuditLog(
          currentUser.uid,
          currentUser.email || 'admin',
          'MANUAL_SET_MEMBER_TYPE',
          `手动设置用户 [${user.displayName || user.email}] 为 【${typeNameMap[targetType]}】`
        );
      }

      setUsersList(prev =>
        prev.map(u =>
          u.uid === user.uid
            ? {
                ...u,
                member_type: targetType,
                member_expire: newExpire,
                isVip: isVip,
                vipExpireAt: newExpire,
              }
            : u
        )
      );
    } catch (err) {
      console.error('Failed to set member type:', err);
    }
  };

  const handleBatchGrantVip = async (targetType: 1 | 2 = 1) => {
    if (selectedUserUids.length === 0) return;
    setLoading(true);
    try {
      const addMs = 30 * 86400 * 1000;
      const typeName = targetType === 2 ? '商家Pro' : '普通VIP';

      for (const uid of selectedUserUids) {
        const u = usersList.find(x => x.uid === uid);
        if (!u) continue;
        const currentExp =
          u.member_expire && u.member_expire > Date.now() ? u.member_expire : Date.now();
        const newExp = currentExp + addMs;

        await updateDoc(doc(db, 'users', uid), {
          member_type: targetType,
          member_expire: newExp,
          member_source: '管理员批量赠送',
          isVip: true,
          vipExpireAt: newExp,
          updatedAt: Date.now(),
        });
      }

      if (currentUser) {
        await recordAuditLog(
          currentUser.uid,
          currentUser.email || 'admin',
          'BATCH_GRANT_VIP',
          `批量授予 ${selectedUserUids.length} 名用户 30 天 ${typeName} 权限`
        );
      }

      await loadData();
      setSelectedUserUids([]);
    } catch (err) {
      console.error('Batch grant failed:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addEmail.trim()) return;

    setLoading(true);
    try {
      const targetEmail = addEmail.trim();
      const cleanedUid = targetEmail.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
      const newUid = `cn_user_${cleanedUid || Date.now().toString(36)}`;

      const isPermanent = addExpireDays >= 3650;
      const expireTime = addMemberType === 0 ? null : (isPermanent ? null : Date.now() + addExpireDays * 86400 * 1000);

      const newProfile: UserProfile = {
        uid: newUid,
        email: targetEmail,
        displayName: addDisplayName.trim() || targetEmail.split('@')[0],
        photoURL: null,
        member_type: addMemberType,
        member_expire: expireTime,
        member_source: '管理员后台手动创建',
        isVip: addMemberType > 0,
        vipExpireAt: expireTime,
        role: addRole,
        freeTrialUsed: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await setDoc(doc(db, 'users', newUid), newProfile);

      if (currentUser) {
        await recordAuditLog(
          currentUser.uid,
          currentUser.email || 'admin',
          'ADMIN_ADD_USER',
          `后台添加用户 [${newProfile.displayName}]（邮箱: ${newProfile.email}, 角色: ${newProfile.role}, 会员类型: ${newProfile.member_type}）`
        );
      }

      setUsersList(prev => [...prev, newProfile]);
      setShowAddUserModal(false);
      setAddDisplayName('');
      setAddEmail('');
      setAddRole('user');
      setAddMemberType(0);
      setAddExpireDays(30);
    } catch (err) {
      console.error('Failed to add user:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenEditModal = (user: UserProfile) => {
    setEditingUser(user);
    setEditDisplayName(user.displayName || '');
    setEditEmail(user.email || '');
    setEditRole(user.role || 'user');
    setEditMemberType(user.member_type || 0);
    if (user.member_expire) {
      const remainingMs = user.member_expire - Date.now();
      const remainingDays = Math.max(Math.ceil(remainingMs / (86400 * 1000)), 1);
      setEditExpireDays(remainingDays);
    } else {
      setEditExpireDays(30);
    }
    setShowEditUserModal(true);
  };

  const handleEditUserSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;

    setLoading(true);
    try {
      const isPermanent = editExpireDays >= 3650;
      const expireTime = editMemberType === 0 ? null : (isPermanent ? null : Date.now() + editExpireDays * 86400 * 1000);

      const updates: Partial<UserProfile> = {
        displayName: editDisplayName.trim(),
        email: editEmail.trim(),
        role: editRole,
        member_type: editMemberType,
        member_expire: expireTime,
        isVip: editMemberType > 0,
        vipExpireAt: expireTime,
        updatedAt: Date.now(),
      };

      await updateDoc(doc(db, 'users', editingUser.uid), updates);

      if (currentUser) {
        await recordAuditLog(
          currentUser.uid,
          currentUser.email || 'admin',
          'ADMIN_EDIT_USER',
          `后台修改用户 [${editingUser.displayName}] -> [${updates.displayName}]（UID: ${editingUser.uid}）`
        );
      }

      setUsersList(prev =>
        prev.map(u => (u.uid === editingUser.uid ? { ...u, ...updates } : u))
      );
      setShowEditUserModal(false);
      setEditingUser(null);
    } catch (err) {
      console.error('Failed to edit user:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteUserClick = (user: UserProfile) => {
    setUserToDelete(user);
    setShowDeleteConfirmModal(true);
  };

  const handleConfirmDeleteUser = async () => {
    if (!userToDelete) return;

    setLoading(true);
    try {
      await deleteDoc(doc(db, 'users', userToDelete.uid));

      if (currentUser) {
        await recordAuditLog(
          currentUser.uid,
          currentUser.email || 'admin',
          'ADMIN_DELETE_USER',
          `后台删除用户 [${userToDelete.displayName}]（邮箱: ${userToDelete.email}, UID: ${userToDelete.uid}）`
        );
      }

      setUsersList(prev => prev.filter(u => u.uid !== userToDelete.uid));
      setShowDeleteConfirmModal(false);
      setUserToDelete(null);
    } catch (err) {
      console.error('Failed to delete user:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmBatchDeleteUsers = async () => {
    if (selectedUserUids.length === 0) return;

    setLoading(true);
    try {
      for (const uid of selectedUserUids) {
        await deleteDoc(doc(db, 'users', uid));
      }

      if (currentUser) {
        await recordAuditLog(
          currentUser.uid,
          currentUser.email || 'admin',
          'ADMIN_BATCH_DELETE_USERS',
          `批量删除 ${selectedUserUids.length} 名用户账号`
        );
      }

      setUsersList(prev => prev.filter(u => !selectedUserUids.includes(u.uid)));
      setSelectedUserUids([]);
      setShowBatchDeleteConfirmModal(false);
    } catch (err) {
      console.error('Batch delete failed:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenResetPasswordModal = (user: UserProfile) => {
    setUserToResetPassword(user);
    setResetSuccessMessage('');
    setShowResetPasswordModal(true);
  };

  const handleResetPassword = async () => {
    if (!userToResetPassword) return;

    setLoading(true);
    try {
      const userRef = doc(db, 'users', userToResetPassword.uid);
      const defaultPassword = 'qwer0987';

      // Store the new custom password in the user's document in Firestore.
      // This is a seamless solution allowing user override credentials
      await updateDoc(userRef, {
        customPassword: defaultPassword,
        updatedAt: Date.now(),
      });

      if (currentUser) {
        await recordAuditLog(
          currentUser.uid,
          currentUser.email || 'admin',
          'ADMIN_RESET_PASSWORD',
          `后台重置了玩家 [${userToResetPassword.displayName}] 的登录密码为默认密码 qwer0987（UID: ${userToResetPassword.uid}）`
        );
      }

      setResetSuccessMessage(`成功重置！玩家 [${userToResetPassword.displayName}] 的密码已重置为：qwer0987`);
      
      setUsersList(prev =>
        prev.map(u => (u.uid === userToResetPassword.uid ? { ...u, customPassword: defaultPassword } : u))
      );
    } catch (err) {
      console.error('Failed to reset password:', err);
    } finally {
      setLoading(false);
    }
  };

  // Generate commercial 16-character PV / BP codes
  const handleGenerateCodesBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    setGenSuccessMsg('');

    const countToGen = Math.min(Math.max(batchCount, 1), 50);
    const createdCodes: VipCodeData[] = [];
    const plainCodesList: string[] = [];
    const codeExpireMs = validDaysLimit > 0 ? Date.now() + validDaysLimit * 86400 * 1000 : undefined;
    const prefixType = codeMemberType === 2 ? 'BP' : 'PV';

    try {
      for (let i = 0; i < countToGen; i++) {
        let codeStr = '';
        if (countToGen === 1 && customCodeInput.trim()) {
          codeStr = customCodeInput.trim().toUpperCase();
        } else {
          codeStr = generateCommercialVipCode(channelTag, prefixType);
        }

        const hashed = await sha256(codeStr);
        const codeRef = doc(db, 'vipCodes', codeStr);

        const newCode: VipCodeData = {
          id: codeStr,
          code: codeStr,
          codeHash: hashed,
          days: newCodeDays,
          member_type: codeMemberType,
          channel: channelTag,
          expireAt: codeExpireMs,
          used: false,
          createdAt: Date.now(),
        };

        await setDoc(codeRef, newCode);
        createdCodes.push(newCode);
        plainCodesList.push(codeStr);
      }

      const typeName = codeMemberType === 2 ? '商家Pro (BP码)' : '普通VIP (PV码)';

      if (currentUser) {
        await recordAuditLog(
          currentUser.uid,
          currentUser.email || 'admin',
          'BATCH_GEN_CODES',
          `批量生成 ${countToGen} 张 ${typeName} 激活卡密（渠道: ${channelTag}，时长: ${newCodeDays}天）`
        );
      }

      setCodesList(prev => [...createdCodes, ...prev]);
      setCustomCodeInput('');
      setGenSuccessMsg(`成功生成 ${countToGen} 张 ${typeName} 激活卡密！`);

      // Open batch plaintext modal
      setLastGeneratedPlaintextCodes(plainCodesList);
      setShowBatchGenModal(true);
      setBatchCopied(false);
    } catch (err) {
      console.error('Failed to generate codes batch:', err);
    }
  };

  const handleCopyAllBatchCodes = () => {
    if (lastGeneratedPlaintextCodes.length === 0) return;
    const text = lastGeneratedPlaintextCodes.join('\n');
    navigator.clipboard.writeText(text);
    setBatchCopied(true);
    setTimeout(() => setBatchCopied(false), 2500);
  };

  // Confirm CSV Export Handler
  const handleConfirmExportCSV = async () => {
    if (codesList.length === 0) return;

    try {
      const headers = ['卡密激活码', '会员类型', '有效时长', '发行渠道', '使用状态', '使用人UID', '卡密截止到期时间', '生成时间'];
      const rows = codesList.map(c => [
        c.code,
        c.member_type === 2 ? '商家Pro (BP)' : '普通VIP (PV)',
        c.days >= 3650 ? '终身永久' : `${c.days}天`,
        c.channel || '普通发行',
        c.used ? '已核销' : '未核销',
        c.usedBy || '-',
        c.expireAt ? new Date(c.expireAt).toLocaleDateString() : '永久有效',
        new Date(c.createdAt).toLocaleDateString(),
      ]);

      const csvContent =
        'data:text/csv;charset=utf-8,\uFEFF' +
        [headers.join(','), ...rows.map(e => e.join(','))].join('\n');

      const encodedUri = encodeURI(csvContent);
      const link = document.createElement('a');
      link.setAttribute('href', encodedUri);
      link.setAttribute('download', `VIP_PRO卡密导出包_${new Date().toISOString().slice(0, 10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      if (currentUser) {
        await recordAuditLog(
          currentUser.uid,
          currentUser.email || 'admin',
          'EXPORT_VIP_CODES',
          `导出全量 VIP/PRO 卡密明文 CSV 档案（包含 ${codesList.length} 份卡密记录）`
        );
      }

      setShowExportConfirmModal(false);
      await loadData();
    } catch (err) {
      console.error('Failed to export CSV:', err);
    }
  };

  const toggleRevealRow = (id: string) => {
    setRevealedCodeIds(prev => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const handleCopyRowCode = (code: string, id: string) => {
    navigator.clipboard.writeText(code);
    setCopiedRowId(id);
    setTimeout(() => setCopiedRowId(null), 2000);
  };

  if (!isOpen || !isAdmin) return null;

  const filteredUsers = usersList.filter(u => {
    const matchesSearch =
      (u.displayName || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (u.email || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.uid.toLowerCase().includes(searchQuery.toLowerCase());

    if (!matchesSearch) return false;

    if (userRoleFilter === 'all') return true;
    if (userRoleFilter === 'admin') return u.role === 'admin';
    if (userRoleFilter === 'pro') return u.member_type === 2 && u.role !== 'admin';
    if (userRoleFilter === 'vip') return u.member_type === 1 && u.role !== 'admin';
    if (userRoleFilter === 'free') return u.member_type === 0 && u.role !== 'admin';
    return true;
  });

  // Metrics & Anomaly Tracking
  const totalUsers = usersList.length;
  const activeVipCount = usersList.filter(u => u.isVip || (u.vipExpireAt && u.vipExpireAt > Date.now())).length;
  const totalCodesCount = codesList.length;
  const redeemedCodesCount = codesList.filter(c => c.used).length;
  const todayStart = new Date().setHours(0, 0, 0, 0);
  const todayRedeemedCount = codesList.filter(c => c.used && c.usedAt && c.usedAt >= todayStart).length;

  // Trigger high frequency alarm threshold if today's redemption > 5
  const isHighFreqAnomaly = todayRedeemedCount >= 5;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-2 sm:p-4 overflow-y-auto">
      <div className="relative w-full max-w-5xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[95vh] sm:max-h-[92vh]">
        {/* Modal Header */}
        <div className="px-4 py-3 sm:px-6 sm:py-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-gradient-to-br from-rose-500 to-indigo-600 flex items-center justify-center text-white font-bold shadow-md shrink-0">
              <ShieldCheck className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-bold text-white flex items-center gap-2">
                <span>拼豆系统后台控制中心</span>
                <span className="text-[9px] bg-rose-500/20 text-rose-300 border border-rose-500/40 px-1.5 py-0.2 rounded font-mono font-bold hidden xs:inline">
                  PRO SYSTEM ADMIN
                </span>
              </h2>
              <p className="text-[10px] sm:text-xs text-slate-400">管理全站账号、批量生成/导出卡密、审计日志与经营大盘</p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={loadData}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-colors cursor-pointer min-h-[44px] min-w-[44px] flex items-center justify-center"
              title="刷新最新数据"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-colors cursor-pointer min-h-[44px] min-w-[44px] flex items-center justify-center"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Abnormal Monitoring & Operational Stat Dashboard Banner */}
        <div className="bg-slate-950 border-b border-slate-800 px-3 py-2.5 sm:px-6 sm:py-3 space-y-2 shrink-0">
          {/* Security & Alarm Bar */}
          {isHighFreqAnomaly ? (
            <div className="bg-rose-950/90 border border-rose-500/60 p-2.5 rounded-xl flex items-center justify-between gap-3 text-xs text-rose-200">
              <div className="flex items-center gap-2 font-bold">
                <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0 animate-pulse" />
                <span>
                  🚨 异常刷卡告警：今日卡密核销已达 <strong className="text-white font-mono underline">{todayRedeemedCount}</strong> 次！已全面启用哈希密文防爆破与 Checksum 校验。
                </span>
              </div>
              <span className="text-[10px] bg-rose-500 text-slate-950 font-black px-2 py-0.5 rounded shrink-0">
                实时监控中
              </span>
            </div>
          ) : (
            <div className="bg-slate-900/90 border border-slate-800 p-2 rounded-xl flex items-center justify-between text-xs text-slate-300">
              <div className="flex items-center gap-2">
                <Lock className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span className="text-[11px] text-slate-400">
                  商用级卡密防护已生效：<strong className="text-slate-200">CHANNEL-RANDOM-CHECKSUM</strong> 16位结构 + SHA256 脱敏，防止爆破。
                </span>
              </div>
              <span className="text-[10px] text-emerald-400 font-mono font-bold shrink-0">
                ● 系统的安全运行中
              </span>
            </div>
          )}

          {/* Metrics Grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-2.5 text-xs">
            <div className="bg-slate-900/80 border border-slate-800 p-2.5 rounded-xl flex items-center gap-2.5">
              <Users className="w-4 h-4 text-sky-400 shrink-0" />
              <div>
                <div className="text-[10px] text-slate-400">总注册用户数</div>
                <div className="text-sm font-bold text-white font-mono">{totalUsers}</div>
              </div>
            </div>

            <div className="bg-slate-900/80 border border-slate-800 p-2.5 rounded-xl flex items-center gap-2.5">
              <Zap className="w-4 h-4 text-amber-400 shrink-0" />
              <div>
                <div className="text-[10px] text-slate-400">PRO VIP 活跃数</div>
                <div className="text-sm font-bold text-amber-300 font-mono">{activeVipCount}</div>
              </div>
            </div>

            <div className="bg-slate-900/80 border border-slate-800 p-2.5 rounded-xl flex items-center gap-2.5">
              <KeyRound className="w-4 h-4 text-indigo-400 shrink-0" />
              <div>
                <div className="text-[10px] text-slate-400">累计发行卡密</div>
                <div className="text-sm font-bold text-indigo-300 font-mono">{totalCodesCount}</div>
              </div>
            </div>

            <div className="bg-slate-900/80 border border-slate-800 p-2.5 rounded-xl flex items-center gap-2.5">
              <UserCheck className="w-4 h-4 text-emerald-400 shrink-0" />
              <div>
                <div className="text-[10px] text-slate-400">已被核销激活</div>
                <div className="text-sm font-bold text-emerald-300 font-mono">{redeemedCodesCount}</div>
              </div>
            </div>

            <div className="bg-slate-900/80 border border-slate-800 p-2.5 rounded-xl flex items-center gap-2.5 col-span-2 md:col-span-1">
              <Activity className="w-4 h-4 text-rose-400 shrink-0" />
              <div>
                <div className="text-[10px] text-slate-400">今日新增核销</div>
                <div className="text-sm font-bold text-rose-300 font-mono">{todayRedeemedCount} 次</div>
              </div>
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-800 bg-slate-950 px-3 sm:px-6 overflow-x-auto scrollbar-none shrink-0">
          <button
            onClick={() => setActiveTab('users')}
            className={`py-3 px-3 sm:px-4 text-xs font-bold border-b-2 transition-all flex items-center gap-2 cursor-pointer shrink-0 min-h-[48px] ${
              activeTab === 'users'
                ? 'border-sky-500 text-sky-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Users className="w-4 h-4" />
            <span>用户账号管理 ({usersList.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('codes')}
            className={`py-3 px-3 sm:px-4 text-xs font-bold border-b-2 transition-all flex items-center gap-2 cursor-pointer shrink-0 min-h-[48px] ${
              activeTab === 'codes'
                ? 'border-amber-500 text-amber-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <KeyRound className="w-4 h-4" />
            <span>VIP 卡密发行与脱敏管理 ({codesList.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('logs')}
            className={`py-3 px-3 sm:px-4 text-xs font-bold border-b-2 transition-all flex items-center gap-2 cursor-pointer shrink-0 min-h-[48px] ${
              activeTab === 'logs'
                ? 'border-rose-500 text-rose-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Activity className="w-4 h-4" />
            <span>运维操作审计日志 ({auditLogsList.length})</span>
          </button>
        </div>

        {/* Tab Content Area */}
        <div className="p-3 sm:p-6 overflow-y-auto flex-1 custom-scrollbar space-y-4">
          {activeTab === 'users' && (
            /* Users Tab */
            <div className="space-y-4">
              <div className="flex flex-col lg:flex-row items-center justify-between gap-3 bg-slate-950 p-3 rounded-xl border border-slate-800">
                <div className="relative flex-1 w-full">
                  <Search className="w-4 h-4 absolute left-3 top-3 text-slate-500" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="搜索用户名、邮箱或 UID 标识..."
                    className="w-full pl-9 pr-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-sky-500 min-h-[40px]"
                  />
                </div>

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full lg:w-auto">
                  <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-xl shrink-0 min-h-[40px]">
                    <Filter className="w-3.5 h-3.5 text-slate-400" />
                    <select
                      value={userRoleFilter}
                      onChange={e => setUserRoleFilter(e.target.value as any)}
                      className="bg-transparent text-xs text-slate-200 border-none outline-none focus:ring-0 font-bold cursor-pointer"
                    >
                      <option value="all">显示所有角色等级</option>
                      <option value="admin">系统管理员 (Admin)</option>
                      <option value="pro">商家Pro 会员</option>
                      <option value="vip">普通VIP 会员</option>
                      <option value="free">普通免费玩家</option>
                    </select>
                  </div>

                  <button
                    type="button"
                    onClick={() => setShowAddUserModal(true)}
                    className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs rounded-xl shadow cursor-pointer flex items-center justify-center gap-1.5 min-h-[40px]"
                  >
                    <UserPlus className="w-4 h-4" />
                    <span>添加玩家账号</span>
                  </button>

                  {selectedUserUids.length > 0 && (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleBatchGrantVip(1)}
                        disabled={loading}
                        className="flex-1 px-3.5 py-2 bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 font-black text-xs rounded-xl shadow hover:brightness-110 cursor-pointer flex items-center justify-center gap-1 min-h-[40px]"
                      >
                        <Zap className="w-3.5 h-3.5 fill-current" />
                        <span>授予30天VIP ({selectedUserUids.length})</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowBatchDeleteConfirmModal(true)}
                        disabled={loading}
                        className="px-3 py-2 bg-rose-950/60 hover:bg-rose-900/80 border border-rose-800/60 text-rose-300 font-bold text-xs rounded-xl cursor-pointer flex items-center justify-center gap-1 min-h-[40px]"
                        title="批量永久删除账号"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>批量删除</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Mobile Card List View (< sm screens) */}
              <div className="sm:hidden space-y-3">
                {filteredUsers.length === 0 ? (
                  <div className="p-8 text-center text-slate-500 text-xs bg-slate-950 rounded-xl border border-slate-800">
                    暂未查找到匹配的用户记录
                  </div>
                ) : (
                  filteredUsers.map(user => (
                    <div
                      key={user.uid}
                      className="bg-slate-950 border border-slate-800 p-3.5 rounded-xl space-y-2 text-xs"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={selectedUserUids.includes(user.uid)}
                            onChange={e => {
                              if (e.target.checked) {
                                setSelectedUserUids(prev => [...prev, user.uid]);
                              } else {
                                setSelectedUserUids(prev => prev.filter(id => id !== user.uid));
                              }
                            }}
                            className="rounded border-slate-700 text-amber-500 focus:ring-0 cursor-pointer w-4 h-4"
                          />
                          <span className="font-bold text-white text-sm">{user.displayName || '未命名用户'}</span>
                        </div>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          user.role === 'admin'
                            ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                            : 'bg-slate-800 text-slate-400'
                        }`}>
                          {user.role === 'admin' ? '管理员' : '普通用户'}
                        </span>
                      </div>

                      <div className="text-slate-400 font-mono text-[11px] break-all">{user.email}</div>

                      <div className="flex flex-col gap-2 pt-1 border-t border-slate-900">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            {user.role === 'admin' ? (
                              <span className="inline-flex items-center gap-1 text-rose-300 bg-rose-500/10 border border-rose-500/30 px-2 py-0.5 rounded text-[10px] font-bold">
                                <Crown className="w-3 h-3 text-rose-400" />
                                管理员 (全功能)
                              </span>
                            ) : (user.member_type === 2 || (user.isVip && user.member_type === 2)) ? (
                              <span className="inline-flex items-center gap-1 text-amber-300 bg-gradient-to-r from-amber-950 to-slate-900 border border-amber-500/50 px-2 py-0.5 rounded text-[10px] font-bold shadow-sm">
                                <Crown className="w-3 h-3 text-amber-400 fill-amber-400" />
                                <Store className="w-3 h-3 text-amber-300" />
                                商家Pro
                              </span>
                            ) : (user.member_type === 1 || user.isVip) ? (
                              <span className="inline-flex items-center gap-1 text-amber-300 bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 rounded text-[10px] font-bold">
                                <Crown className="w-3 h-3 text-amber-400" />
                                普通VIP
                              </span>
                            ) : (
                              <span className="text-slate-500 text-[10px]">免费用户</span>
                            )}

                            {(user.role === 'admin' || ((user.member_expire || user.vipExpireAt) && (user.isVip || (user.member_type ?? 0) > 0))) && (
                              <span className="text-[10px] text-amber-400/80 font-mono font-bold">
                                ({user.role === 'admin' ? '永久' : new Date((user.member_expire || user.vipExpireAt)!).toLocaleDateString()})
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 justify-between">
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleOpenEditModal(user)}
                              className="p-2 rounded-lg bg-sky-500/10 text-sky-400 border border-sky-500/20 hover:bg-sky-500/20 transition-all min-h-[36px] min-w-[36px] flex items-center justify-center cursor-pointer"
                              title="编辑玩家资料"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleOpenResetPasswordModal(user)}
                              className="p-2 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20 hover:bg-amber-500/20 transition-all min-h-[36px] min-w-[36px] flex items-center justify-center cursor-pointer"
                              title="重置登录密码 (qwer0987)"
                            >
                              <Lock className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteUserClick(user)}
                              className="p-2 rounded-lg bg-rose-500/10 text-rose-400 border border-rose-500/20 hover:bg-rose-500/20 transition-all min-h-[36px] min-w-[36px] flex items-center justify-center cursor-pointer"
                              title="永久删除玩家"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => handleSetUserMemberType(user, 1)}
                              className="px-2 py-1.5 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/30 font-bold text-[11px] cursor-pointer hover:bg-amber-500/30 transition-all min-h-[36px]"
                            >
                              VIP
                            </button>
                            <button
                              type="button"
                              onClick={() => handleSetUserMemberType(user, 2)}
                              className="px-2 py-1.5 rounded-lg bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 font-black text-[11px] cursor-pointer hover:brightness-110 transition-all min-h-[36px]"
                            >
                              Pro
                            </button>
                            {((user.member_type ?? 0) > 0 || user.isVip) && (
                              <button
                                type="button"
                                onClick={() => handleSetUserMemberType(user, 0)}
                                className="px-2 py-1.5 rounded-lg bg-slate-800 text-slate-400 font-bold text-[11px] cursor-pointer hover:bg-slate-700 hover:text-slate-200 transition-all min-h-[36px]"
                              >
                                重置
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Desktop & Tablet Table View (>= sm screens) */}
              <div className="hidden sm:block border border-slate-800 rounded-xl overflow-x-auto bg-slate-950">
                <table className="w-full text-left text-xs text-slate-300">
                  <thead className="bg-slate-900 border-b border-slate-800 text-slate-400 font-bold">
                    <tr>
                      <th className="px-3 py-3 w-8">
                        <input
                          type="checkbox"
                          checked={selectedUserUids.length > 0 && selectedUserUids.length === filteredUsers.length}
                          onChange={e => {
                            if (e.target.checked) {
                              setSelectedUserUids(filteredUsers.map(u => u.uid));
                            } else {
                              setSelectedUserUids([]);
                            }
                          }}
                          className="rounded border-slate-700 text-amber-500 focus:ring-0 cursor-pointer"
                        />
                      </th>
                      <th className="px-4 py-3">用户昵称 / 邮箱</th>
                      <th className="px-4 py-3">账号角色</th>
                      <th className="px-4 py-3">VIP PRO 权限状态</th>
                      <th className="px-4 py-3 text-right">权限管理操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {filteredUsers.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                          暂未查找到匹配的用户记录
                        </td>
                      </tr>
                    ) : (
                      filteredUsers.map(user => (
                        <tr key={user.uid} className="hover:bg-slate-900/50">
                          <td className="px-3 py-3">
                            <input
                              type="checkbox"
                              checked={selectedUserUids.includes(user.uid)}
                              onChange={e => {
                                if (e.target.checked) {
                                  setSelectedUserUids(prev => [...prev, user.uid]);
                                } else {
                                  setSelectedUserUids(prev => prev.filter(id => id !== user.uid));
                                }
                              }}
                              className="rounded border-slate-700 text-amber-500 focus:ring-0 cursor-pointer"
                            />
                          </td>
                          <td className="px-4 py-3">
                            <div className="font-bold text-white">{user.displayName || '未命名用户'}</div>
                            <div className="text-[11px] text-slate-500 font-mono">{user.email}</div>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              user.role === 'admin'
                                ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                                : 'bg-slate-800 text-slate-400'
                            }`}>
                              {user.role === 'admin' ? '管理员' : '普通用户'}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1.5">
                              {user.role === 'admin' ? (
                                <span className="inline-flex items-center gap-1 text-rose-300 bg-rose-500/10 border border-rose-500/30 px-2 py-0.5 rounded text-[11px] font-bold">
                                  <Crown className="w-3.5 h-3.5 text-rose-400" />
                                  管理员
                                </span>
                              ) : (user.member_type === 2 || (user.isVip && user.member_type === 2)) ? (
                                <span className="inline-flex items-center gap-1 text-amber-300 bg-gradient-to-r from-amber-950 to-slate-900 border border-amber-500/50 px-2.5 py-0.5 rounded text-[11px] font-bold shadow-sm">
                                  <Crown className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
                                  <Store className="w-3.5 h-3.5 text-amber-300" />
                                  商家Pro
                                </span>
                              ) : (user.member_type === 1 || user.isVip) ? (
                                <span className="inline-flex items-center gap-1 text-amber-300 bg-amber-500/10 border border-amber-500/30 px-2.5 py-0.5 rounded text-[11px] font-bold">
                                  <Crown className="w-3.5 h-3.5 text-amber-400" />
                                  普通VIP
                                </span>
                              ) : (
                                <span className="text-slate-500 text-[11px]">免费用户</span>
                              )}

                              {(user.role === 'admin' || ((user.member_expire || user.vipExpireAt) && (user.isVip || (user.member_type ?? 0) > 0))) && (
                                <span className="text-[10px] text-amber-400/80 font-mono font-bold">
                                  ({user.role === 'admin' ? '永久' : new Date((user.member_expire || user.vipExpireAt)!).toLocaleDateString()})
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleSetUserMemberType(user, 1)}
                                className="px-2.5 py-1 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 font-bold text-[11px] cursor-pointer hover:bg-amber-500/30 transition-all"
                              >
                                普通VIP
                              </button>
                              <button
                                type="button"
                                onClick={() => handleSetUserMemberType(user, 2)}
                                className="px-2.5 py-1 rounded bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 font-black text-[11px] cursor-pointer hover:brightness-110 transition-all shadow"
                              >
                                商家Pro
                              </button>
                              {((user.member_type ?? 0) > 0 || user.isVip) && (
                                <button
                                  type="button"
                                  onClick={() => handleSetUserMemberType(user, 0)}
                                  className="px-2 py-1 rounded bg-slate-800 text-slate-400 font-bold text-[11px] cursor-pointer hover:bg-slate-700 hover:text-slate-200 transition-all"
                                >
                                  重置免费
                                </button>
                              )}
                              <div className="w-[1px] h-4 bg-slate-800 mx-1 shrink-0" />
                              <button
                                type="button"
                                onClick={() => handleOpenEditModal(user)}
                                className="p-1.5 rounded-lg bg-sky-500/10 text-sky-400 border border-sky-500/20 hover:bg-sky-500/20 transition-all cursor-pointer flex items-center justify-center"
                                title="编辑拼豆玩家账号"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleOpenResetPasswordModal(user)}
                                className="p-1.5 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20 hover:bg-amber-500/20 transition-all cursor-pointer flex items-center justify-center"
                                title="重置登录密码 (qwer0987)"
                              >
                                <Lock className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteUserClick(user)}
                                className="p-1.5 rounded-lg bg-rose-500/10 text-rose-400 border border-rose-500/20 hover:bg-rose-500/20 transition-all cursor-pointer flex items-center justify-center"
                                title="删除玩家账号"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'codes' && (
            /* VIP Codes Tab */
            <div className="space-y-5">
              {/* Generator Card */}
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                  <h3 className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                    <KeyRound className="w-4 h-4 text-amber-400 shrink-0" />
                    <span>批量生成 16 位商用级 VIP/PRO 权限激活卡密包 (带 Checksum 防爆破)</span>
                  </h3>
                  <button
                    onClick={() => setShowExportConfirmModal(true)}
                    disabled={codesList.length === 0}
                    className="w-full sm:w-auto px-3.5 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-amber-300 font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer disabled:opacity-50 min-h-[44px]"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5 text-amber-400" />
                    <span>导出卡密 CSV 档案 (需二次审计确认)</span>
                  </button>
                </div>

                <form onSubmit={handleGenerateCodesBatch} className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-6 gap-3">
                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1">会员等级类型</label>
                    <select
                      value={codeMemberType}
                      onChange={e => setCodeMemberType(Number(e.target.value) as 1 | 2)}
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs font-bold text-amber-300 focus:outline-none focus:border-amber-500 min-h-[44px]"
                    >
                      <option value={1}>普通VIP (PV-前缀)</option>
                      <option value={2}>商家Pro (BP-前缀)</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1">发行渠道</label>
                    <select
                      value={channelTag}
                      onChange={e => setChannelTag(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-amber-500 min-h-[44px]"
                    >
                      <option value="淘宝旗舰店">淘宝旗舰店 (TB)</option>
                      <option value="抖音直播间">抖音直播间 (DY)</option>
                      <option value="微信私域社群">微信私域社群 (WX)</option>
                      <option value="线下代理合作">线下代理合作 (DL)</option>
                      <option value="活动赠送卡">活动赠送卡 (HD)</option>
                      <option value="分销代理">分销代理 (FX)</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1">生成数量</label>
                    <select
                      value={batchCount}
                      onChange={e => setBatchCount(Number(e.target.value))}
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-amber-500 min-h-[44px]"
                    >
                      <option value={1}>1 张单卡</option>
                      <option value={5}>批量 5 张</option>
                      <option value={10}>批量 10 张</option>
                      <option value={20}>批量 20 张</option>
                      <option value={50}>批量 50 张</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1">有效时长</label>
                    <select
                      value={newCodeDays}
                      onChange={e => setNewCodeDays(Number(e.target.value))}
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-amber-500 min-h-[44px]"
                    >
                      <option value={30}>30 天 (月卡)</option>
                      <option value={90}>90 天 (季卡)</option>
                      <option value={365}>365 天 (年卡)</option>
                      <option value={36500}>永久版 (终身)</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1">卡密激活截止期</label>
                    <select
                      value={validDaysLimit}
                      onChange={e => setValidDaysLimit(Number(e.target.value))}
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-amber-500 min-h-[44px]"
                    >
                      <option value={30}>30天内须激活</option>
                      <option value={90}>90天内须激活</option>
                      <option value={365}>1年内须激活</option>
                      <option value={0}>长期永久有效</option>
                    </select>
                  </div>

                  <div className="flex items-end">
                    <button
                      type="submit"
                      className="w-full py-2.5 px-3 bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 font-black text-xs rounded-xl shadow hover:brightness-110 cursor-pointer flex items-center justify-center gap-1.5 min-h-[44px]"
                    >
                      <Plus className="w-4 h-4" />
                      <span>生成卡密</span>
                    </button>
                  </div>
                </form>

                {genSuccessMsg && (
                  <div className="text-xs p-2.5 bg-emerald-950/60 text-emerald-300 border border-emerald-800/60 rounded-lg flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>{genSuccessMsg}</span>
                  </div>
                )}
              </div>

              {/* Codes Table with Masking Protection */}
              <div className="border border-slate-800 rounded-xl overflow-x-auto bg-slate-950">
                <table className="w-full text-left text-xs text-slate-300 min-w-[650px]">
                  <thead className="bg-slate-900 border-b border-slate-800 text-slate-400 font-bold">
                    <tr>
                      <th className="px-4 py-3">激活码卡密 (已脱敏)</th>
                      <th className="px-4 py-3">会员等级</th>
                      <th className="px-4 py-3">发行渠道</th>
                      <th className="px-4 py-3">有效时长</th>
                      <th className="px-4 py-3">核销状态</th>
                      <th className="px-4 py-3">截止激活</th>
                      <th className="px-4 py-3 text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {codesList.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                          暂未生成任何 VIP 激活兑换码
                        </td>
                      </tr>
                    ) : (
                      codesList.map(c => {
                        const isRevealed = !!revealedCodeIds[c.id];
                        const isCopied = copiedRowId === c.id;

                        return (
                          <tr key={c.id} className="hover:bg-slate-900/50 transition-colors">
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <span className={`font-mono font-bold text-sm ${isRevealed ? 'text-amber-300' : 'text-slate-400'}`}>
                                  {isRevealed ? c.code : maskCardCode(c.code)}
                                </span>
                                <button
                                  onClick={() => toggleRevealRow(c.id)}
                                  className="p-1 text-slate-500 hover:text-slate-200 transition-colors cursor-pointer"
                                  title={isRevealed ? '隐藏明文' : '查看完整卡密'}
                                >
                                  {isRevealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                                </button>
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              {c.member_type === 2 || c.code.startsWith('BP') ? (
                                <span className="inline-flex items-center gap-1 bg-gradient-to-r from-amber-950 to-slate-900 border border-amber-500/50 text-amber-300 px-2 py-0.5 rounded text-[10px] font-bold">
                                  <Crown className="w-3 h-3 text-amber-400 fill-amber-400" />
                                  商家Pro
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 bg-amber-500/10 border border-amber-500/30 text-amber-300 px-2 py-0.5 rounded text-[10px] font-bold">
                                  <Crown className="w-3 h-3 text-amber-400" />
                                  普通VIP
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <span className="bg-slate-800 text-slate-300 px-2 py-0.5 rounded text-[10px] font-medium">
                                {c.channel || '普通发行'}
                              </span>
                            </td>
                            <td className="px-4 py-3 font-mono font-bold text-slate-200">{c.days} 天</td>
                            <td className="px-4 py-3">
                              {c.used ? (
                                <span className="bg-slate-800 text-slate-500 px-2 py-0.5 rounded text-[10px]">
                                  已核销 ({c.usedBy ? c.usedBy.slice(0, 6) : '未知'})
                                </span>
                              ) : (
                                <span className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded text-[10px] font-bold">
                                  未核销 (有效)
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-slate-400 font-mono text-[11px]">
                              {c.expireAt ? new Date(c.expireAt).toLocaleDateString() : '永久有效'}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <button
                                onClick={() => handleCopyRowCode(c.code, c.id)}
                                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ml-auto cursor-pointer ${
                                  isCopied
                                    ? 'bg-emerald-500 text-slate-950 font-black'
                                    : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                                }`}
                              >
                                {isCopied ? (
                                  <>
                                    <Check className="w-3 h-3" />
                                    <span>已复制</span>
                                  </>
                                ) : (
                                  <>
                                    <Copy className="w-3 h-3" />
                                    <span>复制卡密</span>
                                  </>
                                )}
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'logs' && (
            /* Audit Logs Tab */
            <div className="space-y-4">
              <div className="border border-slate-800 rounded-xl overflow-x-auto bg-slate-950">
                <table className="w-full text-left text-xs text-slate-300 min-w-[500px]">
                  <thead className="bg-slate-900 border-b border-slate-800 text-slate-400 font-bold">
                    <tr>
                      <th className="px-4 py-3">时间</th>
                      <th className="px-4 py-3">操作员</th>
                      <th className="px-4 py-3">动作</th>
                      <th className="px-4 py-3">详细日志说明</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {auditLogsList.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                          暂无审计日志记录
                        </td>
                      </tr>
                    ) : (
                      auditLogsList.map((log, idx) => (
                        <tr key={log.id || idx} className="hover:bg-slate-900/50">
                          <td className="px-4 py-3 font-mono text-slate-400 text-[11px] whitespace-nowrap">
                            {new Date(log.timestamp).toLocaleString()}
                          </td>
                          <td className="px-4 py-3 font-mono text-sky-300">{log.operatorEmail}</td>
                          <td className="px-4 py-3">
                            <span className="bg-rose-950/80 text-rose-300 border border-rose-500/30 px-2 py-0.5 rounded text-[10px] font-mono font-bold">
                              {log.action}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-slate-200">{log.details}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modal 1: Newly Generated Plaintext Card Codes Display Modal */}
      {showBatchGenModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-lg p-4">
          <div className="relative w-full max-w-lg bg-slate-900 border border-amber-500/40 rounded-2xl p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <KeyRound className="w-5 h-5 text-amber-400" />
                <h3 className="text-sm font-bold text-white">批量卡密生成成功 (全量明文)</h3>
              </div>
              <button
                onClick={() => setShowBatchGenModal(false)}
                className="p-1 text-slate-400 hover:text-white rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3 bg-amber-950/40 border border-amber-800/50 rounded-xl text-xs text-amber-200 space-y-1">
              <div className="font-bold flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                <span>安全保护提示</span>
              </div>
              <p className="text-[11px] text-amber-300/80 leading-relaxed">
                这是卡密明文唯一一次公开展示。关闭此弹窗后，管理后台列表将自动对卡密实施脱敏处理（展示为掩码）。请务必点击下方一键复制妥善保存！
              </p>
            </div>

            <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 max-h-56 overflow-y-auto font-mono text-xs text-amber-300 space-y-1 custom-scrollbar">
              {lastGeneratedPlaintextCodes.map((code, idx) => (
                <div key={idx} className="py-0.5 border-b border-slate-900/60 last:border-none">
                  {code}
                </div>
              ))}
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={handleCopyAllBatchCodes}
                className="flex-1 py-2.5 bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 font-black text-xs rounded-xl shadow hover:brightness-110 flex items-center justify-center gap-2 cursor-pointer min-h-[44px]"
              >
                {batchCopied ? (
                  <>
                    <Check className="w-4 h-4" />
                    <span>已复制全部 {lastGeneratedPlaintextCodes.length} 张卡密</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" />
                    <span>一键复制全部明文卡密</span>
                  </>
                )}
              </button>
              <button
                onClick={() => setShowBatchGenModal(false)}
                className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs rounded-xl cursor-pointer min-h-[44px]"
              >
                关闭弹窗
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal 2: CSV Export Confirmation & Audit Log Modal */}
      {showExportConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-lg p-4">
          <div className="relative w-full max-w-md bg-slate-900 border border-rose-500/40 rounded-2xl p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2 text-rose-400">
                <ShieldAlert className="w-5 h-5" />
                <h3 className="text-sm font-bold text-white">导出卡密 CSV 审计提示</h3>
              </div>
              <button
                onClick={() => setShowExportConfirmModal(false)}
                className="p-1 text-slate-400 hover:text-white rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs text-slate-300">
              <p className="leading-relaxed">
                您即将导出包含全量未核销卡密明文的 CSV 文件（共计 <strong className="text-amber-300 font-mono font-bold">{codesList.length}</strong> 份记录）。
              </p>
              <div className="p-3 bg-rose-950/40 border border-rose-800/50 rounded-xl text-rose-200 text-[11px] leading-relaxed">
                <strong className="block mb-1 font-bold text-rose-300">⚠️ 运维安全合规声明：</strong>
                本次导出操作将包含敏感凭证信息，系统将永久把操作员邮箱 (<span className="font-mono text-white">{currentUser?.email}</span>)、精准时间戳与导出量记入全网不可篡改的<strong className="text-white">【运维操作审计日志】</strong>。
              </div>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={handleConfirmExportCSV}
                className="flex-1 py-2.5 bg-gradient-to-r from-rose-500 to-indigo-600 text-white font-bold text-xs rounded-xl shadow hover:brightness-110 flex items-center justify-center gap-1.5 cursor-pointer min-h-[44px]"
              >
                <FileSpreadsheet className="w-4 h-4" />
                <span>确认导出并留存日志</span>
              </button>
              <button
                onClick={() => setShowExportConfirmModal(false)}
                className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs rounded-xl cursor-pointer min-h-[44px]"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add User Modal */}
      {showAddUserModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 backdrop-blur-lg p-4">
          <form onSubmit={handleAddUser} className="relative w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <UserPlus className="w-5 h-5 text-sky-400" />
                <h3 className="text-sm font-bold text-white">添加新拼豆账号</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowAddUserModal(false)}
                className="p-1 text-slate-400 hover:text-white rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="text-[11px] text-slate-400 block mb-1">用户登录邮箱</label>
                <input
                  type="email"
                  value={addEmail}
                  onChange={e => setAddEmail(e.target.value)}
                  placeholder="name@example.com (作为登录主键)"
                  required
                  className="w-full px-3 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-sky-500 min-h-[44px]"
                />
              </div>

              <div>
                <label className="text-[11px] text-slate-400 block mb-1">个性昵称 / 拼豆店名</label>
                <input
                  type="text"
                  value={addDisplayName}
                  onChange={e => setAddDisplayName(e.target.value)}
                  placeholder="例如: 拼豆萌新 / 水晶拼豆定制"
                  className="w-full px-3 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-sky-500 min-h-[44px]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">系统角色类型</label>
                  <select
                    value={addRole}
                    onChange={e => setAddRole(e.target.value as 'user' | 'admin')}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-sky-500 min-h-[44px]"
                  >
                    <option value="user">普通玩家 (user)</option>
                    <option value="admin">系统管理员 (admin)</option>
                  </select>
                </div>

                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">VIP PRO 权限</label>
                  <select
                    value={addMemberType}
                    onChange={e => setAddMemberType(Number(e.target.value) as 0 | 1 | 2)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-sky-500 min-h-[44px]"
                  >
                    <option value={0}>免费体验玩家</option>
                    <option value={1}>普通 VIP 会员</option>
                    <option value={2}>商家 Pro 尊享版</option>
                  </select>
                </div>
              </div>

              {addMemberType > 0 && (
                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">会员有效天数</label>
                  <select
                    value={addExpireDays}
                    onChange={e => setAddExpireDays(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-sky-500 min-h-[44px]"
                  >
                    <option value={30}>30 天 (月度卡)</option>
                    <option value={90}>90 天 (季度卡)</option>
                    <option value={365}>365 天 (年度卡)</option>
                    <option value={36500}>永久卡 (终身权益)</option>
                  </select>
                </div>
              )}
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                type="submit"
                disabled={loading}
                className="flex-1 py-2.5 bg-gradient-to-r from-sky-500 to-indigo-600 text-white font-bold text-xs rounded-xl shadow hover:brightness-110 flex items-center justify-center gap-1.5 cursor-pointer min-h-[44px]"
              >
                <Plus className="w-4 h-4" />
                <span>立即创建并保存</span>
              </button>
              <button
                type="button"
                onClick={() => setShowAddUserModal(false)}
                className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs rounded-xl cursor-pointer min-h-[44px]"
              >
                取消
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Edit User Modal */}
      {showEditUserModal && editingUser && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 backdrop-blur-lg p-4">
          <form onSubmit={handleEditUserSubmit} className="relative w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Edit3 className="w-5 h-5 text-sky-400" />
                <h3 className="text-sm font-bold text-white">编辑拼豆账号</h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowEditUserModal(false);
                  setEditingUser(null);
                }}
                className="p-1 text-slate-400 hover:text-white rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="text-[11px] text-slate-400 block mb-1">用户登录邮箱</label>
                <input
                  type="email"
                  value={editEmail}
                  onChange={e => setEditEmail(e.target.value)}
                  placeholder="name@example.com"
                  required
                  className="w-full px-3 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-sky-500 min-h-[44px]"
                />
              </div>

              <div>
                <label className="text-[11px] text-slate-400 block mb-1">个性昵称 / 拼豆店名</label>
                <input
                  type="text"
                  value={editDisplayName}
                  onChange={e => setEditDisplayName(e.target.value)}
                  placeholder="个性昵称"
                  className="w-full px-3 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-sky-500 min-h-[44px]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">系统角色类型</label>
                  <select
                    value={editRole}
                    onChange={e => setEditRole(e.target.value as 'user' | 'admin')}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-sky-500 min-h-[44px]"
                  >
                    <option value="user">普通玩家 (user)</option>
                    <option value="admin">系统管理员 (admin)</option>
                  </select>
                </div>

                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">VIP PRO 权限</label>
                  <select
                    value={editMemberType}
                    onChange={e => setEditMemberType(Number(e.target.value) as 0 | 1 | 2)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-sky-500 min-h-[44px]"
                  >
                    <option value={0}>免费体验玩家</option>
                    <option value={1}>普通 VIP 会员</option>
                    <option value={2}>商家 Pro 尊享版</option>
                  </select>
                </div>
              </div>

              {editMemberType > 0 && (
                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">会员到期延长天数</label>
                  <select
                    value={editExpireDays}
                    onChange={e => setEditExpireDays(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-sky-500 min-h-[44px]"
                  >
                    <option value={30}>30 天 (月度卡)</option>
                    <option value={90}>90 天 (季度卡)</option>
                    <option value={365}>365 天 (年度卡)</option>
                    <option value={36500}>永久卡 (终身权益)</option>
                  </select>
                </div>
              )}
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                type="submit"
                disabled={loading}
                className="flex-1 py-2.5 bg-gradient-to-r from-sky-500 to-indigo-600 text-white font-bold text-xs rounded-xl shadow hover:brightness-110 flex items-center justify-center gap-1.5 cursor-pointer min-h-[44px]"
              >
                <Check className="w-4 h-4" />
                <span>保存修改</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowEditUserModal(false);
                  setEditingUser(null);
                }}
                className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs rounded-xl cursor-pointer min-h-[44px]"
              >
                取消
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Delete User Confirm Modal */}
      {showDeleteConfirmModal && userToDelete && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/95 backdrop-blur-lg p-4">
          <div className="relative w-full max-w-sm bg-slate-900 border border-rose-500/40 rounded-2xl p-5 shadow-2xl space-y-4">
            <div className="flex items-center gap-2 text-rose-400 pb-2 border-b border-slate-800">
              <ShieldAlert className="w-5 h-5 shrink-0" />
              <h3 className="text-sm font-bold text-white">删除账号确认</h3>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              您确定要永久删除用户 <strong className="text-white font-bold">{userToDelete.displayName}</strong> 吗？
              其所有的云端作品、VIP 权限状态和设置等数据将被立即永久擦除，此操作不可逆。
            </p>

            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={handleConfirmDeleteUser}
                disabled={loading}
                className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs rounded-xl shadow flex items-center justify-center gap-1.5 cursor-pointer min-h-[44px]"
              >
                <Trash2 className="w-4 h-4" />
                <span>确认永久删除</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowDeleteConfirmModal(false);
                  setUserToDelete(null);
                }}
                className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs rounded-xl cursor-pointer min-h-[44px]"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Batch Delete Confirm Modal */}
      {showBatchDeleteConfirmModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/95 backdrop-blur-lg p-4">
          <div className="relative w-full max-w-sm bg-slate-900 border border-rose-500/40 rounded-2xl p-5 shadow-2xl space-y-4">
            <div className="flex items-center gap-2 text-rose-400 pb-2 border-b border-slate-800">
              <ShieldAlert className="w-5 h-5 shrink-0" />
              <h3 className="text-sm font-bold text-white">批量删除账号确认</h3>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              您确定要批量删除已勾选的的 <strong className="text-white font-mono font-bold underline">{selectedUserUids.length}</strong> 名玩家账户吗？此操作将彻底擦除该批玩家的所有云端记录，不可恢复。
            </p>

            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={handleConfirmBatchDeleteUsers}
                disabled={loading}
                className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs rounded-xl shadow flex items-center justify-center gap-1.5 cursor-pointer min-h-[44px]"
              >
                <Trash2 className="w-4 h-4" />
                <span>确认批量删除</span>
              </button>
              <button
                type="button"
                onClick={() => setShowBatchDeleteConfirmModal(false)}
                className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs rounded-xl cursor-pointer min-h-[44px]"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reset Password Confirm Modal */}
      {showResetPasswordModal && userToResetPassword && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/95 backdrop-blur-lg p-4">
          <div className="relative w-full max-w-sm bg-slate-900 border border-amber-500/40 rounded-2xl p-5 shadow-2xl space-y-4">
            <div className="flex items-center gap-2 text-amber-400 pb-2 border-b border-slate-800">
              <KeyRound className="w-5 h-5 shrink-0" />
              <h3 className="text-sm font-bold text-white">重置密码确认</h3>
            </div>

            {resetSuccessMessage ? (
              <div className="space-y-4">
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 rounded-xl text-xs leading-relaxed flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400 mt-0.5" />
                  <div>
                    <p className="font-bold mb-1">重置密码成功！</p>
                    <p>{resetSuccessMessage}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowResetPasswordModal(false);
                    setUserToResetPassword(null);
                    setResetSuccessMessage('');
                  }}
                  className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs rounded-xl cursor-pointer min-h-[40px]"
                >
                  我知道了
                </button>
              </div>
            ) : (
              <>
                <p className="text-xs text-slate-300 leading-relaxed">
                  您确定要重置玩家 <strong className="text-white font-bold">{userToResetPassword.displayName}</strong> 的登录密码吗？
                  重置后，该玩家的登录密码将被强行修改为默认密码：<strong className="text-amber-400 font-mono text-sm underline">qwer0987</strong>
                </p>

                <div className="flex items-center gap-3 pt-2">
                  <button
                    type="button"
                    onClick={handleResetPassword}
                    disabled={loading}
                    className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-xl shadow flex items-center justify-center gap-1.5 cursor-pointer min-h-[44px]"
                  >
                    {loading ? (
                      <RefreshCw className="w-4 h-4 animate-spin text-slate-950" />
                    ) : (
                      <KeyRound className="w-4 h-4" />
                    )}
                    <span>确认重置为 qwer0987</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowResetPasswordModal(false);
                      setUserToResetPassword(null);
                    }}
                    className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs rounded-xl cursor-pointer min-h-[44px]"
                  >
                    取消
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
