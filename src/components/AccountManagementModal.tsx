import React, { useState, useRef, useEffect } from 'react';
import {
  X,
  User,
  Camera,
  Check,
  LogOut,
  ShieldCheck,
  Upload,
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

const MAX_AVATAR_SOURCE_BYTES = 8 * 1024 * 1024;
const MAX_AVATAR_SOURCE_PIXELS = 16_000_000;
const MAX_AVATAR_BYTES = 320 * 1024;
const MAX_PROFILE_REQUEST_JSON_CHARS = 500_000;
const AVATAR_EDGE = 512;
const AVATAR_MIN_EDGE = 96;
const AVATAR_QUALITIES = [0.86, 0.72, 0.58, 0.44];

type AvatarImageSource = {
  drawable: CanvasImageSource;
  width: number;
  height: number;
  dispose: () => void;
};

function imageToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string'
      ? resolve(reader.result)
      : reject(new Error('无法生成头像预览'));
    reader.onerror = () => reject(new Error('无法生成头像预览'));
    reader.readAsDataURL(blob);
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: 'image/webp' | 'image/jpeg', quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('当前浏览器无法压缩头像图片')), type, quality);
  });
}

function loadAvatarImage(file: File): Promise<AvatarImageSource> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      if (!image.naturalWidth || !image.naturalHeight) {
        image.src = '';
        reject(new Error('无法读取头像图片'));
        return;
      }
      resolve({
        drawable: image,
        width: image.naturalWidth,
        height: image.naturalHeight,
        dispose: () => { image.src = ''; },
      });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      image.src = '';
      reject(new Error('无法读取头像图片'));
    };
    image.src = url;
  });
}

function hasTransparency(context: CanvasRenderingContext2D, width: number, height: number): boolean {
  const pixels = context.getImageData(0, 0, width, height).data;
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] !== 255) return true;
  }
  return false;
}

async function compressAvatar(file: File): Promise<string> {
  const image = await loadAvatarImage(file);
  let canvas: HTMLCanvasElement | null = null;

  try {
    if (image.width * image.height > MAX_AVATAR_SOURCE_PIXELS) {
      throw new Error('图片分辨率过高，请选择 1600 万像素以内的图片');
    }

    let maxEdge = Math.min(AVATAR_EDGE, Math.max(image.width, image.height));
    const minimumEdge = Math.min(AVATAR_MIN_EDGE, maxEdge);

    while (maxEdge >= minimumEdge) {
      const scale = maxEdge / Math.max(image.width, image.height);
      const width = Math.max(1, Math.round(image.width * scale));
      const height = Math.max(1, Math.round(image.height * scale));
      canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d', { alpha: true });
      if (!context) throw new Error('当前浏览器无法处理头像图片');

      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      // Browser image decoding applies EXIF orientation before this draw call.
      context.drawImage(image.drawable, 0, 0, width, height);

      const formats: Array<'image/webp' | 'image/jpeg'> = hasTransparency(context, width, height)
        ? ['image/webp']
        : ['image/webp', 'image/jpeg'];
      for (const type of formats) {
        for (const quality of AVATAR_QUALITIES) {
          const blob = await canvasToBlob(canvas, type, quality);
          if (blob.size > MAX_AVATAR_BYTES) continue;
          if (blob.type !== type) continue;
          return imageToDataURL(blob);
        }
      }

      canvas.width = 1;
      canvas.height = 1;
      canvas = null;
      maxEdge = Math.floor(maxEdge * 0.72);
    }

    throw new Error('头像压缩后仍然过大，请选择更简单的图片');
  } finally {
    image.dispose();
    if (canvas) {
      canvas.width = 1;
      canvas.height = 1;
    }
  }
}

