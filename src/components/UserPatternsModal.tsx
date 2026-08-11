import React, { useState, useEffect } from 'react';
import {
  X,
  ImageIcon,
  Download,
  Trash2,
  Clock,
  Grid,
  Loader2,
  Eye,
  AlertCircle,
  Sparkles,
  Calendar,
  Layers,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import {
  ExportedPatternRecord,
  getUserExportedPatterns,
  deleteExportedPatternRecord,
} from '../utils/patternHistory';
import { formatChinaDate } from '../utils/dateUtils';

interface UserPatternsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const UserPatternsModal: React.FC<UserPatternsModalProps> = ({ isOpen, onClose }) => {
  const { currentUser, isVip, isPro, memberType } = useAuth();
  const { language } = useLanguage();
  const isEn = language === 'en';
  const isVipUser = Boolean(isVip || isPro || (memberType ?? 0) > 0);

  const [records, setRecords] = useState<ExportedPatternRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [previewImage, setPreviewImage] = useState<ExportedPatternRecord | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadPatterns = async () => {
    if (!currentUser?.uid) return;
    setLoading(true);
    try {
      const data = await getUserExportedPatterns(currentUser.uid);
      setRecords(data);
    } catch (e) {
      console.warn('Failed to load user pattern records:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && currentUser?.uid) {
      loadPatterns();
    }
  }, [isOpen, currentUser?.uid]);

  if (!isOpen) return null;

  const handleDelete = async (id: string) => {
    if (!currentUser?.uid) return;
    if (!window.confirm(isEn ? 'Are you sure you want to delete this pattern record?' : '确定要删除此图纸记录吗？')) {
      return;
    }
    setDeletingId(id);
    try {
      await deleteExportedPatternRecord(id, currentUser.uid);
      setRecords(prev => prev.filter(r => r.id !== id));
      if (previewImage?.id === id) {
        setPreviewImage(null);
      }
    } catch (e) {
      console.error('Failed to delete pattern record:', e);
    } finally {
      setDeletingId(null);
    }
  };

  const handleDownload = (record: ExportedPatternRecord) => {
    const link = document.createElement('a');
    link.href = record.thumbnailUrl;
    link.download = `${record.title || '拼豆图纸'}_导出成品.jpg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const calculateDaysRemaining = (expireAt: number) => {
    const diffMs = expireAt - Date.now();
    if (diffMs <= 0) return 0;
    return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  };

  const formatDate = (ms: number, includeTime = true) => {
    return formatChinaDate(ms, includeTime);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-2 sm:p-4 animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-4xl max-h-[92vh] flex flex-col shadow-2xl text-slate-200 text-xs overflow-hidden">
        
        {/* Header */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/90 gap-2">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400 shrink-0">
              <ImageIcon className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-sm sm:text-base text-slate-100">
                  {isEn ? 'My Exported Pattern History' : '我的导出图纸记录'}
                </h3>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${isVipUser ? 'bg-amber-500/10 border border-amber-500/30 text-amber-400' : 'bg-slate-800 border border-slate-700 text-slate-300'}`}>
                  {isEn ? (isVipUser ? 'VIP 30 Days Retention' : 'Free 7 Days Retention') : (isVipUser ? 'VIP尊享 30天缓存' : '普通用户 7天缓存')}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {isEn
                  ? (isVipUser ? 'VIP account archives exported patterns for 30 days.' : 'Ordinary accounts store exported patterns for 7 days (Upgrade to VIP for 30 days).')
                  : (isVipUser ? '导出图纸自动保存成品快照 30 天，支持多设备实时同步回看与重新下载' : '普通账号导出图纸自动保存成品快照 7 天（激活 VIP 可升级解锁 30 天超长云端留存）')}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-2 rounded-xl hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Info Alert Bar */}
        <div className="px-4 py-2.5 bg-slate-950 border-b border-slate-800/80 flex items-center justify-between gap-2 text-[11px]">
          <div className="flex items-center gap-2 text-slate-300">
            <Clock className="w-4 h-4 text-purple-400 shrink-0" />
            <span>
              {isEn
                ? `Total archived: ${records.length} patterns. (VIP: 30 days, Free: 7 days)`
                : `共有 ${records.length} 份图纸记录。普通用户保存 7 天，VIP 用户支持 30 天云端图纸快照存储。`}
            </span>
          </div>
          <button
            onClick={loadPatterns}
            className="text-purple-400 hover:text-purple-300 font-bold hover:underline shrink-0 cursor-pointer"
          >
            {isEn ? 'Refresh' : '刷新列表'}
          </button>
        </div>

        {/* Content Body */}
        <div className="p-4 sm:p-5 flex-1 overflow-y-auto bg-slate-950 custom-scrollbar min-h-[320px]">
          {loading ? (
            <div className="py-16 text-center text-slate-400 flex flex-col items-center justify-center gap-3">
              <Loader2 className="w-8 h-8 text-purple-400 animate-spin" />
              <div className="text-xs font-bold text-slate-200">
                {isEn ? 'Syncing pattern history...' : '✨ 正在同步云端图纸记录...'}
              </div>
            </div>
          ) : records.length === 0 ? (
            <div className="py-16 text-center text-slate-500 border border-dashed border-slate-800 rounded-2xl p-8 bg-slate-900/40 flex flex-col items-center justify-center gap-3">
              <div className="w-14 h-14 rounded-2xl bg-slate-800/80 border border-slate-700/60 text-slate-400 flex items-center justify-center">
                <ImageIcon className="w-7 h-7" />
              </div>
              <div className="max-w-md">
                <h4 className="font-bold text-slate-300 text-sm mb-1">
                  {isEn ? 'No exported pattern history yet' : '暂无图纸成品记录'}
                </h4>
                <p className="text-xs text-slate-400 leading-relaxed">
                  {isEn
                    ? 'When you confirm and download a pattern from the Export modal, a snapshot will automatically be saved here for 30 days.'
                    : '当您在图纸编辑界面点击“导出高清图纸”并确认下载后，系统会自动保存一份高清图纸与参数快照至此，方便随时在其它设备登录查看。'}
                </p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {records.map(record => {
                const daysLeft = calculateDaysRemaining(record.expireAt);
                return (
                  <div
                    key={record.id}
                    className="bg-slate-900 border border-slate-800 hover:border-purple-500/40 rounded-xl p-3 flex flex-col justify-between gap-3 shadow-lg transition-all group hover:bg-slate-850"
                  >
                    {/* Thumbnail Image Container */}
                    <div className="relative aspect-square w-full rounded-lg bg-slate-950 border border-slate-800 overflow-hidden flex items-center justify-center group-hover:border-purple-500/30 transition-all">
                      <img
                        src={record.thumbnailUrl}
                        alt={record.title}
                        className="w-full h-full object-contain p-1 group-hover:scale-105 transition-transform duration-300"
                        referrerPolicy="no-referrer"
                      />
                      <div className="absolute inset-0 bg-slate-950/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 p-2">
                        <button
                          onClick={() => setPreviewImage(record)}
                          className="px-2.5 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-bold text-[11px] shadow flex items-center gap-1 cursor-pointer transition-transform active:scale-95"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>{isEn ? 'View' : '查看原图'}</span>
                        </button>
                        <button
                          onClick={() => handleDownload(record)}
                          className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[11px] shadow flex items-center gap-1 cursor-pointer transition-transform active:scale-95"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>{isEn ? 'Download' : '下载图纸'}</span>
                        </button>
                      </div>

                      {/* Expiration Pill */}
                      <div className="absolute top-2 right-2 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-900/90 border border-amber-500/40 text-amber-300 backdrop-blur-sm shadow flex items-center gap-1">
                        <Clock className="w-3 h-3 text-amber-400" />
                        <span>{isEn ? `${daysLeft}d left` : `还剩 ${daysLeft} 天`}</span>
                      </div>
                    </div>

                    {/* Metadata Specs */}
                    <div className="space-y-1.5">
                      <div className="flex items-start justify-between gap-2">
                        <h4 className="font-bold text-slate-100 text-xs truncate max-w-[180px]" title={record.title}>
                          {record.title || '未命名拼豆图纸'}
                        </h4>
                        <button
                          onClick={() => handleDelete(record.id)}
                          disabled={deletingId === record.id}
                          className="text-slate-500 hover:text-rose-400 p-1 rounded-md hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
                          title={isEn ? 'Delete record' : '删除图纸记录'}
                        >
                          {deletingId === record.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-rose-400" />
                          ) : (
                            <Trash2 className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>

                      <div className="grid grid-cols-2 gap-1.5 text-[11px] text-slate-400 bg-slate-950/60 p-2 rounded-lg border border-slate-800/80">
                        <div className="flex items-center gap-1 text-purple-300 font-medium">
                          <Grid className="w-3 h-3 shrink-0 text-purple-400" />
                          <span>{record.width} × {record.height} 豆</span>
                        </div>
                        <div className="flex items-center gap-1 text-emerald-300 font-medium">
                          <Layers className="w-3 h-3 shrink-0 text-emerald-400" />
                          <span>{record.totalBeads} 颗拼豆</span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-[10px] text-slate-500 pt-0.5">
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {formatDate(record.createdAt)}
                        </span>
                        <span className="text-amber-400/90">至 {formatChinaDate(record.expireAt, false)} 自动清理</span>
                      </div>
                    </div>

                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 sm:p-4 border-t border-slate-800 bg-slate-900 flex items-center justify-between text-slate-400 text-[11px]">
          <span>✨ 智能防丢机制：更换手机或电脑登录同一账号，也可同步查看历史图纸成品</span>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold transition-colors cursor-pointer"
          >
            {isEn ? 'Close' : '关闭面板'}
          </button>
        </div>

      </div>

      {/* Full Preview Light Modal */}
      {previewImage && (
        <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">
            <div className="p-3 border-b border-slate-800 flex items-center justify-between bg-slate-950">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-purple-400" />
                <span className="font-bold text-xs text-slate-200">{previewImage.title} 成品图纸预览</span>
              </div>
              <button
                onClick={() => setPreviewImage(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 bg-slate-950 flex items-center justify-center overflow-auto flex-1 max-h-[70vh]">
              <img
                src={previewImage.thumbnailUrl}
                alt={previewImage.title}
                className="max-w-full max-h-[65vh] object-contain rounded-lg border border-slate-800 shadow-xl"
              />
            </div>
            <div className="p-3 bg-slate-900 border-t border-slate-800 flex items-center justify-between">
              <div className="text-xs text-slate-400">
                尺寸: {previewImage.width}×{previewImage.height} 豆 • 总计: {previewImage.totalBeads} 颗拼豆
              </div>
              <button
                onClick={() => handleDownload(previewImage)}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow flex items-center gap-1.5 cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>直接保存此成品图片</span>
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
