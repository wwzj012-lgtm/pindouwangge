import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoredPatternProject } from '../utils/patternGridCodec';

const hookRuntime = vi.hoisted(() => ({
  cursor: 0,
  slots: [] as unknown[],
  effects: [] as unknown[][],
}));

const authState = vi.hoisted(() => ({ currentUser: { uid: 'user-1' } as { uid: string } | null }));
const languageState = vi.hoisted(() => ({ language: 'en' }));
const patternHistory = vi.hoisted(() => ({
  deleteCloudExportedPatternAndLocal: vi.fn(),
  deleteLocalExportedPatternCopy: vi.fn(),
  getExportedPatternPreview: vi.fn(),
  getPatternProject: vi.fn(),
  getUserExportedPatterns: vi.fn(),
  markExportedPatternPublished: vi.fn(),
  normalizePatternTitle: vi.fn((value: string) => value.trim()),
  patternDeletionActions: vi.fn(() => []),
  requiresExplicitCloudBinding: vi.fn(() => false),
  retryPatternCloudSync: vi.fn(),
  renameExportedPattern: vi.fn(),
}));
const communityApi = vi.hoisted(() => ({
  publishCommunityPost: vi.fn(),
  uploadCommunityAsset: vi.fn(),
}));
const creditApi = vi.hoisted(() => ({
  apiQuoteCredits: vi.fn(),
}));
const renderPreview = vi.hoisted(() => vi.fn());
const renderCommunityPattern = vi.hoisted(() => vi.fn());

vi.mock('react', () => {
  const reactMock = {
  default: {},
  useEffect: (effect: () => void | (() => void), dependencies: readonly unknown[]) => {
    const slot = hookRuntime.cursor++;
    const previous = hookRuntime.effects[slot];
    const changed = !previous
      || previous.length !== dependencies.length
      || previous.some((value, index) => value !== dependencies[index]);
    hookRuntime.effects[slot] = [...dependencies];
    if (changed) effect();
  },
  useRef: <T,>(initialValue: T) => {
    const slot = hookRuntime.cursor++;
    if (!(slot in hookRuntime.slots)) hookRuntime.slots[slot] = { current: initialValue };
    return hookRuntime.slots[slot] as { current: T };
  },
  useState: <T,>(initialValue: T | (() => T)) => {
    const slot = hookRuntime.cursor++;
    if (!(slot in hookRuntime.slots)) {
      hookRuntime.slots[slot] = typeof initialValue === 'function'
        ? (initialValue as () => T)()
        : initialValue;
    }
    const setValue = (value: T | ((current: T) => T)) => {
      const current = hookRuntime.slots[slot] as T;
      hookRuntime.slots[slot] = typeof value === 'function'
        ? (value as (current: T) => T)(current)
        : value;
    };
    return [hookRuntime.slots[slot] as T, setValue] as const;
  },
  };
  return { ...reactMock, useLayoutEffect: reactMock.useEffect };
});

vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ currentUser: authState.currentUser }) }));
vi.mock('../context/LanguageContext', () => ({ useLanguage: () => languageState }));
vi.mock('../utils/patternHistory', () => patternHistory);
vi.mock('../utils/patternPreview', () => ({ renderPatternPreview: renderPreview }));
vi.mock('../utils/communityPatternSnapshot', () => ({ renderCommunityPattern }));
vi.mock('../utils/communityApi', async (importOriginal) => ({
  ...await importOriginal<typeof import('../utils/communityApi')>(),
  ...communityApi,
}));
vi.mock('../utils/dateUtils', () => ({ formatChinaDate: () => '2026-08-22' }));
vi.mock('../utils/api', () => creditApi);

import { UserPatternsModal } from './UserPatternsModal';

type TreeNode = {
  type?: unknown;
  props?: Record<string, unknown> & { children?: unknown };
};

const initialRecord = (overrides: Record<string, unknown> = {}) => ({
  id: 'pattern-local-id',
  title: 'Original work',
  width: 16,
  height: 16,
  totalBeads: 256,
  updatedAt: '2026-08-22T00:00:00.000Z',
  syncState: 'local',
  status: 0,
  hasCloudCopy: false,
  hasLocalCopy: true,
  userId: null,
  cloudRevision: null,
  previewBlob: null,
  ...overrides,
});

