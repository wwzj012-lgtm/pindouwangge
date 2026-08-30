import { describe, expect, it } from 'vitest';
import { createAssemblyBlueprintSvg, escapeAssemblyXml, getAssemblyExportStats } from './assemblyExport';

describe('assemblyExport', () => {
  const palette = [{ id: 'A', hex: '#ff0000', code: 'R<&' }, { id: 'B', hex: '#00ff00', code: 'G' }];

  it('escapes SVG/XML content and includes grid delivery data', () => {
    expect(escapeAssemblyXml(`<>&'\"`)).toBe('&lt;&gt;&amp;&apos;&quot;');
    const svg = createAssemblyBlueprintSvg({ title: 'A < B', brandName: 'Brand & Co', cells: [['A', 'B']], palette, showColorCodes: true });
    expect(svg).toContain('A &lt; B');
    expect(svg).toContain('Brand &amp; Co');
    expect(svg).toContain('R&lt;&amp;');
    expect(svg).toContain('总计 2 颗');
  });

  it('keeps colour counts consistent and handles empty grids', () => {
    expect(getAssemblyExportStats([['A', null], ['A', 'B']], palette)).toEqual([{ id: 'A', label: 'R<&', hex: '#ff0000', count: 2 }, { id: 'B', label: 'G', hex: '#00ff00', count: 1 }]);
    expect(createAssemblyBlueprintSvg({ title: '空', brandName: '品牌', cells: [], palette })).toContain('总计 0 颗');
  });
});
