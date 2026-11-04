import React, { useState, useRef, useEffect } from 'react';
import {
  X,
  Sparkles,
  Pipette,
  Scissors,
  Wand2,
  RefreshCw,
  Eye,
  Sliders,
  Check,
  Zap,
  RotateCw,
  FlipHorizontal,
  Crop,
} from 'lucide-react';
import { BeadColor, ConvertSettings, DitherMode } from '../types';
import { useLanguage } from '../context/LanguageContext';
import { imageToGridWithDiagnostics } from '../utils/colorUtils';
import type { ConversionDiagnostics } from '../utils/imagePipeline';
import { suggestSubjectBounds, type SubjectBoundsRect } from '../utils/subjectBounds';
import {
  IMAGE_STUDIO_PREVIEW_DEBOUNCE_MS,
  buildTransformedImageCanvas,
  clampImageStudioControl,
  isImageStudioOperationCurrent,
  nextImageStudioOperationToken,
  resetImageStudioBackgroundSettings,
  stepImageStudioControl,
  transformedImageDimensions,
} from '../utils/imageStudioControls';

interface ImageStudioModalProps {
  isOpen: boolean;
  onClose: () => void;
  sourceImage: HTMLImageElement | null;
  settings: ConvertSettings;
  setSettings: React.Dispatch<React.SetStateAction<ConvertSettings>>;
  activePalette: BeadColor[];
  originalSource?: { image: HTMLImageElement; savedPercent: number } | null;
  onApplyConversion: (newGrid: (string | null)[][], updatedImage?: HTMLImageElement, diagnostics?: ConversionDiagnostics,
    subjectCrop?: { originalImage: HTMLImageElement; savedPercent: number } | null) => void;
}

interface PreciseRangeControlProps {
  label: string;
  value: number;
  min: number;
  max: number;
  suffix?: string;
  onValueChange: (value: number) => void;
}

interface SubjectCropPreview {
  previewUrl: string;
  image: HTMLImageElement;
  fullImage: HTMLImageElement;
  bounds: SubjectBoundsRect;
  sourceWidth: number;
  sourceHeight: number;
  savedPercent: number;
  mayExcludeDecorations: boolean;
}

const PreciseRangeControl: React.FC<PreciseRangeControlProps> = ({
  label,
  value,
  min,
  max,
  suffix = '',
  onValueChange,
}) => (
  <div className="space-y-1.5">
    <div className="flex justify-between text-[11px]">
      <span className="text-slate-600">{label}</span>
      <span className="font-mono font-semibold text-slate-900 tabular-nums">{value}{suffix}</span>
    </div>
    <div className="grid grid-cols-[28px_minmax(0,1fr)_28px_56px] gap-1.5 items-center">
      <button type="button" onClick={() => onValueChange(stepImageStudioControl(value, -1, min, max))} className="h-7 rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-100">-</button>
      <input type="range" min={min} max={max} step={1} value={value} onChange={e => onValueChange(clampImageStudioControl(Number(e.target.value), min, max))} className="w-full accent-teal-600 cursor-pointer" />
      <button type="button" onClick={() => onValueChange(stepImageStudioControl(value, 1, min, max))} className="h-7 rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-100">+</button>
      <input type="number" min={min} max={max} step={1} value={value} onChange={e => onValueChange(clampImageStudioControl(Number(e.target.value), min, max))} className="h-7 w-full rounded border border-slate-300 bg-white px-1 text-right font-mono text-slate-900 outline-none focus:border-teal-500" />
    </div>
  </div>
);

