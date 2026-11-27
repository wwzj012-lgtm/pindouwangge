import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  Crop, Crown, Download, Hand, LayoutGrid, LibraryBig, Loader2, LockKeyhole, Pencil, RefreshCw, Timer, Users, X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import type { BeadColor } from '../types';
import type { StoredPatternProject } from '../utils/patternGridCodec';
import {
  canvasLimitForMembership, canEditCommunityPattern, cropCommunityPattern, type CommunityCropRect,
} from '../utils/communityPatternAccess';
import { getCommunityPost, type CommunityPost } from '../utils/communityApi';
import { loadCommunityPattern } from '../utils/communityPattern';
import { getExportedPatternPreview, getPatternProject, getUserExportedPatterns, type ExportedPatternRecord } from '../utils/patternHistory';
import { useCommunityFeed } from '../hooks/useCommunityFeed';
import {
  DEFAULT_PRACTICE_SECTION_SIZE, PRACTICE_MIN_BEADS_FOR_SECTIONS,
  countPlacedBeads, findNextIncompleteSection, findNextUnplacedCell,
  listPracticeSections, loadPracticeProgress, practiceProgressAvailable, practiceSectionForCell,
  savePracticeProgress, togglePracticeCell, type PracticeSectionSize,
} from '../utils/practiceProgress';
import { CommunityPatternCanvas, type CommunityPatternFocusRect } from './CommunityPatternCanvas';
import { PracticePanel, type PracticePanelProgress } from './PracticePanel';
import { ExportModal } from './ExportModal';
import './CommunityPatternWorkspace.css';

/** Where the pattern being practised came from. */
export type PracticeSource = 'board' | 'library' | 'community';

/** Payload handed back when the user picks a pattern inside the empty state. */
export interface PracticeSelectionMeta {
  title: string;
  source: 'library' | 'community';
  /** Progress/timer storage key for that specific work. */
  workKey: string;
  postId?: string;
}

export interface PracticeWorkspaceProps {
  /** null renders the source picker instead of a session. */
  project: StoredPatternProject | null;
  title: string;
  source: PracticeSource;
  workKey: string;
  userId?: string | null;
  onClose: () => void;
  onOpenInventory: () => void;
  onRequireLogin?: () => void;
  onSelectProject?: (project: StoredPatternProject, meta: PracticeSelectionMeta) => void;
  /** Community-only: enables the region-copy tab and the export button. */
  postId?: string;
  onEdit?: (project: StoredPatternProject) => boolean | void;
  onUpgrade?: () => void;
  /** Overrides the membership-derived canvas limit (crop tab only). */
  membershipLimit?: number;
  /** Community workspace opens straight into the region-copy tab. */
  initialMode?: 'practice' | 'crop';
  /** Timer key; defaults to `workKey`. Boards keep their editing work key so old timers survive. */
  timerKey?: string;
}

/** Undo only needs this session's additions; older entries are dropped to keep memory flat. */
const UNDO_LIMIT = 500;
/** Save progress after the user stops tapping, never on every single click. */
const SAVE_DEBOUNCE_MS = 400;

const SOURCE_LABEL: Record<PracticeSource, string> = {
  board: '我的画板',
  library: '我的图库',
  community: '来自豆社',
};

/** Never call the user's own board "read-only": it just isn't being modified here. */
const SOURCE_NOTE: Record<PracticeSource, string> = {
  board: '实操视图 · 不影响画板',
  library: '实操视图 · 不影响原图纸',
  community: '公开图纸 · 只读实操',
};

const SOURCE_NOTICE: Record<PracticeSource, string> = {
  board: '实操只记录已拼进度，不会改动画板内容。',
  library: '实操只记录已拼进度，不会改动图库里的原图纸。',
  community: '完整查看与实操不限图纸大小，不会修改原作品或当前画板。',
};

/** Bead/color summary shared by the dialog header and the practice panel. */
function summarizeGrid(grid: (string | null)[][]): { beads: number; colors: number } {
  const colors = new Set<string>();
  let beads = 0;
  for (const row of grid) for (const cell of row) if (cell !== null) { beads++; colors.add(cell); }
  return { beads, colors: colors.size };
}

