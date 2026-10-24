import React, { useState, useEffect, useLayoutEffect, useCallback, useRef, useSyncExternalStore } from 'react';
import {
  X,
  User,
  Settings,
  Edit3,
  Heart,
  Bookmark,
  Package,
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
  Check,
  Cloud,
  RefreshCw,
  Compass,
  ShieldCheck,
} from 'lucide-react';
import './UserProfileModal.css';
import { useAuth } from '../context/AuthContext';
import type { CommunityPattern } from '../data/communityData';
import {
  listFavoriteCommunityPosts,
  setCommunityPostVisibility,
  withdrawCommunityPost,
  type CommunityPost,
  type CommunityPostVisibility,
} from '../utils/communityApi';
import { ErrorBoundary } from './ErrorBoundary';
import {
  getUserExportedPatterns,
  getPatternProject,
  deleteCloudExportedPatternAndLocal,
  deleteLocalExportedPatternCopy,
  getExportedPatternPreview,
  normalizePatternTitle,
  patternDeletionActions,
  requiresExplicitCloudBinding,
  retryPatternCloudSync,
  renameExportedPattern,
  type ExportedPatternRecord,
} from '../utils/patternHistory';
import { formatChinaDate } from '../utils/dateUtils';
import type { ContinueEditingPattern } from '../utils/savedPatternNavigation';
import {
  getBeadInventorySnapshot,
  getServerBeadInventorySnapshot,
  subscribeBeadInventory,
  type BeadInventory,
} from '../utils/beadInventory';
import { BeadInventoryPanel } from './BeadInventoryPanel';
import { PatternConfirmDialog } from './PatternConfirmDialog';
import { PatternPublicationDialog } from './PatternPublicationDialog';
import { PatternPublishDialog } from './PatternPublishDialog';
import { isPatternPublicationUnlocked, publishCommunityPattern, type CommunityPublicationMetadata } from '../utils/communityPatternPublication';

export function splitProfilePatternSections(records: readonly ExportedPatternRecord[], currentUserId: string | null): {
  libraryRecords: ExportedPatternRecord[];
  publishedRecords: ExportedPatternRecord[];
} {
  const libraryRecords = records.filter((record) => record.status !== 2
    && (record.userId === null || record.userId === currentUserId));
  return {
    libraryRecords,
    publishedRecords: currentUserId
      ? libraryRecords.filter((record) => isPublishedRecord(record) && record.userId === currentUserId)
      : [],
  };
}

function isPublishedRecord(record: ExportedPatternRecord): boolean {
  // New cloud summaries carry the active community post explicitly. Keep the
  // status fallback for legacy local records created before this metadata existed.
  return Boolean(record.communityPost) || record.status === 1;
}

function publicationLabel(record: ExportedPatternRecord): string {
  if (record.communityPost?.visibility === 'private') return '私密';
  if (record.communityPost?.visibility === 'public') return '公开';
  return record.status === 1 ? '已发布' : '未发布';
}

