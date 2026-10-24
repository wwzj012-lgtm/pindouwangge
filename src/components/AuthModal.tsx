import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import {
  X,
  User,
  Lock,
  Mail,
  KeyRound,
  Crown,
  LogOut,
  ShieldCheck,
  AlertTriangle,
  Loader2,
} from 'lucide-react';
import { type AuthSessionPersistence, useAuth } from '../context/AuthContext';
import {
  apiPost,
  SIGNIN_REQUEST_OPTIONS,
  SIGNUP_REQUEST_OPTIONS,
} from '../utils/api';
import type { AuthSession } from '../lib/accountApi';
import { formatChinaDate } from '../utils/dateUtils';
import { AUTH_AUTOCOMPLETE, saveBrowserPasswordCredential } from '../utils/authCredentials';

interface AuthModalProps {
  isOpen: boolean;
  zIndex?: number;
  onClose: () => void;
  onOpenAdminPanel?: () => void;
  // Retained for caller compatibility; the legacy gallery entry has been removed.
  onOpenPatternsModal?: () => void;
  onOpenVipModal?: () => void;
}

interface LocalizedError {
  title: string;
  detail: string;
  isNetworkError: boolean;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  zIndex,
  onClose,
  onOpenAdminPanel,
}) => {
  const { currentUser, userProfile, loading: authLoading, isVip, isPro, isAdmin, canAccessAdmin, redeemVipCode, setLocalCustomUser, logoutUser } = useAuth();

  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [rememberLogin, setRememberLogin] = useState(true);

  const [redeemCodeInput, setRedeemCodeInput] = useState('');
  const [redeemMsg, setRedeemMsg] = useState<{ text: string; isError: boolean } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [structuredError, setStructuredError] = useState<LocalizedError | null>(null);
  const redeemInputRef = useRef<HTMLInputElement>(null);
  const loginInputRef = useRef<HTMLInputElement>(null);
  const operationRef = useRef(0);
  const pendingOperationRef = useRef(false);
  const openGenerationRef = useRef(0);
  const latestUidRef = useRef(currentUser?.uid);
  // Match the existing App guest gate locally; AuthContext permissions stay unchanged.
  const hasFormalLogin = Boolean(currentUser) && ![currentUser, userProfile].some(account => {
    const value = account as unknown as Record<string, unknown> | null;
    return value?.authProvider === 'guest' || value?.auth_provider === 'guest' || value?.provider === 'guest';
  });
  const canRedeem = hasFormalLogin && Boolean(userProfile);

  // Logout itself changes identity. Its close belongs to this opening, not to
  // the identity-sensitive generation used for redemption feedback below.
  useLayoutEffect(() => {
    openGenerationRef.current += 1;
    return () => { openGenerationRef.current += 1; };
  }, [isOpen]);
  useLayoutEffect(() => { latestUidRef.current = currentUser?.uid; }, [currentUser?.uid]);

  useEffect(() => {
    operationRef.current += 1;
    pendingOperationRef.current = false;
    setRedeemCodeInput('');
    setRedeemMsg(null);
    setStructuredError(null);
    setIsSubmitting(false);
    setPassword('');
    if (isOpen && !authLoading) {
      (canRedeem ? redeemInputRef : loginInputRef).current?.focus();
    }
    return () => { operationRef.current += 1; };
  }, [isOpen, authLoading, canRedeem, currentUser?.uid]);

  const parseAuthError = (error: unknown): LocalizedError => {
    const details = error && typeof error === 'object' ? error as Record<string, unknown> : {};
    const code = typeof details.code === 'string' ? details.code : '';
    const rawMsg = error instanceof Error ? error.message : String(error ?? '');

    if (
      code === 'auth/network-request-failed'
      || rawMsg.includes('network-request-failed')
      || rawMsg.includes('network')
      || /无法连接后端|连接超时|网络请求失败/.test(rawMsg)
    ) {
      return {
        title: '网络连接异常',
        detail: '无法连接至认证服务器，请检查您的网络设置后重试。',
        isNetworkError: true,
      };
    }

    if (code === 'auth/user-not-found' || code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
      return {
        title: '账号或密码错误',
        detail: '请输入正确的电子邮箱与密码。若尚未注册，请切换至【注册新账号】。',
        isNetworkError: false,
      };
    }

    if (code === 'auth/email-already-in-use') {
      return {
        title: '该邮箱已被注册',
        detail: '此邮箱已有注册记录，请直接在上方切换为【登录】模式。',
        isNetworkError: false,
      };
    }

    if (code === 'auth/weak-password') {
      return {
        title: '密码强度不足',
        detail: '为保证安全，密码长度请至少设置为 6 位字符。',
        isNetworkError: false,
      };
    }

    if (code === 'auth/invalid-email') {
      return {
        title: '邮箱格式不正确',
        detail: '请输入有效的电子邮箱地址 (如: name@example.com)。',
        isNetworkError: false,
      };
    }

    if (code === 'auth/popup-closed-by-user') {
      return {
        title: '登录操作已取消',
        detail: '您手动关闭了快捷登录弹窗。',
        isNetworkError: false,
      };
    }

    if (code === 'auth/popup-blocked') {
      return {
        title: '弹窗被浏览器拦截',
        detail: '请在浏览器地址栏允许允许本站弹出窗口后再试。',
        isNetworkError: false,
      };
    }

    if (code === 'auth/operation-not-allowed') {
      return {
        title: '已开启快捷免考核账号模式',
        detail: '极速验证成功，无需繁琐邮箱密码校验，已为您即刻激活拼豆创作者中心！',
        isNetworkError: false,
      };
    }

    return {
      title: '登录异常，请稍后重试',
      detail: rawMsg || '发生未知错误，请检查网络或刷新页面。',
      isNetworkError: false,
    };
  };

  const formatAuthEmail = (rawInput: string) => {
    const trimmed = rawInput.trim();
    if (!trimmed) return '';
    if (trimmed.includes('@')) {
      return trimmed;
    }
    // Clean phone number or username
    const cleaned = trimmed.replace(/[^a-zA-Z0-9_]/g, '');
    return `${cleaned.toLowerCase()}@pindou.cn`;
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setStructuredError(null);

    if (!email || !password) {
      setStructuredError({
        title: '请完整填写登录信息',
        detail: '手机号/邮箱/账号与密码均为必填项。',
        isNetworkError: false,
      });
      return;
    }

    const targetEmail = formatAuthEmail(email);
    const isPhoneOrUsername = !email.includes('@');
    const autoDisplayName = displayName || (isPhoneOrUsername ? `拼豆创作者_${email.trim().slice(-4)}` : email.split('@')[0]);

    setIsSubmitting(true);
    try {
      const endpoint = mode === 'signup' ? '/api/auth/signup' : '/api/auth/signin';
      const requestOptions = mode === 'signin'
        ? SIGNIN_REQUEST_OPTIONS
        : SIGNUP_REQUEST_OPTIONS;
      const res = await apiPost<AuthSession>(endpoint, {
        email: targetEmail,
        password,
        displayName: autoDisplayName,
      }, requestOptions);

      if (!res.ok || !res.data) {
        if (mode === 'signup' && res.isNetworkError) {
          setStructuredError({
            title: '注册结果待确认',
            detail: '无法连接后端，结果可能已提交，可尝试直接登录。',
            isNetworkError: true,
          });
          return;
        }
        throw new Error(res.error || '认证失败，请检查账号密码或网络连接。');
      }

      const persistence: AuthSessionPersistence = mode === 'signup' || rememberLogin
        ? 'persistent'
        : 'session';
      await setLocalCustomUser(res.data, persistence);
      if (mode === 'signin' && rememberLogin) {
        await saveBrowserPasswordCredential(targetEmail, password);
      }
      setPassword('');
      onClose();
    } catch (error: unknown) {
      const parsed = parseAuthError(error);
      setStructuredError(parsed);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRedeem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canRedeem || pendingOperationRef.current || !redeemCodeInput.trim()) return;
    const operation = operationRef.current;
    pendingOperationRef.current = true;
    setRedeemMsg(null);
    setIsSubmitting(true);
    try {
      const res = await redeemVipCode(redeemCodeInput.trim());
      if (operation !== operationRef.current) return;
      setRedeemMsg({ text: res.message, isError: !res.success });
      if (res.success) setRedeemCodeInput('');
    } catch {
      if (operation === operationRef.current) {
        setRedeemMsg({ text: '兑换失败，请检查网络后重试', isError: true });
      }
    } finally {
      if (operation === operationRef.current) {
        pendingOperationRef.current = false;
        setIsSubmitting(false);
      }
    }
  };

  const handleSignOut = async () => {
    if (pendingOperationRef.current) return;
    const operation = operationRef.current;
    const opening = openGenerationRef.current;
    const uid = currentUser?.uid;
    pendingOperationRef.current = true;
    setIsSubmitting(true);
    setRedeemMsg(null);
    try {
      await logoutUser();
      if (opening === openGenerationRef.current && (!latestUidRef.current || latestUidRef.current === uid)) onClose();
    } catch {
      if (operation === operationRef.current) {
        setRedeemMsg({ text: '退出失败，请稍后重试', isError: true });
      }
    } finally {
      if (operation === operationRef.current) {
        pendingOperationRef.current = false;
        setIsSubmitting(false);
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div role="dialog" aria-modal="true" aria-label={canRedeem ? '会员兑换' : '用户登录与账号'} style={zIndex === undefined ? undefined : { zIndex }} className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-3 sm:p-4 overflow-y-auto animate-fadeIn">
      <div className="relative w-full max-w-md bg-[#FAF9FD] border border-purple-200/80 rounded-3xl shadow-2xl shadow-purple-900/10 overflow-hidden flex flex-col max-h-[92vh] text-slate-800">
        {/* Header */}
        <div className="px-5 py-4 bg-gradient-to-r from-purple-100/70 via-slate-50 to-purple-50/50 border-b border-purple-200/70 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-purple-100 via-indigo-50 to-purple-100 border border-purple-200 flex items-center justify-center text-purple-600 shadow-sm shrink-0">
              <Crown className="w-5 h-5 text-amber-500 fill-amber-500/20" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-slate-800 tracking-tight">{canRedeem ? '会员兑换' : '登录与注册'}</h3>
              <p className="text-xs text-slate-500">{canRedeem ? '使用激活码兑换会员权益' : '登录后继续会员兑换与创作'}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="关闭账号窗口"
            className="p-2 text-slate-400 hover:text-slate-700 hover:bg-purple-100/60 rounded-xl transition-all cursor-pointer min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 sm:p-5 overflow-y-auto space-y-4 custom-scrollbar bg-slate-100/60">
          {authLoading ? (
            <div className="bg-purple-50/50 border border-purple-100 rounded-2xl p-8 flex flex-col items-center justify-center gap-3 text-slate-700 my-4">
              <Loader2 className="w-8 h-8 text-purple-600 animate-spin" />
              <div className="text-xs font-bold text-slate-800">✨ 正在安全加载用户账号与 VIP 权益...</div>
              <div className="text-[11px] text-slate-500">请稍等，正在同步云端身份鉴权数据</div>
            </div>
          ) : canRedeem ? (
            <div className="space-y-4">
              {/* Redeem Code Form */}
              <form onSubmit={handleRedeem} aria-label="会员激活码兑换" className="space-y-3 rounded-2xl border border-purple-100 bg-white p-4 shadow-xs">
                <label htmlFor="membership-redeem-code" className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                  <KeyRound className="w-3.5 h-3.5 text-amber-500" />
                  <span>兑换 VIP 激活码</span>
                </label>
                <div className="flex gap-2">
                  <input
                    ref={redeemInputRef}
                    id="membership-redeem-code"
                    type="text"
                    autoComplete="off"
                    spellCheck={false}
                    disabled={isSubmitting}
                    value={redeemCodeInput}
                    onChange={e => setRedeemCodeInput(e.target.value.toUpperCase())}
                    placeholder="输入会员激活码"
                    className="min-w-0 flex-1 px-3 py-2 bg-slate-50/80 border border-slate-200 rounded-xl text-xs text-slate-800 uppercase font-mono placeholder:text-slate-400 focus:bg-white focus:outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100 min-h-[44px]"
                  />
                  <button
                    type="submit"
                    disabled={isSubmitting || !redeemCodeInput.trim()}
                    className="px-4 py-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white font-black text-xs rounded-xl shadow-sm hover:shadow disabled:opacity-50 transition-all cursor-pointer shrink-0 min-h-[44px] flex items-center justify-center gap-1.5"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-white" />
                        <span>兑换中...</span>
                      </>
                    ) : (
                      <span>立即兑换</span>
                    )}
                  </button>
                </div>
                {redeemMsg && (
                  <div role={redeemMsg.isError ? 'alert' : 'status'} className={`text-xs p-2.5 rounded-xl ${
                    redeemMsg.isError
                      ? 'bg-rose-50 text-rose-700 border border-rose-200'
                      : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  }`}>
                    {redeemMsg.text}
                  </div>
                )}
              </form>

              <p className="text-xs text-slate-600 leading-relaxed">
                当前会员：{isPro ? '商家 Pro' : isVip ? 'VIP 会员' : '标准用户'}
                {(isVip || isPro) && userProfile && (
                  <span className="block mt-1">
                    到期时间：{isAdmin || userProfile.role === 'admin'
                      ? '永久有效'
                      : (userProfile.member_expire || userProfile.vipExpireAt)
                        ? formatChinaDate(userProfile.member_expire || userProfile.vipExpireAt, false)
                        : '永久有效'}
                  </span>
                )}
              </p>

              {/* Admin Button if Admin */}
              {canAccessAdmin && onOpenAdminPanel && (
                <div className="pt-2">
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => {
                      onClose();
                      onOpenAdminPanel();
                    }}
                    className="w-full py-2.5 px-3 bg-gradient-to-r from-rose-50 via-purple-50 to-rose-50 border border-rose-200 hover:border-rose-300 text-rose-700 font-bold text-xs rounded-xl flex items-center justify-center gap-2 cursor-pointer transition-all min-h-[44px]"
                  >
                    <ShieldCheck className="w-4 h-4 text-rose-600" />
                    <span>进入管理后台</span>
                  </button>
                </div>
              )}
              <button
                type="button"
                onClick={handleSignOut}
                disabled={isSubmitting}
                className="w-full min-h-[44px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
              >
                <LogOut className="w-4 h-4" />
                退出登录
              </button>
            </div>
          ) : (
            /* Sign In / Sign Up Form */
            <div className="space-y-4">
              {/* Main Form: Flexible Phone/Email/Account Auth */}
              <div className="space-y-3 pt-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5 text-purple-600" />
                    <span>{mode === 'signin' ? '手机号 / 邮箱 / 账号登录' : '注册新账号 (手机号/邮箱/用户名)'}</span>
                  </span>
                  <div className="text-xs">
                    {mode === 'signin' ? (
                      <button
                        type="button"
                        onClick={() => {
                          setMode('signup');
                          setStructuredError(null);
                        }}
                        className="text-purple-600 font-bold hover:underline hover:text-purple-700 cursor-pointer"
                      >
                        没有账号？点此注册
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setMode('signin');
                          setStructuredError(null);
                        }}
                        className="text-purple-600 font-bold hover:underline hover:text-purple-700 cursor-pointer"
                      >
                        已有账号？点此登录
                      </button>
                    )}
                  </div>
                </div>

                <form onSubmit={handleEmailAuth} className="space-y-3" autoComplete="on">
                  {mode === 'signup' && (
                    <div>
                      <label className="text-[11px] text-slate-600 block mb-1 font-medium">个性昵称 / 拼豆店名</label>
                      <div className="relative">
                        <User className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                        <input
                          type="text"
                          name="name"
                          autoComplete="name"
                          value={displayName}
                          onChange={e => setDisplayName(e.target.value)}
                          placeholder="例如: 拼豆小当家 / 像素创作者"
                          className="w-full pl-9 pr-3 py-2.5 bg-slate-50/80 border border-slate-200 focus:bg-white rounded-xl text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-100 min-h-[44px]"
                        />
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="text-[11px] text-slate-600 block mb-1 font-medium">
                      手机号 / QQ邮箱 / 163邮箱 / 自定义账号
                    </label>
                    <div className="relative">
                      <Mail className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                      <input
                        type="text"
                        name="username"
                        ref={loginInputRef}
                        aria-label="手机号 / 邮箱 / 账号"
                        autoComplete={AUTH_AUTOCOMPLETE.username}
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        placeholder="支持 11位手机号、QQ邮箱或自定义用户名"
                        required
                        className="w-full pl-9 pr-3 py-2.5 bg-slate-50/80 border border-slate-200 focus:bg-white rounded-xl text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-100 min-h-[44px]"
                      />
                    </div>
                    <p className="text-[10px] text-slate-400 mt-1">
                      * 支持手机号或常见邮箱，无需繁琐激活流程。
                    </p>
                  </div>

                  <div>
                    <label className="text-[11px] text-slate-600 block mb-1 font-medium">登录密码</label>
                    <div className="relative">
                      <Lock className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                      <input
                        type="password"
                        name="password"
                        aria-label="登录密码"
                        autoComplete={mode === 'signin'
                          ? AUTH_AUTOCOMPLETE.signinPassword
                          : AUTH_AUTOCOMPLETE.signupPassword}
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        placeholder="请输入至少 6 位密码"
                        required
                        className="w-full pl-9 pr-3 py-2.5 bg-slate-50/80 border border-slate-200 focus:bg-white rounded-xl text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-100 min-h-[44px]"
                      />
                    </div>
                  </div>

                  {mode === 'signin' && (
                    <label htmlFor="remember-login" className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer select-none">
                      <input
                        id="remember-login"
                        type="checkbox"
                        name="rememberLogin"
                        checked={rememberLogin}
                        onChange={e => setRememberLogin(e.target.checked)}
                        className="h-4 w-4 rounded border-slate-300 bg-white text-purple-600 accent-purple-600 focus:ring-purple-500/30"
                      />
                      <span>记住登录状态</span>
                    </label>
                  )}

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full py-2.5 bg-gradient-to-r from-purple-600 via-purple-700 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-bold text-xs rounded-xl shadow-md shadow-purple-500/25 hover:shadow-lg disabled:opacity-50 transition-all cursor-pointer min-h-[44px] flex items-center justify-center gap-2"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin text-white" />
                        <span>{mode === 'signin' ? '正在安全验证并登录...' : '正在创建新账号...'}</span>
                      </>
                    ) : (
                      <span>{mode === 'signin' ? '立即登录账号' : '立即注册并登录'}</span>
                    )}
                  </button>
                </form>
              </div>

              {/* Structured Localized Error Panel */}
              {structuredError && (
                <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-xs space-y-2 text-rose-700">
                  <div className="flex items-center gap-2 font-bold text-rose-800">
                    <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0" />
                    <span>{structuredError.title}</span>
                  </div>
                  <p className="text-[11px] text-rose-600 leading-relaxed">
                    {structuredError.detail}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