const fullProject = (): StoredPatternProject => ({
  version: 2, name: 'Full-resolution project', width: 2, height: 1, boardSize: 29, brand: 'CUSTOM',
  grid: [['red', null]],
  palette: [{ id: 'red', code: 'R1', name: 'Red', hex: '#ff0000', rgb: [255, 0, 0], brand: 'CUSTOM' }],
  createdAt: 1,
  settings: {
    width: 2, height: 1, boardSize: 29, brand: 'CUSTOM', keepAspectRatio: true,
    dither: 'none', colorLimit: 1, brightness: 0, contrast: 0, saturation: 0,
    transparentCutoff: 0, colorMatchAlgo: 'rgb', sharpening: 0, outlineBoost: false,
    chromaKeyColor: null, chromaKeyTolerance: 0,
  },
});

const flush = async (): Promise<void> => {
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
};

const textContent = (node: unknown): string => {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textContent).join('');
  if (node && typeof node === 'object' && 'props' in node) {
    return textContent((node as TreeNode).props?.children);
  }
  return '';
};

const findNode = (node: unknown, predicate: (candidate: TreeNode) => boolean): TreeNode => {
  if (Array.isArray(node)) {
    for (const child of node) {
      try {
        return findNode(child, predicate);
      } catch {
        // Continue walking nested child arrays.
      }
    }
  }
  if (node && typeof node === 'object' && 'props' in node) {
    const candidate = node as TreeNode;
    if (predicate(candidate)) return candidate;
    const children = candidate.props?.children;
    const items = Array.isArray(children) ? children : [children];
    for (const child of items) {
      try {
        return findNode(child, predicate);
      } catch {
        // Continue walking siblings when this subtree has no match.
      }
    }
  }
  throw new Error('Expected node was not found.');
};

const buttonByText = (tree: unknown, label: string): TreeNode => findNode(
  tree,
  (node) => node.type === 'button' && textContent(node).trim() === label,
);

const inputByDescription = (tree: unknown, descriptionId: string): TreeNode => findNode(
  tree,
  (node) => node.type === 'input' && node.props?.['aria-describedby'] === descriptionId,
);

const click = (node: TreeNode): void => (node.props?.onClick as () => void)();
const change = (node: TreeNode, value: string): void => (node.props?.onChange as (event: { target: { value: string } }) => void)({ target: { value } });

