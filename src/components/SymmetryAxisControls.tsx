import type { ReactNode } from 'react';
import type { SymmetryAxes } from '../utils/gridEditing';
import type { SymmetryMode } from '../types';

export interface WorkspaceEditingActions {
  axes: SymmetryAxes;
  width: number;
  height: number;
  onAxesChange: (axes: SymmetryAxes | null) => void;
  onMirrorFlip: (direction: 'horizontal' | 'vertical') => void;
  isPracticeMode: boolean;
  onTogglePractice: () => void;
  practicePanel?: ReactNode;
}

export function SymmetryAxisControls({ actions, mode, isEn = false }: {
  actions?: WorkspaceEditingActions; mode: SymmetryMode; isEn?: boolean;
}) {
  if (!actions || mode === 'none') return null;
  return <div className="mt-2 border-t border-purple-100 pt-2 text-[11px] text-purple-900">
    <p className="mb-2 font-bold">{isEn ? 'Move symmetry axes' : '调整对称轴位置'}</p>
    <div className="grid grid-cols-2 gap-2">
      <label className="flex flex-col gap-1">{isEn ? 'From left (cells)' : '距左侧（格）'}
        <input type="number" step={0.5} min={0} max={actions.width} value={actions.axes.x}
          aria-label={isEn ? 'Symmetry axis X' : '对称轴横向位置'} disabled={mode === 'vertical'}
          onChange={e => { if (Number.isFinite(e.currentTarget.valueAsNumber)) actions.onAxesChange({...actions.axes, x:e.currentTarget.valueAsNumber}); }}
          className="min-h-10 w-full rounded-lg border border-purple-200 bg-white px-2 disabled:opacity-40" />
      </label>
      <label className="flex flex-col gap-1">{isEn ? 'From top (cells)' : '距顶部（格）'}
        <input type="number" step={0.5} min={0} max={actions.height} value={actions.axes.y}
          aria-label={isEn ? 'Symmetry axis Y' : '对称轴纵向位置'} disabled={mode === 'horizontal'}
          onChange={e => { if (Number.isFinite(e.currentTarget.valueAsNumber)) actions.onAxesChange({...actions.axes, y:e.currentTarget.valueAsNumber}); }}
          className="min-h-10 w-full rounded-lg border border-purple-200 bg-white px-2 disabled:opacity-40" />
      </label>
    </div>
    <p className="mt-2 text-[10px] leading-4 text-purple-500">{isEn ? 'Half-cell steps. Drag the axis handles on the canvas too.' : '支持半格位置，也可拖动画板上的轴控制点。'}</p>
    <button type="button" onClick={() => actions.onAxesChange(null)} className="mt-1 min-h-9 rounded-lg px-2 font-bold hover:bg-purple-50">{isEn ? 'Center axes' : '恢复居中'}</button>
  </div>;
}
