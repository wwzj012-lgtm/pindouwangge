import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('source image underlay wiring regression', () => {
  it('passes both opacity and its setter to the desktop toolbar', () => {
    const source = readFileSync(new URL('./desktop/DesktopWorkspace.tsx', import.meta.url), 'utf8');
    const toolbar = source.slice(source.indexOf('<Toolbar'), source.indexOf('/>', source.indexOf('<Toolbar')));
    expect(toolbar).toContain('overlayOpacity={overlayOpacity}');
    expect(toolbar).toContain('setOverlayOpacity={setOverlayOpacity}');
  });

  it.each(['desktop/DesktopWorkspace.tsx', 'mobile/MobileWorkspace.tsx'])('passes display settings to the canvas in %s', (path) => {
    const source = readFileSync(new URL(`./${path}`, import.meta.url), 'utf8');
    const canvas = source.slice(source.indexOf('<GridCanvas'), source.indexOf('/>', source.indexOf('<GridCanvas')));
    expect(canvas).toContain('overlayOpacity={overlayOpacity}');
    expect(canvas).toContain('keepImageAspectRatio={settings.keepAspectRatio}');
  });

  it('does not paint opaque white empty cells over an enabled underlay', () => {
    const source = readFileSync(new URL('./GridCanvas.tsx', import.meta.url), 'utf8');
    const cells = source.slice(source.indexOf('// Empty peg styling'), source.indexOf('// 6. Symmetry'));
    expect(cells).toContain('ctx.fillStyle = showOverlay');
    expect(cells).toContain('rgba(255, 255, 255, 0.12)');
  });
});