export const ImageStudioModal: React.FC<ImageStudioModalProps> = ({
  isOpen,
  onClose,
  sourceImage,
  settings,
  setSettings,
  activePalette,
  originalSource = null,
  onApplyConversion,
}) => {
  const { language } = useLanguage();
  const isEn = language === 'en';
  const [localSettings, setLocalSettings] = useState<ConvertSettings>(settings);
  const [previewSettings, setPreviewSettings] = useState<ConvertSettings>(settings);
  const [rotation, setRotation] = useState<number>(0); // 0, 90, 180, 270
  const [flipH, setFlipH] = useState<boolean>(false);
  const [isPickingColor, setIsPickingColor] = useState<boolean>(false);
  const [pickedChromaColor, setPickedChromaColor] = useState<string | null>(
    settings.chromaKeyColor
  );

  const [currentImg, setCurrentImg] = useState<HTMLImageElement | null>(sourceImage);
  const [originalImg, setOriginalImg] = useState<HTMLImageElement | null>(null);
  const [cropSavedPercent, setCropSavedPercent] = useState<number | null>(null);
  const [subjectCropPreview, setSubjectCropPreview] = useState<SubjectCropPreview | null>(null);
  const [cropMessage, setCropMessage] = useState<string | null>(null);
  const [subjectCropApplied, setSubjectCropApplied] = useState(false);

  const [previewGrid, setPreviewGrid] = useState<(string | null)[][]>([]);
  const [conversionDiagnostics, setConversionDiagnostics] = useState<ConversionDiagnostics | null>(null);
  const [isCalculating, setIsCalculating] = useState<boolean>(false);
  const [isCropAnalyzing, setIsCropAnalyzing] = useState(false);
  const [activeMobileTab, setActiveMobileTab] = useState<'preview' | 'settings'>('preview');
  const [activePreviewPane, setActivePreviewPane] = useState<'source' | 'pattern'>('source');
  const imageCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const sessionTokenRef = useRef(0);
  const previewTokenRef = useRef(0);
  const cropOperationTokenRef = useRef(0);
  const cropPendingRef = useRef(false);
  const applyPendingRef = useRef(false);
  const originalTransformRef = useRef<{ rotation: number; flipH: boolean; aspectRatio: number; height: number } | null>(null);

  const invalidateSession = () => {
    sessionTokenRef.current += 1;
    previewTokenRef.current += 1;
    cropOperationTokenRef.current = nextImageStudioOperationToken(cropOperationTokenRef.current);
    cropPendingRef.current = false;
    applyPendingRef.current = false;
    return sessionTokenRef.current;
  };

  const handleClose = () => {
    invalidateSession();
    onClose();
  };

  const createImageFromDataUrl = (source: string): Promise<HTMLImageElement | null> => {
    try {
      const image = new Image();
      return new Promise((resolve) => {
        image.onload = () => resolve(image);
        image.onerror = () => resolve(null);
        image.src = source;
      });
    } catch {
      return Promise.resolve(null);
    }
  };

  const createAppliedImage = (canvas: HTMLCanvasElement): Promise<HTMLImageElement | null> => {
    try { return createImageFromDataUrl(canvas.toDataURL('image/png')); }
    catch { return Promise.resolve(null); }
  };

  // Palette map lookup
  const paletteMap = React.useMemo(() => {
    return new Map((activePalette || []).map(c => [c.id, c]));
  }, [activePalette]);

  // Sync state when modal opens
  useEffect(() => {
    if (isOpen) {
      invalidateSession();
      const safeSettings = resetImageStudioBackgroundSettings(settings);
      setLocalSettings(safeSettings);
      setPreviewSettings(safeSettings);
      setPickedChromaColor(null);
      setCurrentImg(sourceImage);
      setRotation(0);
      setFlipH(false);
      setIsCalculating(false);
      setIsCropAnalyzing(false);
      setOriginalImg(originalSource?.image ?? null);
      const originalWidth = originalSource?.image.naturalWidth || originalSource?.image.width || 0;
      const originalHeight = originalSource?.image.naturalHeight || originalSource?.image.height || 0;
      originalTransformRef.current = originalSource && originalWidth > 0
        ? { rotation: 0, flipH: false, aspectRatio: originalHeight / originalWidth, height: safeSettings.height }
        : null;
      setCropSavedPercent(originalSource?.savedPercent ?? null);
      setSubjectCropApplied(Boolean(originalSource));
      setSubjectCropPreview(null);
      setCropMessage(null);
      setConversionDiagnostics(null);
    } else {
      invalidateSession();
    }
    return () => {
      invalidateSession();
    };
  }, [isOpen, settings, sourceImage, originalSource]);

  useEffect(() => {
    if (!isOpen) return;
    const timer = window.setTimeout(() => setPreviewSettings(localSettings), IMAGE_STUDIO_PREVIEW_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [isOpen, localSettings]);

  // Render preview grid to canvas with exact 1:1 aspect ratio
  useEffect(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas || previewGrid.length === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rows = previewGrid.length;
    const cols = previewGrid[0]?.length || 0;
    if (cols === 0 || rows === 0) return;

    const cellSize = Math.max(3, Math.min(10, Math.floor(600 / Math.max(cols, rows))));
    canvas.width = cols * cellSize;
    canvas.height = rows * cellSize;

    ctx.fillStyle = '#F8FAFC';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const cellId = previewGrid[y][x];
        const px = x * cellSize;
        const py = y * cellSize;

        if (cellId) {
          const bead = paletteMap.get(cellId);
          // The conversion preview is a pixel-art sheet, not a physical
          // beadboard preview: every grid cell must remain a connected square
          // block so outlines and continuous lines can be judged correctly.
          ctx.fillStyle = bead ? bead.hex : '#CCCCCC';
          ctx.fillRect(px, py, cellSize, cellSize);
          if (cellSize >= 5) {
            ctx.strokeStyle = '#0F172A33';
            ctx.lineWidth = 0.5;
            ctx.strokeRect(px + 0.25, py + 0.25, cellSize - 0.5, cellSize - 0.5);
          }
        } else {
          // Transparent checker pattern
          ctx.fillStyle = (x + y) % 2 === 0 ? '#F1F5F9' : '#E2E8F0';
          ctx.fillRect(px, py, cellSize, cellSize);
        }
      }
    }
  }, [previewGrid, paletteMap]);

  // Update transformed source image canvas
  useEffect(() => {
    const activeImage = currentImg || sourceImage;
    if (!isOpen || !activeImage) return;

    const sessionToken = sessionTokenRef.current;
    const previewToken = ++previewTokenRef.current;
    setIsCalculating(true);
    const timer = setTimeout(() => {
      if (sessionToken !== sessionTokenRef.current || previewToken !== previewTokenRef.current) return;
      const canvas = buildTransformedImageCanvas(activeImage, rotation, flipH, imageCanvasRef.current ?? undefined);
      if (!canvas) return;

      // Generate preview pixel grid using current local settings
      const result = imageToGridWithDiagnostics(canvas, previewSettings, activePalette || []);
      if (sessionToken !== sessionTokenRef.current || previewToken !== previewTokenRef.current) return;
      setPreviewGrid(result.grid);
      setConversionDiagnostics(result.diagnostics);
      setIsCalculating(false);
    }, 0);

    return () => clearTimeout(timer);
  }, [isOpen, currentImg, sourceImage, previewSettings, rotation, flipH, activePalette]);

  if (!isOpen || !sourceImage) return null;

  const dimensionsImage = currentImg || sourceImage;
  const dimensions = transformedImageDimensions(
    dimensionsImage.naturalWidth || dimensionsImage.width,
    dimensionsImage.naturalHeight || dimensionsImage.height, rotation,
  );
  const dimensionsImageWidth = dimensions?.width ?? 0;
  const dimensionsImageHeight = dimensions?.height ?? 0;

  const handleRotate = () => {
    cancelSubjectCropPreview();
    const nextRotation = (rotation + 90) % 360;
    const nextDimensions = transformedImageDimensions(
      dimensionsImage.naturalWidth || dimensionsImage.width,
      dimensionsImage.naturalHeight || dimensionsImage.height, nextRotation,
    );
    setRotation(nextRotation);
    if (nextDimensions) setLocalSettings(current => ({
      ...current,
      height: current.keepAspectRatio
        ? Math.max(10, Math.round(current.width * nextDimensions.height / nextDimensions.width))
        : current.height,
    }));
  };

  // Suggest a crop for preview only. Nothing is changed until the user accepts it.
  const handleSmartCrop = async () => {
    const activeImage = currentImg || sourceImage;
    if (!activeImage) return;

    const sessionToken = sessionTokenRef.current;
    const cropToken = nextImageStudioOperationToken(cropOperationTokenRef.current);
    cropOperationTokenRef.current = cropToken;
    cropPendingRef.current = true;
    setIsCropAnalyzing(true);
    setCropMessage(null);
    try {
      const transformed = buildTransformedImageCanvas(activeImage, rotation, flipH);
      if (!transformed) throw new Error(isEn ? 'Unable to inspect the source image.' : '无法读取原图，请检查图片后重试。');
      const bounds = suggestSubjectBounds(transformed.getContext('2d', { willReadFrequently: true })!
        .getImageData(0, 0, transformed.width, transformed.height));
      if (!isOpen || sessionToken !== sessionTokenRef.current || !isImageStudioOperationCurrent(cropToken, cropOperationTokenRef.current)) return;
      if (!bounds.hasSuggestion) {
        setCropMessage(isEn ? 'No reliable subject crop was found. The original composition is unchanged.'
          : '未找到足够可靠的主体范围，原图构图保持不变。可改用手动裁剪或保留完整构图。');
        return;
      }
      const cropCanvas = document.createElement('canvas');
      cropCanvas.width = bounds.pixelBounds.width; cropCanvas.height = bounds.pixelBounds.height;
      const context = cropCanvas.getContext('2d');
      if (!context) throw new Error(isEn ? 'Unable to prepare the crop preview.' : '无法生成裁剪预览。');
      context.drawImage(transformed, bounds.pixelBounds.x, bounds.pixelBounds.y, bounds.pixelBounds.width, bounds.pixelBounds.height,
        0, 0, bounds.pixelBounds.width, bounds.pixelBounds.height);
      const previewUrl = cropCanvas.toDataURL('image/png');
      const image = await createImageFromDataUrl(previewUrl);
      if (!image) throw new Error(isEn ? 'Unable to decode the crop preview.' : '裁剪预览解码失败，请重试。');
      const fullImage = await createAppliedImage(transformed);
      if (!fullImage) throw new Error(isEn ? 'Unable to preserve the complete image.' : '无法保留完整原图，请重试。');
      if (!isOpen || sessionToken !== sessionTokenRef.current || !isImageStudioOperationCurrent(cropToken, cropOperationTokenRef.current)) return;
      setSubjectCropPreview({ previewUrl, image, fullImage, bounds: bounds.pixelBounds, sourceWidth: transformed.width,
        sourceHeight: transformed.height, savedPercent: Math.round((1 - bounds.coverage) * 100),
        mayExcludeDecorations: bounds.mayExcludeDecorations });
    } catch {
      if (isOpen && sessionToken === sessionTokenRef.current && isImageStudioOperationCurrent(cropToken, cropOperationTokenRef.current))
        setCropMessage(isEn ? 'The crop preview could not be created. The original image is unchanged.' : '裁剪预览生成失败，原图没有改变，请重试。');
    } finally {
      if (isOpen && sessionToken === sessionTokenRef.current && isImageStudioOperationCurrent(cropToken, cropOperationTokenRef.current)) {
        cropPendingRef.current = false;
        setIsCropAnalyzing(false);
      }
    }
  };

  const cancelSubjectCropPreview = () => {
    cropOperationTokenRef.current = nextImageStudioOperationToken(cropOperationTokenRef.current);
    cropPendingRef.current = false;
    setSubjectCropPreview(null);
    setIsCropAnalyzing(false);
  };

  const acceptSubjectCrop = () => {
    if (!subjectCropPreview || cropPendingRef.current) return;
    const activeImage = currentImg || sourceImage;
    if (!activeImage) return;
    if (!originalImg) {
      setOriginalImg(subjectCropPreview.fullImage);
      originalTransformRef.current = { rotation: 0, flipH: false,
        aspectRatio: subjectCropPreview.sourceHeight / subjectCropPreview.sourceWidth, height: localSettings.height };
    }
    setCurrentImg(subjectCropPreview.image);
    // Rotation/flip were baked into the accepted preview canvas; reset the
    // controls so the preview and final conversion use the same composition.
    setRotation(0); setFlipH(false);
    setCropSavedPercent(subjectCropPreview.savedPercent);
    setSubjectCropApplied(true);
    if (localSettings.keepAspectRatio) {
      const nextHeight = Math.max(10, Math.round(localSettings.width * subjectCropPreview.bounds.height / subjectCropPreview.bounds.width));
      setLocalSettings(current => ({ ...current, height: nextHeight }));
    }
    setSubjectCropPreview(null);
    setCropMessage(null);
  };

  const handleRestoreOriginal = () => {
    if (originalImg) {
      cropOperationTokenRef.current = nextImageStudioOperationToken(cropOperationTokenRef.current);
      cropPendingRef.current = false;
      previewTokenRef.current += 1;
      setCurrentImg(originalImg);
      if (originalTransformRef.current) {
        setRotation(originalTransformRef.current.rotation);
        setFlipH(originalTransformRef.current.flipH);
        if (localSettings.keepAspectRatio) {
          const nextHeight = Math.max(10, Math.round(localSettings.width * originalTransformRef.current.aspectRatio));
          setLocalSettings(current => ({ ...current, height: nextHeight }));
        } else {
          setLocalSettings(current => ({ ...current, height: originalTransformRef.current?.height ?? current.height }));
        }
      }
      originalTransformRef.current = null;
      setOriginalImg(null);
      setCropSavedPercent(null);
      setSubjectCropApplied(false);
      setSubjectCropPreview(null);
      setCropMessage(null);
      setIsCalculating(false);
    }
  };

  const disableBackgroundRemoval = () => {
    setPickedChromaColor(null);
    setLocalSettings(s => ({ ...s, chromaKeyColor: null, backgroundRemovalEnabled: false }));
  };

  // Clear the manual key so V2 edge-cluster inference owns automatic detection.
  const autoDetectAndRemoveBackground = () => {
    setPickedChromaColor(null);
    setLocalSettings(s => ({ ...s, chromaKeyColor: null, backgroundRemovalEnabled: true }));
  };

  // Quick remove white/light background
  const removeWhiteBackground = () => {
    setPickedChromaColor('#FFFFFF');
    setLocalSettings(s => ({
      ...s,
      chromaKeyColor: '#FFFFFF',
      chromaKeyTolerance: 20,
      backgroundRemovalEnabled: true,
    }));
  };

  // Handle clicking on image to pick Chroma Key background color
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isPickingColor) return;

    const canvas = imageCanvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const x = Math.floor((e.clientX - rect.left) * scaleX);
    const y = Math.floor((e.clientY - rect.top) * scaleY);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const pixelData = ctx.getImageData(x, y, 1, 1).data;
    const hex = `#${((1 << 24) + (pixelData[0] << 16) + (pixelData[1] << 8) + pixelData[2])
      .toString(16)
      .slice(1)
      .toUpperCase()}`;

    setPickedChromaColor(hex);
    setLocalSettings(s => ({ ...s, chromaKeyColor: hex, backgroundRemovalEnabled: true }));
    setIsPickingColor(false);
  };

  // Apply Presets
  const applyPreset = (preset: 'vivid' | 'anime' | 'photo' | 'pixel' | 'clean') => {
    if (preset === 'vivid') {
      setLocalSettings(s => ({
        ...s,
        pipelineOverride: 'auto',
        sharpening: 40,
        contrast: 10,
        saturation: 15,
        dither: 'none',
      }));
    } else if (preset === 'anime') {
      setLocalSettings(s => ({
        ...s,
        pipelineOverride: 'logo',
        sharpening: 25,
        contrast: 4,
        saturation: 10,
        dither: 'none',
      }));
    } else if (preset === 'photo') {
      setLocalSettings(s => ({
        ...s,
        pipelineOverride: 'photo',
        sharpening: 25,
        outlineBoost: false,
        contrast: 5,
        saturation: 10,
        dither: 'none',
        ditherStrength: 0.25,
      }));
    } else if (preset === 'pixel') {
      setLocalSettings(s => ({
        ...s,
        pipelineOverride: 'logo',
        sharpening: 90,
        contrast: 30,
        dither: 'none',
      }));
    } else if (preset === 'clean') {
      setLocalSettings(s => ({
        ...s,
        brightness: 0,
        contrast: 0,
        saturation: 0,
        sharpening: 0,
        chromaKeyColor: null,
        backgroundRemovalEnabled: false,
        pipelineOverride: 'auto',
        dither: 'none',
      }));
      setPickedChromaColor(null);
    }
  };

  const handleApply = async () => {
    if (subjectCropPreview || isCropAnalyzing || applyPendingRef.current) return;
    if (cropPendingRef.current) {
      cropOperationTokenRef.current = nextImageStudioOperationToken(cropOperationTokenRef.current);
      cropPendingRef.current = false;
      setIsCalculating(false);
      return;
    }
    const sessionToken = sessionTokenRef.current;
    const cropToken = cropOperationTokenRef.current;
    const activeImage = currentImg || sourceImage;
    if (!activeImage || isCalculating) return;
    const canvas = buildTransformedImageCanvas(activeImage, rotation, flipH);
    if (!canvas || sessionToken !== sessionTokenRef.current) return;
    applyPendingRef.current = true;
    try {
    const applied = imageToGridWithDiagnostics(canvas, localSettings, activePalette || []);
    if (sessionToken !== sessionTokenRef.current) return;
    setIsCalculating(true);
    const appliedImage = await createAppliedImage(canvas);
    if (!isOpen || sessionToken !== sessionTokenRef.current || !isImageStudioOperationCurrent(cropToken, cropOperationTokenRef.current)) return;
    if (!appliedImage) {
      setIsCalculating(false);
      return;
    }
    // The next image must opt in again; a prior crop/key cannot silently remove its background.
    setSettings(resetImageStudioBackgroundSettings(localSettings));
    onApplyConversion(applied.grid, appliedImage, applied.diagnostics,
      subjectCropApplied && originalImg ? { originalImage: originalImg, savedPercent: cropSavedPercent ?? 0 } : null);
    invalidateSession();
    handleClose();
    } finally {
      if (sessionToken === sessionTokenRef.current) {
        applyPendingRef.current = false;
        setIsCalculating(false);
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 backdrop-blur-sm p-0 sm:p-3 animate-fadeIn">
      <div className="bg-slate-50 border border-slate-200 w-[min(96vw,1280px)] h-[min(82vh,760px)] max-sm:w-full max-sm:h-full rounded-none sm:rounded-lg shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-3.5 sm:px-5 py-2.5 border-b border-slate-200 flex items-center justify-between bg-white shrink-0">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <div className="p-1.5 sm:p-2 rounded-lg bg-teal-600 text-white shrink-0">
              <Wand2 className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-xs sm:text-base font-bold text-slate-900 flex items-center gap-1.5 sm:gap-2 truncate">
                <span className="truncate">{isEn ? 'Image Studio & Bead Converter' : '图像增强与转拼豆'}</span>
                <span className="px-1.5 py-0.5 text-[9px] sm:text-[10px] bg-teal-50 text-teal-700 rounded border border-teal-200 shrink-0">
                  {isEn ? 'AI & Algorithm' : 'AI & 算法'}
                </span>
              </h2>
              <p className="text-[10px] sm:text-xs text-slate-500 truncate">
                {isEn ? 'Fix blur, noise, and edge distortion issues' : '修正模糊、杂色与边缘失真问题'}
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 cursor-pointer transition-colors shrink-0 ml-2"
          >
            <X className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>
        </div>

        {/* Mobile Tab Switcher (Visible on < xl screens) */}
        <div className="flex xl:hidden border-b border-slate-200 bg-white p-1 shrink-0 text-xs">
          <button
            onClick={() => setActiveMobileTab('preview')}
            className={`flex-1 py-2 font-semibold text-center flex items-center justify-center gap-1.5 border-b-2 transition-colors cursor-pointer ${
              activeMobileTab === 'preview'
                ? 'border-teal-600 text-teal-700 bg-teal-50'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            <span>{isEn ? `1. Preview (${localSettings.width}×${localSettings.height})` : `1. 效果预览 (${localSettings.width}×${localSettings.height})`}</span>
          </button>
          <button
            onClick={() => setActiveMobileTab('settings')}
            className={`flex-1 py-2 font-semibold text-center flex items-center justify-center gap-1.5 border-b-2 transition-colors cursor-pointer ${
              activeMobileTab === 'settings'
                ? 'border-teal-600 text-teal-700 bg-teal-50'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>{isEn ? '2. Settings' : '2. 参数与调色'}</span>
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 xl:grid xl:grid-cols-[minmax(0,1fr)_360px] overflow-hidden min-h-0">
          {/* Left Preview Section: Original Image + Converted Grid Side-by-Side */}
          <div
            className={`p-2.5 sm:p-3 flex-col gap-2.5 overflow-y-auto xl:overflow-hidden bg-slate-100 min-w-0 min-h-0 ${
              activeMobileTab === 'preview' ? 'flex' : 'hidden xl:flex'
            }`}
          >
            {/* Action Presets bar */}
            <div className="flex flex-wrap items-center gap-1.5 text-xs shrink-0">
              <span className="text-slate-600 font-medium shrink-0 flex items-center gap-1 whitespace-nowrap mr-1">
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                {isEn ? 'Smart Presets:' : '智能预设:'}
              </span>
              <button
                type="button"
                onClick={() => { setActivePreviewPane('source'); void handleSmartCrop(); }}
                disabled={isCalculating || Boolean(originalImg)}
                className="px-2.5 py-1.5 rounded-lg bg-teal-600 border border-teal-600 text-white font-semibold hover:bg-teal-700 disabled:opacity-50 cursor-pointer transition-colors text-[11px] sm:text-xs flex items-center gap-1.5"
                title={isEn ? 'Preview a subject-priority crop. Nothing changes until you confirm.' : '先预览主体优先裁剪；确认后才应用，不会覆盖原图'}
              >
                <Crop className="w-3.5 h-3.5" />
                <span>{isEn ? 'Subject-first preview' : '主体优先（预览）'}</span>
              </button>
              <button
                onClick={autoDetectAndRemoveBackground}
                className="px-2.5 py-1.5 rounded-lg bg-white border border-rose-300 text-rose-700 hover:bg-rose-50 cursor-pointer transition-colors font-semibold whitespace-nowrap text-[11px] sm:text-xs flex items-center gap-1"
                title={isEn ? 'Auto detect corner background colors and remove them' : '自动识别图像四个角落的背景颜色并扣除，只留主体人物/物品'}
              >
                <Scissors className="w-3 h-3 text-pink-400" />
                <span>{isEn ? 'Smart Cut BG' : '智能抠除背景'}</span>
              </button>
              <button
                onClick={removeWhiteBackground}
                className="px-2.5 py-1.5 rounded-lg bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 cursor-pointer transition-colors font-medium whitespace-nowrap text-[11px] sm:text-xs"
                title={isEn ? 'Replace white or light background with transparent' : '将纯白色/浅色背景替换为透明无豆'}
              >
                {isEn ? 'Remove White BG' : '扣除白色背景'}
              </button>
              <button
                onClick={() => applyPreset('vivid')}
                className="px-2.5 py-1.5 rounded-lg bg-white border border-amber-300 text-amber-800 hover:bg-amber-50 cursor-pointer transition-colors font-semibold whitespace-nowrap text-[11px] sm:text-xs"
              >
                {isEn ? 'Vibrant & Full' : '鲜艳高饱满'}
              </button>
              <button
                onClick={() => applyPreset('anime')}
                className="px-2.5 py-1.5 rounded-lg bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 cursor-pointer transition-colors font-medium whitespace-nowrap text-[11px] sm:text-xs"
              >
                {isEn ? 'Anime / Cartoon' : '动漫/卡通立绘'}
              </button>
              <button
                onClick={() => applyPreset('photo')}
                className="px-2.5 py-1.5 rounded-lg bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 cursor-pointer transition-colors font-medium whitespace-nowrap text-[11px] sm:text-xs"
              >
                {isEn ? 'Photo Real' : '真实照片'}
              </button>
              <button
                onClick={() => applyPreset('pixel')}
                className="px-2.5 py-1.5 rounded-lg bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 cursor-pointer transition-colors font-medium whitespace-nowrap text-[11px] sm:text-xs"
              >
                {isEn ? '8-Bit Pixel' : '8-Bit 像素'}
              </button>
              <button
                onClick={() => applyPreset('clean')}
                className="px-2.5 py-1.5 rounded-lg bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 cursor-pointer transition-colors whitespace-nowrap text-[11px] sm:text-xs"
              >
                <RotateCw className="w-3 h-3 inline mr-1" /> {isEn ? 'Reset' : '重置'}
              </button>
            </div>

            {/* Smart Crop Result Banner */}
            {cropSavedPercent !== null && (
              <div className="bg-sky-50 border border-sky-200 rounded-lg p-2.5 px-3.5 text-xs text-sky-800 flex items-center justify-between shrink-0 animate-fadeIn">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-sky-400 shrink-0 animate-pulse" />
                  <span>
                    {isEn ? (
                      <>Subject-first crop applied: <strong className="text-amber-300 font-mono text-sm">{cropSavedPercent}%</strong> less surrounding area. You can restore the complete composition.</>
                    ) : (
                      <>已应用主体优先裁剪：主体周围区域减少 <strong className="text-amber-300 font-mono text-sm">{cropSavedPercent}%</strong>。可随时恢复完整构图。</>
                    )}
                  </span>
                </div>
                <button
                  onClick={handleRestoreOriginal}
                  className="px-2.5 py-1 rounded-lg bg-white hover:bg-slate-50 text-slate-700 text-[11px] font-semibold border border-slate-300 shrink-0 cursor-pointer transition-colors"
                >
                  {isEn ? '↩️ Restore Full Image' : '↩️ 恢复完整原图'}
                </button>
              </div>
            )}

            {cropMessage && <div role="status" className="shrink-0 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">{cropMessage}</div>}

            {subjectCropPreview && (
              <section aria-label={isEn ? 'Subject-priority crop preview' : '主体优先裁剪预览'} className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-xs text-indigo-950">
                <div className="flex min-w-0 items-center gap-3">
                  <img src={subjectCropPreview.previewUrl} alt={isEn ? 'Proposed crop' : '建议裁剪结果'} className="h-24 w-24 shrink-0 rounded-lg border border-indigo-200 bg-white object-contain p-1" />
                  <div className="min-w-0 space-y-1">
                    <p className="font-bold">{isEn ? 'Preview before applying' : '先看裁剪结果，再决定是否应用'}</p>
                    <p>{subjectCropPreview.sourceWidth}×{subjectCropPreview.sourceHeight} → {subjectCropPreview.bounds.width}×{subjectCropPreview.bounds.height} · {isEn ? 'aspect ratio preserved' : '保持原比例，不拉伸'}</p>
                    <p>{isEn ? 'Planned bead grid' : '预计图纸尺寸'}：{localSettings.width}×{localSettings.keepAspectRatio
                      ? Math.max(10, Math.round(localSettings.width * subjectCropPreview.bounds.height / subjectCropPreview.bounds.width))
                      : localSettings.height}</p>
                    <p>{isEn ? `Removes ${subjectCropPreview.savedPercent}% of the surrounding area.` : `减少 ${subjectCropPreview.savedPercent}% 主体周围区域，让主体占用更多拼豆网格。`}</p>
                    {subjectCropPreview.mayExcludeDecorations && <p className="font-semibold text-amber-700">{isEn ? 'Detached decorations may be excluded. Review the outline on the original image.' : '部分边缘装饰或散点可能被裁掉，请检查原图上的蓝框。'}</p>}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col gap-1.5 sm:flex-row">
                  <button type="button" className="min-h-9 rounded-lg border border-indigo-300 bg-white px-3 font-semibold text-indigo-800 hover:bg-indigo-100" onClick={cancelSubjectCropPreview}>{isEn ? 'Keep full composition' : '取消，保留完整构图'}</button>
                  <button type="button" disabled={isCalculating || isCropAnalyzing} className="min-h-9 rounded-lg bg-indigo-600 px-3 font-bold text-white hover:bg-indigo-700 disabled:opacity-50" onClick={acceptSubjectCrop}>{isEn ? 'Use this crop' : '确认主体优先'}</button>
                </div>
              </section>
            )}

            <div className="grid grid-cols-2 gap-1 rounded-lg border border-slate-200 bg-white p-1 xl:hidden shrink-0">
              <button type="button" onClick={() => setActivePreviewPane('source')} className={`h-8 rounded-md text-xs font-semibold transition-colors ${activePreviewPane === 'source' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
                {isEn ? 'Source' : '原图'}
              </button>
              <button type="button" onClick={() => setActivePreviewPane('pattern')} className={`h-8 rounded-md text-xs font-semibold transition-colors ${activePreviewPane === 'pattern' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
                {isEn ? 'Pattern' : '拼豆图'}
              </button>
            </div>

            {/* Canvas Display Dual Box */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 shrink-0 xl:flex-1 xl:min-h-0 xl:items-stretch">
              {/* Box 1: Pre-processed Source Image Canvas */}
              <div className={`${activePreviewPane === 'source' ? 'flex' : 'hidden'} xl:flex flex-col min-h-0 bg-white border border-slate-200 rounded-lg p-3 relative group`}>
                <div className="flex items-center justify-between mb-2 text-xs font-semibold text-slate-700 shrink-0">
                  <span className="flex items-center gap-1">
                    <Scissors className="w-3.5 h-3.5 text-sky-400" />
                    {isEn ? 'Source Transform & Pre-process' : '原图变换与预处理'}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={handleRotate}
                      disabled={isCalculating}
                      className="p-1.5 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 disabled:opacity-50 cursor-pointer"
                      title={isEn ? 'Rotate 90°' : '旋转 90 度'}
                    >
                      <RotateCw className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => { cancelSubjectCropPreview(); setFlipH(f => !f); }}
                      disabled={isCalculating}
                      className="p-1.5 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 disabled:opacity-50 cursor-pointer"
                      title={isEn ? 'Horizontal Flip' : '水平镜像翻转'}
                    >
                      <FlipHorizontal className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => { cancelSubjectCropPreview(); setIsPickingColor(p => !p); }}
                      className={`p-1 px-2 rounded flex items-center gap-1 text-[11px] cursor-pointer transition-colors ${
                        isPickingColor
                          ? 'bg-rose-600 text-white animate-pulse'
                          : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                      }`}
                      title={isEn ? 'Click image to sample background color' : '点击原图吸取背景色扣除'}
                    >
                      <Pipette className="w-3.5 h-3.5" />
                      <span>{isPickingColor ? (isEn ? 'Click Image to Pick' : '点击图片扣色') : (isEn ? 'Pick BG Color' : '吸除背景')}</span>
                    </button>
                  </div>
                </div>

                <div className="flex-1 min-h-[300px] xl:min-h-0 flex items-center justify-center overflow-hidden bg-slate-100 rounded-lg border border-slate-200 p-2 relative">
                  <div className="relative inline-flex max-w-full max-h-full">
                    <canvas
                      ref={imageCanvasRef}
                      onClick={handleCanvasClick}
                      className={`block max-w-full max-h-full object-contain rounded outline outline-1 outline-slate-500 ${
                        isPickingColor ? 'cursor-crosshair ring-2 ring-rose-500' : ''
                      }`}
                    />
                    {subjectCropPreview && <svg aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${subjectCropPreview.sourceWidth} ${subjectCropPreview.sourceHeight}`} preserveAspectRatio="none">
                      <path d={`M0 0H${subjectCropPreview.sourceWidth}V${subjectCropPreview.sourceHeight}H0Z M${subjectCropPreview.bounds.x} ${subjectCropPreview.bounds.y}h${subjectCropPreview.bounds.width}v${subjectCropPreview.bounds.height}h-${subjectCropPreview.bounds.width}Z`} fill="#0f172a" fillOpacity=".46" fillRule="evenodd" />
                      <rect x={subjectCropPreview.bounds.x} y={subjectCropPreview.bounds.y} width={subjectCropPreview.bounds.width} height={subjectCropPreview.bounds.height} fill="#38bdf8" fillOpacity=".08" stroke="#0284c7" strokeWidth={Math.max(2, subjectCropPreview.sourceWidth / 500)} strokeDasharray={`${Math.max(6, subjectCropPreview.sourceWidth / 90)} ${Math.max(4, subjectCropPreview.sourceWidth / 180)}`} />
                    </svg>}
                  </div>
                  {isPickingColor && (
                    <div className="absolute top-2 left-2 bg-rose-600/90 text-white text-[11px] px-2 py-1 rounded-md shadow backdrop-blur pointer-events-none">
                      {isEn ? 'Click any pixel on image to remove color' : '点击图像上的任何背景位置以直接扣除该颜色'}
                    </div>
                  )}
                </div>
              </div>

              {/* Box 2: Live Converted Pixel Bead Preview */}
              <div className={`${activePreviewPane === 'pattern' ? 'flex' : 'hidden'} xl:flex flex-col min-h-0 bg-white border border-slate-200 rounded-lg p-3`}>
                <div className="flex items-center justify-between mb-2 text-xs font-semibold text-slate-700 shrink-0">
                  <span className="flex items-center gap-1">
                    <Eye className="w-3.5 h-3.5 text-rose-400" />
                    {isEn ? `Pattern Preview (${localSettings.width} × ${localSettings.height})` : `拼豆图纸预览 (${localSettings.width} × ${localSettings.height})`}
                  </span>
                  <div className="text-[11px] text-emerald-400 font-mono font-bold flex items-center gap-1">
                    <span>{isEn ? `Total Beads: ${previewGrid.flat().filter(Boolean).length} pcs` : `实际用豆: ${previewGrid.flat().filter(Boolean).length} 粒`}</span>
                    {previewGrid.flat().filter(c => c === null).length > 0 && (
                      <span className="text-[10px] text-pink-300 bg-pink-950/80 border border-pink-700/60 px-1.5 py-0.5 rounded font-sans">
                        {isEn ? `(${previewGrid.flat().filter(c => c === null).length} transparent)` : `(已免算 ${previewGrid.flat().filter(c => c === null).length} 空格)`}
                      </span>
                    )}
                  </div>
                </div>
                {conversionDiagnostics && (
                  <div className="mb-2 text-[10px] font-mono text-slate-400 flex flex-wrap gap-x-2 gap-y-0.5" title="Image conversion diagnostics">
                    <span>V2 {conversionDiagnostics.pipeline.toUpperCase()}</span>
                    <span>{conversionDiagnostics.effectiveColorCount} colors</span>
                    <span>{Math.round(conversionDiagnostics.confidence * 100)}%</span>
                    <span>bg -{conversionDiagnostics.backgroundPixelsRemoved}</span>
                    <span>LΔ {conversionDiagnostics.lightnessBias >= 0 ? '+' : ''}{conversionDiagnostics.lightnessBias.toFixed(1)}</span>
                    <span>ΔE {conversionDiagnostics.meanDeltaE.toFixed(1)}</span>
                    {conversionDiagnostics.background && <span>bg {conversionDiagnostics.background.color}</span>}
                  </div>
                )}

                <div className="flex-1 min-h-[300px] xl:min-h-0 relative flex items-center justify-center overflow-hidden bg-slate-100 rounded-lg border border-slate-200 p-2">
                  {previewGrid.length > 0 ? (
                    <canvas
                      ref={previewCanvasRef}
                      style={{ imageRendering: 'pixelated' }}
                      className="max-w-full max-h-full object-contain rounded shadow-lg outline outline-1 outline-slate-500"
                    />
                  ) : (
                    <div className="text-slate-500 text-xs flex items-center gap-2">
                      <div className="w-4 h-4 rounded-full border-2 border-rose-500/30 border-t-rose-500 animate-spin" />
                      <span>{isEn ? 'Processing high-precision pixels...' : '正在计算高精度像素...'}</span>
                    </div>
                  )}

                  {isCalculating && (
                    <div className="absolute inset-0 bg-white/85 backdrop-blur-xs flex flex-col items-center justify-center gap-2 z-10">
                      <div className="relative flex items-center justify-center">
                        <div className="w-10 h-10 rounded-full border-3 border-rose-500/20 border-t-rose-500 animate-spin" />
                        <Sparkles className="w-4 h-4 text-amber-400 absolute animate-pulse" />
                      </div>
                      <span className="text-xs text-rose-300 font-medium">
                        {isEn ? 'Recalculating bead pattern...' : '✨ 正在生成最新图纸预览...'}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Mobile jump-to-settings button */}
            <div className="xl:hidden mt-1 shrink-0">
              <button
                onClick={() => setActiveMobileTab('settings')}
                className="w-full py-2.5 rounded-lg bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold flex items-center justify-center gap-2 border border-slate-300 cursor-pointer transition-colors"
              >
                <Sliders className="w-4 h-4 text-amber-400" />
                <span>{isEn ? 'Adjust Grid Dimensions, Sharpening & Color Engine →' : '调节尺寸、锐化、颜色算法等参数 →'}</span>
              </button>
            </div>
          </div>

          {/* Right Control Drawer: Advanced Sliders */}
          <div
            className={`w-full bg-white border-t xl:border-t-0 xl:border-l border-slate-200 p-4 sm:p-5 overflow-y-auto space-y-5 text-xs select-none min-w-0 min-h-0 ${
              activeMobileTab === 'settings' ? 'block' : 'hidden xl:block'
            }`}
          >
            {/* Mobile Header Banner in settings tab */}
            <div className="xl:hidden pb-3 border-b border-slate-200 flex items-center justify-between">
              <span className="text-slate-500 text-[11px]">{isEn ? 'Grid Dimensions:' : '当前拼豆尺寸:'} <strong className="text-teal-700 font-mono text-xs">{localSettings.width} × {localSettings.height}</strong></span>
              <button
                onClick={() => setActiveMobileTab('preview')}
                className="px-2.5 py-1 rounded-lg bg-teal-50 text-teal-700 border border-teal-200 text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
              >
                <Eye className="w-3.5 h-3.5" />
                <span>{isEn ? 'Switch to Preview' : '切回效果预览'}</span>
              </button>
            </div>
            {/* Section 0: Grid Target Dimensions */}
            <div className="space-y-2">
              <label className="text-slate-900 font-bold flex items-center justify-between text-xs">
                <span>{isEn ? 'Target Grid Dimensions' : '转换拼豆目标尺寸'}</span>
                <span className="text-[11px] text-teal-700 font-mono">
                  {localSettings.width} x {localSettings.height} {isEn ? 'Beads' : '豆'}
                </span>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="text-[10px] text-slate-500">{isEn ? 'Width (W)' : '宽度 (W)'}</span>
                  <input
                    type="number"
                    min={10}
                    max={300}
                    value={localSettings.width}
                    onChange={e => {
                      const newW = Math.max(10, parseInt(e.target.value) || 29);
                      setLocalSettings(s => ({
                        ...s,
                        width: newW,
                        height: s.keepAspectRatio && dimensionsImageWidth > 0 && dimensionsImageHeight > 0
                          ? Math.max(10, Math.round((newW * dimensionsImageHeight) / dimensionsImageWidth)) : s.height
                      }));
                    }}
                    className="w-full bg-white border border-slate-300 text-slate-900 font-mono rounded px-2 py-1.5 text-xs outline-none focus:border-teal-500"
                  />
                </div>
                <div>
                  <span className="text-[10px] text-slate-500">{isEn ? 'Height (H)' : '高度 (H)'}</span>
                  <input
                    type="number"
                    min={10}
                    max={300}
                    value={localSettings.height}
                    onChange={e => {
                      const newH = Math.max(10, parseInt(e.target.value) || 29);
                      setLocalSettings(s => ({
                        ...s,
                        height: newH,
                        width: s.keepAspectRatio && dimensionsImageWidth > 0 && dimensionsImageHeight > 0
                          ? Math.max(10, Math.round((newH * dimensionsImageWidth) / dimensionsImageHeight)) : s.width
                      }));
                    }}
                    className="w-full bg-white border border-slate-300 text-slate-900 font-mono rounded px-2 py-1.5 text-xs outline-none focus:border-teal-500"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-2 pt-3 border-t border-slate-200">
              <label className="text-slate-900 font-bold flex items-center gap-1.5 text-xs">
                <Zap className="w-4 h-4 text-amber-400" />
                <span>V2 Pipeline</span>
              </label>
              <div className="grid grid-cols-3 gap-1">
                {(['auto', 'logo', 'photo'] as const).map((pipeline) => (
                  <button
                    key={pipeline}
                    onClick={() => setLocalSettings(s => ({ ...s, pipelineOverride: pipeline }))}
                    className={`py-1.5 rounded-lg border text-[11px] font-semibold transition-colors cursor-pointer ${
                      (localSettings.pipelineOverride ?? 'auto') === pipeline
                        ? 'bg-teal-600 border-teal-600 text-white'
                        : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                    }`}
                  >
                    {pipeline === 'auto' ? 'Auto' : pipeline === 'logo' ? 'LOGO' : 'Photo'}
                  </button>
                ))}
              </div>
              <div className="text-[10px] text-slate-500">LOGO: CIE76 / no dithering. Photo: CIEDE2000 / Floyd-Steinberg.</div>
            </div>

            {/* Section 2: Sharpening & Outline Protection */}
            <div className="space-y-3 pt-3 border-t border-slate-200">
              <label className="text-slate-900 font-bold flex items-center gap-1.5 text-xs">
                <Sliders className="w-4 h-4 text-sky-400" />
                <span>{isEn ? 'Edge Sharpening & Enhancement' : '图像边缘与锐化处理'}</span>
              </label>

              <PreciseRangeControl
                label={isEn ? 'Sharpening & Edge Enhancement' : '锐化与边缘增强'}
                value={localSettings.sharpening}
                min={0}
                max={100}
                suffix="%"
                onValueChange={sharpening => setLocalSettings(s => ({ ...s, sharpening }))}
              />
              <div>
                <p className="text-[10px] text-slate-500">
                  {isEn ? 'Boosts fine line sharpness caused by downscaling.' : '提升因缩小造成的线条模糊，使像素小点边缘清晰无比。'}
                </p>
              </div>

              {/* Outline Protection Checkbox */}
              <label className="flex items-center gap-2 bg-slate-50 p-2 rounded-lg border border-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={localSettings.outlineBoost}
                  onChange={e =>
                    setLocalSettings(s => ({ ...s, outlineBoost: e.target.checked }))
                  }
                  className="w-4 h-4 accent-teal-600 rounded cursor-pointer"
                />
                <div>
                  <span className="font-bold text-slate-800">{isEn ? 'Generate dark character outlines' : '生成深色人物边缘保护'}</span>
                  <p className="text-[10px] text-slate-500">
                    {isEn ? 'Adds a restrained dark bead border to strong silhouettes and joins.' : '为人物外轮廓、手臂/身体和头部/身体等强分界增加深色描边'}
                  </p>
                </div>
              </label>

            </div>

            {/* Section 3: Background Chroma Key & Smart Auto Crop */}
            <div className="space-y-3 pt-3 border-t border-slate-200">
              <label className="text-slate-900 font-bold flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5">
                  <Crop className="w-4 h-4 text-sky-400" />
                  <span>{isEn ? 'Smart Subject Crop & BG Removal' : '智能主体裁剪与背景扣除'}</span>
                </span>
                {localSettings.backgroundRemovalEnabled && (
                  <button
                    onClick={disableBackgroundRemoval}
                    className="text-[10px] text-rose-400 hover:underline cursor-pointer"
                  >
                    {isEn ? 'Clear Color' : '清除扣色'}
                  </button>
                )}
              </label>

              <p className="rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-2 text-[11px] leading-relaxed text-sky-800">
                {isEn ? 'Subject-priority framing is available from the preview tool above. Background removal stays separate.' : '主体优先裁剪请使用上方“主体优先（预览）”；背景移除是独立步骤，不会自动开启。'}
              </p>

              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={autoDetectAndRemoveBackground}
                  className="py-1.5 px-2 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-[11px] font-bold hover:bg-rose-100 cursor-pointer flex items-center justify-center gap-1"
                >
                  <Scissors className="w-3 h-3 text-pink-400" />
                  <span>{isEn ? '🪄 Smart Corner Cut' : '🪄 智能角落抠图'}</span>
                </button>
                <button
                  type="button"
                  onClick={removeWhiteBackground}
                  className="py-1.5 px-2 rounded-lg bg-white border border-slate-300 text-slate-700 text-[11px] font-medium hover:bg-slate-50 cursor-pointer flex items-center justify-center gap-1"
                >
                  <span>{isEn ? '☁️ Remove White BG' : '☁️ 扣除纯白背景'}</span>
                </button>
              </div>

              <div className="flex items-center gap-3 bg-slate-50 p-2 rounded-lg border border-slate-200">
                <div
                  className="w-7 h-7 rounded-lg border border-slate-600 shadow-inner shrink-0"
                  style={{ backgroundColor: pickedChromaColor || 'transparent' }}
                />
                <div className="flex-1">
                  <div className="text-[11px] font-bold text-slate-800">
                    {localSettings.backgroundRemovalEnabled
                      ? (pickedChromaColor ? (isEn ? `Removing: ${pickedChromaColor}` : `扣除颜色: ${pickedChromaColor}`) : (isEn ? 'Smart background removal is on' : '智能去背景已开启'))
                      : (isEn ? 'Background removal is off' : '背景移除已关闭')}
                  </div>
                  <div className="text-[10px] text-slate-500">
                    {localSettings.backgroundRemovalEnabled
                      ? (isEn ? 'Clear to keep the original background' : '清除即可保留原背景')
                      : (isEn ? 'Choose Smart Cut, white background, or pipette to enable' : '请主动选择智能、白底或吸管去背景')}
                  </div>
                </div>
              </div>

              {localSettings.backgroundRemovalEnabled && (
                <PreciseRangeControl
                  label={isEn ? 'Chroma Tolerance' : '抠色容差'}
                  value={localSettings.chromaKeyTolerance}
                  min={0}
                  max={100}
                  suffix="%"
                  onValueChange={chromaKeyTolerance => setLocalSettings(s => ({ ...s, chromaKeyTolerance }))}
                />
              )}
            </div>

            {/* Section 4: Filters (Brightness, Contrast, Saturation) */}
            <div className="space-y-3 pt-3 border-t border-slate-200">
              <label className="text-slate-900 font-bold text-xs">{isEn ? 'Basic Color Adjustments' : '基础明暗调色'}</label>

              <PreciseRangeControl label={isEn ? 'Brightness' : '亮度'} value={localSettings.brightness} min={-100} max={100} onValueChange={brightness => setLocalSettings(s => ({ ...s, brightness }))} />

              <PreciseRangeControl label={isEn ? 'Contrast' : '对比度'} value={localSettings.contrast} min={-100} max={100} onValueChange={contrast => setLocalSettings(s => ({ ...s, contrast }))} />

              <PreciseRangeControl label={isEn ? 'Saturation' : '饱和度'} value={localSettings.saturation} min={-100} max={100} onValueChange={saturation => setLocalSettings(s => ({ ...s, saturation }))} />
            </div>

            {/* Section 5: Color Limit & Dithering */}
            <div className="space-y-3 pt-3 border-t border-slate-200">
              <label className="text-slate-900 font-bold text-xs">{isEn ? 'Color Limits & Dithering' : '用色精简与抖动采样'}</label>

              <div className="space-y-1">
                <div className="flex justify-between text-[11px]">
                  <span className="text-slate-600">{isEn ? 'Dithering Algorithm' : '抖动算法 (Dither)'}</span>
                </div>
                <select
                  value={localSettings.dither}
                  onChange={e => setLocalSettings(s => ({ ...s, dither: e.target.value as DitherMode }))}
                  className="w-full bg-white border border-slate-300 text-slate-900 rounded px-2 py-1.5 text-xs outline-none cursor-pointer focus:border-teal-500"
                >
                  <option value="none">{isEn ? 'None (Clean sharp edges)' : '无抖动 (保持边缘清晰洁净)'}</option>
                  <option value="floyd">{isEn ? 'Floyd-Steinberg (Smooth gradients)' : 'Floyd-Steinberg 误差扩散抖动 (平滑渐变)'}</option>
                </select>
              </div>

              {localSettings.dither === 'floyd' && (
                <PreciseRangeControl
                  label={isEn ? 'Floyd strength' : 'Floyd 强度'}
                  value={Math.round((localSettings.ditherStrength ?? 0.25) * 100)}
                  min={0}
                  max={100}
                  suffix="%"
                  onValueChange={strength => setLocalSettings(s => ({ ...s, ditherStrength: strength / 100 }))}
                />
              )}

              <div className="space-y-1">
                <div className="flex justify-between text-[11px]">
                  <span className="text-slate-600">{isEn ? 'Max Color Limit' : '用色种类上限'}</span>
                </div>
                <select
                  value={localSettings.colorLimit}
                  onChange={e => setLocalSettings(s => ({ ...s, colorLimit: parseInt(e.target.value) }))}
                  className="w-full bg-white border border-slate-300 text-slate-900 rounded px-2 py-1.5 text-xs outline-none cursor-pointer focus:border-teal-500"
                >
                  <option value={0}>{isEn ? 'Unlimited (Auto match full palette)' : '不设限 (自动匹配色板全色彩)'}</option>
                  <option value={8}>{isEn ? 'Max 8 colors (Ultra retro)' : '最多 8 色 (超简复古)'}</option>
                  <option value={12}>{isEn ? 'Max 12 colors' : '最多 12 色'}</option>
                  <option value={16}>{isEn ? 'Max 16 colors' : '最多 16 色 (经典16色)'}</option>
                  <option value={24}>{isEn ? 'Max 24 colors' : '最多 24 色'}</option>
                  <option value={32}>{isEn ? 'Max 32 colors' : '最多 32 色'}</option>
                  <option value={48}>{isEn ? 'Max 48 colors' : '最多 48 色'}</option>
                  <option value={64}>{isEn ? 'Max 64 colors' : '最多 64 色'}</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="sticky bottom-0 px-3.5 sm:px-5 py-2.5 border-t border-slate-200 flex items-center justify-between bg-white shrink-0 gap-2">
          <button
            onClick={handleClose}
            className="px-3.5 sm:px-4 py-2 rounded-lg border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold cursor-pointer transition-colors shrink-0"
          >
            {isEn ? 'Cancel' : '取消'}
          </button>
          <button
            onClick={handleApply}
            disabled={isCalculating || isCropAnalyzing || Boolean(subjectCropPreview)}
            className="flex-1 sm:flex-initial px-3.5 sm:px-6 py-2 sm:py-2.5 rounded-lg bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-xs font-bold shadow-sm flex items-center justify-center gap-1.5 cursor-pointer transition-colors active:scale-95 truncate"
          >
            <Check className="w-4 h-4 shrink-0" />
            <span className="truncate">{subjectCropPreview ? (isEn ? 'Confirm or cancel crop first' : '请先确认或取消裁剪预览') : (isEn ? 'Generate Preview · Free' : '生成预览 · 免费')}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
