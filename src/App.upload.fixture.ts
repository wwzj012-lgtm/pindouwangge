import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createImageRequestGate } from './utils/imageRequestGate';
import { advanceCompletionEditRevision } from './utils/patternCompletionState';
import { resetBackgroundRemovalForNewImage } from './utils/imageStudioControls';
import { checkUploadPixels, checkUploadSize, describeUploadRejection } from './utils/uploadGuards';

// Execute the actual App callbacks, not a duplicate upload implementation. Only
// React state setters, FileReader/Image and conversion are controlled here.
const source = ts.createSourceFile('App.tsx', readFileSync(new URL('./App.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const studio = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'StudioApp') as ts.FunctionDeclaration;
const callbackNames = ['beginImageRequest', 'isCurrentImageRequest', 'finishImageRequest', 'invalidateCompletionConfirmation', 'beginNewCompletionDraft', 'handleImageUpload'];
const callbacks = callbackNames.map(name => {
  for (const statement of studio.body!.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    const declaration = statement.declarationList.declarations.find(item => item.name.getText(source) === name);
    if (declaration) return `const ${name} = ${declaration.initializer!.getText(source)};`;
  }
  throw new Error(`Missing App callback: ${name}`);
}).join('\n');

export function createUploadHarness(isEn = false) {
  const state: Record<string, any> = {
    currentTab: 'studio', activePatternId: 'saved-paid-work', draftSourceKey: 'saved-source',
    sourceImage: { src: 'old-photo', naturalWidth: 64, naturalHeight: 48 },
    subjectCropSource: { image: { src: 'uncropped-original' }, savedPercent: 37 },
    projectName: 'old project', grid: [['M01', null]], completedColorIds: ['M01'],
    customSymmetryAxes: { x: 12.5, y: 7.5 }, isPracticeMode: true, practiceColorId: 'M01',
    isImageDerivedPattern: true, currentSavingTarget: 40, completionStatus: 'COMPLETED',
    completionQuote: { idempotencyKey: 'old-confirmation' }, completionPreviewQuote: { scopeKey: 'old-preview' },
    serverPaidCoverage: { scopeKey: 'old-scope', paidNonEmptyBeads: 22 }, paidNonEmptyBeads: 22,
    settings: { width: 79, height: 44, brand: 'MARD', backgroundRemovalEnabled: true, chromaKeyColor: '#ffffff' },
    activePalette: [{ id: 'M01' }], isStudioModalOpen: false, isConverting: false, imageLoadMessage: null,
  };
  const readers: any[] = [];
  const images: any[] = [];
  const conversions: any[] = [];
  let readThrows = false;
  const gate = createImageRequestGate();
  const revision = { current: 17 };
  const dependencies: Record<string, any> = {
    ...state, isEn, imageRequestGateRef: { current: gate }, completionEditRevisionRef: revision,
    useCallback: (callback: unknown) => callback, createDraftId: () => 'new-draft',
    advanceCompletionEditRevision, resetBackgroundRemovalForNewImage,
    checkUploadPixels, checkUploadSize, describeUploadRejection,
    convertImageToGrid: (...args: any[]) => conversions.push(args),
    largeCanvasViewRef: { current: { uploadFile: (file: any) => conversions.push(['largeCanvas', file]) } },
    FileReader: class {
      onload: any; onerror: any; onabort: any;
      constructor() { readers.push(this); }
      readAsDataURL() { if (readThrows) throw new Error('PRIVATE_READ_FAILURE'); }
    },
    Image: class {
      onload: any; onerror: any; naturalWidth = 0; naturalHeight = 0;
      constructor() { images.push(this); }
    },
  };
  for (const key of Object.keys(state)) {
    dependencies[`set${key[0].toUpperCase()}${key.slice(1)}`] = (next: any) => {
      state[key] = typeof next === 'function' ? next(state[key]) : next;
    };
  }
  const code = ts.transpileModule(`${callbacks}\nreturn { handleImageUpload, finishImageRequest };`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const handlers = new Function(...Object.keys(dependencies), code)(...Object.values(dependencies));
  return {
    state, readers, images, conversions, revision,
    upload: (size = 1024, name = 'new.png') => handlers.handleImageUpload({ size, name }),
    read: (index = readers.length - 1, result: unknown = 'data:image/png;base64,new') => readers[index].onload({ target: { result } }),
    decode: (width = 64, height = 48, index = images.length - 1) => {
      Object.assign(images[index], { naturalWidth: width, naturalHeight: height });
      images[index].onload();
    },
    invalidate: () => gate.invalidate(),
    finish: handlers.finishImageRequest as (token: number) => void,
    throwOnRead: () => { readThrows = true; },
  };
}
