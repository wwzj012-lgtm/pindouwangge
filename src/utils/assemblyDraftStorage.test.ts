import { describe, expect, it } from 'vitest';
import { ASSEMBLY_DRAFT_STORAGE_KEY, clearAssemblyProjectDraft, loadAssemblyProjectDraft, MAX_ASSEMBLY_DRAFT_STORAGE_CHARS, saveAssemblyProjectDraft } from './assemblyDraftStorage';
import { createAssemblyProjectDraft } from './assemblyProject';

function createStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key), values };
}

describe('assemblyDraftStorage', () => {
  it('uses a versioned key and safely round-trips a draft', () => {
    const storage = createStorage(); const draft = createAssemblyProjectDraft({ id: 'draft-1', now: '2026-08-26T00:00:00.000Z' });
    expect(ASSEMBLY_DRAFT_STORAGE_KEY).toContain(':v1');
    expect(saveAssemblyProjectDraft(storage, draft)).toBe(true);
    expect(loadAssemblyProjectDraft(storage)?.id).toBe('draft-1');
  });

  it('ignores damaged or oversized saved values and clears safely', () => {
    const storage = createStorage({ [ASSEMBLY_DRAFT_STORAGE_KEY]: '{bad' });
    expect(loadAssemblyProjectDraft(storage)).toBeNull();
    storage.values.set(ASSEMBLY_DRAFT_STORAGE_KEY, 'x'.repeat(MAX_ASSEMBLY_DRAFT_STORAGE_CHARS + 1));
    expect(loadAssemblyProjectDraft(storage)).toBeNull();
    expect(clearAssemblyProjectDraft(storage)).toBe(true);
    expect(storage.values.has(ASSEMBLY_DRAFT_STORAGE_KEY)).toBe(false);
  });

  it('does not throw when storage is unavailable', () => {
    const failing = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } };
    expect(loadAssemblyProjectDraft(failing)).toBeNull();
    expect(saveAssemblyProjectDraft(failing, createAssemblyProjectDraft())).toBe(false);
    expect(clearAssemblyProjectDraft(failing)).toBe(false);
  });
});
