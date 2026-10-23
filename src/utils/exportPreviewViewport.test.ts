import { describe, expect, it } from 'vitest';
import { exportPreviewViewport } from './exportPreviewViewport';

describe('bounded export preview', () => {
  it('numeric zoom does not feed scrollbar dimensions back into the content size', () => {
    const image={width:2860,height:1879};
    const outer=exportPreviewViewport(image,{width:1100,height:600},.2);
    const withScrollbars=exportPreviewViewport(image,{width:1083,height:583},.2);
    expect(outer.surfaceWidth).toBe(612);
    expect(outer.surfaceHeight).toBeCloseTo(415.8,8);
    expect(withScrollbars.surfaceWidth).toBe(outer.surfaceWidth);
    expect(withScrollbars.surfaceHeight).toBe(outer.surfaceHeight);
  });
  it('does not round fractional-size manual previews up into a phantom scrollbar', () => {
    const viewport={width:572.65625,height:622};
    const image={width:3198,height:1703};
    const fit=exportPreviewViewport(image,viewport).fit;
    const manual=exportPreviewViewport(image,viewport,fit);
    expect(manual.surfaceWidth).toBeLessThanOrEqual(viewport.width+.00001);
  });
  it.each([[2860,1879],[1879,2860],[20000,200],[200,20000],[400,400]])('fits %ix%i completely inside the stage', (width,height) => {
    for (const viewport of [{width:700,height:320},{width:288,height:220}]) {
      const image = {width,height};
      const layout = exportPreviewViewport(image,viewport);
      expect(layout.width).toBeLessThanOrEqual(viewport.width - 39);
      expect(layout.height).toBeLessThanOrEqual(viewport.height - 39);
      expect(layout.surfaceWidth).toBe(viewport.width);
      expect(layout.surfaceHeight).toBe(viewport.height);
      expect(layout.width / layout.height).toBeCloseTo(width / height);
      expect(image).toEqual({width,height});
    }
  });
  it('100% uses scrollable surface rather than overflowing the preview card', () => {
    const layout=exportPreviewViewport({width:2860,height:1879},{width:700,height:320},1);
    expect(layout).toMatchObject({width:2860,height:1879,scale:1,surfaceWidth:2900,surfaceHeight:1919});
  });
  it('handles initial zero sizes and invalid zoom safely', () => {
    expect(exportPreviewViewport({width:0,height:0},{width:0,height:0}).scale).toBe(0);
    expect(exportPreviewViewport({width:100,height:200},{width:300,height:300},NaN).scale).toBe(1);
    expect(exportPreviewViewport({width:100,height:200},{width:300,height:300},100).scale).toBe(8);
  });
});
