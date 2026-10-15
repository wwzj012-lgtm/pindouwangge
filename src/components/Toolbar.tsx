import React, { useEffect, useId, useRef, useState } from 'react';
import {
  Pencil,
  PaintBucket,
  Pipette,
  Eraser,
  RefreshCw,
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Circle as CircleIcon,
  Square,
  Hash,
  Grid2x2,
  Eye,
  Minus,
  Spline,
  Layers,
  Hand,
  Scissors,
  FolderOpen,
  ChevronDown,
  Save,
  Download,
  Flame,
} from 'lucide-react';
import './Toolbar.css';
import { BeadColor, BeadShape, ToolType, SymmetryMode, CanvasBackdrop } from '../types';
import { useLanguage } from '../context/LanguageContext';
import { createPressRepeatController, type PressRepeatController } from '../utils/pressRepeat';

interface ToolbarProps {
  activeTool: ToolType;
  setActiveTool: (tool: ToolType) => void;
  selectedColor: BeadColor | null;
  onOpenColorPicker: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => boolean;
  onRedo: () => boolean;
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  beadShape: BeadShape;
  setBeadShape: (shape: BeadShape) => void;
  showSymbols: boolean;
  setShowSymbols: (show: boolean) => void;
  showGridLines: boolean;
  setShowGridLines: (show: boolean) => void;
  showCoordinates: boolean;
  setShowCoordinates: (show: boolean) => void;
  
  symmetryMode: SymmetryMode;
  setSymmetryMode: (mode: SymmetryMode) => void;
  canvasBackdrop: CanvasBackdrop;
  setCanvasBackdrop: (backdrop: CanvasBackdrop) => void;
  onClearOuterBackground: () => void;
  hasImage: boolean;
  showOverlay: boolean;
  setShowOverlay: (show: boolean) => void;
  overlayOpacity: number;
  setOverlayOpacity: (opacity: number) => void;
  onSavePattern: () => void;
  isSavingPattern: boolean;
  onOpenExport: () => void;
  canExport: boolean;
  onOpenPatterns: () => void;
}

