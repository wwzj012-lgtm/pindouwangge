import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./GridCanvas.tsx', import.meta.url), 'utf8');
const panelStart = source.indexOf('{/* Draggable Original Image Reference Box */}');
const panelEnd = source.indexOf('{isCanvasResetDialogOpen &&', panelStart);
const panel = source.slice(panelStart, panelEnd);
const previewStart = source.indexOf('{/* Enlarged Original Image Lightbox Modal */}');
const preview = source.slice(previewStart);

describe('original image reference panel header contract', () => {
  it('keeps all controls organized inside the draggable header and cloud collapsed toggle', () => {
    const headerStart = panel.indexOf('onPointerDown={handleReferencePanelPointerDown}');
    const controlsStart = panel.indexOf('data-reference-panel-controls');

    expect(headerStart).toBeGreaterThanOrEqual(0);
    expect(controlsStart).toBeGreaterThan(headerStart);
    expect(panel).toContain('aria-label="收起原图参考"');
    expect(panel).toContain('aria-label="展开原图参考"');
    expect(panel).toContain('<Cloud');
    expect(panel).not.toContain('grid grid-cols-3 gap-1.5 p-2');
  });

  it('removes visible drag instructions and prevents controls from starting a drag', () => {
    expect(panel).not.toContain('按住拖动');
    expect(panel).toContain('onPointerDown={event => event.stopPropagation()}');
    expect(panel).toContain('aria-label="上传原图"');
    expect(panel).toContain('aria-label="重置当前画板"');
    expect(panel).toContain('aria-label="收起原图参考"');
    expect(panel).toContain('aria-label="展开原图参考"');
  });

  it('uses low-saturation semantic colors and keeps the reference panel compact on mobile', () => {
    expect(panel).toContain('w-[min(220px,calc(100vw-16px))] sm:w-[300px]');
    expect(panel).toContain('border-emerald-300 bg-emerald-50');
    expect(panel).toContain('border-rose-300 bg-rose-50');
    expect(panel).toContain('border-purple-200 bg-purple-50/80');
    expect(panel).not.toContain('bg-emerald-600');
    expect(panel).not.toContain('bg-rose-600');
  });

  it('keeps the reduced type, icon, and spacing scale without shrinking the upload hit area', () => {
    expect(panel).toContain('min-h-24 w-full');
    expect(panel).toContain('h-5 w-5 text-purple-600');
    expect(panel).toContain('text-[13px] font-extrabold text-purple-950">上传原图');
    expect(panel).toContain('text-[11px] font-medium text-purple-500">对照原图手动绘制');
    expect(panel).toContain('max-h-[120px] w-auto max-w-full object-contain sm:max-h-[150px] lg:max-h-[180px]');
    expect(panel).toContain('flex min-h-24 w-full flex-col');
  });

  it('routes both reset entry points through the shared confirmation and canvas callback', () => {
    expect(source.match(/onClick=\{\(\) => setIsCanvasResetDialogOpen\(true\)\}/g)).toHaveLength(3);
    expect(source.match(/role="alertdialog"/g)).toHaveLength(1);
    expect(source.match(/onClick=\{confirmCanvasReset\}/g)).toHaveLength(1);
    expect(source).toContain('onResetCanvas?.();');
    expect(source).toContain('fixed inset-0 z-[60]');
  });

  it('makes the enlarged preview reset the drawing without changing its zoom or pan', () => {
    expect(preview).toContain('onClick={() => setIsCanvasResetDialogOpen(true)}');
    expect(preview).toContain('border border-rose-300 bg-rose-50');
    expect(preview).toContain('title="重置图纸"');
    expect(preview).toContain('aria-label="重置图纸"');
    expect(preview).toContain('<span>重置图纸</span>');
    expect(preview).not.toContain('onClick={resetModalImageView}');
    expect(source).not.toContain('复位视图');
    expect(preview).toContain('changeImagePreviewScale(view, -0.25)');
    expect(preview).toContain('changeImagePreviewScale(view, 0.25)');
    expect(preview).toContain('handleModalImagePointerMove');
  });
});
