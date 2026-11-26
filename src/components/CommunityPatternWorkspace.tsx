import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Crop, Crown, Download, Hand, LockKeyhole, Pencil, Timer, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import type { StoredPatternProject } from '../utils/patternGridCodec';
import { canvasLimitForMembership, canEditCommunityPattern, cropCommunityPattern, type CommunityCropRect } from '../utils/communityPatternAccess';
import { CommunityPatternCanvas, type CommunityPatternFocusRect } from './CommunityPatternCanvas';
import { PracticePanel, type PracticePanelProgress } from './PracticePanel';
import { ExportModal } from './ExportModal';
import {
  DEFAULT_PRACTICE_SECTION_SIZE, countPlacedBeads, findNextIncompleteSection, findNextUnplacedCell,
  listPracticeSections, loadPracticeProgress, practiceProgressAvailable, practiceSectionForCell,
  savePracticeProgress, togglePracticeCell, type PracticeSectionSize,
} from '../utils/practiceProgress';
import './CommunityPatternWorkspace.css';

interface CommunityPatternWorkspaceProps {
  project: StoredPatternProject;
  postId: string;
  title: string;
  initialMode?: 'practice' | 'crop';
  onClose: () => void;
  onEdit: (project: StoredPatternProject) => boolean | void;
  onUpgrade: () => void;
  onOpenInventory: () => void;
}

/** Undo only needs this session's additions; older entries are dropped to keep memory flat. */
const UNDO_LIMIT = 500;
/** Save progress after the user stops tapping, never on every single click. */
const SAVE_DEBOUNCE_MS = 400;

