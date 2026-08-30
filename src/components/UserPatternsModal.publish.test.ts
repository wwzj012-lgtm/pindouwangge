import { beforeEach, describe, expect, it, vi } from 'vitest';

const hookRuntime = vi.hoisted(() => ({
  cursor: 0,
  slots: [] as unknown[],
  effects: [] as unknown[][],
}));

const authState = vi.hoisted(() => ({ currentUser: { uid: 'user-1' } as { uid: string } | null }));
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
  getCommunityPublishErrorCode: vi.fn(),
  publishCommunityPost: vi.fn(),
  uploadCommunityAsset: vi.fn(),
}));
const creditApi = vi.hoisted(() => ({
  apiQuoteCredits: vi.fn(),
}));
const renderPreview = vi.hoisted(() => vi.fn());

vi.mock('react', () => ({
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
}));

vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ currentUser: authState.currentUser }) }));
vi.mock('../context/LanguageContext', () => ({ useLanguage: () => ({ language: 'en' }) }));
vi.mock('../utils/patternHistory', () => patternHistory);
vi.mock('../utils/patternPreview', () => ({ renderPatternPreview: renderPreview }));
vi.mock('../utils/communityApi', () => communityApi);
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

const flush = async (): Promise<void> => {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
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
    click(buttonByText(tree, 'Publish'));
    tree = render();
    return tree;
  };

  const confirmPublish = async (tree: unknown): Promise<unknown> => {
    click(buttonByText(tree, 'Confirm publish'));
    await flush();
    tree = render();
    // Local-only records now require an explicit cloud-save confirmation before
    // the publish request. Cloud-backed records continue directly to publish.
    try {
      click(buttonByText(tree, 'Confirm save'));
      await flush();
      tree = render();
      click(buttonByText(tree, 'Confirm publish'));
      await flush();
      tree = render();
    } catch {
      // No cloud-save dialog was shown; the publish request already completed.
    }
    return tree;
  };

  beforeEach(() => {
    hookRuntime.cursor = 0;
    hookRuntime.slots = [];
    hookRuntime.effects = [];
    authState.currentUser = { uid: 'user-1' };
    onOpenAuthModal.mockReset();
    modalProps.onClose.mockReset();
    modalProps.onContinueEditing.mockReset();
    modalProps.onOpenCommunity.mockReset();
    Object.values(patternHistory).forEach((mock) => {
      if (typeof mock === 'function' && 'mockReset' in mock) mock.mockReset();
    });
    Object.values(communityApi).forEach((mock) => mock.mockReset());
    renderPreview.mockReset();
    patternHistory.normalizePatternTitle.mockImplementation((value: string) => value.trim());
    patternHistory.patternDeletionActions.mockReturnValue([]);
    patternHistory.requiresExplicitCloudBinding.mockReturnValue(false);
    communityApi.publishCommunityPost.mockResolvedValue({ ok: true });
    communityApi.uploadCommunityAsset.mockResolvedValue({ ok: true, data: { asset: { id: 'asset-default' } } });
    creditApi.apiQuoteCredits.mockResolvedValue({ ok: true, status: 200, data: { totalUnits: 3, points: 0.3 } });
    renderPreview.mockResolvedValue(new Blob(['preview'], { type: 'image/png' }));
  });

  it('opens sign-in instead of publishing when a signed-out user clicks Publish', async () => {
    const tree = await loadRecord(initialRecord(), null);

    click(buttonByText(tree, 'Publish'));

    expect(onOpenAuthModal).toHaveBeenCalledTimes(1);
    expect(communityApi.publishCommunityPost).not.toHaveBeenCalled();
    expect(communityApi.uploadCommunityAsset).not.toHaveBeenCalled();
  });

  it('retries a cloud post exactly once with an asset only when the Worker requires it', async () => {
    const record = initialRecord({
      id: 'cloud-id',
      userId: 'user-1',
      hasCloudCopy: true,
      previewBlob: new Blob(['preview'], { type: 'image/png' }),
    });
    communityApi.publishCommunityPost
      .mockResolvedValueOnce({ ok: false, error: 'asset required' })
      .mockResolvedValueOnce({ ok: true });
    communityApi.getCommunityPublishErrorCode.mockReturnValue('WORK_ASSET_REQUIRED');

    const tree = await openPublishDialog(record);
    await confirmPublish(tree);

    expect(communityApi.uploadCommunityAsset).toHaveBeenCalledTimes(1);
    expect(communityApi.publishCommunityPost).toHaveBeenCalledTimes(2);
    expect(communityApi.publishCommunityPost).toHaveBeenNthCalledWith(1, expect.objectContaining({ workId: 'cloud-id' }));
    expect(communityApi.publishCommunityPost.mock.calls[0]?.[0]).not.toHaveProperty('assetId');
    expect(communityApi.publishCommunityPost).toHaveBeenNthCalledWith(2, expect.objectContaining({ workId: 'cloud-id', assetId: 'asset-default' }));
    expect(patternHistory.markExportedPatternPublished).toHaveBeenCalledWith('cloud-id', 'user-1');
  });

  it.each([
    ['409 duplicate response', 'DUPLICATE_POST'],
    ['500 server response', null],
  ])('does not upload or mark a cloud work after a %s', async (_label, errorCode) => {
    const record = initialRecord({ id: 'cloud-id', userId: 'user-1', hasCloudCopy: true });
    communityApi.publishCommunityPost.mockResolvedValue({ ok: false, error: 'publish rejected' });
    communityApi.getCommunityPublishErrorCode.mockReturnValue(errorCode);

    const tree = await openPublishDialog(record);
    await confirmPublish(tree);

    expect(communityApi.uploadCommunityAsset).not.toHaveBeenCalled();
    expect(patternHistory.markExportedPatternPublished).not.toHaveBeenCalled();
    expect(communityApi.publishCommunityPost).toHaveBeenCalledTimes(1);
  });

  it('syncs a local work first, then uses the returned cloud id for preview, publishing, and marking', async () => {
    const record = initialRecord({ id: 'local-before-sync' });
    const syncedRecord = initialRecord({
      id: 'cloud-after-sync',
      userId: 'user-1',
      hasCloudCopy: true,
      hasLocalCopy: true,
      syncState: 'synced',
    });
    patternHistory.retryPatternCloudSync.mockResolvedValue(syncedRecord);
    patternHistory.getPatternProject.mockResolvedValue({ id: 'cloud-after-sync' });

    const tree = await openPublishDialog(record);
    await confirmPublish(tree);

    expect(patternHistory.retryPatternCloudSync).toHaveBeenCalledWith('local-before-sync', 'user-1');
    expect(patternHistory.getPatternProject).toHaveBeenCalledWith('cloud-after-sync', 'user-1');
    expect(communityApi.publishCommunityPost).toHaveBeenCalledWith(expect.objectContaining({ workId: 'cloud-after-sync' }));
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
    });
    expect(textContent(tree)).toContain('Published privately. It will not appear in the public community list.');
    expect(textContent(tree)).not.toContain('Open Community to view it.');
  });

  it('allows only one publish request while busy and disables close and cancel controls', async () => {
    let resolvePublish: ((result: { ok: boolean }) => void) | undefined;
    communityApi.publishCommunityPost.mockImplementation(() => new Promise((resolve) => { resolvePublish = resolve; }));
    let tree = await openPublishDialog(initialRecord({ id: 'cloud-busy', userId: 'user-1', hasCloudCopy: true }));
    const confirm = buttonByText(tree, 'Confirm publish');

    click(confirm);
    click(confirm);
    tree = render();

    expect(communityApi.publishCommunityPost).toHaveBeenCalledTimes(1);
    expect(buttonByText(tree, 'Cancel').props?.disabled).toBe(true);
    expect(findNode(tree, (node) => node.type === 'button' && node.props?.['aria-label'] === 'Close gallery').props?.disabled).toBe(true);

    resolvePublish?.({ ok: true });
    await flush();
  });
});
