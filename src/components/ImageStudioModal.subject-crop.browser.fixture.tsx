import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import type { BeadColor, ConvertSettings } from '../types';
import { LanguageProvider } from '../context/LanguageContext';
import { suggestSubjectBounds } from '../utils/subjectBounds';
import { ImageStudioModal } from './ImageStudioModal';

interface FixtureApply {
  gridWidth: number;
  gridHeight: number;
  imageWidth: number;
  imageHeight: number;
  originalWidth: number | null;
  originalHeight: number | null;
  savedPercent: number | null;
}

declare global {
  interface Window {
    subjectCropFixture: {
      bounds: { x: number; y: number; width: number; height: number } | null;
      setImageDecodeDelay: (milliseconds: number) => void;
    };
  }
}

const palette: BeadColor[] = [
  { id: 'fixture-red', code: 'R01', name: 'Red', hex: '#E11D48', rgb: [225, 29, 72], brand: 'MARD' },
  { id: 'fixture-blue', code: 'B01', name: 'Blue', hex: '#2563EB', rgb: [37, 99, 235], brand: 'MARD' },
  { id: 'fixture-yellow', code: 'Y01', name: 'Yellow', hex: '#FACC15', rgb: [250, 204, 21], brand: 'MARD' },
  { id: 'fixture-dark', code: 'D01', name: 'Dark', hex: '#1E293B', rgb: [30, 41, 59], brand: 'MARD' },
];

const initialSettings: ConvertSettings = {
  width: 79,
  height: 44,
  keepAspectRatio: true,
  brand: 'MARD',
  dither: 'none',
  colorLimit: 0,
  brightness: 0,
  contrast: 0,
  saturation: 0,
  transparentCutoff: 0,
  boardSize: 29,
  colorMatchAlgo: 'ciede2000',
  sharpening: 0,
  outlineBoost: false,
  chromaKeyColor: null,
  chromaKeyTolerance: 0,
  backgroundRemovalEnabled: false,
  kmeansClustering: true,
  pipelineOverride: 'auto',
  ditherStrength: 0.65,
};

let imageDecodeDelayMs = 0;
const nativeImageSrc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
if (!nativeImageSrc?.get || !nativeImageSrc.set) throw new Error('Chrome image src descriptor is unavailable');
Object.defineProperty(HTMLImageElement.prototype, 'src', {
  configurable: true,
  enumerable: nativeImageSrc.enumerable,
  get: nativeImageSrc.get,
  set(value: string) {
    if (imageDecodeDelayMs > 0 && value.startsWith('data:image/png')) {
      const delay = imageDecodeDelayMs;
      window.setTimeout(() => nativeImageSrc.set!.call(this, value), delay);
      return;
    }
    nativeImageSrc.set!.call(this, value);
  },
});

function renderFixtureImage(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D is unavailable');

  const subjectX = Math.round(width * 0.3);
  const subjectY = Math.round(height * 0.16);
  const subjectWidth = Math.round(width * 0.35);
  const subjectHeight = Math.round(height * 0.66);
  context.fillStyle = '#E11D48';
  context.fillRect(subjectX, subjectY, subjectWidth, subjectHeight);
  context.fillStyle = '#2563EB';
  context.fillRect(subjectX + Math.round(subjectWidth * 0.2), subjectY + Math.round(subjectHeight * 0.1), Math.round(subjectWidth * 0.6), Math.round(subjectHeight * 0.38));
  context.fillStyle = '#1E293B';
  context.fillRect(subjectX + Math.round(subjectWidth * 0.12), subjectY + Math.round(subjectHeight * 0.66), Math.round(subjectWidth * 0.76), Math.round(subjectHeight * 0.28));

  // One intentionally detached tiny mark must stay outside the crop and trigger the warning.
  context.fillStyle = '#FACC15';
  context.fillRect(Math.round(width * 0.84), Math.round(height * 0.45), 8, 8);
  return canvas;
}

