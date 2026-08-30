import { deserializeAssemblyProject, serializeAssemblyProject, type AssemblyProject } from './assemblyProject';

export const ASSEMBLY_DRAFT_STORAGE_KEY = 'beadgrid:assembly-project-draft:v1';
export const MAX_ASSEMBLY_DRAFT_STORAGE_CHARS = 2_000_000;

export interface AssemblyDraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function loadAssemblyProjectDraft(storage: AssemblyDraftStorage | null | undefined): AssemblyProject | null {
  if (!storage) return null;
  try {
    const serialized = storage.getItem(ASSEMBLY_DRAFT_STORAGE_KEY);
    if (!serialized || serialized.length > MAX_ASSEMBLY_DRAFT_STORAGE_CHARS) return null;
    return deserializeAssemblyProject(serialized);
  } catch { return null; }
}

export function saveAssemblyProjectDraft(storage: AssemblyDraftStorage | null | undefined, project: AssemblyProject): boolean {
  if (!storage) return false;
  try {
    const serialized = serializeAssemblyProject(project);
    if (serialized.length > MAX_ASSEMBLY_DRAFT_STORAGE_CHARS) return false;
    storage.setItem(ASSEMBLY_DRAFT_STORAGE_KEY, serialized);
    return true;
  } catch { return false; }
}

export function clearAssemblyProjectDraft(storage: AssemblyDraftStorage | null | undefined): boolean {
  if (!storage) return false;
  try { storage.removeItem(ASSEMBLY_DRAFT_STORAGE_KEY); return true; } catch { return false; }
}