function sourceIcon(source: PracticeSource) {
  if (source === 'community') return <Users size={12} aria-hidden="true" />;
  if (source === 'library') return <LibraryBig size={12} aria-hidden="true" />;
  return <Pencil size={12} aria-hidden="true" />;
}

/**
 * One practice surface for every entry point: the board, the user's library and the
 * community. Only the *source* changes what can be done (region copy + export are
 * community-only); the canvas, section guides, placed-bead recording, timer and
 * persistence are shared so every entry behaves identically.
 */
export function PracticeWorkspace({
  project, title, source, workKey, userId = null, onClose, onOpenInventory,
  onRequireLogin, onSelectProject, postId, onEdit, onUpgrade, membershipLimit, initialMode = 'practice', timerKey,
}: PracticeWorkspaceProps): React.ReactElement {
  const { isVip, isPro } = useAuth();
  const membership = useMemo(() => ({ isVip, isPro }), [isVip, isPro]);
  const limit = membershipLimit ?? canvasLimitForMembership(membership);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [exportOpen, setExportOpen] = useState(false);

  const paletteMap = useMemo<Map<string, BeadColor>>(
    () => new Map((project?.palette ?? []).map(color => [color.id, color])),
    [project],
  );
  const stats = useMemo(() => (project ? summarizeGrid(project.grid) : { beads: 0, colors: 0 }), [project]);

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      dialog?.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);

  const close = useCallback(() => {
    setExportOpen(false);
    onClose();
  }, [onClose]);

  // A pattern with zero beads is the same dead end as an empty board: show the picker
  // instead of a session whose every card would be empty. Only callers that can offer a
  // different pattern (onSelectProject) get that treatment.
  const canRepick = Boolean(onSelectProject);
  const showPicker = !project || (stats.beads === 0 && canRepick);
  const heading = showPicker ? '选一张图纸开始拼豆' : title;
  const chipLabel = showPicker ? '选择来源' : SOURCE_LABEL[source];
  const chipNote = showPicker ? '从我的图库或豆社作品选一张图纸，进度会单独记录' : SOURCE_NOTE[source];

  return <dialog ref={dialogRef} className={showPicker ? 'community-workspace is-picker' : 'community-workspace'} aria-labelledby={titleId} onCancel={event => {
    event.preventDefault();
    if (exportOpen) setExportOpen(false); else close();
  }}>
    <div className="community-workspace__shell" inert={exportOpen ? true : undefined}>
      <header className="community-workspace__header">
        <div className="community-workspace__identity">
          <span className="community-workspace__eyebrow">
            <span className="community-workspace__source-chip">{showPicker ? <LayoutGrid size={12} aria-hidden="true" /> : sourceIcon(source)}{chipLabel}</span>
            <span className="community-workspace__source-note">{chipNote}</span>
          </span>
          <h2 id={titleId} title={heading}>{heading}</h2>
          {/* Picker state has no dimensions to report, and the note above already
              explains where the patterns come from — no duplicate second line. */}
          {!showPicker && project && <p>{project.width} × {project.height} 格 <span>·</span> {stats.beads.toLocaleString()} 颗豆 <span>·</span> {stats.colors} 种颜色</p>}
        </div>
        <div className="community-workspace__header-actions">
          {!showPicker && project && source === 'community' && onEdit && <button type="button" className="community-workspace__button" onClick={() => setExportOpen(true)} aria-label="导出图纸"><Download size={16} aria-hidden="true" /><span>导出图纸</span></button>}
          <button type="button" className="community-workspace__close" aria-label="关闭实操" onClick={close}><X size={20} aria-hidden="true" /></button>
        </div>
      </header>
      <div className="community-workspace__notice">
        {source === 'community' ? <LockKeyhole size={14} aria-hidden="true" /> : <Timer size={14} aria-hidden="true" />}
        <p>
          {SOURCE_NOTICE[source]}
          {source === 'community' && <span> 当前账号编辑上限 {limit} × {limit} 格。</span>}
        </p>
      </div>
      {!showPicker && project
        ? <PracticeSession
          project={project}
          source={source}
          workKey={workKey}
          timerKey={timerKey ?? workKey}
          userId={userId}
          limit={limit}
          membership={membership}
          paletteMap={paletteMap}
          stats={stats}
          initialMode={initialMode}
          onClose={close}
          onOpenInventory={onOpenInventory}
          canCopyRegion={source === 'community' && Boolean(onEdit)}
          onEdit={onEdit}
          onUpgrade={onUpgrade}
        />
        : <PracticeSourcePicker
          userId={userId}
          onRequireLogin={onRequireLogin}
          onSelectProject={onSelectProject}
          onBack={close}
          notice={project && stats.beads === 0 ? '这张图纸还没有豆子，换一张试试' : null}
        />}
    </div>
    {!showPicker && project && <ExportModal isOpen={exportOpen} unlocked={true} onClose={() => setExportOpen(false)}
      grid={project.grid} paletteMap={paletteMap} width={project.width} height={project.height}
      boardSize={project.boardSize} brandName={project.brand} projectName={title} beadShape="square"
      activePalette={project.palette} activePatternId={null} settings={project.settings}
      archiveOnExport={false} onPatternArchived={() => {}} onOpenAuthModal={() => { setExportOpen(false); onUpgrade?.(); }} />}
  </dialog>;
}