function loadImage(width: number, height: number): Promise<HTMLImageElement> {
  const source = renderFixtureImage(width, height).toDataURL('image/png');
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Fixture source image failed to load'));
    image.src = source;
  });
}

const helperCanvas = renderFixtureImage(400, 300);
const helperContext = helperCanvas.getContext('2d', { willReadFrequently: true });
if (!helperContext) throw new Error('Canvas ImageData context is unavailable');
const helperSuggestion = suggestSubjectBounds(helperContext.getImageData(0, 0, helperCanvas.width, helperCanvas.height));
window.subjectCropFixture = {
  bounds: helperSuggestion.hasSuggestion ? helperSuggestion.pixelBounds : null,
  setImageDecodeDelay(milliseconds) {
    imageDecodeDelayMs = Math.max(0, Math.min(5000, milliseconds));
  },
};

const Fixture: React.FC = () => {
  const [sourceImage, setSourceImage] = useState<HTMLImageElement | null>(null);
  const [subjectCropSource, setSubjectCropSource] = useState<{ image: HTMLImageElement; savedPercent: number } | null>(null);
  const [settings, setSettings] = useState<ConvertSettings>(initialSettings);
  const [isOpen, setIsOpen] = useState(true);
  const [historyCount, setHistoryCount] = useState(0);
  const [lastApply, setLastApply] = useState<FixtureApply | null>(null);

  useEffect(() => {
    void loadImage(400, 300).then(setSourceImage);
  }, []);

  const loadAnotherSource = async () => {
    const nextImage = await loadImage(320, 420);
    setSourceImage(nextImage);
    setSubjectCropSource(null);
    setSettings(current => ({ ...current, ...initialSettings }));
  };

  const applyConversion = (
    grid: (string | null)[][],
    updatedImage?: HTMLImageElement,
    _diagnostics?: unknown,
    subjectCrop?: { originalImage: HTMLImageElement; savedPercent: number } | null,
  ) => {
    if (updatedImage) setSourceImage(updatedImage);
    setSubjectCropSource(subjectCrop ? { image: subjectCrop.originalImage, savedPercent: subjectCrop.savedPercent } : null);
    setLastApply({
      gridWidth: grid[0]?.length ?? 0,
      gridHeight: grid.length,
      imageWidth: updatedImage?.naturalWidth ?? 0,
      imageHeight: updatedImage?.naturalHeight ?? 0,
      originalWidth: subjectCrop?.originalImage.naturalWidth ?? null,
      originalHeight: subjectCrop?.originalImage.naturalHeight ?? null,
      savedPercent: subjectCrop?.savedPercent ?? null,
    });
    setHistoryCount(count => count + 1);
  };

  const sourceWidth = sourceImage?.naturalWidth ?? 0;
  const sourceHeight = sourceImage?.naturalHeight ?? 0;
  return (
    <LanguageProvider>
      <div style={{ position: 'fixed', left: 4, top: 4, zIndex: 60, display: 'flex', gap: 4 }}>
        <button data-testid="fixture-reopen" type="button" onClick={() => setIsOpen(true)}>Reopen modal</button>
        <button data-testid="fixture-new-source" type="button" onClick={() => void loadAnotherSource()}>Load another source</button>
      </div>
      <output hidden data-testid="fixture-state"
        data-source-width={sourceWidth}
        data-source-height={sourceHeight}
        data-crop-provenance={subjectCropSource ? 'present' : 'none'}
        data-history-count={historyCount}
        data-settings-width={settings.width}
        data-settings-height={settings.height}
        data-last-apply={lastApply ? JSON.stringify(lastApply) : 'none'} />
      <output hidden data-testid="fixture-credit-events">0</output>
      <ImageStudioModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        sourceImage={sourceImage}
        originalSource={subjectCropSource}
        settings={settings}
        setSettings={setSettings}
        activePalette={palette}
        onApplyConversion={applyConversion}
      />
    </LanguageProvider>
  );
};

createRoot(document.getElementById('root')!).render(<Fixture />);
