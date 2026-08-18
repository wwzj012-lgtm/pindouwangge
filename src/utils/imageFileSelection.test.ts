import { describe, expect, it } from 'vitest';
import { consumeSelectedImageFile } from './imageFileSelection';

describe('image file selection', () => {
  it('does nothing on cancel and still clears the input', () => {
    const input = { files: null, value: 'stale' };
    expect(consumeSelectedImageFile(input)).toBeNull();
    expect(input.value).toBe('');
  });

  it('returns the selected file and clears the value so the same file can be selected again', () => {
    const file = new File(['image'], 'pattern.png', { type: 'image/png' });
    const input = { files: [file], value: 'C:\\fakepath\\pattern.png' };
    expect(consumeSelectedImageFile(input)).toBe(file);
    expect(input.value).toBe('');
  });
});
