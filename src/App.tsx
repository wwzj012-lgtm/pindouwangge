import React, { Suspense, lazy, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { LayoutGrid, Sliders, BarChart3, Wand2, Download, Palette, Sparkles, Loader2, Save, X, Zap } from 'lucide-react';
import { useAuth } from './context/AuthContext';
import { useLanguage } from './context/LanguageContext';
import {
  BeadColor,
  BeadShape,
  BrandKey,
  ConvertSettings,
  ProjectData,
  ToolType,
  SymmetryMode,
  CanvasBackdrop,
} from './types';
import { BRAND_NAMES, BRAND_PALETTES } from './data/palettes';
import { SAMPLE_IMAGES } from './data/samples';
import { imageToGridWithDiagnostics } from './utils/colorUtils';
import type { ConversionDiagnostics } from './utils/imagePipeline';
import { smartCropSubject } from './utils/cropUtils';
import { resetBackgroundRemovalForNewImage } from './utils/imageStudioControls';
import { createImageRequestGate } from './utils/imageRequestGate';
import { resolveCanvasReset } from './utils/canvasReset';
import {
  commitHistorySnapshot,
  getRedoState,
  getUndoState,
  gridsEqual,
  type GridSnapshot,
} from './utils/historyTransactions';

import { Header } from './components/Header';
import { Toolbar } from './components/Toolbar';
import { GridCanvas } from './components/GridCanvas';
import { SettingsPanel } from './components/SettingsPanel';
import { StatsPanel } from './components/StatsPanel';
import { PaletteManagerModal } from './components/PaletteManagerModal';
import { ExportModal } from './components/ExportModal';
import { ColorReplaceModal } from './components/ColorReplaceModal';
import { ImageStudioModal } from './components/ImageStudioModal';
import { UserGuideModal } from './components/UserGuideModal';
import { AuthModal } from './components/AuthModal';
import { VipPrivilegesModal } from './components/VipPrivilegesModal';
import { UserProfileModal } from './components/UserProfileModal';
import { AccountManagementModal } from './components/AccountManagementModal';
import { HomeView, type HeroExample } from './components/HomeView';
import type { LargeCanvasFrame } from './components/LargeCanvasView';
import { getLargeCanvasModeSettings, type LargeCanvasConversionMode } from './utils/largeCanvas';
import type { CommunityPattern } from './data/communityData';
import { saveExportedPatternRecord, type EditablePatternProject } from './utils/patternHistory';

const LARGE_CANVAS_PREPROCESS_CANCELLED = '图片预处理已取消';
const AdminPage = lazy(() => import('./pages/AdminPage'));
const CommunityView = lazy(() =>
  import('./components/CommunityView').then(({ CommunityView: Component }) => ({ default: Component })),
);
const LargeCanvasView = lazy(() =>
  import('./components/LargeCanvasView').then(({ LargeCanvasView: Component }) => ({ default: Component })),
);
const UserPatternsModal = lazy(() =>
  import('./components/UserPatternsModal').then(({ UserPatternsModal: Component }) => ({ default: Component })),
);
const SmartBeadReducerModal = lazy(() =>
  import('./components/SmartBeadReducerModal').then(({ SmartBeadReducerModal: Component }) => ({ default: Component })),
);

function AdminPageLoading() {
  return <main className="grid min-h-screen place-items-center bg-slate-950 p-4 text-slate-100"><div role="status" className="flex min-h-24 w-full max-w-sm items-center justify-center gap-3 border border-slate-800 bg-slate-900 px-4 text-sm text-slate-300"><Loader2 className="h-5 w-5 shrink-0 animate-spin text-sky-300" aria-hidden="true" /><span>正在加载管理后台...</span></div></main>;
}

type DeferredFeatureSurface = 'page' | 'modal';

interface DeferredFeatureBoundaryProps {
  label: string;
  surface: DeferredFeatureSurface;
  onDismiss?: () => void;
  children: React.ReactNode;
}

interface DeferredFeatureBoundaryState {
  hasError: boolean;
}

function DeferredFeaturePageLoading({ label }: Pick<DeferredFeatureBoundaryProps, 'label'>) {
  return (
    <section role="status" className="grid min-h-[52dvh] place-items-center p-4 sm:p-6" aria-live="polite">
      <div className="flex min-h-24 w-full max-w-sm items-center justify-center gap-3 border border-sky-200 bg-white px-4 text-sm text-sky-950 shadow-sm">
        <Loader2 className="h-5 w-5 shrink-0 animate-spin text-sky-600" aria-hidden="true" />
        <span>正在加载{label}...</span>
      </div>
    </section>
  );
}

function DeferredFeatureModalLoading({ label }: Pick<DeferredFeatureBoundaryProps, 'label'>) {
  return (
    <div className="fixed inset-0 z-60 grid place-items-center bg-slate-950/55 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={`正在加载${label}`}>
      <div role="status" className="flex min-h-24 w-full max-w-sm items-center justify-center gap-3 border border-sky-200 bg-white px-4 text-sm text-sky-950 shadow-xl" aria-live="polite">
        <Loader2 className="h-5 w-5 shrink-0 animate-spin text-sky-600" aria-hidden="true" />
        <span>正在加载{label}...</span>
      </div>
    </div>
  );
}

function DeferredFeatureLoadFailure({ label, surface, onDismiss }: Omit<DeferredFeatureBoundaryProps, 'children'>) {
  const message = <div className="w-full max-w-sm border border-rose-200 bg-white p-5 text-center shadow-xl">
    <h2 className="text-base font-bold text-rose-950">{label}加载失败</h2>
    <p className="mt-2 text-sm leading-6 text-rose-800">当前图纸和登录状态仍会保留。重新加载页面后可重新获取此功能。</p>
    <div className="mt-5 flex justify-center gap-2">
      {onDismiss && <button type="button" onClick={onDismiss} className="border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">关闭</button>}
      <button type="button" onClick={() => window.location.reload()} className="bg-sky-700 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-800">重新加载页面</button>
    </div>
  </div>;

  return surface === 'modal'
    ? <div className="fixed inset-0 z-60 grid place-items-center bg-slate-950/55 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={`${label}加载失败`}>{message}</div>
    : <section className="grid min-h-[52dvh] place-items-center p-4 sm:p-6" role="alert">{message}</section>;
}

class DeferredFeatureBoundary extends React.Component<DeferredFeatureBoundaryProps, DeferredFeatureBoundaryState> {
  declare readonly props: Readonly<DeferredFeatureBoundaryProps>;
  state: DeferredFeatureBoundaryState = { hasError: false };

  static getDerivedStateFromError(): DeferredFeatureBoundaryState {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      const { children: _children, ...props } = this.props;
      return <DeferredFeatureLoadFailure {...props} />;
    }
    return this.props.children;
  }
}

type StudioTab = 'home' | 'community' | 'studio' | 'largeCanvas';
type PublicFeatureKey = 'public.community' | 'public.large_canvas' | 'public.smart_reducer';

interface PublicAnnouncement {
  id: string;
  title: string;
  content: string;
  pinned: boolean;
  publishAt: number;
}

const PUBLIC_FEATURE_DEFAULTS: Record<PublicFeatureKey, boolean> = {
  'public.community': true,
  'public.large_canvas': true,
  'public.smart_reducer': true,
};

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function publicData(value: unknown): unknown {
  const envelope = recordValue(value);
  return envelope?.success === true ? envelope.data : null;
}

function parsePublicAnnouncements(value: unknown): PublicAnnouncement[] {
  const rows = recordValue(value)?.announcements;
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, 3).flatMap((row) => {
    const item = recordValue(row);
    const id = typeof item?.id === 'string' ? item.id.trim().slice(0, 64) : '';
    const title = typeof item?.title === 'string' ? item.title.trim().slice(0, 120) : '';
    const content = typeof item?.content === 'string' ? item.content.trim().slice(0, 10_000) : '';
    const publishAt = typeof item?.publishAt === 'number' && Number.isSafeInteger(item.publishAt) ? item.publishAt : 0;
    if (!id || !title || !content || publishAt <= 0 || typeof item?.pinned !== 'boolean') return [];
    return [{ id, title, content, pinned: item.pinned, publishAt }];
  });
}

function isPublicFeatureKey(value: unknown): value is PublicFeatureKey {
  return value === 'public.community' || value === 'public.large_canvas' || value === 'public.smart_reducer';
}

function parsePublicFeatureFlags(value: unknown): Record<PublicFeatureKey, boolean> {
  const flags = { ...PUBLIC_FEATURE_DEFAULTS };
  const rows = recordValue(value)?.flags;
  if (!Array.isArray(rows)) return flags;
  for (const row of rows) {
    const item = recordValue(row);
    if (isPublicFeatureKey(item?.key) && typeof item.enabled === 'boolean') flags[item.key] = item.enabled;
  }
  return flags;
}

