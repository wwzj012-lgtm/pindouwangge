import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Cloud,
  Database,
  Grid,
  HardDrive,
  Image,
  Loader2,
  Pencil,
  RefreshCw,
  Trash2,
  Check,
  Compass,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import {
  deleteCloudExportedPatternAndLocal,
  deleteLocalExportedPatternCopy,
  getExportedPatternPreview,
  getPatternProject,
  markExportedPatternPublished,
  getUserExportedPatterns,
  normalizePatternTitle,
  patternDeletionActions,
  requiresExplicitCloudBinding,
  retryPatternCloudSync,
  renameExportedPattern,
  type ExportedPatternRecord,
  type EditablePatternProject,
} from '../utils/patternHistory';
import { renderPatternPreview } from '../utils/patternPreview';
import { publishCommunityPost, uploadCommunityAsset } from '../utils/communityApi';
import { formatChinaDate } from '../utils/dateUtils';

interface UserPatternsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onContinueEditing: (project: EditablePatternProject) => void;
  onOpenCommunity: () => void;
  onOpenAuthModal: () => void;
}

function PatternCover({ record, userId }: { record: ExportedPatternRecord; userId: string | null }): React.ReactElement {
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
    <div className="relative aspect-[4/3] w-full shrink-0 overflow-hidden bg-slate-950">
      {url ? (
        <img src={url} alt="" className="h-full w-full object-contain [image-rendering:pixelated]" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-slate-600">
          <Image className="h-7 w-7" />
        </div>
      )}
    </div>
  );
}

function statusLabel(status: ExportedPatternRecord['syncState'], isEn: boolean): string {
  if (status === 'synced') return isEn ? 'Cloud synced' : '已同步云端';
  if (status === 'pending') return isEn ? 'Waiting to sync' : '等待同步';
  if (status === 'failed') return isEn ? 'Sync failed' : '同步失败';
  return isEn ? 'This device only' : '仅本机保存';
}

function statusClass(status: ExportedPatternRecord['syncState']): string {
  if (status === 'synced') return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300';
  if (status === 'failed') return 'border-rose-500/40 bg-rose-500/10 text-rose-300';
  if (status === 'pending') return 'border-amber-500/40 bg-amber-500/10 text-amber-300';
  return 'border-slate-600 bg-slate-800 text-slate-300';
}

