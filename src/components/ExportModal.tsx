import React, { useState, useEffect, useRef } from 'react';
import { X, Download, Image as ImageIcon, ShieldAlert, Sliders } from 'lucide-react';
import { BeadColor, BeadShape } from '../types';
import {
  generatePatternCanvas,
  downloadCanvasImage,
  ExportOptions,
  WatermarkPosition,
  LegendPosition,
  LegendScaleMode,
} from '../utils/exportUtils';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  grid: (string | null)[][];
  paletteMap: Map<string, BeadColor>;
  width: number;
  height: number;
  boardSize: number;
  brandName: string;
  projectName: string;
  beadShape: BeadShape;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  onClose,
  grid,
  paletteMap,
  width,
  height,
  boardSize,
  brandName,
  projectName,
  beadShape,
}) => {
  const [showSymbols, setShowSymbols] = useState(true);
  const [showCoordinates, setShowCoordinates] = useState(true);
  const [watermarkPosition, setWatermarkPosition] = useState<WatermarkPosition>('grid_and_legend');
  const [watermarkOpacity, setWatermarkOpacity] = useState<number>(0.18);
  const [legendPosition, setLegendPosition] = useState<LegendPosition>('right');
  const [legendScaleMode, setLegendScaleMode] = useState<LegendScaleMode>('auto');
  const [hideEmptyPegs, setHideEmptyPegs] = useState(false);
  const [selectedBoard, setSelectedBoard] = useState<number | null>(null); // null = full canvas
  const previewContainerRef = useRef<HTMLDivElement>(null);

  const boardsX = Math.ceil(width / boardSize);
  const boardsY = Math.ceil(height / boardSize);
  const totalBoards = boardsX * boardsY;

  // Render High-res canvas preview inside container
  useEffect(() => {
    if (!isOpen || !previewContainerRef.current) return;

    const options: ExportOptions = {
      grid,
      paletteMap,
      width,
      height,
      boardSize,
      brandName,
      projectName,
      showSymbols,
      showCoordinates,
      beadShape,
      selectedBoardIndex: selectedBoard,
      watermarkPosition,
      watermarkOpacity,
      legendPosition,
      legendScaleMode,
      hideEmptyPegs,
    };

    const canvas = generatePatternCanvas(options);
    previewContainerRef.current.innerHTML = '';
    canvas.className = 'max-w-full h-auto shadow-xl rounded-lg border border-slate-700 mx-auto';
    previewContainerRef.current.appendChild(canvas);
  }, [
    isOpen,
    grid,
    paletteMap,
    width,
    height,
    boardSize,
    brandName,
    projectName,
    showSymbols,
    showCoordinates,
    beadShape,
    selectedBoard,
    watermarkPosition,
    watermarkOpacity,
    legendPosition,
    legendScaleMode,
    hideEmptyPegs,
  ]);

  if (!isOpen) return null;

  const handleDownloadSingle = () => {
    const options: ExportOptions = {
      grid,
      paletteMap,
      width,
      height,
      boardSize,
      brandName,
      projectName,
      showSymbols,
      showCoordinates,
      beadShape,
      selectedBoardIndex: selectedBoard,
      watermarkPosition,
      watermarkOpacity,
      legendPosition,
      legendScaleMode,
      hideEmptyPegs,
    };
    const canvas = generatePatternCanvas(options);
    const suffix = selectedBoard !== null ? `_板${selectedBoard + 1}` : '_完整图纸';
    downloadCanvasImage(canvas, `${projectName}${suffix}.png`);
  };

  const handleDownloadAllBoards = () => {
    // Download full canvas first
    const fullOptions: ExportOptions = {
      grid,
      paletteMap,
      width,
      height,
      boardSize,
      brandName,
      projectName,
      showSymbols,
      showCoordinates,
      beadShape,
      selectedBoardIndex: null,
      watermarkPosition,
      watermarkOpacity,
      legendPosition,
      legendScaleMode,
      hideEmptyPegs,
    };
    downloadCanvasImage(generatePatternCanvas(fullOptions), `${projectName}_完整图纸.png`);

    // Download each subboard
    for (let i = 0; i < totalBoards; i++) {
      setTimeout(() => {
        const subOptions: ExportOptions = {
          ...fullOptions,
          selectedBoardIndex: i,
        };
        downloadCanvasImage(generatePatternCanvas(subOptions), `${projectName}_板${i + 1}.png`);
      }, i * 300);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-4xl max-h-[92vh] sm:max-h-[90vh] flex flex-col shadow-2xl text-slate-200 text-xs overflow-hidden">
        {/* Header */}
        <div className="p-3 sm:p-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ImageIcon className="w-5 h-5 text-emerald-400" />
            <div>
              <h3 className="font-bold text-sm text-slate-100">导出高清拼豆图纸教程</h3>
              <p className="text-[11px] text-slate-400">
                包含标准标尺坐标、色号符号标识与拼豆用量色卡列表
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Controls Bar */}
        <div className="p-3.5 bg-slate-950/80 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-3 flex-wrap">
            <label className="flex items-center gap-1.5 cursor-pointer hover:text-white transition-colors">
              <input
                type="checkbox"
                checked={showSymbols}
                onChange={e => setShowSymbols(e.target.checked)}
                className="accent-purple-500 rounded cursor-pointer"
              />
              <span>显示色号标识</span>
            </label>

            <label className="flex items-center gap-1.5 cursor-pointer hover:text-white transition-colors">
              <input
                type="checkbox"
                checked={showCoordinates}
                onChange={e => setShowCoordinates(e.target.checked)}
                className="accent-purple-500 rounded cursor-pointer"
              />
              <span>显示标尺坐标 (A..Z / 1..N)</span>
            </label>

            <label className="flex items-center gap-1.5 cursor-pointer hover:text-white transition-colors border-l border-slate-800 pl-3">
              <input
                type="checkbox"
                checked={hideEmptyPegs}
                onChange={e => setHideEmptyPegs(e.target.checked)}
                className="accent-emerald-500 rounded cursor-pointer"
              />
              <span>隐藏空位点阵 (仅导出有豆区域)</span>
            </label>

            {/* Anti-crop Watermark Setting */}
            <div className="flex items-center gap-1.5 border-l border-slate-800 pl-3">
              <ShieldAlert className="w-3.5 h-3.5 text-purple-400 shrink-0" />
              <span className="text-slate-400">防盗水印:</span>
              <select
                value={watermarkPosition}
                onChange={e => setWatermarkPosition(e.target.value as WatermarkPosition)}
                className="bg-slate-800 border border-slate-700 text-purple-200 font-medium rounded-lg px-2 py-1 text-xs outline-none cursor-pointer"
              >
                <option value="grid_and_legend">✦ 双重斜向水印 (全图覆盖)</option>
              </select>

              <select
                value={watermarkOpacity.toString()}
                onChange={e => setWatermarkOpacity(parseFloat(e.target.value))}
                className="bg-slate-800 border border-slate-700 text-slate-300 rounded-lg px-2 py-1 text-xs outline-none cursor-pointer"
                title="调整水印透明度"
              >
                <option value="0.1">透明度 10% (极淡)</option>
                <option value="0.18">透明度 18% (标准防盗)</option>
                <option value="0.28">透明度 28% (高清晰度)</option>
              </select>
            </div>

            {/* Legend Scale & Layout Settings */}
            <div className="flex items-center gap-1.5 border-l border-slate-800 pl-3">
              <Sliders className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span className="text-slate-400">色号清单字号:</span>
              <select
                value={legendScaleMode}
                onChange={e => setLegendScaleMode(e.target.value as LegendScaleMode)}
                className="bg-slate-800 border border-slate-700 text-amber-300 font-bold rounded-lg px-2 py-1 text-xs outline-none cursor-pointer"
                title="网格变大时可自动按比例放大色号文字与色块"
              >
                <option value="auto">🔥 与网格自适应等比例放大 (推荐)</option>
                <option value="1.0">标准 1.0x (100%)</option>
                <option value="1.5">中度 1.5x (150%)</option>
                <option value="2.0">放大 2.0x (200%)</option>
                <option value="2.5">特大 2.5x (250%)</option>
                <option value="3.0">巨型 3.0x (300%)</option>
              </select>

              <select
                value={legendPosition}
                onChange={e => setLegendPosition(e.target.value as LegendPosition)}
                className="bg-slate-800 border border-slate-700 text-slate-200 rounded-lg px-2 py-1 text-xs outline-none cursor-pointer"
              >
                <option value="right">右侧多列侧边栏</option>
                <option value="bottom">下方横向表格</option>
              </select>
            </div>
          </div>

          {/* Sub Board Pagination selector */}
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400">选择板块视角:</span>
            <select
              value={selectedBoard === null ? 'full' : selectedBoard.toString()}
              onChange={e => {
                const val = e.target.value;
                setSelectedBoard(val === 'full' ? null : parseInt(val));
              }}
              className="bg-slate-800 border border-slate-700 text-slate-200 rounded-lg px-2.5 py-1 text-xs outline-none cursor-pointer"
            >
              <option value="full">全景整张图纸 ({width}x{height})</option>
              {Array.from({ length: totalBoards }).map((_, idx) => (
                <option key={idx} value={idx}>
                  第 {idx + 1} 板图纸 (29x29)
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Live Canvas Preview Body */}
        <div className="p-4 flex-1 overflow-auto bg-slate-950 flex items-center justify-center min-h-[300px]">
          <div ref={previewContainerRef} className="w-full h-full flex items-center justify-center" />
        </div>

        {/* Footer Actions */}
        <div className="p-3 sm:p-4 border-t border-slate-800 bg-slate-900 flex flex-col sm:flex-row items-center justify-between gap-2.5">
          <div className="text-slate-400 text-[11px] text-center sm:text-left">
            当前导出分辨率: 高清矢量位图 ({width}x{height} 豆)
          </div>

          <div className="flex flex-col sm:flex-row items-center gap-2 w-full sm:w-auto">
            {totalBoards > 1 && (
              <button
                onClick={handleDownloadAllBoards}
                className="w-full sm:w-auto bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-bold px-3 py-2 rounded-xl flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
              >
                <Download className="w-4 h-4 text-sky-400" />
                <span>批量全部分板图纸 ({totalBoards + 1}张)</span>
              </button>
            )}

            <button
              onClick={handleDownloadSingle}
              className="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-4 py-2 rounded-xl shadow-lg shadow-emerald-600/20 flex items-center justify-center gap-1.5 cursor-pointer transition-all active:scale-95"
            >
              <Download className="w-4 h-4" />
              <span>下载高清 PNG 图纸</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
