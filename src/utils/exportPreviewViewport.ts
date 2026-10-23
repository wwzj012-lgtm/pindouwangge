export type ExportPreviewZoom = 'fit' | number;

/** Display-only dimensions. Never resize the canvas backing store or the PNG. */
export function exportPreviewViewport(
  image: { width: number; height: number },
  viewport: { width: number; height: number },
  zoom: ExportPreviewZoom = 'fit',
) {
  if (![image.width, image.height, viewport.width, viewport.height].every(value => Number.isFinite(value) && value > 0)) {
    return { scale: 0, fit: 0, width: 0, height: 0, surfaceWidth: 0, surfaceHeight: 0 };
  }
  const fit = Math.min(1, Math.max(1, viewport.width - 40) / image.width, Math.max(1, viewport.height - 40) / image.height);
  const fitted = zoom === 'fit' || !Number.isFinite(zoom);
  const scale = fitted ? fit : Math.max(Math.min(.05, fit / 4), Math.min(8, zoom as number));
  return { scale, fit, width: image.width * scale, height: image.height * scale,
    // In manual zoom the surface is sized only by the image, not the scrollport.
    // CSS auto margins center smaller images without a scrollbar/measurement loop.
    // Preserve CSS subpixels at 125%/150% zoom; rounding upward can create
    // a scrollbar even though the image and padding fit inside the viewport.
    surfaceWidth: fitted ? viewport.width : image.width * scale + 40,
    surfaceHeight: fitted ? viewport.height : image.height * scale + 40 };
}
