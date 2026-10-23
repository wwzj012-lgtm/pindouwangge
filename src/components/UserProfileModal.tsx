import React, { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef, useSyncExternalStore } from 'react';
import {
  X,
  User,
  Settings,
  Edit3,
  Heart,
  Bookmark,
  Package,
  Search,
  Plus,
  Minus,
  SlidersHorizontal,
  Layers,
  Crown,
  Sparkles,
  ChevronRight,
  AlertTriangle,
  RotateCcw,
  Zap,
  FolderHeart,
  Pencil,
  Trash2,
  Image as ImageIcon,
  Loader2,
} from 'lucide-react';
import './UserProfileModal.css';
import { useAuth } from '../context/AuthContext';
import type { CommunityPattern } from '../data/communityData';
import { listFavoriteCommunityPosts, type CommunityPost } from '../utils/communityApi';
import { BeadColor } from '../types';
import { ErrorBoundary } from './ErrorBoundary';
import {
  getUserExportedPatterns,
  getPatternProject,
  deleteCloudExportedPatternAndLocal,
  getExportedPatternPreview,
  type ExportedPatternRecord,
} from '../utils/patternHistory';
import { formatChinaDate } from '../utils/dateUtils';
import type { ContinueEditingPattern } from '../utils/savedPatternNavigation';
import {
  getBeadInventorySnapshot,
  getServerBeadInventorySnapshot,
  subscribeBeadInventory,
  writeBeadInventory,
  type BeadStockItem,
} from '../utils/beadInventory';

export function splitProfilePatternSections(records: readonly ExportedPatternRecord[], currentUserId: string | null): {
  libraryRecords: ExportedPatternRecord[];
  publishedRecords: ExportedPatternRecord[];
} {
  const libraryRecords = records.filter((record) => record.status !== 2
    && (record.userId === null || record.userId === currentUserId));
  return {
    libraryRecords,
    publishedRecords: currentUserId
      ? libraryRecords.filter((record) => record.status === 1 && record.userId === currentUserId)
      : [],
  };
}

interface UserProfileModalProps {
  isOpen: boolean;
  initialTab?: 'works' | 'likes' | 'library' | 'inventory';
  onClose: () => void;
  onOpenAccountManagement: () => void;
  onOpenVipModal?: () => void;
  onSelectPattern?: (pattern: CommunityPattern) => void;
  onContinueEditing?: ContinueEditingPattern;
  onPublishPattern?: (record: ExportedPatternRecord) => void;
}

// Helper thumbnail preview for saved pattern records
function PatternCoverThumbnail({ record, userId }: { record: ExportedPatternRecord; userId: string | null }): React.ReactElement {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    const blob = record.previewBlob
      ? Promise.resolve(record.previewBlob)
      : record.hasPreview && record.cloudRevision
      ? getExportedPatternPreview(record.id, record.cloudRevision, userId)
      : Promise.resolve(null);
    void blob.then((preview) => {
      if (!preview || !active) return;
      objectUrl = URL.createObjectURL(preview);
      setUrl(objectUrl);
    });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [record.id, record.previewBlob, record.hasPreview, record.cloudRevision, userId]);

  return (
    <div className="profile-cover relative aspect-[4/3] w-full shrink-0 overflow-hidden bg-white flex items-center justify-center">
      {url ? (
        <img src={url} alt="" className="h-full w-full object-contain [image-rendering:pixelated]" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-slate-700">
          <ImageIcon className="h-8 w-8 text-slate-700" />
        </div>
      )}
    </div>
  );
}

const GUEST_COMMUNITY_MESSAGE = '游客账号仅可浏览社区。请登录或注册后再使用喜欢、收藏和发布功能。';
const FORMAL_LOGIN_REQUIRED_MESSAGE = '请登录或注册后再查看喜欢和管理个人图纸。';

function isGuestAccount(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const account = value as Record<string, unknown>;
  return account.authProvider === 'guest' || account.auth_provider === 'guest' || account.provider === 'guest';
}

function displayFavoriteError(error: string | undefined): string {
  return error?.includes('Guest accounts can only browse the community')
    ? GUEST_COMMUNITY_MESSAGE
    : (error ?? '无法读取喜欢列表');
}

