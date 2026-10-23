import React, { useState, useEffect, useMemo, useRef, useId } from 'react';
import {
  X,
  Download,
  ShieldAlert,
  Sliders,
  Crown,
  Lock,
  Palette,
  RotateCw,
  RotateCcw,
  Check,
  FileImage,
  ZoomIn,
  ZoomOut,
  Maximize2,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import './ExportModal.css';
import {
  getExportFilename,
  getExportFilenameBase,
  getExportSummary,
  resolveExportPrivileges,
} from '../utils/exportModalUtils';
import { exportPreviewViewport, type ExportPreviewZoom } from '../utils/exportPreviewViewport';
import { BeadColor, BeadShape, BrandKey, ConvertSettings } from '../types';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { saveExportedPatternRecord } from '../utils/patternHistory';
import {
  generatePatternCanvas,
  downloadCanvasImage,
  ExportOptions,
  WatermarkType,
  LegendPosition,
  LegendScaleMode,
  SymbolDisplayType,
  ExportQuality,
  PatternExportSizeError,
  isWeChatBrowser,
} from '../utils/exportUtils';

interface ExportModalProps {
  isOpen: boolean;
  unlocked: boolean;
  onClose: () => void;
  grid: (string | null)[][];
  paletteMap: Map<string, BeadColor>;
  width: number;
  height: number;
  boardSize: number;
  brandName: BrandKey;
  projectName: string;
  beadShape: BeadShape;
  activePalette: BeadColor[];
  activePatternId: string | null;
  settings: ConvertSettings;
  onPatternArchived: (id: string) => void;
  onOpenAuthModal?: () => void;
  onOpenVipModal?: () => void;
  /** Public read-only exports must not silently create an editable library copy. */
  archiveOnExport?: boolean;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  unlocked,
  onClose,
  grid,
  paletteMap,
  width,
  height,
  boardSize,
  brandName,
  projectName,
  beadShape,
  activePalette,
  activePatternId,
  settings,
  onPatternArchived,
  onOpenAuthModal,
  onOpenVipModal,
  archiveOnExport = true,
}) => {
  const { currentUser, isVip } = useAuth();
  const { language } = useLanguage();
  const isEn = language === 'en';
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const accessRef = useRef({ isOpen, unlocked, isVip });
  accessRef.current = { isOpen, unlocked, isVip };
  const downloadInFlightRef = useRef(false);
  const [filename, setFilename] = useState(projectName);
  const [previewSize, setPreviewSize] = useState({ width: 0, height: 0 });
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewZoom, setPreviewZoom] = useState<ExportPreviewZoom>('fit');
  const [previewBounds, setPreviewBounds] = useState({ width: 1, height: 1 });
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);
  const [fullOverviewTooLarge, setFullOverviewTooLarge] = useState(false);

  // Watermark States
  const [watermarkType, setWatermarkType] = useState<WatermarkType>('double_diagonal');
  const [watermarkOpacity, setWatermarkOpacity] = useState<number>(0.18);
  const [watermarkText, setWatermarkText] = useState<string>(isEn ? 'BeadGrid' : '豆织星格');
  const [watermarkColor, setWatermarkColor] = useState<string>('#A855F7');
  const [watermarkAngle, setWatermarkAngle] = useState<number>(-25);

  // Layout & Display States
  const [showSymbols, setShowSymbols] = useState(true);
  const [symbolDisplayType, setSymbolDisplayType] = useState<SymbolDisplayType>('code');
  const [symbolFontScale, setSymbolFontScale] = useState<number>(1.0);
  const [exportQuality, setExportQuality] = useState<ExportQuality>('high');
  const [showCoordinates, setShowCoordinates] = useState(true);
  const [legendPosition, setLegendPosition] = useState<LegendPosition>('right');
  const [legendScaleMode, setLegendScaleMode] = useState<LegendScaleMode>('auto');
  const [hideEmptyPegs, setHideEmptyPegs] = useState(true);
  const [selectedBoard, setSelectedBoard] = useState<number | null>(null);

  // Tooltips and Modal States
  const [showVipTooltip, setShowVipTooltip] = useState(false);
  const [showFreeDownloadModal, setShowFreeDownloadModal] = useState(false);
  const [pendingDownloadType, setPendingDownloadType] = useState<'single' | 'all' | null>(null);
  const [wechatPreviewUrl, setWechatPreviewUrl] = useState<string | null>(null);
  const [archiveMessage, setArchiveMessage] = useState<string | null>(null);
  const [downloadState, setDownloadState] = useState<'idle' | 'generating' | 'downloading' | 'success' | 'error'>('idle');
  const [downloadMessage, setDownloadMessage] = useState<string | null>(null);

  const previewContainerRef = useRef<HTMLDivElement>(null);
  const previewViewportRef = useRef<HTMLDivElement>(null);
  const previewDragRef = useRef<{ id: number; x: number; y: number; left: number; top: number; scaleX: number; scaleY: number } | null>(null);
  const cancelBatchRef = useRef(false);
  const downloadMessageTimerRef = useRef<number | null>(null);

  const boardsX = Math.ceil(width / boardSize);
  const boardsY = Math.ceil(height / boardSize);
  const totalBoards = boardsX * boardsY;
  const currentBoard = selectedBoard !== null && selectedBoard < totalBoards ? selectedBoard : null;
  const summary = useMemo(() => isOpen && unlocked
    ? getExportSummary(grid, paletteMap, width, height, boardSize, currentBoard)
    : { width: 0, height: 0, totalBeads: 0, colorCount: 0, materials: [] },
    [isOpen, unlocked, grid, paletteMap, width, height, boardSize, currentBoard]);
  const filenameBase = getExportFilenameBase(filename, projectName || (isEn ? 'Pattern' : '拼豆图纸'));
  const outputFilename = getExportFilename(filenameBase, currentBoard, isEn);
  const isBusy = downloadState === 'generating' || downloadState === 'downloading';
  const previewLayout = useMemo(() => exportPreviewViewport(previewSize, previewBounds, previewZoom), [previewSize, previewBounds, previewZoom]);

  useEffect(() => {
    if (!isOpen || !unlocked || !previewViewportRef.current) return;
    const viewport = previewViewportRef.current;
    const measure = (entries?: ResizeObserverEntry[]) => {
      // Layout-unit border-box dimensions ignore classic scrollbar changes and
      // CSS zoom. client sizes feed overflow back into RO; client rects double-scale.
      const box = entries?.[0]?.borderBoxSize?.[0];
      const width = box?.inlineSize ?? viewport.offsetWidth;
      const height = box?.blockSize ?? viewport.offsetHeight;
      setPreviewBounds(current => current.width === width && current.height === height ? current : { width, height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport, { box: 'border-box' });
    return () => observer.disconnect();
  }, [isOpen, unlocked]);


  // Completion settles pattern credits. Local PNG exports are free afterwards;
  // VIP only controls export privileges such as watermark removal and 4K.
  const cleanExport = isVip && watermarkType === 'none';

  useEffect(() => {
    if (!isBusy) setBatchProgress(null);
    if (!isOpen || !unlocked) cancelBatchRef.current = true;
  }, [isBusy, isOpen, unlocked]);

  useEffect(() => { setFilename(projectName); }, [projectName]);

  useEffect(() => {
    if (downloadInFlightRef.current) return;
    // Do not carry an old download result or WeChat image into another pattern.
    setDownloadState('idle');
    setDownloadMessage(null);
    setArchiveMessage(null);
    setWechatPreviewUrl(null);
    setShowFreeDownloadModal(false);
    setPendingDownloadType(null);
  }, [isOpen, grid, projectName]);

  const resetSettings = () => {
    setShowSymbols(true);
    setSymbolDisplayType('code');
    setSymbolFontScale(1);
    setExportQuality('high');
    setShowCoordinates(true);
    setLegendPosition('right');
    setLegendScaleMode('auto');
    setHideEmptyPegs(true);
    setWatermarkType('double_diagonal');
    setWatermarkOpacity(0.18);
    setWatermarkText(isEn ? 'BeadGrid' : '豆织星格');
    setWatermarkColor('#A855F7');
    setWatermarkAngle(-25);
    setSelectedBoard(null);
    setFilename(projectName);
    setShowVipTooltip(false);
  };

  // Enforce Hard Permission Rules for Non-VIP users
  useEffect(() => {
    if (!isVip) {
      // Force watermark on if non-VIP
      if (watermarkType === 'none') {
        setWatermarkType('double_diagonal');
      }
      // Revert 4K Ultra to 2K High if non-VIP
      if (exportQuality === 'ultra') {
        setExportQuality('high');
      }
      // Force platform default watermark text if non-VIP
      setWatermarkText(isEn ? 'BeadGrid' : '豆织星格');
      setWatermarkColor('#A855F7');
      setWatermarkAngle(-25);
    }
  }, [isVip, watermarkType, exportQuality, isEn]);

  // Resolve privileges synchronously: a membership change must not briefly
  // render or download a stale watermark-free / 4K option before effects run.
  const exportOptions = useMemo<ExportOptions>(() => resolveExportPrivileges({
      grid,
      paletteMap,
      width,
      height,
      boardSize,
      brandName,
      projectName,
      showSymbols,
      symbolDisplayType,
      symbolFontScale,
      exportQuality,
      showCoordinates,
      beadShape,
      selectedBoardIndex: currentBoard,
      watermarkType,
      watermarkText: isVip ? watermarkText : (isEn ? 'BeadGrid' : '豆织星格'),
      watermarkOpacity,
      watermarkColor: isVip ? watermarkColor : '#A855F7',
      watermarkAngle: isVip ? watermarkAngle : -25,
      legendPosition,
      legendScaleMode,
      hideEmptyPegs,
      isEn,
    }, isVip), [
    grid,
    paletteMap,
    width,
    height,
    boardSize,
    brandName,
    projectName,
    showSymbols,
    symbolDisplayType,
    symbolFontScale,
    exportQuality,
    showCoordinates,
    beadShape,
    currentBoard,
    watermarkType,
    watermarkText,
    watermarkOpacity,
    watermarkColor,
    watermarkAngle,
    legendPosition,
    legendScaleMode,
    hideEmptyPegs,
    isVip,
    isEn,
  ]);

  useEffect(() => {
    if (!isOpen || !unlocked || !previewContainerRef.current) return;
    const container = previewContainerRef.current;
    container.replaceChildren();
    setPreviewZoom('fit');
    try {
      const canvas = generatePatternCanvas(exportOptions);
      canvas.className = 'export-modal-canvas';
      // Never reuse the previous PNG's aspect ratio during a quality change.
      canvas.style.height = 'auto';
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', isEn ? 'Exported pattern preview' : '导出图纸预览');
      container.appendChild(canvas);
      setPreviewSize({ width: canvas.width, height: canvas.height });
      setPreviewError(null);
      if (currentBoard === null) setFullOverviewTooLarge(false);
    } catch (error) {
      setPreviewSize({ width: 0, height: 0 });
      setPreviewError(error instanceof Error ? error.message : (isEn ? 'Preview failed. Try a smaller board or lower quality.' : '预览生成失败，请尝试分板或降低画质。'));
      if (currentBoard === null) setFullOverviewTooLarge(error instanceof PatternExportSizeError);
    }
  }, [isOpen, unlocked, exportOptions, isEn]);

  useEffect(() => {
    const surface = previewContainerRef.current;
    const canvas = surface?.querySelector('canvas');
    if (!surface || !canvas) return;
    if (surface.style.width !== previewLayout.surfaceWidth + 'px') surface.style.width = previewLayout.surfaceWidth + 'px';
    if (surface.style.height !== previewLayout.surfaceHeight + 'px') surface.style.height = previewLayout.surfaceHeight + 'px';
    if (canvas.style.width !== previewLayout.width + 'px') canvas.style.width = previewLayout.width + 'px';
    if (canvas.style.height !== 'auto') canvas.style.height = 'auto';
    const viewport = previewViewportRef.current;
    if (previewZoom === 'fit' && viewport && (viewport.scrollTop || viewport.scrollLeft)) viewport.scrollTo(0, 0);
  }, [previewLayout, previewZoom, exportOptions]);

  useEffect(() => {
    if (!isOpen || !unlocked) {
      setShowFreeDownloadModal(false);
      setPendingDownloadType(null);
      setWechatPreviewUrl(null);
      return;
    }
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [isOpen, unlocked]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!showFreeDownloadModal && !wechatPreviewUrl && dialog && !dialog.contains(document.activeElement)) {
      dialog.focus();
    }
  }, [showFreeDownloadModal, wechatPreviewUrl]);

  const handleDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      // This overlay may live inside the public viewer's native modal. Stop the
      // browser's subsequent dialog-cancel default from closing that parent too.
      event.preventDefault();
      event.stopPropagation();
      if (wechatPreviewUrl) setWechatPreviewUrl(null);
      else if (showFreeDownloadModal) { setShowFreeDownloadModal(false); setPendingDownloadType(null); }
      else onClose();
    }
    if (event.key !== 'Tab') return;
    const root: HTMLElement | null = dialogRef.current?.querySelector<HTMLElement>('[data-export-subdialog]') ?? dialogRef.current;
    const focusable = Array.from<HTMLElement>(root?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, [tabindex="0"]') ?? [])
      .filter(element => element.getClientRects().length > 0 && !element.closest('[inert]'));
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first) { event.preventDefault(); return; }
    if (event.shiftKey && (document.activeElement === first || !focusable.includes(document.activeElement as HTMLElement))) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !focusable.includes(document.activeElement as HTMLElement))) {
      event.preventDefault(); first.focus();
    }
  };

  useEffect(() => () => {
    if (downloadMessageTimerRef.current !== null) {
      window.clearTimeout(downloadMessageTimerRef.current);
    }
  }, []);

  // App controls the entry point, while this required prop prevents a stale
  // modal state or future caller from bypassing the draft lock.
  if (!isOpen || !unlocked) return null;

  const setDownloadFeedback = (
    state: 'idle' | 'generating' | 'downloading' | 'success' | 'error',
    message: string | null,
    resetAfterMs?: number,
  ) => {
    if (downloadMessageTimerRef.current !== null) {
      window.clearTimeout(downloadMessageTimerRef.current);
      downloadMessageTimerRef.current = null;
    }
    setDownloadState(state);
    setDownloadMessage(message);
    if (resetAfterMs) {
      downloadMessageTimerRef.current = window.setTimeout(() => {
        setDownloadState('idle');
        setDownloadMessage(null);
        downloadMessageTimerRef.current = null;
      }, resetAfterMs);
    }
  };

  const yieldForDownloadFeedback = () => new Promise<void>(resolve => {
    window.requestAnimationFrame(() => resolve());
  });

  const archiveEditablePattern = async (): Promise<void> => {
    if (!archiveOnExport) return;
    const totalBeadsCount = grid.reduce((acc, row) => acc + row.filter(cell => cell !== null).length, 0);
    try {
      const record = await saveExportedPatternRecord({
        id: activePatternId ?? undefined,
        userId: currentUser?.uid ?? null,
        title: projectName || (isEn ? 'Perler Pattern' : '拼豆图纸'),
        width,
        height,
        totalBeads: totalBeadsCount,
        boardSize,
        brand: brandName,
        settings,
        grid,
        palette: activePalette,
      });
      onPatternArchived(record.id);
      if (record.syncState === 'synced') {
        setArchiveMessage(isEn ? 'Editable pattern saved locally and synced to cloud.' : '完整可编辑图纸已保存到本机并同步云端。');
      } else if (record.syncState === 'local-only') {
        setArchiveMessage(isEn ? 'Editable pattern saved only on this device. Sign in to sync it.' : '完整可编辑图纸仅保存到本机。登录后可同步云端。');
      } else {
        setArchiveMessage(isEn ? 'Editable pattern is saved locally. Cloud sync can be retried from history.' : '完整可编辑图纸已保存到本机，云端同步可在图纸记录中重试。');
      }
    } catch (error) {
      setArchiveMessage(error instanceof Error ? error.message : (isEn ? 'Offline pattern save failed.' : '本机图纸保存失败。'));
    }
  };

  // Actual Download Execution
  const executeSingleDownload = async () => {
    if (downloadInFlightRef.current || !accessRef.current.isOpen || !accessRef.current.unlocked) return;
    downloadInFlightRef.current = true;
    setDownloadFeedback('generating', isEn ? 'Generating PNG…' : '正在生成 PNG 图纸…');
    try {
      await yieldForDownloadFeedback();
      if (!accessRef.current.isOpen || !accessRef.current.unlocked) return;
      const options = resolveExportPrivileges(exportOptions, accessRef.current.isVip);
      const canvas = generatePatternCanvas(options);

      setDownloadFeedback('downloading', isEn ? 'Starting download…' : '正在启动下载…');
      const result = await downloadCanvasImage(canvas, outputFilename, (dataUrl) => setWechatPreviewUrl(dataUrl));
      void archiveEditablePattern();
      setDownloadFeedback(
        'success',
        result === 'wechat-preview'
          ? (isEn ? 'Preview is ready. Long-press the image to save it.' : '预览已生成，请长按图片保存。')
          : (isEn ? 'PNG download started.' : 'PNG 下载已开始。'),
        4_000,
      );
    } catch (error) {
      setDownloadFeedback('error', error instanceof Error ? error.message : (isEn ? 'PNG export failed. Please try again.' : 'PNG 导出失败，请重试。'));
    } finally {
      downloadInFlightRef.current = false;
      setDownloadState(state => state === 'generating' || state === 'downloading' ? 'idle' : state);
    }
  };

  const executeAllBoardsDownload = async () => {
    if (downloadInFlightRef.current || !accessRef.current.isOpen || !accessRef.current.unlocked) return;
    if (isWeChatBrowser()) {
      setDownloadFeedback('error', isEn
        ? 'WeChat cannot save a batch reliably. Save each board separately, or open this page in your browser.'
        : '微信内无法可靠批量保存。请切换分板逐张保存，或在右上角选择「在浏览器打开」后批量导出。', 8_000);
      return;
    }
    downloadInFlightRef.current = true;
    cancelBatchRef.current = false;
    setBatchProgress({ done: 0, total: totalBoards + 1 });
    setDownloadFeedback('generating', isEn ? 'Preparing pattern files…' : '正在准备图纸文件…');
    try {
      await yieldForDownloadFeedback();
      if (!accessRef.current.isOpen || !accessRef.current.unlocked) return;
      const fullOptions = resolveExportPrivileges({ ...exportOptions, selectedBoardIndex: null }, accessRef.current.isVip);
      let fullCanvas: HTMLCanvasElement | null = null;
      try {
        fullCanvas = generatePatternCanvas(fullOptions);
        setFullOverviewTooLarge(false);
      } catch (error) {
        if (!(error instanceof PatternExportSizeError)) throw error;
        setFullOverviewTooLarge(true);
      }
      const fileCount = totalBoards + (fullCanvas ? 1 : 0);
      let done = 0;
      setBatchProgress({ done, total: fileCount });
      if (fullCanvas) {
        setDownloadFeedback('downloading', isEn ? 'Downloading 1 of ' + fileCount + '…' : '正在下载第 1/' + fileCount + ' 张…');
        await downloadCanvasImage(fullCanvas, getExportFilename(filenameBase, null, isEn), (dataUrl) => setWechatPreviewUrl(dataUrl));
        done++;
        setBatchProgress({ done, total: fileCount });
      }

      for (let i = 0; i < totalBoards; i++) {
        await new Promise<void>(resolve => window.setTimeout(resolve, 250));
        if (!accessRef.current.isOpen || !accessRef.current.unlocked) return;
        if (cancelBatchRef.current) {
          setDownloadFeedback('success', isEn ? 'Batch stopped. ' + done + ' file(s) started downloading.' : '已停止批量导出，已启动 ' + done + ' 张文件下载。', 6000);
          return;
        }
        const subOptions = resolveExportPrivileges({ ...fullOptions, selectedBoardIndex: i }, accessRef.current.isVip);
        setDownloadFeedback('downloading', isEn ? 'Downloading ' + (done + 1) + ' of ' + fileCount + '…' : '正在下载第 ' + (done + 1) + '/' + fileCount + ' 张…');
        await downloadCanvasImage(generatePatternCanvas(subOptions), getExportFilename(filenameBase, i, isEn), (dataUrl) => setWechatPreviewUrl(dataUrl));
        done++;
        setBatchProgress({ done, total: fileCount });
      }

      void archiveEditablePattern();
      setDownloadFeedback('success', fullCanvas
        ? (isEn ? 'Overview and board downloads started.' : '总览与分板图纸下载已开始。')
        : (isEn ? 'Full overview exceeds browser limits; all original-size boards were exported.' : '整张总览超过安全尺寸，已按原始网格导出全部分板。'), 6_000);
    } catch (error) {
      setDownloadFeedback('error', error instanceof Error ? error.message : (isEn ? 'PNG export failed. Please try again.' : 'PNG 导出失败，请重试。'));
    } finally {
      downloadInFlightRef.current = false;
      setDownloadState(state => state === 'generating' || state === 'downloading' ? 'idle' : state);
    }
  };

  // Completion has already settled pricing; VIP only changes output options.
  const handleDownloadClick = (type: 'single' | 'all') => {
    if (downloadInFlightRef.current || !accessRef.current.isOpen || !accessRef.current.unlocked) return;
    if (!isVip) {
      setPendingDownloadType(type);
      setShowFreeDownloadModal(true);
    } else {
      if (type === 'single') void executeSingleDownload();
      else void executeAllBoardsDownload();
    }
  };

  const confirmFreeDownload = () => {
    if (downloadInFlightRef.current || !accessRef.current.isOpen || !accessRef.current.unlocked) return;
    setShowFreeDownloadModal(false);
    if (pendingDownloadType === 'single') void executeSingleDownload();
    else if (pendingDownloadType === 'all') void executeAllBoardsDownload();
    setPendingDownloadType(null);
  };

  const openVipBenefits = onOpenVipModal ?? onOpenAuthModal;

  const scopeLabel = currentBoard === null
    ? (isEn ? 'Full pattern' : '完整图纸')
    : (isEn ? 'Board ' + (currentBoard + 1) : '第 ' + (currentBoard + 1) + ' 板');
  const hasSubdialog = showFreeDownloadModal || Boolean(wechatPreviewUrl);

  return (
    <div className="export-modal-overlay" onKeyDown={handleDialogKeyDown}>
      <div className="export-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} ref={dialogRef}>
        <div className="export-modal-shell" inert={hasSubdialog}>
          <header className="export-modal-header">
            <div className="export-modal-heading">
              <span className="export-modal-mark"><FileImage size={22} aria-hidden="true" /></span>
              <div>
                <div className="export-modal-title-row">
                  <h2 id={titleId}>{isEn ? 'Export pattern' : '导出图纸'}</h2>
                  <span className={'export-modal-badge' + (isVip ? ' is-vip' : '')}>
                    {isVip ? <Crown size={12} aria-hidden="true" /> : <ShieldAlert size={12} aria-hidden="true" />}
                    {isVip ? (isEn ? 'VIP' : 'VIP 权益') : (isEn ? 'Watermarked' : '水印保护')}
                  </span>
                </div>
              </div>
            </div>
            <button type="button" className="export-modal-icon-button" onClick={onClose} aria-label={isEn ? 'Close export' : '关闭导出'}><X size={20} /></button>
          </header>

          <div className="export-modal-workspace">
            <section className="export-modal-preview-panel" aria-label={isEn ? 'Output preview' : '输出预览'}>
              <dl className="export-modal-summary">
                <div><dt>{isEn ? 'Size · beads' : '尺寸 · 豆格'}</dt><dd>{summary.width} <span>×</span> {summary.height}</dd></div>
                <div><dt>{isEn ? 'Beads' : '用豆数量'}</dt><dd>{summary.totalBeads.toLocaleString(isEn ? 'en-US' : 'zh-CN')}<small>{isEn ? ' pcs' : ' 颗'}</small></dd></div>
                <div><dt>{isEn ? 'Colors' : '使用颜色'}</dt><dd>{summary.colorCount}<small>{isEn ? ' colors' : ' 色'}</small></dd></div>
              </dl>
              <div className="export-modal-preview-stage" aria-busy={isBusy}>
                <div className="export-modal-preview-tools">
                  <span>{scopeLabel} <small>· PNG</small></span>
                  <div role="group" aria-label={isEn ? 'Preview zoom' : '预览缩放'}>
                    <button type="button" disabled={!previewSize.width} aria-label={isEn ? 'Zoom out preview' : '缩小导出预览'} onClick={() => setPreviewZoom(Math.max(previewLayout.fit / 4, previewLayout.scale / 1.4))}><ZoomOut size={15} /></button>
                    <output aria-label={isEn ? 'Preview scale' : '预览比例'}>{previewSize.width ? Math.round(previewLayout.scale * 100) + '%' : '—'}</output>
                    <button type="button" disabled={!previewSize.width} aria-label={isEn ? 'Zoom in preview' : '放大导出预览'} onClick={() => setPreviewZoom(Math.min(8, previewLayout.scale * 1.4))}><ZoomIn size={15} /></button>
                    <button type="button" disabled={!previewSize.width} aria-label={isEn ? 'Actual preview size' : '原始比例预览'} onClick={() => setPreviewZoom(1)}>100%</button>
                    <button type="button" disabled={!previewSize.width} aria-label={isEn ? 'Fit export preview' : '适应导出预览'} onClick={() => setPreviewZoom('fit')}><Maximize2 size={15} /><span>{isEn ? 'Fit' : '适应'}</span></button>
                  </div>
                </div>
                <div className="export-modal-preview-viewport" ref={previewViewportRef} data-zoomed={previewZoom !== 'fit' || undefined}
                  onPointerDown={event => {
                    if (event.pointerType !== 'mouse' || previewZoom === 'fit' || event.button !== 0) return;
                    const viewport = event.currentTarget;
                    const box = viewport.getBoundingClientRect();
                    previewDragRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop,
                      scaleX: box.width / Math.max(1, viewport.offsetWidth), scaleY: box.height / Math.max(1, viewport.offsetHeight) };
                    viewport.setPointerCapture(event.pointerId);
                    event.preventDefault();
                  }}
                  onPointerMove={event => {
                    const drag = previewDragRef.current;
                    if (drag?.id !== event.pointerId) return;
                    event.currentTarget.scrollLeft = drag.left + (drag.x - event.clientX) / Math.max(.001, drag.scaleX);
                    event.currentTarget.scrollTop = drag.top + (drag.y - event.clientY) / Math.max(.001, drag.scaleY);
                  }}
                  onPointerUp={event => { previewDragRef.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
                  onPointerCancel={() => { previewDragRef.current = null; }} onLostPointerCapture={() => { previewDragRef.current = null; }}>
                  <div className="export-modal-preview-canvas" ref={previewContainerRef} />
                  {previewError && <div className="export-modal-error" role="alert"><FileImage size={24} /><p>{previewError}</p><small>{isEn ? 'Try an individual board from Export range.' : '可在右侧「导出范围」切换到单块分板。'}</small></div>}
                </div>
                <div className="export-modal-grid-key export-modal-preview-caption"><span><i className="is-dashed" />{isEn ? '5-cell guide' : '5 格虚线'}</span><span><i />{isEn ? '10-cell guide' : '10 格实线'}</span><small title={isEn ? 'Zoom changes preview only; PNG output is unchanged.' : '缩放仅影响预览，PNG 输出不变。'}>{previewSize.width > 0 ? previewSize.width + ' × ' + previewSize.height + ' px' : '—'}</small></div>
              </div>
            </section>

            <aside className="export-modal-settings" aria-label={isEn ? 'Export settings' : '导出设置'}>
              <fieldset className="export-modal-settings-fieldset" disabled={isBusy}>
                <section className="export-modal-vip" aria-label={isEn ? 'VIP export benefits' : 'VIP 导出权益'}>
                  <header className="export-modal-vip-heading">
                    <h3><Crown size={16} aria-hidden="true" />{isEn ? 'VIP export' : 'VIP 导出权益'}</h3>
                    {isVip ? <span className="export-modal-vip-active"><Check size={12} />{isEn ? 'Unlocked' : '已解锁'}</span>
                      : openVipBenefits && <button type="button" onClick={openVipBenefits}>{isEn ? 'Explore VIP' : '查看权益'}<ChevronRight size={13} /></button>}
                  </header>
                  <div className="export-modal-vip-row">
                    <span>{isEn ? 'Quality' : '图纸清晰度'}</span>
                    <div className="export-modal-quality" role="group" aria-label={isEn ? 'PNG quality' : 'PNG 画质'}>
                      <button type="button" aria-label={isEn ? 'HD pattern' : '高清图纸'} aria-pressed={exportOptions.exportQuality === 'high'} onClick={() => {setExportQuality('high');setShowVipTooltip(false);}}>{isEn ? 'HD' : '高清'}</button>
                      <button type="button" aria-label={isEn ? 'Ultra pattern' : '极清图纸'} aria-pressed={exportOptions.exportQuality === 'ultra'} data-locked={!isVip || undefined} onClick={() => {
                        if (!isVip) {setShowVipTooltip(true);return;}
                        setExportQuality('ultra');setShowVipTooltip(false);
                      }}>{!isVip && <Lock size={11} aria-hidden="true" />}{isEn ? 'Ultra' : '极清'}<small aria-hidden="true">VIP</small></button>
                    </div>
                  </div>
                  <div className="export-modal-vip-row">
                    <span>{isEn ? 'Watermark-free' : '无水印导出'}{!isVip && <Lock size={11} aria-hidden="true" />}</span>
                    <button type="button" className="export-modal-vip-switch" role="switch" aria-label={isEn ? 'Watermark-free export' : '无水印导出'} aria-checked={exportOptions.watermarkType === 'none'} data-locked={!isVip || undefined} onClick={() => {
                      if (!isVip) {setShowVipTooltip(true);return;}
                      setWatermarkType(exportOptions.watermarkType === 'none' ? 'double_diagonal' : 'none');setShowVipTooltip(false);
                    }}><span /></button>
                  </div>
                  <p className="export-modal-vip-note">{isEn ? 'Sharper output. Same grid, proportions and layout.' : '只提升清晰度，不改变网格、比例与排版。'}</p>
                  {showVipTooltip && <p className="export-modal-vip-notice" role="status">{isEn ? 'Ultra and watermark-free export require VIP.' : '极清与无水印为 VIP 专属权益，开通后即可使用。'}{!isVip && openVipBenefits && <button type="button" onClick={openVipBenefits}>{isEn ? 'View benefits' : '查看 VIP 权益'}</button>}</p>}
                </section>

                <section className="export-modal-setting-section">
                  <div className="export-modal-section-heading"><h3><FileImage size={14} aria-hidden="true" />{isEn ? 'Output file' : '输出文件'}</h3>
                    <button type="button" className="export-modal-text-button" onClick={resetSettings}><RotateCcw size={12} aria-hidden="true" />{isEn ? 'Reset' : '重置'}</button>
                  </div>
                  <label className="export-modal-field"><span>{isEn ? 'File name' : '文件名称'}</span>
                    <input type="text" value={filename} onChange={event => setFilename(event.target.value)} maxLength={120} placeholder={projectName || (isEn ? 'Pattern' : '拼豆图纸')} aria-describedby={titleId + '-filename'} />
                  </label>
                  <p className="export-modal-filename" id={titleId + '-filename'}>{outputFilename}</p>
                  <label className="export-modal-field"><span>{isEn ? 'Export range' : '导出范围'}</span>
                    <select value={currentBoard === null ? 'full' : currentBoard} onChange={event => setSelectedBoard(event.target.value === 'full' ? null : Number(event.target.value))}>
                      <option value="full">{isEn ? 'Full pattern · ' + totalBoards + ' board(s)' : '完整图纸 · ' + totalBoards + ' 块板'}</option>
                      {totalBoards > 1 && Array.from({ length: totalBoards }, (_, index) => <option key={index} value={index}>{isEn ? 'Board ' + (index + 1) + ' · row ' + (Math.floor(index / boardsX) + 1) + ', column ' + (index % boardsX + 1) : '第 ' + (index + 1) + ' 板 · ' + (Math.floor(index / boardsX) + 1) + ' 行 ' + (index % boardsX + 1) + ' 列'}</option>)}
                    </select>
                  </label>
                  {totalBoards > 1 && <div className="export-modal-board-nav" role="group" aria-label={isEn ? 'Browse boards' : '查看分板'}>
                    <button type="button" disabled={currentBoard === 0} aria-label={isEn ? 'Previous board' : '上一块分板'} onClick={() => setSelectedBoard(Math.max(0, (currentBoard ?? 1) - 1))}><ChevronLeft size={16} /></button>
                    <span>{currentBoard === null ? (isEn ? 'Overview · ' : '总览 · ') + totalBoards + (isEn ? ' boards' : ' 块板') : (Math.floor(currentBoard / boardsX) + 1) + (isEn ? ' row · ' : ' 行 · ') + (currentBoard % boardsX + 1) + (isEn ? ' column' : ' 列')}</span>
                    <button type="button" disabled={currentBoard === totalBoards - 1} aria-label={isEn ? 'Next board' : '下一块分板'} onClick={() => setSelectedBoard(Math.min(totalBoards - 1, (currentBoard ?? -1) + 1))}><ChevronRight size={16} /></button>
                  </div>}
                  {totalBoards > 1 && <p className="export-modal-setting-hint">{fullOverviewTooLarge
                    ? (isEn ? 'Full overview is too large. Batch export still includes every original-size board.' : '整图超过安全尺寸，仍可批量导出全部原尺寸分板。')
                    : (isEn ? 'Batch includes one overview plus ' + totalBoards + ' boards, ordered left-to-right and top-to-bottom.' : '批量包含 1 张总览与 ' + totalBoards + ' 张分板，从左到右、从上到下编号。')}</p>}
                </section>

                <details className="export-modal-setting-section export-modal-more">
                  <summary><h3><Sliders size={14} aria-hidden="true" />{isEn ? 'Layout & labels' : '排版与标识'}</h3><small>{showSymbols ? (isEn ? 'Codes on' : '显示色号') : (isEn ? 'Codes off' : '不显示色号')}</small></summary>
                  <div className="export-modal-more-body">
                  <label className="export-modal-toggle"><span>{isEn ? 'Show color codes' : '显示色号标识'}</span><input type="checkbox" checked={showSymbols} onChange={event => { setShowSymbols(event.target.checked); setSymbolDisplayType(event.target.checked ? 'code' : 'none'); }} /></label>
                  {showSymbols && <label className="export-modal-field export-modal-field-inline"><span>{isEn ? 'Code size' : '色号字号'}</span>
                    <select value={symbolFontScale} onChange={event => setSymbolFontScale(Number(event.target.value))}><option value="0.75">75%</option><option value="1">100%</option><option value="1.25">125%</option><option value="1.5">150%</option></select>
                  </label>}
                  <label className="export-modal-toggle"><span>{isEn ? 'Show ruler coordinates' : '显示标尺坐标'}</span><input type="checkbox" checked={showCoordinates} onChange={event => setShowCoordinates(event.target.checked)} /></label>
                  <label className="export-modal-toggle"><span>{isEn ? 'Hide empty pegs' : '隐藏空白豆位'}</span><input type="checkbox" checked={hideEmptyPegs} onChange={event => setHideEmptyPegs(event.target.checked)} /></label>
                  <label className="export-modal-field export-modal-field-inline"><span>{isEn ? 'Checklist position' : '用量清单位置'}</span>
                    <select value={legendPosition} onChange={event => setLegendPosition(event.target.value as LegendPosition)}><option value="right">{isEn ? 'Right' : '右侧'}</option><option value="bottom">{isEn ? 'Bottom' : '下方'}</option></select>
                  </label>
                  </div>
                </details>

                <details className="export-modal-setting-section export-modal-more">
                  <summary><h3><ShieldAlert size={14} aria-hidden="true" />{isEn ? 'Watermark details' : '水印细节'}</h3><small>{exportOptions.watermarkType === 'none' ? (isEn ? 'Off' : '已关闭') : (isEn ? 'Watermarked' : '带水印')}</small></summary>
                  <div className="export-modal-more-body">
                  {exportOptions.watermarkType !== 'none' && <>
                    <label className="export-modal-field export-modal-field-inline"><span>{isEn ? 'Opacity' : '水印不透明度'}</span><select value={watermarkOpacity} onChange={event => setWatermarkOpacity(Number(event.target.value))}><option value="0.1">10%</option><option value="0.18">18%</option><option value="0.25">25%</option></select></label>
                    <label className="export-modal-field"><span>{isEn ? 'Watermark text' : '水印文字'}{!isVip && <Lock size={12} aria-hidden="true" />}</span>
                      <input type="text" disabled={!isVip} value={isVip ? watermarkText : (isEn ? 'BeadGrid' : '豆织星格')} onChange={event => setWatermarkText(event.target.value)} placeholder={isEn ? 'Store name' : '自定义店铺名'} />
                    </label>
                  </>}
                  {exportOptions.watermarkType === 'none' && <p className="export-modal-setting-hint">{isEn ? 'Watermark-free export is on. Enable the watermark above to customize its text.' : '已开启无水印导出；如需自定义水印文字，可在上方关闭无水印。'}</p>}
                  </div>
                </details>
                <details className="export-modal-materials">
                  <summary><Palette size={14} aria-hidden="true" /><span>{isEn ? 'Materials checklist' : '材料用量清单'}</span><span>{summary.colorCount}{isEn ? ' colors' : ' 色'}</span></summary>
                  <p>{isEn ? 'Included in the PNG for the selected range.' : '下载的 PNG 已包含当前范围的用量清单。'}</p>
                  {summary.materials.length > 0 ? <table>
                    <caption className="export-modal-sr-only">{scopeLabel} · {isEn ? 'Materials checklist' : '材料用量清单'}</caption>
                    <thead><tr><th scope="col">{isEn ? 'Color code' : '色号'}</th><th scope="col">{isEn ? 'Color' : '颜色'}</th><th scope="col">{isEn ? 'Quantity' : '数量'}</th></tr></thead>
                    <tbody>{summary.materials.map(({ id, bead, count }) => <tr key={id}>
                      <td><span className="export-modal-swatch" style={{ backgroundColor: bead?.hex ?? 'transparent' }} />{bead?.code ?? id}</td>
                      <td>{bead?.name ?? (isEn ? 'Unknown color' : '未识别颜色')}</td><td>{count.toLocaleString(isEn ? 'en-US' : 'zh-CN')}</td>
                    </tr>)}</tbody>
                  </table> : <p>{isEn ? 'No beads in this view.' : '当前范围没有拼豆。'}</p>}
                </details>
              </fieldset>
            </aside>
          </div>

          <footer className="export-modal-footer">
            <div className="export-modal-feedback" role="status" aria-live="polite" data-state={downloadState} data-archive-message={archiveMessage ? true : undefined}>
              <strong>{downloadMessage ?? (isEn ? 'Completed-pattern PNG export · Free' : '已完成图纸 PNG 导出 · 免费')}</strong>
              <span>{archiveMessage ?? (archiveOnExport
                ? (isEn ? 'Includes color codes and a materials checklist. Editable history is saved after download.' : '包含色号与用量清单；下载后自动保存可编辑图纸记录。')
                : (isEn ? 'Exports this public pattern without changing your canvas or saving an editable copy.' : '仅导出公开图纸，不修改当前画板，也不会自动保存可编辑副本。'))}</span>
            </div>
            <div className="export-modal-actions">
              {batchProgress && <button type="button" className="export-modal-button export-modal-button-secondary" disabled={cancelBatchRef.current} onClick={() => { cancelBatchRef.current = true; setDownloadMessage(isEn ? 'Stopping after the current file…' : '正在停止，将保留已启动的下载…'); }}>{isEn ? 'Stop batch' : '停止批量'}</button>}
              {totalBoards > 1 && !batchProgress && <button type="button" className="export-modal-button export-modal-button-secondary" disabled={isBusy} onClick={() => handleDownloadClick('all')}><Download size={16} aria-hidden="true" /><span>{isEn ? 'All boards (' + (totalBoards + (fullOverviewTooLarge ? 0 : 1)) + ')' : '全部分板（' + (totalBoards + (fullOverviewTooLarge ? 0 : 1)) + ' 张）'}</span></button>}
              <button type="button" className="export-modal-button export-modal-button-primary" disabled={isBusy || Boolean(previewError)} onClick={() => handleDownloadClick('single')}>
                {isBusy ? <RotateCw size={16} className="export-modal-spinner" aria-hidden="true" /> : <Download size={16} aria-hidden="true" />}
                <span>{isBusy ? (isEn ? 'Exporting…' : '正在导出…') : cleanExport ? (isEn ? 'Download clean PNG' : '下载无水印 PNG') : (isEn ? 'Download PNG' : '下载高清 PNG')}</span>
              </button>
            </div>
          </footer>
        </div>

        {showFreeDownloadModal && <div className="export-modal-suboverlay">
          <section data-export-subdialog role="dialog" aria-modal="true" aria-labelledby={titleId + '-notice'} className="export-modal-subdialog">
            <div className="export-modal-section-heading"><span className="export-modal-mark"><Crown size={22} /></span><button type="button" className="export-modal-icon-button" autoFocus onClick={() => { setShowFreeDownloadModal(false); setPendingDownloadType(null); }} aria-label={isEn ? 'Cancel download' : '取消下载'}><X size={20} /></button></div>
            <h3 id={titleId + '-notice'}>{isEn ? 'Your free PNG is ready to export' : '免费导出，保留水印'}</h3>
            <p>{isEn ? 'Free exports include a watermark. VIP enables watermark-free commercial patterns.' : '免费版本导出图纸自带防盗水印。如需无水印商用图纸，可开通 VIP 会员。'}</p>
            <button type="button" className="export-modal-button export-modal-button-primary" onClick={confirmFreeDownload}>{isEn ? 'Download watermarked PNG' : '确认下载带水印文件'}</button>
            {openVipBenefits && <button type="button" className="export-modal-button export-modal-button-secondary" onClick={() => { setShowFreeDownloadModal(false); setPendingDownloadType(null); openVipBenefits(); }}><Crown size={15} />{isEn ? 'Upgrade VIP for clean export' : '升级 VIP 纯净导出'}</button>}
          </section>
        </div>}

        {wechatPreviewUrl && <div className="export-modal-suboverlay">
          <section data-export-subdialog role="dialog" aria-modal="true" aria-labelledby={titleId + '-wechat'} className="export-modal-subdialog export-modal-wechat">
            <div className="export-modal-section-heading"><h3 id={titleId + '-wechat'}>{isEn ? 'Save in WeChat' : '微信导出保存指南'}</h3><button type="button" autoFocus className="export-modal-icon-button" onClick={() => setWechatPreviewUrl(null)} aria-label={isEn ? 'Close save guide' : '关闭保存指南'}><X size={20} /></button></div>
            <p>{isEn ? 'Long-press the image and choose Save Image. To download all boards, open this page in your browser from the WeChat menu.' : '长按下方图纸，选择「保存图片」。批量下载请从微信右上角「···」选择「在浏览器打开」。'}</p>
            <div className="export-modal-wechat-image"><img src={wechatPreviewUrl} alt={isEn ? 'Exported bead pattern' : '高清拼豆图纸'} /></div>
            <button type="button" className="export-modal-button export-modal-button-primary" onClick={() => setWechatPreviewUrl(null)}>{isEn ? 'Done' : '完成'}</button>
          </section>
        </div>}
      </div>
    </div>
  );
};
