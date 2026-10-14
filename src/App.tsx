import React, { Suspense, lazy, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Bell, Loader2, RefreshCw, X } from 'lucide-react';
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
import {
  consolidateStrayBeans,
  type StrayBeanStrength,
} from './utils/strayBeanConsolidation';

import { Header } from './components/Header';
import { MobileHeaderNav } from './components/mobile/MobileHeaderNav';
import { MobileBottomNav } from './components/mobile/MobileBottomNav';
import { DesktopWorkspace } from './components/desktop/DesktopWorkspace';
import { PatternDetailsUnlockContext } from './components/StatsPanel';
import { MobileWorkspace } from './components/mobile/MobileWorkspace';
import { useIsDesktop } from './hooks/useIsDesktop';
import { PaletteManagerModal } from './components/PaletteManagerModal';
import { ExportModal } from './components/ExportModal';
import { ColorReplaceModal } from './components/ColorReplaceModal';
import { ImageStudioModal } from './components/ImageStudioModal';
import { CompletionSummary } from './components/CompletionSummary';
import { UserGuideModal } from './components/UserGuideModal';
import { AuthModal } from './components/AuthModal';
import { VipPrivilegesModal } from './components/VipPrivilegesModal';
import { UserProfileModal } from './components/UserProfileModal';
import { AccountManagementModal } from './components/AccountManagementModal';
import { HomeView, type HeroExample } from './components/HomeView';
import { LandingView } from './components/LandingView';
import { PublicAnnouncementModal } from './components/PublicAnnouncementModal';
import { useAnnouncements } from './hooks/useAnnouncements';
import type { LargeCanvasCreditUsage, LargeCanvasFrame, LargeCanvasViewHandle } from './components/LargeCanvasView';
import { getLargeCanvasModeSettings, type LargeCanvasConversionMode } from './utils/largeCanvas';
import type { CommunityPattern } from './data/communityData';
import {
  getPatternProject,
  getUserExportedPatterns,
  markLegacyByWorkKeys,
  saveExportedPatternRecord,
  type EditablePatternProject,
  type ExportedPatternRecord,
} from './utils/patternHistory';
import { toggleCompletedColorId } from './utils/completionHighlight';
import { apiCompletePattern, apiImportLegacyPatterns, apiQuotePatternCompletion } from './utils/api';

const LARGE_CANVAS_PREPROCESS_CANCELLED = '图片预处理已取消';

type PatternCompletionStatus = 'DRAFT' | 'QUOTING' | 'AWAITING_CONFIRMATION' | 'COMPLETING' | 'COMPLETED' | 'LEGACY';

interface PatternCompletionInput {
  workKey: string;
  sourceHash: string;
  width: number;
  height: number;
  occupancyBase64: string;
  savingTarget: 15 | 25 | 40;
}

interface PatternCompletionQuote {
  pricingVersion: string;
  nonEmptyBeads: number;
  baseUnits: number;
  totalUnits: number;
  /** Legacy Worker response field (credit units, not points). */
  additionalUnits?: number;
  /** Current Worker response fields. Values are already converted to points. */
  currentTotalPoints?: number;
  upgradeDuePoints?: number;
  chargedPoints?: number;
  paidPoints?: number;
  paidUnits?: number;
  beadSavingLevel?: number;
  savingTarget?: number;
  beadSavingMultiplierBps: number;
  membershipDiscountBps: number;
  entitlement?: {
    status: string;
    paidUnits: number;
    paidNonEmptyBeads: number;
    paidBeadSavingLevel: number;
    gridHash: string;
  };
}

interface CompletionQuoteState {
  input: PatternCompletionInput;
  quote: PatternCompletionQuote;
  idempotencyKey: string;
}

function formatCreditPoints(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function getCompletionChargePoints(quote: PatternCompletionQuote): number | null {
  // `upgradeDuePoints` is the authoritative amount for an existing
  // entitlement; `currentTotalPoints` is the amount for a new pattern.
  for (const value of [quote.upgradeDuePoints, quote.chargedPoints]) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  if (typeof quote.additionalUnits === 'number' && Number.isFinite(quote.additionalUnits)) {
    return quote.additionalUnits / 10;
  }
  if (typeof quote.currentTotalPoints === 'number' && Number.isFinite(quote.currentTotalPoints)) {
    return quote.currentTotalPoints;
  }
  return null;
}

function estimateCompletionPoints(nonEmptyBeads: number, savingTarget: 15 | 25 | 40): number {
  // Informational fallback used before authentication. The Worker remains
  // authoritative and re-quotes the exact amount before any debit.
  const baseUnits = Math.max(1, Math.ceil(Math.max(0, nonEmptyBeads) / 90));
  const multiplier = savingTarget === 40 ? 1.1 : savingTarget === 25 ? 1.08 : 1.05;
  return Math.max(0.1, Math.ceil(baseUnits * multiplier) / 10);
}

function createSessionKey(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function createDraftId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function bytesToStandardBase64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  let chunk = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const hasSecond = index + 1 < bytes.length;
    const hasThird = index + 2 < bytes.length;
    const second = hasSecond ? bytes[index + 1] : 0;
    const third = hasThird ? bytes[index + 2] : 0;
    const packed = (first << 16) | (second << 8) | third;
    chunk += BASE64_ALPHABET[(packed >>> 18) & 63]
      + BASE64_ALPHABET[(packed >>> 12) & 63]
      + (hasSecond ? BASE64_ALPHABET[(packed >>> 6) & 63] : '=')
      + (hasThird ? BASE64_ALPHABET[packed & 63] : '=');
    if (chunk.length >= 32_768) {
      chunks.push(chunk);
      chunk = '';
    }
  }
  if (chunk) chunks.push(chunk);
  return chunks.join('');
}

