export interface ImagePreviewView {
  scale: number;
  pan: { x: number; y: number };
}

export const IMAGE_PREVIEW_CONTROLS = {
  upload: { title: '上传原图', ariaLabel: '上传原图' },
  zoomOut: { title: '缩小原图', ariaLabel: '缩小原图' },
  zoomIn: { title: '放大原图', ariaLabel: '放大原图' },
  reset: { title: '重置预览视图', ariaLabel: '重置预览视图' },
  close: { title: '关闭原图预览', ariaLabel: '关闭原图预览' },
} as const;

// Allows header controls to wrap on narrow viewports without clipping command text.
export const IMAGE_PREVIEW_TOOLBAR_CLASS =
  'flex min-w-0 flex-wrap items-center gap-1 sm:justify-end';

export const createInitialImagePreviewView = (): ImagePreviewView => ({
  scale: 1,
  pan: { x: 0, y: 0 },
});

export const resetImagePreviewView = (): ImagePreviewView =>
  createInitialImagePreviewView();

export const changeImagePreviewScale = (
  view: ImagePreviewView,
  delta: number,
): ImagePreviewView => ({
  ...view,
  scale: Math.min(3, Math.max(0.4, view.scale + delta)),
});

/** Delegates image replacement to the existing owner without parsing the file here. */
export const forwardReferenceImageUpload = (
  file: File | undefined,
  onUpload: ((file: File) => void) | undefined,
): void => {
  if (file && onUpload) onUpload(file);
};
