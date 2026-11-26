import React, { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowRight, Check, Copy, Crosshair, Grid2X2, LockKeyhole, Package, Pause, Play,
  RotateCcw, Search, Timer, Trash2, Undo2, X,
} from 'lucide-react';
import type { BeadColor } from '../types';
import { getBeadInventorySnapshot, getServerBeadInventorySnapshot, subscribeBeadInventory } from '../utils/beadInventory';
import { buildPracticePlan, createPracticeRestockList, filterPracticeRequirements } from '../utils/practiceInventory';
import { createPracticeTimer, formatPracticeDuration } from '../utils/practiceTimer';
import {
  PRACTICE_SECTION_SIZES, findSectionByLabel, practiceMinimapColumns, practiceSectionLetter,
  type PracticeSection, type PracticeSectionSize,
} from '../utils/practiceProgress';
import './PracticePanel.css';

/** Placed-bead binding owned by the workspace (the panel stays a pure view). */
export interface PracticePanelProgress {
  /** Beads in the whole pattern. */
  total: number;
  /** Beads already placed. */
  placed: number;
  sections: PracticeSection[];
  sectionSize: PracticeSectionSize;
  /** Label of the focused section, or null for "all". */
  focusedSection: string | null;
  /** Any bead still unplaced (drives "locate next"). */
  hasNext: boolean;
  canUndo: boolean;
  persistenceAvailable: boolean;
  onToggleSectionSize: (size: PracticeSectionSize) => void;
  onFocusSection: (label: string | null) => void;
  onNextSection: () => void;
  onUndo: () => void;
  onLocateNext: () => void;
  onReset: () => void;
}

export interface PracticePanelProps {
  grid: (string | null)[][];
  paletteMap: Map<string, BeadColor>;
  workKey: string;
  userId?: string | null;
  detailsUnlocked: boolean;
  activeColorId: string | null;
  onHighlightColor: (id: string | null) => void;
  onClose: () => void;
  onOpenInventory: () => void;
  /** Progress + section tracking. Omitted by callers that only need the color/timer tools. */
  progress?: PracticePanelProgress | null;
}

/** A section button grid stays readable (and cheap) only up to this many sections. */
const MINIMAP_LIMIT = 400;
/** Used before the real geometry is known (no progress binding). */
const PRACTICE_MINIMAP_FALLBACK_COLUMNS = 7;

const sectionPercent = (section: PracticeSection): number =>
  section.beads > 0 ? Math.round(section.placed / section.beads * 100) : 0;

