import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8');
const app = read('../App.tsx');
const header = read('./Header.tsx');
const mobileWorkspace = read('./mobile/MobileWorkspace.tsx');

describe('conversion tool entry points', () => {
  it('keeps a visible desktop smart reducer entry wired to the existing modal state', () => {
    expect(header).toContain('hidden md:flex');
    expect(header).toContain('onClick={onOpenSmartReduceModal}');
    expect(header).toContain('智能省豆');
    expect(app).toContain('onOpenSmartReduceModal={() => setIsSmartReduceModalOpen(true)}');
    expect(app).toContain('isOpen={isSmartReduceModalOpen}');
  });

  it('renders a real image input in Header and routes it through one uploader', () => {
    // Home 的照片入口已下线（智能转拼豆卡片与 Hero 按钮移除），图片选择统一走 Header 与工作台。
    expect(header).toContain('type="file"');
    expect(header).toContain('accept="image/*"');
    expect(header).toContain('consumeSelectedImageFile');
    expect(app).toContain('onImageUpload={handleImageUpload}');
  });

  it('lets the 转图 tab upload straight from its pinned action instead of bouncing to Home', () => {
    // 无图时那颗常驻按钮必须自己唤起选择器（旧实现只是跳首页，点了没反应）
    expect(mobileWorkspace).toContain('accept="image/*"');
    expect(mobileWorkspace).toContain('consumeSelectedImageFile');
    expect(mobileWorkspace).toContain('imageFileInputRef.current?.click()');
    // 上传后同一个按钮变成生成动作
    expect(mobileWorkspace).toContain("sourceImage ? (");
    expect(mobileWorkspace).toContain('生成图纸');
    expect(app).toContain('onImageUpload={handleImageUpload}');
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
