import React, { useState, useRef, useEffect } from 'react';
import {
  X,
  User,
  Lock,
  Camera,
  Check,
  LogOut,
  KeyRound,
  ShieldCheck,
  Crown,
  Eye,
  EyeOff,
  Upload,
  Sparkles,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface AccountManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenVipModal?: () => void;
}

// Preset Cute Pixel / Bead Avatars
const PRESET_AVATARS = [
  { id: 'cat', name: '像素萌猫', url: 'https://images.unsplash.com/photo-1514888286974-6c03e2ca1dba?w=150&auto=format&fit=crop&q=80' },
  { id: 'girl', name: '动漫达人', url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80' },
  { id: 'panda', name: '国潮熊猫', url: 'https://images.unsplash.com/photo-1564349683136-77e08dba1ef9?w=150&auto=format&fit=crop&q=80' },
  { id: 'beader', name: '拼豆大咖', url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80' },
  { id: 'artist', name: '像素画师', url: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&auto=format&fit=crop&q=80' },
  { id: 'game', name: '极客星人', url: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=150&auto=format&fit=crop&q=80' },
];

export const AccountManagementModal: React.FC<AccountManagementModalProps> = ({
  isOpen,
  onClose,
  onOpenVipModal,
}) => {
  const { userProfile, updateUserProfile, logoutUser, isVip, isPro, isAdmin } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Form State
  const [displayName, setDisplayName] = useState(userProfile?.displayName || '');
  const [photoURL, setPhotoURL] = useState(userProfile?.photoURL || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);

  // Loading & Notice State
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [msg, setMsg] = useState<{ text: string; isError: boolean } | null>(null);

  // Sync form state when userProfile updates or modal opens
  useEffect(() => {
    if (isOpen && userProfile) {
      setDisplayName(userProfile.displayName || '');
      setPhotoURL(userProfile.photoURL || '');
    }
  }, [isOpen, userProfile]);

  if (!isOpen) return null;

  // Handle Avatar Selection / Custom Upload
  const handleSelectPresetAvatar = (url: string) => {
    setPhotoURL(url);
    setMsg({ text: '已预选头像，请点击下方的“保存修改”完成更新', isError: false });
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) {
        setMsg({ text: '图片文件大小需在 2MB 以内', isError: true });
        return;
      }
      const reader = new FileReader();
      reader.onload = evt => {
        if (evt.target?.result) {
          setPhotoURL(evt.target.result as string);
          setMsg({ text: '自定义头像读取成功，点击保存以提交修改', isError: false });
        }
      };
      reader.readAsDataURL(file);
    }
  };

  // Submit Profile Updates
  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);

    if (!displayName.trim()) {
      setMsg({ text: '用户昵称不能为空', isError: true });
      return;
    }

    if (newPassword) {
      if (newPassword.length < 6) {
        setMsg({ text: '新密码长度至少需要 6 个字符', isError: true });
        return;
      }
      if (newPassword !== confirmPassword) {
        setMsg({ text: '两次输入的新密码不一致，请重试', isError: true });
        return;
      }
    }

    setIsSubmitting(true);
    const res = await updateUserProfile({
      displayName: displayName.trim(),
      photoURL,
      password: newPassword || undefined,
    });
    setIsSubmitting(false);

    setMsg({ text: res.message, isError: !res.success });
    if (res.success) {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    }
  };

  // Logout Handler
  const handleLogout = async () => {
    if (window.confirm('确定要退出当前账号吗？')) {
      await logoutUser();
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-3 sm:p-4 overflow-y-auto">
      <div className="relative w-full max-w-lg bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh] text-slate-100 animate-in fade-in zoom-in-95 duration-200">
        
        {/* Modal Header */}
        <div className="px-6 py-4 bg-slate-950/90 border-b border-slate-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-2xl bg-purple-600/20 text-purple-400 border border-purple-500/30 flex items-center justify-center font-bold shrink-0">
              <User className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-black text-white flex items-center gap-2">
                账号管理
                <span className="text-[10px] bg-purple-500/20 text-purple-300 border border-purple-500/30 px-2 py-0.5 rounded-full font-bold">
                  {isPro ? '商家Pro' : isVip ? 'VIP会员' : '标准用户'}
                </span>
              </h3>
              <p className="text-xs text-slate-400">修改您的头像、个人昵称及安全登录密码</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-colors cursor-pointer min-h-[40px] min-w-[40px] flex items-center justify-center"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Scroll Content */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-6 custom-scrollbar">
          
          {/* Status Toast Message */}
          {msg && (
            <div
              className={`p-3.5 rounded-2xl text-xs font-bold flex items-center gap-2 border ${
                msg.isError
                  ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                  : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              }`}
            >
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{msg.text}</span>
            </div>
          )}

          <form onSubmit={handleSaveProfile} className="space-y-6">
            
            {/* Section 1: 修改头像 (Modify Avatar) */}
            <div className="space-y-3 bg-slate-950/60 p-4 rounded-2xl border border-slate-800/80">
              <label className="text-xs font-extrabold text-purple-300 flex items-center gap-1.5">
                <Camera className="w-4 h-4 text-purple-400" />
                <span>修改个人头像</span>
              </label>

              <div className="flex items-center gap-4">
                {/* Current Avatar Preview */}
                <div className="relative group shrink-0">
                  <div className="w-16 h-16 rounded-2xl ring-2 ring-purple-500/50 p-0.5 bg-gradient-to-tr from-purple-600 to-indigo-600 overflow-hidden shadow-lg">
                    {photoURL ? (
                      <img src={photoURL} alt="Avatar" className="w-full h-full object-cover rounded-[14px]" />
                    ) : (
                      <div className="w-full h-full rounded-[14px] bg-purple-900 text-white font-black text-xl flex items-center justify-center">
                        {displayName?.[0] || '豆'}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="absolute -bottom-1 -right-1 p-1.5 bg-purple-600 text-white rounded-xl shadow-md hover:bg-purple-500 transition-transform active:scale-95 cursor-pointer"
                    title="上传本地图片作为头像"
                  >
                    <Upload className="w-3.5 h-3.5" />
                  </button>
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileUpload}
                    accept="image/*"
                    className="hidden"
                  />
                </div>

                {/* Avatar Presets Selection */}
                <div className="flex-1 space-y-1.5">
                  <span className="text-[11px] font-bold text-slate-400 block">快捷选择精品拼豆风格头像：</span>
                  <div className="grid grid-cols-6 gap-2">
                    {PRESET_AVATARS.map(avatar => (
                      <button
                        key={avatar.id}
                        type="button"
                        onClick={() => handleSelectPresetAvatar(avatar.url)}
                        className={`relative rounded-xl overflow-hidden aspect-square border transition-all cursor-pointer ${
                          photoURL === avatar.url
                            ? 'border-purple-400 ring-2 ring-purple-400 scale-105 shadow-md'
                            : 'border-slate-800 hover:border-slate-600 opacity-80 hover:opacity-100'
                        }`}
                        title={avatar.name}
                      >
                        <img src={avatar.url} alt={avatar.name} className="w-full h-full object-cover" />
                        {photoURL === avatar.url && (
                          <div className="absolute inset-0 bg-purple-600/40 flex items-center justify-center">
                            <Check className="w-3.5 h-3.5 text-white stroke-[3]" />
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Section 2: 修改昵称 (Modify Nickname) */}
            <div className="space-y-2 bg-slate-950/60 p-4 rounded-2xl border border-slate-800/80">
              <label className="text-xs font-extrabold text-purple-300 flex items-center gap-1.5">
                <User className="w-4 h-4 text-purple-400" />
                <span>修改账号昵称</span>
              </label>
              <input
                type="text"
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                placeholder="请输入创作者昵称 (如: 拼豆达人_小星)"
                className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700/80 text-white text-sm font-bold placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all"
                maxLength={30}
              />
              <div className="flex items-center justify-between text-[11px] text-slate-500 px-1">
                <span>账号邮箱: {userProfile?.email || 'pindou_creator@studio.cn'}</span>
                <span>拼豆号: {userProfile?.uid ? userProfile.uid.slice(0, 9) : '206310680'}</span>
              </div>
            </div>

            {/* Section 3: 修改账号密码 (Modify Password) */}
            <div className="space-y-3 bg-slate-950/60 p-4 rounded-2xl border border-slate-800/80">
              <label className="text-xs font-extrabold text-purple-300 flex items-center gap-1.5">
                <Lock className="w-4 h-4 text-purple-400" />
                <span>修改账号密码 (选填)</span>
              </label>

              {/* Current Password */}
              <div className="relative">
                <input
                  type={showCurrentPassword ? 'text' : 'password'}
                  value={currentPassword}
                  onChange={e => setCurrentPassword(e.target.value)}
                  placeholder="当前原密码 (首次设定可留空)"
                  className="w-full pl-4 pr-10 py-2 rounded-xl bg-slate-900 border border-slate-700/80 text-white text-xs font-bold placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
                <button
                  type="button"
                  onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                >
                  {showCurrentPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>

              {/* New Password & Confirm */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div className="relative">
                  <input
                    type={showNewPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    placeholder="设置新密码 (不少于6位)"
                    className="w-full pl-4 pr-10 py-2 rounded-xl bg-slate-900 border border-slate-700/80 text-white text-xs font-bold placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                  >
                    {showNewPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>

                <input
                  type="password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  placeholder="再次确认新密码"
                  className="w-full px-4 py-2 rounded-xl bg-slate-900 border border-slate-700/80 text-white text-xs font-bold placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>
            </div>

            {/* Save Profile Button */}
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-3 rounded-2xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-black text-sm shadow-lg shadow-purple-600/30 flex items-center justify-center gap-2 cursor-pointer transition-all active:scale-98 disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>正在保存设置...</span>
                </>
              ) : (
                <>
                  <ShieldCheck className="w-4 h-4" />
                  <span>保存个人资料修改</span>
                </>
              )}
            </button>
          </form>

          {/* Divider */}
          <div className="border-t border-slate-800 pt-2" />

          {/* BOTTOM LOGOUT BUTTON (最下方有个退出账号按钮) */}
          <div className="pt-1">
            <button
              type="button"
              onClick={handleLogout}
              className="w-full py-3 px-4 rounded-2xl bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800/60 font-extrabold text-sm flex items-center justify-center gap-2 transition-all cursor-pointer shadow-md hover:shadow-rose-950/50 active:scale-98"
            >
              <LogOut className="w-4 h-4 text-rose-400" />
              <span>退出账号</span>
            </button>
          </div>

        </div>
      </div>
    </div>
  );
};
