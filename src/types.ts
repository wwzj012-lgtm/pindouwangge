export type BrandKey =
  | 'MARD'
  | 'MARD_291'
  | 'COCO'
  | 'ARTKAL_S'
  | 'ARTKAL_MINI'
  | 'PERLER'
  | 'HAMA'
  | 'CUSTOM'
  // Persisted directory codes are stable identifiers, including deleted brands in old snapshots.
  | (string & {});

export interface BeadColor {
  id: string;
  code: string;       // Brand code e.g. "M01", "P01", "S01"
  name: string;       // Color name e.g. "白色", "黑色", "樱花粉"
  hex: string;        // Hex color value e.g. "#FFFFFF"
  rgb: [number, number, number];
  brand: BrandKey;
  symbol?: string;    // Character symbol for pattern printing (e.g. "A", "1", "★")
  enabled?: boolean;  // Whether user includes this color in auto-conversion
  /** Screen-only reference for materials whose physical effects cannot be represented by RGB. */
  screenReferenceOnly?: boolean;
}

export type BeadShape = 'fuse_3d' | 'square' | 'circle_flat' | 'ironed';

export type DitherMode = 'none' | 'floyd' | 'atkinson';

export type ColorMatchAlgo = 'ciede2000_bright' | 'ciede2000_vivid' | 'ciede2000' | 'cie76' | 'rgb_weighted' | 'oklab' | 'rgb';

export type ToolType =
  | 'pencil'
  | 'line'
  | 'rectangle'
  | 'circle'
  | 'bucket'
  | 'eyedropper'
  | 'eraser'
  | 'region_clear'
  | 'replace'
  | 'hand';

export type SymmetryMode = 'none' | 'horizontal' | 'vertical' | 'quad';

export type CanvasBackdrop = 'dark_grid' | 'light_pegboard' | 'wood' | 'studio' | 'slate';

export interface ConvertSettings {
  width: number;             // Grid width in beads
  height: number;            // Grid height in beads
  keepAspectRatio: boolean;  // Keep original image ratio
  brand: BrandKey;           // Active palette brand
  dither: DitherMode;        // Dithering strategy
  colorLimit: number;        // Max colors allowed (0 for unlimited)
  brightness: number;        // -100 to 100
  contrast: number;          // -100 to 100
  saturation: number;        // -100 to 100
  transparentCutoff: number; // 0-255 alpha cutoff for transparent pixel
  boardSize: number;         // Standard board grid size e.g. 29 for 29x29, 14 for 14x14
  
  // Enhanced image conversion options
  // Retained so saved projects from older versions can still load. V2 selects CIE76/CIEDE2000 by pipeline.
  colorMatchAlgo: ColorMatchAlgo;
  sharpening: number;             // 0-100 unsharp mask sharpening
  outlineBoost: boolean;          // Preserve black/dark outlines in pixel art/sprites
  vividBoost?: boolean;           // Prevent color whitening & enhance saturation
  chromaKeyColor: string | null;  // Transparent background color hex (if set)
  chromaKeyTolerance: number;     // 0-100 tolerance for chroma keying
  /** Explicit opt-in. Missing on historical projects means background is kept. */
  backgroundRemovalEnabled?: boolean;
  kmeansClustering?: boolean;     // Group similar colors before mapping to reduce noise
  pipelineOverride?: 'auto' | 'cartoon' | 'logo' | 'photo'; // Defaults to automatic V2 classification
  ditherStrength?: number;        // 0-1, defaults to 0.65 for Floyd-Steinberg
  /** Photo-only K-Means merge amount, 0-100. Missing values keep the current default. */
  quantizationStrength?: number;
}

export interface GridCell {
  colorId: string | null;  // BeadColor id, or null for empty peg
  colorHex: string | null;
  code: string | null;
  symbol?: string | null;
}

export interface ColorStat {
  color: BeadColor;
  count: number;
  percentage: number;
  bagsCount: number; // Estimated 1000-bead bags
}

export interface ProjectData {
  version: string;
  name: string;
  width: number;
  height: number;
  boardSize: number;
  brand: BrandKey;
  grid: (string | null)[][]; // Matrix of BeadColor IDs
  customPalette?: BeadColor[];
  createdAt: string;
}

export interface SampleImage {
  id: string;
  name: string;
  category: string;
  url: string; // Base64 or Data URL
}
