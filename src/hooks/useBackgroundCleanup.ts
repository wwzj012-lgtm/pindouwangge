import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  analyzeBackgroundIslands, applyBackgroundIslandCleanup,
  type BackgroundIslandAnalysis,
} from '../utils/backgroundIslandCleanup';
import type { GridSnapshot } from '../utils/historyTransactions';

export interface BackgroundCleanupPreview {
  analysis: BackgroundIslandAnalysis;
  protectedIds: ReadonlySet<number>;
  onToggleComponent: (id: number) => void;
}

export interface BackgroundCleanupController {
  preview: BackgroundCleanupPreview | null;
  canOpen: boolean;
  threshold: number;
  selectedComponents: number;
  selectedCells: number;
  protectedComponents: number;
  open: () => void;
  cancel: () => void;
  confirm: () => void;
  setThreshold: (value: number) => void;
}

interface CleanupSession {
  grid: GridSnapshot;
  context: readonly unknown[];
  threshold: number;
  protectedIds: ReadonlySet<number>;
}

const sameContext = (left: readonly unknown[], right: readonly unknown[]) =>
  left.length === right.length && left.every((value, index) => Object.is(value, right[index]));

/** Preview owns no model data: only confirm may call the existing edit transaction. */
export function useBackgroundCleanup({ grid, context, enabled, onApply, onBeforeOpen }: {
  grid: GridSnapshot;
  context: readonly unknown[];
  enabled: boolean;
  onApply: (nextGrid: GridSnapshot) => unknown;
  onBeforeOpen?: () => unknown;
}): BackgroundCleanupController {
  const [session, setSession] = useState<CleanupSession | null>(null);
  const latest = useRef({ grid, context, enabled, onApply, onBeforeOpen });
  latest.current = { grid, context, enabled, onApply, onBeforeOpen };
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const returnFocus = useRef<HTMLElement | null>(null);
  const valid = !!session && enabled && session.grid === grid && sameContext(session.context, context);
  const canOpen = useMemo(() => enabled && grid.some(row => row.some(cell => cell !== null)), [enabled, grid]);
  // Protection toggles reuse analysis; only threshold changes rescan the grid.
  const analysis = useMemo(() => session
    ? analyzeBackgroundIslands(session.grid, { maxIslandSize: session.threshold }) : null,
  [session?.grid, session?.threshold]);

  const cancel = useCallback(() => {
    sessionRef.current = null;
    setSession(null);
    if (returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (session && !valid) cancel();
  }, [session, valid, cancel]);

  useEffect(() => {
    if (!valid) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      cancel();
    };
    window.addEventListener('keydown', handleEscape, true);
    return () => window.removeEventListener('keydown', handleEscape, true);
  }, [valid, cancel]);

  const open = useCallback(() => {
    const current = latest.current;
    if (!current.enabled || !current.grid.some(row => row.some(cell => cell !== null))) return;
    current.onBeforeOpen?.();
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const next: CleanupSession = { grid: current.grid, context: [...current.context], threshold: 4, protectedIds: new Set() };
    sessionRef.current = next;
    setSession(next);
  }, []);

  const setThreshold = useCallback((value: number) => {
    if (![1, 2, 4, 8, 16].includes(value)) return;
    setSession(current => current ? { ...current, threshold: value } : current);
  }, []);

  const onToggleComponent = useCallback((id: number) => {
    setSession(current => {
      if (!current) return current;
      const protectedIds = new Set(current.protectedIds);
      if (protectedIds.has(id)) protectedIds.delete(id); else protectedIds.add(id);
      return { ...current, protectedIds };
    });
  }, []);

  const counts = useMemo(() => {
    let selectedComponents = 0, selectedCells = 0, protectedComponents = 0;
    if (analysis && session) for (const component of analysis.components) {
      if (!component.candidate) continue;
      if (session.protectedIds.has(component.id)) protectedComponents += 1;
      else { selectedComponents += 1; selectedCells += component.size; }
    }
    return { selectedComponents, selectedCells, protectedComponents };
  }, [analysis, session?.protectedIds]);

  const confirm = useCallback(() => {
    const current = latest.current;
    const active = sessionRef.current;
    if (!active || !analysis || !current.enabled || active.grid !== current.grid
      || active.threshold !== analysis.options.maxIslandSize || !sameContext(active.context, current.context)) {
      cancel();
      return;
    }
    const selected = analysis.components.some(component => component.candidate && !active.protectedIds.has(component.id));
    if (!selected) return;
    const nextGrid = applyBackgroundIslandCleanup(current.grid, analysis, { protectedComponentIds: [...active.protectedIds] });
    cancel();
    current.onApply(nextGrid);
  }, [analysis, cancel]);

  return { preview: valid && analysis && session ? { analysis, protectedIds: session.protectedIds, onToggleComponent } : null,
    canOpen, threshold: session?.threshold ?? 4, ...counts, open, cancel, confirm, setThreshold };
}
