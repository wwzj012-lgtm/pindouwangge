import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Crop, Crown, Download, Hand, LockKeyhole, Pencil, Timer, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import type { StoredPatternProject } from '../utils/patternGridCodec';
import { canvasLimitForMembership, canEditCommunityPattern, cropCommunityPattern, type CommunityCropRect } from '../utils/communityPatternAccess';
import { CommunityPatternCanvas } from './CommunityPatternCanvas';
import { PracticePanel } from './PracticePanel';
import { ExportModal } from './ExportModal';
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
          <CommunityPatternCanvas project={project} highlightColorId={mode === 'practice' ? highlightColor : null}
            selection={mode === 'crop' ? crop : null} selecting={mode === 'crop' && selecting} maxSelectionSide={limit}
            onSelectionChange={selection => { setCrop(selection); setError(null); }} />
        </section>
        <aside className="community-workspace__sidebar">
          <div className="community-workspace__tabs" role="tablist" aria-label="图纸使用方式">
            <button type="button" role="tab" aria-selected={mode === 'practice'} id={titleId + '-practice-tab'} aria-controls={titleId + '-panel'} onClick={() => switchMode('practice')}><Timer size={16} />拼豆实操</button>
            <button type="button" role="tab" aria-selected={mode === 'crop'} id={titleId + '-crop-tab'} aria-controls={titleId + '-panel'} onClick={() => switchMode('crop')}><Crop size={16} />区域副本</button>
          </div>
          <div role="tabpanel" id={titleId + '-panel'} aria-labelledby={titleId + (mode === 'practice' ? '-practice-tab' : '-crop-tab')} className="community-workspace__panel">
            {mode === 'practice' ? <PracticePanel grid={project.grid} paletteMap={paletteMap} workKey={'community:' + postId}
              userId={currentUser?.uid ?? null} detailsUnlocked={true} activeColorId={highlightColor}
              onHighlightColor={setHighlightColor} onClose={onClose} onOpenInventory={onOpenInventory} />
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
