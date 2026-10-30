import { describe, expect, it } from 'vitest';
import { createUploadHarness } from './App.upload.fixture';

function workState(state: Record<string, any>) {
  const { isConverting, imageLoadMessage, ...work } = state;
  return structuredClone(work);
}

describe('App upload commits only a validated, current image', () => {
  it('preserves all old work when a sub-30MB 8000x6000 image is rejected', () => {
    const h = createUploadHarness();
    const before = workState(h.state);
    h.upload(4 * 1024 * 1024);
    expect(h.state.isConverting).toBe(true);
    h.read();
    h.decode(8000, 6000);
    expect(h.state.isConverting).toBe(false);
    expect(h.state.imageLoadMessage).toContain('4000 万像素');
    expect(workState(h.state)).toEqual(before);
    expect(h.revision.current).toBe(17);
    expect(h.conversions).toHaveLength(0);
  });

  it('keeps the byte ceiling and rejects without reading or resetting', () => {
    const h = createUploadHarness();
    const before = workState(h.state);
    h.upload(30 * 1024 * 1024 + 1);
    expect(workState(h.state)).toEqual(before);
    expect(h.readers).toHaveLength(0);
    expect(h.state.isConverting).toBe(false);
    expect(h.state.imageLoadMessage).toContain('30 MB');
  });

  it.each(['read-error', 'decode-error', 'empty-result', 'abort', 'sync-read-error'])(
    'preserves identity, payment, mirror, crop provenance and practice on %s', failure => {
      const h = createUploadHarness();
      const before = workState(h.state);
      if (failure === 'sync-read-error') h.throwOnRead();
      h.upload();
      if (failure === 'read-error') h.readers[0].onerror();
      if (failure === 'abort') h.readers[0].onabort();
      if (failure === 'empty-result') h.read(0, null);
      if (failure === 'decode-error') { h.read(); h.images[0].onerror(); }
      expect(workState(h.state)).toEqual(before);
      expect(h.revision.current).toBe(17);
      expect(h.state.isConverting).toBe(false);
      expect(h.state.imageLoadMessage).toMatch(/图片.*(失败|取消|无法)/);
      expect(h.state.imageLoadMessage).not.toContain('PRIVATE_READ_FAILURE');
      expect(h.conversions).toHaveLength(0);
    },
  );

  it('starts the existing new-draft flow only after successful small-image validation', () => {
    const h = createUploadHarness();
    h.upload(); h.read(); h.decode();
    expect(h.state).toMatchObject({
      activePatternId: null, draftSourceKey: 'new-draft', currentSavingTarget: 15,
      completionStatus: 'DRAFT', completionQuote: null, completionPreviewQuote: null,
      serverPaidCoverage: null, paidNonEmptyBeads: null, isImageDerivedPattern: false,
      customSymmetryAxes: null, isPracticeMode: false, practiceColorId: null,
      subjectCropSource: null, projectName: 'new', currentTab: 'studio', isStudioModalOpen: true,
      settings: { backgroundRemovalEnabled: false, chromaKeyColor: null }, imageLoadMessage: null,
    });
    expect(h.revision.current).toBe(18);
    expect(h.state.sourceImage).toBe(h.images[0]);
    expect(h.conversions).toHaveLength(1);
    expect(h.conversions[0]).toEqual([h.images[0], h.state.settings, h.state.activePalette, 1]);
    // Conversion, not mere upload/decode, continues to own the billable marker.
    expect(h.state.isImageDerivedPattern).toBe(false);
    expect(h.state.isConverting).toBe(true);
    h.finish(1);
    expect(h.state.isConverting).toBe(false);
  });

  it('ignores stale reads, decodes and failures while a newer upload is busy', () => {
    const h = createUploadHarness();
    h.upload(); h.read();
    h.upload(1024, 'latest.png');
    const pending = structuredClone(h.state);
    h.decode(8000, 6000, 0);
    h.images[0].onerror();
    h.readers[0].onerror();
    h.read(0);
    expect(h.state).toEqual(pending);
    expect(h.images).toHaveLength(1);
    h.read(1); h.decode();
    const accepted = { ...h.state };
    h.decode(64, 48, 0);
    h.readers[0].onerror();
    expect(h.state).toEqual(accepted);
    expect(h.state.projectName).toBe('latest');
    expect(h.state.sourceImage).toBe(h.images[1]);
    expect(h.conversions).toHaveLength(1);
    h.finish(1);
    expect(h.state.isConverting).toBe(true);
    h.finish(2);
    expect(h.state.isConverting).toBe(false);
  });

  it('cannot commit an upload invalidated by another source/edit', () => {
    const h = createUploadHarness();
    h.upload(); h.read(); h.invalidate();
    h.state.sourceImage = { src: 'newer-restored-source' };
    h.state.isConverting = false;
    const before = structuredClone(h.state);
    h.decode(); h.images[0].onerror();
    expect(h.state).toEqual(before);
    expect(h.conversions).toHaveLength(0);
  });
});
