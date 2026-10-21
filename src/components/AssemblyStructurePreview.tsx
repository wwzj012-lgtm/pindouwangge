import { useEffect, useMemo, useRef, useState } from 'react';
import type { AssemblyPartPlan, AssemblyPlannedPart } from '../utils/assemblyPartPlanner';
import type { AssemblyStructureSnapshot } from '../utils/assemblyProject';

interface AssemblyStructurePreviewProps {
  structure: AssemblyStructureSnapshot;
  plan: AssemblyPartPlan | null;
  selectedPartId: string | null;
  onSelectPart: (partId: string) => void;
}

interface PreviewVoxel {
  x: number;
  y: number;
  z: number;
}

const FULL_RENDER_VOXEL_LIMIT = 6_000;
const SURFACE_RENDER_VOXEL_LIMIT = 7_000;

type PreviewMode = 'complete' | 'surface' | 'surface-lod';
type CanvasPreview = { voxels: PreviewVoxel[]; total: number; surfaceTotal: number; mode: PreviewMode };

function rotateVoxel(voxel: PreviewVoxel, structure: AssemblyStructureSnapshot, rotation: number): PreviewVoxel {
  const { width, depth } = structure.dimensions;
  if (rotation === 1) return { x: depth - 1 - voxel.z, y: voxel.y, z: voxel.x };
  if (rotation === 2) return { x: width - 1 - voxel.x, y: voxel.y, z: depth - 1 - voxel.z };
  if (rotation === 3) return { x: voxel.z, y: voxel.y, z: width - 1 - voxel.x };
  return voxel;
}

function allStructureVoxels(structure: AssemblyStructureSnapshot): PreviewVoxel[] {
  const voxels: PreviewVoxel[] = [];
  for (let z = 0; z < structure.dimensions.depth; z += 1) for (let y = 0; y < structure.dimensions.height; y += 1) for (let x = 0; x < structure.dimensions.width; x += 1) {
    if (!structure.occupancy[z]?.[y]?.[x]) continue;
    voxels.push({ x, y, z });
  }
  return voxels;
}

function isOccupied(structure: AssemblyStructureSnapshot, x: number, y: number, z: number): boolean {
  return Boolean(structure.occupancy[z]?.[y]?.[x]);
}

function surfaceVoxels(structure: AssemblyStructureSnapshot, voxels: PreviewVoxel[]): PreviewVoxel[] {
  return voxels.filter(({ x, y, z }) => !isOccupied(structure, x - 1, y, z) || !isOccupied(structure, x + 1, y, z) || !isOccupied(structure, x, y - 1, z) || !isOccupied(structure, x, y + 1, z) || !isOccupied(structure, x, y, z - 1) || !isOccupied(structure, x, y, z + 1));
}

function voxelHash({ x, y, z }: PreviewVoxel): number {
  let hash = 2_166_136_261;
  for (const value of [x, y, z]) hash = Math.imul(hash ^ value, 16_777_619);
  return hash >>> 0;
}

function uniformSurfaceLod(voxels: PreviewVoxel[], limit: number): PreviewVoxel[] {
  if (voxels.length <= limit) return voxels;
  const minX = Math.min(...voxels.map(voxel => voxel.x)); const minY = Math.min(...voxels.map(voxel => voxel.y)); const minZ = Math.min(...voxels.map(voxel => voxel.z));
  const maxSpan = Math.max(...voxels.map(voxel => Math.max(voxel.x - minX, voxel.y - minY, voxel.z - minZ))) + 1;
  let bucketSize = Math.max(1, Math.ceil(Math.cbrt(voxels.length / limit)));
  let selected: PreviewVoxel[] = [];
  do {
    const buckets = new Map<string, PreviewVoxel>();
    for (const voxel of voxels) {
      const key = `${Math.floor((voxel.x - minX) / bucketSize)}:${Math.floor((voxel.y - minY) / bucketSize)}:${Math.floor((voxel.z - minZ) / bucketSize)}`;
      const current = buckets.get(key);
      if (!current || voxelHash(voxel) < voxelHash(current)) buckets.set(key, voxel);
    }
    selected = [...buckets.values()];
    bucketSize += 1;
  } while (selected.length > limit && bucketSize <= maxSpan);
  return selected.length <= limit ? selected : [...selected].sort((left, right) => voxelHash(left) - voxelHash(right)).slice(0, limit);
}

