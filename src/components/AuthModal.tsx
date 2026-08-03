import React, { useState } from 'react';
import {
  X,
  User,
  Lock,
  Mail,
  Zap,
  KeyRound,
  CheckCircle2,
  Crown,
  LogOut,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  auth,
  signInWithPopup,
  googleProvider,
  signOut,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
} from '../lib/firebase';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenAdminPanel?: () => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose, onOpenAdminPanel }) => {
  const { currentUser, userProfile, isVip, isAdmin, redeemVipCode } = useAuth();

  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');

  const [redeemCodeInput, setRedeemCodeInput] = useState('');
  const [redeemMsg, setRedeemMsg] = useState<{ text: string; isError: boolean } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [authError, setAuthError] = useState('');

  if (!isOpen) return null;

  const handleGoogleSignIn = async () => {
    setAuthError('');
    setIsSubmitting(true);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err: any) {
      setAuthError(err.message || 'Google 登录失败，请重试');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    if (!email || !password) {
      setAuthError('请完整填写邮箱和密码');
      return;
    }

    setIsSubmitting(true);
    try {
      if (mode === 'signup') {
        const res = await createUserWithEmailAndPassword(auth, email, password);
        if (displayName && res.user) {
          await updateProfile(res.user, { displayName });
        }
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (err: any) {
      let msg = err.message || '登录失败';
      if (err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password') {
        msg = '账号或密码不正确';
      } else if (err.code === 'auth/email-already-in-use') {
        msg = '该邮箱已被注册，请直接登录';
      } else if (err.code === 'auth/weak-password') {
        msg = '密码强度不足，最少6个字符';
      }
      setAuthError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRedeem = async (e: React.FormEvent) => {
    e.preventDefault();
    setRedeemMsg(null);
    if (!redeemCodeInput.trim()) return;

    setIsSubmitting(true);
    const res = await redeemVipCode(redeemCodeInput);
    setIsSubmitting(false);

    setRedeemMsg({ text: res.message, isError: !res.success });
    if (res.success) {
      setRedeemCodeInput('');
    }
  };

  const handleSignOut = async () => {
    await signOut(auth);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
      <div className="relative w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-5 py-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center justify-center font-bold">
              <Crown className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">用户账号与 PRO 智能权限</h3>
              <p className="text-[11px] text-slate-400">登录账号管理个人作品与 VIP 核心算法权限</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-5 custom-scrollbar">
          {currentUser && userProfile ? (
            /* Logged-In Account Info & VIP Manager */
            <div className="space-y-4">
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {userProfile.photoURL ? (
                    <img
                      src={userProfile.photoURL}
                      alt="Avatar"
                      className="w-11 h-11 rounded-full border border-slate-700 object-cover"
                    />
                  ) : (
                    <div className="w-11 h-11 rounded-full bg-gradient-to-tr from-sky-600 to-indigo-600 text-white flex items-center justify-center font-bold text-base">
                      {userProfile.displayName?.[0] || 'U'}
                    </div>
                  )}
                  <div>
                    <div className="font-bold text-white text-sm flex items-center gap-1.5">
                      <span>{userProfile.displayName || '拼豆玩家'}</span>
                      {isAdmin && (
                        <span className="text-[10px] bg-rose-500/20 text-rose-300 border border-rose-500/40 px-1.5 py-0.2 rounded font-bold">
                          管理员
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-400 font-mono">{userProfile.email}</div>
                  </div>
                </div>

                <button
                  onClick={handleSignOut}
                  className="p-2 text-slate-400 hover:text-rose-400 hover:bg-rose-950/30 rounded-lg transition-colors cursor-pointer"
                  title="退出登录"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>

              {/* VIP Status Card */}
              <div className={`p-4 rounded-xl border ${
                isVip
                  ? 'bg-gradient-to-r from-amber-950/60 via-slate-900 to-amber-950/60 border-amber-500/50 text-amber-200'
                  : 'bg-slate-950 border-slate-800 text-slate-300'
              }`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 font-bold text-sm">
                    <Zap className={`w-4 h-4 fill-current ${isVip ? 'text-amber-400' : 'text-slate-500'}`} />
                    <span>{isVip ? 'PRO VIP 会员状态: 已激活' : 'PRO VIP 会员状态: 未激活'}</span>
                  </div>
                  {isVip ? (
                    <span className="text-[10px] bg-amber-500 text-slate-950 font-black px-2 py-0.5 rounded-full">
                      已解锁全部高级功能
                    </span>
                  ) : (
                    <span className="text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full">
                      基础普通账号
                    </span>
                  )}
                </div>

                <p className="text-xs text-slate-400 leading-relaxed">
                  {isVip
                    ? '已为您解锁「VIP 显著性智能抠背景省豆」、「五官高清防模糊锁定」、「边缘精纯去噪点」等全套核心功能。'
                    : '目前处于普通限制模式。获取激活码兑换即可解锁专属智能减少拼豆与精纯优化算法。'}
                </p>

                {isVip && userProfile.vipExpireAt && (
                  <div className="mt-2.5 pt-2 border-t border-amber-500/20 text-[11px] font-mono text-amber-300/80 flex items-center justify-between">
                    <span>VIP 到期时间:</span>
                    <span>{new Date(userProfile.vipExpireAt).toLocaleDateString()}</span>
                  </div>
                )}
              </div>

              {/* Redeem Code Form */}
              <form onSubmit={handleRedeem} className="space-y-2 pt-2">
                <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                  <KeyRound className="w-3.5 h-3.5 text-amber-400" />
                  <span>兑换 VIP 激活码</span>
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={redeemCodeInput}
                    onChange={e => setRedeemCodeInput(e.target.value.toUpperCase())}
                    placeholder="输入 VIP 激活兑换码 (如: VIP-8888)"
                    className="flex-1 px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white uppercase font-mono placeholder:text-slate-600 focus:outline-none focus:border-amber-500"
                  />
                  <button
                    type="submit"
                    disabled={isSubmitting || !redeemCodeInput.trim()}
                    className="px-4 py-2 bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 font-bold text-xs rounded-xl shadow hover:brightness-110 disabled:opacity-50 transition-all cursor-pointer shrink-0"
                  >
                    立即兑换
                  </button>
                </div>
                {redeemMsg && (
                  <div className={`text-xs p-2 rounded-lg ${
                    redeemMsg.isError
                      ? 'bg-rose-950/50 text-rose-300 border border-rose-800/50'
                      : 'bg-emerald-950/50 text-emerald-300 border border-emerald-800/50'
                  }`}>
                    {redeemMsg.text}
                  </div>
                )}
              </form>

              {/* Admin Button if Admin */}
              {isAdmin && onOpenAdminPanel && (
                <div className="pt-2">
                  <button
                    onClick={() => {
                      onClose();
                      onOpenAdminPanel();
                    }}
                    className="w-full py-2.5 px-3 bg-gradient-to-r from-slate-950 via-rose-950 to-slate-950 border border-rose-500/50 hover:brightness-110 text-rose-200 font-bold text-xs rounded-xl flex items-center justify-center gap-2 cursor-pointer transition-all"
                  >
                    <ShieldCheck className="w-4 h-4 text-rose-400" />
                    <span>进入后台系统 (账号管理与生成兑换码)</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            /* Sign In / Sign Up Form */
            <div className="space-y-4">
              {/* Sign in with Google */}
              <button
                onClick={handleGoogleSignIn}
                disabled={isSubmitting}
                className="w-full py-2.5 px-4 bg-slate-950 hover:bg-slate-800/80 border border-slate-700 text-slate-200 font-bold text-xs rounded-xl shadow flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24">
                  <path
                    fill="#EA4335"
                    d="M12 5c1.6 0 3 .6 4.1 1.6l3.1-3.1C17.3 1.7 14.8 1 12 1 7.5 1 3.7 3.6 1.9 7.3l3.7 2.9C6.5 7.1 9 5 12 5z"
                  />
                  <path
                    fill="#4285F4"
                    d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.8-2.4 3.7l3.7 2.9c2.2-2 3.7-5 3.7-8.8z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.6 14.8c-.2-.7-.4-1.5-.4-2.3s.2-1.6.4-2.3L1.9 7.3C.7 9.7 0 12.3 0 15s.7 5.3 1.9 7.7l3.7-2.9z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3 0-5.5-2.1-6.4-5.2L1.9 16C3.7 19.7 7.5 23 12 23z"
                  />
                </svg>
                <span>Google 快捷一键登录</span>
              </button>

              <div className="flex items-center gap-3 text-slate-600 text-xs my-2">
                <div className="h-[1px] bg-slate-800 flex-1" />
                <span>或使用邮箱密码</span>
                <div className="h-[1px] bg-slate-800 flex-1" />
              </div>

              <form onSubmit={handleEmailAuth} className="space-y-3">
                {mode === 'signup' && (
                  <div>
                    <label className="text-[11px] text-slate-400 block mb-1">昵称/姓名</label>
                    <div className="relative">
                      <User className="w-4 h-4 absolute left-3 top-2.5 text-slate-500" />
                      <input
                        type="text"
                        value={displayName}
                        onChange={e => setDisplayName(e.target.value)}
                        placeholder="请输入您的昵称"
                        className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-sky-500"
                      />
                    </div>
                  </div>
                )}

                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">电子邮箱</label>
                  <div className="relative">
                    <Mail className="w-4 h-4 absolute left-3 top-2.5 text-slate-500" />
                    <input
                      type="email"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      placeholder="name@example.com"
                      required
                      className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-sky-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">密码</label>
                  <div className="relative">
                    <Lock className="w-4 h-4 absolute left-3 top-2.5 text-slate-500" />
                    <input
                      type="password"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="至少 6 位密码"
                      required
                      className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-sky-500"
                    />
                  </div>
                </div>

                {authError && (
                  <div className="text-xs p-2 rounded-lg bg-rose-950/50 text-rose-300 border border-rose-800/50">
                    {authError}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-2.5 bg-gradient-to-r from-sky-500 to-indigo-600 text-white font-bold text-xs rounded-xl shadow hover:brightness-110 disabled:opacity-50 transition-all cursor-pointer"
                >
                  {mode === 'signin' ? '登录账号' : '注册新账号'}
                </button>
              </form>

              <div className="text-center text-xs text-slate-400 pt-1">
                {mode === 'signin' ? (
                  <span>
                    还没有账号？{' '}
                    <button
                      onClick={() => {
                        setMode('signup');
                        setAuthError('');
                      }}
                      className="text-sky-400 font-bold hover:underline cursor-pointer"
                    >
                      点击注册
                    </button>
                  </span>
                ) : (
                  <span>
                    已有账号？{' '}
                    <button
                      onClick={() => {
                        setMode('signin');
                        setAuthError('');
                      }}
                      className="text-sky-400 font-bold hover:underline cursor-pointer"
                    >
                      直接登录
                    </button>
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