export const UserProfileModal: React.FC<UserProfileModalProps> = ({
  isOpen,
  initialTab = 'library',
  onClose,
  onOpenAccountManagement,
  onOpenVipModal,
  onSelectPattern,
  onContinueEditing,
  onPublishPattern,
}) => {
  const { userProfile, isVip, isPro, currentUser } = useAuth();
  const openLoginModal = useCallback(() => {
    onClose();
    window.dispatchEvent(new Event('unauthorized'));
  }, [onClose]);
  const requireFormalLogin = useCallback((message = FORMAL_LOGIN_REQUIRED_MESSAGE): boolean => {
    const hasFormalLogin = Boolean(currentUser) && !isGuestAccount(currentUser) && !isGuestAccount(userProfile);
    if (hasFormalLogin) return true;
    setActionMessage(message);
    openLoginModal();
    return false;
  }, [currentUser, openLoginModal, userProfile]);

  // Active Main Tab inside Personal Center
  const [activeTab, setActiveTab] = useState<'works' | 'likes' | 'library' | 'inventory'>(initialTab);
  useEffect(() => {
    if (isOpen) setActiveTab(initialTab);
  }, [isOpen, initialTab]);
  const [favoritePosts, setFavoritePosts] = useState<CommunityPost[]>([]);
  const [loadingFavorites, setLoadingFavorites] = useState(false);
  const [favoritesError, setFavoritesError] = useState<string | null>(null);

  // --- Saved Patterns ("我的图库") State ---
  const [savedPatterns, setSavedPatterns] = useState<ExportedPatternRecord[]>([]);
  const [loadingPatterns, setLoadingPatterns] = useState(false);
  const [selectedPatternForAction, setSelectedPatternForAction] = useState<ExportedPatternRecord | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const editRequestRef = useRef(0);
  const continueEditingRef = useRef(onContinueEditing);
  continueEditingRef.current = onContinueEditing;
  // Invalidate during the close/unmount commit, before a pending read resumes.
  useLayoutEffect(() => {
    editRequestRef.current += 1;
    setActionBusyId(null);
    return () => { editRequestRef.current += 1; };
  }, [isOpen, currentUser?.uid]);
  const { libraryRecords, publishedRecords } = splitProfilePatternSections(savedPatterns, currentUser?.uid ?? null);
  const libraryPatternCount = libraryRecords.length;
  const publishedPatternCount = publishedRecords.length;
  const activePatternRecords = activeTab === 'works' ? publishedRecords : libraryRecords;

  // Load Saved Patterns when modal opens or user changes
  const loadSavedPatterns = async () => {
    setLoadingPatterns(true);
    try {
      const list = await getUserExportedPatterns(currentUser?.uid || null);
      setSavedPatterns(list.filter((record) => (record.status ?? 0) !== 2));
    } catch {
      // ignore
    } finally {
      setLoadingPatterns(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadSavedPatterns();
    }
  }, [isOpen, currentUser]);

  const loadFavoritePosts = useCallback(async () => {
    if (!requireFormalLogin('请登录或注册后再查看喜欢列表。')) {
      setFavoritePosts([]);
      setFavoritesError(FORMAL_LOGIN_REQUIRED_MESSAGE);
      return;
    }

    setLoadingFavorites(true);
    setFavoritesError(null);
    try {
      const result = await listFavoriteCommunityPosts();
      if (!result.ok || !result.data) {
        setFavoritePosts([]);
        setFavoritesError(displayFavoriteError(result.error));
        return;
      }
      setFavoritePosts(result.data.posts);
    } finally {
      setLoadingFavorites(false);
    }
  }, [requireFormalLogin]);

  useEffect(() => {
    if (isOpen && activeTab === 'likes') void loadFavoritePosts();
  }, [activeTab, isOpen, loadFavoritePosts]);

  const handleOpenLikes = () => {
    if (activeTab === 'likes') void loadFavoritePosts();
    else setActiveTab('likes');
  };

  // Actions for "我的图库"
  // 1. 编辑 (Edit / Continue Editing)
  const handleEditPattern = async (record: ExportedPatternRecord) => {
    if (!requireFormalLogin('请登录或注册后再编辑个人图纸。')) return;
    const request = ++editRequestRef.current;
    setActionBusyId(record.id);
    setActionMessage(null);
    try {
      const project = await getPatternProject(record.id, currentUser?.uid || null);
      if (request !== editRequestRef.current || !continueEditingRef.current) return;
      const accepted = await continueEditingRef.current(project);
      if (request === editRequestRef.current && accepted !== false) onClose();
    } catch (err) {
      if (request === editRequestRef.current) setActionMessage('载入图纸项目失败，请重试');
    } finally {
      if (request === editRequestRef.current) setActionBusyId(null);
    }
  };

  // 3. 删除 (Delete pattern from 我的图库)
  const handleDeletePattern = async (record: ExportedPatternRecord) => {
    if (!requireFormalLogin('请登录或注册后再删除个人图纸。')) return;
    if (!window.confirm(`确定要从【我的图库】中删除图纸《${record.title}》吗？`)) return;
    setActionBusyId(record.id);
    try {
      await deleteCloudExportedPatternAndLocal(record.id, currentUser?.uid || null);
      setSavedPatterns(prev => prev.filter(p => p.id !== record.id));
      setActionMessage('🗑️ 图纸已成功从【我的图库】删除');
      setSelectedPatternForAction(null);
      setTimeout(() => setActionMessage(null), 2000);
    } catch {
      setActionMessage('删除图纸失败，请重试');
    } finally {
      setActionBusyId(null);
    }
  };

  const worksCount = publishedPatternCount;
  const needsCommunityLogin = favoritesError === GUEST_COMMUNITY_MESSAGE;

  const handleCommunityLogin = () => {
    openLoginModal();
  };

  // --- Bead Inventory State ("豆仓·我的库存") ---
  const inventory: Record<string, BeadStockItem> = useSyncExternalStore(subscribeBeadInventory, getBeadInventorySnapshot, getServerBeadInventorySnapshot);
  const [inventorySearch, setInventorySearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'in_stock' | 'alert'>('all');
  const [letterFilter, setLetterFilter] = useState<string>('all');

  // Batch Modals for Inventory
  const [isBatchSetOpen, setIsBatchSetOpen] = useState(false);
  const [batchSetValue, setBatchSetValue] = useState(500);
  const [isBatchDeltaOpen, setIsBatchDeltaOpen] = useState(false);
  const [batchDeltaValue, setBatchDeltaValue] = useState(100);

  // Add Custom Color Code State
  const [isAddColorOpen, setIsAddColorOpen] = useState(false);
  const [newColorCode, setNewColorCode] = useState('');
  const [newColorName, setNewColorName] = useState('');
  const [newColorHex, setNewColorHex] = useState('#A8DADC');
  const [newColorCount, setNewColorCount] = useState(600);
  const [newColorAlert, setNewColorAlert] = useState(100);

  // Shared v1 store notifies the practice panel in this window and other tabs.
  const saveInventory = (updated: Record<string, BeadStockItem>) => {
    if (!requireFormalLogin('请登录或注册后再修改拼豆库存。')) return false;
    if (!writeBeadInventory(updated)) {
      setActionMessage('库存保存失败，请检查浏览器本地存储后重试。');
      return false;
    }
    return true;
  };

  // Adjust Single Color Quantity
  const handleAdjustCount = (inventoryKey: string, delta: number) => {
    if (!requireFormalLogin('请登录或注册后再修改拼豆库存。')) return;
    const latest = getBeadInventorySnapshot();
    const current = latest[inventoryKey];
    if (!current) return;
    const updated = {
      ...latest,
      [inventoryKey]: { ...current, count: Math.max(0, current.count + delta) },
    };
    saveInventory(updated);
  };

  // Batch Set All Stock
  const handleApplyBatchSet = () => {
    const updated: Record<string, BeadStockItem> = {};
    const latest = getBeadInventorySnapshot();
    Object.keys(latest).forEach(code => {
      updated[code] = { ...latest[code], count: batchSetValue };
    });
    if (saveInventory(updated)) setIsBatchSetOpen(false);
  };

  // Batch Add / Subtract Stock
  const handleApplyBatchDelta = (multiplier: number) => {
    const updated: Record<string, BeadStockItem> = {};
    const delta = batchDeltaValue * multiplier;
    const latest = getBeadInventorySnapshot();
    Object.keys(latest).forEach(code => {
      const current = latest[code];
      updated[code] = { ...current, count: Math.max(0, current.count + delta) };
    });
    if (saveInventory(updated)) setIsBatchDeltaOpen(false);
  };

  // Add Custom Color Code Handler
  const handleAddCustomColor = () => {
    if (!requireFormalLogin('请登录或注册后再添加拼豆库存。')) return;
    const code = newColorCode.trim().toUpperCase();
    if (!code) {
      alert('请填写拼豆色号 (例如: M13, A24, X01)');
      return;
    }
    const latest = getBeadInventorySnapshot();
    if (Object.hasOwn(latest, code)) {
      alert(`色号 ${code} 已在您的豆仓库存中存在！`);
      return;
    }
    const name = newColorName.trim() || code;
    const newItem: BeadStockItem = {
      colorId: `CUSTOM_${code}`,
      code,
      name,
      hex: newColorHex || '#A8DADC',
      count: Math.max(0, newColorCount),
      alertThreshold: Math.max(0, newColorAlert),
    };
    const updated = {
      ...latest,
      [code]: newItem,
    };
    if (!saveInventory(updated)) return;
    setIsAddColorOpen(false);

    // Reset Form
    setNewColorCode('');
    setNewColorName('');
    setNewColorHex('#A8DADC');
    setNewColorCount(600);
  };

  // Derived Inventory Metrics
  const inventoryList = useMemo(() => Object.entries(inventory).map(([inventoryKey, item]) => ({ ...item, inventoryKey })), [inventory]);
  const totalBeadStock = useMemo(
    () => inventoryList.reduce((sum, item) => sum + (item?.count || 0), 0),
    [inventoryList]
  );
  const inStockCount = useMemo(
    () => inventoryList.filter(item => (item?.count || 0) > 0).length,
    [inventoryList]
  );
  const alertCount = useMemo(
    () => inventoryList.filter(item => (item?.count || 0) <= (item?.alertThreshold ?? 100)).length,
    [inventoryList]
  );

  // Filtered Inventory List
  const filteredInventory = useMemo(() => {
    return inventoryList.filter(item => {
      if (!item || !item.code) return false;
      // 1. Search Query
      if (inventorySearch.trim()) {
        const query = inventorySearch.trim().toLowerCase();
        const matchCode = (item.code || '').toLowerCase().includes(query);
        const matchName = (item.name || '').toLowerCase().includes(query);
        if (!matchCode && !matchName) return false;
      }
      // 2. Status Filter
      const count = item.count ?? 0;
      const threshold = item.alertThreshold ?? 100;
      if (statusFilter === 'in_stock' && count <= 0) return false;
      if (statusFilter === 'alert' && count > threshold) return false;

      // 3. Code Letter Group Filter
      if (letterFilter !== 'all') {
        const firstChar = (item.code || '').charAt(0).toUpperCase();
        if (firstChar !== letterFilter) return false;
      }

      return true;
    });
  }, [inventoryList, inventorySearch, statusFilter, letterFilter]);

  if (!isOpen) return null;

  const displayName = userProfile?.displayName || currentUser?.displayName || (currentUser ? '已登录用户' : '未登录用户');

  return (
    <div className="profile-overlay fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-2 sm:p-4 overflow-y-auto">
      <ErrorBoundary fallbackTitle="个人中心界面加载遇到错误">
      <div className="profile-dialog relative w-full max-w-4xl bg-slate-50 border border-slate-200 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[94vh] text-slate-800 duration-200">
        
        {/* Profile Header Banner (Image 2 Inspired Dark Aesthetic) */}
        <div className="profile-header relative bg-gradient-to-b from-white via-white to-purple-50 p-5 sm:p-6 border-b border-slate-200/80">
          
          {/* Top Right Close Button */}
          <div className="absolute top-4 right-4 flex items-center gap-2 z-10">
            <button
              onClick={onClose}
              aria-label="关闭个人中心"
              className="p-1.5 bg-slate-100/80 hover:bg-slate-200 text-slate-500 hover:text-slate-900 rounded-xl transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6 pt-1">
            
            {/* Avatar with Click to Manage Account */}
            <div className="relative group shrink-0 cursor-pointer" onClick={onOpenAccountManagement}>
              <div className="profile-avatar w-20 h-20 sm:w-24 sm:h-24 rounded-full ring-4 ring-purple-500/40 p-1 bg-gradient-to-tr from-purple-600 via-indigo-600 to-pink-500 overflow-hidden shadow-xl group-hover:scale-105 transition-transform">
                {userProfile?.photoURL ? (
                  <img
                    src={userProfile.photoURL}
                    alt="Avatar"
                    className="w-full h-full object-cover rounded-full"
                  />
                ) : (
                  <div className="w-full h-full rounded-full bg-slate-100 text-purple-600 font-black text-2xl sm:text-3xl flex items-center justify-center">
                    <User className="w-9 h-9" aria-label="默认用户头像" />
                  </div>
                )}
              </div>
              <div
                className="absolute bottom-0 right-0 p-1.5 bg-purple-600 text-slate-900 rounded-full border-2 border-slate-900 shadow-md group-hover:bg-purple-500 transition-colors"
                title="点击进入账号管理修改头像"
              >
                <Edit3 className="w-3.5 h-3.5" />
              </div>
            </div>

            {/* Profile Info Details */}
            <div className="flex-1 space-y-2">
              <div className="flex flex-wrap items-center gap-2.5">
                <h2
                  onClick={onOpenAccountManagement}
                  className="text-xl sm:text-2xl font-black text-slate-900 hover:text-purple-600 transition-colors cursor-pointer flex items-center gap-1.5"
                >
                  {displayName}
                  <Edit3 className="w-4 h-4 text-slate-500 opacity-60 hover:opacity-100" />
                </h2>

                {isPro ? (
                  <span className="text-[10px] bg-gradient-to-r from-amber-400 to-amber-500 text-slate-950 font-black px-2.5 py-0.5 rounded-full shadow">
                    商家Pro
                  </span>
                ) : isVip ? (
                  <span className="text-[10px] bg-amber-500/20 text-amber-700 border border-amber-500/40 font-bold px-2.5 py-0.5 rounded-full">
                    VIP会员
                  </span>
                ) : (
                  <button
                    onClick={onOpenVipModal}
                    className="text-[10px] bg-purple-500/20 text-purple-600 hover:bg-purple-500/30 border border-purple-500/40 font-bold px-2.5 py-0.5 rounded-full transition-all cursor-pointer flex items-center gap-1"
                  >
                    <Crown className="w-3 h-3 text-amber-700" />
                    <span>升级PRO</span>
                  </button>
                )}
              </div>

              <p className="profile-description">管理你的图纸收藏与拼豆储备</p>
              <div className="profile-summary">
                <span><strong>{libraryPatternCount}</strong> 图库工程</span>
                <span><strong>{publishedPatternCount}</strong> 已发布</span>
                <span><strong>{inventoryList.length}</strong> 库存色号</span>
              </div>

            </div>
          </div>
        </div>

        {/* Profile Navigation Tabs */}
        <div className="profile-tabs px-4 sm:px-6 bg-white border-b border-slate-200 flex items-center gap-1 sm:gap-2 overflow-x-auto scrollbar-none shrink-0 py-2">
          <button
            aria-pressed={activeTab === 'works'} onClick={() => setActiveTab('works')}
            className={`px-3.5 py-2 rounded-xl text-xs sm:text-sm font-extrabold transition-all cursor-pointer flex items-center gap-1.5 shrink-0 ${
              activeTab === 'works'
                ? 'bg-purple-600 text-slate-900 shadow-md shadow-purple-600/30'
                : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            <span>作品</span>
            <span className="text-[10px] opacity-80">({publishedPatternCount})</span>
          </button>

          <button
            aria-pressed={activeTab === 'likes'} onClick={handleOpenLikes}
            className={`px-3.5 py-2 rounded-xl text-xs sm:text-sm font-extrabold transition-all cursor-pointer flex items-center gap-1.5 shrink-0 ${
              activeTab === 'likes'
                ? 'bg-purple-600 text-slate-900 shadow-md shadow-purple-600/30'
                : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            <span>喜欢</span>
            {loadingFavorites ? <Loader2 className="w-3 h-3 animate-spin opacity-80" /> : <span className="text-[10px] opacity-80">({favoritePosts.length})</span>}
          </button>

          {/* 我的图库 (My Library / Saved Patterns) */}
          <button
            aria-pressed={activeTab === 'library'} onClick={() => setActiveTab('library')}
            className={`px-3.5 py-2 rounded-xl text-xs sm:text-sm font-extrabold transition-all cursor-pointer flex items-center gap-1.5 shrink-0 border ${
              activeTab === 'library'
                ? 'bg-purple-600 text-slate-900 border-purple-500 shadow-md shadow-purple-600/30'
                : 'bg-purple-50/40 text-purple-800 border-purple-200/60 hover:bg-purple-100/60 hover:text-slate-900'
            }`}
          >
            <FolderHeart className="w-3.5 h-3.5 text-pink-400" />
            <span>我的图库</span>
            <span className="px-1.5 py-0.2 bg-purple-500/30 text-purple-600 text-[10px] rounded-full font-mono">
              {libraryPatternCount}
            </span>
          </button>

          {/* D豆仓·我的库存 */}
          <button
            aria-pressed={activeTab === 'inventory'} onClick={() => setActiveTab('inventory')}
            className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-black transition-all cursor-pointer flex items-center gap-1.5 shrink-0 ml-auto ${
              activeTab === 'inventory'
                ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-slate-950 shadow-md shadow-amber-500/20'
                : 'bg-amber-500/10 text-amber-700 border border-amber-500/30 hover:bg-amber-500/20'
            }`}
          >
            <Package className="w-4 h-4" />
            <span>我的豆仓</span>
            {alertCount > 0 && (
              <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
            )}
          </button>
        </div>

        {/* Tab Content Display Area */}
        <div className="profile-content p-4 sm:p-6 overflow-y-auto custom-scrollbar flex-1 space-y-6">
          
          {/* The Worker exposes persisted favorites. Viewing history has no data model yet, so no misleading tab is rendered. */}
          {activeTab === 'likes' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3 text-xs text-slate-500">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">喜欢</h3>
                  <p className="mt-1">已收藏的社区作品，仅自己可见。</p>
                </div>
                <button
                  onClick={() => void loadFavoritePosts()}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-100 px-2.5 py-1.5 font-bold text-slate-700 transition-colors hover:bg-slate-200"
                  title="刷新喜欢列表"
                >
                  <RotateCcw className="w-3 h-3" />
                  刷新
                </button>
              </div>

              {loadingFavorites ? (
                <div className="py-16 flex flex-col items-center justify-center gap-3 text-slate-500">
                  <Loader2 className="w-8 h-8 animate-spin text-purple-600" />
                  <span className="text-xs font-bold">正在读取喜欢列表...</span>
                </div>
              ) : favoritesError ? (
                <div className="rounded-2xl border border-rose-200/70 bg-rose-50/30 p-5 text-center text-sm text-rose-700">
                  <p>{favoritesError}</p>
                  {needsCommunityLogin && (
                    <button
                      type="button"
                      onClick={handleCommunityLogin}
                      className="mt-3 rounded-xl bg-purple-600 px-4 py-2 text-xs font-bold text-slate-900 transition-colors hover:bg-purple-500"
                    >
                      登录或注册
                    </button>
                  )}
                </div>
              ) : favoritePosts.length === 0 ? (
                <div className="py-16 flex flex-col items-center justify-center text-center space-y-3 bg-white/60 border border-slate-200/80 rounded-3xl p-8">
                  <Heart className="w-8 h-8 text-purple-600" />
                  <h3 className="text-base font-black text-slate-900">喜欢的作品为 0</h3>
                  <p className="text-xs text-slate-500">在社区收藏作品后，会显示在这里。</p>
                </div>
              ) : (
                <div className="profile-card-grid grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                  {favoritePosts.map(pattern => (
                    <article key={pattern.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                      <img src={pattern.imageUrl} alt={pattern.title} className="aspect-[4/3] w-full object-cover" />
                      <div className="space-y-1.5 p-3">
                        <h4 className="truncate text-sm font-bold text-slate-900">{pattern.title}</h4>
                        <p className="truncate text-xs text-slate-500">{pattern.author.displayName}</p>
                        <div className="flex items-center gap-1 text-xs font-bold text-rose-700">
                          <Heart className="w-3.5 h-3.5 fill-current" />
                          {pattern.favoriteCount}
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Published works are a subset of the library and share its card view. */}
          {(activeTab === 'works' || activeTab === 'library') && (
            <div className="space-y-4 animate-in fade-in duration-200">
              
              {/* Header Info */}
              <div className="profile-library-heading flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 bg-purple-50/30 border border-purple-200/40 p-3.5 rounded-2xl">
                <div className="flex items-center gap-2">
                  <FolderHeart className="w-5 h-5 text-pink-400" />
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">{activeTab === 'works' ? '我的作品 · 已发布作品' : '我的图库 · 全部工程'}</h3>
                    <p className="text-xs text-slate-500">{activeTab === 'works' ? `已发布 ${publishedPatternCount} 个作品，可继续编辑或删除。` : `共 ${libraryPatternCount} 个本地或云端工程，包含已发布作品。`}</p>
                  </div>
                </div>
                <button
                  onClick={loadSavedPatterns}
                  className="px-2.5 py-1 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-bold flex items-center gap-1 cursor-pointer self-end sm:self-auto"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>刷新图库</span>
                </button>
              </div>

              {/* Toast Message Alert */}
              {actionMessage && (
                <div className="p-3 bg-purple-100/60 border border-purple-500/80 rounded-2xl text-purple-900 text-xs font-bold flex items-center justify-between animate-fade-in shadow-lg">
                  <span>{actionMessage}</span>
                  <button onClick={() => setActionMessage(null)} className="text-purple-600 hover:text-slate-900">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}

              {/* Loading State */}
              {loadingPatterns ? (
                <div className="py-16 flex flex-col items-center justify-center text-slate-500 gap-3">
                  <Loader2 className="w-8 h-8 animate-spin text-purple-600" />
                  <span className="text-xs font-bold">正在读取{activeTab === 'works' ? '已发布作品' : '我的图库'}...</span>
                </div>
              ) : activePatternRecords.length === 0 ? (
                /* Empty State */
                <div className="py-16 flex flex-col items-center justify-center text-center space-y-3 bg-white/60 border border-slate-200/80 rounded-3xl p-8">
                  <div className="w-16 h-16 rounded-3xl bg-slate-50 border border-slate-200 flex items-center justify-center text-pink-400">
                    <FolderHeart className="w-8 h-8" />
                  </div>
                  <h3 className="text-base font-black text-slate-900">{activeTab === 'works' ? '已发布作品为 0' : '我的图库图纸为 0'}</h3>
                  <p className="text-xs text-slate-500 max-w-md">
                    {activeTab === 'works' ? '从我的图库发布作品后，会显示在这里，工程仍保留在图库。' : '在画板完成拼豆设计后，点击顶部【保存】即可存入【我的图库】。'}
                  </p>
                  <button
                    onClick={onClose}
                    className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-slate-900 text-xs font-bold transition-all cursor-pointer"
                  >
                    前往画板创作
                  </button>
                </div>
              ) : (
                /* Saved Pattern Cards Grid */
                <div className="profile-card-grid grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                  {activePatternRecords.map(record => {
                    const isBusy = actionBusyId === record.id;
                    return (
                      <div
                        key={record.id}
                        className="profile-pattern-card group bg-white border border-slate-200 hover:border-purple-500/80 rounded-2xl overflow-hidden flex flex-col transition-all hover:shadow-xl hover:shadow-purple-950/30 relative"
                      >
                        {/* Cover Preview Thumbnail */}
                        <div
                          className="cursor-pointer relative group-hover:opacity-95 transition-opacity"
                          onClick={() => setSelectedPatternForAction(record)}
                        >
                          <PatternCoverThumbnail record={record} userId={currentUser?.uid || null} />
                          
                          {/* Top Specs Pill */}
                          <div className="absolute top-2 left-2 bg-white/85 backdrop-blur-md px-2 py-0.5 rounded-lg text-[10px] font-bold text-purple-600 border border-slate-200">
                            {record.width}×{record.height} 粒
                          </div>
                          <div className="absolute top-2 right-2 bg-white/85 backdrop-blur-md px-2 py-0.5 rounded-lg text-[10px] font-extrabold text-amber-700 border border-slate-200">
                            {record.totalBeads} 粒
                          </div>
                        </div>

                        {/* Card Info */}
                        <div className="p-3.5 space-y-2 flex-1 flex flex-col justify-between">
                          <div>
                            <h4
                              onClick={() => setSelectedPatternForAction(record)}
                              className="text-xs font-extrabold text-slate-900 hover:text-purple-600 truncate cursor-pointer"
                              title={record.title}
                            >
                              {record.title}
                            </h4>
                            <div className="text-[10px] text-slate-500 mt-1 flex items-center justify-between">
                              <span>更新时间: {formatChinaDate(record.updatedAt)}</span>
                              <span className="text-purple-600 font-medium">{(record.status ?? 0) === 1 ? '已发布' : '未发布'}</span>
                            </div>
                          </div>

                          {/* Action Buttons: [编辑], [发布], [删除] */}
                          <div className={`pt-2 border-t border-slate-200/80 grid ${activeTab === 'library' && (record.status ?? 0) === 0 && onPublishPattern ? 'grid-cols-3' : 'grid-cols-2'} gap-1.5 text-[11px] font-bold`}>
                            {/* 编辑 */}
                            <button
                              disabled={isBusy}
                              onClick={() => handleEditPattern(record)}
                              className="profile-edit-button py-1.5 px-2 rounded-xl bg-purple-100/60 hover:bg-purple-600 text-purple-800 hover:text-slate-900 border border-purple-200/50 flex items-center justify-center gap-1 transition-all cursor-pointer disabled:opacity-50"
                              title="编辑图纸（载入画板）"
                            >
                              <Pencil className="w-3 h-3 text-purple-600" />
                              <span>编辑</span>
                            </button>

                            {activeTab === 'library' && (record.status ?? 0) === 0 && onPublishPattern && (
                              <button
                                disabled={isBusy}
                                onClick={() => onPublishPattern(record)}
                                className="py-1.5 px-2 rounded-xl bg-emerald-50/60 hover:bg-emerald-600 text-emerald-800 hover:text-slate-900 border border-emerald-700/50 flex items-center justify-center gap-1 transition-all cursor-pointer disabled:opacity-50"
                                title="发布到社区"
                              >
                                <Sparkles className="w-3 h-3 text-emerald-700" />
                                <span>发布</span>
                              </button>
                            )}

                            {/* 删除 */}
                            <button
                              disabled={isBusy}
                              onClick={() => handleDeletePattern(record)}
                              className="py-1.5 px-2 rounded-xl bg-rose-50/60 hover:bg-rose-700 text-rose-700 hover:text-slate-900 border border-rose-200/50 flex items-center justify-center gap-1 transition-all cursor-pointer disabled:opacity-50"
                              title="从我的图库删除"
                            >
                              <Trash2 className="w-3 h-3 text-rose-600" />
                              <span>删除</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB 5: 豆仓·我的库存 (IMAGE 1 EXPAT REFERENCE) */}
          {activeTab === 'inventory' && (
            <div className="space-y-5 animate-in fade-in duration-200">
              
              {/* Header Title Bar */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Package className="w-5 h-5 text-amber-700" />
                  <h3 className="text-base font-black text-slate-900">豆仓 · 我的库存</h3>
                </div>
                <div className="text-xs text-slate-500 font-medium">
                  本机保存个人拼豆色号储备与预警
                </div>
              </div>

              {/* 3 Top Summary Stat Cards (Image 1 Style) */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {/* Stat 1: 总库存 */}
                <div className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-col items-center justify-center text-center shadow-md">
                  <span className="text-2xl font-black text-amber-700 tracking-tight">
                    {totalBeadStock.toLocaleString()}
                  </span>
                  <span className="text-xs font-bold text-slate-500 mt-0.5">总库存 (粒)</span>
                </div>

                {/* Stat 2: 有库存色号 */}
                <div className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-col items-center justify-center text-center shadow-md">
                  <span className="text-2xl font-black text-emerald-700 tracking-tight">
                    {inStockCount}/{inventoryList.length}
                  </span>
                  <span className="text-xs font-bold text-slate-500 mt-0.5">有库存色号</span>
                </div>

                {/* Stat 3: 预警色号 */}
                <div className="bg-rose-50/30 border border-rose-500/40 rounded-2xl p-4 flex flex-col items-center justify-center text-center shadow-md">
                  <span className="text-2xl font-black text-rose-600 tracking-tight flex items-center gap-1">
                    <AlertTriangle className="w-5 h-5" />
                    {alertCount}
                  </span>
                  <span className="text-xs font-bold text-rose-700 mt-0.5">⚠️ 预警色号</span>
                </div>
              </div>

              {/* Search & Batch Toolbar Bar */}
              <div className="flex flex-col sm:flex-row items-center gap-3">
                {/* Search Bar */}
                <div className="relative flex-1 w-full">
                  <input
                    type="text"
                    value={inventorySearch}
                    onChange={e => setInventorySearch(e.target.value)}
                    placeholder="🔍 搜索色号，如 A1, M01, 纯白..."
                    className="w-full pl-9 pr-4 py-2.5 rounded-2xl bg-white border border-slate-200 text-slate-900 placeholder-slate-500 text-xs font-bold focus:outline-none focus:ring-2 focus:ring-amber-500 transition-all"
                  />
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
                </div>

                {/* Batch & Add Actions Buttons */}
                <div className="flex items-center gap-2 w-full sm:w-auto shrink-0 flex-wrap sm:flex-nowrap">
                  <button
                    onClick={() => setIsAddColorOpen(true)}
                    className="flex-1 sm:flex-initial px-4 py-2.5 rounded-2xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-md shadow-amber-500/20 active:scale-95"
                  >
                    <Plus className="w-4 h-4 text-slate-950" />
                    <span>+ 添加新色号</span>
                  </button>

                  <button
                    onClick={() => setIsBatchSetOpen(true)}
                    className="flex-1 sm:flex-initial px-3.5 py-2.5 rounded-2xl bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-700 text-xs font-extrabold flex items-center justify-center gap-1.5 transition-all cursor-pointer active:scale-95"
                  >
                    <Package className="w-3.5 h-3.5 text-amber-700" />
                    <span>批量设置</span>
                  </button>

                  <button
                    onClick={() => setIsBatchDeltaOpen(true)}
                    className="flex-1 sm:flex-initial px-3.5 py-2.5 rounded-2xl bg-slate-100 hover:bg-slate-200 border border-slate-200 text-purple-600 text-xs font-extrabold flex items-center justify-center gap-1.5 transition-all cursor-pointer active:scale-95"
                  >
                    <SlidersHorizontal className="w-3.5 h-3.5 text-purple-600" />
                    <span>±N 批量加减</span>
                  </button>
                </div>
              </div>

              {/* Filter Tabs Row 1: Stock Status Filter */}
              <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
                <button
                  onClick={() => setStatusFilter('all')}
                  className={`px-3 py-1 rounded-xl text-xs font-extrabold transition-all cursor-pointer ${
                    statusFilter === 'all'
                      ? 'bg-amber-500 text-slate-950 font-black shadow-sm'
                      : 'bg-white text-slate-500 hover:text-slate-900'
                  }`}
                >
                  全部 ({inventoryList.length})
                </button>

                <button
                  onClick={() => setStatusFilter('in_stock')}
                  className={`px-3 py-1 rounded-xl text-xs font-extrabold transition-all cursor-pointer ${
                    statusFilter === 'in_stock'
                      ? 'bg-emerald-500 text-slate-950 font-black shadow-sm'
                      : 'bg-white text-slate-500 hover:text-slate-900'
                  }`}
                >
                  有库存 ({inStockCount})
                </button>

                <button
                  onClick={() => setStatusFilter('alert')}
                  className={`px-3 py-1 rounded-xl text-xs font-extrabold transition-all cursor-pointer ${
                    statusFilter === 'alert'
                      ? 'bg-rose-500 text-slate-900 font-black shadow-sm'
                      : 'bg-white text-rose-600 hover:bg-rose-50/40'
                  }`}
                >
                  预警色号 ({alertCount})
                </button>
              </div>

              {/* Filter Tabs Row 2: Letter Code Prefix Filter */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
                <span className="text-[11px] font-bold text-slate-500 shrink-0 mr-1">色号分组:</span>
                {['all', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'M'].map(letter => (
                  <button
                    key={letter}
                    onClick={() => setLetterFilter(letter)}
                    className={`px-3 py-1 rounded-xl text-xs font-bold shrink-0 transition-all cursor-pointer ${
                      letterFilter === letter
                        ? 'bg-purple-600 text-slate-900 shadow-sm'
                        : 'bg-white border border-slate-200/80 text-slate-500 hover:text-slate-900'
                    }`}
                  >
                    {letter === 'all' ? '全部' : letter}
                  </button>
                ))}
              </div>

              {/* Grid of Bead Color Inventory Cards (Image 1 Style) */}
              {filteredInventory.length === 0 ? (
                <div className="py-12 text-center text-slate-500 text-xs font-bold bg-white/40 rounded-2xl border border-slate-200/60">
                  没有匹配的拼豆色号库存
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3">
                  {filteredInventory.map(item => {
                    const isAlert = item.count <= item.alertThreshold;
                    return (
                      <div
                        key={item.inventoryKey}
                        className={`bg-white rounded-2xl border p-2.5 flex flex-col justify-between transition-all hover:border-amber-500/80 ${
                          isAlert
                            ? 'border-rose-500/50 bg-gradient-to-b from-rose-950/20 to-slate-950'
                            : 'border-slate-200'
                        }`}
                      >
                        {/* Top Color Box Swatch */}
                        <div
                          className="h-14 rounded-xl relative overflow-hidden flex items-center justify-center p-1 shadow-inner"
                          style={{ backgroundColor: item.hex }}
                        >
                          <span className="px-2 py-0.5 rounded-lg bg-black/60 backdrop-blur-md text-slate-900 font-black text-xs shadow-md">
                            {item.code}
                          </span>
                        </div>

                        {/* Middle Color Name & Quantity Info */}
                        <div className="my-2 text-center space-y-0.5">
                          <div className="text-[11px] font-bold text-slate-600 truncate">
                            {item.name}
                          </div>
                          <div className="text-base font-black text-slate-900 flex items-center justify-center gap-1">
                            <span>{item.count}</span>
                            <span className="text-[10px] text-slate-500 font-medium">粒</span>
                          </div>
                          {isAlert && (
                            <div className="text-[10px] font-bold text-rose-600 flex items-center justify-center gap-0.5">
                              <AlertTriangle className="w-3 h-3" />
                              <span>⚠️ 预警(&lt;{item.alertThreshold})</span>
                            </div>
                          )}
                        </div>

                        {/* Bottom - / + Adjust Buttons */}
                        <div className="flex items-center gap-1.5 pt-1 border-t border-slate-200/80">
                          <button
                            onClick={() => handleAdjustCount(item.inventoryKey, -100)}
                            className="flex-1 py-1 rounded-lg bg-slate-50 hover:bg-slate-100 border border-slate-200/80 text-slate-600 font-bold text-xs flex items-center justify-center transition-colors active:scale-95 cursor-pointer"
                            title="-100粒"
                          >
                            <Minus className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => handleAdjustCount(item.inventoryKey, 100)}
                            className="flex-1 py-1 rounded-lg bg-slate-50 hover:bg-slate-100 border border-slate-200/80 text-amber-700 font-bold text-xs flex items-center justify-center transition-colors active:scale-95 cursor-pointer"
                            title="+100粒"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

        </div>
      </div>

      {/* Modal 1: Batch Set Stock Value */}
      {isBatchSetOpen && (
        <div className="fixed inset-0 z-60 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-50 border border-slate-200 p-5 rounded-3xl max-w-sm w-full space-y-4 text-slate-800">
            <h4 className="text-sm font-black text-slate-900 flex items-center gap-2">
              <Package className="w-4 h-4 text-amber-700" />
              <span>批量设定所有色号库存</span>
            </h4>
            <p className="text-xs text-slate-500">将豆仓内所有拼豆色号的存量统一设定为：</p>
            <input
              type="number"
              value={batchSetValue}
              onChange={e => setBatchSetValue(Number(e.target.value))}
              className="w-full px-4 py-2.5 rounded-xl bg-white border border-slate-200 text-slate-900 text-sm font-bold"
              min={0}
            />
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setIsBatchSetOpen(false)}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-bold"
              >
                取消
              </button>
              <button
                onClick={handleApplyBatchSet}
                className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs"
              >
                确认应用
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Selected Saved Pattern Actions Overlay (编辑 / 发布 / 删除) */}
      {selectedPatternForAction && (
        <div className="fixed inset-0 z-60 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-slate-50 border border-slate-200 rounded-3xl p-5 max-w-md w-full space-y-4 text-slate-800 shadow-2xl relative">
            <button
              onClick={() => setSelectedPatternForAction(null)}
              className="absolute top-4 right-4 text-slate-500 hover:text-slate-900"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-purple-500/20 border border-purple-500/30 text-purple-600 flex items-center justify-center">
                <FolderHeart className="w-5 h-5 text-pink-400" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">{selectedPatternForAction.title}</h3>
                <p className="text-xs text-slate-500">
                  {selectedPatternForAction.width}×{selectedPatternForAction.height} 粒 · 共 {selectedPatternForAction.totalBeads} 粒拼豆
                </p>
                <p className="mt-1 text-[11px] font-medium text-purple-600">
                  {(selectedPatternForAction.status ?? 0) === 1 ? '已发布到社区' : '未发布图纸'}
                </p>
              </div>
            </div>

            <div className="rounded-2xl overflow-hidden bg-white p-2 border border-slate-200 max-h-56 flex items-center justify-center">
              <PatternCoverThumbnail record={selectedPatternForAction} userId={currentUser?.uid || null} />
            </div>

            <div className="space-y-2 pt-2">
              <button
                onClick={() => handleEditPattern(selectedPatternForAction)}
                className="w-full py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-slate-900 font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer shadow-lg shadow-purple-600/30"
              >
                <Pencil className="w-4 h-4" />
                <span>编辑图纸（载入画板继续制作）</span>
              </button>

              <button
                onClick={() => handleDeletePattern(selectedPatternForAction)}
                className="w-full py-2.5 rounded-xl bg-rose-50/80 hover:bg-rose-800 text-rose-700 font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer border border-rose-200/80"
              >
                <Trash2 className="w-4 h-4 text-rose-600" />
                <span>从我的图库删除此图纸</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal 3: Add Custom Color Code Modal */}
      {isAddColorOpen && (
        <div className="fixed inset-0 z-60 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-slate-50 border border-slate-200 p-6 rounded-3xl max-w-md w-full space-y-4 text-slate-800 relative shadow-2xl">
            <button
              onClick={() => setIsAddColorOpen(false)}
              className="absolute top-4 right-4 text-slate-500 hover:text-slate-900"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-amber-500/20 border border-amber-500/30 text-amber-700 flex items-center justify-center">
                <Plus className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-base font-black text-slate-900">添加新拼豆色号</h4>
                <p className="text-xs text-slate-500">录入自定义色号储备并加入您的豆仓库存</p>
              </div>
            </div>

            {/* Form Fields */}
            <div className="space-y-3 pt-2">
              <div className="grid grid-cols-2 gap-3">
                {/* Color Code */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 mb-1">
                    色号编号 <span className="text-amber-700">*</span>
                  </label>
                  <input
                    type="text"
                    value={newColorCode}
                    onChange={e => setNewColorCode(e.target.value)}
                    placeholder="如 M13, A24, X01"
                    className="w-full px-3 py-2 rounded-xl bg-white border border-slate-200 text-slate-900 text-xs font-bold uppercase placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>

                {/* Color Name */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 mb-1">颜色名称</label>
                  <input
                    type="text"
                    value={newColorName}
                    onChange={e => setNewColorName(e.target.value)}
                    placeholder="如 薄荷绿, 马卡龙粉"
                    className="w-full px-3 py-2 rounded-xl bg-white border border-slate-200 text-slate-900 text-xs font-bold placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
              </div>

              {/* Color Hex & Preview */}
              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1">颜色 (HEX / 调色盘)</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={newColorHex}
                    onChange={e => setNewColorHex(e.target.value)}
                    className="w-10 h-9 rounded-xl bg-white border border-slate-200 cursor-pointer p-0.5"
                  />
                  <input
                    type="text"
                    value={newColorHex}
                    onChange={e => setNewColorHex(e.target.value)}
                    placeholder="#A8DADC"
                    className="flex-1 px-3 py-2 rounded-xl bg-white border border-slate-200 text-slate-900 font-mono text-xs font-bold focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                  {/* Color Swatch Preview Box */}
                  <div
                    className="w-16 h-9 rounded-xl border border-slate-200 shadow-inner flex items-center justify-center font-black text-[10px] text-slate-900 drop-shadow-md"
                    style={{ backgroundColor: newColorHex }}
                  >
                    {newColorCode || '预览'}
                  </div>
                </div>

                {/* Quick Color Presets */}
                <div className="flex items-center gap-1.5 mt-2 overflow-x-auto pb-1 scrollbar-none">
                  <span className="text-[10px] font-bold text-slate-500 shrink-0">预设色卡:</span>
                  {[
                    { hex: '#F8BBD0', name: '粉' },
                    { hex: '#E1BEE7', name: '紫' },
                    { hex: '#BBDEFB', name: '蓝' },
                    { hex: '#B2DFDB', name: '绿' },
                    { hex: '#FFF9C4', name: '黄' },
                    { hex: '#FFE0B2', name: '橙' },
                    { hex: '#D7CCC8', name: '咖' },
                    { hex: '#000000', name: '黑' },
                    { hex: '#FFFFFF', name: '白' },
                  ].map(p => (
                    <button
                      key={p.hex}
                      onClick={() => setNewColorHex(p.hex)}
                      className="w-6 h-6 rounded-lg border border-slate-200 shrink-0 shadow-xs hover:scale-110 transition-transform cursor-pointer"
                      style={{ backgroundColor: p.hex }}
                      title={p.name}
                    />
                  ))}
                </div>
              </div>

              {/* Initial Count & Alert Threshold */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 mb-1">初始库存数量 (粒)</label>
                  <input
                    type="number"
                    value={newColorCount}
                    onChange={e => setNewColorCount(Number(e.target.value))}
                    min={0}
                    className="w-full px-3 py-2 rounded-xl bg-white border border-slate-200 text-slate-900 text-xs font-bold focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-500 mb-1">库存预警门槛 (粒)</label>
                  <input
                    type="number"
                    value={newColorAlert}
                    onChange={e => setNewColorAlert(Number(e.target.value))}
                    min={0}
                    className="w-full px-3 py-2 rounded-xl bg-white border border-slate-200 text-slate-900 text-xs font-bold focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200">
              <button
                onClick={() => setIsAddColorOpen(false)}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-bold text-slate-600 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleAddCustomColor}
                className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs shadow-md shadow-amber-500/20 transition-all active:scale-95 cursor-pointer"
              >
                确认添加色号
              </button>
            </div>
          </div>
        </div>
      )}

      </ErrorBoundary>
    </div>
  );
};
