import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Check,
  Clipboard,
  Save,
  Pencil,
  ChevronLeft,
  ChevronRight,
  ImagePlus,
  Lock,
  ScanSearch,
  Eraser,
  Undo2,
  Upload,
  X,
} from 'lucide-react';
import type { BeadColor, BrandKey } from '../types';
import { BRAND_NAMES, BRAND_ORDER, BRAND_PALETTES } from '../data/palettes';
import { applyRecognitionCorrections, getRecognitionReviewCells, recognitionCellKey, type ImportRecognitionCorrections } from '../utils/importRecognitionReview';
import { ImportRecognitionCanvas, ImportSourceCellCrop } from './ImportRecognitionCanvas';
import { getRecognitionBackgroundCandidate, getRecognitionBackgroundCells, recognitionBackgroundCorrections, releaseRecognitionBackgroundCell } from '../utils/recognitionBackground';
import './ImportBlueprintWizard.css';
import { confirmRecognitionResult, type ConfirmedRecognitionDraft } from '../utils/confirmedRecognition';
import { ImportGridAlignmentCanvas } from './ImportGridAlignmentCanvas';
import {
  clipRecognitionRegion,
  createDefaultGridAlignment,
  deriveAlignedCalibration,
  moveGridAlignment,
  normalizeGridAlignment,
  type ImportGridAlignment,
  type ImportRecognitionRegion,
} from '../utils/importGridAlignment';
import {
  freezeImportCalibrationSnapshot,
  type ImportCalibrationSnapshot,
  type ImportImageDimensions,
} from '../utils/importGridCalibration';
import {
  recognizeImportImageAsync,
  recognitionResultToCodeMatrix,
  type ImportRecognitionMode,
  type ImportRecognitionResult,
} from '../utils/importRecognition';
import { describeGains } from '../utils/importColorBalance';
import { estimateBeadPitch } from '../utils/importGridPitch';

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

/** 把"这次自动做了什么"翻译成一句人话；没有触发就返回空字符串。 */
function describeAutoCorrection(result: ImportRecognitionResult | null): string {
  const info = result?.autoCorrection;
  if (!info) return '';
  const parts: string[] = [];
  if (info.colorGains) parts.push(describeGains(info.colorGains));
  if (info.gridOffset.x !== 0 || info.gridOffset.y !== 0) {
    parts.push(`网格整体偏移已校正 ${info.gridOffset.x.toFixed(2)} / ${info.gridOffset.y.toFixed(2)} 格`);
  }
  return parts.join('；');
}
const SUPPORTED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
type PaletteChoice = Exclude<BrandKey, 'CUSTOM'> | 'ACTIVE';
const BUILT_IN_BRANDS = BRAND_ORDER.filter((brand): brand is Exclude<BrandKey, 'CUSTOM'> => brand !== 'CUSTOM');

function initialPaletteChoice(palette: BeadColor[]): PaletteChoice {
  return BUILT_IN_BRANDS.find(brand => BRAND_PALETTES[brand].length === palette.length && BRAND_PALETTES[brand].every((color, index) => color.id === palette[index]?.id && color.hex === palette[index]?.hex)) ?? 'ACTIVE';
}

type WizardStep = 'upload' | 'calibrate' | 'recognize';
type StatusTone = 'neutral' | 'error' | 'success';

interface ImportBlueprintWizardProps {
  isOpen: boolean;
  onClose: () => void;
  activePalette: BeadColor[];
  canSave: boolean;
  onRequestLogin: () => void;
  onSave: (draft: ConfirmedRecognitionDraft) => Promise<string>;
  onEdit: (draft: ConfirmedRecognitionDraft, saved: boolean) => boolean;
}

type NumericDrafts = Record<keyof ImportGridAlignment, string>;
type RegionDrafts = Record<keyof ImportRecognitionRegion, string>;

function createRegionDrafts(region: ImportRecognitionRegion): RegionDrafts {
  return { x: String(Number(region.x.toFixed(3))), y: String(Number(region.y.toFixed(3))), width: String(Number(region.width.toFixed(3))), height: String(Number(region.height.toFixed(3))) };
}

function createDrafts(alignment: ImportGridAlignment): NumericDrafts {
  return {
    cellSize: String(Number(alignment.cellSize.toFixed(3))),
    originX: String(Number(alignment.originX.toFixed(3))),
    originY: String(Number(alignment.originY.toFixed(3))),
  };
}

