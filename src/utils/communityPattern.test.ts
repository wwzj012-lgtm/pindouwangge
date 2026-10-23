import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ apiGetBlob: vi.fn(), readCommunitySnapshot: vi.fn(), getPatternProject: vi.fn() }));
vi.mock('./api', () => ({ apiGetBlob: mocks.apiGetBlob }));
vi.mock('./communityPatternSnapshot', () => ({ readCommunitySnapshot: mocks.readCommunitySnapshot }));
vi.mock('./patternHistory', () => ({ getPatternProject: mocks.getPatternProject }));
import { loadCommunityPattern } from './communityPattern';
import type { CommunityPost } from './communityApi';
const post = { id: 'post-1', assetId: 'asset-1', author: { uid: 'owner' }, workId: 'work-1' } as CommunityPost;
beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  mocks.apiGetBlob.mockResolvedValue({ ok: true, data: new Blob(['image']) });
  mocks.readCommunitySnapshot.mockResolvedValue(null);
});
describe('community grid source selection', () => {
  it('uses the immutable snapshot even when the owner later edits the private original', async () => {
    const snapshot = { name: 'published original' };
    mocks.readCommunitySnapshot.mockResolvedValue(snapshot);
    expect(await loadCommunityPattern(post, 'owner')).toEqual({ project: snapshot, fromOwnerLibrary: false });
    expect(mocks.getPatternProject).not.toHaveBeenCalled();
  });
  it('recovers legacy originals only from the authenticated owner library', async () => {
    mocks.getPatternProject.mockResolvedValue({ name: 'original' });
    expect(await loadCommunityPattern(post, 'owner')).toEqual({ project: { name: 'original' }, fromOwnerLibrary: true });
    expect(mocks.getPatternProject).toHaveBeenCalledWith('work-1', 'owner');
  });
  it.each([undefined, 'visitor'])('never attempts private project retrieval for %s', async (uid) => {
    expect(await loadCommunityPattern(post, uid)).toEqual({ project: null, fromOwnerLibrary: false });
    expect(mocks.getPatternProject).not.toHaveBeenCalled();
  });
  it('does not disguise corruption as a legacy photo or private-project fallback', async () => {
    mocks.readCommunitySnapshot.mockRejectedValue(new Error('corrupt'));
    await expect(loadCommunityPattern(post, 'owner')).rejects.toThrow('corrupt');
    expect(mocks.getPatternProject).not.toHaveBeenCalled();
  });
  it('propagates network failures without converting thumbnails', async () => {
    mocks.apiGetBlob.mockResolvedValue({ ok: false, error: 'offline' });
    await expect(loadCommunityPattern(post)).rejects.toThrow('offline');
    expect(mocks.readCommunitySnapshot).not.toHaveBeenCalled();
  });
});
