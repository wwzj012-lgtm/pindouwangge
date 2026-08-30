import { describe, expect, it } from 'vitest';
import { ASSEMBLY_PROJECT_SCHEMA_VERSION, createAssemblyProjectDraft, deserializeAssemblyProject, fileToAssemblyMetadata, saveAssemblyGenerationResult, serializeAssemblyProject, updateAssemblyProjectInputs } from './assemblyProject';

describe('assemblyProject', () => {
  it('creates a serializable default draft', () => {
    const project = createAssemblyProjectDraft({ id: 'draft-1', now: '2026-08-26T00:00:00.000Z' });
    expect(project.schemaVersion).toBe(ASSEMBLY_PROJECT_SCHEMA_VERSION);
    expect(project.inputs.views.front).toBeNull();
    expect(project.result).toBeNull();
    expect(project.version.revision).toBe(0);
  });

  it('updates input metadata immutably without persisting File or object URLs', () => {
    const project = createAssemblyProjectDraft({ id: 'draft-1', now: '2026-08-26T00:00:00.000Z' });
    const metadata = fileToAssemblyMetadata({ name: 'front.png', type: 'image/png', size: 42, lastModified: 12 } as File);
    const updated = updateAssemblyProjectInputs(project, { views: { front: metadata } as typeof project.inputs.views, manualNotes: 'two layers' }, '2026-08-26T00:00:01.000Z');
    expect(project.inputs.views.front).toBeNull();
    expect(updated.inputs.views.front).toEqual(metadata);
    expect(serializeAssemblyProject(updated)).not.toContain('blob:');
    expect(serializeAssemblyProject(updated)).not.toContain('lastModifiedDate');
  });

  it('round-trips a generation result', () => {
    const draft = createAssemblyProjectDraft({ id: 'draft-1', now: '2026-08-26T00:00:00.000Z' });
    const saved = saveAssemblyGenerationResult(draft, { width: 2, height: 1, cells: [['A', null]], diagnostics: { pipeline: 'cartoon', confidence: 0.8, effectiveColorCount: 1, backgroundPixelsRemoved: 2 } }, { diagramType: 'assembly', diagramSize: 'small', templateId: 'tower', source: 'image', preprocessing: { fit: 'cover', removeWhiteBackground: true, backgroundTolerance: 24, colorLimit: 16, quantizationStrength: 32 } }, '2026-08-26T00:00:02.000Z');
    expect(deserializeAssemblyProject(serializeAssemblyProject(saved))).toEqual(saved);
  });

  it('safely rejects unknown and damaged schemas', () => {
    expect(deserializeAssemblyProject('{')).toBeNull();
    expect(deserializeAssemblyProject(JSON.stringify({ schemaVersion: 99 }))).toBeNull();
  });
});