export function ImportBlueprintWizard({ isOpen, onClose, activePalette, canSave, onRequestLogin, onSave, onEdit }: ImportBlueprintWizardProps) {
  const [step, setStep] = useState<WizardStep>('upload');
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageName, setImageName] = useState('');
  const [imageDimensions, setImageDimensions] = useState<ImportImageDimensions | null>(null);
  const [imageElement, setImageElement] = useState<HTMLImageElement | null>(null);
  const [alignment, setAlignment] = useState<ImportGridAlignment | null>(null);
  const [region, setRegion] = useState<ImportRecognitionRegion | null>(null);
  const [snapshot, setSnapshot] = useState<ImportCalibrationSnapshot | null>(null);
  const [status, setStatus] = useState<{ tone: StatusTone; message: string } | null>(null);
  const [drafts, setDrafts] = useState<NumericDrafts | null>(null);
  const [regionDrafts, setRegionDrafts] = useState<RegionDrafts | null>(null);
  const [recognitionMode, setRecognitionMode] = useState<ImportRecognitionMode>('precision');
  const [adjustmentStep, setAdjustmentStep] = useState(0.1);
  const [recognition, setRecognition] = useState<ImportRecognitionResult | null>(null);
  const [selectedCell, setSelectedCell] = useState<{ row: number; column: number } | null>(null);
  const [isRecognizing, setIsRecognizing] = useState(false);
  const [recognitionProgress, setRecognitionProgress] = useState(0);
  const [paletteChoice, setPaletteChoice] = useState<PaletteChoice>(() => initialPaletteChoice(activePalette));
  const [localPalette, setLocalPalette] = useState<BeadColor[]>(activePalette);
  const [edgeInsetRatio, setEdgeInsetRatio] = useState(0);
  // 三项都默认关闭：网格对准、图是数字原图时，任何"额外校正"都只会把颜色推偏。
  const [beadPhoto, setBeadPhoto] = useState(false);
  const [smoothNoise, setSmoothNoise] = useState(false);
  const [pitchHint, setPitchHint] = useState<string | null>(null);
  const [autoColorBalance, setAutoColorBalance] = useState(false);
  const [autoAlign, setAutoAlign] = useState(false);
  const [corrections, setCorrections] = useState<ImportRecognitionCorrections>({});
  const [backgroundHistory, setBackgroundHistory] = useState<string[][]>([]);
  const [backgroundColorId, setBackgroundColorId] = useState('');
  const [backgroundStatus, setBackgroundStatus] = useState<string | null>(null);
  const [onlyReview, setOnlyReview] = useState(false);
  const [colorSearch, setColorSearch] = useState('');
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [resultTitle, setResultTitle] = useState('');
  const [confirmation, setConfirmation] = useState<{ result: ImportRecognitionResult; draft: ConfirmedRecognitionDraft } | null>(null);
  const [savedDraftId, setSavedDraftId] = useState<string | null>(null);
  const [isSavingRecognition, setIsSavingRecognition] = useState(false);
  const saveBusyRef = useRef(false);
  const currentConfirmationIdRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const openRef = useRef(isOpen);
  const wasOpenRef = useRef(false);
  const imageLoadIdRef = useRef(0);
  const pendingImageUrlRef = useRef<string | null>(null);
  openRef.current = isOpen;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const objectUrlRef = useRef<string | null>(null);
  const recognitionControllerRef = useRef<AbortController | null>(null);

  const derived = useMemo(() => alignment && region && imageDimensions
    ? deriveAlignedCalibration(alignment, region, imageDimensions)
    : null, [alignment, region, imageDimensions]);
  const calibration = derived?.calibration ?? null;

  const cancelRecognition = useCallback(() => {
    recognitionControllerRef.current?.abort();
    recognitionControllerRef.current = null;
    setIsRecognizing(false);
    setRecognitionProgress(0);
  }, []);

  const invalidateConfirmation = useCallback(() => {
    setConfirmation(null);
    setSavedDraftId(null);
    currentConfirmationIdRef.current = null;
  }, []);

  const resetBackground = useCallback(() => {
    setBackgroundHistory([]);
    setBackgroundColorId('');
    setBackgroundStatus(null);
  }, []);

  const invalidateRecognition = useCallback(() => {
    cancelRecognition();
    resetBackground();
    setRecognition(null);
    setCorrections({});
    setSelectedCell(null);
    setOnlyReview(false);
    setColorSearch('');
    invalidateConfirmation();
  }, [cancelRecognition, resetBackground, invalidateConfirmation]);

  const clearImage = useCallback(() => {
    invalidateRecognition();
    imageLoadIdRef.current += 1;
    if (pendingImageUrlRef.current) URL.revokeObjectURL(pendingImageUrlRef.current);
    pendingImageUrlRef.current = null;
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = null;
    setImageUrl(null);
    setImageElement(null);
    setImageDimensions(null);
    setAlignment(null);
    setRegion(null);
    setSnapshot(null);
    setDrafts(null);
    setRegionDrafts(null);
    setRecognition(null);
    setRecognitionMode('precision');
    setAdjustmentStep(0.1);
    setEdgeInsetRatio(0);
    setIsDraggingFile(false);
    setSelectedCell(null);
    setIsRecognizing(false);
    setResultTitle('');
    setIsSavingRecognition(saveBusyRef.current);
    setStep('upload');
  }, [invalidateRecognition]);

  const resetWizard = useCallback(() => {
    clearImage();
    setImageName('');
    setStatus(null);
  }, [clearImage]);

  const closeWizard = useCallback(() => {
    cancelRecognition();
    imageLoadIdRef.current += 1;
    openRef.current = false;
    onClose();
  }, [cancelRecognition, onClose]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      imageLoadIdRef.current += 1;
      recognitionControllerRef.current?.abort();
      recognitionControllerRef.current = null;
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      if (pendingImageUrlRef.current) URL.revokeObjectURL(pendingImageUrlRef.current);
    };
  }, []);

  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      setLocalPalette(activePalette);
      setPaletteChoice(initialPaletteChoice(activePalette));
    }
    wasOpenRef.current = isOpen;
  }, [isOpen, activePalette]);

  useEffect(() => {
    if (!isOpen) resetWizard();
  }, [isOpen, resetWizard]);

  useEffect(() => {
    if (!isOpen) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLButtonElement>('button')?.focus());
    return () => {
      cancelAnimationFrame(frame);
      if (previous?.isConnected) previous.focus();
    };
  }, [isOpen]);

  const setAlignmentValue = useCallback((value: ImportGridAlignment) => {
    const next = normalizeGridAlignment(value);
    invalidateRecognition();
    setAlignment(next);
    setDrafts(createDrafts(next));
    setSnapshot(null);
  }, [invalidateRecognition]);

  const setRegionValue = useCallback((next: ImportRecognitionRegion) => {
    if (!imageDimensions) return;
    const clipped = clipRecognitionRegion(next, imageDimensions);
    invalidateRecognition();
    setRegion(clipped);
    setRegionDrafts(createRegionDrafts(clipped));
    setSnapshot(null);
  }, [imageDimensions, invalidateRecognition]);

  const loadFile = useCallback((file: File | undefined) => {
    if (!file) {
      setStatus({ tone: 'neutral', message: '已取消选择图片。' });
      return;
    }
    if (!SUPPORTED_IMAGE_TYPES.has(file.type)) {
      setStatus({ tone: 'error', message: '暂不支持此图片格式，请选择 PNG、JPG 或 WebP。' });
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setStatus({ tone: 'error', message: '图片超过 15 MB，请压缩后重新选择。' });
      return;
    }

    // Keep the last valid image, result and manual review until decoding succeeds.
    cancelRecognition();
    const loadId = ++imageLoadIdRef.current;
    if (pendingImageUrlRef.current) URL.revokeObjectURL(pendingImageUrlRef.current);
    const nextUrl = URL.createObjectURL(file);
    pendingImageUrlRef.current = nextUrl;
    const image = new Image();
    image.onload = () => {
      if (!mountedRef.current || !openRef.current || loadId !== imageLoadIdRef.current) { URL.revokeObjectURL(nextUrl); return; }
      invalidateRecognition();
      pendingImageUrlRef.current = null;
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = nextUrl;
      const dimensions = { width: image.naturalWidth || image.width, height: image.naturalHeight || image.height };
      const nextAlignment = createDefaultGridAlignment(dimensions);
      setImageUrl(nextUrl);
      setImageElement(image);
      setImageName(file.name);
      setResultTitle((file.name.replace(/\.[^/.]+$/, '') || '识别图纸').slice(0, 60));
      setImageDimensions(dimensions);
      setAlignment(nextAlignment);
      setRegion({ x: 0, y: 0, ...dimensions });
      setRegionDrafts(createRegionDrafts({ x: 0, y: 0, ...dimensions }));
      setDrafts(createDrafts(nextAlignment));
      setSnapshot(null);
      setStep('calibrate');
      setStatus({ tone: 'success', message: '图片已加载，可以开始校准网格。' });
    };
    image.onerror = () => {
      URL.revokeObjectURL(nextUrl);
      if (!mountedRef.current || !openRef.current || loadId !== imageLoadIdRef.current) return;
      pendingImageUrlRef.current = null;
      setStatus({ tone: 'error', message: '图片加载失败，请重新选择有效的本地图片。' });
    };
    image.src = nextUrl;
  }, [cancelRecognition, invalidateRecognition]);

  const commitDraft = useCallback((key: keyof NumericDrafts) => {
    if (!alignment || !drafts) return;
    const parsed = drafts[key].trim() === '' ? NaN : Number(drafts[key]);
    if (!Number.isFinite(parsed)) { setDrafts(createDrafts(alignment)); return; }
    setAlignmentValue({ ...alignment, [key]: parsed });
  }, [alignment, drafts, setAlignmentValue]);

  const commitRegionDraft = (key: keyof RegionDrafts) => {
    if (!region || !regionDrafts) return;
    const parsed = regionDrafts[key].trim() === '' ? NaN : Number(regionDrafts[key]);
    if (!Number.isFinite(parsed)) { setRegionDrafts(createRegionDrafts(region)); return; }
    setRegionValue({ ...region, [key]: parsed });
  };

  const nudgeGrid = (x: number, y: number) => {
    if (alignment) setAlignmentValue(moveGridAlignment(alignment, { x: x * adjustmentStep, y: y * adjustmentStep }));
  };
  const adjustCellSize = (direction: number) => {
    if (alignment) setAlignmentValue({ ...alignment, cellSize: alignment.cellSize + direction * adjustmentStep });
  };
  const resetCalibration = useCallback(() => {
    if (!imageDimensions) return;
    setAlignmentValue(createDefaultGridAlignment(imageDimensions));
    setStatus({ tone: 'neutral', message: '网格已恢复为 5 px 正方形格，识别区域已保留。' });
  }, [imageDimensions, setAlignmentValue]);

  const nextStep = useCallback(() => {
    if (!calibration || !imageDimensions || !imageUrl) return;
    const frozen = freezeImportCalibrationSnapshot(calibration);
    setSnapshot(frozen);
    setRecognition(null);
    setCorrections({});
    resetBackground();
    invalidateConfirmation();
    setStep('recognize');
    setStatus({ tone: 'neutral', message: '校准已冻结，请选择识别模式并开始识别。' });
  }, [calibration, imageDimensions, imageUrl, resetBackground, invalidateConfirmation]);

  const runRecognition = useCallback(async () => {
    if (recognitionControllerRef.current || !imageElement || !imageDimensions || !snapshot || localPalette.length === 0) return;
    const controller = new AbortController();
    recognitionControllerRef.current = controller;
    setIsRecognizing(true);
    setRecognitionProgress(0);
    setRecognition(null);
    setCorrections({});
    resetBackground();
    invalidateConfirmation();
    setOnlyReview(false);
    setSelectedCell(null);
    setStatus({ tone: 'neutral', message: '正在准备图片像素…' });
    try {
      const canvas = document.createElement('canvas');
      canvas.width = imageDimensions.width;
      canvas.height = imageDimensions.height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('无法读取图片像素，请重新选择图片。');
      context.drawImage(imageElement, 0, 0, imageDimensions.width, imageDimensions.height);
      const result = await recognizeImportImageAsync(
        { data: context.getImageData(0, 0, imageDimensions.width, imageDimensions.height).data, ...imageDimensions },
        snapshot.calibration,
        localPalette,
        recognitionMode,
        undefined,
        { signal: controller.signal, onProgress: value => {
          if (mountedRef.current && openRef.current && recognitionControllerRef.current === controller && !controller.signal.aborted) setRecognitionProgress(Math.floor(value));
        }, batchSize: 256, edgeInsetRatio, beadPhoto, autoColorBalance, autoAlign, smooth: smoothNoise },
      );
      if (!mountedRef.current || !openRef.current || recognitionControllerRef.current !== controller || controller.signal.aborted) return;
      setRecognition(result);
      setSelectedCell({ row: 0, column: 0 });
      const qualityLabel = result.summary.quality === 'good' ? '较好' : result.summary.quality === 'fair' ? '一般' : '较低，请核对预览';
      setStatus({
        tone: result.summary.quality === 'good' ? 'success' : 'neutral',
        message: `识别完成，主色区分度${qualityLabel}：${result.summary.mapped} 格已匹配，${result.summary.blank} 格为空白，${result.summary.lowConfidence} 格主色不够明显，请核对。`,
      });
    } catch (error) {
      if (!mountedRef.current || !openRef.current || recognitionControllerRef.current !== controller || controller.signal.aborted) return;
      setRecognition(null);
      setRecognitionProgress(0);
      setStatus({ tone: 'error', message: error instanceof Error ? error.message : '识别失败，请重试。' });
    } finally {
      if (mountedRef.current && openRef.current && recognitionControllerRef.current === controller) {
        recognitionControllerRef.current = null;
        setIsRecognizing(false);
      }
    }
  }, [localPalette, edgeInsetRatio, beadPhoto, autoColorBalance, autoAlign, smoothNoise, imageDimensions, imageElement, recognitionMode, snapshot, resetBackground, invalidateConfirmation]);

  const backgroundCorrections = useMemo(() => recognitionBackgroundCorrections(backgroundHistory), [backgroundHistory]);
  const effectiveCorrections = useMemo(() => ({ ...corrections, ...backgroundCorrections }), [corrections, backgroundCorrections]);
  const effectiveRecognition = useMemo(() => recognition ? applyRecognitionCorrections(recognition, effectiveCorrections, localPalette) : null, [recognition, effectiveCorrections, localPalette]);
  const currentConfirmation = confirmation && confirmation.result === effectiveRecognition && confirmation.draft.title === resultTitle.trim() ? confirmation.draft : null;
  currentConfirmationIdRef.current = currentConfirmation?.id ?? null;
  const pendingCells = useMemo(() => recognition ? getRecognitionReviewCells(recognition, effectiveCorrections) : [], [recognition, effectiveCorrections]);
  const pendingKeys = useMemo(() => new Set(pendingCells.map(cell => recognitionCellKey(cell.row, cell.column))), [pendingCells]);
  const initialReviewCount = useMemo(() => recognition ? getRecognitionReviewCells(recognition).length : 0, [recognition]);

  const copyCodeMatrix = useCallback(async () => {
    if (!effectiveRecognition) return;
    try {
      await navigator.clipboard.writeText(recognitionResultToCodeMatrix(effectiveRecognition).map(row => row.join('\t')).join('\n'));
      if (mountedRef.current && openRef.current) setStatus({ tone: 'success', message: '颜色代码矩阵已复制，包含本次人工修正和背景移除。' });
    } catch {
      if (mountedRef.current && openRef.current) setStatus({ tone: 'error', message: '复制失败，请检查浏览器剪贴板权限。' });
    }
  }, [effectiveRecognition]);

  const backToEdit = useCallback(() => {
    if (!alignment || !region) return;
    invalidateRecognition();
    setSnapshot(null);
    setStep('calibrate');
    setStatus({ tone: 'neutral', message: '已恢复冻结前的校准参数，可以继续修改。' });
  }, [alignment, region, invalidateRecognition]);

  const gridSummary = useMemo(() => {
    if (!alignment) return '等待图片';
    if (!calibration) return `格距 ${Number(alignment.cellSize.toFixed(3))} px · 暂无可识别完整格`;
    const width = Number(calibration.cellWidth.toFixed(3));
    const height = Number(calibration.cellHeight.toFixed(3));
    return `${calibration.columns} 列 × ${calibration.rows} 行 · ${width} × ${height} px/格`;
  }, [alignment, calibration]);

  const colorCounts = useMemo(() => {
    if (!effectiveRecognition) return [];
    const counts = new Map<string, { id: string; code: string; name: string; hex: string; count: number }>();
    effectiveRecognition.cells.forEach(row => row.forEach(cell => {
      if (!cell.color) return;
      const item = counts.get(cell.color.id) ?? { id: cell.color.id, code: cell.color.code, name: cell.color.name, hex: cell.color.hex, count: 0 };
      item.count += 1;
      counts.set(cell.color.id, item);
    }));
    return [...counts.values()].sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
  }, [effectiveRecognition]);
  const selectedResult = selectedCell ? recognition?.cells[selectedCell.row]?.[selectedCell.column] ?? null : null;
  const selectedEffective = selectedCell ? effectiveRecognition?.cells[selectedCell.row]?.[selectedCell.column] ?? null : null;
  const selectedKey = selectedCell ? recognitionCellKey(selectedCell.row, selectedCell.column) : null;
  const selectedIsManual = selectedKey !== null && Object.prototype.hasOwnProperty.call(corrections, selectedKey);
  const selectedIsBackground = selectedKey !== null && Object.hasOwn(backgroundCorrections, selectedKey);
  const manualCount = Object.keys(corrections).length;
  const majorityBackgroundId = useMemo(() => effectiveRecognition ? getRecognitionBackgroundCandidate(effectiveRecognition) : null, [effectiveRecognition]);
  const candidateBackgroundId = backgroundColorId || selectedEffective?.colorId || majorityBackgroundId;
  const candidateBackground = localPalette.find(color => color.id === candidateBackgroundId);
  const backgroundCells = useMemo(() => effectiveRecognition ? getRecognitionBackgroundCells(effectiveRecognition, candidateBackgroundId) : [], [effectiveRecognition, candidateBackgroundId]);
  const removedBackgroundCount = backgroundHistory.reduce((total, batch) => total + batch.length, 0);
  const filteredPalette = useMemo(() => {
    const query = colorSearch.trim().toLocaleLowerCase();
    return localPalette.filter(color => color.enabled !== false && (!query || `${color.code} ${color.name} ${color.hex}`.toLocaleLowerCase().includes(query)));
  }, [colorSearch, localPalette]);
  const passedPaletteLabel = activePalette.length && activePalette.every(color => color.brand === activePalette[0].brand) ? `${BRAND_NAMES[activePalette[0].brand]} · 当前色板` : '当前传入色板';
  const paletteLabel = paletteChoice === 'ACTIVE' ? passedPaletteLabel : BRAND_NAMES[paletteChoice];

  const changePalette = (value: PaletteChoice) => {
    if (value === paletteChoice) return;
    invalidateRecognition();
    setPaletteChoice(value);
    setLocalPalette(value === 'ACTIVE' ? activePalette : BRAND_PALETTES[value]);
    setStatus({ tone: 'neutral', message: '本地色板已切换，请重新识别。' });
  };
  const movePending = (direction: number) => {
    if (!recognition || pendingCells.length === 0) return;
    const columns = recognition.calibration.columns;
    const index = selectedCell ? selectedCell.row * columns + selectedCell.column : direction > 0 ? -1 : Infinity;
    const candidate = direction > 0 ? pendingCells.find(cell => cell.row * columns + cell.column > index) : [...pendingCells].reverse().find(cell => cell.row * columns + cell.column < index);
    setSelectedCell(candidate ?? pendingCells[direction > 0 ? 0 : pendingCells.length - 1]);
  };
  const correctSelected = (colorId: string | null) => {
    if (selectedKey === null) return;
    invalidateConfirmation();
    setBackgroundHistory(current => releaseRecognitionBackgroundCell(current, selectedKey));
    setCorrections(current => ({ ...current, [selectedKey]: colorId }));
    setStatus({ tone: 'neutral', message: '本格已修正，请重新确认当前结果。' });
  };
  const resetSelectedCorrection = () => {
    if (selectedKey === null) return;
    invalidateConfirmation();
    setBackgroundHistory(current => releaseRecognitionBackgroundCell(current, selectedKey));
    setCorrections(current => { const next = { ...current }; delete next[selectedKey]; return next; });
    setStatus({ tone: 'neutral', message: '本格已恢复自动结果，请重新确认。' });
  };
  const removeBackground = () => {
    if (!backgroundCells.length || !candidateBackgroundId) return;
    invalidateConfirmation();
    setBackgroundColorId(candidateBackgroundId);
    setBackgroundHistory(current => [...current, backgroundCells]);
    setBackgroundStatus(`本次已移除 ${backgroundCells.length} 格 ${candidateBackground?.code ?? ''} 背景，可撤销。`);
    setStatus({ tone: 'neutral', message: '背景已移除，请复核后重新确认当前结果。' });
  };
  const undoBackground = () => {
    const batch = backgroundHistory.at(-1);
    if (!batch) return;
    invalidateConfirmation();
    setBackgroundHistory(current => current.slice(0, -1));
    setBackgroundStatus(`已撤销上次背景移除，恢复 ${batch.length} 格；保留期间的逐格手改。`);
    setStatus({ tone: 'neutral', message: '背景移除已撤销，请重新确认当前结果。' });
  };
  const restoreAutomaticResult = () => {
    invalidateConfirmation();
    resetBackground();
    setCorrections({});
    setStatus({ tone: 'neutral', message: '已恢复全部自动识别结果，请重新确认。' });
  };

  const confirmResult = () => {
    if (!effectiveRecognition) return;
    try {
      const draft = confirmRecognitionResult(effectiveRecognition, localPalette, resultTitle);
      setConfirmation({ result: effectiveRecognition, draft });
      setSavedDraftId(null);
      setStatus({ tone: 'success', message: pendingCells.length
        ? `当前版本已确认（仍含 ${pendingCells.length} 格建议复核），可保存或进入编辑。`
        : '当前版本已确认，可以保存到图库或进入画板编辑。' });
    } catch (error) {
      setStatus({ tone: 'error', message: error instanceof Error ? error.message : '确认失败，请检查结果。' });
    }
  };

  const saveConfirmedResult = async () => {
    if (!currentConfirmation || saveBusyRef.current) return;
    if (!canSave) { onRequestLogin(); return; }
    const draft = currentConfirmation;
    saveBusyRef.current = true;
    setIsSavingRecognition(true);
    try {
      const message = await onSave(draft);
      if (mountedRef.current && openRef.current && currentConfirmationIdRef.current === draft.id) {
        setSavedDraftId(draft.id);
        setStatus({ tone: 'success', message });
      }
    } catch (error) {
      if (mountedRef.current && openRef.current && currentConfirmationIdRef.current === draft.id) {
        setStatus({ tone: 'error', message: error instanceof Error ? error.message : '保存失败，确认的识别结果已保留，可以重试。' });
      }
    } finally {
      saveBusyRef.current = false;
      if (mountedRef.current) setIsSavingRecognition(false);
    }
  };

  const editConfirmedResult = () => {
    if (!currentConfirmation || saveBusyRef.current) return;
    try {
      if (!onEdit(currentConfirmation, savedDraftId === currentConfirmation.id)) {
        setStatus({ tone: 'neutral', message: '已取消进入编辑，识别结果和当前画板均已保留。' });
      }
    } catch (error) {
      setStatus({ tone: 'error', message: error instanceof Error ? error.message : '无法进入编辑，识别结果已保留。' });
    }
  };

  if (!isOpen) return null;

  const updateDraft = (key: keyof NumericDrafts, value: string) => {
    setDrafts(current => current ? { ...current, [key]: value } : current);
  };

  /**
   * 按豆距估算格数。
   *
   * 用户最容易在这里出错：网格线看上去是对齐的，但格数只有实际豆数的一半，
   * 每格摊上 4~5 颗豆——颜色被平均，结果必然糊，而且从网格上完全看不出来。
   * 这里只做"建议 + 一键套用"，置信度低时只提示不套用。
   */
  // 注意：这里不能用 useCallback。组件在上方有 `if (!isOpen) return null`，
  // 任何写在这个提前返回之后的 Hook 都会让"打开/关闭"两条渲染路径的钩子数量不一致，
  // 触发 "Rendered more hooks than during the previous render" 并整页崩到 ErrorBoundary。
  const applyEstimatedPitch = () => {
    if (!imageElement || !imageDimensions || !alignment) return;
    const canvas = document.createElement('canvas');
    canvas.width = imageDimensions.width;
    canvas.height = imageDimensions.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return;
    context.drawImage(imageElement, 0, 0);
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    const estimate = estimateBeadPitch({ data, width: canvas.width, height: canvas.height });
    if (!estimate) {
      setPitchHint('没能估算豆距：图片太小或图案过于平滑，请手动填方格边长。');
      return;
    }
    const summary = `检测到豆距约 ${estimate.cell.toFixed(1)} px（约 ${estimate.columns} × ${estimate.rows} 格），置信度 ${(estimate.confidence * 100).toFixed(0)}%`;
    if (estimate.confidence < 0.15) {
      setPitchHint(`${summary}。置信度太低，没有套用，请手动微调。`);
      return;
    }
    setAlignmentValue({ ...alignment, cellSize: estimate.cell });
    updateDraft('cellSize', String(Number(estimate.cell.toFixed(1))));
    setPitchHint(`${summary}。已套用到方格边长。`);
  };

  const renderNumberField = (key: keyof NumericDrafts, label: string, min: number | undefined, max: number | undefined, stepValue: number) => (
    <label className="min-w-0 space-y-1">
      <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300">{label}</span>
      <input
        aria-label={label}
        type="number"
        min={min}
        max={max}
        step={stepValue}
        value={drafts?.[key] ?? ''}
        onChange={event => updateDraft(key, event.target.value)}
        onBlur={() => commitDraft(key)}
        onKeyDown={event => { if (event.key === 'Enter') { event.currentTarget.blur(); } }}
        className="min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-purple-500 focus:ring-2 focus:ring-purple-200 dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:focus:ring-purple-900"
      />
    </label>
  );

  const renderRegionNumberField = (key: keyof RegionDrafts, label: string, max: number) => <label className="ir-label">{label}<input type="number" aria-label={label} min={0} max={max} step={.1} value={regionDrafts?.[key] ?? ''} onChange={event => setRegionDrafts(current => current ? { ...current, [key]: event.target.value } : current)} onBlur={() => commitRegionDraft(key)} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} /></label>;

  const currentInset = recognition?.edgeInsetRatio ?? edgeInsetRatio;
  const swatchRgb = selectedEffective?.color?.rgb;
  const swatchInk = swatchRgb && swatchRgb[0] * .299 + swatchRgb[1] * .587 + swatchRgb[2] * .114 < 150 ? '#ffffff' : '#271d32';

  return <div ref={dialogRef} className="ir-workbench" role="dialog" aria-modal="true" aria-labelledby="import-blueprint-title" onKeyDown={(event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); closeWizard(); return; }
    if (event.key !== 'Tab') return;
    const focusable = (Array.from(event.currentTarget.querySelectorAll('button:not(:disabled), input:not(:disabled):not([hidden]), select:not(:disabled), summary, canvas[tabindex="0"]')) as HTMLElement[])
      .filter(element => element.getClientRects().length > 0);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }}>
    <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" aria-label="选择图纸图片" hidden onChange={event => { loadFile(event.target.files?.[0]); event.currentTarget.value = ''; }} />
    <header className="ir-header">
      <div className="ir-heading"><span className="ir-mark"><ScanSearch size={21} /></span><div><h1 id="import-blueprint-title">网格颜色识别</h1><p>对齐原图，识别色号，逐格核对。</p></div></div>
      <div className="ir-header-actions">{imageUrl && <button type="button" className="ir-button" onClick={() => fileInputRef.current?.click()}><ImagePlus size={15} />更换图片</button>}<button type="button" className="ir-icon-button" onClick={closeWizard} aria-label="关闭颜色识别" title="关闭"><X size={18} /></button></div>
    </header>
    <nav className="ir-steps" aria-label="颜色识别步骤">
      {(['upload', 'calibrate', 'recognize'] as WizardStep[]).map((item, index) => {
        const complete = Boolean((item === 'upload' && imageUrl) || (item === 'calibrate' && snapshot));
        return <div key={item} className="ir-step" data-active={step === item} data-complete={complete} aria-current={step === item ? 'step' : undefined}><b>{complete ? <Check size={12} /> : `0${index + 1}`}</b>{['导入图片', '校准网格', '识别与复核'][index]}</div>;
      })}<span className="ir-local-tag">本地处理 · 独立工作台</span>
    </nav>
    <main className="ir-main">
      {step === 'upload' ? <section className="ir-upload">
        <div className="ir-upload-main">
        <span className="ir-eyebrow">COLOR RECOGNITION</span><h2>从一张图纸，<br />还原每一格的颜色。</h2><p>选择已有的网格图纸，对齐实际行列，识别本地色板中的颜色代码，再用原图逐格核对。</p>
        <div className="ir-upload-drop" data-dragging={isDraggingFile} onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setIsDraggingFile(true); }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsDraggingFile(false); }} onDrop={event => { event.preventDefault(); setIsDraggingFile(false); loadFile(event.dataTransfer.files[0]); }}>
          <ImagePlus size={35} strokeWidth={1.4} /><h3>拖入图纸，或从本地选择</h3><p>PNG / JPG / WebP · 最大 15 MB</p><button type="button" className="ir-button ir-primary" onClick={() => fileInputRef.current?.click()}><Upload size={16} />选择本地图片</button>
        </div><p className="ir-upload-note"><Lock size={16} className="shrink-0" />图片只在本次浏览器会话内处理。识别结果可复核、修正，并复制为颜色代码矩阵。</p>
        {status && <p role={status.tone === 'error' ? 'alert' : 'status'} className="ir-status" data-tone={status.tone}>{status.message}</p>}
        </div>
        <aside className="ir-upload-aside" aria-label="识别流程与素材要求">
          <div className="ir-fact-card">
            <h3>三步完成</h3>
            <ol className="ir-flow">
              <li><b>1</b><span><strong>导入图纸</strong>支持 PNG / JPG / WebP，最大 15 MB</span></li>
              <li><b>2</b><span><strong>校准网格</strong>拖动红点对齐位置、蓝点调整格距</span></li>
              <li><b>3</b><span><strong>识别与复核</strong>自动标出可疑格，可逐格手改</span></li>
            </ol>
          </div>
          <div className="ir-fact-card">
            <h3>识别会自动处理这些情况</h3>
            <ul className="ir-facts">
              <li>格线、抗锯齿、混色：按面积加权，先按色号分组再比主色</li>
              <li>成品照片：中心孔洞与反光会按亮度裁掉，整片偏暗按画面白点归一</li>
              <li>整体偏色、网格偏移：需要手动勾选，且只在能被验证时才生效</li>
            </ul>
          </div>
          <div className="ir-fact-card">
            <h3>隐私</h3>
            <ul className="ir-facts">
              <li>图片只在本次浏览器会话内处理，不上传服务器</li>
              <li>识别结果可复核、修正，并复制为颜色代码矩阵</li>
            </ul>
          </div>
        </aside>
      </section> : imageDimensions && alignment && region && imageUrl && <div className="ir-layout">
        <section className="ir-stage" aria-label="图纸预览">
          <header className="ir-stage-header"><div className="ir-file-info"><strong title={imageName}>{imageName}</strong><small>{imageDimensions.width} × {imageDimensions.height} px · {gridSummary}</small></div><span className="ir-badge">{step === 'calibrate' ? '网格校准' : paletteLabel}</span></header>
          {step === 'recognize' && effectiveRecognition && imageElement ? <>
            {currentInset > 0 && <div className="ir-result-note">每格各边忽略 {Math.round(currentInset * 100)}% · 原始占比仅统计内部有效区域</div>}
            <ImportRecognitionCanvas image={imageElement} result={effectiveRecognition} selected={selectedCell} pending={pendingKeys} onlyReview={onlyReview} onSelect={setSelectedCell} />
          </> : imageElement && <ImportGridAlignmentCanvas image={imageElement} alignment={alignment} region={region} onAlignmentChange={setAlignmentValue} onRegionChange={setRegionValue} readOnly={step !== 'calibrate'} />}

        </section>
        <aside className="ir-sidebar" aria-label={step === 'calibrate' ? '校准设置' : '识别与复核设置'}>
          {step === 'calibrate' && <section className="ir-section ir-calibration-panel"><div className="ir-section-title"><span className="ir-step-kicker">第 1 步 · 校准</span><span className="ir-badge">约 10 秒</span></div><h2 className="ir-panel-title">让网格贴合图纸方格</h2><p className="ir-help">先对齐位置和格子大小，再框选需要识别的区域。预览会实时显示识别到的行列数。</p><div className="ir-legend-row"><span><i className="ir-dot ir-dot-red" />拖红点：移动网格</span><span><i className="ir-dot ir-dot-blue" />拖蓝点：调整格距</span></div><p className="ir-help ir-wheel-note">滚轮缩放预览 · 网格最小 5 px</p></section>}
          <section className="ir-section ir-palette-panel"><div className="ir-section-title"><h2>本次识别色板</h2><span className="ir-badge">{localPalette.filter(color => color.enabled !== false).length} 色</span></div><label className="ir-label">品牌 / 色卡<select aria-label="本次识别色板品牌" value={paletteChoice} onChange={event => changePalette(event.target.value as PaletteChoice)}><option value="ACTIVE">{passedPaletteLabel}</option>{BUILT_IN_BRANDS.map(brand => <option key={brand} value={brand}>{BRAND_NAMES[brand]}</option>)}</select></label><p className="ir-help">仅作用于本次识别。切换色板后需重新识别。</p></section>
          {step === 'calibrate' ? <section className="ir-section">
            <div className="ir-section-title"><h2>网格微调</h2><span className="ir-badge">正方形 · 原图像素</span></div>
            <p className="ir-help">需要更精确时，可在下方输入格距或锚点坐标；通常直接拖动画布上的彩色控制点即可。</p>
            <div className="ir-calibration-readout"><span>当前方格边长</span><strong>{Number(alignment.cellSize.toFixed(1))}<small> px</small></strong><span className="ir-calibration-min">最小 5 px</span></div>
            <details className="ir-details"><summary>精细调整</summary><div className="ir-compact-grid ir-pitch-field">{renderNumberField('cellSize', '方格边长 px', 5, 512, .1)}</div><label className="ir-inset">键盘微调步长<select aria-label="微调步长" value={adjustmentStep} onChange={event => setAdjustmentStep(Number(event.target.value))}><option value={.1}>0.1 像素</option><option value={1}>1 像素</option><option value={10}>10 像素</option></select></label><div className="ir-adjust-row" role="group" aria-label="平移网格微调"><button type="button" className="ir-icon-button" aria-label="网格左移" onClick={() => nudgeGrid(-1, 0)}><ArrowLeft size={16} /></button><button type="button" className="ir-icon-button" aria-label="网格上移" onClick={() => nudgeGrid(0, -1)}><ArrowUp size={16} /></button><button type="button" className="ir-icon-button" aria-label="网格下移" onClick={() => nudgeGrid(0, 1)}><ArrowDown size={16} /></button><button type="button" className="ir-icon-button" aria-label="网格右移" onClick={() => nudgeGrid(1, 0)}><ArrowRight size={16} /></button></div></details>
            <details className="ir-details"><summary>精确调整网格锚点</summary><div className="ir-compact-grid">{renderNumberField('originX', '锚点 X px', undefined, undefined, .1)}{renderNumberField('originY', '锚点 Y px', undefined, undefined, .1)}</div><p className="ir-help">锚点可超出图片边界，所有坐标均为原图像素。</p></details>
            <button type="button" className="ir-text-button" onClick={applyEstimatedPitch}>按豆距自动估算格数</button>
            {pitchHint && <p className="ir-help" role="status">{pitchHint}</p>}
            <button type="button" className="ir-text-button" onClick={resetCalibration}>重置为 5 px 网格</button>
            <details className="ir-details"><summary>精确调整识别区域</summary><div className="ir-compact-grid">{renderRegionNumberField('x', '识别区域 X px', imageDimensions.width)}{renderRegionNumberField('y', '识别区域 Y px', imageDimensions.height)}{renderRegionNumberField('width', '识别区域宽度 px', imageDimensions.width)}{renderRegionNumberField('height', '识别区域高度 px', imageDimensions.height)}</div><p className="ir-help">矩形范围独立于网格相位，超出图片的部分会裁去。</p></details>
            <div className="ir-coverage" aria-live="polite" aria-atomic="true"><div className="ir-section-title"><h3>识别区域内完整格</h3><span className="ir-review-count">{calibration ? `${calibration.columns * calibration.rows} 格` : '0 格'}</span></div><div className="ir-stats"><div><strong>{calibration?.columns ?? '—'}</strong><span>实际列数</span></div><div><strong>{calibration?.rows ?? '—'}</strong><span>实际行数</span></div></div><p className="ir-help">橙框 {Number((derived?.region.width ?? 0).toFixed(2))} × {Number((derived?.region.height ?? 0).toFixed(2))} px · 绿色区域为实际识别范围。仅纳入完整方格，边缘不足一格的像素不参与识别。</p>{derived?.error && <p className="ir-status" data-tone="error" role="alert">{derived.error}</p>}</div>
            <p className="ir-help">聚焦画布后，方向键移动 1 px，Shift + 方向键移动 10 px，Alt + 方向键微调 0.1 px。最小格距为原图 5 px。</p>
          </section> : <>
            <section className="ir-section"><div className="ir-section-title"><h2>识别设置</h2><span className="ir-review-count">{snapshot?.calibration.columns} 列 × {snapshot?.calibration.rows} 行</span></div>
              <div className="ir-mode-buttons" role="group" aria-label="识别模式">{(['fast', 'precision'] as const).map(mode => <button type="button" key={mode} aria-pressed={recognitionMode === mode} onClick={() => { if (mode !== recognitionMode) { invalidateRecognition(); setRecognitionMode(mode); setStatus({ tone: 'neutral', message: '识别模式已更新，请重新识别。' }); } }}><strong>{mode === 'fast' ? '快速识别' : '高精度识别'}</strong><small>{mode === 'fast' ? '均匀采样 · 估算占比' : '像素面积 · 主色占比'}</small></button>)}</div>
              <label className="ir-inset">忽略边线<select aria-label="忽略边线" value={edgeInsetRatio} onChange={event => { invalidateRecognition(); setEdgeInsetRatio(Number(event.target.value)); setStatus({ tone: 'neutral', message: '忽略边线设置已更新，请重新识别。' }); }}><option value={0}>关闭 · 整格</option><option value={.05}>每边 5%</option><option value={.1}>每边 10%</option><option value={.15}>每边 15%</option></select></label>
              <p className="ir-help">按有效像素面积选择占比最高的色板颜色。忽略边线时仅统计每格内部区域；透明像素不参与占比。</p>
              <div className="ir-autocorrect-toggles">
                <label className="ir-check"><input type="checkbox" checked={beadPhoto} onChange={event => { invalidateRecognition(); setBeadPhoto(event.target.checked); }} />实物照片模式（拍下来的成品豆板）</label>
                <label className="ir-check"><input type="checkbox" checked={autoColorBalance} onChange={event => { invalidateRecognition(); setAutoColorBalance(event.target.checked); }} />校正整体色偏（需要画面里有白色或灰白区域）</label>
                <label className="ir-check"><input type="checkbox" checked={autoAlign} onChange={event => { invalidateRecognition(); setAutoAlign(event.target.checked); }} />对齐整体偏移（整张图都框歪了再用）</label>
                <label className="ir-check"><input type="checkbox" checked={smoothNoise} onChange={event => { invalidateRecognition(); setSmoothNoise(event.target.checked); }} />去除杂色（糊掉的孤立格按周围多数修正）</label>
              </div>
              <p className="ir-help">三项默认关闭。网格对准、素材是数字原图时不需要打开；对着成品拍照时先勾「实物照片模式」，它会把孔洞与反光排除、并按画面白点归一曝光。</p>
              {recognition && describeAutoCorrection(recognition) && (
                <p className="ir-help ir-autocorrect" role="status">
                  <strong>本次自动校正：</strong>{describeAutoCorrection(recognition)}
                  <span>（抽样 {recognition.autoCorrection?.sampledCells ?? 0} 格估计；关闭校正可在识别设置里取消勾选）</span>
                </p>
              )}
            </section>
            {recognition && effectiveRecognition && <>
              <section className="ir-section"><div className="ir-section-title"><h2>当前结果</h2><span className="ir-badge">人工修正 {manualCount} 格</span></div><div className="ir-stats" aria-label="当前结果统计"><div><strong>{effectiveRecognition.summary.mapped}</strong><span>总用豆数</span></div><div><strong>{effectiveRecognition.summary.blank}</strong><span>空白格</span></div><div><strong>{effectiveRecognition.summary.distinctColors}</strong><span>颜色数</span></div></div>{effectiveRecognition.summary.invalid > 0 && <p className="ir-status" data-tone="error">{effectiveRecognition.summary.invalid} 格无有效识别，请复核。</p>}
                <details className="ir-details"><summary>原始自动识别测量</summary><p className="ir-summary-line">平均主色占比 {recognition.summary.meanConfidence === null ? '—' : `${(recognition.summary.meanConfidence * 100).toFixed(1)}%`} · 平均色差 ΔE {recognition.summary.meanDistance?.toFixed(1) ?? '—'}</p><p className="ir-help">占比不代表准确率。此处保留原始测量，不以人工修正后的数据计算质量。</p></details>
              </section>
              <section className="ir-section ir-background-panel" aria-labelledby="ir-background-title">
                <div className="ir-section-title"><h2 id="ir-background-title">一键去背景</h2><span className="ir-badge">已移除 {removedBackgroundCount} 格</span></div>
                <label className="ir-label">候选背景色<select aria-label="候选背景色" value={backgroundColorId} onChange={event => { setBackgroundColorId(event.target.value); setBackgroundStatus(null); }}>
                  <option value="">跟随选中格 / 边缘多数色{!backgroundColorId && candidateBackground ? ` · ${candidateBackground.code}` : ''}</option>
                  {localPalette.filter(color => color.enabled !== false && (colorCounts.some(item => item.id === color.id) || color.id === backgroundColorId)).map(color => <option key={color.id} value={color.id}>{color.code} · {color.name}</option>)}
                </select></label>
                <p className="ir-help" id="ir-background-help">仅移除候选单色经上下左右与四周连通的区域；已有空白可连通，封闭区域与其他颜色保留。原图保留，可继续逐格手改。</p>
                <p className="ir-background-preview" role="status">{!candidateBackgroundId ? '未找到明确背景候选，请选中背景格或指定色号。' : backgroundCells.length ? `${candidateBackground?.code ?? '候选色'} · 预计移除 ${backgroundCells.length} 格` : '当前候选色没有与四周连通的有色格，无需移除。'}</p>
                <div className="ir-background-actions">
                  <button type="button" className="ir-button ir-primary" aria-describedby="ir-background-help" disabled={!backgroundCells.length} onClick={removeBackground}><Eraser size={15} />一键去背景</button>
                  <button type="button" className="ir-button" disabled={!backgroundHistory.length} onClick={undoBackground}><Undo2 size={15} />撤销去背景</button>
                </div>
                {backgroundStatus && <p className="ir-status" role="status">{backgroundStatus}</p>}
              </section>
              <section className="ir-section"><div className="ir-section-title"><h2>逐格复核</h2><span className="ir-review-count">待复核 {pendingCells.length} / {initialReviewCount}</span></div>
                <label className="ir-check"><input type="checkbox" checked={onlyReview} onChange={event => { setOnlyReview(event.target.checked); if (event.target.checked && pendingCells.length && (!selectedKey || !pendingKeys.has(selectedKey))) setSelectedCell(pendingCells[0]); }} />仅看待复核格</label>
                <div className="ir-pending-nav"><button type="button" className="ir-button" disabled={!pendingCells.length} onClick={() => movePending(-1)}><ChevronLeft size={14} />上一个待复核</button><button type="button" className="ir-button" disabled={!pendingCells.length} onClick={() => movePending(1)}>下一个待复核<ChevronRight size={14} /></button></div>
                <p className="ir-help">主色占比 &lt;60%、领先次色 &lt;10 个百分点、色差 ΔE &gt;15 或无效的格子列为待复核。人工指定后移出待复核。</p>
                {selectedCell && selectedResult && selectedEffective && imageElement && <>
                  <div className="ir-position"><label>行<input type="number" aria-label="选中格行号" min={1} max={recognition.calibration.rows} value={selectedCell.row + 1} onChange={event => { const value = event.currentTarget.valueAsNumber; if (Number.isFinite(value)) setSelectedCell({ ...selectedCell, row: Math.max(0, Math.min(recognition.calibration.rows - 1, Math.round(value) - 1)) }); }} /></label><label>列<input type="number" aria-label="选中格列号" min={1} max={recognition.calibration.columns} value={selectedCell.column + 1} onChange={event => { const value = event.currentTarget.valueAsNumber; if (Number.isFinite(value)) setSelectedCell({ ...selectedCell, column: Math.max(0, Math.min(recognition.calibration.columns - 1, Math.round(value) - 1)) }); }} /></label></div>
                  <div className="ir-cell-comparison"><figure><ImportSourceCellCrop image={imageElement} calibration={recognition.calibration} selected={selectedCell} edgeInsetRatio={currentInset} /><figcaption>原图单格 · 真实像素放大</figcaption></figure><figure><div className="ir-cell-swatch" style={{ background: selectedEffective.color?.hex ?? 'var(--ir-soft)', color: selectedEffective.color ? swatchInk : 'var(--ir-muted)' }}><strong>{selectedEffective.color?.code ?? (selectedEffective.status === 'blank' ? '空白' : '无效')}</strong><span>{selectedEffective.color?.name ?? '未指定颜色'}</span></div><figcaption>{selectedIsBackground ? '背景已移除 · 当前结果' : selectedIsManual ? '人工指定 · 当前结果' : '自动识别 · 当前结果'}</figcaption></figure></div>
                  <div className="ir-cell-measurements"><strong>原始测量 · {selectedResult.color?.code ?? (selectedResult.status === 'blank' ? '空白' : '无效')}</strong><br />{recognition.mode === 'fast' ? '估算主色占比' : '主色占比'} {selectedResult.dominantRatio === null ? '—' : `${(selectedResult.dominantRatio * 100).toFixed(1)}%`} · 次色 {selectedResult.runnerUpRatio === null ? '—' : `${(selectedResult.runnerUpRatio * 100).toFixed(1)}%`}<br />色差 ΔE {selectedResult.distance?.toFixed(1) ?? '—'} · 有效覆盖 {selectedResult.sampledArea > 0 ? `${(selectedResult.coverage / selectedResult.sampledArea * 100).toFixed(1)}%` : '—'}{currentInset > 0 && <><br />以上占比仅针对忽略边线后的内部区域。</>}</div>
                  {selectedIsManual && !selectedIsBackground && <p className="ir-manual-note">本格已人工{selectedEffective.color ? `指定为 ${selectedEffective.color.code}` : '标为空白'}；人工色号没有实测面积占比。</p>}
                  <div className="ir-correction"><label className="ir-label" htmlFor="ir-color-search">人工指定色号</label><input id="ir-color-search" className="ir-correction-search" type="search" aria-label="搜索修正色号或颜色名称" placeholder="搜索色号、名称或 HEX" value={colorSearch} onChange={event => setColorSearch(event.target.value)} /><select aria-label="人工修正颜色代码" value="" onChange={event => { if (event.target.value) correctSelected(event.target.value); }}><option value="">{filteredPalette.length ? `选择颜色 · ${filteredPalette.length} 个可选` : '没有匹配的色号'}</option>{filteredPalette.map(color => <option key={color.id} value={color.id}>{color.code} · {color.name} · {color.hex}</option>)}</select><div className="ir-correction-buttons"><button type="button" className="ir-text-button" onClick={() => correctSelected(null)}>标为空白</button><button type="button" className="ir-text-button" disabled={!selectedIsManual && !selectedIsBackground} onClick={resetSelectedCorrection}>恢复本格自动结果</button></div></div>
                </>}
              </section>
              <section className="ir-section"><div className="ir-section-title"><h2>最终色号统计</h2><span className="ir-review-count">{effectiveRecognition.summary.total} 格</span></div><p className="ir-help">统计与复制矩阵均包含当前人工修正和背景移除。</p><div className="ir-counts">{colorCounts.map(item => <div className="ir-count-row" key={item.code}><i style={{ background: item.hex }} /><strong>{item.code}</strong><span>{item.name}</span><b>{item.count}</b></div>)}</div><button type="button" className="ir-button ir-full" style={{ marginTop: 12 }} onClick={copyCodeMatrix}><Clipboard size={14} />复制颜色代码矩阵</button><button type="button" className="ir-text-button" disabled={!manualCount && !removedBackgroundCount} onClick={restoreAutomaticResult}>恢复全部自动结果（手改 {manualCount} 格 / 去背景 {removedBackgroundCount} 格）</button></section>
            </>}
          </>}
          {effectiveRecognition && <section className="ir-section">
            <div className="ir-section-title"><h2>确认与保存</h2><span className="ir-badge">{currentConfirmation ? '已确认当前版本' : '待确认'}</span></div>
            <label className="ir-label">作品名称<input aria-label="识别作品名称" maxLength={60} value={resultTitle} onChange={event => { invalidateConfirmation(); setResultTitle(event.target.value); setStatus({ tone: 'neutral', message: '作品名称已修改，请重新确认当前结果。' }); }} placeholder="输入作品名称" /></label>
            <p className="ir-help">确认后保存的是当前色号、人工修正和背景移除结果。修改结果或名称后，需要重新确认；保存不会替换当前画板。</p>
            {!canSave && <p className="ir-help">图库保存需要登录。登录不会清空本次识别结果。</p>}
          </section>}
          {status && <p role={status.tone === 'error' ? 'alert' : 'status'} className="ir-status" data-tone={status.tone}>{status.message}</p>}
          <div className="ir-actions">{step === 'calibrate' ? <button type="button" className="ir-button ir-primary" disabled={!calibration} onClick={nextStep}>确认网格，进入识别<ChevronRight size={16} /></button> : <>
            {isRecognizing && <div className="ir-progress" role="status"><div className="ir-progress-label"><span>逐格统计颜色面积</span><span>{recognitionProgress}%</span></div><div className="ir-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={recognitionProgress} aria-label="图纸颜色识别进度"><div className="ir-progress-fill" style={{ width: `${recognitionProgress}%` }} /></div></div>}
            {effectiveRecognition && !isRecognizing && <>
              {!currentConfirmation && <button type="button" className="ir-button ir-primary" onClick={confirmResult} disabled={isSavingRecognition}>确认识别结果<Check size={15} /></button>}
              <div className="ir-final-actions">
                <button type="button" className="ir-button ir-primary" disabled={!currentConfirmation || isSavingRecognition || savedDraftId === currentConfirmation.id} onClick={saveConfirmedResult}><Save size={15} />{isSavingRecognition ? '保存中…' : savedDraftId && savedDraftId === currentConfirmation?.id ? '已保存' : '保存到图库'}</button>
                <button type="button" className="ir-button" disabled={!currentConfirmation || isSavingRecognition} onClick={editConfirmedResult}><Pencil size={15} />进入编辑</button>
              </div>
            </>}
            <button type="button" className={`ir-button ${!effectiveRecognition && !isRecognizing ? 'ir-primary' : 'ir-quiet'}`} disabled={isSavingRecognition || !localPalette.some(color => color.enabled !== false)} onClick={isRecognizing ? () => { cancelRecognition(); setStatus({ tone: 'neutral', message: '识别已取消，可以重新开始。' }); } : runRecognition}>{isRecognizing ? <><X size={15} />取消识别</> : <><ScanSearch size={16} />{recognition ? '重新识别' : '开始识别'}</>}</button><button type="button" className="ir-button ir-quiet" onClick={backToEdit}><ChevronLeft size={15} />返回修改网格</button>
          </>}</div>
        </aside>
      </div>}
    </main>
  </div>;
}
