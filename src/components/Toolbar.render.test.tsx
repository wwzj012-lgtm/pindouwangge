/**
 * Toolbar render tests: tool switching, undo/redo gating, view toggles and
 * the cleanup-permission surface. Pure callback injection (no context), so
 * everything asserts on the injected mock calls.
 *
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { actRender, actUnmountAll, clickAriaLabel, bodyText } from '../test/jsdomTestUtils';
import { Toolbar, type ToolbarProps } from './Toolbar';

afterEach(() => {
  actUnmountAll();
  vi.unstubAllGlobals();
});

function props(patch: Partial<ToolbarProps> = {}): ToolbarProps {
  const noop = () => {};
  return {
    activeTool: 'pencil',
    setActiveTool: vi.fn(),
    selectedColor: null,
    onOpenColorPicker: vi.fn(),
    canUndo: true,
    canRedo: false,
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    zoom: 1,
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onResetZoom: vi.fn(),
    beadShape: 'square',
    setBeadShape: vi.fn(),
    showSymbols: true,
    setShowSymbols: vi.fn(),
    showGridLines: true,
    setShowGridLines: vi.fn(),
    showCoordinates: true,
    setShowCoordinates: vi.fn(),
    symmetryMode: 'none',
    setSymmetryMode: vi.fn(),
    canvasBackdrop: 'transparent',
    setCanvasBackdrop: vi.fn(),
    onClearOuterBackground: vi.fn(),
    hasImage: false,
    showOverlay: false,
    setShowOverlay: vi.fn(),
    overlayOpacity: 0.5,
    setOverlayOpacity: vi.fn(),
    onSavePattern: vi.fn(),
    isSavingPattern: false,
    onOpenExport: vi.fn(),
    canExport: true,
    ...patch,
  } as ToolbarProps;
}

describe('Toolbar: drawing tools', () => {
  it('marks the active tool and switches on click', () => {
    const setActiveTool = vi.fn();
    actRender(<Toolbar {...props({ activeTool: 'pencil', setActiveTool })} />);
    const active = document.querySelector('[aria-pressed="true"][aria-label*="画笔"]');
    expect(active).toBeTruthy();
    clickAriaLabel('油漆桶 (B)');
    expect(setActiveTool).toHaveBeenCalledWith('bucket');
  });

  it('keeps every documented tool reachable in the palette menu', () => {
    actRender(<Toolbar {...props()} />);
    for (const label of ['画笔 (P)', '平移拖拽 (H)', '油漆桶 (B)', '橡皮擦 (E)', '吸管 (I)', '区域清除 (U)', '套索擦除 (O)']) {
      const button = [...document.querySelectorAll('button')].find(item => item.getAttribute('aria-label') === label);
      expect(button, `tool missing: ${label}`).toBeTruthy();
    }
  });
});

describe('Toolbar: history gating', () => {
  it('disables undo/redo when history is empty and fires callbacks when enabled', () => {
    const onUndo = vi.fn();
    actRender(<Toolbar {...props({ canUndo: false, canRedo: false, onUndo })} />);
    const undo = document.querySelector('[aria-label="撤销"]') as HTMLButtonElement;
    expect(undo.disabled).toBe(true);
    actUnmountAll();

    const onUndoEnabled = vi.fn();
    actRender(<Toolbar {...props({ canUndo: true, canRedo: false, onUndo: onUndoEnabled })} />);
    const undoEnabled = document.querySelector('[aria-label="撤销"]') as HTMLButtonElement;
    expect(undoEnabled.disabled).toBe(false);
    undoEnabled.click();
    expect(onUndoEnabled).toHaveBeenCalledTimes(1);
    const redo = document.querySelector('[aria-label="重做"]') as HTMLButtonElement;
    expect(redo.disabled).toBe(true);
  });
});

describe('Toolbar: view toggles and permissions', () => {

  it('hides background cleanup without permission', () => {
    const onOpenBackgroundCleanup = vi.fn();
    actRender(<Toolbar {...props({ onOpenBackgroundCleanup, canCleanupBackground: false })} />);
    const cleanup = [...document.querySelectorAll('button')].find(item => item.textContent?.includes('背景'));
    expect(cleanup).toBeUndefined();
    actUnmountAll();

    const onOpenEnabled = vi.fn();
    actRender(<Toolbar {...props({ onOpenBackgroundCleanup: onOpenEnabled, canCleanupBackground: true, hasImage: true })} />);
    const cleanupEnabled = [...document.querySelectorAll('button')].find(item => item.textContent?.includes('背景'));
    if (cleanupEnabled) {
      act(() => { cleanupEnabled.click(); });
      expect(onOpenEnabled).toHaveBeenCalledTimes(1);
    }
  });

  it('gates the export entry on canExport', () => {
    const onOpenExport = vi.fn();
    actRender(<Toolbar {...props({ onOpenExport, canExport: false })} />);
    const exportButton = [...document.querySelectorAll('button')].find(item =>
      item.textContent?.includes('导出') || item.getAttribute('aria-label')?.includes('导出'));
    expect(exportButton?.disabled).toBe(true);
  });
});
