import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadCanvasImage } from './exportUtils';

describe('downloadCanvasImage', () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalUrl = globalThis.URL;

  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(globalThis, 'window', { configurable: true, value: globalThis });
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(globalThis, 'document', { configurable: true, value: originalDocument });
    Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
    Object.defineProperty(globalThis, 'URL', { configurable: true, value: originalUrl });
  });

  it('starts a standard Blob URL download and revokes the URL', async () => {
    const anchor = {
      href: '',
      download: '',
      rel: '',
      style: { display: '' },
      click: vi.fn(),
      remove: vi.fn(),
    };
    const appendChild = vi.fn();
    const createObjectURL = vi.fn(() => 'blob:pattern-download');
    const revokeObjectURL = vi.fn();

    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: {
        createElement: vi.fn(() => anchor),
        body: { appendChild },
      },
    });
    Object.defineProperty(globalThis, 'URL', {
      configurable: true,
      value: { createObjectURL, revokeObjectURL },
    });

    const canvas = {
      width: 16,
      height: 16,
      toBlob: (callback: BlobCallback) => callback(new Blob(['png'], { type: 'image/png' })),
    } as unknown as HTMLCanvasElement;

    await expect(downloadCanvasImage(canvas, 'my-pattern')).resolves.toBe('downloaded');
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(anchor.download).toBe('my-pattern.png');
    expect(appendChild).toHaveBeenCalledWith(anchor);
    expect(anchor.click).toHaveBeenCalledTimes(1);
    expect(anchor.remove).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:pattern-download');
  });

  it('rejects with a readable error when canvas PNG encoding times out', async () => {
    const canvas = {
      width: 16,
      height: 16,
      toBlob: () => undefined,
    } as unknown as HTMLCanvasElement;

    const download = downloadCanvasImage(canvas, 'timeout-pattern', undefined, 20);
    const rejection = expect(download).rejects.toThrow('PNG 生成超时');
    await vi.advanceTimersByTimeAsync(20);
    await rejection;
  });
});
