import { describe, expect, it } from 'vitest';
import { isLatestAssemblyGeneration, mapAssemblyPreprocessing, MAX_ASSEMBLY_IMAGE_FILE_BYTES, validateAssemblyImageFile, validateAssemblyModelFile } from './assemblyGeneration';

describe('assemblyGeneration', () => {
  it('maps only supported preprocessing controls to converter settings', () => {
    expect(mapAssemblyPreprocessing({ fit: 'cover', removeWhiteBackground: true, backgroundTolerance: 24, colorLimit: 16, quantizationStrength: 32 })).toEqual({ keepAspectRatio: false, colorLimit: 16, chromaKeyColor: '#FFFFFF', chromaKeyTolerance: 24, quantizationStrength: 32 });
  });

  it('enforces file type and size limits', () => {
    expect(validateAssemblyImageFile({ name: 'model.obj', type: 'model/obj', size: 1 } as File)).toBe('请选择图片文件');
    expect(validateAssemblyImageFile({ name: 'large.png', type: 'image/png', size: MAX_ASSEMBLY_IMAGE_FILE_BYTES + 1 } as File)).toBe('图片不能超过 15 MB');
    expect(validateAssemblyModelFile({ name: 'model.exe', type: '', size: 1 } as File)).toContain('仅支持');
  });

  it('allows only the newest generation request to commit', () => {
    expect(isLatestAssemblyGeneration(4, 4)).toBe(true);
    expect(isLatestAssemblyGeneration(3, 4)).toBe(false);
  });
});