interface PracticeSessionProps {
  project: StoredPatternProject;
  source: PracticeSource;
  workKey: string;
  timerKey: string;
  userId: string | null;
  limit: number;
  membership: { isVip?: boolean; isPro?: boolean };
  paletteMap: Map<string, BeadColor>;
  stats: { beads: number; colors: number };
  initialMode: 'practice' | 'crop';
  onClose: () => void;
  onOpenInventory: () => void;
  canCopyRegion: boolean;
  onEdit?: (project: StoredPatternProject) => boolean | void;
  onUpgrade?: () => void;
}

/** The canvas + sidebar body. Split out so the picker never mounts practice state. */
function PracticeSession({
  project, workKey, timerKey, userId, limit, membership, paletteMap, stats, initialMode,
  onClose, onOpenInventory, canCopyRegion, onEdit, onUpgrade,
}: PracticeSessionProps): React.ReactElement {
  const panelId = useId();
  const [mode, setMode] = useState<'practice' | 'crop'>(initialMode);
  const [selecting, setSelecting] = useState(initialMode === 'crop');
  const [highlightColor, setHighlightColor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [crop, setCrop] = useState<CommunityCropRect>(() => ({ x: 0, y: 0, width: Math.min(limit, project.width), height: Math.min(limit, project.height) }));

  // ---- Practice progress (placed beads) + section navigation -------------------------------
  const cellCount = project.width * project.height;
  const [doneCells, setDoneCells] = useState<ReadonlySet<number>>(() => loadPracticeProgress(workKey, cellCount - 1));
  const [undoCount, setUndoCount] = useState(0);
  const [sectionSize, setSectionSize] = useState<PracticeSectionSize>(DEFAULT_PRACTICE_SECTION_SIZE);
  const [focusedSection, setFocusedSection] = useState<string | null>(null);
  const [focusRect, setFocusRect] = useState<CommunityPatternFocusRect | null>(null);
  const [flashCell, setFlashCell] = useState<{ x: number; y: number; nonce: number } | null>(null);
  const nonceRef = useRef(0);
  const doneRef = useRef<ReadonlySet<number>>(doneCells);
  doneRef.current = doneCells;
  const undoStack = useRef<number[]>([]);
  const dirtyRef = useRef(false);
  const saveTimer = useRef<number | null>(null);
  const persistenceAvailable = useMemo(() => practiceProgressAvailable(), []);

  const scheduleSave = useCallback(() => {
    dirtyRef.current = true;
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null;
      if (dirtyRef.current) savePracticeProgress(workKey, doneRef.current);
    }, SAVE_DEBOUNCE_MS);
  }, [workKey]);

  // Flush on hide/unmount so closing the dialog never loses the last taps.
  useEffect(() => {
    const flush = () => {
      if (saveTimer.current !== null) {
        window.clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      if (dirtyRef.current) savePracticeProgress(workKey, doneRef.current);
    };
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [workKey]);

  // A different work (or a different grid size) starts from that work's own saved progress.
  // Indices that no longer point at a bead (re-published grid, swapped pattern) are dropped
  // here so the canvas veil and the panel counters share one definition of "placed".
  useEffect(() => {
    const loaded = loadPracticeProgress(workKey, cellCount - 1);
    const valid = new Set([...loaded].filter(index => {
      const x = index % project.width;
      const y = Math.floor(index / project.width);
      return project.grid[y]?.[x] != null;
    }));
    doneRef.current = valid;
    undoStack.current = [];
    dirtyRef.current = false;
    setDoneCells(valid);
    setUndoCount(0);
    setFocusedSection(null);
    setFocusRect(null);
    setFlashCell(null);
  }, [workKey, cellCount, project.width, project.grid]);

  // Small patterns have no meaningful blocks: an all-"—" minimap is noise, and the
  // canvas section guides would just draw lines across a handful of beads.
  const totalBeads = stats.beads;
  const showSections = totalBeads >= PRACTICE_MIN_BEADS_FOR_SECTIONS;
  const sections = useMemo(
    () => (showSections ? listPracticeSections(project.grid, doneCells, sectionSize) : []),
    [project.grid, doneCells, sectionSize, showSections],
  );
  const placedCount = useMemo(() => countPlacedBeads(project.grid, doneCells), [project.grid, doneCells]);
  const nextCell = useMemo(
    () => findNextUnplacedCell(project.grid, doneCells, highlightColor),
    [project.grid, doneCells, highlightColor],
  );

  const toggleCell = useCallback((index: number) => {
    const x = index % project.width;
    const y = Math.floor(index / project.width);
    if (project.grid[y]?.[x] == null) return;
    if (!doneRef.current.has(index)) {
      undoStack.current = [...undoStack.current.slice(-(UNDO_LIMIT - 1)), index];
      setUndoCount(undoStack.current.length);
    }
    setDoneCells(current => togglePracticeCell(current, index));
    scheduleSave();
  }, [project.grid, project.width, scheduleSave]);

  const undoLastCell = useCallback(() => {
    const stack = undoStack.current;
    while (stack.length) {
      const index = stack.pop() as number;
      if (!doneRef.current.has(index)) continue;
      setDoneCells(current => togglePracticeCell(current, index));
      setUndoCount(stack.length);
      scheduleSave();
      return;
    }
    setUndoCount(0);
  }, [scheduleSave]);

  const resetProgress = useCallback(() => {
    undoStack.current = [];
    setUndoCount(0);
    setDoneCells(new Set<number>());
    scheduleSave();
  }, [scheduleSave]);

  const focusSection = useCallback((label: string | null) => {
    if (!label) {
      setFocusedSection(null);
      setFocusRect(null);
      return;
    }
    const section = sections.find(item => item.label === label);
    if (!section || section.beads === 0) return;
    nonceRef.current += 1;
    setFocusedSection(label);
    setFocusRect({ x: section.x, y: section.y, width: section.width, height: section.height, nonce: nonceRef.current });
  }, [sections]);

  const nextIncompleteSection = useCallback(() => {
    const next = findNextIncompleteSection(sections, focusedSection);
    if (next) focusSection(next.label);
  }, [sections, focusedSection, focusSection]);

  const locateNextBead = useCallback(() => {
    if (!nextCell) return;
    // One nonce per user action: the focus and flash effects compare their own prop,
    // so sharing the value stays correct and keeps the two "targets" in lockstep.
    nonceRef.current += 1;
    const nonce = nonceRef.current;
    // A 12 × 12 window around the bead reads better than a single cell at max zoom.
    // No white veil here: a single bead is not a "section focus".
    setFocusRect({
      x: nextCell.x - 5.5, y: nextCell.y - 5.5, width: 12, height: 12,
      zoom: 18, nonce, dim: false,
    });
    setFlashCell({ x: nextCell.x, y: nextCell.y, nonce });
    const section = practiceSectionForCell(nextCell.x, nextCell.y, sectionSize);
    setFocusedSection(section.label);
  }, [nextCell, sectionSize]);

  const changeSectionSize = useCallback((size: PracticeSectionSize) => {
    setSectionSize(size);
    setFocusedSection(null);
    setFocusRect(null);
  }, []);

  useEffect(() => {
    setCrop(current => ({ ...current, width: Math.min(current.width, limit), height: Math.min(current.height, limit) }));
    setError(null);
  }, [limit]);

  const switchMode = (next: 'practice' | 'crop') => {
    setMode(next);
    setSelecting(next === 'crop');
    setHighlightColor(null);
    setError(null);
  };
  const updateCrop = (key: keyof CommunityCropRect, raw: string) => {
    if (!raw.trim() || !Number.isFinite(Number(raw))) return;
    const value = Math.floor(Number(raw));
    setCrop(current => {
      const next = { ...current };
      if (key === 'x') next.x = Math.max(0, Math.min(project.width - 1, value - 1));
      if (key === 'y') next.y = Math.max(0, Math.min(project.height - 1, value - 1));
      if (key === 'width') next.width = Math.max(1, Math.min(limit, value));
      if (key === 'height') next.height = Math.max(1, Math.min(limit, value));
      next.width = Math.min(next.width, project.width - next.x);
      next.height = Math.min(next.height, project.height - next.y);
      return next;
    });
    setError(null);
  };
  const edit = (selected: boolean) => {
    if (!onEdit) return;
    setError(null);
    try {
      if (!selected && !canEditCommunityPattern(project, membership)) throw new Error('当前账号最多编辑 ' + limit + ' × ' + limit + ' 格，请框选区域或升级。');
      const copy = selected ? cropCommunityPattern(project, crop, membership) : project;
      onEdit(copy);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法创建副本，请重新选择区域。');
    }
  };

  const progressBinding: PracticePanelProgress = {
    total: stats.beads,
    placed: placedCount,
    sections,
    sectionSize,
    focusedSection,
    hasNext: nextCell !== null,
    canUndo: undoCount > 0,
    persistenceAvailable,
    onToggleSectionSize: changeSectionSize,
    onFocusSection: focusSection,
    onNextSection: nextIncompleteSection,
    onUndo: undoLastCell,
    onLocateNext: locateNextBead,
    onReset: resetProgress,
  };
  const practiceMode = mode === 'practice';
  const canEditFull = canEditCommunityPattern(project, membership);
  // The sidebar is a labelled tab panel only when the region-copy tab exists (community).
  const panelAttrs = canCopyRegion
    ? { role: 'tabpanel' as const, id: panelId, 'aria-labelledby': panelId + (practiceMode ? '-practice-tab' : '-crop-tab') }
    : { role: 'region' as const, 'aria-label': '拼豆实操面板' };

  return <div className="community-workspace__content">
    <section className="community-workspace__canvas" aria-label="完整图纸实操视口">
      {mode === 'crop' && <div className="community-workspace__selection-tools" role="group" aria-label="框选操作方式">
        <button type="button" aria-pressed={selecting} onClick={() => setSelecting(true)}><Crop size={15} aria-hidden="true" />框选区域</button>
        <button type="button" aria-pressed={!selecting} onClick={() => setSelecting(false)}><Hand size={15} aria-hidden="true" />移动视图</button>
      </div>}
      <CommunityPatternCanvas project={project} highlightColorId={practiceMode ? highlightColor : null}
        readOnlyView={canCopyRegion}
        selection={mode === 'crop' ? crop : null} selecting={mode === 'crop' && selecting} maxSelectionSide={limit}
        sectionSize={showSections ? sectionSize : 0}
        doneCells={practiceMode ? doneCells : null}
        onToggleCell={practiceMode ? toggleCell : null}
        onUndoCell={practiceMode ? undoLastCell : null}
        focusRect={practiceMode ? focusRect : null}
        flashCell={practiceMode ? flashCell : null}
        onSelectionChange={selection => { setCrop(selection); setError(null); }} />
    </section>
    <aside className="community-workspace__sidebar">
      {canCopyRegion && <div className="community-workspace__tabs" role="tablist" aria-label="图纸使用方式">
        <button type="button" role="tab" aria-selected={practiceMode} id={panelId + '-practice-tab'} aria-controls={panelId} onClick={() => switchMode('practice')}><Timer size={16} aria-hidden="true" />拼豆实操</button>
        <button type="button" role="tab" aria-selected={!practiceMode} id={panelId + '-crop-tab'} aria-controls={panelId} onClick={() => switchMode('crop')}><Crop size={16} aria-hidden="true" />区域副本</button>
      </div>}
      <div className="community-workspace__panel" {...panelAttrs}>
        {practiceMode ? <PracticePanel grid={project.grid} paletteMap={paletteMap} workKey={timerKey}
          userId={userId} detailsUnlocked={true} activeColorId={highlightColor}
          onHighlightColor={setHighlightColor} onClose={onClose} onOpenInventory={onOpenInventory}
          progress={progressBinding} />
          : <div className="community-workspace__crop-panel">
            <h3>选一块，继续创作</h3>
            <p>在图纸上拖出选区，或输入准确坐标。只复制选中的豆格，不缩小、不重新配色。</p>
            <div className="community-workspace__crop-size" aria-live="polite">{crop.width} <span>×</span> {crop.height}<small>当前选区 · 格</small></div>
            <div className="community-workspace__crop-fields">
              <label>起始列<input type="number" min={1} max={project.width} value={crop.x + 1} onChange={event => updateCrop('x', event.target.value)} /></label>
              <label>起始行<input type="number" min={1} max={project.height} value={crop.y + 1} onChange={event => updateCrop('y', event.target.value)} /></label>
              <label>区域宽度<input type="number" min={1} max={Math.min(limit, project.width - crop.x)} value={crop.width} onChange={event => updateCrop('width', event.target.value)} /></label>
              <label>区域高度<input type="number" min={1} max={Math.min(limit, project.height - crop.y)} value={crop.height} onChange={event => updateCrop('height', event.target.value)} /></label>
            </div>
            <p className="community-workspace__crop-note">从第 {crop.y + 1} 行、第 {crop.x + 1} 列开始。当前账号单边最多 {limit} 格；原作品始终保留完整尺寸。</p>
            {error && <p role="alert" className="community-workspace__error">{error}</p>}
            <button type="button" className="community-workspace__button is-primary" onClick={() => edit(true)}><Pencil size={16} aria-hidden="true" />创建区域副本并编辑</button>
            <p className="community-workspace__crop-note">创建后将进入你的独立草稿；如画板有未保存修改，会先请你确认。</p>
            <div className="community-workspace__full-edit">
              {canEditFull
                ? <button type="button" className="community-workspace__button" onClick={() => edit(false)}>载入整张图纸编辑</button>
                : <><p>想编辑整张 {project.width} × {project.height} 图纸？</p><button type="button" className="community-workspace__button" onClick={onUpgrade}><Crown size={16} aria-hidden="true" />查看会员权益</button></>}
            </div>
          </div>}
      </div>
    </aside>
  </div>;
}

interface PracticeSourcePickerProps {
  userId: string | null;
  onRequireLogin?: () => void;
  onSelectProject?: (project: StoredPatternProject, meta: PracticeSelectionMeta) => void;
  onBack: () => void;
  /** Shown above the list, e.g. "the pattern you picked has no beads". */
  notice?: string | null;
}

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

/**
 * Library thumbnail: the stored preview blob when there is one, else the remote
 * thumbnail, else the striped placeholder. Object URLs are always revoked.
 */
function LibraryThumb({ record, userId }: { record: ExportedPatternRecord; userId: string | null }): React.ReactElement {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  useEffect(() => {
    if (record.thumbnailUrl || !record.hasPreview) return;
    let disposed = false;
    let created: string | null = null;
    const pending = record.previewBlob
      ? Promise.resolve(record.previewBlob)
      : record.cloudRevision ? getExportedPatternPreview(record.id, record.cloudRevision, userId) : Promise.resolve(null);
    void pending.then(blob => {
      if (disposed || !blob) return;
      created = URL.createObjectURL(blob);
      setObjectUrl(created);
    }).catch(() => { /* the placeholder is a fine fallback */ });
    return () => {
      disposed = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [record, userId]);
  if (record.thumbnailUrl) return <img src={record.thumbnailUrl} alt="" loading="lazy" />;
  if (objectUrl) return <img src={objectUrl} alt="" loading="lazy" />;
  return <span className="community-workspace__picker-placeholder" />;
}

/**
 * Empty state for "practise but nothing to practise yet". Never tells the user to go
 * draw first: an existing pattern from the library or the community is one tap away.
 */
function PracticeSourcePicker({ userId, onRequireLogin, onSelectProject, onBack, notice = null }: PracticeSourcePickerProps): React.ReactElement {
  const tabId = useId();
  const panelId = useId();
  // The library needs an account, so signed-out users land on the community list.
  const [tab, setTab] = useState<'library' | 'community'>(userId ? 'library' : 'community');
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [records, setRecords] = useState<ExportedPatternRecord[]>([]);
  const [libraryState, setLibraryState] = useState<LoadState>('idle');
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [openingKey, setOpeningKey] = useState<string | null>(null);
  const feed = useCommunityFeed(userId);

  useEffect(() => {
    if (!userId) {
      setRecords([]);
      setLibraryState('idle');
      setLibraryError(null);
      return;
    }
    let cancelled = false;
    setLibraryState('loading');
    setLibraryError(null);
    getUserExportedPatterns(userId).then(list => {
      if (cancelled) return;
      setRecords(list);
      setLibraryState('ready');
    }).catch((cause: unknown) => {
      if (cancelled) return;
      setLibraryError(cause instanceof Error ? cause.message : '图库读取失败，请稍后重试');
      setLibraryState('error');
    });
    return () => { cancelled = true; };
  }, [userId, reloadKey]);

  const pickLibraryRecord = async (record: ExportedPatternRecord) => {
    if (!userId || openingKey !== null || !onSelectProject) return;
    setInlineError(null);
    setOpeningKey('library:' + record.id);
    try {
      const project = await getPatternProject(record.id, userId);
      onSelectProject(project, { source: 'library', title: record.title, workKey: 'library:' + record.id });
    } catch (cause) {
      setInlineError(cause instanceof Error ? cause.message : '图纸读取失败，请重试');
    } finally {
      setOpeningKey(null);
    }
  };

  const pickCommunityPost = async (post: CommunityPost) => {
    if (openingKey !== null || !onSelectProject) return;
    setInlineError(null);
    setOpeningKey('community:' + post.id);
    try {
      const result = await getCommunityPost(post.id);
      if (!result.ok || !result.data) throw new Error(result.error ?? '作品详情暂时无法加载');
      const loaded = await loadCommunityPattern(result.data, userId ?? undefined);
      if (!loaded.project) {
        setInlineError('这条作品只有展示图，作者未发布完整图纸。');
        return;
      }
      onSelectProject(loaded.project, {
        source: 'community', title: post.title, workKey: 'community:' + post.id, postId: post.id,
      });
    } catch (cause) {
      setInlineError(cause instanceof Error ? cause.message : '图纸加载失败，请重试');
    } finally {
      setOpeningKey(null);
    }
  };

  /** Loading uses six placeholder cards: the grid keeps its size (no layout shift). */
  const skeletonPane = (label: string) => <div role="status" aria-live="polite">
    <span className="community-workspace__sr-only">{label}</span>
    <ul className="community-workspace__picker-grid" aria-hidden="true">
      {Array.from({ length: 6 }, (_, index) => <li key={index}>
        <span className="community-workspace__picker-card is-skeleton">
          <span className="community-workspace__picker-thumb" />
          <span className="community-workspace__picker-title">&nbsp;</span>
          <span className="community-workspace__picker-meta">&nbsp;</span>
        </span>
      </li>)}
    </ul>
  </div>;

  /** Empty / error states live inside the grid so the page never jumps. */
  const statusPane = (icon: React.ReactNode, message: string, action?: React.ReactNode, alert = false) => (
    <ul className="community-workspace__picker-grid">
      <li className="community-workspace__picker-block">
        <span aria-hidden="true">{icon}</span>
        <p role={alert ? 'alert' : undefined}>{message}</p>
        {action}
      </li>
    </ul>
  );

  const libraryPane = !userId
    ? statusPane(<LibraryBig size={24} />, '登录后可读取我的图库',
      <button type="button" className="community-workspace__button" onClick={onRequireLogin} disabled={!onRequireLogin}>现在登录</button>)
    : libraryState === 'loading'
      ? skeletonPane('正在读取我的图库…')
      : libraryState === 'error'
        ? statusPane(<RefreshCw size={24} />, libraryError ?? '图库读取失败，请稍后重试',
          <button type="button" className="community-workspace__button" onClick={() => setReloadKey(value => value + 1)}><RefreshCw size={15} aria-hidden="true" />重试</button>, true)
        : records.length === 0
          ? statusPane(<LibraryBig size={24} />, '图库还是空的，先去豆社找一张图纸',
            <button type="button" className="community-workspace__button" onClick={() => { setTab('community'); setInlineError(null); }}><Users size={15} aria-hidden="true" />去豆社看看</button>)
          : <ul className="community-workspace__picker-grid">
            {records.map(record => <li key={record.id}>
              <button type="button"
                className={'community-workspace__picker-card' + (openingKey === 'library:' + record.id ? ' is-opening' : '')}
                disabled={openingKey !== null}
                onClick={() => void pickLibraryRecord(record)} title={record.title}
                aria-label={`${record.title}，${record.width} × ${record.height} 格`}>
                <span className="community-workspace__picker-thumb" aria-hidden="true">
                  <LibraryThumb record={record} userId={userId} />
                  {openingKey === 'library:' + record.id && <span className="community-workspace__picker-loading"><Loader2 size={22} className="is-spinning" /></span>}
                </span>
                <span className="community-workspace__picker-title">{record.title}</span>
                <span className="community-workspace__picker-meta">{record.width} × {record.height}</span>
              </button>
            </li>)}
          </ul>;

  const communityPane = feed.isLoading
    ? skeletonPane('正在加载豆社作品…')
    : feed.error
      ? statusPane(<RefreshCw size={24} />, feed.error,
        <button type="button" className="community-workspace__button" onClick={() => void feed.refresh()}><RefreshCw size={15} aria-hidden="true" />重试</button>, true)
      : feed.posts.length === 0
        ? statusPane(<Users size={24} />, '豆社还没有可实操的作品',
          <button type="button" className="community-workspace__button" onClick={() => void feed.refresh()}><RefreshCw size={15} aria-hidden="true" />刷新看看</button>)
        : <ul className="community-workspace__picker-grid">
          {feed.posts.map(post => {
            const specs = post.specs ?? null;
            return <li key={post.id}>
              <button type="button"
                className={'community-workspace__picker-card' + (openingKey === 'community:' + post.id ? ' is-opening' : '')}
                disabled={openingKey !== null}
                onClick={() => void pickCommunityPost(post)} title={post.title}
                aria-label={`${post.title}${specs ? `，${specs.gridWidth} × ${specs.gridHeight} 格` : ''}`}>
                <span className="community-workspace__picker-thumb" aria-hidden="true">
                  {post.imageUrl
                    ? <img src={post.imageUrl} alt="" loading="lazy" />
                    : <span className="community-workspace__picker-placeholder" />}
                  {openingKey === 'community:' + post.id && <span className="community-workspace__picker-loading"><Loader2 size={22} className="is-spinning" /></span>}
                </span>
                <span className="community-workspace__picker-title">{post.title}</span>
                <span className="community-workspace__picker-meta">{specs ? `${specs.gridWidth} × ${specs.gridHeight} 格` : '豆社作品'}</span>
              </button>
            </li>;
          })}
        </ul>;

  return <section className="community-workspace__picker" aria-label="选择实操图纸">
    {/* Segmented control: equal halves, real tab semantics for AT. */}
    <div className="community-workspace__picker-tabs" role="tablist" aria-label="图纸来源">
      <button type="button" role="tab" aria-selected={tab === 'library'}
        id={tabId + '-library'} aria-controls={panelId}
        onClick={() => { setTab('library'); setInlineError(null); }}><LibraryBig size={15} aria-hidden="true" />我的图库</button>
      <button type="button" role="tab" aria-selected={tab === 'community'}
        id={tabId + '-community'} aria-controls={panelId}
        onClick={() => { setTab('community'); setInlineError(null); }}><Users size={15} aria-hidden="true" />豆社作品</button>
    </div>
    {(inlineError ?? notice) && <p role="alert" className="community-workspace__error community-workspace__picker-alert">{inlineError ?? notice}</p>}
    <div className="community-workspace__picker-body" role="tabpanel" id={panelId}
      aria-labelledby={tabId + (tab === 'library' ? '-library' : '-community')}>
      {tab === 'library' ? libraryPane : communityPane}
    </div>
    <footer className="community-workspace__picker-footer">
      <span>也可以</span>
      <button type="button" className="community-workspace__picker-link" onClick={onBack}>返回画板自己画</button>
    </footer>
  </section>;
}

export default PracticeWorkspace;