interface UserProfileModalProps {
  isOpen: boolean;
  initialTab?: 'works' | 'likes' | 'library' | 'inventory';
  onClose: () => void;
  onOpenAccountManagement: () => void;
  onOpenVipModal?: () => void;
  onSelectPattern?: (pattern: CommunityPattern) => void;
  onContinueEditing?: ContinueEditingPattern;
  onOpenCommunity?: () => void;
  onOpenAdminPanel?: () => void;
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
  onOpenCommunity,
  onOpenAdminPanel,
}) => {
  const { userProfile, isVip, isPro, currentUser, canAccessAdmin, refreshProfile } = useAuth();
  const refreshProfileRef = useRef(refreshProfile);
  refreshProfileRef.current = refreshProfile;
  useEffect(() => {
    if (!isOpen || !currentUser || typeof window === 'undefined') return;
    const refresh = () => { void refreshProfileRef.current().catch(() => {}); };
    refresh();
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [isOpen, currentUser?.uid]);
  const currentUserRef = useRef(currentUser);
  currentUserRef.current = currentUser;
  const operationEpochRef = useRef(0);
  const actionLockRef = useRef<symbol | null>(null);
  const publishLockRef = useRef<symbol | null>(null);
  const closeProfile = useCallback(() => {
    operationEpochRef.current += 1;
    actionLockRef.current = null;
    publishLockRef.current = null;
    onClose();
  }, [onClose]);
  const isCurrentOperation = useCallback((epoch: number, userId: string | null): boolean => (
    operationEpochRef.current === epoch && currentUserRef.current?.uid === userId
  ), []);
  const openLoginModal = useCallback(() => {
    closeProfile();
    window.dispatchEvent(new Event('unauthorized'));
  }, [closeProfile]);
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
  const [pendingDeletePattern, setPendingDeletePattern] = useState<{ record: ExportedPatternRecord; scope: 'local' | 'cloud' } | null>(null);
  const [deleteDialogError, setDeleteDialogError] = useState<string | null>(null);
  const [publicationTarget, setPublicationTarget] = useState<ExportedPatternRecord | null>(null);
  const [publicationDialogError, setPublicationDialogError] = useState<string | null>(null);
  const [publishTarget, setPublishTarget] = useState<ExportedPatternRecord | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const editRequestRef = useRef(0);
  const loadRequestRef = useRef(0);
  const favoriteRequestRef = useRef(0);
  const continueEditingRef = useRef(onContinueEditing);
  continueEditingRef.current = onContinueEditing;
  useLayoutEffect(() => {
    operationEpochRef.current += 1;
    editRequestRef.current += 1;
    loadRequestRef.current += 1;
    favoriteRequestRef.current += 1;
    actionLockRef.current = null;
    publishLockRef.current = null;
    setActionBusyId(null);
    setSavedPatterns([]);
    setFavoritePosts([]);
    setLoadingPatterns(false);
    setLoadingFavorites(false);
    setFavoritesError(null);
    setActionMessage(null);
    setEditingId(null);
    setDraftTitle('');
    setPendingDeletePattern(null);
    setDeleteDialogError(null);
    setPublishError(null);
    setPublicationDialogError(null);
    setPublishTarget(null);
    setPublicationTarget(null);
    setSelectedPatternForAction(null);
    return () => { operationEpochRef.current += 1; };
  }, [currentUser?.uid, isOpen]);

  const { libraryRecords, publishedRecords } = splitProfilePatternSections(savedPatterns, currentUser?.uid ?? null);
  const libraryPatternCount = libraryRecords.length;
  const publishedPatternCount = publishedRecords.length;
  const activePatternRecords = activeTab === 'works' ? publishedRecords : libraryRecords;

  const loadSavedPatterns = useCallback(async (): Promise<void> => {
    const epoch = operationEpochRef.current;
    const userId = currentUserRef.current?.uid ?? null;
    const request = ++loadRequestRef.current;
    setLoadingPatterns(true);
    try {
      const list = await getUserExportedPatterns(userId);
      if (!isCurrentOperation(epoch, userId) || request !== loadRequestRef.current) return;
      setSavedPatterns(list.filter((record) => (record.status ?? 0) !== 2));
    } catch (error) {
      if (isCurrentOperation(epoch, userId) && request === loadRequestRef.current) {
        setActionMessage(error instanceof Error ? error.message : '无法读取我的图库，请重试。');
      }
    } finally {
      if (isCurrentOperation(epoch, userId) && request === loadRequestRef.current) setLoadingPatterns(false);
    }
  }, [isCurrentOperation]);

  useEffect(() => {
    if (isOpen) void loadSavedPatterns();
  }, [currentUser?.uid, isOpen, loadSavedPatterns]);

  const loadFavoritePosts = useCallback(async () => {
    if (!requireFormalLogin('请登录或注册后再查看喜欢列表。')) {
      setFavoritePosts([]);
      setFavoritesError(FORMAL_LOGIN_REQUIRED_MESSAGE);
      return;
    }
    setLoadingFavorites(true);
    setFavoritesError(null);
    const epoch = operationEpochRef.current;
    const userId = currentUserRef.current?.uid ?? null;
    const request = ++favoriteRequestRef.current;
    const isCurrent = () => isCurrentOperation(epoch, userId) && request === favoriteRequestRef.current;
    try {
      const result = await listFavoriteCommunityPosts();
      if (!isCurrent()) return;
      if (!result.ok || !result.data) {
        setFavoritePosts([]);
        setFavoritesError(displayFavoriteError(result.error));
        return;
      }
      setFavoritePosts(result.data.posts);
    } catch (error) {
      if (isCurrent()) setFavoritesError(error instanceof Error ? error.message : '无法读取喜欢列表');
    } finally {
      if (isCurrent()) setLoadingFavorites(false);
    }
  }, [isCurrentOperation, requireFormalLogin]);
  useEffect(() => {
    if (isOpen && activeTab === 'likes') void loadFavoritePosts();
  }, [activeTab, isOpen, loadFavoritePosts]);
  const handleOpenLikes = (): void => {
    if (activeTab === 'likes') void loadFavoritePosts();
    else setActiveTab('likes');
  };
  const beginAction = (recordId: string): { token: symbol; epoch: number; userId: string | null } | null => {
    if (actionLockRef.current || publishLockRef.current) return null;
    const token = Symbol(recordId);
    const epoch = operationEpochRef.current;
    const userId = currentUserRef.current?.uid ?? null;
    actionLockRef.current = token;
    // A refresh started before this mutation must not overwrite its result.
    loadRequestRef.current += 1;
    setLoadingPatterns(false);
    setActionBusyId(recordId);
    setActionMessage(null);
    return { token, epoch, userId };
  };
  const finishAction = (operation: { token: symbol; epoch: number; userId: string | null }): void => {
    if (actionLockRef.current === operation.token) actionLockRef.current = null;
    if (isCurrentOperation(operation.epoch, operation.userId)) setActionBusyId(null);
  };

  const handleEditPattern = async (record: ExportedPatternRecord): Promise<void> => {
    if (!requireFormalLogin('请登录或注册后再编辑个人图纸。')) return;
    const operation = beginAction(record.id);
    if (!operation) return;
    const request = ++editRequestRef.current;
    try {
      const project = await getPatternProject(record.id, operation.userId);
      if (!isCurrentOperation(operation.epoch, operation.userId) || request !== editRequestRef.current || !continueEditingRef.current) return;
      const accepted = await continueEditingRef.current(project);
      if (isCurrentOperation(operation.epoch, operation.userId) && request === editRequestRef.current && accepted !== false) closeProfile();
    } catch (error) {
      if (isCurrentOperation(operation.epoch, operation.userId) && request === editRequestRef.current) setActionMessage(error instanceof Error ? error.message : '载入图纸项目失败，请重试。');
    } finally {
      finishAction(operation);
    }
  };

  const startRename = (record: ExportedPatternRecord): void => {
    setEditingId(record.id);
    setDraftTitle(record.title);
    setActionMessage(null);
  };
  const cancelRename = (): void => { setEditingId(null); setDraftTitle(''); };
  const handleRename = async (record: ExportedPatternRecord): Promise<void> => {
    if (!requireFormalLogin('请登录或注册后再重命名个人图纸。')) return;
    let title: string;
    try { title = normalizePatternTitle(draftTitle); } catch (error) { setActionMessage(error instanceof Error ? error.message : '图纸名称不合法。'); return; }
    const operation = beginAction(record.id);
    if (!operation) return;
    try {
      const updated = await renameExportedPattern(record, operation.userId, title);
      if (!isCurrentOperation(operation.epoch, operation.userId)) return;
      setSavedPatterns((items) => items.map((item) => item.id === record.id ? { ...item, title: updated.title, updatedAt: updated.updatedAt, syncState: updated.syncState } : item));
      cancelRename();
    } catch (error) {
      if (isCurrentOperation(operation.epoch, operation.userId)) setActionMessage(error instanceof Error ? error.message : '重命名失败，请重试。');
    } finally { finishAction(operation); }
  };

  const handleSyncToCurrentAccount = async (record: ExportedPatternRecord): Promise<void> => {
    if (!requireFormalLogin('请登录或注册后再同步个人图纸。')) return;
    const operation = beginAction(record.id);
    if (!operation || !operation.userId) return;
    try {
      await retryPatternCloudSync(record.id, operation.userId);
      if (!isCurrentOperation(operation.epoch, operation.userId)) return;
      await loadSavedPatterns();
      if (isCurrentOperation(operation.epoch, operation.userId)) setActionMessage('已同步到当前账号的云端图库。');
    } catch (error) {
      if (isCurrentOperation(operation.epoch, operation.userId)) setActionMessage(error instanceof Error ? error.message : '云端同步失败，请重试。');
    } finally { finishAction(operation); }
  };

  const requestDeletePattern = (record: ExportedPatternRecord, scope: 'local' | 'cloud'): void => {
    if (!requireFormalLogin(scope === 'cloud' ? '请登录或注册后再删除云端图纸。' : '请登录或注册后再删除本机图纸。')) return;
    setSelectedPatternForAction(null);
    setDeleteDialogError(null);
    setPendingDeletePattern({ record, scope });
  };
  const handleDeletePattern = async (pending: { record: ExportedPatternRecord; scope: 'local' | 'cloud' }): Promise<void> => {
    const operation = beginAction(pending.record.id);
    if (!operation) return;
    setDeleteDialogError(null);
    try {
      if (pending.scope === 'cloud') await deleteCloudExportedPatternAndLocal(pending.record.id, operation.userId);
      else await deleteLocalExportedPatternCopy(pending.record.id, operation.userId);
      if (!isCurrentOperation(operation.epoch, operation.userId)) return;
      setSavedPatterns((records) => records.flatMap((record) => record.id !== pending.record.id
        ? [record]
        : pending.scope === 'local' && record.hasCloudCopy
          ? [{ ...record, hasLocalCopy: false, previewBlob: null }]
          : []));
      setPendingDeletePattern(null);
      setActionMessage(pending.scope === 'cloud' ? '云端图库工程及本机副本已删除，关联发布已撤回。' : '已删除当前浏览器中的本机副本，云端工程与发布状态不变。');
      await loadSavedPatterns();
    } catch (error) {
      if (isCurrentOperation(operation.epoch, operation.userId)) setDeleteDialogError(error instanceof Error ? error.message : '删除失败，请检查网络后重试。');
    } finally { finishAction(operation); }
  };

  const openPublishDialog = (record: ExportedPatternRecord): void => {
    if (actionLockRef.current || publishLockRef.current) return;
    if (!requireFormalLogin('请登录或注册后再发布作品。')) return;
    setSelectedPatternForAction(null);
    if (!isPatternPublicationUnlocked(record)) {
      setActionMessage('完成图纸后解锁发布。');
      return;
    }
    setPublishError(null);
    setPublishTarget(record);
  };
  const handlePublish = async (metadata: CommunityPublicationMetadata): Promise<void> => {
    const record = publishTarget;
    const userId = currentUserRef.current?.uid ?? null;
    if (!record || !userId || publishLockRef.current || actionLockRef.current) return;
    if (!requireFormalLogin('请登录或注册后再发布作品。')) return;
    if (!isPatternPublicationUnlocked(record)) { setPublishError('完成图纸后解锁发布。'); return; }
    const operation = beginAction(record.id);
    if (!operation) return;
    const { token, epoch } = operation;
    publishLockRef.current = token;
    setActionBusyId(record.id);
    setPublishError(null);
    setActionMessage(null);
    try {
      const result = await publishCommunityPattern({
        record,
        metadata,
        currentUserId: userId,
        isSessionCurrent: () => isCurrentOperation(epoch, userId),
      });
      if (!isCurrentOperation(epoch, userId)) return;
      if (result.ok === false) { if (!result.stale) setPublishError(result.error); return; }
      const publishedRecord = result.record;
      setSavedPatterns((records) => {
        const hasSyncedRecord = records.some((item) => item.id === publishedRecord.id);
        return records.map((item) => item.id === publishedRecord.id || (!hasSyncedRecord && item.id === record.id) ? publishedRecord : item);
      });
      setPublishTarget(null);
      setActionMessage(metadata.visibility === 'public' ? '作品已发布到社区，工程仍保留在我的图库。' : '作品已私密发布，不会出现在公开社区列表。');
      void result.localMark.then((outcome) => {
        if (outcome === 'warning' && isCurrentOperation(epoch, userId)) setActionMessage('已发布，图库本地状态更新失败，请刷新。');
      });
    } finally {
      if (publishLockRef.current === token) publishLockRef.current = null;
      finishAction(operation);
    }
  };

  const handleSetPublicationVisibility = async (record: ExportedPatternRecord, visibility: CommunityPostVisibility): Promise<void> => {
    if (!record.communityPost || !requireFormalLogin('请登录或注册后再管理发布状态。')) return;
    const operation = beginAction(record.id);
    if (!operation) return;
    setPublicationDialogError(null);
    try {
      const result = await setCommunityPostVisibility(record.communityPost.id, visibility);
      if (!result.ok) throw new Error(result.error ?? '作品可见性更新失败');
      if (!isCurrentOperation(operation.epoch, operation.userId)) return;
      setPublicationTarget(null);
      await loadSavedPatterns();
      if (isCurrentOperation(operation.epoch, operation.userId)) setActionMessage(visibility === 'public' ? '作品已公开，仍保留在我的图库。' : '作品已转为私密，仍保留在我的图库。');
    } catch (error) {
      if (isCurrentOperation(operation.epoch, operation.userId)) setPublicationDialogError(error instanceof Error ? error.message : '作品可见性更新失败，请重试');
    } finally { finishAction(operation); }
  };

  const handleWithdrawPublication = async (record: ExportedPatternRecord): Promise<void> => {
    if (!record.communityPost || !requireFormalLogin('请登录或注册后再撤回作品。')) return;
    const operation = beginAction(record.id);
    if (!operation) return;
    setPublicationDialogError(null);
    try {
      const result = await withdrawCommunityPost(record.communityPost.id);
      if (!result.ok) throw new Error(result.error ?? '撤回作品失败');
      if (!isCurrentOperation(operation.epoch, operation.userId)) return;
      setPublicationTarget(null);
      await loadSavedPatterns();
      if (isCurrentOperation(operation.epoch, operation.userId)) setActionMessage('作品已从豆社撤回，工程仍保留在我的图库。');
    } catch (error) {
      if (isCurrentOperation(operation.epoch, operation.userId)) setPublicationDialogError(error instanceof Error ? error.message : '撤回作品失败，请重试');
    } finally { finishAction(operation); }
  };
  const worksCount = publishedPatternCount;
  const needsCommunityLogin = favoritesError === GUEST_COMMUNITY_MESSAGE;

  const handleCommunityLogin = () => {
    openLoginModal();
  };

  // Shared inventory summary; brand catalog management lives in the inventory panel.
  const inventory: BeadInventory = useSyncExternalStore(subscribeBeadInventory, getBeadInventorySnapshot, getServerBeadInventorySnapshot);
  const inventoryList = Object.values(inventory);
  const alertCount = inventoryList.filter(item => item.count <= item.alertThreshold).length;

  if (!isOpen) return null;

  const displayName = userProfile?.displayName || currentUser?.displayName || (currentUser ? '已登录用户' : '未登录用户');

  return (
    <div role="dialog" aria-modal="true" aria-label="个人中心" className="profile-overlay fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-2 sm:p-4 overflow-y-auto">
      <ErrorBoundary fallbackTitle="个人中心界面加载遇到错误">
      <div className="profile-dialog relative w-full max-w-4xl bg-slate-50 border border-slate-200 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[94vh] text-slate-800 duration-200">
        
        {/* Profile Header Banner (Image 2 Inspired Dark Aesthetic) */}
        <div className="profile-header relative bg-gradient-to-b from-white via-white to-purple-50 p-5 sm:p-6 border-b border-slate-200/80">
          
          {/* Top Right Close Button */}
          <div className="absolute top-4 right-4 flex items-center gap-2 z-10">
            <button
              onClick={closeProfile}
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

              {currentUser && canAccessAdmin && (
                <a href="/admin" onClick={onOpenAdminPanel ? (event) => {
                  event.preventDefault(); closeProfile(); onOpenAdminPanel();
                } : undefined}
                  className="mt-3 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-purple-200 bg-white px-4 py-2 text-sm font-bold text-purple-800 transition-colors hover:bg-purple-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-600">
                  <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                  管理后台
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </a>
              )}

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
                  disabled={Boolean(actionBusyId)}
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
                    onClick={closeProfile}
                    className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-slate-900 text-xs font-bold transition-all cursor-pointer"
                  >
                    前往画板创作
                  </button>
                </div>
              ) : (
                /* Saved Pattern Cards Grid */
                <div className="profile-card-grid grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                  {activePatternRecords.map(record => {
                    const isBusy = Boolean(actionBusyId);
                    const isPublished = isPublishedRecord(record);
                    const deletionActions = patternDeletionActions(record);
                    const canBindToCurrentAccount = requiresExplicitCloudBinding(record, currentUser?.uid ?? null);
                    const canRetrySync = (record.syncState === 'failed' || record.syncState === 'pending') && record.userId === currentUser?.uid;
                    return (
                      <article key={record.id} className="profile-pattern-card group flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white transition-all hover:border-purple-500/80 hover:shadow-xl hover:shadow-purple-950/20">
                        <div className="cursor-pointer relative transition-opacity group-hover:opacity-95" onClick={() => setSelectedPatternForAction(record)}>
                          <PatternCoverThumbnail record={record} userId={currentUser?.uid || null} />
                          <div className="absolute top-2 left-2 rounded-lg border border-slate-200 bg-white/85 px-2 py-0.5 text-[10px] font-bold text-purple-600 backdrop-blur-md">{record.width}×{record.height} 粒</div>
                          <div className="absolute top-2 right-2 rounded-lg border border-slate-200 bg-white/85 px-2 py-0.5 text-[10px] font-extrabold text-amber-700 backdrop-blur-md">{record.totalBeads} 粒</div>
                        </div>
                        <div className="flex flex-1 flex-col justify-between space-y-2 p-3.5">
                          <div>
                            {editingId === record.id ? (
                              <div className="flex items-center gap-1">
                                <input value={draftTitle} maxLength={200} autoFocus disabled={isBusy} onChange={(event) => setDraftTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void handleRename(record); if (event.key === 'Escape') cancelRename(); }} aria-label="图纸名称" className="min-h-11 min-w-0 flex-1 rounded-xl border border-purple-300 px-2 text-xs font-bold text-slate-900 outline-none focus:ring-2 focus:ring-purple-200" />
                                <button type="button" disabled={isBusy} onClick={() => void handleRename(record)} aria-label="保存图纸名称" className="grid h-11 w-11 place-items-center rounded-xl text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"><Check className="h-4 w-4" /></button>
                                <button type="button" disabled={isBusy} onClick={cancelRename} aria-label="取消重命名" className="grid h-11 w-11 place-items-center rounded-xl text-slate-500 hover:bg-slate-100 disabled:opacity-50"><X className="h-4 w-4" /></button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1"><h4 onClick={() => setSelectedPatternForAction(record)} className="min-w-0 flex-1 cursor-pointer truncate text-xs font-extrabold text-slate-900 hover:text-purple-600" title={record.title}>{record.title}</h4><button type="button" disabled={isBusy} onClick={() => startRename(record)} aria-label="重命名图纸" className="grid h-11 w-11 place-items-center rounded-xl text-slate-500 hover:bg-purple-50 hover:text-purple-700 disabled:opacity-50"><Pencil className="h-3.5 w-3.5" /></button></div>
                            )}
                            <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-slate-500"><span>更新时间: {formatChinaDate(record.updatedAt)}</span><span className={record.communityPost?.visibility === 'private' ? 'font-medium text-amber-700' : 'font-medium text-purple-600'}>{publicationLabel(record)}</span></div>
                            <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] font-bold"><span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-slate-600">{record.syncState === 'synced' ? '已同步云端' : record.syncState === 'pending' ? '等待同步' : record.syncState === 'failed' ? '同步失败' : '仅本机保存'}</span>{record.userId === null && <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-amber-800">未绑定账号</span>}</div>
                            {record.syncError && <p className="mt-2 line-clamp-2 text-[10px] leading-4 text-rose-700">{record.syncError}</p>}
                          </div>
                          <div className="flex flex-wrap gap-1.5 border-t border-slate-200/80 pt-2 text-[11px] font-bold">
                            <button disabled={isBusy} onClick={() => void handleEditPattern(record)} className="inline-flex min-h-11 flex-1 items-center justify-center gap-1 rounded-xl border border-purple-200 bg-purple-50 px-2 text-purple-800 transition-colors hover:bg-purple-600 hover:text-white disabled:opacity-50"><Pencil className="h-3 w-3" />编辑</button>
                            {!isPublished && <button disabled={isBusy} onClick={() => openPublishDialog(record)} className="inline-flex min-h-11 flex-1 items-center justify-center gap-1 rounded-xl border border-emerald-200 bg-emerald-50 px-2 text-emerald-800 transition-colors hover:bg-emerald-600 hover:text-white disabled:opacity-50"><Sparkles className="h-3 w-3" />发布</button>}
                            {isPublished && record.communityPost && <button disabled={isBusy} onClick={() => setPublicationTarget(record)} className="inline-flex min-h-11 flex-1 items-center justify-center gap-1 rounded-xl border border-amber-200 bg-amber-50 px-2 text-amber-800 transition-colors hover:bg-amber-100 disabled:opacity-50"><SlidersHorizontal className="h-3 w-3" />发布管理</button>}
                            {isPublished && !record.communityPost && onOpenCommunity && <button disabled={isBusy} onClick={onOpenCommunity} className="inline-flex min-h-11 flex-1 items-center justify-center gap-1 rounded-xl border border-emerald-200 bg-emerald-50 px-2 text-emerald-800 transition-colors hover:bg-emerald-100 disabled:opacity-50"><Compass className="h-3 w-3" />进入社区</button>}
                            {canBindToCurrentAccount && <button disabled={isBusy} onClick={() => void handleSyncToCurrentAccount(record)} className="inline-flex min-h-11 flex-1 items-center justify-center gap-1 rounded-xl border border-sky-200 bg-sky-50 px-2 text-sky-800 transition-colors hover:bg-sky-100 disabled:opacity-50"><Cloud className="h-3 w-3" />绑定当前账号</button>}
                            {canRetrySync && <button disabled={isBusy} onClick={() => void handleSyncToCurrentAccount(record)} className="inline-flex min-h-11 flex-1 items-center justify-center gap-1 rounded-xl border border-amber-200 bg-amber-50 px-2 text-amber-800 transition-colors hover:bg-amber-100 disabled:opacity-50"><RefreshCw className={`h-3 w-3 ${isBusy ? 'animate-spin' : ''}`} />重试同步</button>}
                            {deletionActions.includes('local') && <button disabled={isBusy} onClick={() => requestDeletePattern(record, 'local')} className="inline-flex min-h-11 flex-1 items-center justify-center gap-1 rounded-xl border border-slate-200 px-2 text-slate-700 transition-colors hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50"><Trash2 className="h-3 w-3" />删除本机副本</button>}
                            {deletionActions.includes('cloud-and-local') && <button disabled={isBusy} onClick={() => requestDeletePattern(record, 'cloud')} className="inline-flex min-h-11 flex-1 items-center justify-center gap-1 rounded-xl border border-rose-200 bg-rose-50 px-2 text-rose-700 transition-colors hover:bg-rose-100 disabled:opacity-50"><Trash2 className="h-3 w-3" />{record.hasLocalCopy ? '删除云端及本机' : '删除云端记录'}</button>}
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Brand catalogs are read-only until an explicit quantity edit. */}
          {activeTab === 'inventory' && (
            <BeadInventoryPanel requireLogin={() => requireFormalLogin('请登录或注册后再修改拼豆库存。')} />
          )}

        </div>
      </div>

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
                  {publicationLabel(selectedPatternForAction)}
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

              {patternDeletionActions(selectedPatternForAction).includes('local') && (
                <button onClick={() => requestDeletePattern(selectedPatternForAction, 'local')} className="w-full min-h-11 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-700 transition-colors hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700">
                  删除本机副本
                </button>
              )}
              {patternDeletionActions(selectedPatternForAction).includes('cloud-and-local') && (
                <button onClick={() => requestDeletePattern(selectedPatternForAction, 'cloud')} className="w-full min-h-11 rounded-xl border border-rose-200 bg-rose-50 text-xs font-bold text-rose-700 transition-colors hover:bg-rose-100">
                  {selectedPatternForAction.hasLocalCopy ? '删除云端及本机' : '删除云端记录'}
                </button>
              )}
              {isPublishedRecord(selectedPatternForAction) && selectedPatternForAction.communityPost && (
                <button onClick={() => setPublicationTarget(selectedPatternForAction)} className="w-full min-h-11 rounded-xl border border-amber-200 bg-amber-50 text-xs font-bold text-amber-800 transition-colors hover:bg-amber-100"><SlidersHorizontal className="mr-2 inline h-4 w-4" />管理豆社发布状态</button>
              )}
              {isPublishedRecord(selectedPatternForAction) && !selectedPatternForAction.communityPost && onOpenCommunity && (
                <button onClick={onOpenCommunity} className="w-full min-h-11 rounded-xl border border-emerald-200 bg-emerald-50 text-xs font-bold text-emerald-800 transition-colors hover:bg-emerald-100"><Compass className="mr-2 inline h-4 w-4" />进入社区</button>
              )}
              {!isPublishedRecord(selectedPatternForAction) && (
                <button onClick={() => openPublishDialog(selectedPatternForAction)} className="w-full min-h-11 rounded-xl border border-emerald-200 bg-emerald-50 text-xs font-bold text-emerald-800 transition-colors hover:bg-emerald-100"><Sparkles className="mr-2 inline h-4 w-4" />发布到豆社</button>
              )}            </div>
          </div>
        </div>
      )}

      <PatternPublishDialog
        record={publishTarget}
        busy={Boolean(publishTarget && actionBusyId === publishTarget.id)}
        error={publishError}
        onClose={() => { if (!actionBusyId) { setPublishTarget(null); setPublishError(null); } }}
        onSubmit={(metadata) => { void handlePublish(metadata); }}
      />
      <PatternConfirmDialog
        isOpen={Boolean(pendingDeletePattern)}
        title="删除图库工程？"
        description={pendingDeletePattern
          ? pendingDeletePattern.scope === 'cloud'
            ? `《${pendingDeletePattern.record.title}》将从云端图库和本机副本中删除；关联的豆社作品也会撤回。`
            : `《${pendingDeletePattern.record.title}》只会从此浏览器删除本机副本；不会影响云端作品或豆社发布。`
          : ''}        confirmLabel="确认删除"
        busy={Boolean(pendingDeletePattern && actionBusyId === pendingDeletePattern.record.id)}
        error={deleteDialogError}
        onClose={() => { if (!actionBusyId) { setPendingDeletePattern(null); setDeleteDialogError(null); } }}
        onConfirm={() => { if (pendingDeletePattern) void handleDeletePattern(pendingDeletePattern); }}
      />

      <PatternPublicationDialog
        record={publicationTarget}
        busy={Boolean(publicationTarget && actionBusyId === publicationTarget.id)}
        error={publicationDialogError}
        onClose={() => { if (!actionBusyId) { setPublicationTarget(null); setPublicationDialogError(null); } }}
        onSetVisibility={(visibility) => {
          if (publicationTarget) void handleSetPublicationVisibility(publicationTarget, visibility);
        }}
        onWithdraw={() => {
          if (publicationTarget) void handleWithdrawPublication(publicationTarget);
        }}
        onRepublish={() => {
          if (publicationTarget) {
            setPublicationTarget(null);
            openPublishDialog(publicationTarget);
          }
        }}
      />

      </ErrorBoundary>
    </div>
  );
};
