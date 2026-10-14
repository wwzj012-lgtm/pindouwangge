import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCommunityPublishErrorCode, publishCommunityPost } from './communityApi';

describe('community publish HTTP error contract (real API normalization and parser)', () => {
  const fetchMock = vi.fn();
  const input = { title: 'Work', description: '', visibility: 'public' as const, tags: [], workId: 'work_contract' };

  beforeEach(() => {
    vi.stubEnv('VITE_WORKER_API_URL', 'https://worker.test');
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('localStorage', undefined);
    vi.stubGlobal('sessionStorage', undefined);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it.each([
    ['Worker message-only response', 409, { message: 'WORK_ASSET_REQUIRED' }, 'WORK_ASSET_REQUIRED'],
    ['errorCode before code and message', 409, { errorCode: 'OWNERSHIP_DENIED', code: 'WORK_ASSET_REQUIRED', message: 'WORK_ASSET_REQUIRED' }, 'OWNERSHIP_DENIED'],
    ['code before message', 409, { code: 'DUPLICATE_POST', message: 'WORK_ASSET_REQUIRED' }, 'DUPLICATE_POST'],
    ['structured errorCode', 409, { errorCode: 'WORK_ASSET_REQUIRED', message: 'Asset needed' }, 'WORK_ASSET_REQUIRED'],
    ['structured code', 409, { code: 'WORK_ASSET_REQUIRED', message: 'Asset needed' }, 'WORK_ASSET_REQUIRED'],
    ['untrusted non-string codes', 409, { code: 1, errorCode: {}, message: 'WORK_ASSET_REQUIRED' }, 'WORK_ASSET_REQUIRED'],
    ['completion required', 402, { message: 'WORK_ASSET_REQUIRED' }, null],
    ['ownership denied', 403, { message: 'WORK_ASSET_REQUIRED' }, null],
    ['legacy import expired', 410, { message: 'WORK_ASSET_REQUIRED' }, null],
    ['server error', 500, { message: 'WORK_ASSET_REQUIRED' }, null],
    ['different conflict', 409, { message: 'This work already has an active community post' }, null],
    ['message prefix', 409, { message: 'Error: WORK_ASSET_REQUIRED' }, null],
    ['message suffix', 409, { message: 'WORK_ASSET_REQUIRED ' }, null],
    ['arbitrary message', 409, { message: 'Please upload a picture' }, null],
  ])('classifies %s without interpreting arbitrary messages as codes', async (_label, status, fields, expected) => {
    // This is the actual Worker error envelope, not a mocked parser result.
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ success: false, ...fields }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }));

    const result = await publishCommunityPost(input);

    expect(result).toMatchObject({ ok: false, status, error: fields.message });
    expect(getCommunityPublishErrorCode(result)).toBe(expected);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never treats a successful response as an error', () => {
    expect(getCommunityPublishErrorCode({ ok: true, status: 201, error: 'WORK_ASSET_REQUIRED' })).toBeNull();
  });
});
