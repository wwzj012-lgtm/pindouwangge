import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8');
const app = read('../App.tsx');
const header = read('./Header.tsx');
const home = read('./HomeView.tsx');

describe('conversion tool entry points', () => {
  it('keeps a visible desktop smart reducer entry wired to the existing modal state', () => {
    expect(header).toContain('hidden md:flex');
    expect(header).toContain('onClick={onOpenSmartReduceModal}');
    expect(header).toContain('智能省豆');
    expect(app).toContain('onOpenSmartReduceModal={() => setIsSmartReduceModalOpen(true)}');
    expect(app).toContain('isOpen={isSmartReduceModalOpen}');
  });

  it('renders real image inputs in Header and Home and routes both through one uploader', () => {
    for (const source of [header, home]) {
      expect(source).toContain('type="file"');
      expect(source).toContain('accept="image/*"');
      expect(source).toContain('consumeSelectedImageFile');
    }
    expect(app).toContain('onImageUpload={handleImageUpload}');
    expect(app).toContain('onStartPhotoToBead={handleImageUpload}');
  });

  it('opens Image Studio only after the selected image loads successfully', () => {
    const imageLoad = app.slice(app.indexOf('img.onload = () =>', app.indexOf('const handleImageUpload')));
    expect(imageLoad).toContain('setSourceImage(img)');
    expect(imageLoad).toContain("setCurrentTab('studio')");
    expect(imageLoad).toContain('setIsStudioModalOpen(true)');
    expect(app).toContain('{sourceImage && (');
    expect(app).toContain('<ImageStudioModal');
  });
});
