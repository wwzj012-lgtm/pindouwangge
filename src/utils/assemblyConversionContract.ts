export interface AssemblyPaletteInput {
  id: string;
  hex: string;
  code: string;
  name: string;
}

export interface AssemblyConverterPaletteColor extends AssemblyPaletteInput {
  rgb: [number, number, number];
}

export interface AssemblyConversionDiagnostics {
  pipeline: string | null;
  confidence: number | null;
  effectiveColorCount: number | null;
  backgroundPixelsRemoved: number | null;
}

export interface AssemblyConversionResult {
  grid: (string | null)[][];
  diagnostics: AssemblyConversionDiagnostics;
}

export function parseAssemblyHexColor(hex: string): [number, number, number] | null {
  const normalized = hex.trim().replace(/^#/, '');
  const value = normalized.length === 3 ? normalized.split('').map(component => component + component).join('') : normalized;
  if (!/^[0-9a-fA-F]{6}$/.test(value)) return null;
  return [Number.parseInt(value.slice(0, 2), 16), Number.parseInt(value.slice(2, 4), 16), Number.parseInt(value.slice(4, 6), 16)];
}

export function toAssemblyConverterPalette(palette: AssemblyPaletteInput[]): AssemblyConverterPaletteColor[] {
  return palette.flatMap(color => { const rgb = parseAssemblyHexColor(color.hex); return rgb ? [{ ...color, rgb }] : []; });
}

export function requireAssemblyConversionResult(value: unknown, expectedWidth: number, expectedHeight: number): AssemblyConversionResult {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { grid?: unknown }).grid)) throw new Error('图片转换未返回有效网格');
  const { grid: rawGrid, diagnostics } = value as { grid: unknown; diagnostics?: unknown };
  if (!Array.isArray(rawGrid)) throw new Error('图片转换未返回有效网格');
  const grid = rawGrid as unknown[];
  if (grid.length !== expectedHeight || grid.some(row => !Array.isArray(row) || row.length !== expectedWidth || row.some(cell => cell !== null && typeof cell !== 'string'))) throw new Error('图片转换返回的网格尺寸无效');
  if (!diagnostics || typeof diagnostics !== 'object') throw new Error('图片转换未返回诊断信息');
  const diagnosticRecord = diagnostics as Record<string, unknown>;
  const numberOrNull = (candidate: unknown) => typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : null;
  return { grid: grid as (string | null)[][], diagnostics: { pipeline: typeof diagnosticRecord.pipeline === 'string' ? diagnosticRecord.pipeline : null, confidence: numberOrNull(diagnosticRecord.confidence), effectiveColorCount: numberOrNull(diagnosticRecord.effectiveColorCount), backgroundPixelsRemoved: numberOrNull(diagnosticRecord.backgroundPixelsRemoved) } };
}