describe('UserPatternsModal community publishing', () => {
  const onOpenAuthModal = vi.fn();
  const modalProps = {
    isOpen: true,
    onClose: vi.fn(),
    onContinueEditing: vi.fn(),
    onOpenCommunity: vi.fn(),
    onOpenAuthModal,
  };

  const render = (): unknown => {
    hookRuntime.cursor = 0;
    return UserPatternsModal(modalProps);
  };

  const loadRecord = async (record: Record<string, unknown>, currentUser = { uid: 'user-1' }): Promise<unknown> => {
    authState.currentUser = currentUser;
    patternHistory.getUserExportedPatterns.mockResolvedValue([record]);
    const tree = render();
    await flush();
    return render() ?? tree;
  };

  const openPublishDialog = async (record: Record<string, unknown>, currentUser = { uid: 'user-1' }): Promise<unknown> => {
    let tree = await loadRecord(record, currentUser);
    click(buttonByText(tree, languageState.language === 'en' ? 'Publish' : '发布到社区'));
    tree = render();
    return tree;
  };

  const confirmPublish = async (tree: unknown): Promise<unknown> => {
    click(buttonByText(tree, languageState.language === 'en' ? 'Confirm publish' : '确认发布'));
    await flush();
    return render();
  };

  beforeEach(() => {
    hookRuntime.cursor = 0;
    hookRuntime.slots = [];
    hookRuntime.effects = [];
    authState.currentUser = { uid: 'user-1' };
    languageState.language = 'en';
    onOpenAuthModal.mockReset();
    modalProps.onClose.mockReset();
    modalProps.onContinueEditing.mockReset();
    modalProps.onOpenCommunity.mockReset();
    Object.values(patternHistory).forEach((mock) => {
      if (typeof mock === 'function' && 'mockReset' in mock) mock.mockReset();
    });
    Object.values(communityApi).forEach((mock) => mock.mockReset());
    renderPreview.mockReset();
    renderCommunityPattern.mockReset();
    creditApi.apiQuoteCredits.mockReset();
    patternHistory.normalizePatternTitle.mockImplementation((value: string) => value.trim());
    patternHistory.patternDeletionActions.mockReturnValue([]);
    patternHistory.requiresExplicitCloudBinding.mockReturnValue(false);
    communityApi.publishCommunityPost.mockResolvedValue({ ok: true });
    communityApi.uploadCommunityAsset.mockResolvedValue({ ok: true, data: { asset: { id: 'asset-default' } } });
    creditApi.apiQuoteCredits.mockResolvedValue({ ok: true, status: 200, data: { totalUnits: 3, points: 0.3 } });
    renderPreview.mockResolvedValue(new Blob(['preview'], { type: 'image/png' }));
    renderCommunityPattern.mockResolvedValue(new Blob(['lossless PNG with project snapshot'], { type: 'image/png' }));
    patternHistory.getPatternProject.mockResolvedValue(fullProject());
  });

  it('includes local, cloud, legacy and published projects in My Library, excluding deleted and other-account projects', async () => {
    patternHistory.getUserExportedPatterns.mockResolvedValue([
      initialRecord({ id: 'local', title: 'Local project' }),
      initialRecord({ id: 'cloud', title: 'Cloud project', userId: 'user-1', hasLocalCopy: false, hasCloudCopy: true }),
      initialRecord({ id: 'published', title: 'Published project', userId: 'user-1', status: 1, hasCloudCopy: true }),
      initialRecord({ id: 'published-cloud', title: 'Published cloud project', userId: 'user-1', status: 1, hasLocalCopy: false, hasCloudCopy: true }),
      initialRecord({ id: 'legacy', title: 'Legacy project', status: undefined }),
      initialRecord({ id: 'deleted', title: 'Deleted project', status: 2 }),
      initialRecord({ id: 'other-private', title: 'Other private project', userId: 'user-2' }),
      initialRecord({ id: 'other-published', title: 'Other published project', userId: 'user-2', status: 1 }),
    ]);
    render();
    await flush();
    let tree = render();

    expect(buttonByText(tree, 'My Library (5)').props?.className).toContain('bg-sky-600');
    for (const title of ['Local project', 'Cloud project', 'Published project', 'Published cloud project', 'Legacy project']) {
      expect(textContent(tree)).toContain(title);
    }
    for (const title of ['Deleted project', 'Other private project', 'Other published project']) {
      expect(textContent(tree)).not.toContain(title);
    }

    click(buttonByText(tree, 'Published works (2)'));
    tree = render();
    expect(textContent(tree)).toContain('Published project');
    expect(textContent(tree)).toContain('Published cloud project');
    for (const title of ['Local project', 'Cloud project', 'Legacy project', 'Other published project']) {
      expect(textContent(tree)).not.toContain(title);
    }
  });

  it('keeps a newly published project in the selected library and preserves the community entry', async () => {
    let tree = await confirmPublish(await openPublishDialog(initialRecord({
      id: 'cloud-retained', userId: 'user-1', hasCloudCopy: true,
    })));

    expect(communityApi.publishCommunityPost).toHaveBeenCalledTimes(1);
    expect(patternHistory.markExportedPatternPublished).toHaveBeenCalledWith('cloud-retained', 'user-1');
    expect(buttonByText(tree, 'My Library (1)').props?.className).toContain('bg-sky-600');
    expect(textContent(tree)).toContain('Original work');
    expect(textContent(tree)).not.toContain('Private gallery');
    expect(() => buttonByText(tree, 'Publish')).toThrow();
    click(buttonByText(tree, 'Open community'));
    expect(modalProps.onOpenCommunity).toHaveBeenCalledTimes(1);

    click(buttonByText(tree, 'Published works (1)'));
    tree = render();
    expect(textContent(tree)).toContain('Original work');
    click(buttonByText(tree, 'My Library (1)'));
    tree = render();
    expect(textContent(tree)).toContain('Original work');
    expect(patternHistory.deleteCloudExportedPatternAndLocal).not.toHaveBeenCalled();
    expect(patternHistory.deleteLocalExportedPatternCopy).not.toHaveBeenCalled();
  });

  it('opens sign-in instead of publishing when a signed-out user clicks Publish', async () => {
    const tree = await loadRecord(initialRecord(), null);

    click(buttonByText(tree, 'Publish'));

    expect(onOpenAuthModal).toHaveBeenCalledTimes(1);
    expect(communityApi.publishCommunityPost).not.toHaveBeenCalled();
    expect(communityApi.uploadCommunityAsset).not.toHaveBeenCalled();
  });

  it('loads the full project and uploads a fresh snapshot instead of stale local or cached previews', async () => {
    const record = initialRecord({
      id: 'cloud-id',
      userId: 'user-1',
      hasCloudCopy: true,
      previewBlob: new Blob(['stale lossy thumbnail'], { type: 'image/webp' }),
      cloudRevision: 7,
      hasPreview: true,
    });
    const project = fullProject();
    patternHistory.getPatternProject.mockResolvedValue(project);
    patternHistory.getExportedPatternPreview.mockResolvedValue(new Blob(['stale cached thumbnail']));

    const tree = await openPublishDialog(record);
    await confirmPublish(tree);

    expect(patternHistory.getPatternProject).toHaveBeenCalledExactlyOnceWith('cloud-id', 'user-1');
    expect(renderCommunityPattern).toHaveBeenCalledExactlyOnceWith(project);
    expect(patternHistory.getExportedPatternPreview).not.toHaveBeenCalled();
    expect(renderPreview).not.toHaveBeenCalled();
    expect(communityApi.uploadCommunityAsset).toHaveBeenCalledTimes(1);
    const file = communityApi.uploadCommunityAsset.mock.calls[0]?.[0] as File;
    expect(file.name).toBe('Original work.png');
    expect(file.type).toBe('image/png');
    expect(await file.text()).toBe('lossless PNG with project snapshot');
    expect(communityApi.publishCommunityPost).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ workId: 'cloud-id', assetId: 'asset-default' }));
    expect(patternHistory.getPatternProject.mock.invocationCallOrder[0]).toBeLessThan(renderCommunityPattern.mock.invocationCallOrder[0]);
    expect(renderCommunityPattern.mock.invocationCallOrder[0]).toBeLessThan(communityApi.uploadCommunityAsset.mock.invocationCallOrder[0]);
    expect(communityApi.uploadCommunityAsset.mock.invocationCallOrder[0]).toBeLessThan(communityApi.publishCommunityPost.mock.invocationCallOrder[0]);
    expect(patternHistory.markExportedPatternPublished).toHaveBeenCalledWith('cloud-id', 'user-1');
  });

  it.each([
    ['409 duplicate response', 409, 'This work already has an active community post'],
    ['402 completion required', 402, 'WORK_ASSET_REQUIRED'],
    ['403 ownership rejected', 403, 'WORK_ASSET_REQUIRED'],
    ['410 legacy import expired', 410, 'WORK_ASSET_REQUIRED'],
    ['500 server response', 500, 'WORK_ASSET_REQUIRED'],
  ])('does not retry or mark a cloud work after a %s', async (_label, status, error) => {
    const record = initialRecord({ id: 'cloud-id', userId: 'user-1', hasCloudCopy: true });
    communityApi.publishCommunityPost.mockResolvedValue({ ok: false, status, error });

    const tree = await openPublishDialog(record);
    await confirmPublish(tree);

    expect(communityApi.uploadCommunityAsset).toHaveBeenCalledTimes(1);
    expect(patternHistory.markExportedPatternPublished).not.toHaveBeenCalled();
    expect(communityApi.publishCommunityPost).toHaveBeenCalledTimes(1);
  });

  it('does not publish or mark when snapshot upload fails', async () => {
    communityApi.uploadCommunityAsset.mockResolvedValue({ ok: false, status: 413, error: 'Preview is too large' });

    const tree = await confirmPublish(await openPublishDialog(initialRecord({
      id: 'cloud-id', userId: 'user-1', hasCloudCopy: true,
      previewBlob: new Blob(['preview'], { type: 'image/png' }),
    })));

    expect(communityApi.uploadCommunityAsset).toHaveBeenCalledTimes(1);
    expect(communityApi.publishCommunityPost).not.toHaveBeenCalled();
    expect(patternHistory.markExportedPatternPublished).not.toHaveBeenCalled();
    expect(textContent(tree)).toContain('Preview is too large');
  });

  it('does not retry an asset-required conflict after already sending a fresh asset', async () => {
    communityApi.publishCommunityPost.mockResolvedValue({ ok: false, status: 409, error: 'WORK_ASSET_REQUIRED' });

    await confirmPublish(await openPublishDialog(initialRecord({
      id: 'cloud-id', userId: 'user-1', hasCloudCopy: true,
      previewBlob: new Blob(['preview'], { type: 'image/png' }),
    })));

    expect(communityApi.uploadCommunityAsset).toHaveBeenCalledTimes(1);
    expect(communityApi.publishCommunityPost).toHaveBeenCalledTimes(1);
    expect(communityApi.publishCommunityPost).toHaveBeenCalledWith(expect.objectContaining({ assetId: 'asset-default' }));
    expect(patternHistory.markExportedPatternPublished).not.toHaveBeenCalled();
  });

  it('syncs a local work first, then reads and snapshots the returned cloud project before publishing and marking', async () => {
    const record = initialRecord({ id: 'local-before-sync' });
    const syncedRecord = initialRecord({
      id: 'cloud-after-sync',
      userId: 'user-1',
      hasCloudCopy: true,
      hasLocalCopy: true,
      syncState: 'synced',
    });
    patternHistory.retryPatternCloudSync.mockResolvedValue(syncedRecord);
    const project = fullProject();
    patternHistory.getPatternProject.mockResolvedValue(project);

    const tree = await openPublishDialog(record);
    await confirmPublish(tree);

    expect(patternHistory.retryPatternCloudSync).toHaveBeenCalledWith('local-before-sync', 'user-1');
    expect(patternHistory.getPatternProject).toHaveBeenCalledExactlyOnceWith('cloud-after-sync', 'user-1');
    expect(renderCommunityPattern).toHaveBeenCalledExactlyOnceWith(project);
    expect(communityApi.publishCommunityPost).toHaveBeenCalledWith(expect.objectContaining({ workId: 'cloud-after-sync', assetId: 'asset-default' }));
    expect(patternHistory.markExportedPatternPublished).toHaveBeenCalledWith('cloud-after-sync', 'user-1');
  });

  it('does not upload or publish when local cloud sync fails', async () => {
    patternHistory.retryPatternCloudSync.mockRejectedValue(new Error('sync failed'));

    const tree = await openPublishDialog(initialRecord());
    await confirmPublish(tree);

    expect(communityApi.uploadCommunityAsset).not.toHaveBeenCalled();
    expect(communityApi.publishCommunityPost).not.toHaveBeenCalled();
    expect(patternHistory.markExportedPatternPublished).not.toHaveBeenCalled();
  });

  it.each([false, true])('does not publish when the complete project cannot be read (local sync: %s)', async (local) => {
    const syncedRecord = initialRecord({ id: 'cloud-read-failed', userId: 'user-1', hasCloudCopy: true });
    patternHistory.retryPatternCloudSync.mockResolvedValue(syncedRecord);
    patternHistory.getPatternProject.mockRejectedValue(new Error('Full project unavailable'));

    const tree = await confirmPublish(await openPublishDialog(local ? initialRecord() : syncedRecord));

    expect(patternHistory.getPatternProject).toHaveBeenCalledExactlyOnceWith('cloud-read-failed', 'user-1');
    expect(renderCommunityPattern).not.toHaveBeenCalled();
    expect(communityApi.uploadCommunityAsset).not.toHaveBeenCalled();
    expect(communityApi.publishCommunityPost).not.toHaveBeenCalled();
    expect(patternHistory.markExportedPatternPublished).not.toHaveBeenCalled();
    expect(textContent(tree)).toContain('Full project unavailable');
    expect(buttonByText(tree, 'Confirm publish').props?.disabled).toBe(false);
  });

  it('reports snapshot rendering failure and rereads the project on a subsequent attempt', async () => {
    renderCommunityPattern.mockRejectedValueOnce(new Error('Snapshot rendering failed'));
    let tree = await confirmPublish(await openPublishDialog(initialRecord({ id: 'cloud-render', userId: 'user-1', hasCloudCopy: true })));

    expect(textContent(tree)).toContain('Snapshot rendering failed');
    expect(communityApi.uploadCommunityAsset).not.toHaveBeenCalled();
    expect(communityApi.publishCommunityPost).not.toHaveBeenCalled();
    expect(patternHistory.markExportedPatternPublished).not.toHaveBeenCalled();

    const editedProject = fullProject();
    editedProject.grid = [[null, 'red']];
    patternHistory.getPatternProject.mockResolvedValue(editedProject);
    tree = await confirmPublish(tree);

    expect(patternHistory.getPatternProject).toHaveBeenCalledTimes(2);
    expect(renderCommunityPattern).toHaveBeenLastCalledWith(editedProject);
    expect(communityApi.uploadCommunityAsset).toHaveBeenCalledTimes(1);
    expect(communityApi.publishCommunityPost).toHaveBeenCalledTimes(1);
    expect(buttonByText(tree, 'Published works (1)')).toBeDefined();
  });

  it.each([
    ['rejected upload', () => communityApi.uploadCommunityAsset.mockRejectedValue(new Error('Upload unavailable')), 'Upload unavailable'],
    ['missing asset data', () => communityApi.uploadCommunityAsset.mockResolvedValue({ ok: true }), '社区图片上传失败'],
    ['missing asset id', () => communityApi.uploadCommunityAsset.mockResolvedValue({ ok: true, data: { asset: {} } }), '社区图片上传失败'],
  ])('does not publish or mark after %s', async (_label, setup, message) => {
    setup();
    const tree = await confirmPublish(await openPublishDialog(initialRecord({ id: 'cloud-upload', userId: 'user-1', hasCloudCopy: true })));

    expect(communityApi.uploadCommunityAsset).toHaveBeenCalledTimes(1);
    expect(communityApi.publishCommunityPost).not.toHaveBeenCalled();
    expect(patternHistory.markExportedPatternPublished).not.toHaveBeenCalled();
    expect(textContent(tree)).toContain(message);
    expect(buttonByText(tree, 'Confirm publish').props?.disabled).toBe(false);
  });

  it.each(['en', 'zh'])('keeps server-confirmed publication in Works and Library when the local mark fails (%s)', async (language) => {
    languageState.language = language;
    const isEn = language === 'en';
    patternHistory.markExportedPatternPublished.mockRejectedValue(new Error('Local publication state failed'));
    let tree = await confirmPublish(await openPublishDialog(initialRecord({ id: 'cloud-mark', userId: 'user-1', hasCloudCopy: true })));

    expect(communityApi.uploadCommunityAsset).toHaveBeenCalledTimes(1);
    expect(communityApi.publishCommunityPost).toHaveBeenCalledTimes(1);
    expect(patternHistory.markExportedPatternPublished).toHaveBeenCalledExactlyOnceWith('cloud-mark', 'user-1');
    expect(textContent(tree)).toContain(isEn
      ? 'Published, but the local library state could not be updated. Please refresh.'
      : '已发布，图库本地状态更新失败，请刷新');
    expect(textContent(tree)).not.toContain('Local publication state failed');
    expect(textContent(tree)).not.toContain(isEn ? 'Unable to publish this work.' : '作品发布失败');
    expect(buttonByText(tree, isEn ? 'My Library (1)' : '我的图库 (1)')).toBeDefined();
    expect(buttonByText(tree, isEn ? 'Published works (1)' : '已发布作品 (1)')).toBeDefined();
    expect(textContent(tree)).toContain('Original work');
    expect(() => buttonByText(tree, isEn ? 'Confirm publish' : '确认发布')).toThrow();
    expect(() => buttonByText(tree, isEn ? 'Publish' : '发布到社区')).toThrow();
    click(buttonByText(tree, isEn ? 'Published works (1)' : '已发布作品 (1)'));
    tree = render();
    expect(textContent(tree)).toContain('Original work');
    click(buttonByText(tree, isEn ? 'Open community' : '进入社区'));
    expect(modalProps.onOpenCommunity).toHaveBeenCalledTimes(1);
    expect(communityApi.publishCommunityPost).toHaveBeenCalledTimes(1);
  });

  it('updates published state and closes the dialog before local marking finishes', async () => {
    let rejectMark!: (reason: Error) => void;
    patternHistory.markExportedPatternPublished.mockImplementation(() => new Promise((_resolve, reject) => { rejectMark = reject; }));
    let tree = await confirmPublish(await openPublishDialog(initialRecord({ id: 'cloud-mark-pending', userId: 'user-1', hasCloudCopy: true })));

    expect(patternHistory.markExportedPatternPublished).toHaveBeenCalledTimes(1);
    expect(buttonByText(tree, 'My Library (1)')).toBeDefined();
    expect(buttonByText(tree, 'Published works (1)')).toBeDefined();
    expect(() => buttonByText(tree, 'Confirm publish')).toThrow();

    rejectMark(new Error('Local state write failed'));
    await flush();
    tree = render();
    expect(textContent(tree)).toContain('Published, but the local library state could not be updated. Please refresh.');
    expect(() => buttonByText(tree, 'Confirm publish')).toThrow();
    expect(communityApi.publishCommunityPost).toHaveBeenCalledTimes(1);
  });

  it('does not mark a project or report success when publishing throws after upload', async () => {
    communityApi.publishCommunityPost.mockRejectedValue(new Error('Publish unavailable'));
    const tree = await confirmPublish(await openPublishDialog(initialRecord({ id: 'cloud-publish-error', userId: 'user-1', hasCloudCopy: true })));

    expect(communityApi.uploadCommunityAsset).toHaveBeenCalledTimes(1);
    expect(communityApi.publishCommunityPost).toHaveBeenCalledTimes(1);
    expect(patternHistory.markExportedPatternPublished).not.toHaveBeenCalled();
    expect(textContent(tree)).toContain('Publish unavailable');
    expect(buttonByText(tree, 'Published works (0)')).toBeDefined();
    expect(buttonByText(tree, 'Confirm publish').props?.disabled).toBe(false);
  });

  it.each([
    { completionStatus: 'DRAFT' },
    { completionStatus: 'COMPLETED', paidNonEmptyBeads: 255 },
    { completionStatus: 'COMPLETED', paidNonEmptyBeads: null },
  ])('preserves the completion/payment guard for %j', async (completion) => {
    const tree = await loadRecord(initialRecord({ id: 'cloud-locked', userId: 'user-1', hasCloudCopy: true, ...completion }));
    const publish = buttonByText(tree, 'Publish');

    expect(publish.props?.disabled).toBe(true);
    click(publish); // Even a programmatic invocation must respect the guard.
    expect(textContent(render())).toContain('Complete the pattern to unlock publishing.');
    expect(patternHistory.getPatternProject).not.toHaveBeenCalled();
    expect(renderCommunityPattern).not.toHaveBeenCalled();
    expect(communityApi.uploadCommunityAsset).not.toHaveBeenCalled();
    expect(communityApi.publishCommunityPost).not.toHaveBeenCalled();
    expect(creditApi.apiQuoteCredits).not.toHaveBeenCalled();
  });

  it('locks before awaiting the full project so double clicks cannot duplicate reads or uploads', async () => {
    let resolveProject!: (project: StoredPatternProject) => void;
    patternHistory.getPatternProject.mockImplementation(() => new Promise((resolve) => { resolveProject = resolve; }));
    let tree = await openPublishDialog(initialRecord({ id: 'cloud-loading', userId: 'user-1', hasCloudCopy: true }));
    const confirm = buttonByText(tree, 'Confirm publish');
    click(confirm);
    click(confirm);
    tree = render();

    expect(patternHistory.getPatternProject).toHaveBeenCalledTimes(1);
    expect(renderCommunityPattern).not.toHaveBeenCalled();
    expect(communityApi.uploadCommunityAsset).not.toHaveBeenCalled();
    expect(communityApi.publishCommunityPost).not.toHaveBeenCalled();
    expect(buttonByText(tree, 'Cancel').props?.disabled).toBe(true);
    expect(buttonByText(tree, 'Confirm publish').props?.disabled).toBe(true);

    resolveProject(fullProject());
    await flush();
    tree = render();
    expect(renderCommunityPattern).toHaveBeenCalledTimes(1);
    expect(communityApi.uploadCommunityAsset).toHaveBeenCalledTimes(1);
    expect(communityApi.publishCommunityPost).toHaveBeenCalledTimes(1);
    expect(patternHistory.markExportedPatternPublished).toHaveBeenCalledTimes(1);
    expect(buttonByText(tree, 'My Library (1)').props?.className).toContain('bg-sky-600');
  });

  it('sends edited metadata and gives the private publishing message', async () => {
    let tree = await openPublishDialog(initialRecord({ id: 'cloud-private', userId: 'user-1', hasCloudCopy: true }));
    change(inputByDescription(tree, 'publish-name-help'), 'Private title');
    tree = render();
    const description = findNode(tree, (node) => node.type === 'textarea' && node.props?.['aria-describedby'] === 'publish-description-help');
    change(description, 'Private description');
    tree = render();
    click(buttonByText(tree, 'Private'));
    tree = render();
    click(buttonByText(tree, '人物'));
    tree = render();
    tree = await confirmPublish(tree);

    expect(communityApi.publishCommunityPost).toHaveBeenCalledWith({
      title: 'Private title',
      description: 'Private description',
      visibility: 'private',
      tags: ['人物'],
      workId: 'cloud-private',
      assetId: 'asset-default',
    });
    expect(textContent(tree)).toContain('Published privately. It will not appear in the public community list.');
    expect(textContent(tree)).not.toContain('Open Community to view it.');
  });

  it('keeps publishing locked during snapshot upload and never sends a post before the asset is ready', async () => {
    let resolveUpload!: (result: { ok: boolean; data: { asset: { id: string } } }) => void;
    communityApi.uploadCommunityAsset.mockImplementation(() => new Promise((resolve) => { resolveUpload = resolve; }));
    let tree = await openPublishDialog(initialRecord({ id: 'cloud-upload-busy', userId: 'user-1', hasCloudCopy: true }));
    const confirm = buttonByText(tree, 'Confirm publish');
    click(confirm);
    await flush();
    click(confirm);
    tree = render();

    expect(patternHistory.getPatternProject).toHaveBeenCalledTimes(1);
    expect(renderCommunityPattern).toHaveBeenCalledTimes(1);
    expect(communityApi.uploadCommunityAsset).toHaveBeenCalledTimes(1);
    expect(communityApi.publishCommunityPost).not.toHaveBeenCalled();
    expect(patternHistory.markExportedPatternPublished).not.toHaveBeenCalled();
    expect(buttonByText(tree, 'Cancel').props?.disabled).toBe(true);
    expect(buttonByText(tree, 'Confirm publish').props?.disabled).toBe(true);

    resolveUpload({ ok: true, data: { asset: { id: 'fresh-upload' } } });
    await flush();
    expect(communityApi.publishCommunityPost).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ assetId: 'fresh-upload' }));
    expect(patternHistory.markExportedPatternPublished).toHaveBeenCalledTimes(1);
  });

  it('allows only one publish request while busy and disables close and cancel controls', async () => {
    let resolvePublish: ((result: { ok: boolean }) => void) | undefined;
    communityApi.publishCommunityPost.mockImplementation(() => new Promise((resolve) => { resolvePublish = resolve; }));
    let tree = await openPublishDialog(initialRecord({ id: 'cloud-busy', userId: 'user-1', hasCloudCopy: true }));
    const confirm = buttonByText(tree, 'Confirm publish');

    click(confirm);
    click(confirm);
    await flush();
    tree = render();

    expect(patternHistory.getPatternProject).toHaveBeenCalledTimes(1);
    expect(renderCommunityPattern).toHaveBeenCalledTimes(1);
    expect(communityApi.uploadCommunityAsset).toHaveBeenCalledTimes(1);
    expect(communityApi.publishCommunityPost).toHaveBeenCalledTimes(1);
    expect(buttonByText(tree, 'Cancel').props?.disabled).toBe(true);
    expect(findNode(tree, (node) => node.type === 'button' && node.props?.['aria-label'] === 'Close gallery').props?.disabled).toBe(true);

    resolvePublish?.({ ok: true });
    await flush();
  });
});
