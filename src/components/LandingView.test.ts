import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LANDING_CAPABILITIES, LANDING_SHOWCASE } from './LandingView';

describe('landing page entry', () => {
  it('keeps a compact, local showcase dataset and the four core capabilities', () => {
    expect(LANDING_SHOWCASE).toHaveLength(3);
    expect(LANDING_CAPABILITIES).toHaveLength(4);
    expect(LANDING_CAPABILITIES.map(item => item.title)).toEqual([
      '智能转拼豆',
      '精准配色',
      '自由画板',
      '立体组合',
    ]);
  });

  it('uses accessible native actions and reduced-motion CSS for the landing surface', () => {
    const source = readFileSync(new URL('./LandingView.tsx', import.meta.url), 'utf8');
    const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8');
    expect(source).toContain('onEnterWorkspace');
    expect(source).toContain("const enterWorkspace = onEnterWorkspace ?? (() => navigateTab('studio'))");
    expect(source).toContain("const exploreCommunity = onExploreCommunity ?? (() => navigateTab('community'))");
    expect(source).toContain('onClick={enterWorkspace}');
    expect(source).toContain('onClick={exploreCommunity}');
    expect(source).not.toContain('disabled={isEntering}');
    expect(source).toContain('aria-label="精选作品预览"');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('.landing-shell');
    expect(css).toContain('overflow-x: clip');
    expect(css).toContain('--landing-header-offset: 88px');
    expect(css).toContain('.landing-anchor-target { scroll-margin-top: var(--landing-header-offset); }');
    expect(source).toContain('landing-anchor-target" id="showcase"');
    expect(source).toContain('landing-anchor-target" id="capabilities"');
    expect(source).toContain('landing-anchor-target" id="workflow"');
  });

  it('keeps the current functional workspace behind an explicit route', () => {
    const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
    expect(app).toContain("navigatePublic('/workspace')");
    expect(app).toContain("navigatePublic('/workspace?tab=community')");
    expect(app).toContain('<LandingView');
    expect(app).toContain('initialTab={resolveWorkspaceTab()}');
  });
});