export function CommunityPatternWorkspace({ project, postId, title, initialMode = 'practice', onClose, onEdit, onUpgrade, onOpenInventory }: CommunityPatternWorkspaceProps) {
  const { currentUser, isVip, isPro } = useAuth();
  const membership = { isVip, isPro };
  const limit = canvasLimitForMembership(membership);
  const canEditFull = canEditCommunityPattern(project, membership);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [mode, setMode] = useState(initialMode);
  const [selecting, setSelecting] = useState(initialMode === 'crop');
  const [highlightColor, setHighlightColor] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [crop, setCrop] = useState<CommunityCropRect>(() => ({ x: 0, y: 0, width: Math.min(limit, project.width), height: Math.min(limit, project.height) }));
  const paletteMap = useMemo(() => new Map(project.palette.map(color => [color.id, color])), [project.palette]);
  const stats = useMemo(() => {
    const colors = new Set<string>();
    let count = 0;
    for (const row of project.grid) for (const cell of row) if (cell !== null) { count++; colors.add(cell); }
    return { beads: count, colors: colors.size };
  }, [project.grid]);

  // ---- Practice progress (placed beads) + section navigation -------------------------------
  const workKey = 'community:' + postId;
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

  // A different post (or a different grid size) starts from that work's own saved progress.
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

  const sections = useMemo(
    () => listPracticeSections(project.grid, doneCells, sectionSize),
    [project.grid, doneCells, sectionSize],
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
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      dialog?.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
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

  return <dialog ref={dialogRef} className="community-workspace" aria-labelledby={titleId} onCancel={event => {
    event.preventDefault();
    if (exportOpen) setExportOpen(false); else onClose();
  }}>
    <div className="community-workspace__shell" inert={exportOpen ? true : undefined}>
      <header className="community-workspace__header">
        <div className="community-workspace__identity">
          <span className="community-workspace__eyebrow"><LockKeyhole size={12} /> 公开图纸 · 只读实操</span>
          <h2 id={titleId}>{title}</h2>
          <p>{project.width} × {project.height} 格 <span>·</span> {stats.beads.toLocaleString()} 颗豆 <span>·</span> {stats.colors} 种颜色</p>
        </div>
        <div className="community-workspace__header-actions">
          <button type="button" className="community-workspace__button" onClick={() => setExportOpen(true)} aria-label="导出图纸"><Download size={16} /><span>导出图纸</span></button>
          <button type="button" className="community-workspace__close" aria-label="关闭只读图纸" onClick={onClose}><X size={20} /></button>
        </div>
      </header>
      <div className="community-workspace__notice">
        <LockKeyhole size={14} />
        <p>完整查看与实操不限图纸大小，不会修改原作品或当前画板。<span> 当前账号编辑上限 {limit} × {limit} 格。</span></p>
      </div>
      <div className="community-workspace__content">
        <section className="community-workspace__canvas" aria-label="完整图纸只读视口">
          {mode === 'crop' && <div className="community-workspace__selection-tools" role="group" aria-label="框选操作方式">
            <button type="button" aria-pressed={selecting} onClick={() => setSelecting(true)}><Crop size={15} />框选区域</button>
            <button type="button" aria-pressed={!selecting} onClick={() => setSelecting(false)}><Hand size={15} />移动视图</button>
          </div>}
          <CommunityPatternCanvas project={project} highlightColorId={practiceMode ? highlightColor : null}
            selection={mode === 'crop' ? crop : null} selecting={mode === 'crop' && selecting} maxSelectionSide={limit}
            sectionSize={sectionSize}
            doneCells={practiceMode ? doneCells : null}
            onToggleCell={practiceMode ? toggleCell : null}
            onUndoCell={practiceMode ? undoLastCell : null}
            focusRect={practiceMode ? focusRect : null}
            flashCell={practiceMode ? flashCell : null}
            onSelectionChange={selection => { setCrop(selection); setError(null); }} />
        </section>
        <aside className="community-workspace__sidebar">
          <div className="community-workspace__tabs" role="tablist" aria-label="图纸使用方式">
            <button type="button" role="tab" aria-selected={mode === 'practice'} id={titleId + '-practice-tab'} aria-controls={titleId + '-panel'} onClick={() => switchMode('practice')}><Timer size={16} />拼豆实操</button>
            <button type="button" role="tab" aria-selected={mode === 'crop'} id={titleId + '-crop-tab'} aria-controls={titleId + '-panel'} onClick={() => switchMode('crop')}><Crop size={16} />区域副本</button>
          </div>
          <div role="tabpanel" id={titleId + '-panel'} aria-labelledby={titleId + (practiceMode ? '-practice-tab' : '-crop-tab')} className="community-workspace__panel">
            {practiceMode ? <PracticePanel grid={project.grid} paletteMap={paletteMap} workKey={workKey}
              userId={currentUser?.uid ?? null} detailsUnlocked={true} activeColorId={highlightColor}
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
                <button type="button" className="community-workspace__button is-primary" onClick={() => edit(true)}><Pencil size={16} />创建区域副本并编辑</button>
                <p className="community-workspace__crop-note">创建后将进入你的独立草稿；如画板有未保存修改，会先请你确认。</p>
                <div className="community-workspace__full-edit">
                  {canEditFull
                    ? <button type="button" className="community-workspace__button" onClick={() => edit(false)}>载入整张图纸编辑</button>
                    : <><p>想编辑整张 {project.width} × {project.height} 图纸？</p><button type="button" className="community-workspace__button" onClick={onUpgrade}><Crown size={16} />查看会员权益</button></>}
                </div>
              </div>}
          </div>
        </aside>
      </div>
    </div>
    <ExportModal isOpen={exportOpen} unlocked={true} onClose={() => setExportOpen(false)}
      grid={project.grid} paletteMap={paletteMap} width={project.width} height={project.height}
      boardSize={project.boardSize} brandName={project.brand} projectName={title} beadShape="square"
      activePalette={project.palette} activePatternId={null} settings={project.settings}
      archiveOnExport={false} onPatternArchived={() => {}} onOpenAuthModal={() => { setExportOpen(false); onUpgrade(); }} />
  </dialog>;
}
