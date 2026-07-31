import React, { useState, useEffect, useRef } from 'react';
import { X, Download, Image as ImageIcon, Printer, Check, Eye } from 'lucide-react';
import { BeadColor, BeadShape } from '../types';
import {
  generatePatternCanvas,
  downloadCanvasImage,
  ExportOptions,
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
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl text-slate-200 text-xs overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
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
        <div className="p-4 bg-slate-950/60 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={showSymbols}
                onChange={e => setShowSymbols(e.target.checked)}
                className="accent-emerald-500 rounded cursor-pointer"
              />
              <span>显示色号标识字符</span>
            </label>

            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={showCoordinates}
                onChange={e => setShowCoordinates(e.target.checked)}
                className="accent-emerald-500 rounded cursor-pointer"
              />
              <span>显示标尺坐标 (A..Z / 1..N)</span>
            </label>
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
        <div className="p-4 border-t border-slate-800 bg-slate-900 flex flex-wrap items-center justify-between gap-3">
          <div className="text-slate-400 text-[11px]">
            当前导出分辨率: 高清矢量位图 ({width}x{height} 豆)
          </div>

          <div className="flex items-center gap-2">
            {totalBoards > 1 && (
              <button
                onClick={handleDownloadAllBoards}
                className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-bold px-3 py-2 rounded-xl flex items-center gap-1.5 cursor-pointer transition-colors"
              >
                <Download className="w-4 h-4 text-sky-400" />
                <span>批量下载全部分板图纸 ({totalBoards + 1}张)</span>
              </button>
            )}

            <button
              onClick={handleDownloadSingle}
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-4 py-2 rounded-xl shadow-lg shadow-emerald-600/20 flex items-center gap-1.5 cursor-pointer transition-all active:scale-95"
            >
              <Download className="w-4 h-4" />
              <span>下载当前高清 PNG 图纸</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
