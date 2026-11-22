/**
 * Accessibility smoke tests: render key interactive components in jsdom and
 * run axe-core against each. Layout-dependent rules are disabled because
 * jsdom has no real layout engine; those stay covered by manual review.
 *
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';

// Silence the act() warning: these tests render synchronously inside act().
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// Silence the act() warning: these tests render synchronously inside act().
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import axe from 'axe-core';
import { MobileSelect } from './ui/MobileSelect';
import { PatternConfirmDialog } from './PatternConfirmDialog';

const containers: HTMLElement[] = [];
const roots: Root[] = [];

function mount(markup: React.ReactNode): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  containers.push(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => { root.render(markup); });
  return container;
}

async function runAxe(container: HTMLElement): Promise<string[]> {
  // Copy axe into the container's document so it scans the live DOM.
  const script = document.createElement('script');
  script.textContent = axe.source;
  document.head.appendChild(script);
  const axeGlobal = (window as any).axe;
  const results = await axeGlobal.run(container, {
    resultTypes: ['violations'],
    rules: { 'color-contrast': { enabled: false } },
  });
  return results.violations
    .filter((violation: any) => violation.impact === 'critical' || violation.impact === 'serious')
    .map((violation: any) => `${violation.id}: ${violation.nodes.map((node: any) => node.target.join(' ')).join('; ')}`);
}

describe('accessibility smoke (axe-core, jsdom)', () => {
  it.afterEach(() => {
    for (const root of roots.splice(0)) act(() => { root.unmount(); });
    for (const container of containers.splice(0)) container.remove();
    document.head.querySelectorAll('script').forEach((script) => script.remove());
  });

  it('MobileSelect renders without critical or serious violations', async () => {
    const container = mount(
      <MobileSelect
        value="hot"
        ariaLabel="作品排序"
        options={[
          { value: 'hot', label: '热度' },
          { value: 'latest', label: '最新发布' },
        ]}
        onChange={() => {}}
      />,
    );
    expect(container.textContent).toContain('热度');
    const violations = await runAxe(container);
    expect(violations).toEqual([]);
  });

  it('PatternConfirmDialog renders without critical or serious violations', async () => {
    const container = mount(
      <PatternConfirmDialog
        isOpen
        title="删除图库工程？"
        description="将从云端图库和本机副本中删除。"
        confirmLabel="确认删除"
        cancelLabel="取消"
        onConfirm={() => {}}
        onClose={() => {}}
      />,
    );
    expect(container.textContent).toContain('确认删除');
    const violations = await runAxe(container);
    expect(violations).toEqual([]);
  });
});