function isGuestAccount(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const account = value as Record<string, unknown>;
  return account.authProvider === 'guest' || account.auth_provider === 'guest' || account.provider === 'guest';
}

type LargeCanvasStudioRequest = {
  id: number;
  sourceImage: HTMLImageElement;
  fileName: string;
};

function imageElementToFile(image: HTMLImageElement, fileName: string): Promise<File> {
  return new Promise((resolve, reject) => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth || image.width || 1;
      canvas.height = image.naturalHeight || image.height || 1;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('无法处理预览图片');
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(blob => {
        if (!blob) {
          reject(new Error('无法生成预处理图片'));
          return;
        }
        resolve(new File([blob], fileName, { type: blob.type || 'image/png' }));
      }, 'image/png');
    } catch (error) {
      reject(error instanceof Error ? error : new Error('无法处理预览图片'));
    }
  });
}

function StudioApp() {
  const { language } = useLanguage();
  const { currentUser, userProfile } = useAuth();
  const isEn = language === 'en';

  // 1. Core State
  const [currentTab, setCurrentTab] = useState<StudioTab>('home');
  const [projectName, setProjectName] = useState('我的拼豆创意图纸');
  const [activePatternId, setActivePatternId] = useState<string | null>(null);
  const [isSavingPattern, setIsSavingPattern] = useState(false);
  const saveSubmissionRef = useRef(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [isSaveNameDialogOpen, setIsSaveNameDialogOpen] = useState(false);
  const [saveNameInput, setSaveNameInput] = useState('');
  const [saveNameError, setSaveNameError] = useState<string | null>(null);
  const [imageLoadMessage, setImageLoadMessage] = useState<string | null>(null);
  const [publicAnnouncements, setPublicAnnouncements] = useState<PublicAnnouncement[]>([]);
  const [dismissedAnnouncementIds, setDismissedAnnouncementIds] = useState<Set<string>>(() => new Set());
  const [publicFeatureFlags, setPublicFeatureFlags] = useState<Record<PublicFeatureKey, boolean>>(() => ({ ...PUBLIC_FEATURE_DEFAULTS }));
  const [brand, setBrand] = useState<BrandKey>('MARD');
  const [activePalette, setActivePalette] = useState<BeadColor[]>(BRAND_PALETTES.MARD);
  const [isConverting, setIsConverting] = useState<boolean>(false);
  const [conversionDiagnostics, setConversionDiagnostics] = useState<ConversionDiagnostics | null>(null);

  // Conversion Settings
  const [settings, setSettings] = useState<ConvertSettings>({
    width: 79,
    height: 44,
    keepAspectRatio: true,
    brand: 'MARD',
    dither: 'none',
    colorLimit: 0,
    brightness: 0,
    contrast: 0,
    saturation: 0,
    transparentCutoff: 128,
    boardSize: 29,
    sharpening: 30,
    outlineBoost: true,
    chromaKeyColor: null,
    chromaKeyTolerance: 20,
    colorMatchAlgo: 'ciede2000',
    kmeansClustering: true,
    quantizationStrength: 28,
    pipelineOverride: 'cartoon',
  });

  // Quantization is a required preprocessing step for every conversion mode.
  // Normalize imported or legacy project settings before the next interaction.
  useEffect(() => {
    if (settings.kmeansClustering !== true) {
      setSettings(previous => ({ ...previous, kmeansClustering: true }));
    }
  }, [settings.kmeansClustering]);

  // Source Image element reference
  const [sourceImage, setSourceImage] = useState<HTMLImageElement | null>(null);
  const imageRequestGateRef = useRef(createImageRequestGate());
  const [largeCanvasStudioRequest, setLargeCanvasStudioRequest] = useState<LargeCanvasStudioRequest | null>(null);
  const [largeCanvasStudioSettings, setLargeCanvasStudioSettings] = useState<ConvertSettings>(() => ({ ...settings }));
  const largeCanvasStudioRequestRef = useRef<{
    id: number;
    resolve: (file: File) => void;
    reject: (error: Error) => void;
  } | null>(null);
  const largeCanvasStudioRequestIdRef = useRef(0);

  const beginImageRequest = useCallback(() => {
    return imageRequestGateRef.current.begin();
  }, []);

  const invalidateImageRequest = useCallback(() => {
    const token = imageRequestGateRef.current.invalidate();
    setIsConverting(false);
    return token;
  }, []);

  const isCurrentImageRequest = useCallback(
    (token: number) => imageRequestGateRef.current.isCurrent(token),
    []
  );

  const finishImageRequest = useCallback(
    (token: number) => {
      if (isCurrentImageRequest(token)) setIsConverting(false);
    },
    [isCurrentImageRequest]
  );

  // Grid Matrix: 2D Array of BeadColor ID (or null for empty peg)
  const [grid, setGrid] = useState<(string | null)[][]>(() =>
    Array.from({ length: 44 }, () => Array(79).fill(null))
  );

  // Undo / Redo History Stack
  const [history, setHistory] = useState<(string | null)[][][]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const gridRef = useRef<GridSnapshot>(grid);
  const historyRef = useRef<GridSnapshot[]>(history);
  const historyIndexRef = useRef(historyIndex);
  const historyTransactionRef = useRef<GridSnapshot | null>(null);

  useEffect(() => {
    gridRef.current = grid;
  }, [grid]);

  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  useEffect(() => {
    historyIndexRef.current = historyIndex;
  }, [historyIndex]);

  // Editing Tool State
  const [activeTool, setActiveTool] = useState<ToolType>('pencil');
  const [selectedColor, setSelectedColor] = useState<BeadColor | null>(BRAND_PALETTES.MARD[0]);
  const [highlightColorId, setHighlightColorId] = useState<string | null>(null);
  const [symmetryMode, setSymmetryMode] = useState<SymmetryMode>('none');

  // Display Mode & Backdrop Settings
  const [beadShape, setBeadShape] = useState<BeadShape>('square');
  const [canvasBackdrop, setCanvasBackdrop] = useState<CanvasBackdrop>('dark_grid');
  const [showSymbols, setShowSymbols] = useState(true);
  const [showGridLines, setShowGridLines] = useState(true);
  const [showCoordinates, setShowCoordinates] = useState(true);
  const [showLargeCodeLabels, setShowLargeCodeLabels] = useState(false);
  const [showLargeDataPreview, setShowLargeDataPreview] = useState(false);
  const [showOverlay, setShowOverlay] = useState(false);
  const [zoom, setZoom] = useState(1.0);

  // Modals & Drawer State
  const [mobileDrawer, setMobileDrawer] = useState<'none' | 'settings' | 'stats'>('none');
  const [isPaletteModalOpen, setIsPaletteModalOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isStudioModalOpen, setIsStudioModalOpen] = useState(false);
  const [isGuideModalOpen, setIsGuideModalOpen] = useState(false);
  const [isSmartReduceModalOpen, setRawSmartReduceModalOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isUserProfileModalOpen, setIsUserProfileModalOpen] = useState(false);
  const [isAccountManagementModalOpen, setIsAccountManagementModalOpen] = useState(false);
  const [isUserPatternsModalOpen, setIsUserPatternsModalOpen] = useState(false);
  const [isVipModalOpen, setIsVipModalOpen] = useState(false);
  const [alignedPixels, setAlignedPixels] = useState<Uint8ClampedArray | undefined>(undefined);
  const [replaceSourceColor, setReplaceSourceColor] = useState<BeadColor | null>(null);
  const [erasedColorCoords, setErasedColorCoords] = useState<Map<string, [number, number][]>>(() => new Map<string, [number, number][]>());

  const hasFormalLogin = Boolean(currentUser) && !isGuestAccount(currentUser) && !isGuestAccount(userProfile);

  const requireFormalLogin = useCallback((message: string): boolean => {
    if (hasFormalLogin) return true;
    setSaveMessage(message);
    setIsAuthModalOpen(true);
    return false;
  }, [hasFormalLogin]);

  const openUserPatternsModal = useCallback(() => {
    if (!requireFormalLogin(isEn ? 'Sign in before opening your library.' : '请先登录，再打开我的图库。')) return;
    setIsUserPatternsModalOpen(true);
  }, [isEn, requireFormalLogin]);

  useEffect(() => {
    if (!hasFormalLogin) setIsUserPatternsModalOpen(false);
  }, [hasFormalLogin]);

  // Open login modal on 401 unauthorized event
  useEffect(() => {
    const handleUnauthorized = () => {
      setIsAuthModalOpen(true);
    };
    window.addEventListener('unauthorized', handleUnauthorized);
    return () => window.removeEventListener('unauthorized', handleUnauthorized);
  }, []);

  useEffect(() => {
    let active = true;
    const readPublic = async (path: string): Promise<unknown> => {
      try {
        const response = await fetch(path, { headers: { Accept: 'application/json' }, credentials: 'omit' });
        if (!response.ok) return null;
        return publicData(await response.json());
      } catch {
        return null;
      }
    };
    void Promise.all([
      readPublic('/api/public/announcements'),
      readPublic('/api/public/feature-flags'),
    ]).then(([announcements, flags]) => {
      if (!active) return;
      if (announcements !== null) setPublicAnnouncements(parsePublicAnnouncements(announcements));
      if (flags !== null) setPublicFeatureFlags(parsePublicFeatureFlags(flags));
    });
    return () => { active = false; };
  }, []);

  const showDisabledFeature = useCallback((label: string) => {
    setSaveMessage(`${label}当前未开放`);
  }, []);

  const setIsSmartReduceModalOpen = useCallback((open: boolean) => {
    if (open && !publicFeatureFlags['public.smart_reducer']) {
      showDisabledFeature('智能省豆');
      return;
    }
    setRawSmartReduceModalOpen(open);
  }, [publicFeatureFlags, showDisabledFeature]);

  const guardedSetCurrentTab = useCallback<React.Dispatch<React.SetStateAction<StudioTab>>>((next) => {
    const tab = typeof next === 'function' ? next(currentTab) : next;
    const feature = tab === 'community'
      ? 'public.community'
      : tab === 'largeCanvas'
        ? 'public.large_canvas'
        : null;
    if (feature && !publicFeatureFlags[feature]) {
      showDisabledFeature(tab === 'community' ? '社区' : '大画板');
      return;
    }
    setCurrentTab(tab);
  }, [currentTab, publicFeatureFlags, showDisabledFeature]);

  const openSmartReduce = useCallback(() => {
    if (!publicFeatureFlags['public.smart_reducer']) {
      showDisabledFeature('智能省豆');
      return;
    }
    setIsSmartReduceModalOpen(true);
  }, [publicFeatureFlags, showDisabledFeature]);

  useEffect(() => {
    if (!publicFeatureFlags['public.smart_reducer'] && isSmartReduceModalOpen) {
      setIsSmartReduceModalOpen(false);
      showDisabledFeature('智能省豆');
    }
    if (currentTab === 'community' && !publicFeatureFlags['public.community']) {
      setCurrentTab('home');
      showDisabledFeature('社区');
    }
    if (currentTab === 'largeCanvas' && !publicFeatureFlags['public.large_canvas']) {
      setCurrentTab('home');
      showDisabledFeature('大画板');
    }
  }, [currentTab, isSmartReduceModalOpen, publicFeatureFlags, showDisabledFeature]);

  // Palette Lookup Map
  const paletteMap = useMemo(() => {
    return new Map(activePalette.map(c => [c.id, c]));
  }, [activePalette]);

  const largeCanvasPaletteOptions = useMemo(
    () => (Object.keys(BRAND_PALETTES) as BrandKey[]).map(id => ({ id, label: BRAND_NAMES[id] ?? id })),
    [],
  );

  // Sync palette when brand changes
  useEffect(() => {
    const brandColors = BRAND_PALETTES[brand] || BRAND_PALETTES.MARD;
    setActivePalette(brandColors);
    if (!selectedColor || !brandColors.some(c => c.id === selectedColor.id)) {
      setSelectedColor(brandColors[0]);
    }
  }, [brand]);

  // SettingsPanel and imported projects store the selected brand on settings.
  // Normalize that value into the App-level brand so conversion, palette maps,
  // large-canvas rendering, and export all consume the same palette.
  useEffect(() => {
    const requestedBrand = settings.brand;
    const resolvedBrand: BrandKey = requestedBrand && BRAND_PALETTES[requestedBrand]
      ? requestedBrand
      : 'MARD';
    if (brand !== resolvedBrand) setBrand(resolvedBrand);
    if (settings.brand !== resolvedBrand) {
      setSettings(previous => ({ ...previous, brand: resolvedBrand }));
    }
  }, [settings.brand, brand]);

  const commitGridHistory = useCallback((currentGrid: GridSnapshot, nextGrid: GridSnapshot) => {
    const nextHistoryState = commitHistorySnapshot(
      historyRef.current,
      historyIndexRef.current,
      currentGrid,
      nextGrid,
    );
    if (!nextHistoryState.changed) return false;

    historyRef.current = nextHistoryState.history;
    historyIndexRef.current = nextHistoryState.historyIndex;
    setHistory(nextHistoryState.history);
    setHistoryIndex(nextHistoryState.historyIndex);
    return true;
  }, []);

  const applyGridChange = useCallback((nextGrid: GridSnapshot, invalidateRequest = true) => {
    const currentGrid = gridRef.current;
    if (gridsEqual(currentGrid, nextGrid)) return false;

    if (invalidateRequest) invalidateImageRequest();
    gridRef.current = nextGrid;
    setGrid(nextGrid);

    if (historyTransactionRef.current) return true;
    commitGridHistory(currentGrid, nextGrid);
    return true;
  }, [commitGridHistory, invalidateImageRequest]);

  const beginHistoryTransaction = useCallback(() => {
    if (!historyTransactionRef.current) {
      historyTransactionRef.current = gridRef.current.map(row => [...row]);
    }
  }, []);

  const finishHistoryTransaction = useCallback(() => {
    const startGrid = historyTransactionRef.current;
    historyTransactionRef.current = null;
    if (!startGrid || gridsEqual(startGrid, gridRef.current)) return false;
    return commitGridHistory(startGrid, gridRef.current);
  }, [commitGridHistory]);

  // Handle Undo / Redo
  const handleUndo = useCallback(() => {
    const nextHistoryState = getUndoState(historyRef.current, historyIndexRef.current);
    if (!nextHistoryState) return false;

    const nextGrid = nextHistoryState.history[nextHistoryState.historyIndex];
    historyIndexRef.current = nextHistoryState.historyIndex;
    gridRef.current = nextGrid;
    setHistoryIndex(nextHistoryState.historyIndex);
    setGrid(nextGrid);
    return true;
  }, []);

  const handleRedo = useCallback(() => {
    const nextHistoryState = getRedoState(historyRef.current, historyIndexRef.current);
    if (!nextHistoryState) return false;

    const nextGrid = nextHistoryState.history[nextHistoryState.historyIndex];
    historyIndexRef.current = nextHistoryState.historyIndex;
    gridRef.current = nextGrid;
    setHistoryIndex(nextHistoryState.historyIndex);
    setGrid(nextGrid);
    return true;
  }, []);

  // Perform Image Pixel Conversion
  const convertImageToGrid = useCallback(
    (img: HTMLImageElement, currentSettings: ConvertSettings, currentPalette: BeadColor[], requestToken = beginImageRequest()) => {
      if (!isCurrentImageRequest(requestToken)) return;
      setIsConverting(true);
      setTimeout(() => {
        if (!isCurrentImageRequest(requestToken)) return;
        let targetW = currentSettings.width;
        let targetH = currentSettings.height;

        if (currentSettings.keepAspectRatio && img.width > 0 && img.height > 0) {
          const ratio = img.height / img.width;
          targetH = Math.max(10, Math.round(targetW * ratio));
          if (isCurrentImageRequest(requestToken)) {
            setSettings(s => ({ ...s, height: targetH }));
          }
        }

        try {
          const effectiveSettings = { ...currentSettings, width: targetW, height: targetH };
          const conversion = imageToGridWithDiagnostics(img, effectiveSettings, currentPalette);
          const newGrid = conversion.grid;

          if (isCurrentImageRequest(requestToken)) {
            applyGridChange(newGrid, false);
            setConversionDiagnostics(conversion.diagnostics);
            setAlignedPixels(conversion.alignedSourcePixels);
          }
        } catch (error) {
          if (isCurrentImageRequest(requestToken)) {
            setImageLoadMessage(error instanceof Error ? error.message : (isEn ? 'Image conversion failed. Your current grid is unchanged.' : '图像转换失败，当前图纸未改变。'));
          }
        } finally {
          finishImageRequest(requestToken);
        }
      }, 50);
    },
    [applyGridChange, beginImageRequest, finishImageRequest, isCurrentImageRequest, isEn]
  );

  // Re-convert on settings update if source image exists
  const handleReconvert = () => {
    if (sourceImage) {
      const requestToken = beginImageRequest();
      convertImageToGrid(sourceImage, settings, activePalette, requestToken);
    }
  };

  // Load Image File
  const handleImageUpload = (file: File) => {
    const requestToken = beginImageRequest();
    setActivePatternId(null);
    setIsConverting(true);
    const reader = new FileReader();
    reader.onload = evt => {
      if (!isCurrentImageRequest(requestToken)) return;
      if (evt.target?.result) {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          if (!isCurrentImageRequest(requestToken)) return;
          const safeSettings = resetBackgroundRemovalForNewImage(settings);
          setSourceImage(img);
          setProjectName(file.name.replace(/\.[^/.]+$/, ''));
          setSettings(safeSettings);
          convertImageToGrid(img, safeSettings, activePalette, requestToken);
          setCurrentTab('studio');
          setIsStudioModalOpen(true);
        };
        img.onerror = () => {
          finishImageRequest(requestToken);
        };
        img.src = evt.target.result as string;
      }
    };
    reader.onerror = () => {
      finishImageRequest(requestToken);
    };
    reader.readAsDataURL(file);
  };

  // Load Sample Preset Image
  const handleLoadSample = (sampleUrl: string, name = '安妮亚粉发眼镜示例拼豆') => {
    const requestToken = beginImageRequest();
    setImageLoadMessage(null);
    setIsConverting(true);
    setCurrentTab('studio');
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (!isCurrentImageRequest(requestToken)) return;
      setActivePatternId(null);
      setSourceImage(img);
      setProjectName(name);
      const presetSettings = { ...resetBackgroundRemovalForNewImage(settings), width: 79, height: 44 };
      setSettings(presetSettings);
      convertImageToGrid(img, presetSettings, activePalette, requestToken);
    };
    img.onerror = () => {
      if (isCurrentImageRequest(requestToken)) {
        setImageLoadMessage(isEn ? 'Unable to load this example. Your current grid is unchanged.' : '示例图片加载失败，当前图纸未改变。');
      }
      finishImageRequest(requestToken);
    };
    img.src = sampleUrl;
  };

  const cancelLargeCanvasPreprocess = useCallback(() => {
    const request = largeCanvasStudioRequestRef.current;
    if (!request) return;
    largeCanvasStudioRequestRef.current = null;
    setLargeCanvasStudioRequest(null);
    request.reject(new Error(LARGE_CANVAS_PREPROCESS_CANCELLED));
  }, []);

  const prepareLargeCanvasImage = useCallback((file: File): Promise<File> => {
    const previous = largeCanvasStudioRequestRef.current;
    if (previous) {
      previous.reject(new Error(LARGE_CANVAS_PREPROCESS_CANCELLED));
      setLargeCanvasStudioRequest(null);
    }

    const id = largeCanvasStudioRequestIdRef.current + 1;
    largeCanvasStudioRequestIdRef.current = id;
    return new Promise((resolve, reject) => {
      largeCanvasStudioRequestRef.current = { id, resolve, reject };
      const fail = (error: Error) => {
        if (largeCanvasStudioRequestRef.current?.id !== id) return;
        largeCanvasStudioRequestRef.current = null;
        setLargeCanvasStudioRequest(null);
        reject(error);
      };
      const reader = new FileReader();
      reader.onerror = () => fail(new Error('无法读取图片'));
      reader.onload = event => {
        if (largeCanvasStudioRequestRef.current?.id !== id) return;
        const imageUrl = typeof event.target?.result === 'string' ? event.target.result : null;
        if (!imageUrl) {
          fail(new Error('图片内容为空'));
          return;
        }
        const image = new Image();
        image.onload = () => {
          if (largeCanvasStudioRequestRef.current?.id !== id) return;
          setLargeCanvasStudioSettings({ ...settings, keepAspectRatio: false });
          setLargeCanvasStudioRequest({ id, sourceImage: image, fileName: file.name || 'large-canvas-source.png' });
        };
        image.onerror = () => fail(new Error('图片加载失败'));
        image.src = imageUrl;
      };
      reader.readAsDataURL(file);
    });
  }, [settings]);

  const applyLargeCanvasPreprocess = useCallback((_newGrid: (string | null)[][], updatedImage?: HTMLImageElement) => {
    const request = largeCanvasStudioRequestRef.current;
    const studioRequest = largeCanvasStudioRequest;
    if (!request || !studioRequest || request.id !== studioRequest.id) return;
    largeCanvasStudioRequestRef.current = null;
    setLargeCanvasStudioRequest(null);
    void imageElementToFile(updatedImage ?? studioRequest.sourceImage, studioRequest.fileName)
      .then(request.resolve)
      .catch(error => request.reject(error instanceof Error ? error : new Error('无法处理预览图片')));
  }, [largeCanvasStudioRequest]);

  const handleConvertLargeCanvasImage = useCallback((file: File, mode: LargeCanvasConversionMode, gridW: number, gridH: number): Promise<{ grid: (string | null)[][]; sourceImageDataUrl: string }> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('无法读取图片'));
      reader.onload = event => {
        const imageUrl = typeof event.target?.result === 'string' ? event.target.result : null;
        if (!imageUrl) {
          reject(new Error('图片内容为空'));
          return;
        }
        const img = new Image();
        img.onload = () => {
          try {
            const width = Math.max(1, Math.min(100, Math.round(gridW)));
            const height = Math.max(1, Math.min(100, Math.round(gridH)));
            const modeSettings = getLargeCanvasModeSettings(mode);
            const frameSettings = { ...settings, ...modeSettings, width, height, keepAspectRatio: false };
            const result = imageToGridWithDiagnostics(img, frameSettings, activePalette);
            // This stays in the active frame only; LargeCanvasView deliberately omits it from localStorage.
            resolve({ grid: result.grid, sourceImageDataUrl: imageUrl });
          } catch (error) {
            reject(error instanceof Error ? error : new Error('图片转换失败'));
          }
        };
        img.onerror = () => reject(new Error('图片加载失败'));
        img.src = imageUrl;
      };
      reader.readAsDataURL(file);
    });
  }, [activePalette, settings]);

  const handleOpenLargeCanvasFrame = useCallback((frame: LargeCanvasFrame) => {
    if (!frame.beanResult?.length || !frame.beanResult[0]?.length) return;
    invalidateImageRequest();
    setActivePatternId(null);
    setProjectName(frame.title);
    setSettings(current => ({ ...current, width: frame.rect.width, height: frame.rect.height, keepAspectRatio: false }));
    applyGridChange(frame.beanResult, false);
    setCurrentTab('studio');
    if (frame.sourceImageDataUrl) {
      const image = new Image();
      image.onload = () => setSourceImage(image);
      image.src = frame.sourceImageDataUrl;
    } else {
      setSourceImage(null);
    }
  }, [applyGridChange, invalidateImageRequest]);

  // Handle Reference Image Upload (for manual tracing / reference only)
  const handleReferenceImageUpload = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = evt => {
      if (evt.target?.result) {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          setSourceImage(img);
        };
        img.src = evt.target.result as string;
      }
    };
    reader.readAsDataURL(file);
  }, []);

  // Clear Canvas
  const handleClearCanvas = () => {
    setActivePatternId(null);
    const emptyGrid = Array.from({ length: settings.height }, () =>
      Array(settings.width).fill(null)
    );
    applyGridChange(emptyGrid);
  };

  const handleResetCurrentCanvas = useCallback(() => {
    invalidateImageRequest();
    historyTransactionRef.current = null;
    historyRef.current = [];
    historyIndexRef.current = -1;

    const resetState = resolveCanvasReset(true, gridRef.current);
    if (!resetState) return;

    gridRef.current = resetState.grid;
    setGrid(resetState.grid);
    setHistory(resetState.history);
    setHistoryIndex(resetState.historyIndex);
    setActivePatternId(null);
    setHighlightColorId(null);
    setReplaceSourceColor(null);
    setErasedColorCoords(new Map());
  }, [invalidateImageRequest]);

  // Interactive Painting on Cell Click/Drag / Flood Fill / Shapes
  const handleCellClick = (x: number, y: number) => {
    if (x < 0 || x >= settings.width || y < 0 || y >= settings.height) return;
    const currentGrid = gridRef.current;

    if (activeTool === 'pencil') {
      if (!selectedColor) return;
      const nextColorId = selectedColor.id;
      if (currentGrid[y][x] === nextColorId) return;

      const newGrid = currentGrid.map(row => [...row]);

      const applyPoint = (px: number, py: number) => {
        if (px >= 0 && px < settings.width && py >= 0 && py < settings.height) {
          newGrid[py][px] = nextColorId;
        }
      };

      // Apply with symmetry
      applyPoint(x, y);
      if (symmetryMode === 'horizontal' || symmetryMode === 'quad') {
        applyPoint(settings.width - 1 - x, y);
      }
      if (symmetryMode === 'vertical' || symmetryMode === 'quad') {
        applyPoint(x, settings.height - 1 - y);
      }
      if (symmetryMode === 'quad') {
        applyPoint(settings.width - 1 - x, settings.height - 1 - y);
      }

      applyGridChange(newGrid);
    } else if (activeTool === 'eraser') {
      if (currentGrid[y][x] === null) return;
      const newGrid = currentGrid.map(row => [...row]);

      const erasePoint = (px: number, py: number) => {
        if (px >= 0 && px < settings.width && py >= 0 && py < settings.height) {
          newGrid[py][px] = null;
        }
      };

      erasePoint(x, y);
      if (symmetryMode === 'horizontal' || symmetryMode === 'quad') {
        erasePoint(settings.width - 1 - x, y);
      }
      if (symmetryMode === 'vertical' || symmetryMode === 'quad') {
        erasePoint(x, settings.height - 1 - y);
      }
      if (symmetryMode === 'quad') {
        erasePoint(settings.width - 1 - x, settings.height - 1 - y);
      }

      applyGridChange(newGrid);
    } else if (activeTool === 'bucket') {
      if (!selectedColor) return;
      const targetColorId = currentGrid[y][x];
      const fillColorId = selectedColor.id;
      if (targetColorId === fillColorId) return;

      const newGrid = currentGrid.map(row => [...row]);
      const queue: [number, number][] = [[x, y]];
      const visited = new Set<string>();

      while (queue.length > 0) {
        const [cx, cy] = queue.pop()!;
        const key = `${cx},${cy}`;
        if (visited.has(key)) continue;
        visited.add(key);

        if (
          cx >= 0 &&
          cx < settings.width &&
          cy >= 0 &&
          cy < settings.height &&
          newGrid[cy][cx] === targetColorId
        ) {
          newGrid[cy][cx] = fillColorId;
          queue.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
        }
      }

      applyGridChange(newGrid);
    } else if (activeTool === 'replace') {
      const sourceId = currentGrid[y][x];
      if (sourceId) {
        const sourceBead = paletteMap.get(sourceId);
        if (sourceBead) setReplaceSourceColor(sourceBead);
      }
    }
  };

  // Shape creation handler from GridCanvas (Line / Rectangle / Circle)
  const handleApplyShape = (points: { x: number; y: number }[]) => {
    if (!selectedColor || points.length === 0) return;
    const colorId = selectedColor.id;
    const newGrid = gridRef.current.map(row => [...row]);

    const applyPoint = (px: number, py: number) => {
      if (px >= 0 && px < settings.width && py >= 0 && py < settings.height) {
        newGrid[py][px] = colorId;
      }
    };

    points.forEach(pt => {
      applyPoint(pt.x, pt.y);
      if (symmetryMode === 'horizontal' || symmetryMode === 'quad') {
        applyPoint(settings.width - 1 - pt.x, pt.y);
      }
      if (symmetryMode === 'vertical' || symmetryMode === 'quad') {
        applyPoint(pt.x, settings.height - 1 - pt.y);
      }
      if (symmetryMode === 'quad') {
        applyPoint(settings.width - 1 - pt.x, settings.height - 1 - pt.y);
      }
    });

    applyGridChange(newGrid);
  };

  // Replace all instances of sourceColorId with targetColorId or erase if TRANSPARENT_ERASE
  const handleExecuteReplace = (sourceId: string, targetId: string) => {
    const newGrid = gridRef.current.map(row =>
      row.map(cell => {
        if (cell === sourceId) {
          return targetId === 'TRANSPARENT_ERASE' ? null : targetId;
        }
        return cell;
      })
    );
    applyGridChange(newGrid);
  };

  // Erase all instances of a specific colorId
  const handleEraseColor = useCallback((colorId: string) => {
    const currentGrid = gridRef.current;
    const coords: [number, number][] = [];
    currentGrid.forEach((row, y) => {
      row.forEach((cell, x) => {
        if (cell === colorId) {
          coords.push([x, y]);
        }
      });
    });

    if (coords.length > 0) {
      setErasedColorCoords(prev => {
        const next = new Map<string, [number, number][]>(prev);
        const existing = next.get(colorId) || [];
        next.set(colorId, [...existing, ...coords]);
        return next;
      });

      const newGrid = currentGrid.map(row =>
        row.map(cell => (cell === colorId ? null : cell))
      );
      applyGridChange(newGrid);
    }
  }, [applyGridChange]);

  // Restore an erased color back to the grid
  const handleRestoreColor = useCallback((colorId: string) => {
    const coords = erasedColorCoords.get(colorId);

    if (coords && coords.length > 0) {
      const newGrid = gridRef.current.map(row => [...row]);
      for (const [x, y] of coords) {
        if (y < newGrid.length && x < newGrid[y].length && newGrid[y][x] === null) {
          newGrid[y][x] = colorId;
        }
      }
      applyGridChange(newGrid);
    }

    setErasedColorCoords(prev => {
      const next = new Map<string, [number, number][]>(prev);
      next.delete(colorId);
      return next;
    });

    const restoredColor = paletteMap.get(colorId);
    if (restoredColor) {
      setSelectedColor(restoredColor);
    }
  }, [applyGridChange, erasedColorCoords, paletteMap]);

  // Flood-fill clear connected outer background beads starting from grid edges.
  const handleClearOuterBackground = useCallback(() => {
    const currentGrid = gridRef.current;
    const h = settings.height;
    const w = settings.width;
    if (h === 0 || w === 0) return;

    const newGrid = currentGrid.map(row => [...row]);
    const visited = Array.from({ length: h }, () => Array(w).fill(false));

    const sampleColorIds = new Set<string>();
    const edgeCoords = [
      [0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1],
      [Math.floor(w / 2), 0], [Math.floor(w / 2), h - 1],
      [0, Math.floor(h / 2)], [w - 1, Math.floor(h / 2)],
    ];
    for (const [cx, cy] of edgeCoords) {
      const colorId = currentGrid[cy]?.[cx];
      if (colorId) sampleColorIds.add(colorId);
    }

    if (sampleColorIds.size === 0) return;

    const queue: [number, number][] = [];
    for (let x = 0; x < w; x++) {
      if (currentGrid[0][x] && sampleColorIds.has(currentGrid[0][x]!)) {
        queue.push([x, 0]);
        visited[0][x] = true;
      }
      if (currentGrid[h - 1][x] && sampleColorIds.has(currentGrid[h - 1][x]!)) {
        queue.push([x, h - 1]);
        visited[h - 1][x] = true;
      }
    }
    for (let y = 0; y < h; y++) {
      if (currentGrid[y][0] && sampleColorIds.has(currentGrid[y][0]!)) {
        queue.push([0, y]);
        visited[y][0] = true;
      }
      if (currentGrid[y][w - 1] && sampleColorIds.has(currentGrid[y][w - 1]!)) {
        queue.push([w - 1, y]);
        visited[y][w - 1] = true;
      }
    }

    const clearedByColor = new Map<string, [number, number][]>();
    while (queue.length > 0) {
      const [cx, cy] = queue.shift()!;
      const currentColor = currentGrid[cy][cx];
      if (currentColor) {
        const coords = clearedByColor.get(currentColor) || [];
        coords.push([cx, cy]);
        clearedByColor.set(currentColor, coords);
      }
      newGrid[cy][cx] = null;

      for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1]]) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (
          nx >= 0 && nx < w && ny >= 0 && ny < h && !visited[ny][nx] &&
          currentGrid[ny][nx] && currentGrid[ny][nx] === currentColor
        ) {
          visited[ny][nx] = true;
          queue.push([nx, ny]);
        }
      }
    }

    if (clearedByColor.size === 0) return;
    setErasedColorCoords(prev => {
      const next = new Map<string, [number, number][]>(prev);
      clearedByColor.forEach((coords, colorId) => {
        next.set(colorId, [...(next.get(colorId) || []), ...coords]);
      });
      return next;
    });
    applyGridChange(newGrid);
  }, [applyGridChange, settings]);

  // Export & Import Project JSON
  const handleExportJson = () => {
    if (!requireFormalLogin(isEn ? 'Sign in before downloading project files.' : '请先登录，再下载工程文件。')) return;
    const project: ProjectData = {
      version: '1.0',
      name: projectName,
      width: settings.width,
      height: settings.height,
      boardSize: settings.boardSize,
      brand,
      grid,
      createdAt: new Date().toISOString(),
    };

    const jsonStr = JSON.stringify(project, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = `${projectName}.perler`;
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleImportJson = (jsonStr: string) => {
    try {
      const project: ProjectData = JSON.parse(jsonStr);
      if (project.grid && Array.isArray(project.grid)) {
        invalidateImageRequest();
        setActivePatternId(null);
        setProjectName(project.name || '导入的拼豆项目');
        setBrand(project.brand || 'MARD');
        setSettings(s => ({
          ...s,
          width: project.width || project.grid[0].length,
          height: project.height || project.grid.length,
          boardSize: project.boardSize || 29,
        }));
        applyGridChange(project.grid, false);
      }
    } catch {
      alert('解析拼豆工程文件失败，请确保格式正确');
    }
  };

  const handleRestorePattern = (project: EditablePatternProject): void => {
    invalidateImageRequest();
    setActivePatternId(project.workId);
    setProjectName(project.name);
    setBrand(project.brand);
    setActivePalette(project.palette);
    setSettings((current) => ({
      ...current,
      width: project.width,
      height: project.height,
      boardSize: project.boardSize,
      brand: project.brand,
    }));
    setSettings({ ...project.settings });
    const restoredGrid = project.grid.map((row) => [...row]);
    applyGridChange(restoredGrid, false);
  };

  const handleSaveCurrentPattern = async (title: string): Promise<void> => {
    if (!requireFormalLogin(isEn ? 'Sign in before saving patterns.' : '请先登录，再保存图纸。')) return;
    if (isSavingPattern || saveSubmissionRef.current) return;
    saveSubmissionRef.current = true;
    setIsSavingPattern(true);
    setSaveMessage(null);
    const totalBeads = gridRef.current.reduce((total, row) => total + row.filter((cell) => cell !== null).length, 0);
    try {
      const record = await saveExportedPatternRecord({
        id: activePatternId ?? undefined,
        userId: currentUser?.uid ?? null,
        title,
        width: settings.width,
        height: settings.height,
        totalBeads,
        boardSize: settings.boardSize,
        brand,
        settings,
        grid: gridRef.current,
        palette: activePalette,
      });
      setActivePatternId(record.id);
      setSaveMessage(currentUser
        ? (record.syncState === 'synced' ? (isEn ? 'Saved to your private cloud gallery.' : '已保存到云端私有图库。') : (isEn ? 'Saved locally. Cloud sync can be retried from your gallery.' : '已保存到本地，云端同步可在图库重试。'))
        : (isEn ? 'Saved to this browser only.' : '已保存到当前浏览器本地图库。'));
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : (isEn ? 'Save failed. Your canvas is unchanged.' : '保存失败，当前画板未改变。'));
    } finally {
      saveSubmissionRef.current = false;
      setIsSavingPattern(false);
    }
  };

  const openSaveNameDialog = (): void => {
    if (!requireFormalLogin(isEn ? 'Sign in before saving patterns.' : '请先登录，再保存图纸。')) return;
    if (isSavingPattern) return;
    setSaveNameInput((projectName.trim() || (isEn ? 'Perler Pattern' : '我的拼豆图纸')).slice(0, 60));
    setSaveNameError(null);
    setIsSaveNameDialogOpen(true);
  };

  const confirmSaveCurrentPattern = (): void => {
    if (!requireFormalLogin(isEn ? 'Sign in before saving patterns.' : '请先登录，再保存图纸。')) {
      setIsSaveNameDialogOpen(false);
      return;
    }
    const title = saveNameInput.trim();
    if (!title) {
      setSaveNameError(isEn ? 'Enter a pattern name.' : '请输入作品名称');
      return;
    }
    if (title.length > 60) {
      setSaveNameError(isEn ? 'Use 60 characters or fewer.' : '作品名称不能超过 60 个字符');
      return;
    }
    setProjectName(title);
    setIsSaveNameDialogOpen(false);
    void handleSaveCurrentPattern(title);
  };

  const openExportModal = (): void => {
    if (!requireFormalLogin(isEn ? 'Sign in before downloading patterns.' : '请先登录，再导出图纸。')) return;
    setIsExportModalOpen(true);
  };

  // Keyboard Shortcuts (P, B, I, E, R, Ctrl+Z, Ctrl+Y)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      if (e.ctrlKey || e.metaKey) {
        if (e.key.toLowerCase() === 'z') {
          e.preventDefault();
          if (e.shiftKey) handleRedo();
          else handleUndo();
        } else if (e.key.toLowerCase() === 'y') {
          e.preventDefault();
          handleRedo();
        }
        return;
      }

      const key = e.key.toLowerCase();
      if (key === 'p') setActiveTool('pencil');
      else if (key === 'h') setActiveTool('hand');
      else if (key === 'b') setActiveTool('bucket');
      else if (key === 'i') setActiveTool('eyedropper');
      else if (key === 'e') setActiveTool('eraser');
      else if (key === 'r') setActiveTool('replace');
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo, handleRedo]);

  const handleImportPattern = useCallback(() => {
    if (!requireFormalLogin(isEn ? 'Sign in before opening your library.' : '请先登录，再打开我的图库。')) return;
    setCurrentTab('studio');
    setTimeout(() => {
      openUserPatternsModal();
    }, 100);
  }, [isEn, openUserPatternsModal, requireFormalLogin]);

  const handleRemixPattern = useCallback((pattern: CommunityPattern) => {
    setProjectName(pattern.title);
    setSettings(prev => ({
      ...prev,
      width: pattern.width,
      height: pattern.height,
    }));
    setCurrentTab('studio');
    if (pattern.imageUrl) {
      handleLoadSample(pattern.imageUrl);
    }
  }, [handleLoadSample]);

  const activeAnnouncement = publicAnnouncements.find(item => !dismissedAnnouncementIds.has(item.id)) ?? null;

  return (
    <div className="flex flex-col h-screen bg-[#F5F0FD] font-sans text-purple-950 overflow-hidden">
      {/* Top Main Navigation Header */}
      <Header
        projectName={projectName}
        setProjectName={setProjectName}
        onImageUpload={handleImageUpload}
        onLoadSample={handleLoadSample}
        onExportJson={handleExportJson}
        onImportJson={handleImportJson}
        onOpenExportModal={openExportModal}
        onOpenGuideModal={() => setIsGuideModalOpen(true)}
        onOpenSmartReduceModal={() => setIsSmartReduceModalOpen(true)}
        onOpenPatternsModal={openUserPatternsModal}
        onOpenPaletteModal={() => setIsPaletteModalOpen(true)}
        onOpenAuthModal={() => setIsAuthModalOpen(true)}
        onOpenUserProfileModal={() => setIsUserProfileModalOpen(true)}
        onOpenVipModal={() => setIsVipModalOpen(true)}
        onClearCanvas={handleClearCanvas}
        currentTab={currentTab}
        setCurrentTab={guardedSetCurrentTab}
        onImportPattern={handleImportPattern}
      />

      {activeAnnouncement && (
        <aside role="status" className="mx-3 mt-2 flex min-w-0 shrink-0 items-start gap-2 border border-sky-200 bg-sky-50 px-3 py-2 text-sky-950 sm:mx-5 sm:px-4" aria-label="系统公告">
          <div className="min-w-0 flex-1"><p className="truncate text-xs font-bold">{activeAnnouncement.pinned ? '置顶公告 · ' : '公告 · '}{activeAnnouncement.title}</p><p className="mt-0.5 line-clamp-2 break-words text-xs leading-5 text-sky-800">{activeAnnouncement.content}</p></div>
          <button type="button" title="关闭公告" aria-label="关闭公告" onClick={() => setDismissedAnnouncementIds(current => new Set([...current, activeAnnouncement.id]))} className="grid h-8 w-8 shrink-0 place-items-center text-sky-700 hover:bg-sky-100 hover:text-sky-950"><X className="h-4 w-4" /></button>
        </aside>
      )}

      {currentTab === 'home' && (
        <HomeView
          onNavigateTab={guardedSetCurrentTab}
          onStartPhotoToBead={handleImageUpload}
          onLoadHeroExample={(example: HeroExample) => handleLoadSample(example.url, example.name)}
          onImportPattern={handleImportPattern}
        />
      )}

      {currentTab === 'community' && (
        <DeferredFeatureBoundary label="社区" surface="page" onDismiss={() => setCurrentTab('home')}>
          <Suspense fallback={<DeferredFeaturePageLoading label="社区" />}>
            <CommunityView
              onRemixPattern={handleRemixPattern}
              onNavigateToStudio={() => setCurrentTab('studio')}
              onOpenAuthModal={() => setIsAuthModalOpen(true)}
            />
          </Suspense>
        </DeferredFeatureBoundary>
      )}

      {currentTab === 'largeCanvas' && (
        <DeferredFeatureBoundary label="大画板" surface="page" onDismiss={() => setCurrentTab('home')}>
          <Suspense fallback={<DeferredFeaturePageLoading label="大画板" />}>
            <LargeCanvasView
              paletteMap={paletteMap}
              brandName={BRAND_NAMES[brand]}
              paletteOptions={largeCanvasPaletteOptions}
              selectedPaletteId={brand}
              onChangePalette={paletteId => {
                const nextBrand = paletteId as BrandKey;
                if (!BRAND_PALETTES[nextBrand]) return;
                setBrand(nextBrand);
                setActivePalette(BRAND_PALETTES[nextBrand]);
                setSettings(current => ({ ...current, brand: nextBrand }));
              }}
              beadShape={beadShape}
              onChangeBeadShape={setBeadShape}
              canvasBackdrop={canvasBackdrop}
              onChangeCanvasBackdrop={setCanvasBackdrop}
              showGridLines={showGridLines}
              onChangeShowGridLines={setShowGridLines}
              showCodeLabels={showLargeCodeLabels}
              onChangeShowCodeLabels={setShowLargeCodeLabels}
              showDataPreview={showLargeDataPreview}
              onChangeShowDataPreview={setShowLargeDataPreview}
              conversionSettings={{
                quantizationStrength: settings.quantizationStrength,
                sharpening: settings.sharpening,
                backgroundRemovalEnabled: settings.backgroundRemovalEnabled,
                dither: settings.dither,
                colorMatchAlgo: settings.colorMatchAlgo,
              }}
              onChangeConversionSettings={updates => setSettings(current => ({ ...current, ...updates }))}
              onConvertImage={handleConvertLargeCanvasImage}
              onPrepareImage={prepareLargeCanvasImage}
              onOpenFrame={handleOpenLargeCanvasFrame}
            />
          </Suspense>
        </DeferredFeatureBoundary>
      )}

      {currentTab === 'studio' && (
        <>
      <Toolbar
        activeTool={activeTool}
        setActiveTool={setActiveTool}
        selectedColor={selectedColor}
        onOpenColorPicker={() => setIsPaletteModalOpen(true)}
        canUndo={historyIndex > 0}
        canRedo={historyIndex < history.length - 1}
        onUndo={handleUndo}
        onRedo={handleRedo}
        zoom={zoom}
        onZoomIn={() => setZoom(z => Math.min(4.0, z * 1.15))}
        onZoomOut={() => setZoom(z => Math.max(0.1, z * 0.85))}
        onResetZoom={() => setZoom(1.0)}
        beadShape={beadShape}
        setBeadShape={setBeadShape}
        showSymbols={showSymbols}
        setShowSymbols={setShowSymbols}
        showGridLines={showGridLines}
        setShowGridLines={setShowGridLines}
        showCoordinates={showCoordinates}
        setShowCoordinates={setShowCoordinates}
        symmetryMode={symmetryMode}
        setSymmetryMode={setSymmetryMode}
        canvasBackdrop={canvasBackdrop}
        setCanvasBackdrop={setCanvasBackdrop}
        onClearOuterBackground={handleClearOuterBackground}
        hasImage={sourceImage !== null}
        showOverlay={showOverlay}
        setShowOverlay={setShowOverlay}
        onSavePattern={openSaveNameDialog}
        isSavingPattern={isSavingPattern}
        onOpenExport={openExportModal}
        canExport={grid.some(row => row.some(colorId => colorId !== null))}
      />

      {/* Main Workspace: Left Settings, Center Grid Canvas, Right Stats */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Mobile Backdrop Overlay for Side Drawers */}
        {mobileDrawer !== 'none' && (
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-xs z-30 lg:hidden transition-opacity"
            onClick={() => setMobileDrawer('none')}
          />
        )}

        {/* Left Panel: Conversion Settings (Desktop sidebar + Mobile drawer) */}
        <div
          className={`h-full transition-transform duration-300 ease-in-out z-40 ${
            mobileDrawer === 'settings'
              ? 'fixed inset-y-0 left-0 max-w-[85vw] shadow-2xl block'
              : 'hidden lg:block'
          }`}
        >
          <SettingsPanel
            settings={settings}
            setSettings={setSettings}
            conversionDiagnostics={conversionDiagnostics}
            onReconvert={handleReconvert}
            hasImage={sourceImage !== null}
            onOpenImageStudio={() => {
              setMobileDrawer('none');
              setIsStudioModalOpen(true);
            }}
            onCloseMobile={() => setMobileDrawer('none')}
          />
        </div>

        {/* Center Canvas Area */}
        <div className="flex-1 h-full relative min-w-0">
          <GridCanvas
            grid={grid}
            paletteMap={paletteMap}
            width={settings.width}
            height={settings.height}
            boardSize={settings.boardSize}
            activeTool={activeTool}
            setActiveTool={setActiveTool}
            selectedColor={selectedColor}
            highlightColorId={highlightColorId}
            beadShape={beadShape}
            showSymbols={showSymbols}
            showGridLines={showGridLines}
            showCoordinates={showCoordinates}
            canvasBackdrop={canvasBackdrop}
            symmetryMode={symmetryMode}
            sourceImage={sourceImage}
            showOverlay={showOverlay}
            zoom={zoom}
            setZoom={setZoom}
            onCellClick={handleCellClick}
            onHistoryTransactionStart={beginHistoryTransaction}
            onHistoryTransactionEnd={finishHistoryTransaction}
            onApplyShape={handleApplyShape}
            onEyedropColor={color => setSelectedColor(color)}
            onReferenceImageUpload={handleReferenceImageUpload}
            onResetCanvas={handleResetCurrentCanvas}
          />

          {/* Loading Animation Overlay */}
          {isConverting && (
            <div className="absolute inset-0 bg-purple-950/20 backdrop-blur-xs z-30 flex flex-col items-center justify-center gap-3 transition-opacity duration-200">
              <div className="relative flex items-center justify-center">
                <div className="w-14 h-14 rounded-full border-4 border-purple-600/20 border-t-purple-600 animate-spin" />
                <div className="w-8 h-8 rounded-full border-2 border-purple-400/30 border-b-purple-400 animate-spin absolute" style={{ animationDirection: 'reverse', animationDuration: '0.8s' }} />
                <Sparkles className="w-5 h-5 text-purple-600 absolute animate-pulse" />
              </div>
              <div className="text-xs font-extrabold text-purple-950 flex items-center gap-2 bg-white/95 border border-purple-200 px-4 py-2 rounded-full shadow-lg">
                <span className="w-2 h-2 rounded-full bg-purple-600 animate-ping" />
                <span>{isEn ? 'Quantizing beads & matching colors...' : '✨ 正在精准计算拼豆像素与色卡匹配...'}</span>
              </div>
            </div>
          )}
        </div>

        {/* Right Panel: Color Statistics (Desktop sidebar + Mobile drawer) */}
        <div
          className={`h-full transition-transform duration-300 ease-in-out z-40 ${
            mobileDrawer === 'stats'
              ? 'fixed inset-y-0 right-0 max-w-[85vw] shadow-2xl block'
              : 'hidden lg:block'
          }`}
        >
          <StatsPanel
            grid={grid}
            paletteMap={paletteMap}
            width={settings.width}
            height={settings.height}
            boardSize={settings.boardSize}
            highlightColorId={highlightColorId}
            onSetHighlightColorId={setHighlightColorId}
            onOpenReplaceModal={color => setReplaceSourceColor(color)}
            onSelectColor={color => setSelectedColor(color)}
            onEraseColor={handleEraseColor}
            onRestoreColor={handleRestoreColor}
            erasedColorCoords={erasedColorCoords}
            onCloseMobile={() => setMobileDrawer('none')}
          />
        </div>
      </div>

      {/* Mobile Bottom Navigation Bar (< lg screens) */}
      <nav className="lg:hidden bg-white/95 border-t border-purple-200/90 backdrop-blur-md px-1.5 py-1.5 flex items-center justify-around z-30 shrink-0 text-[10px]">
        <button
          onClick={() => setMobileDrawer('none')}
          className={`flex flex-col items-center justify-center gap-0.5 min-h-12 min-w-12 py-1 px-2 rounded-xl transition-all cursor-pointer ${
            mobileDrawer === 'none'
              ? 'text-purple-900 font-bold bg-purple-100 border border-purple-300 shadow-2xs'
              : 'text-purple-600 hover:text-purple-900'
          }`}
        >
          <LayoutGrid className="w-3.5 h-3.5" />
          <span>{isEn ? 'Canvas' : '画布'}</span>
        </button>

        <button
          onClick={() => setMobileDrawer(mobileDrawer === 'settings' ? 'none' : 'settings')}
          className={`flex flex-col items-center justify-center gap-0.5 min-h-12 min-w-12 py-1 px-2 rounded-xl transition-all cursor-pointer ${
            mobileDrawer === 'settings'
              ? 'text-purple-900 font-bold bg-purple-100 border border-purple-300 shadow-2xs'
              : 'text-purple-600 hover:text-purple-900'
          }`}
        >
          <Sliders className="w-3.5 h-3.5" />
          <span>{isEn ? 'Settings' : '设置'}</span>
        </button>

        <button
          onClick={() => setMobileDrawer(mobileDrawer === 'stats' ? 'none' : 'stats')}
          className={`flex flex-col items-center justify-center gap-0.5 min-h-12 min-w-12 py-1 px-2 rounded-xl transition-all cursor-pointer ${
            mobileDrawer === 'stats'
              ? 'text-emerald-900 font-bold bg-emerald-100 border border-emerald-300 shadow-2xs'
              : 'text-purple-600 hover:text-purple-900'
          }`}
        >
          <BarChart3 className="w-3.5 h-3.5" />
          <span>{isEn ? 'Stats' : '用量'}</span>
        </button>

        <button
          onClick={openSmartReduce}
          className="flex flex-col items-center justify-center gap-0.5 min-h-12 min-w-12 py-1 px-2 rounded-xl text-amber-800 hover:text-amber-950 font-bold transition-all cursor-pointer bg-amber-50 border border-amber-200"
          title={isEn ? 'Feature-preserving bead saver' : '特征保真智能省豆'}
        >
          <Zap className="w-3.5 h-3.5 text-amber-500 fill-amber-400 animate-pulse" />
          <span>{isEn ? 'Save' : '省豆'}</span>
        </button>

        <button
          onClick={openSaveNameDialog}
          disabled={isSavingPattern}
          className="flex flex-col items-center justify-center gap-0.5 min-h-12 min-w-12 py-1 px-2 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:opacity-60 text-white font-bold transition-all cursor-pointer shadow-xs active:scale-95"
        >
          {isSavingPattern ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          <span>{isEn ? 'Save' : '保存'}</span>
        </button>

        <button
          onClick={openExportModal}
          className="flex flex-col items-center justify-center gap-0.5 min-h-12 min-w-12 py-1 px-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl transition-all cursor-pointer shadow-xs active:scale-95"
        >
          <Download className="w-3.5 h-3.5" />
          <span>{isEn ? 'Export' : '导出'}</span>
        </button>
      </nav>
      {saveMessage && (
        <div className="fixed bottom-20 left-1/2 z-50 -translate-x-1/2 rounded-md border border-sky-300 bg-white px-3 py-2 text-xs font-medium text-sky-950 shadow-lg">
          {saveMessage}
        </div>
      )}
      {imageLoadMessage && (
        <div role="status" className="fixed bottom-20 left-1/2 z-50 max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-md border border-rose-300 bg-white px-3 py-2 text-xs font-medium text-rose-900 shadow-lg">
          {imageLoadMessage}
        </div>
      )}
      </>
      )}

      {/* Modals */}
      <PaletteManagerModal
        isOpen={isPaletteModalOpen}
        onClose={() => setIsPaletteModalOpen(false)}
        brand={brand}
        activePalette={activePalette}
        setActivePalette={setActivePalette}
        onSelectColor={color => setSelectedColor(color)}
      />

      <ExportModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        grid={grid}
        paletteMap={paletteMap}
        width={settings.width}
        height={settings.height}
        boardSize={settings.boardSize}
        brandName={brand}
        projectName={projectName}
        beadShape={beadShape}
        activePalette={activePalette}
        activePatternId={activePatternId}
        settings={settings}
        onPatternArchived={setActivePatternId}
        onOpenAuthModal={() => setIsAuthModalOpen(true)}
      />

      <ColorReplaceModal
        isOpen={replaceSourceColor !== null}
        onClose={() => setReplaceSourceColor(null)}
        sourceColor={replaceSourceColor}
        activePalette={activePalette}
        onExecuteReplace={handleExecuteReplace}
      />

      <UserGuideModal
        isOpen={isGuideModalOpen}
        onClose={() => setIsGuideModalOpen(false)}
      />

      {isSaveNameDialogOpen && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-purple-200 bg-white p-5 shadow-2xl">
            <h2 className="text-base font-black text-purple-950">保存作品</h2>
            <p className="mt-1 text-xs text-purple-600">为图纸命名后保存到你的图库。</p>
            <label className="mt-4 block text-xs font-bold text-purple-900">
              作品名称
              <input
                autoFocus
                maxLength={60}
                value={saveNameInput}
                onChange={event => {
                  setSaveNameInput(event.target.value);
                  if (saveNameError) setSaveNameError(null);
                }}
                onKeyDown={event => {
                  if (event.key === 'Enter') confirmSaveCurrentPattern();
                }}
                className="mt-1.5 w-full rounded-xl border border-purple-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-purple-500/30"
                placeholder="例如：我的向日葵拼豆图"
                disabled={isSavingPattern}
              />
            </label>
            <div className="mt-1 flex justify-between text-[11px] text-purple-500">
              <span>必填，1-60 个字符</span>
              <span>{saveNameInput.trim().length}/60</span>
            </div>
            {saveNameError && <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{saveNameError}</p>}
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setIsSaveNameDialogOpen(false)}
                disabled={isSavingPattern}
                className="rounded-xl border border-purple-200 px-4 py-2.5 text-xs font-bold text-purple-800 transition-colors hover:bg-purple-50 disabled:opacity-60"
              >
                取消
              </button>
              <button
                type="button"
                onClick={confirmSaveCurrentPattern}
                disabled={isSavingPattern}
                className="rounded-xl bg-purple-600 px-4 py-2.5 text-xs font-bold text-white transition-colors hover:bg-purple-700 disabled:opacity-60"
              >
                确认保存
              </button>
            </div>
          </div>
        </div>
      )}

      {isSmartReduceModalOpen && (
        <DeferredFeatureBoundary label="智能省豆" surface="modal" onDismiss={() => setIsSmartReduceModalOpen(false)}>
          <Suspense fallback={<DeferredFeatureModalLoading label="智能省豆" />}>
            <SmartBeadReducerModal
              isOpen={isSmartReduceModalOpen}
              onClose={() => setIsSmartReduceModalOpen(false)}
              grid={grid}
              palette={activePalette}
              onApplyReducedGrid={(newGrid) => {
                invalidateImageRequest();
                applyGridChange(newGrid, false);
                setSettings(s => ({
                  ...s,
                  width: newGrid[0]?.length || s.width,
                  height: newGrid.length || s.height,
                }));
              }}
              onOpenAuthModal={() => setIsAuthModalOpen(true)}
            />
          </Suspense>
        </DeferredFeatureBoundary>
      )}

      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onOpenAdminPanel={() => window.location.assign('/admin')}
        onOpenPatternsModal={openUserPatternsModal}
      />

      <UserProfileModal
        isOpen={isUserProfileModalOpen}
        onClose={() => setIsUserProfileModalOpen(false)}
        onOpenAccountManagement={() => setIsAccountManagementModalOpen(true)}
        onOpenVipModal={() => setIsVipModalOpen(true)}
        onSelectPattern={handleRemixPattern}
        onContinueEditing={handleRestorePattern}
      />

      <AccountManagementModal
        isOpen={isAccountManagementModalOpen}
        onClose={() => setIsAccountManagementModalOpen(false)}
        onOpenVipModal={() => setIsVipModalOpen(true)}
      />

      {isUserPatternsModalOpen && hasFormalLogin && (
        <DeferredFeatureBoundary label="我的图库" surface="modal" onDismiss={() => setIsUserPatternsModalOpen(false)}>
          <Suspense fallback={<DeferredFeatureModalLoading label="我的图库" />}>
            <UserPatternsModal
              isOpen={isUserPatternsModalOpen}
              onClose={() => setIsUserPatternsModalOpen(false)}
              onContinueEditing={handleRestorePattern}
              onOpenCommunity={() => {
                if (!publicFeatureFlags['public.community']) {
                  showDisabledFeature('社区');
                  return;
                }
                setIsUserPatternsModalOpen(false);
                setCurrentTab('community');
              }}
              onOpenAuthModal={() => setIsAuthModalOpen(true)}
            />
          </Suspense>
        </DeferredFeatureBoundary>
      )}

      <VipPrivilegesModal
        isOpen={isVipModalOpen}
        onClose={() => setIsVipModalOpen(false)}
        onOpenAuthModal={() => setIsAuthModalOpen(true)}
      />

      {sourceImage && (
        <ImageStudioModal
          isOpen={isStudioModalOpen}
          onClose={() => setIsStudioModalOpen(false)}
          sourceImage={sourceImage}
          settings={settings}
          setSettings={setSettings}
          activePalette={activePalette}
          onApplyConversion={(newGrid, updatedImg) => {
            invalidateImageRequest();
            if (updatedImg) {
              setSourceImage(updatedImg);
            }
            applyGridChange(newGrid, false);
          }}
        />
      )}

      {largeCanvasStudioRequest && (
        <ImageStudioModal
          isOpen
          onClose={cancelLargeCanvasPreprocess}
          sourceImage={largeCanvasStudioRequest.sourceImage}
          settings={largeCanvasStudioSettings}
          setSettings={setLargeCanvasStudioSettings}
          activePalette={activePalette}
          onApplyConversion={applyLargeCanvasPreprocess}
        />
      )}
    </div>
  );
}

export default function App() {
  return /^\/admin(?:\/|$)/.test(window.location.pathname)
    ? <Suspense fallback={<AdminPageLoading />}><AdminPage /></Suspense>
    : <StudioApp />;
}