function canvasVoxels(structure: AssemblyStructureSnapshot): CanvasPreview {
  const allVoxels = allStructureVoxels(structure);
  if (allVoxels.length <= FULL_RENDER_VOXEL_LIMIT) return { voxels: allVoxels, total: allVoxels.length, surfaceTotal: allVoxels.length, mode: 'complete' };
  const exterior = surfaceVoxels(structure, allVoxels);
  if (exterior.length <= SURFACE_RENDER_VOXEL_LIMIT) return { voxels: exterior, total: allVoxels.length, surfaceTotal: exterior.length, mode: 'surface' };
  return { voxels: uniformSurfaceLod(exterior, SURFACE_RENDER_VOXEL_LIMIT), total: allVoxels.length, surfaceTotal: exterior.length, mode: 'surface-lod' };
}

function drawDiamond(context: CanvasRenderingContext2D, centerX: number, centerY: number, size: number, color: string): void {
  context.fillStyle = color;
  context.beginPath();
  context.moveTo(centerX, centerY - size * 0.5);
  context.lineTo(centerX + size, centerY);
  context.lineTo(centerX, centerY + size * 0.5);
  context.lineTo(centerX - size, centerY);
  context.closePath();
  context.fill();
}

function drawProjection(canvas: HTMLCanvasElement, structure: AssemblyStructureSnapshot, voxels: PreviewVoxel[], rotation: number, exploded: number): void {
  const bounds = canvas.getBoundingClientRect();
  const cssWidth = Math.max(1, Math.round(bounds.width));
  const cssHeight = Math.max(180, Math.round(bounds.height));
  const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
  if (canvas.width !== Math.round(cssWidth * pixelRatio) || canvas.height !== Math.round(cssHeight * pixelRatio)) {
    canvas.width = Math.round(cssWidth * pixelRatio);
    canvas.height = Math.round(cssHeight * pixelRatio);
  }
  const context = canvas.getContext('2d');
  if (!context) return;
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, cssWidth, cssHeight);
  if (!voxels.length) return;
  const rotatedDimensions = rotation % 2 === 0 ? structure.dimensions : { ...structure.dimensions, width: structure.dimensions.depth, depth: structure.dimensions.width };
  const midX = (rotatedDimensions.width - 1) / 2;
  const midZ = (rotatedDimensions.depth - 1) / 2;
  const midY = (rotatedDimensions.height - 1) / 2;
  const projected = voxels.map(voxel => {
    const point = rotateVoxel(voxel, structure, rotation);
    const offsetX = (point.x - midX) * exploded * 0.12;
    const offsetZ = (point.z - midZ) * exploded * 0.12;
    const offsetY = (point.y - midY) * exploded * 0.08;
    return { ...point, projectionX: point.x - point.z + offsetX - offsetZ, projectionY: -point.y * 0.92 + (point.x + point.z) * 0.46 + offsetY };
  });
  const minX = Math.min(...projected.map(point => point.projectionX - 0.72)); const maxX = Math.max(...projected.map(point => point.projectionX + 0.72));
  const minY = Math.min(...projected.map(point => point.projectionY - 0.36)); const maxY = Math.max(...projected.map(point => point.projectionY + 0.86));
  const padding = Math.max(12, Math.min(cssWidth, cssHeight) * 0.1);
  // Large or exploded structures must still fit; a minimum tile size crops
  // their outer edges in narrow previews.
  const tile = Math.min(Math.max(1, cssWidth - padding * 2) / Math.max(1, maxX - minX), Math.max(1, cssHeight - padding * 2) / Math.max(1, maxY - minY));
  const translateX = (cssWidth - (maxX - minX) * tile) / 2 - minX * tile;
  const translateY = (cssHeight - (maxY - minY) * tile) / 2 - minY * tile;
  const rendered = projected.map(point => ({ ...point, screenX: translateX + point.projectionX * tile, screenY: translateY + point.projectionY * tile })).sort((left, right) => left.screenY - right.screenY || left.x + left.z - right.x - right.z);
  for (const voxel of rendered) {
    drawDiamond(context, voxel.screenX, voxel.screenY, tile * 0.72, '#a855f7');
    context.fillStyle = '#7e22ce';
    context.beginPath();
    context.moveTo(voxel.screenX - tile * 0.72, voxel.screenY);
    context.lineTo(voxel.screenX, voxel.screenY + tile * 0.36);
    context.lineTo(voxel.screenX, voxel.screenY + tile * 0.86);
    context.lineTo(voxel.screenX - tile * 0.72, voxel.screenY + tile * 0.5);
    context.closePath();
    context.fill();
    context.fillStyle = '#c084fc';
    context.beginPath();
    context.moveTo(voxel.screenX + tile * 0.72, voxel.screenY);
    context.lineTo(voxel.screenX, voxel.screenY + tile * 0.36);
    context.lineTo(voxel.screenX, voxel.screenY + tile * 0.86);
    context.lineTo(voxel.screenX + tile * 0.72, voxel.screenY + tile * 0.5);
    context.closePath();
    context.fill();
  }
}