export const AccountManagementModal: React.FC<AccountManagementModalProps> = ({
  isOpen,
  onClose,
}) => {
  const { userProfile, updateUserProfile, logoutUser, isVip, isPro } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Form State
  const [displayName, setDisplayName] = useState(userProfile?.displayName || '');
  const [photoURL, setPhotoURL] = useState(userProfile?.photoURL || '');
  const [isProcessingAvatar, setIsProcessingAvatar] = useState(false);
  const isProcessingAvatarRef = useRef(false);

  // Loading & Notice State
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [msg, setMsg] = useState<{ text: string; isError: boolean } | null>(null);

  useEffect(() => { if (isOpen) setMsg(null); }, [isOpen]);

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
    if (isProcessingAvatar || isSubmitting) return;
    setPhotoURL(url);
    setMsg({ text: '已预选头像，请点击下方的“保存修改”完成更新', isError: false });
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const file = e.target.files?.[0];
    if (!file || isProcessingAvatarRef.current || isSubmitting) {
      input.value = '';
      return;
    }
    if (!file.type.startsWith('image/')) {
      setMsg({ text: '请选择图片文件', isError: true });
      input.value = '';
      return;
    }
    if (file.size > MAX_AVATAR_SOURCE_BYTES) {
      setMsg({ text: '原图需小于 8MB', isError: true });
      input.value = '';
      return;
    }

    isProcessingAvatarRef.current = true;
    setIsProcessingAvatar(true);
    setMsg({ text: '正在压缩头像…', isError: false });
    try {
      const compressed = await compressAvatar(file);
      if (compressed.length >= MAX_PROFILE_REQUEST_JSON_CHARS) {
        throw new Error('头像数据仍然过大，请选择更简单的图片');
      }
      setPhotoURL(compressed);
      setMsg({ text: '头像已压缩至安全大小，点击保存以提交修改', isError: false });
    } catch (error) {
      setMsg({ text: error instanceof Error ? error.message : '头像处理失败', isError: true });
    } finally {
      isProcessingAvatarRef.current = false;
      setIsProcessingAvatar(false);
      input.value = '';
    }
  };

  // Submit Profile Updates
  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);

    if (isSubmitting || isProcessingAvatar) return;

    const nextDisplayName = displayName.trim();
    if (nextDisplayName.length < 1 || nextDisplayName.length > 80) {
      setMsg({ text: '用户昵称长度需为 1 至 80 个字符', isError: true });
      return;
    }

    const changes: { displayName?: string; photoURL?: string } = {};
    if (nextDisplayName !== (userProfile?.displayName ?? '').trim()) {
      changes.displayName = nextDisplayName;
    }
    if (photoURL !== (userProfile?.photoURL ?? '')) {
      changes.photoURL = photoURL;
    }

    if (Object.keys(changes).length === 0) {
      setMsg({ text: '没有需要保存的资料修改', isError: false });
      return;
    }
    if (JSON.stringify(changes).length >= MAX_PROFILE_REQUEST_JSON_CHARS) {
      setMsg({ text: '资料请求过大，请重新选择头像后再试', isError: true });
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await updateUserProfile(changes);
      setMsg({ text: res.message, isError: !res.success });
      if (res.success) {
        setDisplayName(nextDisplayName);
      }
    } catch {
      setMsg({ text: '资料保存失败，请检查网络后重试', isError: true });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Logout Handler
  const handleLogout = async () => {
    if (window.confirm('确定要退出当前账号吗？')) {
      try {
        await logoutUser();
        onClose();
      } catch {
        setMsg({ text: '退出失败，请稍后重试', isError: true });
      }
    }
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="账号管理" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-3 sm:p-4 overflow-y-auto">
      <div className="relative w-full max-w-lg bg-[#FAF9FD] border border-purple-200/80 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh] text-slate-800 animate-in fade-in zoom-in-95 duration-200">
        
        {/* Modal Header */}
        <div className="px-6 py-4 bg-purple-50/70 border-b border-purple-100 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-2xl bg-purple-100 text-purple-600 border border-purple-200 flex items-center justify-center font-bold shrink-0">
              <User className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-black text-slate-800 flex items-center gap-2">
                账号管理
                <span className="text-[10px] bg-purple-50 text-purple-700 border border-purple-200 px-2 py-0.5 rounded-full font-bold">
                  {isPro ? '商家Pro' : isVip ? 'VIP会员' : '标准用户'}
                </span>
              </h3>
              <p className="text-xs text-slate-500">修改您的头像与个人昵称</p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="关闭账号管理"
            className="p-2 text-slate-400 hover:text-slate-700 hover:bg-purple-100 rounded-xl transition-colors cursor-pointer min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Scroll Content */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-6 custom-scrollbar">
          
          {/* Status Toast Message */}
          {msg && (
            <div
              role={msg.isError ? 'alert' : 'status'}
              className={`p-3.5 rounded-2xl text-xs font-bold flex items-center gap-2 border ${
                msg.isError
                  ? 'bg-rose-50 border-rose-200 text-rose-700'
                  : 'bg-emerald-50 border-emerald-200 text-emerald-700'
              }`}
            >
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{msg.text}</span>
            </div>
          )}

          <form onSubmit={handleSaveProfile} className="space-y-6">
            
            {/* Section 1: 修改头像 (Modify Avatar) */}
            <div className="space-y-3 bg-white p-4 rounded-2xl border border-purple-100">
              <label className="text-xs font-extrabold text-purple-700 flex items-center gap-1.5">
                <Camera className="w-4 h-4 text-purple-600" />
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
                    disabled={isProcessingAvatar || isSubmitting}
                    className="absolute -bottom-1 -right-1 p-1.5 bg-purple-600 text-white rounded-xl shadow-md hover:bg-purple-500 transition-transform active:scale-95 cursor-pointer"
                    title="上传本地图片作为头像"
                  >
                    <Upload className="w-3.5 h-3.5" />
                  </button>
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileUpload}
                    accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
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
                        disabled={isProcessingAvatar || isSubmitting}
                        className={`relative rounded-xl overflow-hidden aspect-square border transition-all cursor-pointer ${
                          photoURL === avatar.url
                            ? 'border-purple-400 ring-2 ring-purple-400 scale-105 shadow-md'
                            : 'border-slate-200 hover:border-purple-300 opacity-80 hover:opacity-100'
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
            <div className="space-y-2 bg-white p-4 rounded-2xl border border-purple-100">
              <label htmlFor="account-display-name" className="text-xs font-extrabold text-purple-700 flex items-center gap-1.5">
                <User className="w-4 h-4 text-purple-600" />
                <span>修改账号昵称</span>
              </label>
              <input
                type="text"
                id="account-display-name"
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                placeholder="请输入创作者昵称 (如: 拼豆达人_小星)"
                className="w-full px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-800 text-sm font-bold placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all"
                maxLength={80}
              />
              <div className="flex items-center justify-between text-[11px] text-slate-500 px-1">
                <span>账号邮箱: {userProfile?.email || 'pindou_creator@studio.cn'}</span>
                <span>拼豆号: {userProfile?.uid ? userProfile.uid.slice(0, 9) : '206310680'}</span>
              </div>
            </div>

            {/* Save Profile Button */}
            <button
              type="submit"
              disabled={isSubmitting || isProcessingAvatar}
              className="w-full py-3 rounded-2xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-black text-sm shadow-lg shadow-purple-600/30 flex items-center justify-center gap-2 cursor-pointer transition-all active:scale-98 disabled:opacity-50"
            >
              {isSubmitting || isProcessingAvatar ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{isProcessingAvatar ? '正在压缩头像...' : '正在保存设置...'}</span>
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
          <div className="border-t border-purple-100 pt-2" />

          {/* BOTTOM LOGOUT BUTTON (最下方有个退出账号按钮) */}
          <div className="pt-1">
            <button
              type="button"
              onClick={handleLogout}
              className="w-full py-3 px-4 rounded-2xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-extrabold text-sm flex items-center justify-center gap-2 transition-all cursor-pointer shadow-md hover:shadow-sm active:scale-98"
            >
              <LogOut className="w-4 h-4 text-rose-600" />
              <span>退出账号</span>
            </button>
          </div>

        </div>
      </div>
    </div>
  );
};
