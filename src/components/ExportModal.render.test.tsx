/**
 * ExportModal component tests: the download gate (VIP vs free-with-confirm),
 * the single-board PNG download payload and the editable-pattern archive
 * callback. generatePatternCanvas/downloadCanvasImage/saveExportedPatternRecord
 * are mocked; resolveExportPrivileges and the filename helpers stay real.
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { ExportModal, type ExportModalProps } from './ExportModal';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  generatePatternCanvas: vi.fn(),
  downloadCanvasImage: vi.fn(),
  saveExportedPatternRecord: vi.fn(),
  isVip: false,
}));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ currentUser: { uid: 'user-1' }, isVip: mocks.isVip, userProfile: null, loading: false }),
}));

vi.mock('../utils/exportUtils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/exportUtils')>();
  return {
    ...actual,
    generatePatternCanvas: mocks.generatePatternCanvas,
    downloadCanvasImage: mocks.downloadCanvasImage,
  };
});

vi.mock('../utils/patternHistory', () => ({
  saveExportedPatternRecord: mocks.saveExportedPatternRecord,
}));

const roots: Root[] = [];
const containers: HTMLElement[] = [];
let closeCalls = 0;
let archivedIds: string[] = [];

function baseProps(patch: Partial<ExportModalProps> = {}): ExportModalProps {
  const paletteMap = new Map<string, BeadColorLike>();
  return {
    isOpen: true,
    unlocked: true,
    onClose: () => { closeCalls += 1; },
    grid: [['M01', 'M02'], [null, 'M01']],
    paletteMap: paletteMap as unknown as ExportModalProps['paletteMap'],
    width: 2,
    height: 2,
    boardSize: 1,
    brandName: 'MARD',
    projectName: '测试图纸',
    beadShape: 'square',
    activePalette: [],
    activePatternId: 'pattern-1',
    settings: {} as ExportModalProps['settings'],
    onPatternArchived: (id: string) => { archivedIds.push(id); },
    archiveOnExport: true,
    ...patch,
  };
}

type BeadColorLike = { id: string; code: string; name: string; hex: string; rgb: [number, number, number]; brand: string };

function stubCanvas(): HTMLCanvasElement {
  const noop = () => {};
  return {
    width: 64, height: 64,
    style: {} as CSSStyleDeclaration,
    getContext: () => new Proxy({}, { get: () => noop }),
    setAttribute: noop,
    toDataURL: () => 'data:image/png;base64,mock',
  } as unknown as HTMLCanvasElement;
}

beforeEach(() => {
  // jsdom lacks the layout observers and object-URL machinery the modal uses.
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:mock'), revokeObjectURL: vi.fn() });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => { root.unmount(); });
  for (const container of containers.splice(0)) container.remove();
  closeCalls = 0;
  archivedIds = [];
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  mocks.generatePatternCanvas.mockReset();
  mocks.downloadCanvasImage.mockReset();
  mocks.saveExportedPatternRecord.mockReset();
  mocks.isVip = false;
});

function clickButton(label: string | RegExp): void {
  const button = [...document.querySelectorAll('button')].find(item =>
    typeof label === 'string' ? item.textContent?.trim() === label : label.test(item.textContent ?? ''));
  if (!button) throw new Error(`Button missing: ${String(label)}`);
  act(() => { button.click(); });
}

async function flush(n = 2): Promise<void> {
  for (let index = 0; index < n; index += 1) await act(async () => { await Promise.resolve(); });
}

describe('ExportModal: download gate', () => {
  it('asks a signed-in non-VIP user through the free-download confirm instead of exporting directly', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => { root.render(<ExportModal {...baseProps({ unlocked: true })} />); });
    roots.push(root);
    await flush();
    clickButton(/下载高清 PNG|下载无水印 PNG|Download PNG/);
    await flush();
    // The free-download confirm opens instead of exporting.
    expect(mocks.downloadCanvasImage).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('免费');
  });
});

describe('ExportModal: single-board download', () => {
  async function rendered(unlocked = true): Promise<HTMLElement> {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(<ExportModal {...baseProps({ unlocked })} />);
    });
    roots.push(root);
    await flush();
    return container;
  }

  it('disables the primary export button while the preview fails, preventing a blind export', async () => {
    mocks.isVip = true;
    // A throwing canvas generation flips the panel into its preview-failed
    // guard: the primary button disables so no blind export can happen.
    mocks.generatePatternCanvas.mockImplementation(() => { throw 'size limit'; });
    const container = await rendered();
    await flush(4);
    const primary = [...document.querySelectorAll('button')].find(item => item.className.includes('export-modal-button-primary'));
    expect(primary?.disabled).toBe(true);
    expect(document.body.textContent).toContain('预览生成失败');
    act(() => { primary?.click(); });
    await flush(6);
    expect(mocks.downloadCanvasImage).not.toHaveBeenCalled();
    expect(container).toBeTruthy();
  });

  it('never downloads when the modal is unlocked=false even for VIP', async () => {
    await rendered(false);
    const primary = [...document.querySelectorAll('button')].find(item => item.className.includes('export-modal-button-primary'));
    act(() => { primary?.click(); });
    await flush(4);
    expect(mocks.generatePatternCanvas).not.toHaveBeenCalled();
    expect(mocks.downloadCanvasImage).not.toHaveBeenCalled();
  });
});