export const UserPatternsModal: React.FC<UserPatternsModalProps> = ({
  isOpen,
  onClose,
  onContinueEditing,
  onOpenCommunity,
  onOpenAuthModal,
}) => {
  const { currentUser } = useAuth();
  const { language } = useLanguage();
  const isEn = language === 'en';
  const [records, setRecords] = useState<ExportedPatternRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [section, setSection] = useState<'private' | 'published'>('private');
  const [publishTarget, setPublishTarget] = useState<ExportedPatternRecord | null>(null);
  const [publishTitle, setPublishTitle] = useState('');
  const [publishError, setPublishError] = useState<string | null>(null);

  const loadPatterns = async (): Promise<void> => {
    setLoading(true);
    setMessage(null);
    try {
      setRecords((await getUserExportedPatterns(currentUser?.uid ?? null)).filter((record) => record.status !== 2));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : (isEn ? 'Unable to load pattern history.' : '无法读取图纸记录。'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) void loadPatterns();
  }, [isOpen, currentUser?.uid]);

  const handleContinueEditing = async (record: ExportedPatternRecord): Promise<void> => {
    setBusyId(record.id);
    setMessage(null);
    try {
      const project = await getPatternProject(record.id, currentUser?.uid ?? null);
      onContinueEditing(project);
      onClose();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : (isEn ? 'Pattern data is damaged.' : '图纸数据损坏，无法恢复。'));
    } finally {
      setBusyId(null);
    }
  };

  const handleSyncToCurrentAccount = async (record: ExportedPatternRecord): Promise<void> => {
    setBusyId(record.id);
    setMessage(null);
    try {
      await retryPatternCloudSync(record.id, currentUser?.uid ?? null);
      await loadPatterns();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : (isEn ? 'Cloud sync retry failed.' : '云端同步重试失败。'));
    } finally {
      setBusyId(null);
    }
  };

  const handleDeleteLocal = async (record: ExportedPatternRecord): Promise<void> => {
    if (!window.confirm(isEn ? 'Delete the copy stored in this browser only?' : '仅删除此浏览器中的本地副本吗？')) return;
    setBusyId(record.id);
    setMessage(null);
    try {
      await deleteLocalExportedPatternCopy(record.id, currentUser?.uid ?? null);
      await loadPatterns();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : (isEn ? 'Delete failed.' : '删除失败。'));
    } finally {
      setBusyId(null);
    }
  };

  const handleDeleteCloudAndLocal = async (record: ExportedPatternRecord): Promise<void> => {
    const confirmation = record.hasLocalCopy
      ? (isEn ? 'Delete this cloud pattern and its copy in this browser?' : '删除云端图纸及此浏览器中的本地副本吗？')
      : (isEn ? 'Delete this cloud pattern?' : '删除此云端图纸吗？');
    if (!window.confirm(confirmation)) return;
    setBusyId(record.id);
    setMessage(null);
    try {
      await deleteCloudExportedPatternAndLocal(record.id, currentUser?.uid ?? null);
      await loadPatterns();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : (isEn ? 'Delete failed.' : '删除失败。'));
    } finally {
      setBusyId(null);
    }
  };

  const startRename = (record: ExportedPatternRecord): void => {
    setEditingId(record.id);
    setDraftTitle(record.title);
    setMessage(null);
  };

  const cancelRename = (): void => {
    setEditingId(null);
    setDraftTitle('');
  };

  const handleRename = async (record: ExportedPatternRecord): Promise<void> => {
    let title: string;
    try {
      title = normalizePatternTitle(draftTitle);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : (isEn ? 'Invalid pattern name.' : '图纸名称不合法。'));
      return;
    }
    setBusyId(record.id);
    setMessage(null);
    try {
      const updated = await renameExportedPattern(record, currentUser?.uid ?? null, title);
      setRecords((current) => current.map((item) => item.id === record.id ? {
        ...item,
        title: updated.title,
        updatedAt: updated.updatedAt,
        syncState: updated.syncState,
      } : item));
      cancelRename();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : (isEn ? 'Rename failed.' : '重命名失败。'));
    } finally {
      setBusyId(null);
    }
  };

  const openPublishDialog = (record: ExportedPatternRecord): void => {
    if (!currentUser) {
      setMessage(isEn ? 'Sign in and save this pattern to cloud before publishing.' : '请先登录并保存到云端后再发布。');
      onOpenAuthModal();
      return;
    }
    if (!record.hasCloudCopy || record.userId !== currentUser.uid) {
      setMessage(isEn ? 'Save this pattern to your cloud gallery before publishing.' : '本地作品需先保存到当前账号的云端图库后才能发布。');
      return;
    }
    if ((record.status ?? 0) === 2) return;
    setPublishTarget(record);
    setPublishTitle(record.title.trim().slice(0, 60));
    setPublishError(null);
  };

  const handlePublish = async (): Promise<void> => {
    if (!publishTarget || !currentUser || busyId) return;
    const title = publishTitle.trim();
    if (title.length < 1 || title.length > 60) {
      setPublishError(isEn ? 'A work name must contain 1 to 60 characters.' : '作品名称需为 1 至 60 个字符。');
      return;
    }
    const record = publishTarget;
    setBusyId(record.id);
    setMessage(null);
    setPublishError(null);
    try {
      let preview = record.previewBlob ?? null;
      if (!preview && record.cloudRevision) {
        preview = await getExportedPatternPreview(record.id, record.cloudRevision, currentUser.uid);
      }
      if (!preview) preview = await renderPatternPreview(await getPatternProject(record.id, currentUser.uid));
      const contentType = ['image/png', 'image/webp', 'image/jpeg'].includes(preview.type) ? preview.type : 'image/png';
      const file = new File([preview], `${record.title}.png`, { type: contentType });
      const upload = await uploadCommunityAsset(file);
      if (!upload.ok || !upload.data) throw new Error(upload.error ?? '社区图片上传失败');
      const published = await publishCommunityPost(title, upload.data.asset.id, record.id);
      if (!published.ok) throw new Error(published.error ?? '作品发布失败');
      await markExportedPatternPublished(record.id, currentUser.uid);
      setRecords((current) => current.map((item) => item.id === record.id ? { ...item, status: 1, hasCloudCopy: true } : item));
      setSection('published');
      setPublishTarget(null);
      setPublishTitle('');
      setMessage(isEn ? 'Published to the community.' : '作品已发布到社区。');
    } catch (error) {
      setPublishError(error instanceof Error ? error.message : (isEn ? 'Unable to publish this work.' : '作品发布失败。'));
    } finally {
      setBusyId(null);
    }
  };

  const privateRecords = records.filter((record) => (record.status ?? 0) === 0);
  const publishedRecords = records.filter((record) => record.status === 1);
  const visibleRecords = section === 'private' ? privateRecords : publishedRecords;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-2 sm:p-4">
      <section className="w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-900 text-slate-200 shadow-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-slate-800 p-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Database className="h-5 w-5 shrink-0 text-sky-400" />
              <h3 className="text-sm font-bold text-white">{isEn ? 'Editable pattern history' : '可编辑图纸记录'}</h3>
            </div>
            <p className="mt-1 text-[11px] leading-5 text-slate-400">
              {isEn
                ? 'Every record contains the full grid and palette. Previews are never used to recover a pattern.'
                : '每条记录都保存完整网格和色板，可继续编辑和高清导出；预览图不参与图纸恢复。'}
            </p>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-white" title={isEn ? 'Close' : '关闭'}>
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex items-center justify-between gap-3 border-b border-slate-800 bg-slate-950/60 px-4 py-2.5 text-[11px]">
          <span className="text-slate-400">
            {isEn
              ? `Cloud quota: Free 10, VIP 20, Merchant VIP 25. Local records are kept by this browser until its storage is cleared.`
              : '云端数量：免费 10 条、VIP 20 条、商家 VIP 25 条。本机记录不设人为数量上限，直到浏览器清理站点数据。'}
          </span>
          <button onClick={() => void loadPatterns()} className="inline-flex shrink-0 items-center gap-1 text-sky-300 hover:text-sky-200" disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            {isEn ? 'Refresh' : '刷新'}
          </button>
        </div>

        <div className="flex items-center gap-2 border-b border-slate-800 px-4 py-2">
          <button onClick={() => setSection('private')} className={`rounded-md px-3 py-1.5 text-xs font-bold ${section === 'private' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-white'}`}>
            {isEn ? `Private gallery (${privateRecords.length})` : `私有图库 (${privateRecords.length})`}
          </button>
          <button onClick={() => setSection('published')} className={`rounded-md px-3 py-1.5 text-xs font-bold ${section === 'published' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'}`}>
            {isEn ? `Published works (${publishedRecords.length})` : `已发布作品 (${publishedRecords.length})`}
          </button>
        </div>

        {message && (
          <div className="mx-4 mt-3 flex items-start gap-2 rounded-lg border border-rose-500/40 bg-rose-950/50 p-3 text-xs text-rose-200">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{message}</span>
          </div>
        )}

        <main className="min-h-[300px] flex-1 overflow-y-auto bg-slate-950 p-4">
          {loading ? (
            <div className="flex h-48 flex-col items-center justify-center gap-3 text-slate-400">
              <Loader2 className="h-7 w-7 animate-spin text-sky-400" />
              <span>{isEn ? 'Loading editable patterns...' : '正在读取可编辑图纸...'}</span>
            </div>
          ) : visibleRecords.length === 0 ? (
            <div className="flex h-48 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-700 text-center text-slate-500">
              <HardDrive className="h-7 w-7" />
              <span>{section === 'private' ? (isEn ? 'Private gallery has 0 works.' : '私有图库作品为 0。') : (isEn ? 'Published works are 0.' : '已发布作品为 0。')}</span>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {visibleRecords.map((record) => {
                const busy = busyId === record.id;
                const canBindToCurrentAccount = requiresExplicitCloudBinding(record, currentUser?.uid ?? null);
                const deletionActions = patternDeletionActions(record);
                return (
                  <article key={record.id} className="flex min-h-48 flex-col justify-between overflow-hidden rounded-lg border border-slate-800 bg-slate-900">
                    <PatternCover record={record} userId={currentUser?.uid ?? null} />
                    <div>
                      <div className="flex items-start justify-between gap-2 px-3 pt-3">
                        {editingId === record.id ? (
                          <div className="flex min-w-0 flex-1 items-center gap-1">
                            <input
                              value={draftTitle}
                              onChange={(event) => setDraftTitle(event.target.value)}
                              maxLength={200}
                              autoFocus
                              className="min-w-0 flex-1 rounded border border-sky-500/60 bg-slate-950 px-2 py-1 text-sm text-slate-100 outline-none"
                              aria-label={isEn ? 'Pattern name' : '图纸名称'}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') void handleRename(record);
                                if (event.key === 'Escape') cancelRename();
                              }}
                            />
                            <button onClick={() => void handleRename(record)} disabled={busy} className="p-1.5 text-emerald-300 hover:text-emerald-200 disabled:opacity-50" title={isEn ? 'Save name' : '保存名称'}>
                              <Check className="h-4 w-4" />
                            </button>
                            <button onClick={cancelRename} disabled={busy} className="p-1.5 text-slate-400 hover:text-white disabled:opacity-50" title={isEn ? 'Cancel rename' : '取消重命名'}>
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex min-w-0 flex-1 items-center gap-1">
                            <h4 className="min-w-0 flex-1 truncate text-sm font-bold text-slate-100" title={record.title}>{record.title}</h4>
                            <button onClick={() => startRename(record)} disabled={busy} className="shrink-0 p-1 text-slate-400 hover:text-sky-300 disabled:opacity-50" title={isEn ? 'Rename' : '重命名'}>
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        )}
                        <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold ${statusClass(record.syncState)}`}>
                          {record.syncState === 'synced' ? <CheckCircle2 className="h-3 w-3" /> : <Cloud className="h-3 w-3" />}
                          {statusLabel(record.syncState, isEn)}
                        </span>
                      </div>
                      <div className="mx-3 mt-3 flex items-center gap-2 rounded-md bg-slate-950 p-2 text-[11px] text-slate-300">
                        <Grid className="h-4 w-4 text-sky-400" />
                        <span>{record.width} x {record.height}</span>
                        <span className="text-slate-600">|</span>
                        <span>{record.totalBeads} {isEn ? 'beads' : '颗'}</span>
                      </div>
                      <div className="mx-3 mt-2 text-[10px] text-slate-500">{formatChinaDate(record.updatedAt, true)}</div>
                      <div className={`mx-3 mt-2 text-[10px] font-bold ${(record.status ?? 0) === 1 ? 'text-emerald-300' : 'text-sky-300'}`}>
                        {(record.status ?? 0) === 1 ? (isEn ? 'Published' : '已发布') : (isEn ? 'Private' : '私有')}
                      </div>
                      {record.userId === null && (
                        <p className="mx-3 mt-2 text-[10px] leading-4 text-amber-300">{isEn ? 'Unbound account: stored on this device only.' : '未绑定账号，仅本机可用。'}</p>
                      )}
                      {record.syncError && <p className="mx-3 mt-2 line-clamp-2 text-[10px] leading-4 text-rose-300">{record.syncError}</p>}
                    </div>
                    <div className="m-3 grid grid-cols-2 gap-2">
                      <button
                        onClick={() => void handleContinueEditing(record)}
                        disabled={busy}
                        className="inline-flex items-center justify-center gap-1 rounded-md bg-sky-600 px-2 py-2 text-xs font-bold text-white hover:bg-sky-500 disabled:opacity-50"
                      >
                        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Grid className="h-3.5 w-3.5" />}
                        {isEn ? 'Edit' : '继续编辑'}
                      </button>
                      {canBindToCurrentAccount && (
                        <button
                          onClick={() => void handleSyncToCurrentAccount(record)}
                          disabled={busy}
                          className="inline-flex items-center justify-center gap-1 rounded-md border border-sky-500/40 bg-sky-500/10 px-2 py-2 text-xs font-bold text-sky-200 hover:bg-sky-500/20 disabled:opacity-50"
                        >
                          <Cloud className="h-3.5 w-3.5" />
                          {isEn ? 'Sync to this account' : '同步到当前账号'}
                        </button>
                      )}
                      {(record.status ?? 0) === 0 && (
                        <button
                          onClick={() => openPublishDialog(record)}
                          disabled={busy}
                          className="inline-flex items-center justify-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-2 text-xs font-bold text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-50"
                        >
                          <Compass className="h-3.5 w-3.5" />
                          {isEn ? 'Publish' : '发布到社区'}
                        </button>
                      )}
                      {record.status === 1 && (
                        <button
                          onClick={onOpenCommunity}
                          className="inline-flex items-center justify-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-2 text-xs font-bold text-emerald-200 hover:bg-emerald-500/20"
                        >
                          <Compass className="h-3.5 w-3.5" />
                          {isEn ? 'Open community' : '进入社区'}
                        </button>
                      )}
                      {(record.syncState === 'failed' || record.syncState === 'pending') && record.userId === currentUser?.uid && (
                        <button
                          onClick={() => void handleSyncToCurrentAccount(record)}
                          disabled={busy}
                          className="inline-flex items-center justify-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-2 text-xs font-bold text-amber-200 hover:bg-amber-500/20 disabled:opacity-50"
                        >
                          <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />
                          {isEn ? 'Retry sync' : '重试同步'}
                        </button>
                      )}
                      {deletionActions.includes('local') && (
                        <button
                          onClick={() => void handleDeleteLocal(record)}
                          disabled={busy}
                          className="inline-flex items-center justify-center gap-1 rounded-md border border-slate-700 px-2 py-2 text-xs font-bold text-slate-300 hover:border-rose-500/60 hover:text-rose-300 disabled:opacity-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          {isEn ? 'Delete local copy' : '删除本机副本'}
                        </button>
                      )}
                      {deletionActions.includes('cloud-and-local') && (
                        <button
                          onClick={() => void handleDeleteCloudAndLocal(record)}
                          disabled={busy}
                          className="inline-flex items-center justify-center gap-1 rounded-md border border-slate-700 px-2 py-2 text-xs font-bold text-slate-300 hover:border-rose-500/60 hover:text-rose-300 disabled:opacity-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          {record.hasLocalCopy ? (isEn ? 'Delete cloud and local' : '删除云端及本机') : (isEn ? 'Delete cloud record' : '删除云端记录')}
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </main>
      </section>
      {publishTarget && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/75 p-4">
          <section role="dialog" aria-modal="true" aria-labelledby="publish-pattern-title" className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h4 id="publish-pattern-title" className="truncate text-base font-bold text-white">{isEn ? 'Publish work' : '发布作品'}</h4>
                <p className="mt-1 truncate text-xs text-slate-400">{publishTarget.title}</p>
              </div>
              <button type="button" onClick={() => { if (!busyId) { setPublishTarget(null); setPublishError(null); } }} disabled={Boolean(busyId)} className="grid h-10 w-10 shrink-0 place-items-center text-slate-400 hover:text-white disabled:opacity-50" title={isEn ? 'Close' : '关闭'} aria-label={isEn ? 'Close' : '关闭'}>
                <X className="h-5 w-5" />
              </button>
            </div>
            <label className="mt-5 block text-xs font-bold text-slate-400">
              {isEn ? 'Work name' : '作品名称'}
              <input
                value={publishTitle}
                onChange={(event) => { setPublishTitle(event.target.value); setPublishError(null); }}
                maxLength={60}
                autoFocus
                disabled={Boolean(busyId)}
                className="mt-2 min-h-11 w-full rounded-md border border-slate-700 bg-slate-950 px-3 text-sm text-white outline-none focus:border-sky-400 disabled:opacity-60"
                aria-describedby="publish-name-help"
                onKeyDown={(event) => { if (event.key === 'Enter') void handlePublish(); }}
              />
            </label>
            <p id="publish-name-help" className="mt-2 text-[11px] text-slate-500">{isEn ? `${publishTitle.trim().length}/60 characters` : `${publishTitle.trim().length}/60 个字符`}</p>
            {publishError && <div role="alert" className="mt-3 flex items-start gap-2 rounded-md border border-rose-500/40 bg-rose-950/50 p-3 text-xs leading-5 text-rose-200"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{publishError}</div>}
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button type="button" onClick={() => { setPublishTarget(null); setPublishError(null); }} disabled={Boolean(busyId)} className="min-h-11 rounded-md border border-slate-700 text-sm font-bold text-slate-300 hover:text-white disabled:opacity-50">{isEn ? 'Cancel' : '取消'}</button>
              <button type="button" onClick={() => void handlePublish()} disabled={Boolean(busyId)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-emerald-600 px-3 text-sm font-bold text-white hover:bg-emerald-500 disabled:opacity-50">{busyId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Compass className="h-4 w-4" />}{isEn ? 'Confirm publish' : '确认发布'}</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
};
