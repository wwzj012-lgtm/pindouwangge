export type BrandKey = 'MARD' | 'ARTKAL_S' | 'PERLER' | 'HAMA' | 'CUSTOM';

export interface BeadColor {
  id: string;
  code: string;       // Brand code e.g. "M01", "P01", "S01"
  name: string;       // Color name e.g. "白色", "黑色", "樱花粉"
  hex: string;        // Hex color value e.g. "#FFFFFF"
  rgb: [number, number, number];
  brand: BrandKey;
  symbol?: string;    // Character symbol for pattern printing (e.g. "A", "1", "★")
  enabled?: boolean;  // Whether user includes this color in auto-conversion
}

export type BeadShape = 'fuse_3d' | 'square' | 'circle_flat';

export type DitherMode = 'none' | 'floyd' | 'atkinson';

export type ColorMatchAlgo = 'ciede2000_bright' | 'ciede2000_vivid' | 'ciede2000' | 'cie76' | 'rgb_weighted';

export type ToolType =
  | 'pencil'
  | 'line'
  | 'rectangle'
  | 'circle'
  | 'bucket'
  | 'eyedropper'
  | 'eraser'
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
  colorMatchAlgo: ColorMatchAlgo; // Distance algorithm: CIEDE2000 Vivid vs CIEDE2000 Standard vs CIE76 vs RGB
  sharpening: number;             // 0-100 unsharp mask sharpening
  outlineBoost: boolean;          // Preserve black/dark outlines in pixel art/sprites
  vividBoost?: boolean;           // Prevent color whitening & enhance saturation
  chromaKeyColor: string | null;  // Transparent background color hex (if set)
  chromaKeyTolerance: number;     // 0-100 tolerance for chroma keying
  kmeansClustering?: boolean;     // Group similar colors before mapping to reduce noise
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