export const Toolbar: React.FC<ToolbarProps> = ({
  activeTool,
  setActiveTool,
  selectedColor,
  onOpenColorPicker,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  zoom,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  beadShape,
  setBeadShape,
  showSymbols,
  setShowSymbols,
  showGridLines,
  setShowGridLines,
  showCoordinates,
  setShowCoordinates,
  symmetryMode,
  setSymmetryMode,
  canvasBackdrop,
  setCanvasBackdrop,
  onClearOuterBackground,
  hasImage,
  showOverlay,
  setShowOverlay,
  overlayOpacity,
  setOverlayOpacity,
  onSavePattern,
  isSavingPattern,
  onOpenExport,
  canExport,
  onOpenPatterns,
}) => {
  const { language } = useLanguage();
  const isEn = language === 'en';
  const [popover, setPopover] = useState<'shape' | 'display' | null>(null);
  const shapeRef = useRef<HTMLDivElement>(null);
  const displayRef = useRef<HTMLDivElement>(null);
  const shapeId = useId();
  const displayId = useId();
  const closePopover = (restoreFocus = true) => {
    const wrapper = popover === 'shape' ? shapeRef.current : displayRef.current;
    setPopover(null);
    if (restoreFocus) wrapper?.querySelector<HTMLButtonElement>(':scope > button')?.focus();
  };

  useEffect(() => {
    if (!popover) return;
    const wrapper = popover === 'shape' ? shapeRef.current : displayRef.current;
    const panel = wrapper?.querySelector<HTMLElement>('[role="dialog"]');
    (panel?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]') ?? panel?.querySelector<HTMLButtonElement>('button'))?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapper?.contains(event.target as Node)) closePopover();
    };
    const onFocusIn = (event: FocusEvent) => {
      if (!wrapper?.contains(event.target as Node)) closePopover(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closePopover();
      } else if (panel?.contains(event.target as Node) && event.target instanceof HTMLButtonElement && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        const buttons = Array.from<HTMLButtonElement>(panel.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
        const index = buttons.indexOf(event.target);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        event.preventDefault();
        buttons[next]?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [popover]);

  const undoActionRef = useRef(onUndo);
  const redoActionRef = useRef(onRedo);
  const undoRepeatRef = useRef<PressRepeatController | null>(null);
  const redoRepeatRef = useRef<PressRepeatController | null>(null);

  useEffect(() => {
    undoActionRef.current = onUndo;
    redoActionRef.current = onRedo;
  }, [onRedo, onUndo]);

  if (!undoRepeatRef.current) {
    undoRepeatRef.current = createPressRepeatController(() => undoActionRef.current());
  }
  if (!redoRepeatRef.current) {
    redoRepeatRef.current = createPressRepeatController(() => redoActionRef.current());
  }

  useEffect(() => {
    const stopRepeatingHistory = () => {
      undoRepeatRef.current?.stop();
      redoRepeatRef.current?.stop();
    };

    window.addEventListener('blur', stopRepeatingHistory);
    return () => {
      window.removeEventListener('blur', stopRepeatingHistory);
      stopRepeatingHistory();
    };
  }, []);

  const startHistoryRepeat = (controller: PressRepeatController, event: React.PointerEvent<HTMLButtonElement>) => {
    if (!event.isPrimary || event.button !== 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    controller.start();
  };

  const stopHistoryRepeat = (controller: PressRepeatController) => {
    controller.stop();
  };

  const tools = [
    { id: 'pencil', label: isEn ? 'Pencil' : '画笔', title: isEn ? 'Pencil (P)' : '画笔 (P)', Icon: Pencil },
    { id: 'hand', label: isEn ? 'Pan' : '平移', title: isEn ? 'Pan / Move (H)' : '平移拖拽 (H)', Icon: Hand },
    { id: 'bucket', label: isEn ? 'Fill' : '填充', title: isEn ? 'Fill Bucket (B)' : '油漆桶 (B)', Icon: PaintBucket },
    { id: 'eraser', label: isEn ? 'Erase' : '擦除', title: isEn ? 'Eraser (E)' : '橡皮擦 (E)', Icon: Eraser },
    { id: 'eyedropper', label: isEn ? 'Pick' : '吸管', title: isEn ? 'Color Picker (I)' : '吸管 (I)', Icon: Pipette },
  ] as const;
  const shapes = [
    { id: 'line', label: isEn ? 'Line' : '直线', Icon: Minus },
    { id: 'rectangle', label: isEn ? 'Rectangle' : '矩形', Icon: Square },
    { id: 'circle', label: isEn ? 'Circle' : '圆形', Icon: CircleIcon },
  ] as const;
  const beadStyles = [
    { id: 'fuse_3d', label: isEn ? '3D bead' : '3D立体豆', Icon: CircleIcon },
    { id: 'circle_flat', label: isEn ? 'Flat round' : '平面圆豆', Icon: CircleIcon },
    { id: 'square', label: isEn ? 'Pixel square' : '像素方块', Icon: Square },
    { id: 'ironed', label: isEn ? 'Ironed' : '熨烫预览', Icon: Flame },
  ] as const;
  const activeShape = shapes.find(shape => shape.id === activeTool);
  const ShapeIcon = activeShape?.Icon ?? Square;
  const shapeLabel = activeShape?.label ?? (isEn ? 'Shapes' : '形状');
  const beadStyleLabel = beadStyles.find(style => style.id === beadShape)?.label;
  const colorTitle = selectedColor
    ? [selectedColor.code, selectedColor.name, selectedColor.brand].join(' · ')
    : (isEn ? 'Select a bead color' : '选择拼豆颜色');

  return (
    <section className="editor-toolbar" aria-label={isEn ? 'Canvas editor toolbar' : '画布编辑工具栏'}>
      <div className="editor-toolbar__row editor-toolbar__primary">
        <button type="button" className="editor-toolbar__color" onClick={onOpenColorPicker} aria-label={isEn ? 'Select active color' : '选择当前颜色'} title={colorTitle}>
          <span className="editor-toolbar__swatch" style={{ backgroundColor: selectedColor?.hex ?? '#CCCCCC' }} aria-hidden="true" />
          <span className="editor-toolbar__code">{selectedColor?.code ?? (isEn ? 'No color' : '未选色')}</span>
          <ChevronDown aria-hidden="true" />
        </button>

        <div className="editor-toolbar__group editor-toolbar__drawing" role="group" aria-label={isEn ? 'Drawing tools' : '绘制工具'}>
          {tools.map(({ id, label, title, Icon }) => (
            <button type="button" key={id} onClick={() => setActiveTool(id)} aria-label={label} aria-pressed={activeTool === id} title={title}>
              <Icon aria-hidden="true" /><span className="editor-toolbar__tool-label">{label}</span>
            </button>
          ))}
          <div className="editor-toolbar__popover-anchor" ref={shapeRef}>
            <button type="button" onClick={() => setPopover(popover === 'shape' ? null : 'shape')} aria-label={(isEn ? 'Shape: ' : '形状：') + shapeLabel} aria-pressed={!!activeShape} aria-haspopup="dialog" aria-expanded={popover === 'shape'} aria-controls={popover === 'shape' ? shapeId : undefined} title={isEn ? 'Line, rectangle and circle tools' : '直线、矩形、圆形工具'}>
              <ShapeIcon aria-hidden="true" /><span>{shapeLabel}</span><ChevronDown aria-hidden="true" />
            </button>
            {popover === 'shape' && (
              <div className="editor-toolbar__popover" id={shapeId} role="dialog" aria-label={isEn ? 'Geometric shapes' : '几何形状'}>
                {shapes.map(({ id, label, Icon }) => (
                  <button type="button" key={id} aria-label={label} aria-pressed={activeTool === id} onClick={() => { setActiveTool(id); closePopover(); }}>
                    <Icon aria-hidden="true" /><span>{label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button type="button" onClick={() => setActiveTool('replace')} aria-label={isEn ? 'Replace all matching colors' : '全图替色'} aria-pressed={activeTool === 'replace'} title={isEn ? 'Replace Color (R)' : '替换全图此色 (R)'}>
            <RefreshCw aria-hidden="true" /><span className="editor-toolbar__tool-label">{isEn ? 'Replace' : '替色'}</span>
          </button>
        </div>

        <label className="editor-toolbar__select editor-toolbar__symmetry">
          <Spline aria-hidden="true" /><span>{isEn ? 'Symmetry' : '对称'}</span>
          <select value={symmetryMode} onChange={event => setSymmetryMode(event.target.value as SymmetryMode)} aria-label={isEn ? 'Symmetry mode' : '对称方式'}>
            <option value="none">{isEn ? 'None' : '无对称'}</option>
            <option value="horizontal">{isEn ? 'Horizontal' : '左右镜像'}</option>
            <option value="vertical">{isEn ? 'Vertical' : '上下镜像'}</option>
            <option value="quad">{isEn ? 'Four-way' : '四向镜像'}</option>
          </select>
        </label>

        <div className="editor-toolbar__group editor-toolbar__history" role="group" aria-label={isEn ? 'History and edge cleanup' : '历史与边缘清理'}>
          <button type="button" aria-label={isEn ? 'Undo' : '撤销'} disabled={!canUndo} title={isEn ? 'Undo (Ctrl+Z)' : '撤销 (Ctrl+Z)'}
            onPointerDown={event => startHistoryRepeat(undoRepeatRef.current!, event)}
            onPointerUp={() => stopHistoryRepeat(undoRepeatRef.current!)} onPointerCancel={() => stopHistoryRepeat(undoRepeatRef.current!)}
            onPointerLeave={() => stopHistoryRepeat(undoRepeatRef.current!)} onLostPointerCapture={() => stopHistoryRepeat(undoRepeatRef.current!)}
            onClick={() => { if (undoRepeatRef.current!.shouldHandleClick()) onUndo(); }}>
            <Undo2 aria-hidden="true" />
          </button>
          <button type="button" aria-label={isEn ? 'Redo' : '重做'} disabled={!canRedo} title={isEn ? 'Redo (Ctrl+Y)' : '重做 (Ctrl+Y)'}
            onPointerDown={event => startHistoryRepeat(redoRepeatRef.current!, event)}
            onPointerUp={() => stopHistoryRepeat(redoRepeatRef.current!)} onPointerCancel={() => stopHistoryRepeat(redoRepeatRef.current!)}
            onPointerLeave={() => stopHistoryRepeat(redoRepeatRef.current!)} onLostPointerCapture={() => stopHistoryRepeat(redoRepeatRef.current!)}
            onClick={() => { if (redoRepeatRef.current!.shouldHandleClick()) onRedo(); }}>
            <Redo2 aria-hidden="true" />
          </button>
          <button type="button" onClick={onClearOuterBackground} aria-label={isEn ? 'Clear edge background' : '清除边缘背景'} title={isEn ? 'Clear edge-connected background beads' : '清除与边缘连通的背景豆'}>
            <Scissors aria-hidden="true" />
          </button>
        </div>

        <div className="editor-toolbar__actions" role="group" aria-label={isEn ? 'Pattern output' : '图纸输出'}>
          <button type="button" className="editor-toolbar__save" onClick={onSavePattern} aria-label={isEn ? 'Save' : '保存'} disabled={isSavingPattern} title={isEn ? 'Save editable pattern without downloading' : '保存可编辑图纸，不下载文件'}>
            <Save aria-hidden="true" /><span>{isSavingPattern ? (isEn ? 'Saving' : '保存中') : (isEn ? 'Save' : '保存')}</span>
          </button>
          <button type="button" className="editor-toolbar__export" onClick={onOpenExport} aria-label={isEn ? 'Export' : '导出'} disabled={!canExport} title={canExport ? (isEn ? 'Export pattern and materials list' : '导出图纸与用量清单') : (isEn ? 'Add beads before exporting' : '请先导入图片或在画布上绘制拼豆')}>
            <Download aria-hidden="true" /><span>{isEn ? 'Export' : '导出'}</span>
          </button>
        </div>
      </div>

      <div className="editor-toolbar__row editor-toolbar__secondary">
        <label className="editor-toolbar__select">
          <Layers aria-hidden="true" /><span>{isEn ? 'Background' : '背景'}</span>
          <select value={canvasBackdrop} onChange={event => setCanvasBackdrop(event.target.value as CanvasBackdrop)} aria-label={isEn ? 'Canvas background' : '画布背景'}>
            <option value="dark_grid">{isEn ? 'Dark grid' : '深色网格'}</option>
            <option value="light_pegboard">{isEn ? 'White pegboard' : '白色插板'}</option>
            <option value="wood">{isEn ? 'Wood texture' : '复古木纹'}</option>
            <option value="studio">{isEn ? 'Dark studio' : '暗调工作台'}</option>
          </select>
        </label>
        <div className="editor-toolbar__popover-anchor" ref={displayRef}>
          <button type="button" onClick={() => setPopover(popover === 'display' ? null : 'display')} aria-label={isEn ? 'Display options' : '显示选项'} aria-haspopup="dialog" aria-expanded={popover === 'display'} aria-controls={popover === 'display' ? displayId : undefined}>
            <Eye aria-hidden="true" /><span>{isEn ? 'Display' : '显示'} · {beadStyleLabel}</span><ChevronDown aria-hidden="true" />
          </button>
          {popover === 'display' && (
            <div className="editor-toolbar__popover" id={displayId} role="dialog" aria-label={isEn ? 'Display options' : '显示选项'}>
              <p>{isEn ? 'Bead style' : '拼豆显示样式'}</p>
              {beadStyles.map(({ id, label, Icon }) => (
                <button type="button" key={id} aria-label={label} aria-pressed={beadShape === id} onClick={() => setBeadShape(id)}>
                  <Icon aria-hidden="true" /><span>{label}</span>
                </button>
              ))}
              <button type="button" aria-label={isEn ? 'Coordinates' : '坐标'} aria-pressed={showCoordinates} onClick={() => setShowCoordinates(!showCoordinates)}>
                <Grid2x2 aria-hidden="true" /><span>{isEn ? 'Coordinates' : '坐标'}</span>
              </button>
              {hasImage && <label className="editor-toolbar__opacity">
                <span>{isEn ? 'Overlay opacity' : '原图透明度'}</span>
                <input type="range" min="10" max="70" step="5" value={Math.round(overlayOpacity * 100)} onChange={event => setOverlayOpacity(Number(event.target.value) / 100)} aria-label={isEn ? 'Overlay opacity' : '原图叠底透明度'} />
              </label>}
            </div>
          )}
        </div>
        <div className="editor-toolbar__group" role="group" aria-label={isEn ? 'Canvas overlays' : '画布辅助显示'}>
          <button type="button" onClick={() => setShowSymbols(!showSymbols)} aria-label={isEn ? 'Color codes' : '色号标识'} aria-pressed={showSymbols} title={isEn ? 'Toggle color code symbols' : '显示/隐藏拼豆色号标识/符号'}>
            <Hash aria-hidden="true" /><span>{isEn ? 'Codes' : '色号'}</span>
          </button>
          <button type="button" onClick={() => setShowGridLines(!showGridLines)} aria-label={isEn ? 'Grid lines' : '网格线'} aria-pressed={showGridLines} title={isEn ? 'Toggle grid lines' : '显示/隐藏网格线'}>
            <Grid2x2 aria-hidden="true" /><span>{isEn ? 'Grid' : '网格'}</span>
          </button>
          {hasImage && <button type="button" onClick={() => setShowOverlay(!showOverlay)} aria-label={isEn ? 'Original image overlay' : '原图叠影'} aria-pressed={showOverlay} title={isEn ? 'Toggle original image overlay' : '在网格上显示原图半透明叠影衬底'}>
            <Eye aria-hidden="true" /><span>{isEn ? 'Overlay' : '原图'}</span>
          </button>}
        </div>
        <div className="editor-toolbar__group editor-toolbar__zoom" role="group" aria-label={isEn ? 'Canvas zoom' : '画布缩放'}>
          <button type="button" onClick={onZoomOut} aria-label={isEn ? 'Zoom out' : '缩小'} title={isEn ? 'Zoom out' : '缩小'}><ZoomOut aria-hidden="true" /></button>
          <output aria-label={isEn ? 'Zoom' : '缩放比例'}>{Math.round(zoom * 100)}%</output>
          <button type="button" onClick={onZoomIn} aria-label={isEn ? 'Zoom in' : '放大'} title={isEn ? 'Zoom in' : '放大'}><ZoomIn aria-hidden="true" /></button>
          <button type="button" onClick={onResetZoom} aria-label={isEn ? 'Fit canvas' : '适应屏幕'} title={isEn ? 'Fit canvas' : '适应屏幕'}><Maximize2 aria-hidden="true" /></button>
        </div>
        <button type="button" className="editor-toolbar__patterns" onClick={onOpenPatterns} aria-label={isEn ? 'My patterns' : '我的图纸'} title={isEn ? 'My patterns' : '我的图纸'}>
          <FolderOpen aria-hidden="true" /><span>{isEn ? 'My patterns' : '我的图纸'}</span>
        </button>
      </div>
    </section>
  );
};
