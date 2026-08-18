import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./ImageStudioModal.tsx', import.meta.url), 'utf8');

describe('ImageStudioModal responsive layout', () => {
  it('uses the bounded desktop workspace and independently scrolling settings rail', () => {
    expect(source).toContain('w-[min(96vw,1280px)]');
    expect(source).toContain('h-[min(92vh,900px)]');
    expect(source).toContain('xl:grid-cols-[minmax(0,1fr)_360px]');
    expect(source).toMatch(/bg-white border-t xl:border-t-0 xl:border-l border-slate-200[^`]+overflow-y-auto/);
  });

  it('wraps tools without horizontal overflow and switches preview panes on mobile', () => {
    expect(source).toContain('flex flex-wrap items-center');
    expect(source).not.toContain('overflow-x-auto');
    expect(source).toContain("useState<'source' | 'pattern'>('source')");
    expect(source).toContain("setActivePreviewPane('source')");
    expect(source).toContain("setActivePreviewPane('pattern')");
    expect(source).toContain('sticky bottom-0');
  });

  it('retains all controls and pixelated pattern rendering', () => {
    for (const handler of [
      'handleSmartCrop', 'autoDetectAndRemoveBackground', 'removeWhiteBackground',
      'disableBackgroundRemoval', 'handleCanvasClick', 'handleApply', 'handleClose',
    ]) expect(source).toContain(handler);

    for (const preset of ['vivid', 'anime', 'photo', 'pixel', 'clean']) {
      expect(source).toContain(`applyPreset('${preset}')`);
    }

    expect(source).toContain("style={{ imageRendering: 'pixelated' }}");
    for (const control of [
      'setRotation', 'setFlipH', 'localSettings.sharpening',
      'localSettings.chromaKeyTolerance', 'localSettings.brightness',
      'localSettings.contrast', 'localSettings.saturation',
      'localSettings.ditherStrength', 'localSettings.colorLimit',
    ]) expect(source).toContain(control);
  });
});
