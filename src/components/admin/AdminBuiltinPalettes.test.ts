import { describe, expect, it } from 'vitest';
import { BRAND_PALETTES } from '../../data/palettes';
import { builtinPaletteBrands, builtinPaletteColors } from './AdminBuiltinPalettes';

describe('read-only built-in palette catalog', () => {
  it('projects actual brand palettes without duplicating CUSTOM as a built-in catalog', () => {
    expect(builtinPaletteBrands).not.toContain('CUSTOM');
    expect(builtinPaletteColors('all', '')).toHaveLength(builtinPaletteBrands.reduce((total, key) => total + BRAND_PALETTES[key].length, 0));
  });
  it('filters by brand and real HEX/code, without changing the application palette', () => {
    const before = JSON.stringify(BRAND_PALETTES);
    const colors = builtinPaletteColors('MARD', '#faf4c8');
    expect(colors).toContainEqual({ id: 'MARD_A1', brand: 'MARD', brandName: 'Mard-221', code: 'A1', name: 'A1', hex: '#FAF4C8' });
    expect(builtinPaletteColors('PERLER', '').every(color => color.brand === 'PERLER')).toBe(true);
    expect(builtinPaletteColors('all', 'not-a-real-color')).toEqual([]);
    expect(JSON.stringify(BRAND_PALETTES)).toBe(before);
  });
});
