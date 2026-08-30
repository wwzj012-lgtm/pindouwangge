import { describe, expect, it } from 'vitest';
import { parseAssemblyHexColor, requireAssemblyConversionResult, toAssemblyConverterPalette } from './assemblyConversionContract';

describe('assemblyConversionContract', () => {
  it('creates pipeline-compatible RGB palette entries from workspace hex colours', () => {
    expect(parseAssemblyHexColor('#7c3aed')).toEqual([124, 58, 237]);
    expect(toAssemblyConverterPalette([{ id: 'violet', hex: '#7c3aed', code: 'V', name: '紫色' }])).toEqual([{ id: 'violet', hex: '#7c3aed', code: 'V', name: '紫色', rgb: [124, 58, 237] }]);
    expect(toAssemblyConverterPalette([{ id: 'invalid', hex: 'nope', code: 'X', name: '无效' }])).toEqual([]);
  });

  it('accepts the real converter shape and rejects malformed results explicitly', () => {
    expect(requireAssemblyConversionResult({ grid: [['violet', null]], diagnostics: { pipeline: 'cartoon' } }, 2, 1).grid).toEqual([['violet', null]]);
    expect(() => requireAssemblyConversionResult({ grid: [['violet']], diagnostics: {} }, 2, 1)).toThrow('网格尺寸无效');
    expect(() => requireAssemblyConversionResult({ grid: [['violet', null]] }, 2, 1)).toThrow('诊断信息');
  });
});