export function PracticePanel({
  grid, paletteMap, workKey, userId, detailsUnlocked, activeColorId,
  onHighlightColor, onClose, onOpenInventory, progress = null,
}: PracticePanelProps): React.ReactElement {
  const titleId = useId();
  const searchId = useId();
  const inventory = useSyncExternalStore(subscribeBeadInventory, getBeadInventorySnapshot, getServerBeadInventorySnapshot);
  const plan = useMemo(() => buildPracticePlan(grid, paletteMap, inventory, detailsUnlocked),
    [grid, paletteMap, inventory, detailsUnlocked]);
  const clock = useMemo(() => createPracticeTimer(workKey, userId), [workKey, userId]);
  const [, refreshClock] = useState(0);
  const [search, setSearch] = useState('');
  const [shortagesOnly, setShortagesOnly] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'manual'>('idle');
  const [resetPrompt, setResetPrompt] = useState(false);
  const [progressResetPrompt, setProgressResetPrompt] = useState(false);
  /** Short-lived inline feedback ("this block has no beads") instead of a dead button. */
  const [sectionHint, setSectionHint] = useState<string | null>(null);
  const sectionHintTimer = useRef<number | null>(null);
  const resetDialogRef = useRef<HTMLDialogElement>(null);
  const progressDialogRef = useRef<HTMLDialogElement>(null);
  const resetTriggerRef = useRef<HTMLButtonElement>(null);
  const progressTriggerRef = useRef<HTMLButtonElement>(null);
  const resetTitleId = useId();
  const progressTitleId = useId();
  useEffect(() => {
    const dialog = resetDialogRef.current;
    if (resetPrompt && dialog && !dialog.open) dialog.showModal();
    else if (!resetPrompt && dialog?.open) dialog.close();
  }, [resetPrompt]);
  useEffect(() => {
    const dialog = progressDialogRef.current;
    if (!progress) return;
    if (progressResetPrompt && dialog && !dialog.open) dialog.showModal();
    else if (!progressResetPrompt && dialog?.open) dialog.close();
  }, [progressResetPrompt, progress]);
  useEffect(() => { setResetPrompt(false); }, [workKey, userId, detailsUnlocked]);
  useEffect(() => { setProgressResetPrompt(false); }, [workKey, userId, detailsUnlocked]);
  const dismissReset = () => {
    resetDialogRef.current?.close();
    setResetPrompt(false);
    resetTriggerRef.current?.focus();
  };
  const dismissProgressReset = () => {
    progressDialogRef.current?.close();
    setProgressResetPrompt(false);
    progressTriggerRef.current?.focus();
  };
  const running = clock.isRunning();
  const rows = useMemo(() => filterPracticeRequirements(plan.rows, search, shortagesOnly), [plan, search, shortagesOnly]);
  const restockList = detailsUnlocked ? createPracticeRestockList(plan) : '';
  const totals = useMemo(() => plan.rows.reduce((sum, row) => ({
    stock: sum.stock + row.stock,
    remaining: sum.remaining + row.remaining,
    shortage: sum.shortage + row.shortage,
  }), { stock: 0, remaining: 0, shortage: 0 }), [plan]);

  const focusedSection = progress ? findSectionByLabel(progress.sections, progress.focusedSection) : null;
  const progressTotal = progress?.total ?? 0;
  const progressPlaced = progress?.placed ?? 0;
  const progressPercent = progressTotal > 0 ? Math.round(progressPlaced / progressTotal * 100) : 0;
  const allComplete = Boolean(progress && progress.sections.length > 0
    && progress.sections.every(section => section.placed >= section.beads));

  useEffect(() => {
    const pause = () => { clock.pause(); refreshClock(value => value + 1); };
    window.addEventListener('pagehide', pause);
    return () => {
      window.removeEventListener('pagehide', pause);
      clock.pause();
    };
  }, [clock]);

  useEffect(() => {
    if (!running) return;
    let ticks = 0;
    const interval = window.setInterval(() => {
      if (++ticks % 4 === 0) clock.checkpoint();
      refreshClock(value => value + 1);
    }, 250);
    return () => window.clearInterval(interval);
  }, [clock, running]);

  useEffect(() => {
    if (!detailsUnlocked) {
      clock.pause();
      refreshClock(value => value + 1);
    }
  }, [clock, detailsUnlocked]);

  useEffect(() => { setCopyState('idle'); }, [restockList, workKey, userId, detailsUnlocked]);
  useEffect(() => () => {
    if (sectionHintTimer.current !== null) window.clearTimeout(sectionHintTimer.current);
  }, []);

  const announceEmptySection = (label: string) => {
    setSectionHint(`区块 ${label} 没有豆子，可直接跳过`);
    if (sectionHintTimer.current !== null) window.clearTimeout(sectionHintTimer.current);
    sectionHintTimer.current = window.setTimeout(() => {
      sectionHintTimer.current = null;
      setSectionHint(null);
    }, 2600);
  };

  const close = () => {
    clock.pause();
    refreshClock(value => value + 1);
    onClose();
  };
  const toggleTimer = () => {
    if (clock.isRunning()) clock.pause();
    else clock.start();
    refreshClock(value => value + 1);
  };
  const resetTimer = () => {
    if (clock.getElapsedMs() > 0) { setResetPrompt(true); return; }
    clock.reset();
    refreshClock(value => value + 1);
  };
  const copyRestockList = async () => {
    if (!detailsUnlocked || !restockList) return;
    try {
      await navigator.clipboard.writeText(restockList);
      setCopyState('copied');
    } catch {
      setCopyState('manual');
    }
  };

  // 小地图列数镜像真实区块几何（121/20=7 列；121/25=5 列），最多 7 列避免格子过窄
  const minimapColumns = progress
    ? practiceMinimapColumns(grid[0]?.length ?? 0, progress.sectionSize)
    : PRACTICE_MINIMAP_FALLBACK_COLUMNS;
  // 超过小地图上限时退回原生下拉，按行字母分组成 <optgroup>，且不截断任何区块
  const sectionGroups = useMemo(() => {
    if (!progress) return [];
    const groups: { row: number; label: string; items: PracticeSection[] }[] = [];
    for (const section of progress.sections) {
      const last = groups[groups.length - 1];
      if (last && last.row === section.row) last.items.push(section);
      else groups.push({ row: section.row, label: `${practiceSectionLetter(section.row)} 行`, items: [section] });
    }
    return groups;
  }, [progress]);
  const minimap = progress ? (progress.sections.length > MINIMAP_LIMIT ? (
    <label className="practice-panel__section-select">
      <span>跳到区块</span>
      <select
        value={progress.focusedSection ?? ''}
        aria-label="跳到指定区块"
        onChange={event => progress.onFocusSection(event.target.value || null)}
      >
        <option value="">全部（不过滤）</option>
        {sectionGroups.map(group => (
          <optgroup key={group.row} label={group.label}>
            {group.items.map(section => (
              <option key={section.label} value={section.label}>
                {section.label} · 已拼 {section.placed} / {section.beads}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <small>区块过多，已改为按行分组的下拉跳转；全部 {progress.sections.length} 个区块均可选择。</small>
    </label>
  ) : (
    <div className="practice-panel__minimap" role="group" aria-label="区块小地图"
      style={{ '--minimap-cols': minimapColumns } as React.CSSProperties}>
      {progress.sections.map(section => {
        const percent = sectionPercent(section);
        const complete = section.beads > 0 && section.placed >= section.beads;
        const empty = section.beads === 0;
        return (
          <button
            key={section.label}
            type="button"
            className={`practice-panel__minimap-cell${complete ? ' is-complete' : ''}${empty ? ' is-empty' : ''}`}
            aria-pressed={progress.focusedSection === section.label}
            aria-label={empty
              ? `区块 ${section.label}，无豆，可直接跳过`
              : `区块 ${section.label}，需 ${section.beads} 粒，已拼 ${section.placed} 粒，完成 ${percent}%`}
            title={empty ? `区块 ${section.label} 无豆` : undefined}
            onClick={() => {
              if (empty) { announceEmptySection(section.label); return; }
              progress.onFocusSection(progress.focusedSection === section.label ? null : section.label);
            }}
          >
            <span className="practice-panel__minimap-label">{section.label}</span>
            <em className="practice-panel__minimap-value">{empty ? '—' : `${percent}%`}</em>
            <i className="practice-panel__minimap-bar" aria-hidden="true"><b style={{ width: `${percent}%` }} /></i>
          </button>
        );
      })}
    </div>
  )) : null;

  return (
    <aside className="practice-panel" aria-labelledby={titleId} onKeyDown={event => {
      if (event.key === 'Escape') { event.stopPropagation(); close(); }
    }}>
      <header className="practice-panel__header">
        <div>
          <h2 id={titleId}><Timer size={19} aria-hidden="true" /> 拼豆实操</h2>
          <p className="practice-panel__subtitle">专注摆豆，轻松找色</p>
        </div>
        <button type="button" className="practice-panel__icon-button" onClick={close} aria-label="关闭实操面板"><X size={20} /></button>
      </header>

      <div className="practice-panel__body">
        {plan.total > 0 && <dl className="practice-panel__overview" aria-label="作品总览">
          <div><dt>作品用豆</dt><dd>{plan.total.toLocaleString()}<small>粒</small></dd></div>
          <div><dt>使用颜色</dt><dd>{plan.colorCount.toLocaleString()}<small>种</small></dd></div>
        </dl>}

        {plan.total === 0 ? <section className="practice-panel__welcome" aria-label="空画板引导">
          <div className="practice-panel__illustration" aria-hidden="true"><Grid2X2 size={40}/><i/><i/><i/></div>
          <h3>从一张图纸开始</h3>
          <p>先在画板中绘制，或导入图纸。<br/>准备好后，就可以开始你的拼豆时光。</p>
          <button type="button" className="practice-panel__primary" onClick={close}>返回画板</button>
          <div className="practice-panel__welcome-features"><span><Timer size={15}/>专注计时</span><span><Search size={15}/>同色定位</span><span><Package size={15}/>备豆检查</span></div>
        </section> : !detailsUnlocked ? (
          <section className="practice-panel__locked" aria-label="需要解锁">
            <LockKeyhole size={24} aria-hidden="true" />
            <h3>解锁后开启实操</h3>
            <p>解锁作品详情后，即可查看色号、每色用量、库存缺口并使用实操计时。</p>
          </section>
        ) : (
          <>
            {progress && <section className="practice-panel__progress" aria-label="拼豆进度">
              <div className="practice-panel__section-heading">
                <h3>拼豆进度</h3>
                <span className="practice-panel__note">{progressPlaced.toLocaleString()} / {progressTotal.toLocaleString()} 粒</span>
              </div>
              <div
                className="practice-panel__progress-track"
                role="progressbar"
                aria-label="已拼豆粒进度"
                aria-valuemin={0}
                aria-valuemax={progressTotal}
                aria-valuenow={progressPlaced}
                aria-valuetext={`已拼 ${progressPlaced.toLocaleString()} / ${progressTotal.toLocaleString()}（${progressPercent}%）`}
              >
                <span className="practice-panel__progress-fill" style={{ width: `${progressPercent}%` }} />
              </div>
              <p className="practice-panel__progress-summary">
                已拼 <strong>{progressPlaced.toLocaleString()}</strong> / {progressTotal.toLocaleString()}（{progressPercent}%）
              </p>
              <p className="practice-panel__progress-split">
                待拼 {(progressTotal - progressPlaced).toLocaleString()} 粒
              </p>
              {focusedSection && <p className="practice-panel__progress-focus" aria-live="polite">
                {focusedSection.label} · 需 {focusedSection.beads.toLocaleString()} 粒 · 已拼 {focusedSection.placed.toLocaleString()}
              </p>}
              <div className="practice-panel__progress-actions">
                <button type="button" className="practice-panel__chip" onClick={progress.onUndo} disabled={!progress.canUndo} aria-label="撤销上一颗已拼豆">
                  <Undo2 size={16} aria-hidden="true" />撤销上一颗
                </button>
                <button type="button" className="practice-panel__chip" onClick={progress.onLocateNext} disabled={!progress.hasNext}
                  aria-label={progress.hasNext ? '定位下一颗未拼豆' : '已全部拼完'}>
                  <Crosshair size={16} aria-hidden="true" />{progress.hasNext ? '定位下一颗' : '已全部拼完'}
                </button>
                <button ref={progressTriggerRef} type="button" className="practice-panel__chip is-danger" onClick={() => setProgressResetPrompt(true)} aria-label="重置拼豆进度">
                  <Trash2 size={16} aria-hidden="true" />重置进度
                </button>
              </div>
              {!progress.persistenceAvailable && <p className="practice-panel__warning" role="status">本地存储不可用，拼豆进度仅在本次打开期间保留。</p>}
            </section>}

            {progress && <section className="practice-panel__sections" aria-label="区块推进">
              <div className="practice-panel__section-heading">
                <h3>区块推进 <small>{progress.sections.length} 区块</small></h3>
                <span className="practice-panel__note">点击区块聚焦</span>
              </div>
              <div className="practice-panel__segmented" role="group" aria-label="区块大小（格）">
                {PRACTICE_SECTION_SIZES.map(size => (
                  <button key={size} type="button" aria-pressed={progress.sectionSize === size}
                    aria-label={`区块大小 ${size} 格`} onClick={() => progress.onToggleSectionSize(size)}>{size}</button>
                ))}
              </div>
              <div className="practice-panel__section-actions">
                <button type="button" className="practice-panel__chip" onClick={() => progress.onFocusSection(null)}
                  aria-pressed={!progress.focusedSection} aria-label="显示全部区块（退出聚焦）">全部</button>
                <button type="button" className="practice-panel__chip" onClick={progress.onNextSection}
                  disabled={allComplete} aria-label="跳到下一个未完成的区块">
                  <ArrowRight size={16} aria-hidden="true" />下一区块
                </button>
              </div>
              {minimap}
              {sectionHint && <p className="practice-panel__hint" role="status">{sectionHint}</p>}
              {allComplete && <p className="practice-panel__note" role="status">所有区块的豆子都已拼完。</p>}
            </section>}

            <section className="practice-panel__timer" aria-label="实操计时">
              <div className="practice-panel__timer-status"><span className={running ? 'is-running' : ''} />{running ? '正在专注拼豆' : '计时已暂停'}</div>
              <output className="practice-panel__time" aria-label="累计实操时间">{formatPracticeDuration(clock.getElapsedMs())}</output>
              <div className="practice-panel__timer-actions">
                <button type="button" className="practice-panel__primary" onClick={toggleTimer} aria-label={running ? '暂停计时' : '开始计时'} title={running ? '暂停计时' : '开始计时'}>
                  {running ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}{running ? '暂停计时' : '开始计时'}
                </button>
                <button ref={resetTriggerRef} type="button" className="practice-panel__secondary" onClick={resetTimer} aria-label="重置计时"><RotateCcw size={15} /> 重置</button>
              </div>
              <p>自动保存时长 · 退出即暂停</p>
              {!clock.canPersist() && <p role="status">本地存储不可用，计时仅在本次打开期间保留。</p>}
            </section>

            <section aria-label="库存估算">
              <div className="practice-panel__section-heading"><h3>备豆检查</h3><button type="button" className="practice-panel__text-button" onClick={onOpenInventory}><Package size={15} aria-hidden="true" /> 管理豆仓</button></div>
              <dl className="practice-panel__stock-totals">
                <div><dt>匹配库存</dt><dd>{totals.stock.toLocaleString()}</dd></div>
                <div><dt>预计剩余</dt><dd>{totals.remaining.toLocaleString()}</dd></div>
                <div className={totals.shortage > 0 ? 'is-short' : ''}><dt>还缺豆数</dt><dd>{totals.shortage.toLocaleString()}</dd></div>
              </dl>
              <p className={totals.shortage > 0 ? 'practice-panel__warning' : 'practice-panel__note'} role="status">
                {plan.total === 0 ? '请先在画板中添加拼豆。' : totals.shortage > 0
                  ? `库存不足：${plan.rows.filter(row => row.shortage > 0).length} 种颜色需要补货，共缺 ${totals.shortage} 粒。`
                  : '当前库存足够完成这张图纸。'}
              </p>
              <details className="practice-panel__inventory-note"><summary>库存如何计算</summary><p className="practice-panel__note">本机豆仓实时估算，不自动扣库存。未录入按 0 计算。</p></details>
              {plan.rows.some(row => row.inventoryConflict) && <p className="practice-panel__warning" role="status">发现同品牌同色号重复记录：按较小库存估算且只分配一次，请核对豆仓。</p>}
            </section>

            <section className="practice-panel__requirements" aria-label="用色需求">
              <div className="practice-panel__section-heading"><h3>用色清单 <small>{plan.colorCount} 色</small></h3><span className="practice-panel__note">缺色优先 · 点击定位</span></div>
              <label htmlFor={searchId} className="practice-panel__search"><Search size={16} aria-hidden="true" /><span className="practice-panel__sr-only">搜索色号、品牌或颜色名</span><input id={searchId} type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索色号、品牌或颜色名" /></label>
              <label className="practice-panel__filter"><input type="checkbox" checked={shortagesOnly} onChange={event => setShortagesOnly(event.target.checked)} />只看缺色<span>{plan.rows.filter(row => row.shortage > 0).length} 色待补</span></label>

              <ul className="practice-panel__color-list">
                {rows.map(row => (
                  <li key={row.id}>
                    <button type="button" className={`practice-panel__color${activeColorId === row.id ? ' is-active' : ''}`} aria-pressed={activeColorId === row.id} onClick={() => onHighlightColor(activeColorId === row.id ? null : row.id)}>
                      <div className="practice-panel__color-heading">
                        <span className="practice-panel__swatch" aria-hidden="true" style={{ backgroundColor: row.color?.hex ?? 'transparent' }}>{!row.color && '?'}</span>
                        <span className="practice-panel__color-name"><strong>{row.color?.code ?? row.id}</strong><small>{row.color ? `${row.color.brand} · ${row.color.name}` : '色板中未找到此颜色'}</small></span>
                        <span className={`practice-panel__badge${row.shortage > 0 ? ' is-short' : ''}`}>{row.shortage > 0 ? `缺 ${row.shortage}` : '充足'}</span>
                      </div>
                      <dl className="practice-panel__color-counts">
                        <div><dt>需求</dt><dd>{row.required}</dd></div>
                        <div><dt>库存{!row.recorded && <small> · 未录入</small>}</dt><dd>{row.stock}</dd></div>
                        <div><dt>预计剩余</dt><dd>{row.remaining}</dd></div>
                        <div className={row.shortage > 0 ? 'is-short' : ''}><dt>缺口</dt><dd>{row.shortage}</dd></div>
                      </dl>
                    </button>
                  </li>
                ))}
              </ul>
              {!rows.length && <p className="practice-panel__empty">{plan.total === 0 ? '图纸还没有拼豆。' : '没有符合条件的颜色。'}</p>}
            </section>
          </>
        )}
      </div>

      {detailsUnlocked && plan.total > 0 && <footer className="practice-panel__footer">
        <button type="button" className="practice-panel__secondary practice-panel__copy" disabled={!plan.rows.length} onClick={() => { void copyRestockList(); }}>{copyState === 'copied' ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}{copyState === 'copied' ? '已复制补货清单' : '复制补货清单'}</button>
        {copyState === 'copied' && <p className="practice-panel__note" role="status">已复制当前作品的完整补货清单。</p>}
        {copyState === 'manual' && <label className="practice-panel__manual-copy">自动复制不可用，请选中并复制：<textarea readOnly value={restockList} onFocus={event => event.currentTarget.select()} aria-label="手动复制补货清单" /></label>}
      </footer>}
      {typeof document !== 'undefined' && createPortal(<dialog ref={resetDialogRef} className="practice-reset-dialog"
        aria-labelledby={resetTitleId} aria-describedby={resetTitleId + '-description'}
        onCancel={event => {event.preventDefault();event.stopPropagation();dismissReset();}}
        onKeyDown={event => event.stopPropagation()}
        onClick={event => {
          if (event.target !== event.currentTarget) return;
          const rect = event.currentTarget.getBoundingClientRect();
          if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dismissReset();
        }}>
        <div className="practice-reset-dialog__icon"><RotateCcw size={22}/></div>
        <h2 id={resetTitleId}>重新开始计时？</h2>
        <p id={resetTitleId + '-description'}>本次累计的 <strong>{formatPracticeDuration(clock.getElapsedMs())}</strong> 将归零。<br/>图纸、摆豆进度和豆仓库存都会保留。</p>
        <div className="practice-reset-dialog__actions">
          <button type="button" autoFocus onClick={dismissReset}>保留计时</button>
          <button type="button" onClick={() => {clock.reset();refreshClock(value => value + 1);dismissReset();}}>重置计时</button>
        </div>
      </dialog>, document.body)}
      {typeof document !== 'undefined' && progress && createPortal(<dialog ref={progressDialogRef} className="practice-progress-dialog"
        aria-labelledby={progressTitleId} aria-describedby={progressTitleId + '-description'}
        onCancel={event => {event.preventDefault();event.stopPropagation();dismissProgressReset();}}
        onKeyDown={event => event.stopPropagation()}
        onClick={event => {
          if (event.target !== event.currentTarget) return;
          const rect = event.currentTarget.getBoundingClientRect();
          if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dismissProgressReset();
        }}>
        <div className="practice-reset-dialog__icon"><Trash2 size={22}/></div>
        <h2 id={progressTitleId}>重置拼豆进度？</h2>
        <p id={progressTitleId + '-description'}>已拼的 <strong>{progressPlaced.toLocaleString()}</strong> 颗豆子会全部取消，进度归零。<br/>图纸、耗时记录和豆仓库存都会保留。</p>
        <div className="practice-reset-dialog__actions">
          <button type="button" autoFocus onClick={dismissProgressReset}>保留进度</button>
          <button type="button" onClick={() => { progress.onReset(); dismissProgressReset(); }}>重置进度</button>
        </div>
      </dialog>, document.body)}
    </aside>
  );
}

export default PracticePanel;