function PartGrid({ part }: { part: AssemblyPlannedPart }) {
  return (
    <div className="mt-2 max-w-full overflow-hidden rounded-lg border border-purple-200 bg-white p-2">
      <div className="grid min-w-0 w-full gap-px bg-purple-100" style={{ gridTemplateColumns: `repeat(${part.width}, minmax(0, 1fr))` }}>
        {part.grid.flatMap((row, v) => row.map((cell, u) => <span key={`${u}-${v}`} title={cell.isSlot ? `卡槽 ${u + 1}, ${v + 1}` : cell.occupied ? `拼豆 ${u + 1}, ${v + 1}` : '空白'} className={`aspect-square min-h-1 border border-white/70 ${cell.isSlot ? 'bg-amber-400 ring-1 ring-inset ring-amber-700' : ''}`} style={cell.occupied ? { backgroundColor: cell.color ?? '#c4b5fd' } : undefined} />))}
      </div>
    </div>
  );
}

export function AssemblyStructurePreview({ structure, plan, selectedPartId, onSelectPart }: AssemblyStructurePreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [rotation, setRotation] = useState(0);
  const [exploded, setExploded] = useState(0);
  const preview = useMemo(() => canvasVoxels(structure), [structure]);
  const selectedPart = plan?.parts.find(part => part.id === selectedPartId) ?? plan?.parts[0] ?? null;
  const previewNotice = preview.mode === 'complete'
    ? `已完整绘制 ${preview.total.toLocaleString()} 个体素。`
    : preview.mode === 'surface'
      ? `为保持页面流畅，当前绘制 ${preview.voxels.length.toLocaleString()} 个外表面体素；零件与结构数据不受影响。`
      : `为保持页面流畅，当前从 ${preview.surfaceTotal.toLocaleString()} 个外表面体素中均匀预览 ${preview.voxels.length.toLocaleString()} 个；零件与结构数据不受影响。`;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const redraw = () => drawProjection(canvas, structure, preview.voxels, rotation, exploded);
    redraw();
    const observer = new ResizeObserver(redraw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [structure, preview.voxels, rotation, exploded]);

  return (
    <section className="min-w-0 overflow-hidden rounded-xl border border-purple-200/80 bg-white p-2.5 shadow-2xs sm:p-3" aria-label="整体体素结构预览">
      <div className="min-w-0"><h2 className="text-sm font-black text-purple-950">整体体素 / 等轴结构</h2><p className="mt-0.5 text-[10px] leading-4 text-purple-500">该视图来自多视角融合体素，不是正面或侧面参考图；黄色缺口表示自动卡槽。</p></div>
      <div className="mt-2 grid min-w-0 grid-cols-2 gap-1.5 text-[9px] font-bold text-purple-700 sm:grid-cols-4"><div className="min-w-0 rounded-md bg-purple-50 px-2 py-1.5">尺寸 <span className="text-purple-950">{structure.dimensions.width} × {structure.dimensions.height} × {structure.dimensions.depth}</span></div><div className="min-w-0 rounded-md bg-purple-50 px-2 py-1.5">体素 <span className="text-purple-950">{preview.total}</span></div><div className="min-w-0 rounded-md bg-purple-50 px-2 py-1.5">视图 <span className="text-purple-950">{structure.sourceViews.length}</span></div><div className="min-w-0 rounded-md bg-purple-50 px-2 py-1.5">可信度 <span className="text-purple-950">{Math.round(structure.confidence.score * 100)}%</span></div></div>
      <div className="mx-auto mt-2 w-full max-w-4xl overflow-hidden rounded-lg border border-purple-100 bg-gradient-to-br from-purple-50 via-white to-violet-50"><canvas ref={canvasRef} className="h-[clamp(12rem,56vw,28rem)] w-full" aria-label="体素等轴结构预览" /></div>
      <p className="mt-1.5 text-[9px] leading-3.5 text-purple-500">{previewNotice}</p>
      <details className="mt-2 rounded-lg border border-purple-100 bg-purple-50/50 p-2" aria-label="预览设置">
        <summary className="flex min-h-11 cursor-pointer items-center text-[10px] font-black text-purple-800">预览设置</summary>
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          <button type="button" onClick={() => setRotation(current => (current + 3) % 4)} className="min-h-11 rounded-md border border-purple-200 bg-white px-2 py-1 text-[10px] font-bold text-purple-700 hover:bg-purple-50">↶ 旋转</button>
          <button type="button" onClick={() => setRotation(current => (current + 1) % 4)} className="min-h-11 rounded-md border border-purple-200 bg-white px-2 py-1 text-[10px] font-bold text-purple-700 hover:bg-purple-50">旋转 ↷</button>
          <label className="col-span-2 flex min-h-11 items-center gap-2 text-[10px] font-bold text-purple-700"><span className="shrink-0">分离 {exploded}</span><input aria-label="零件分离程度" type="range" min="0" max="16" value={exploded} onChange={event => setExploded(Number(event.target.value))} className="min-w-0 flex-1 accent-purple-600" /></label>
        </div>
      </details>
      {plan && <details className="mt-3 min-w-0 rounded-lg border border-purple-100 bg-purple-50/50 p-2" aria-label="零件与组装"><summary className="flex cursor-pointer flex-wrap items-center justify-between gap-1 text-[10px] font-black text-purple-950"><span>零件与组装</span><span className={`rounded px-1.5 py-1 text-[9px] ${plan.confidence.manufacturable ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{plan.confidence.manufacturable ? '可制作' : '暂不可制作'} · {plan.parts.length} 件</span></summary><div className="mt-2"><div className="flex flex-wrap items-center justify-between gap-1"><div className="min-w-0"><p className="text-[11px] font-black text-purple-950">可拆分零件方案</p><p className="text-[9px] font-bold text-purple-600">{plan.parts.length} 个截面零件 · {plan.connections.length} 个连接 · {plan.totalBeans} 颗</p></div></div>{plan.warnings.length > 0 && <div className="mt-2 grid gap-1">{plan.warnings.map(warning => <p key={warning} className="rounded-md bg-amber-100/70 px-2 py-1 text-[9px] font-bold text-amber-800">{warning}</p>)}</div>}{selectedPart && <div className="mt-3 min-w-0 rounded-lg border border-purple-100 bg-white/80 p-2"><div className="flex flex-wrap items-center justify-between gap-1"><div className="min-w-0"><p className="truncate text-[11px] font-black text-purple-950">{selectedPart.number} · {selectedPart.name}</p><p className="text-[9px] font-bold text-purple-600">{selectedPart.orientation.toUpperCase()} · {selectedPart.width} × {selectedPart.height} · {selectedPart.beanCount} 颗</p></div><button type="button" onClick={() => onSelectPart(selectedPart.id)} className="shrink-0 rounded-md border border-purple-200 bg-white px-2 py-1 text-[9px] font-bold text-purple-700">定位零件</button></div><PartGrid part={selectedPart} /><div className="mt-2 grid gap-1">{selectedPart.slots.length ? selectedPart.slots.map(slot => <div key={slot.id} className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-[9px] font-bold text-amber-900">黄色槽位 · {slot.side === 'top' ? '从顶边' : '从底边'}插入 · 配对 {slot.partnerPartId}</div>) : <p className="text-[9px] text-purple-500">该零件暂无自动卡槽。</p>}</div></div>}{!plan.parts.length && <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[9px] font-bold text-amber-800">整体体素结构已生成，但当前截面不足以形成可拆分零件；请补充顶部/背面或调整视图比例后重新生成。</p>}</div></details>}
    </section>
  );
}