export function encodeGridOccupancy(grid: ReadonlyArray<ReadonlyArray<string | null>>): {
  width: number;
  height: number;
  occupancyBase64: string;
} {
  const height = grid.length;
  const width = grid.reduce((maximum, row) => Math.max(maximum, row.length), 0);
  const bitCount = width * height;
  if (!Number.isSafeInteger(bitCount)) throw new RangeError('Grid dimensions are too large to encode safely.');

  const bytes = new Uint8Array(Math.ceil(bitCount / 8));
  for (let rowIndex = 0; rowIndex < height; rowIndex += 1) {
    const row = grid[rowIndex];
    for (let columnIndex = 0; columnIndex < width; columnIndex += 1) {
      if (row[columnIndex] === null || row[columnIndex] === undefined) continue;
      const bitIndex = rowIndex * width + columnIndex;
      bytes[bitIndex >>> 3] |= 1 << (7 - (bitIndex & 7));
    }
  }

  return { width, height, occupancyBase64: bytesToStandardBase64(bytes) };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function getApiStatus(value: unknown): number | null {
  const record = asRecord(value);
  if (!record) return null;
  const status = record.status ?? record.statusCode;
  if (typeof status === 'number') return status;
  const response = asRecord(record.response);
  return typeof response?.status === 'number' ? response.status : null;
}

function getApiMessage(value: unknown, fallback: string): string {
  if (value instanceof Error && value.message) return value.message;
  const record = asRecord(value);
  if (!record) return fallback;
  const direct = record.message ?? record.error;
  if (typeof direct === 'string' && direct.trim()) return direct;
  const data = asRecord(record.data);
  const nested = data?.message ?? data?.error;
  return typeof nested === 'string' && nested.trim() ? nested : fallback;
}

function getCreditBalance(summary: unknown): number | null {
  const record = asRecord(summary);
  if (!record) return null;
  for (const key of ['availableUnits', 'balance', 'credits', 'units']) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}

function parsePaletteHex(hex: string): { r: number; g: number; b: number } {
  const normalized = hex.trim().replace(/^#/, '');
  const expanded = normalized.length === 3
    ? normalized.split('').map(channel => `${channel}${channel}`).join('')
    : normalized;

  const value = Number.parseInt(expanded, 16);
  if (!Number.isFinite(value)) return { r: 0, g: 0, b: 0 };

  return {
    r: (value >> 16) & 0xff,
    g: (value >> 8) & 0xff,
    b: value & 0xff,
  };
}

const AdminPage = lazy(() => import('./pages/AdminPage'));
const CommunityView = lazy(() =>
  import('./components/CommunityView').then(({ CommunityView: Component }) => ({ default: Component })),
);
const LargeCanvasView = lazy(() =>
  import('./components/LargeCanvasView').then(({ LargeCanvasView: Component }) => ({ default: Component })),
);
const AssemblyWorkspace = lazy(() =>
  import('./components/AssemblyWorkspace').then(({ AssemblyWorkspace: Component }) => ({ default: Component })),
);
const UserPatternsModal = lazy(() =>
  import('./components/UserPatternsModal').then(({ UserPatternsModal: Component }) => ({ default: Component })),
);
const SmartBeadReducerModal = lazy(() =>
  import('./components/SmartBeadReducerModal').then(({ SmartBeadReducerModal: Component }) => ({ default: Component })),
);

function AdminPageLoading() {
  return <main className="grid min-h-screen place-items-center bg-slate-100 p-4 text-slate-900"><div role="status" className="flex min-h-24 w-full max-w-sm items-center justify-center gap-3 rounded-3xl border border-slate-200 bg-white px-5 text-sm text-slate-700 shadow-2xl"><Loader2 className="h-5 w-5 shrink-0 animate-spin text-indigo-600" aria-hidden="true" /><span>正在加载管理后台...</span></div></main>;
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
      <div className="flex min-h-24 w-full max-w-sm items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white px-5 text-sm text-slate-800 shadow-xl">
        <Loader2 className="h-5 w-5 shrink-0 animate-spin text-indigo-600" aria-hidden="true" />
        <span>正在加载{label}...</span>
      </div>
    </section>
  );
}

function DeferredFeatureModalLoading({ label }: Pick<DeferredFeatureBoundaryProps, 'label'>) {
  return (
    <div className="fixed inset-0 z-60 grid place-items-center bg-slate-950/60 p-4 backdrop-blur-md" role="dialog" aria-modal="true" aria-label={`正在加载${label}`}>
      <div role="status" className="flex min-h-24 w-full max-w-sm items-center justify-center gap-3 rounded-3xl border border-slate-200 bg-white px-5 text-sm text-slate-800 shadow-2xl" aria-live="polite">
        <Loader2 className="h-5 w-5 shrink-0 animate-spin text-indigo-600" aria-hidden="true" />
        <span>正在加载{label}...</span>
      </div>
    </div>
  );
}

function DeferredFeatureLoadFailure({ label, surface, onDismiss }: Omit<DeferredFeatureBoundaryProps, 'children'>) {
  const message = <div className="w-full max-w-sm rounded-3xl border border-rose-200 bg-white p-6 text-center shadow-2xl">
    <h2 className="text-base font-bold text-rose-950">{label}加载失败</h2>
    <p className="mt-2 text-sm leading-6 text-rose-800">当前图纸和登录状态仍会保留。重新加载页面后可重新获取此功能。</p>
    <div className="mt-5 flex justify-center gap-2">
      {onDismiss && <button type="button" onClick={onDismiss} className="min-h-11 rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50">关闭</button>}
      <button type="button" onClick={() => window.location.reload()} className="min-h-11 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-700">重新加载页面</button>
    </div>
  </div>;

  return surface === 'modal'
    ? <div className="fixed inset-0 z-60 grid place-items-center bg-slate-950/60 p-4 backdrop-blur-md" role="dialog" aria-modal="true" aria-label={`${label}加载失败`}>{message}</div>
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

type StudioTab = 'home' | 'community' | 'studio' | 'largeCanvas' | 'assembly';
type PublicFeatureKey = 'public.community' | 'public.large_canvas' | 'public.smart_reducer' | 'public.assembly';

const PUBLIC_FEATURE_DEFAULTS: Record<PublicFeatureKey, boolean> = {
  'public.community': true,
  'public.large_canvas': true,
  'public.smart_reducer': true,
  // Assembly is an opt-in beta feature. Production remains closed until the
  // server-side flag is explicitly enabled by an administrator.
  'public.assembly': false,
};

const ASSEMBLY_DEV_MODE = import.meta.env.DEV || import.meta.env.VITE_ASSEMBLY_DEV_MODE === 'true';
const ASSEMBLY_ADMIN_BYPASS = import.meta.env.VITE_ASSEMBLY_ADMIN_BYPASS === 'true';

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function publicData(value: unknown): unknown {
  const envelope = recordValue(value);
  return envelope?.success === true ? envelope.data : null;
}

function isPublicFeatureKey(value: unknown): value is PublicFeatureKey {
  return value === 'public.community' || value === 'public.large_canvas' || value === 'public.smart_reducer' || value === 'public.assembly';
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

interface StudioAppProps {
  initialTab?: StudioTab;
}

function StudioApp({ initialTab = 'home' }: StudioAppProps) {
  const { language } = useLanguage();
  const { currentUser, userProfile, creditSummary, refreshCreditSummary } = useAuth();
  const isDesktop = useIsDesktop();
  const isEn = language === 'en';

  // 1. Core State
  const [currentTab, setCurrentTab] = useState<StudioTab>(initialTab);
  const [projectName, setProjectName] = useState('我的拼豆创意图纸');
  const [activePatternId, setActivePatternId] = useState<string | null>(null);
  const [isSavingPattern, setIsSavingPattern] = useState(false);
  const saveSubmissionRef = useRef(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [isSaveNameDialogOpen, setIsSaveNameDialogOpen] = useState(false);
  const [saveNameInput, setSaveNameInput] = useState('');
  const [saveNameError, setSaveNameError] = useState<string | null>(null);
  const [imageLoadMessage, setImageLoadMessage] = useState<string | null>(null);
  const announcement = useAnnouncements();
  const [publicFeatureFlags, setPublicFeatureFlags] = useState<Record<PublicFeatureKey, boolean>>(() => ({ ...PUBLIC_FEATURE_DEFAULTS }));
  const [publicFeatureFlagsLoaded, setPublicFeatureFlagsLoaded] = useState(false);
  const canAccessAssembly = ASSEMBLY_DEV_MODE || publicFeatureFlags['public.assembly'] || (ASSEMBLY_ADMIN_BYPASS && userProfile?.role === 'admin');
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
    outlineBoost: false,
    chromaKeyColor: null,
    chromaKeyTolerance: 20,
    colorMatchAlgo: 'ciede2000',
    kmeansClustering: true,
    quantizationStrength: 28,
    // Let the classifier select photo/cartoon/logo until the user explicitly
    // chooses a mode. This prevents landscape photos from taking the cartoon
    // colour-block profile by default.
    pipelineOverride: 'auto',
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
  const largeCanvasViewRef = useRef<LargeCanvasViewHandle | null>(null);
  const [largeCanvasCreditUsage, setLargeCanvasCreditUsage] = useState<LargeCanvasCreditUsage | null>(null);

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
  const [highlightColorIds, setHighlightColorIds] = useState<string[]>([]);
  const [completedColorIds, setCompletedColorIds] = useState<string[]>([]);
  const [symmetryMode, setSymmetryMode] = useState<SymmetryMode>('none');

  const handleToggleHighlightColorId = useCallback((colorId: string) => {
    setHighlightColorIds(prev =>
      prev.includes(colorId) ? prev.filter(id => id !== colorId) : [...prev, colorId]
    );
  }, []);

  const handleToggleCompletedColorId = useCallback((colorId: string) => {
    setCompletedColorIds(prev => toggleCompletedColorId(prev, colorId));
  }, []);

  useEffect(() => {
    const usedColorIds = new Set(grid.flatMap(row => row.filter((colorId): colorId is string => Boolean(colorId))));
    setCompletedColorIds(prev => {
      const next = prev.filter(colorId => usedColorIds.has(colorId));
      return next.length === prev.length ? prev : next;
    });
  }, [grid]);

  // Display Mode & Backdrop Settings
  const [beadShape, setBeadShape] = useState<BeadShape>('square');
  const [canvasBackdrop, setCanvasBackdrop] = useState<CanvasBackdrop>('dark_grid');
  const [showSymbols, setShowSymbols] = useState(true);
  const [showGridLines, setShowGridLines] = useState(true);
  const [showCoordinates, setShowCoordinates] = useState(true);
  const [showLargeCodeLabels, setShowLargeCodeLabels] = useState(false);
  const [showLargeDataPreview, setShowLargeDataPreview] = useState(false);
  const [showOverlay, setShowOverlay] = useState(false);
  const [overlayOpacity, setOverlayOpacity] = useState(0.35);
  const [zoom, setZoom] = useState(1.0);

  // Modal State
  const [isPaletteModalOpen, setIsPaletteModalOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isStudioModalOpen, setIsStudioModalOpen] = useState(false);
  const [isGuideModalOpen, setIsGuideModalOpen] = useState(false);
  const [isSmartReduceModalOpen, setRawSmartReduceModalOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isUserProfileModalOpen, setIsUserProfileModalOpen] = useState(false);
  const [isAccountManagementModalOpen, setIsAccountManagementModalOpen] = useState(false);
  const [isUserPatternsModalOpen, setIsUserPatternsModalOpen] = useState(false);
  const [initialPublishRecord, setInitialPublishRecord] = useState<ExportedPatternRecord | null>(null);
  const [isVipModalOpen, setIsVipModalOpen] = useState(false);
  const [draftSourceKey, setDraftSourceKey] = useState(createDraftId);
  const [currentSavingTarget, setCurrentSavingTarget] = useState<15 | 25 | 40>(15);
  const [completionStatus, setCompletionStatus] = useState<PatternCompletionStatus>('DRAFT');
  const [completionQuote, setCompletionQuote] = useState<CompletionQuoteState | null>(null);
  const [completionPreviewQuote, setCompletionPreviewQuote] = useState<PatternCompletionQuote | null>(null);
  const [completionPreviewStatus, setCompletionPreviewStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [paidNonEmptyBeads, setPaidNonEmptyBeads] = useState<number | null>(null);
  const completionSubmissionRef = useRef(false);
  const legacyMigrationAttemptedUsersRef = useRef<Set<string>>(new Set());
  const [alignedPixels, setAlignedPixels] = useState<Uint8ClampedArray | undefined>(undefined);
  const [replaceSourceColor, setReplaceSourceColor] = useState<BeadColor | null>(null);
  const [erasedColorCoords, setErasedColorCoords] = useState<Map<string, [number, number][]>>(() => new Map<string, [number, number][]>());

  const hasFormalLogin = Boolean(currentUser) && !isGuestAccount(currentUser) && !isGuestAccount(userProfile);

  useEffect(() => {
    const userId = currentUser?.uid;
    if (!hasFormalLogin || !userId || legacyMigrationAttemptedUsersRef.current.has(userId)) return;
    // Mark the session attempt before touching storage/network. A transient
    // failure leaves every record unchanged and does not nag or loop.
    legacyMigrationAttemptedUsersRef.current.add(userId);
    let cancelled = false;

    void (async () => {
      const records = await getUserExportedPatterns(userId);
      const oldRecords = records
        .filter(record => record.completionStatus === undefined)
        .slice(0, 50);
      const candidates = (await Promise.all(oldRecords.map(async record => {
        try {
          const project = await getPatternProject(record.id, userId);
          // A summary from an older schema may omit the field while the full
          // project already identifies a new draft. Never import that draft.
          if (project.completionStatus !== undefined) return null;
          const workKey = record.id;
          const sourceHash = project.sourceHash || stableHash(workKey);
          const gridHash = project.gridHash || stableHash(
            project.grid.map(row => row.map(cell => cell ?? '').join('\u001f')).join('\u001e'),
          );
          const nonEmptyBeads = project.grid.reduce(
            (total, row) => total + row.filter(cell => cell !== null).length,
            0,
          );
          return { workKey, sourceHash, gridHash, nonEmptyBeads };
        } catch {
          return null;
        }
      }))).filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null);

      if (cancelled || candidates.length === 0) return;
      const response = await apiImportLegacyPatterns(candidates);
      if (cancelled || !response.ok || !response.data) {
        // Legacy migration is best-effort. A 409 is not a successful import:
        // keep the records untouched, but explain only the known idempotency
        // / already-registered cases instead of silently masking a quota or
        // authorization error.
        if (!cancelled && response.status === 409) {
          const message = response.error ?? '';
          if (/相同历史作品导入请求仍在处理|幂等记录无效|Idempotency-Key/i.test(message)) {
            setSaveMessage('历史作品导入正在处理，请稍后刷新图库。');
          } else if (/最多导入/.test(message)) {
            setSaveMessage('历史作品迁移名额已用完，未重复导入。');
          } else if (/资格或登记状态已变化|登记状态无效/.test(message)) {
            setSaveMessage('历史作品已登记或状态已变化，无需重复导入。');
          }
        }
        return;
      }
      const submitted = new Map(candidates.map(candidate => [candidate.workKey, candidate]));
      const accepted = response.data.results.flatMap(result => {
        if (result.status !== 'IMPORTED' && result.status !== 'ALREADY_REGISTERED') return [];
        const candidate = submitted.get(result.workKey);
        return candidate
          ? [{ workKey: candidate.workKey, sourceHash: candidate.sourceHash, gridHash: candidate.gridHash }]
          : [];
      });
      if (!cancelled && accepted.length > 0) {
        await markLegacyByWorkKeys(userId, accepted);
      }
    })().catch(() => {
      // Migration is best-effort and deliberately silent. Failure cannot
      // change, delete, or repeatedly surface prompts for local patterns.
    });

    return () => { cancelled = true; };
  }, [currentUser?.uid, hasFormalLogin]);

  const beginNewCompletionDraft = useCallback(() => {
    setDraftSourceKey(createDraftId());
    setCurrentSavingTarget(15);
    setCompletionStatus('DRAFT');
    setCompletionQuote(null);
    setPaidNonEmptyBeads(null);
  }, []);

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

  const openPublishFromProfile = useCallback((record: ExportedPatternRecord) => {
    if (!requireFormalLogin(isEn ? 'Sign in before publishing.' : '请先登录后再发布作品。')) return;
    setIsUserProfileModalOpen(false);
    setInitialPublishRecord(record);
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
    const controller = new AbortController();
    // Feature flags are independent of both announcement endpoints.
    void (async () => {
      try {
        const response = await fetch('/api/public/feature-flags', {
          headers: { Accept: 'application/json' }, credentials: 'omit', signal: controller.signal,
        });
        if (!response.ok) throw new Error('Feature flags unavailable');
        const data = publicData(await response.json());
        if (!controller.signal.aborted) setPublicFeatureFlags(parsePublicFeatureFlags(data));
      } catch {
        // Keep existing safe defaults; an aborted StrictMode request must not write state.
      } finally {
        if (!controller.signal.aborted) setPublicFeatureFlagsLoaded(true);
      }
    })();
    return () => controller.abort();
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
    if (tab === 'assembly' && publicFeatureFlagsLoaded && !canAccessAssembly) {
      showDisabledFeature(isEn ? '3D assembly' : '立体拼豆');
      return;
    }
    if (feature && !publicFeatureFlags[feature]) {
      showDisabledFeature(tab === 'community' ? '社区' : '大画板');
      return;
    }
    setCurrentTab(tab);
  }, [canAccessAssembly, currentTab, isEn, publicFeatureFlags, publicFeatureFlagsLoaded, showDisabledFeature]);

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
  }, [canAccessAssembly, currentTab, isEn, isSmartReduceModalOpen, publicFeatureFlags, publicFeatureFlagsLoaded, showDisabledFeature]);

  // Palette Lookup Map
  const paletteMap = useMemo(() => {
    return new Map(activePalette.map(c => [c.id, c]));
  }, [activePalette]);

  const gridNonEmptyBeads = useMemo(
    () => grid.reduce((total, row) => total + row.filter(cell => cell !== null).length, 0),
    [grid],
  );
  const gridHash = useMemo(
    () => stableHash(grid.map(row => row.map(cell => cell ?? '').join('\u001f')).join('\u001e')),
    [grid],
  );
  const gridOccupancy = useMemo(() => encodeGridOccupancy(grid), [grid]);
  const stableWorkKey = currentTab === 'largeCanvas'
    ? (largeCanvasCreditUsage?.workKey ?? 'large-canvas:workspace')
    : activePatternId ?? `draft:${draftSourceKey}`;
  const lastCompletionWorkKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const previousWorkKey = lastCompletionWorkKeyRef.current;
    if (previousWorkKey !== null && previousWorkKey !== stableWorkKey) {
      setCompletionStatus('DRAFT');
      setCompletionQuote(null);
      setCompletionPreviewQuote(null);
      setCompletionPreviewStatus('idle');
      setPaidNonEmptyBeads(null);
    }
    lastCompletionWorkKeyRef.current = stableWorkKey;
  }, [stableWorkKey]);
  const sourceHash = useMemo(() => stableHash(stableWorkKey), [stableWorkKey]);
  const completionUsage = useMemo(
    () => currentTab === 'largeCanvas'
      ? (largeCanvasCreditUsage ?? { width: 0, height: 0, occupancyBase64: '', nonEmptyBeads: 0 })
      : { ...gridOccupancy, nonEmptyBeads: gridNonEmptyBeads },
    [currentTab, gridNonEmptyBeads, gridOccupancy, largeCanvasCreditUsage],
  );
  const nonEmptyBeads = completionUsage.nonEmptyBeads;
  const patternCompletionInput = useMemo<PatternCompletionInput>(() => ({
    workKey: stableWorkKey,
    sourceHash,
    width: completionUsage.width,
    height: completionUsage.height,
    occupancyBase64: completionUsage.occupancyBase64,
    savingTarget: currentSavingTarget,
  }), [completionUsage, currentSavingTarget, sourceHash, stableWorkKey]);
  const needsCompletionSupplement = completionStatus === 'COMPLETED'
    && paidNonEmptyBeads !== null
    && nonEmptyBeads > paidNonEmptyBeads;
  // VIP only changes export privileges. Detailed pattern data is available
  // only once the pattern itself has been completed, paid up to date, or is a
  // server-marked legacy pattern.
  const isPatternUnlocked = (completionStatus === 'COMPLETED' && !needsCompletionSupplement)
    || completionStatus === 'LEGACY';
  const displayedCreditBalance = getCreditBalance(creditSummary);
  const quotedCompletionPoints = completionQuote
    ? getCompletionChargePoints(completionQuote.quote)
    : completionPreviewQuote
      ? getCompletionChargePoints(completionPreviewQuote)
      : null;
  const unauthenticatedEstimate = !hasFormalLogin && nonEmptyBeads > 0
    ? estimateCompletionPoints(nonEmptyBeads, currentSavingTarget)
    : null;

  useEffect(() => {
    setCompletionQuote(current => current
      && current.input.width === patternCompletionInput.width
      && current.input.height === patternCompletionInput.height
      && current.input.occupancyBase64 === patternCompletionInput.occupancyBase64
      && current.input.savingTarget === patternCompletionInput.savingTarget
      ? current
      : null);
  }, [patternCompletionInput]);

  const reportCompletionFailure = useCallback((error: unknown, action: 'quote' | 'complete') => {
    const status = getApiStatus(error);
    if (status === 401) {
      setIsAuthModalOpen(true);
      setSaveMessage(isEn ? 'Sign in to complete and unlock this pattern. Your draft is kept.' : '请登录后完成并解锁图纸，草稿已保留。');
      return;
    }
    if (status === 402) {
      setSaveMessage(isEn ? 'Not enough credits. Your draft is kept and can be completed after you earn more.' : '积分不足，草稿已保留；获得积分后可继续完成。');
      return;
    }
    if (status === 409 || status === 422) {
      setSaveMessage(isEn ? 'The quote is no longer valid. Please quote again; your draft is unchanged.' : '当前报价已失效，请重新核价；草稿未受影响。');
      return;
    }
    setSaveMessage(getApiMessage(error, action === 'quote'
      ? (isEn ? 'Unable to quote completion right now. Your draft is unchanged.' : '暂时无法核价，草稿未受影响。')
      : (isEn ? 'Unable to complete this pattern right now. Your draft is unchanged.' : '暂时无法完成图纸，草稿未受影响。')));
  }, [isEn]);

  const getCompletionQuoteData = useCallback((result: unknown): PatternCompletionQuote => {
    const data = asRecord(asRecord(result)?.data);
    const additionalUnits = typeof data?.additionalUnits === 'number'
      ? data.additionalUnits
      : typeof data?.upgradeDueUnits === 'number'
        ? data.upgradeDueUnits
        : undefined;
    const hasPoints = typeof data?.upgradeDuePoints === 'number'
      || typeof data?.chargedPoints === 'number'
      || typeof data?.currentTotalPoints === 'number'
      || typeof additionalUnits === 'number';
    if (!data || !hasPoints) {
      const failure = new Error(getApiMessage(result, isEn ? 'Completion quote was unavailable.' : '完成图纸的报价不可用。'));
      Object.assign(failure, { status: getApiStatus(result) });
      throw failure;
    }
    return { ...data, ...(typeof additionalUnits === 'number' ? { additionalUnits } : {}) } as unknown as PatternCompletionQuote;
  }, [isEn]);

  // Keep the required amount visible while the user edits. This is a
  // read-only quote and never creates a hold or charges credits.
  useEffect(() => {
    if (completionQuote || completionStatus === 'AWAITING_CONFIRMATION' || completionStatus === 'COMPLETING') return;
    if (nonEmptyBeads === 0) {
      setCompletionPreviewQuote(null);
      setCompletionPreviewStatus('idle');
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (!hasFormalLogin) {
        setCompletionPreviewQuote(null);
        setCompletionPreviewStatus('idle');
        return;
      }
      setCompletionPreviewStatus('loading');
      void apiQuotePatternCompletion(patternCompletionInput)
        .then(result => {
          if (cancelled) return;
          const quote = getCompletionQuoteData(result);
          setCompletionPreviewQuote(quote);
          setCompletionPreviewStatus('idle');
        })
        .catch(() => {
          if (cancelled) return;
          setCompletionPreviewQuote(null);
          setCompletionPreviewStatus('error');
        });
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [completionQuote, completionStatus, getCompletionQuoteData, hasFormalLogin, nonEmptyBeads, patternCompletionInput]);

  const handleQuotePatternCompletion = useCallback(async () => {
    if (nonEmptyBeads === 0) {
      setSaveMessage(isEn ? 'Add at least one bead before completing the pattern.' : '请先生成或添加至少一颗拼豆，再完成图纸。');
      return;
    }
    if (!hasFormalLogin) {
      setIsAuthModalOpen(true);
      setSaveMessage(isEn ? 'Sign in to complete and unlock this pattern. Your draft is kept.' : '请登录后完成并解锁图纸，草稿已保留。');
      return;
    }

    setCompletionStatus('QUOTING');
    setCompletionQuote(null);
    try {
      const result = await apiQuotePatternCompletion(patternCompletionInput);
      const quote = getCompletionQuoteData(result);
      setCompletionQuote({
        input: patternCompletionInput,
        quote,
        idempotencyKey: createSessionKey('completion'),
      });
      setCompletionStatus('AWAITING_CONFIRMATION');
    } catch (error) {
      setCompletionStatus(paidNonEmptyBeads === null ? 'DRAFT' : 'COMPLETED');
      reportCompletionFailure(error, 'quote');
    }
  }, [getCompletionQuoteData, hasFormalLogin, isEn, nonEmptyBeads, paidNonEmptyBeads, patternCompletionInput, reportCompletionFailure]);

  const handleCompletePattern = useCallback(async () => {
    if (completionSubmissionRef.current) return;
    if (!completionQuote
      || completionQuote.input.width !== patternCompletionInput.width
      || completionQuote.input.height !== patternCompletionInput.height
      || completionQuote.input.occupancyBase64 !== patternCompletionInput.occupancyBase64
      || completionQuote.input.savingTarget !== patternCompletionInput.savingTarget) {
      setCompletionQuote(null);
      setCompletionStatus(paidNonEmptyBeads === null ? 'DRAFT' : 'COMPLETED');
      setSaveMessage(isEn ? 'The draft changed. Please quote the current pattern again.' : '图纸已修改，请重新核价当前图纸。');
      return;
    }

    completionSubmissionRef.current = true;
    setCompletionStatus('COMPLETING');
    try {
      const result = await apiCompletePattern(completionQuote.input, completionQuote.idempotencyKey);
      const completedQuote = getCompletionQuoteData(result);
      const completedPaidBeads = completedQuote.entitlement?.paidNonEmptyBeads ?? completedQuote.nonEmptyBeads;
      setPaidNonEmptyBeads(completedPaidBeads);
      setCompletionQuote(null);
      setCompletionStatus('COMPLETED');
      await refreshCreditSummary();
      setSaveMessage(isEn ? 'Pattern completed and unlocked.' : '图纸已完成并解锁。');
    } catch (error) {
      setCompletionStatus(paidNonEmptyBeads === null ? 'DRAFT' : 'COMPLETED');
      reportCompletionFailure(error, 'complete');
    } finally {
      completionSubmissionRef.current = false;
    }
  }, [completionQuote, getCompletionQuoteData, isEn, paidNonEmptyBeads, patternCompletionInput, refreshCreditSummary, reportCompletionFailure]);

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

  /** Explicitly merge small connected islands in the current in-memory grid only. */
  const handleConsolidateStrayBeads = useCallback((strength: StrayBeanStrength = 'standard') => {
    const currentGrid = gridRef.current;
    const nextGrid = consolidateStrayBeans(currentGrid, {
      isFilled: cell => cell !== null && paletteMap.has(cell),
      getColorKey: cell => String(cell),
      getColor: cell => parsePaletteHex(paletteMap.get(cell)?.hex ?? '#000000'),
      replaceColor: (_noise, replacement) => replacement,
    }, strength, {
      mode: settings.pipelineOverride && settings.pipelineOverride !== 'auto'
        ? settings.pipelineOverride : conversionDiagnostics?.pipeline ?? 'photo',
      intent: 'manual',
    });

    // Keep the source image and conversion settings untouched; this is an edit
    // to the working pattern and is intentionally not auto-saved.
    return applyGridChange(nextGrid, false);
  }, [applyGridChange, paletteMap, settings.pipelineOverride, conversionDiagnostics?.pipeline]);

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
            setCompletedColorIds([]);
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
      beginNewCompletionDraft();
      const requestToken = beginImageRequest();
      convertImageToGrid(sourceImage, settings, activePalette, requestToken);
    }
  };

  // Load Image File
  const handleImageUpload = (file: File) => {
    if (currentTab === 'largeCanvas') {
      largeCanvasViewRef.current?.uploadFile(file);
      return;
    }

    beginNewCompletionDraft();
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
    beginNewCompletionDraft();
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
    setCompletedColorIds([]);
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
    setHighlightColorIds([]);
    setCompletedColorIds([]);
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
    if (!isPatternUnlocked) {
      setSaveMessage(isEn ? 'Complete the pattern to unlock codes, quantities, coordinates, and downloads.' : '完成后解锁色号、数量、坐标和导出。');
      return;
    }
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
        beginNewCompletionDraft();
        invalidateImageRequest();
        setActivePatternId(null);
        setCompletedColorIds([]);
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
    beginNewCompletionDraft();
    const savedCompletion = asRecord(project);
    const savedCompletionStatus = savedCompletion?.completionStatus;
    const savedPaidNonEmptyBeads = savedCompletion?.paidNonEmptyBeads;
    // Legacy works remain entitled. Completed works require their stored paid
    // bead cap so later edits can still trigger the normal supplement flow.
    if (savedCompletionStatus === 'LEGACY') {
      setCompletionStatus('LEGACY');
    } else if (savedCompletionStatus === 'COMPLETED'
      && typeof savedPaidNonEmptyBeads === 'number'
      && Number.isSafeInteger(savedPaidNonEmptyBeads)
      && savedPaidNonEmptyBeads >= 0) {
      setCompletionStatus('COMPLETED');
      setPaidNonEmptyBeads(savedPaidNonEmptyBeads);
    }
    invalidateImageRequest();
    setCompletedColorIds([]);
    setActivePatternId(project.workId);
    setProjectName(project.name);
    setBrand(project.brand);
    setActivePalette(project.palette);
    setSettings((current) => ({
      ...current,
      ...project.settings,
      width: project.width,
      height: project.height,
      boardSize: project.boardSize,
      brand: project.brand,
    }));
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
      const saveInput: Parameters<typeof saveExportedPatternRecord>[0] = {
        // On the first save, promote the exact draft entitlement key into the
        // persistent record ID. Subsequent saves continue using that same ID.
        id: activePatternId ?? patternCompletionInput.workKey,
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
        completionStatus: completionStatus === 'LEGACY'
          ? 'LEGACY'
          : completionStatus === 'COMPLETED'
            ? 'COMPLETED'
            : 'DRAFT',
        paidNonEmptyBeads: completionStatus === 'COMPLETED' ? paidNonEmptyBeads : null,
        sourceHash,
        gridHash,
      };
      const record = await saveExportedPatternRecord(saveInput);
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
    if (!isPatternUnlocked) {
      setSaveMessage(isEn ? 'Complete the pattern to unlock codes, quantities, coordinates, and downloads.' : '完成后解锁色号、数量、坐标和导出。');
      return;
    }
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


  const completionSummary = (
    <CompletionSummary
      isEn={isEn}
      isUnlocked={isPatternUnlocked}
      needsSupplement={needsCompletionSupplement}
      nonEmptyBeads={nonEmptyBeads}
      quotedPoints={quotedCompletionPoints}
      estimatedPoints={unauthenticatedEstimate}
      quoteStatus={completionPreviewStatus}
      completionStatus={completionStatus}
      onQuote={() => void handleQuotePatternCompletion()}
      quote={completionQuote?.quote ?? null}
      onCancelQuote={() => {
        setCompletionQuote(null);
        setCompletionStatus(paidNonEmptyBeads === null ? 'DRAFT' : 'COMPLETED');
      }}
      onComplete={() => void handleCompletePattern()}
      balance={displayedCreditBalance}
    />
  );

  return (
    <div className="flex flex-col h-screen bg-slate-50 font-sans text-slate-900 overflow-hidden">
      {isDesktop ? (
        <Header
          projectName={projectName}
          setProjectName={setProjectName}
          onImageUpload={handleImageUpload}
          onLoadSample={handleLoadSample}
          onExportJson={handleExportJson}
          onImportJson={handleImportJson}
          onOpenExportModal={openExportModal}
          onOpenGuideModal={() => setIsGuideModalOpen(true)}
          onOpenAnnouncements={announcement.store.openHistory}
          hasUnreadAnnouncements={announcement.hasUnread}
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
      ) : (
        <MobileHeaderNav
          projectName={projectName}
          setProjectName={setProjectName}
          onImageUpload={handleImageUpload}
          onExportJson={handleExportJson}
          onImportJson={handleImportJson}
          onOpenGuideModal={() => setIsGuideModalOpen(true)}
          onOpenAnnouncements={announcement.store.openHistory}
          hasUnreadAnnouncements={announcement.hasUnread}
          onOpenSmartReduceModal={() => setIsSmartReduceModalOpen(true)}
          onOpenPatternsModal={openUserPatternsModal}
          onOpenPaletteModal={() => setIsPaletteModalOpen(true)}
          onOpenAuthModal={() => setIsAuthModalOpen(true)}
          onOpenUserProfileModal={() => setIsUserProfileModalOpen(true)}
          onOpenVipModal={() => setIsVipModalOpen(true)}
          onClearCanvas={handleClearCanvas}
          currentTab={currentTab}
          setCurrentTab={guardedSetCurrentTab}
        />
      )}

      <PublicAnnouncementModal
        state={announcement.state}
        onClose={announcement.store.close}
        onRetry={announcement.store.retryHistory}
        onSelect={announcement.store.openDetail}
        onBack={announcement.store.backToHistory}
        onLoadMore={announcement.store.loadMore}
      />

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
              ref={largeCanvasViewRef}
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
              onCreditUsageChange={setLargeCanvasCreditUsage}
            />
          </Suspense>
        </DeferredFeatureBoundary>
      )}

      {currentTab === 'assembly' && canAccessAssembly && (
        <DeferredFeatureBoundary label="立体拼豆" surface="page" onDismiss={() => setCurrentTab('home')}>
          <Suspense fallback={<DeferredFeaturePageLoading label="立体拼豆" />}>
            <AssemblyWorkspace
              paletteMap={paletteMap}
              brandName={BRAND_NAMES[brand]}
            />
          </Suspense>
        </DeferredFeatureBoundary>
      )}

      {currentTab === 'assembly' && publicFeatureFlagsLoaded && !canAccessAssembly && (
        <section className="grid min-h-[52dvh] place-items-center bg-slate-50 p-4 sm:p-6" role="status" aria-live="polite">
          <div className="w-full max-w-md rounded-2xl border border-purple-100 bg-white p-6 text-center shadow-lg">
            <h1 className="text-lg font-black text-purple-950">立体拼豆开发中</h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">该功能正在完善，暂未向普通用户开放。二维画板及其他功能不受影响。</p>
            <button type="button" onClick={() => setCurrentTab('home')} className="mt-5 min-h-11 rounded-xl bg-purple-600 px-5 py-2 text-sm font-bold text-white hover:bg-purple-700">返回首页</button>
          </div>
        </section>
      )}

      {currentTab === 'assembly' && !publicFeatureFlagsLoaded && !ASSEMBLY_DEV_MODE && (
        <DeferredFeaturePageLoading label="立体拼豆" />
      )}

      {(currentTab === 'studio' || currentTab === 'largeCanvas') && (
        <>
          {currentTab === 'studio' && (
            <PatternDetailsUnlockContext.Provider value={isPatternUnlocked}>
            {isDesktop ? (
            <DesktopWorkspace
              completionSummary={completionSummary}
              grid={grid}
              paletteMap={paletteMap}
              settings={settings}
              setSettings={setSettings}
              conversionDiagnostics={conversionDiagnostics}
              handleReconvert={handleReconvert}
              sourceImage={sourceImage}
              setIsStudioModalOpen={setIsStudioModalOpen}
              activeTool={activeTool}
              setActiveTool={setActiveTool}
              selectedColor={selectedColor}
              setSelectedColor={setSelectedColor}
              canUndo={historyIndex > 0}
              canRedo={historyIndex < history.length - 1}
              handleUndo={handleUndo}
              handleRedo={handleRedo}
              zoom={zoom}
              setZoom={setZoom}
              handleZoomIn={() => setZoom(z => Math.min(4.0, z * 1.15))}
              handleZoomOut={() => setZoom(z => Math.max(0.1, z * 0.85))}
              handleResetZoom={() => setZoom(1.0)}
              beadShape={beadShape}
              setBeadShape={setBeadShape}
              showSymbols={isPatternUnlocked && showSymbols}
              setShowSymbols={setShowSymbols}
              showGridLines={showGridLines}
              setShowGridLines={setShowGridLines}
              showCoordinates={isPatternUnlocked && showCoordinates}
              setShowCoordinates={setShowCoordinates}
              symmetryMode={symmetryMode}
              setSymmetryMode={setSymmetryMode}
              canvasBackdrop={canvasBackdrop}
              setCanvasBackdrop={setCanvasBackdrop}
                showOverlay={showOverlay}
                setShowOverlay={setShowOverlay}
                overlayOpacity={overlayOpacity}
                setOverlayOpacity={setOverlayOpacity}
              highlightColorIds={highlightColorIds}
              setHighlightColorIds={setHighlightColorIds}
              handleToggleHighlightColorId={handleToggleHighlightColorId}
              completedColorIds={completedColorIds}
              handleToggleCompletedColorId={handleToggleCompletedColorId}
              setReplaceSourceColor={setReplaceSourceColor}
              handleEraseColor={handleEraseColor}
              handleRestoreColor={handleRestoreColor}
              erasedColorCoords={erasedColorCoords}
              handleCellClick={handleCellClick}
              beginHistoryTransaction={beginHistoryTransaction}
              finishHistoryTransaction={finishHistoryTransaction}
              handleApplyShape={handleApplyShape}
              handleReferenceImageUpload={handleReferenceImageUpload}
              handleResetCurrentCanvas={handleResetCurrentCanvas}
              handleClearOuterBackground={handleClearOuterBackground}
              openColorManagerModal={() => setIsPaletteModalOpen(true)}
              openSaveNameDialog={openSaveNameDialog}
              isSavingPattern={isSavingPattern}
              openExportModal={openExportModal}
              isConverting={isConverting}
              isEn={isEn}
              onOpenPatternsModal={openUserPatternsModal}
              onConsolidateStrayBeads={handleConsolidateStrayBeads}
            />
          ) : (
            <MobileWorkspace
              completionSummary={completionSummary}
              grid={grid}
              paletteMap={paletteMap}
              settings={settings}
              setSettings={setSettings}
              conversionDiagnostics={conversionDiagnostics}
              handleReconvert={handleReconvert}
              sourceImage={sourceImage}
              setIsStudioModalOpen={setIsStudioModalOpen}
              activeTool={activeTool}
              setActiveTool={setActiveTool}
              selectedColor={selectedColor}
              setSelectedColor={setSelectedColor}
              canUndo={historyIndex > 0}
              canRedo={historyIndex < history.length - 1}
              handleUndo={handleUndo}
              handleRedo={handleRedo}
              zoom={zoom}
              setZoom={setZoom}
              handleZoomIn={() => setZoom(z => Math.min(4.0, z * 1.15))}
              handleZoomOut={() => setZoom(z => Math.max(0.1, z * 0.85))}
              handleResetZoom={() => setZoom(1.0)}
              beadShape={beadShape}
              setBeadShape={setBeadShape}
              showSymbols={isPatternUnlocked && showSymbols}
              setShowSymbols={setShowSymbols}
              showGridLines={showGridLines}
              setShowGridLines={setShowGridLines}
              showCoordinates={isPatternUnlocked && showCoordinates}
              setShowCoordinates={setShowCoordinates}
              symmetryMode={symmetryMode}
              setSymmetryMode={setSymmetryMode}
              canvasBackdrop={canvasBackdrop}
              setCanvasBackdrop={setCanvasBackdrop}
                showOverlay={showOverlay}
                setShowOverlay={setShowOverlay}
                overlayOpacity={overlayOpacity}
                setOverlayOpacity={setOverlayOpacity}
              highlightColorIds={highlightColorIds}
              setHighlightColorIds={setHighlightColorIds}
              handleToggleHighlightColorId={handleToggleHighlightColorId}
              completedColorIds={completedColorIds}
              handleToggleCompletedColorId={handleToggleCompletedColorId}
              setReplaceSourceColor={setReplaceSourceColor}
              handleEraseColor={handleEraseColor}
              handleRestoreColor={handleRestoreColor}
              erasedColorCoords={erasedColorCoords}
              handleCellClick={handleCellClick}
              beginHistoryTransaction={beginHistoryTransaction}
              finishHistoryTransaction={finishHistoryTransaction}
              handleApplyShape={handleApplyShape}
              handleReferenceImageUpload={handleReferenceImageUpload}
              handleResetCurrentCanvas={handleResetCurrentCanvas}
              handleClearOuterBackground={handleClearOuterBackground}
              openColorManagerModal={() => setIsPaletteModalOpen(true)}
              openSaveNameDialog={openSaveNameDialog}
              isSavingPattern={isSavingPattern}
              openExportModal={openExportModal}
              onExportJson={handleExportJson}
              onImportJson={handleImportJson}
              openSmartReduce={openSmartReduce}
              isConverting={isConverting}
              isEn={isEn}
              onOpenPatternsModal={openUserPatternsModal}
              onOpenGuideModal={() => setIsGuideModalOpen(true)}
              onOpenVipModal={() => setIsVipModalOpen(true)}
            />
            )}
            </PatternDetailsUnlockContext.Provider>
          )}

          {saveMessage && (
            <div className="fixed bottom-20 left-1/2 z-50 -translate-x-1/2 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-900 shadow-lg">
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

      {!isDesktop && currentTab !== 'studio' && (
        <MobileBottomNav
          currentTab={currentTab}
          setCurrentTab={guardedSetCurrentTab}
          onOpenProfile={() => {
            if (currentUser) {
              setIsUserProfileModalOpen(true);
            } else {
              setIsAuthModalOpen(true);
            }
          }}
          isEn={isEn}
        />
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
        unlocked={isPatternUnlocked}
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
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-md">
          <div className="w-full max-w-sm rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl">
            <h2 className="text-base font-black text-slate-900">保存作品</h2>
            <p className="mt-1 text-xs text-slate-500">为图纸命名后保存到你的图库。</p>
            <label className="mt-4 block text-xs font-bold text-slate-700">
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
                className="mt-1.5 min-h-12 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
                placeholder="例如：我的向日葵拼豆图"
                disabled={isSavingPattern}
              />
            </label>
            <div className="mt-1 flex justify-between text-[11px] text-slate-500">
              <span>必填，1-60 个字符</span>
              <span>{saveNameInput.trim().length}/60</span>
            </div>
            {saveNameError && <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{saveNameError}</p>}
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setIsSaveNameDialogOpen(false)}
                disabled={isSavingPattern}
                className="min-h-11 rounded-xl border border-slate-300 px-4 py-2.5 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60"
              >
                取消
              </button>
              <button
                type="button"
                onClick={confirmSaveCurrentPattern}
                disabled={isSavingPattern}
                className="min-h-11 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-bold text-white transition-colors hover:bg-indigo-700 disabled:opacity-60"
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
              onApplyReducedGrid={(newGrid, savingTarget) => {
                invalidateImageRequest();
                applyGridChange(newGrid, false);
                setCurrentSavingTarget(savingTarget);
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
        onPublishPattern={openPublishFromProfile}
      />

      <AccountManagementModal
        isOpen={isAccountManagementModalOpen}
        onClose={() => setIsAccountManagementModalOpen(false)}
        onOpenVipModal={() => setIsVipModalOpen(true)}
      />

      {isUserPatternsModalOpen && hasFormalLogin && (
        <DeferredFeatureBoundary label="我的图库" surface="modal" onDismiss={() => { setIsUserPatternsModalOpen(false); setInitialPublishRecord(null); }}>
          <Suspense fallback={<DeferredFeatureModalLoading label="我的图库" />}>
            <UserPatternsModal
              isOpen={isUserPatternsModalOpen}
              onClose={() => { setIsUserPatternsModalOpen(false); setInitialPublishRecord(null); }}
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
              initialPublishRecord={initialPublishRecord}
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

type PublicRouteTab = Extract<StudioTab, 'home' | 'community' | 'studio' | 'largeCanvas' | 'assembly'>;

function resolveWorkspaceTab(): PublicRouteTab {
  const requested = new URLSearchParams(window.location.search).get('tab');
  if (requested === 'community' || requested === 'studio' || requested === 'largeCanvas' || requested === 'assembly') return requested;
  if (/^\/assembly(?:\/|$)/.test(window.location.pathname)) return 'assembly';
  if (/^\/large-canvas(?:\/|$)/.test(window.location.pathname)) return 'largeCanvas';
  return 'home';
}

function navigatePublic(path: string): void {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function PublicAppRoute() {
  const [locationKey, setLocationKey] = useState(() => `${window.location.pathname}${window.location.search}`);

  useEffect(() => {
    const handlePopState = () => setLocationKey(`${window.location.pathname}${window.location.search}`);
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Read the location after the state update so SPA navigation and browser
  // back/forward transitions both render the right surface.
  void locationKey;
  const pathname = window.location.pathname;
  const isWorkspaceRoute = /^\/(?:workspace|app|assembly|large-canvas)(?:\/|$)/.test(pathname);
  if (isWorkspaceRoute) return <StudioApp initialTab={resolveWorkspaceTab()} />;

  return <LandingView onEnterWorkspace={() => navigatePublic('/workspace')} onExploreCommunity={() => navigatePublic('/workspace?tab=community')} />;
}

export default function App() {
  return /^\/admin(?:\/|$)/.test(window.location.pathname)
    ? <Suspense fallback={<AdminPageLoading />}><AdminPage /></Suspense>
    : <PublicAppRoute />;
}
