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

export type ToolType = 'pencil' | 'bucket' | 'eyedropper' | 'eraser' | 'replace';

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
