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
  Loader2,
  RotateCcw,
  Clock,
  LogOut,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { apiPost as apiPostWithBearer } from '../utils/api';
import { formatChinaDate } from '../utils/dateUtils';
import {
  UserProfile,
  sha256,
  AuditLog,
} from '../lib/accountApi';
import {
  generateCommercialVipCode,
  maskCardCode,
} from '../utils/vipCodeUtils';

interface AdminPanelModalProps {
  isOpen: boolean;
  onClose: () => void;
  standalone?: boolean;
}

type UserRoleFilter = 'all' | 'admin' | 'pro' | 'vip' | 'free';
type AdminAccessState = 'checking' | 'ready' | 'session-required' | 'forbidden' | 'signed-out' | 'unavailable';

interface AdminApiResult<T> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
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
  copied?: boolean; // 标记卡密已被复制发售(黄色字体，不售后)
  deletePendingAt?: number | null; // 标记卡密申请删除时间戳(3天缓冲等待期，期间可撤销)
}

export const AdminPanelModal: React.FC<AdminPanelModalProps> = ({ isOpen, onClose, standalone = false }) => {
  const { currentUser } = useAuth();
  const [activeTab, setActiveTab] = useState<'users' | 'codes' | 'logs'>('users');

  const [usersList, setUsersList] = useState<UserProfile[]>([]);
  const [codesList, setCodesList] = useState<VipCodeData[]>([]);
  const [auditLogsList, setAuditLogsList] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [adminAccessState, setAdminAccessState] = useState<AdminAccessState>('checking');
  const [adminAccessError, setAdminAccessError] = useState<string>('');
  const [trustedDevice, setTrustedDevice] = useState<boolean>(false);
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
  const [isGeneratingCodes, setIsGeneratingCodes] = useState<boolean>(false);

  // Plaintext batch modal state (for initial display right after batch creation)
  const [showBatchGenModal, setShowBatchGenModal] = useState<boolean>(false);
  const [lastGeneratedPlaintextCodes, setLastGeneratedPlaintextCodes] = useState<string[]>([]);
  const [batchCopied, setBatchCopied] = useState<boolean>(false);

  // Table row unmask state. Sale markers are persisted on each code record.
  const [revealedCodeIds, setRevealedCodeIds] = useState<Record<string, boolean>>({});

  // CSV Export confirmation modal state
  const [showExportConfirmModal, setShowExportConfirmModal] = useState<boolean>(false);

  // User CRUD states
  const [userRoleFilter, setUserRoleFilter] = useState<UserRoleFilter>('all');

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
  const [resetMode, setResetMode] = useState<'random' | 'custom'>('random');
  const [resetPasswordInput, setResetPasswordInput] = useState<string>('');
  const [resetPasswordConfirmation, setResetPasswordConfirmation] = useState<string>('');
  const [resetPasswordError, setResetPasswordError] = useState<string>('');
  const [resetTemporaryPassword, setResetTemporaryPassword] = useState<string>('');
  const [resetPasswordCopied, setResetPasswordCopied] = useState<boolean>(false);
  const [showResetPasswordInput, setShowResetPasswordInput] = useState<boolean>(false);

  const clearResetPasswordState = () => {
    setUserToResetPassword(null);
    setResetMode('random');
    setResetPasswordInput('');
    setResetPasswordConfirmation('');
    setResetPasswordError('');
    setResetTemporaryPassword('');
    setResetPasswordCopied(false);
    setShowResetPasswordInput(false);
  };

  const adminRequest = async <T,>(path: string, init: RequestInit = {}): Promise<AdminApiResult<T>> => {
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');
    if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    const response = await fetch(path, { ...init, credentials: 'include', headers });
    const payload: unknown = await response.json().catch(() => null);
    const envelope = payload && typeof payload === 'object' && !Array.isArray(payload)
      ? payload as { success?: unknown; data?: unknown; message?: unknown }
      : null;
    return {
      ok: response.ok && envelope?.success !== false,
      status: response.status,
      data: (envelope && 'data' in envelope ? envelope.data : payload) as T | undefined,
      error: typeof envelope?.message === 'string' ? envelope.message : undefined,
    };
  };

  const adminGet = <T,>(path: string) => adminRequest<T>(path);
  const adminPost = <T,>(path: string, body: unknown) => adminRequest<T>(path, {
    method: 'POST',
    body: JSON.stringify(body),
  });

  const sessionErrorMessage = (result: AdminApiResult<unknown>, fallback: string): string => (
    result.status >= 500
      ? '管理员数据库尚未初始化，请先执行后台数据库迁移。'
      : result.error ?? fallback
  );

  const loadData = async (): Promise<boolean> => {
    setLoading(true);
    try {
      const [usersRes, codesRes, logsRes] = await Promise.all([
        adminGet<UserProfile[]>('/api/admin/users'),
        adminGet<VipCodeData[]>('/api/admin/codes'),
        adminGet<AuditLog[]>('/api/admin/audit-logs'),
      ]);
      const rejected = [usersRes, codesRes, logsRes].find(result => result.status === 401 || result.status === 403);
      if (rejected) {
        setAdminAccessState(rejected.status === 403 ? 'forbidden' : 'session-required');
        setAdminAccessError(
          rejected.status === 403 ? '当前账号没有所需的后台权限。' : '后台会话已失效，请重新建立会话。',
        );
        return false;
      }
      if (!usersRes.ok || !codesRes.ok || !logsRes.ok) {
        const failed = [usersRes, codesRes, logsRes].find(result => !result.ok);
        if (failed?.status && failed.status >= 500) setAdminAccessState('unavailable');
        throw new Error(failed ? sessionErrorMessage(failed, '后台数据加载失败') : '后台数据加载失败');
      }
      const uList = usersRes.data ?? [];
      const cList = codesRes.data ?? [];
      const lList = logsRes.data ?? [];
      setUsersList(uList);
      cList.sort((a, b) => b.createdAt - a.createdAt);
      setCodesList(cList);
      lList.sort((a, b) => b.timestamp - a.timestamp);
      setAuditLogsList(lList);
      setAdminAccessError('');
      return true;
    } catch (err) {
      console.error('Failed to load admin data:', err);
      setAdminAccessError(err instanceof Error ? err.message : '后台数据加载失败，请重试');
      return false;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;

    const checkAdminSession = async () => {
      setAdminAccessState('checking');
      setAdminAccessError('');
      try {
        const sessionResult = await adminGet('/api/admin/session');
        if (cancelled) return;
        if (sessionResult.ok) {
          const loaded = await loadData();
          if (!cancelled && loaded) setAdminAccessState('ready');
          return;
        }
        if (sessionResult.status === 403) {
          setAdminAccessState('forbidden');
          setAdminAccessError('当前账号无管理员权限。');
          return;
        }
        if (sessionResult.status >= 500) {
          setAdminAccessState('unavailable');
          setAdminAccessError('管理员数据库尚未初始化，请先执行后台数据库迁移。');
          return;
        }
        setAdminAccessState(currentUser ? 'session-required' : 'signed-out');
      } catch (error) {
        if (!cancelled) {
          setAdminAccessState('unavailable');
          setAdminAccessError(error instanceof Error ? error.message : '无法连接后台服务。');
        }
      }
    };

    void checkAdminSession();
    return () => { cancelled = true; };
  }, [isOpen, currentUser]);

  const handleCreateAdminSession = async () => {
    if (!currentUser) {
      setAdminAccessState('signed-out');
      return;
    }
    setLoading(true);
    setAdminAccessState('checking');
    setAdminAccessError('');
    const sessionResult = await apiPostWithBearer<{ authenticated: boolean; expiresAt: number }>(
      '/api/admin/session',
      { trustedDevice },
    );
    if (!sessionResult.ok) {
      setAdminAccessState(sessionResult.status === 403 ? 'forbidden' : sessionResult.status >= 500 ? 'unavailable' : 'session-required');
      setAdminAccessError(sessionErrorMessage(sessionResult, '后台会话创建失败，请重新登录后再试。'));
      setLoading(false);
      return;
    }
    const loaded = await loadData();
    if (loaded) setAdminAccessState('ready');
    setLoading(false);
  };

  const recordAdminAudit = async (action: string, details: string) => {
    const result = await adminPost('/api/admin/record-audit-log', {
      operatorUid: currentUser?.uid,
      operatorEmail: currentUser?.email || 'admin',
      action,
      details,
    });
    if (!result.ok) throw new Error(result.error ?? '审计日志写入失败');
  };

  const handleAdminLogout = async () => {
    await adminPost('/api/admin/session/logout', {});
    setAdminAccessState(currentUser ? 'session-required' : 'signed-out');
    setAdminAccessError('');
  };

  const handleAdminClose = () => {
    clearResetPasswordState();
    onClose();
  };

  const handleSetUserMemberType = async (user: UserProfile, targetType: 0 | 1 | 2) => {
    try {
      const isVip = targetType >= 1;
      const isPermanent = targetType > 0 && newCodeDays >= 3650;
      const newExpire = targetType === 0 ? null : (isPermanent ? null : Date.now() + 30 * 86400 * 1000);

      const res = await adminPost('/api/admin/update-user', {
        uid: user.uid,
        updates: {
          member_type: targetType,
          member_expire: newExpire,
          member_source: '管理员手动设置',
          vipExpireAt: newExpire,
        },
      });
      if (!res.ok) throw new Error(res.error ?? '会员状态更新失败');

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
      const res = await adminPost('/api/admin/batch-grant-vip', {
        uids: selectedUserUids,
        targetType,
        days: 30,
      });
      if (!res.ok) throw new Error(res.error ?? '批量授予会员失败');

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

      const res = await adminPost<{ profile: UserProfile; temporaryPassword: string }>(
        '/api/admin/add-user',
        { profile: newProfile },
      );
      if (!res.ok || !res.data) throw new Error(res.error ?? '新增用户失败');
      setUsersList(prev => [...prev, res.data!.profile]);
      window.alert(`用户创建成功，临时密码：${res.data.temporaryPassword}`);
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

      const res = await adminPost('/api/admin/update-user', { uid: editingUser.uid, updates });
      if (!res.ok) throw new Error(res.error ?? '用户更新失败');

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
      const res = await adminPost('/api/admin/delete-users', { uids: [userToDelete.uid] });
      if (!res.ok) throw new Error(res.error ?? '删除用户失败');

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
      const res = await adminPost('/api/admin/delete-users', { uids: selectedUserUids });
      if (!res.ok) throw new Error(res.error ?? '批量删除用户失败');

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
    if (user.uid === currentUser?.uid) return;
    clearResetPasswordState();
    setUserToResetPassword(user);
    setShowResetPasswordModal(true);
  };

  const handleCloseResetPasswordModal = () => {
    setShowResetPasswordModal(false);
    clearResetPasswordState();
  };

  const handleResetModeChange = (mode: 'random' | 'custom') => {
    setResetMode(mode);
    setResetPasswordInput('');
    setResetPasswordConfirmation('');
    setResetPasswordError('');
    setResetTemporaryPassword('');
    setResetPasswordCopied(false);
    setShowResetPasswordInput(false);
  };

  const handleResetPassword = async () => {
    if (!userToResetPassword) return;

    if (userToResetPassword.uid === currentUser?.uid) {
      setResetPasswordError('不能重置当前管理员自己的密码');
      return;
    }

    const customPassword = resetPasswordInput;
    if (resetMode === 'custom') {
      if (customPassword.trim().length < 8 || customPassword.length > 72) {
        setResetPasswordError('指定密码必须为 8-72 个字符且不能为空');
        return;
      }
      if (customPassword !== resetPasswordConfirmation) {
        setResetPasswordError('两次输入的密码不一致');
        return;
      }
    }

    setLoading(true);
    setResetPasswordError('');
    try {
      const result = await adminPost<{ mode: 'random' | 'custom'; temporaryPassword?: string }>('/api/admin/reset-password', {
        uid: userToResetPassword.uid,
        mode: resetMode,
        ...(resetMode === 'custom' ? { password: customPassword } : {}),
      });
      if (!result.ok || !result.data) throw new Error(result.error ?? '密码重置失败');
      if (result.data.mode === 'random' && result.data.temporaryPassword) {
        setResetTemporaryPassword(result.data.temporaryPassword);
      } else {
        setResetPasswordInput('');
        setResetPasswordConfirmation('');
      }
    } catch (err) {
      console.error('Failed to reset password:', err);
      setResetPasswordError(err instanceof Error ? err.message : '密码重置失败');
    } finally {
      setLoading(false);
    }
  };

  const handleCopyTemporaryPassword = async () => {
    if (!resetTemporaryPassword) return;
    try {
      await navigator.clipboard.writeText(resetTemporaryPassword);
      setResetPasswordCopied(true);
    } catch {
      setResetPasswordError('复制失败，请手动记录临时密码');
    }
  };

  // Generate commercial 16-character PV / BP codes
  const handleGenerateCodesBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    setGenSuccessMsg('');
    if (newCodeDays === 7 && codeMemberType !== 1) {
      setGenSuccessMsg('7 天体验卡仅支持普通 VIP，请切换为普通 VIP 后生成。');
      return;
    }
    setIsGeneratingCodes(true);

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

        createdCodes.push(newCode);
        plainCodesList.push(codeStr);
      }

      const typeName = newCodeDays === 7
        ? '7天VIP体验卡 (PV码)'
        : (codeMemberType === 2 ? '商家Pro (BP码)' : '普通VIP (PV码)');
      const logDesc = `批量生成 ${countToGen} 张 ${typeName} 激活卡密（渠道: ${channelTag}，时长: ${newCodeDays}天）`;

      const res = await adminPost('/api/admin/generate-codes', { codes: createdCodes, logDesc });
      if (!res.ok) throw new Error(res.error ?? '卡密生成失败');

      setCodesList(prev => [...createdCodes, ...prev]);
      setCustomCodeInput('');
      setGenSuccessMsg(`成功生成 ${countToGen} 张 ${typeName} 激活卡密！`);

      // Open batch plaintext modal
      setLastGeneratedPlaintextCodes(plainCodesList);
      setShowBatchGenModal(true);
      setBatchCopied(false);
    } catch (err) {
      console.error('Failed to generate codes batch:', err);
    } finally {
      setIsGeneratingCodes(false);
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
        c.expireAt ? formatChinaDate(c.expireAt, false) : '永久有效',
        formatChinaDate(c.createdAt, false),
      ]);

      const csvContent =
        'data:text/csv;charset=utf-8,\uFEFF' +
        [headers.join(','), ...rows.map(e => e.join(','))].join('\n');

      const encodedUri = encodeURI(csvContent);
      const link = document.createElement('a');
      link.setAttribute('href', encodedUri);
      link.setAttribute('download', `VIP_PRO卡密导出包_${formatChinaDate(Date.now(), false).replace(/\//g, '')}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      if (currentUser) {
        await recordAdminAudit('EXPORT_VIP_CODES', `导出全量 VIP/PRO 卡密明文 CSV 档案（包含 ${codesList.length} 份卡密记录）`);
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

  const codeKey = (code: VipCodeData): string => code.id || code.code;

  // Toggle copied / after-sales status (yellow font toggle)
  const handleToggleCopiedState = async (c: VipCodeData) => {
    const id = codeKey(c);
    const newCopied = !c.copied;
    setCodesList(prev =>
      prev.map(item => (codeKey(item) === id ? { ...item, copied: newCopied } : item))
    );

    try {
      const res = await adminPost('/api/admin/update-code', {
        codeId: id,
        updates: { copied: newCopied },
        operatorUid: currentUser?.uid,
        operatorEmail: currentUser?.email || 'admin',
      });
      if (!res.ok) {
        throw new Error(res.error || 'Server update failed');
      }
    } catch (err) {
      console.error('Server code status update failed:', err);
      setCodesList(prev =>
        prev.map(item => (codeKey(item) === id ? { ...item, copied: c.copied } : item))
      );
    }
  };

  // Copy code to clipboard AND mark as copied (yellow font)
  const handleCopyRowCode = async (c: VipCodeData) => {
    const id = codeKey(c);
    try {
      await navigator.clipboard.writeText(c.code);
    } catch {
      console.error('Failed to copy VIP code to clipboard');
      return;
    }

    if (!c.copied) {
      setCodesList(prev =>
        prev.map(item => (codeKey(item) === id ? { ...item, copied: true } : item))
      );

      try {
        const res = await adminPost('/api/admin/update-code', {
          codeId: id,
          updates: { copied: true },
          operatorUid: currentUser?.uid,
          operatorEmail: currentUser?.email || 'admin',
        });
        if (!res.ok) {
          throw new Error(res.error || 'Server update failed');
        }
      } catch (err) {
        console.error('Server code update failed:', err);
        setCodesList(prev =>
          prev.map(item => (codeKey(item) === id ? { ...item, copied: false } : item))
        );
      }
    }
  };

  // Initiate 3-day deletion countdown
  const handleRequestDeleteCode = async (c: VipCodeData) => {
    const deleteTime = Date.now() + 3 * 24 * 60 * 60 * 1000; // 3 days buffer
    setCodesList(prev =>
      prev.map(item => (item.id === c.id ? { ...item, deletePendingAt: deleteTime } : item))
    );

    try {
      const res = await adminPost('/api/admin/update-code', {
        codeId: c.id,
        updates: { deletePendingAt: deleteTime },
        operatorUid: currentUser?.uid,
        operatorEmail: currentUser?.email || 'admin',
      });

      if (!res.ok) {
        throw new Error(res.error || 'Server delete request failed');
      }

      if (currentUser) {
        await recordAdminAudit('DELETE_VIP_CODE_PENDING', `申请删除卡密 [${c.code}]，卡密进入 3 天等待销毁期`);
      }
    } catch (err) {
      console.error('Server delete request failed:', err);
      setCodesList(prev =>
        prev.map(item => (item.id === c.id ? { ...item, deletePendingAt: c.deletePendingAt } : item))
      );
    }
  };

  // Cancel deletion request
  const handleCancelDeleteCode = async (c: VipCodeData) => {
    setCodesList(prev =>
      prev.map(item => (item.id === c.id ? { ...item, deletePendingAt: null } : item))
    );

    try {
      const res = await adminPost('/api/admin/update-code', {
        codeId: c.id,
        updates: { deletePendingAt: null },
        operatorUid: currentUser?.uid,
        operatorEmail: currentUser?.email || 'admin',
      });

      if (!res.ok) {
        throw new Error(res.error || 'Server cancel delete failed');
      }

      if (currentUser) {
        await recordAdminAudit('CANCEL_DELETE_VIP_CODE', `撤销了卡密 [${c.code}] 的删除申请，卡密已恢复正常有效状态`);
      }
    } catch (err) {
      console.error('Server cancel delete failed:', err);
      setCodesList(prev =>
        prev.map(item => (item.id === c.id ? { ...item, deletePendingAt: c.deletePendingAt } : item))
      );
    }
  };

  if (!isOpen) return null;

  if (adminAccessState !== 'ready') {
    return (
      <div className={standalone ? 'min-h-screen flex items-center justify-center bg-slate-950 p-4' : 'fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4'}>
        <div className="relative w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden">
          <div className="px-5 py-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-rose-500 to-indigo-600 flex items-center justify-center text-white shadow-md">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-white">后台控制中心</h2>
                <p className="text-xs text-slate-400">
                  {adminAccessState === 'checking' && '正在验证后台会话'}
                  {adminAccessState === 'session-required' && '使用当前正式登录账号进入'}
                  {adminAccessState === 'forbidden' && '当前账号无后台访问权限'}
                  {adminAccessState === 'signed-out' && '请先登录正式账号'}
                  {adminAccessState === 'unavailable' && '后台服务暂不可用'}
                </p>
              </div>
            </div>
            <button
              onClick={handleAdminClose}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-colors cursor-pointer min-h-[44px] min-w-[44px] flex items-center justify-center"
              aria-label="关闭后台"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-5 space-y-4">
            {adminAccessState === 'checking' && (
              <div className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-sm text-slate-300">
                <Loader2 className="h-4 w-4 animate-spin text-indigo-400" />
                <span>正在验证账号权限...</span>
              </div>
            )}
            {adminAccessError && (
              <div className="flex items-start gap-2 rounded-xl border border-rose-500/40 bg-rose-950/40 px-3 py-2 text-sm text-rose-200" role="alert">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
                <span>{adminAccessError}</span>
              </div>
            )}
            {adminAccessState === 'session-required' && (
              <>
                <label className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-sm text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={trustedDevice}
                    onChange={event => setTrustedDevice(event.target.checked)}
                    className="h-4 w-4 accent-indigo-500"
                  />
                  <span>信任此设备 30 天</span>
                </label>
                <button
                  type="button"
                  onClick={() => void handleCreateAdminSession()}
                  disabled={loading}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                  {loading ? '正在进入...' : '进入后台'}
                </button>
              </>
            )}
            <button
              type="button"
              onClick={handleAdminClose}
              className="w-full rounded-xl border border-slate-700 px-4 py-2.5 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-800"
            >
              返回
            </button>
          </div>
        </div>
      </div>
    );
  }

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
    <div className={standalone
      ? 'min-h-screen bg-[radial-gradient(circle_at_top,#111d35_0%,#070b18_48%,#040711_100%)] px-3 py-4 sm:px-5 sm:py-6 lg:px-8 lg:py-8 overflow-y-auto'
      : 'fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-2 sm:p-4 overflow-y-auto'}>
      <div className={standalone
        ? 'relative mx-auto flex min-h-[calc(100vh-2rem)] w-full max-w-[1600px] flex-col overflow-hidden rounded-2xl border border-slate-700/80 bg-slate-900/95 shadow-[0_24px_80px_rgba(0,0,0,0.42)] lg:min-h-[calc(100vh-4rem)]'
        : 'relative w-full max-w-5xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[95vh] sm:max-h-[92vh]'}>
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
              onClick={() => void handleAdminLogout()}
              className="p-2 text-slate-400 hover:text-rose-300 hover:bg-slate-800 rounded-xl transition-colors cursor-pointer min-h-[44px] min-w-[44px] flex items-center justify-center"
              title="退出后台会话"
              aria-label="退出后台会话"
            >
              <LogOut className="w-4 h-4" />
            </button>
            <button
              onClick={handleAdminClose}
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
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 custom-scrollbar space-y-5">
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
                      onChange={e => setUserRoleFilter(e.target.value as UserRoleFilter)}
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
                {loading ? (
                  <div className="p-8 text-center text-slate-300 text-xs bg-slate-950 rounded-xl border border-slate-800 flex flex-col items-center justify-center gap-2">
                    <Loader2 className="w-6 h-6 text-sky-400 animate-spin" />
                    <span className="font-bold">✨ 正在同步玩家账号与权限列表...</span>
                  </div>
                ) : filteredUsers.length === 0 ? (
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
                                ({user.role === 'admin' ? '永久' : formatChinaDate(user.member_expire || user.vipExpireAt, false)})
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
                              disabled={user.uid === currentUser?.uid}
                              className="p-2 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20 hover:bg-amber-500/20 transition-all min-h-[36px] min-w-[36px] flex items-center justify-center cursor-pointer"
                              title={user.uid === currentUser?.uid ? '不能重置当前管理员自己的密码' : '重置密码'}
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
              <div className="hidden sm:block overflow-x-auto rounded-xl border border-slate-800 bg-slate-950">
                <table className="w-full min-w-[980px] text-left text-xs text-slate-300">
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
                    {loading ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-12 text-center text-slate-300">
                          <div className="flex flex-col items-center justify-center gap-2">
                            <Loader2 className="w-7 h-7 text-sky-400 animate-spin" />
                            <span className="font-bold text-xs">✨ 正在从服务器安全同步玩家账号与权限数据...</span>
                          </div>
                        </td>
                      </tr>
                    ) : filteredUsers.length === 0 ? (
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
                                  ({user.role === 'admin' ? '永久' : formatChinaDate(user.member_expire || user.vipExpireAt, false)})
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
                                disabled={user.uid === currentUser?.uid}
                                className="p-1.5 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20 hover:bg-amber-500/20 transition-all cursor-pointer flex items-center justify-center"
                                title={user.uid === currentUser?.uid ? '不能重置当前管理员自己的密码' : '重置密码'}
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
                      <option value={7}>7 天 VIP 体验卡</option>
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
                      disabled={isGeneratingCodes}
                      className="w-full py-2.5 px-3 bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 font-black text-xs rounded-xl shadow hover:brightness-110 disabled:opacity-50 cursor-pointer flex items-center justify-center gap-1.5 min-h-[44px]"
                    >
                      {isGeneratingCodes ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin text-slate-950" />
                          <span>正在生成卡密...</span>
                        </>
                      ) : (
                        <>
                          <Plus className="w-4 h-4" />
                          <span>生成卡密</span>
                        </>
                      )}
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
                <table className="w-full text-left text-xs text-slate-300 min-w-[720px]">
                  <thead className="bg-slate-900 border-b border-slate-800 text-slate-400 font-bold">
                    <tr>
                      <th className="px-4 py-3">激活码卡密 (点击文字切换黄色标记)</th>
                      <th className="px-4 py-3">会员等级</th>
                      <th className="px-4 py-3">发行渠道</th>
                      <th className="px-4 py-3">有效时长</th>
                      <th className="px-4 py-3">核销与销毁状态</th>
                      <th className="px-4 py-3">截止激活</th>
                      <th className="px-4 py-3 text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {loading ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-12 text-center text-slate-300">
                          <div className="flex flex-col items-center justify-center gap-2">
                            <Loader2 className="w-7 h-7 text-amber-400 animate-spin" />
                            <span className="font-bold text-xs">✨ 正在加载与脱敏卡密数据...</span>
                          </div>
                        </td>
                      </tr>
                    ) : codesList.filter(c => !c.deletePendingAt || c.deletePendingAt > Date.now()).length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                          暂未生成任何 VIP 激活兑换码
                        </td>
                      </tr>
                    ) : (
                      codesList
                        .filter(c => !c.deletePendingAt || c.deletePendingAt > Date.now())
                        .map(c => {
                          const id = codeKey(c);
                          const isRevealed = !!revealedCodeIds[id];
                          const isCopied = Boolean(c.copied);
                          const isPendingDelete = !!(c.deletePendingAt && c.deletePendingAt > Date.now());

                          // Calculate remaining time for deletion
                          let deleteTimeStr = '';
                          if (isPendingDelete && c.deletePendingAt) {
                            const diffMs = c.deletePendingAt - Date.now();
                            const days = Math.floor(diffMs / (86400 * 1000));
                            const hours = Math.floor((diffMs % (86400 * 1000)) / (3600 * 1000));
                            deleteTimeStr = days > 0 ? `剩 ${days} 天 ${hours} 小时` : `剩 ${Math.max(1, hours)} 小时`;
                          }

                          return (
                            <tr key={id} className="hover:bg-slate-900/50 transition-colors">
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2">
                                  <span
                                    onClick={() => handleToggleCopiedState(c)}
                                    className={`font-mono font-bold text-sm cursor-pointer transition-all ${
                                      c.copied
                                        ? 'text-amber-400 font-extrabold drop-shadow-xs'
                                        : isRevealed
                                        ? 'text-amber-300'
                                        : 'text-slate-400 hover:text-slate-200'
                                    }`}
                                    title={
                                      c.copied
                                        ? '该卡密已复制发售（黄色标记：不售后）。点击文字可恢复普通字体'
                                        : '点击卡密文字可手动标记为黄色（已发售/不售后）'
                                    }
                                  >
                                    {isRevealed ? c.code : maskCardCode(c.code)}
                                  </span>
                                  {c.copied && (
                                    <span className="text-[9px] bg-amber-500/20 text-amber-300 border border-amber-500/40 px-1.5 py-0.2 rounded font-bold shrink-0">
                                      已发售/不售后
                                    </span>
                                  )}
                                  <button
                                    onClick={() => toggleRevealRow(id)}
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
                                {isPendingDelete ? (
                                  <span className="inline-flex items-center gap-1 bg-rose-950/80 text-rose-300 border border-rose-500/50 px-2 py-0.5 rounded text-[10px] font-bold animate-pulse">
                                    <Clock className="w-3 h-3 text-rose-400 shrink-0" />
                                    <span>待销毁 ({deleteTimeStr})</span>
                                  </span>
                                ) : c.used ? (
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
                                {c.expireAt ? formatChinaDate(c.expireAt, false) : '永久有效'}
                              </td>
                              <td className="px-4 py-3 text-right">
                                <div className="flex items-center justify-end gap-1.5">
                                  {isPendingDelete ? (
                                    <button
                                      onClick={() => handleCancelDeleteCode(c)}
                                      className="px-2.5 py-1 rounded-lg text-xs font-bold transition-all bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 flex items-center gap-1 cursor-pointer"
                                      title="撤销删除请求，恢复正常有效卡密"
                                    >
                                      <RotateCcw className="w-3 h-3" />
                                      <span>取消删除</span>
                                    </button>
                                  ) : (
                                    <>
                                      <button
                                        onClick={() => handleCopyRowCode(c)}
                                        className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
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
                                      <button
                                        onClick={() => handleRequestDeleteCode(c)}
                                        className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-950/40 border border-transparent hover:border-rose-800/50 transition-all cursor-pointer shrink-0"
                                        title="申请删除卡密（系统将提供 3 天等待缓冲区，期满自动彻底销毁，期间支持随时撤销）"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    </>
                                  )}
                                </div>
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
                    {loading ? (
                      <tr>
                        <td colSpan={4} className="px-4 py-12 text-center text-slate-300">
                          <div className="flex flex-col items-center justify-center gap-2">
                            <Loader2 className="w-7 h-7 text-rose-400 animate-spin" />
                            <span className="font-bold text-xs">✨ 正在同步运维操作审计日志...</span>
                          </div>
                        </td>
                      </tr>
                    ) : auditLogsList.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                          暂无审计日志记录
                        </td>
                      </tr>
                    ) : (
                      auditLogsList.map((log, idx) => (
                        <tr key={log.id || idx} className="hover:bg-slate-900/50">
                          <td className="px-4 py-3 font-mono text-slate-400 text-[11px] whitespace-nowrap">
                            {formatChinaDate(log.timestamp, true)}
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

            {resetTemporaryPassword ? (
              <div className="space-y-4">
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 rounded-xl text-xs leading-relaxed flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400 mt-0.5" />
                  <div>
                    <p className="font-bold mb-1">重置密码成功！</p>
                    <p>请立即记录并安全转交给 {userToResetPassword.displayName}。关闭后将不再显示。</p>
                    <div className="mt-2 flex items-center gap-2">
                      <code className="min-w-0 flex-1 break-all rounded-lg bg-slate-950 px-2 py-1.5 text-amber-200">{resetTemporaryPassword}</code>
                      <button
                        type="button"
                        onClick={handleCopyTemporaryPassword}
                        className="shrink-0 p-2 text-amber-300 hover:text-amber-200 rounded-lg cursor-pointer"
                        title="复制临时密码"
                        aria-label="复制临时密码"
                      >
                        {resetPasswordCopied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleCloseResetPasswordModal}
                  className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs rounded-xl cursor-pointer min-h-[40px]"
                >
                  关闭并清除临时密码
                </button>
              </div>
            ) : (
              <>
                <p className="text-xs text-slate-300 leading-relaxed">
                  为玩家 <strong className="text-white font-bold">{userToResetPassword.displayName}</strong> 重置登录密码。
                </p>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => handleResetModeChange('random')}
                    className={`min-h-[52px] rounded-xl border px-3 py-2 text-left text-xs cursor-pointer ${resetMode === 'random' ? 'border-amber-400 bg-amber-500/15 text-amber-200' : 'border-slate-700 bg-slate-950 text-slate-300'}`}
                  >
                    <span className="block font-bold">随机临时密码</span>
                    <span className="text-[10px] opacity-80">系统生成，仅显示一次</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleResetModeChange('custom')}
                    className={`min-h-[52px] rounded-xl border px-3 py-2 text-left text-xs cursor-pointer ${resetMode === 'custom' ? 'border-amber-400 bg-amber-500/15 text-amber-200' : 'border-slate-700 bg-slate-950 text-slate-300'}`}
                  >
                    <span className="block font-bold">指定新密码</span>
                    <span className="text-[10px] opacity-80">管理员设置，成功后不回显</span>
                  </button>
                </div>

                {resetMode === 'custom' && (
                  <div className="space-y-3">
                    <div>
                      <label className="mb-1 block text-[11px] text-slate-400">指定新密码（8-72 个字符）</label>
                      <div className="relative">
                        <input
                          type={showResetPasswordInput ? 'text' : 'password'}
                          value={resetPasswordInput}
                          onChange={event => setResetPasswordInput(event.target.value)}
                          autoComplete="new-password"
                          maxLength={72}
                          className="w-full min-h-[44px] rounded-xl border border-slate-700 bg-slate-950 px-3 pr-10 text-xs text-white focus:border-amber-400 focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => setShowResetPasswordInput(value => !value)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-white cursor-pointer"
                          title={showResetPasswordInput ? '隐藏密码' : '显示密码'}
                          aria-label={showResetPasswordInput ? '隐藏密码' : '显示密码'}
                        >
                          {showResetPasswordInput ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] text-slate-400">确认新密码</label>
                      <input
                        type={showResetPasswordInput ? 'text' : 'password'}
                        value={resetPasswordConfirmation}
                        onChange={event => setResetPasswordConfirmation(event.target.value)}
                        autoComplete="new-password"
                        maxLength={72}
                        className="w-full min-h-[44px] rounded-xl border border-slate-700 bg-slate-950 px-3 text-xs text-white focus:border-amber-400 focus:outline-none"
                      />
                    </div>
                  </div>
                )}

                {resetPasswordError && (
                  <p role="alert" className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{resetPasswordError}</p>
                )}

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
                    <span>{resetMode === 'random' ? `为 ${userToResetPassword.displayName} 生成临时密码` : `确认将 ${userToResetPassword.displayName} 的密码改为指定密码`}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleCloseResetPasswordModal}
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
