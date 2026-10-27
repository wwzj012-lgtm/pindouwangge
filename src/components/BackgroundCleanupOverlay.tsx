import React, { useLayoutEffect, useRef } from 'react';
import type { BackgroundCleanupPreview } from '../hooks/useBackgroundCleanup';

/** Separate surface: protection selection never repaints the underlying beads. */
export function BackgroundCleanupOverlay({ preview, cellSize, originX, originY }: {
  preview: BackgroundCleanupPreview; cellSize: number; originX: number; originY: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const canvas = ref.current;
    const host = canvas?.parentElement;
    if (!canvas || !host) return;
    const draw = () => {
      const width = host.clientWidth, height = host.clientHeight;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (canvas.width !== Math.floor(width * dpr)) canvas.width = Math.floor(width * dpr);
      if (canvas.height !== Math.floor(height * dpr)) canvas.height = Math.floor(height * dpr);
      const context = canvas.getContext('2d');
      if (!context) return;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);
      for (const component of preview.analysis.components) {
        if (!component.candidate) continue;
        const bounds = component.bounds;
        if (originX + (bounds.maxX + 1) * cellSize < 0 || originY + (bounds.maxY + 1) * cellSize < 0
          || originX + bounds.minX * cellSize > width || originY + bounds.minY * cellSize > height) continue;
        const protectedBlock = preview.protectedIds.has(component.id);
        context.fillStyle = protectedBlock ? 'rgba(16,185,129,0.22)' : 'rgba(245,158,11,0.58)';
        context.strokeStyle = protectedBlock ? '#047857' : '#b45309';
        context.lineWidth = Math.max(1, Math.min(2, cellSize * 0.15));
        context.setLineDash(protectedBlock ? [3, 2] : []);
        for (const index of component.indices) {
          const x = originX + (index % preview.analysis.width) * cellSize;
          const y = originY + Math.floor(index / preview.analysis.width) * cellSize;
          if (x + cellSize < 0 || y + cellSize < 0 || x > width || y > height) continue;
          context.fillRect(x, y, cellSize, cellSize);
          context.strokeRect(x + 0.5, y + 0.5, Math.max(0, cellSize - 1), Math.max(0, cellSize - 1));
        }
      }
      context.setLineDash([]);
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(host);
    return () => observer.disconnect();
  }, [preview.analysis, preview.protectedIds, cellSize, originX, originY]);
  return <canvas ref={ref} aria-hidden="true" data-background-cleanup-overlay
    className="pointer-events-none absolute inset-0 h-full w-full" />;
}
