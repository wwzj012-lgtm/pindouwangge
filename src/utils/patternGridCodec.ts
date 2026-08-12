import type { BeadColor, BrandKey, ConvertSettings } from '../types';

export const GRID_CODEC_VERSION = 2;
export const GRID_CHUNK_SIZE = 128;
export const MAX_GRID_DIMENSION = 900;
export const MAX_PALETTE_COLORS = 1023;

export type GridMatrix = (string | null)[][];
export type GridChunkCodec = 'bit-pack-v1' | 'rle-v1';

export interface PatternSettingsSnapshot {
  width: number;
  height: number;
  keepAspectRatio: boolean;
  brand: BrandKey;
  dither: ConvertSettings['dither'];
  colorLimit: number;
  brightness: number;
  contrast: number;
  saturation: number;
  transparentCutoff: number;
  boardSize: number;
  colorMatchAlgo: ConvertSettings['colorMatchAlgo'];
  sharpening: number;
  outlineBoost: boolean;
  vividBoost?: boolean;
  chromaKeyColor: string | null;
  chromaKeyTolerance: number;
  kmeansClustering?: boolean;
  pipelineOverride?: ConvertSettings['pipelineOverride'];
  ditherStrength?: number;
}

export interface StoredPatternProject {
  version: typeof GRID_CODEC_VERSION;
  name: string;
  width: number;
  height: number;
  boardSize: number;
  brand: BrandKey;
  settings: PatternSettingsSnapshot;
  grid: GridMatrix;
  palette: BeadColor[];
  createdAt: number;
}

export interface GridChunkDescriptor {
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
  codec: GridChunkCodec;
  byteLength: number;
  sha256: string;
}

export interface StoredPatternManifest {
  version: typeof GRID_CODEC_VERSION;
  width: number;
  height: number;
  boardSize: number;
  brand: BrandKey;
  name: string;
  createdAt: number;
  settings: PatternSettingsSnapshot;
  palette: BeadColor[];
  chunkSize: typeof GRID_CHUNK_SIZE;
  bitsPerCell: number;
  chunks: GridChunkDescriptor[];
  totalBytes: number;
  rootSha256: string;
}

export interface EncodedGridChunk extends GridChunkDescriptor {
  payload: Uint8Array;
}

export interface EncodedPatternProject {
  manifest: StoredPatternManifest;
  chunks: EncodedGridChunk[];
}

export class PatternCodecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PatternCodecError';
  }
}

function assertDimension(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1 || value > MAX_GRID_DIMENSION) {
    throw new PatternCodecError(`${name} must be an integer between 1 and ${MAX_GRID_DIMENSION}`);
  }
}

function assertInteger(value: unknown, name: string, minimum: number, maximum: number): void {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new PatternCodecError(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
}

function assertNumber(value: unknown, name: string, minimum: number, maximum: number): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new PatternCodecError(`${name} must be a number between ${minimum} and ${maximum}`);
  }
}

export function clonePatternSettings(settings: PatternSettingsSnapshot): PatternSettingsSnapshot {
  return { ...settings };
}

export function validatePatternSettings(settings: PatternSettingsSnapshot, width: number, height: number, brand: BrandKey, boardSize: number): void {
  if (!settings || typeof settings !== 'object') throw new PatternCodecError('settings are required');
  assertDimension(settings.width, 'settings.width');
  assertDimension(settings.height, 'settings.height');
  if (settings.width !== width || settings.height !== height) throw new PatternCodecError('settings dimensions must match grid dimensions');
  if (settings.brand !== brand) throw new PatternCodecError('settings brand must match project brand');
  if (settings.boardSize !== boardSize) throw new PatternCodecError('settings boardSize must match project boardSize');
  if (typeof settings.keepAspectRatio !== 'boolean') throw new PatternCodecError('settings.keepAspectRatio must be boolean');
  if (settings.dither !== 'none' && settings.dither !== 'floyd' && settings.dither !== 'atkinson') throw new PatternCodecError('settings.dither is invalid');
  assertInteger(settings.colorLimit, 'settings.colorLimit', 0, MAX_PALETTE_COLORS);
  assertInteger(settings.brightness, 'settings.brightness', -100, 100);
  assertInteger(settings.contrast, 'settings.contrast', -100, 100);
  assertInteger(settings.saturation, 'settings.saturation', -100, 100);
  assertInteger(settings.transparentCutoff, 'settings.transparentCutoff', 0, 255);
  assertInteger(settings.boardSize, 'settings.boardSize', 1, 256);
  if (!['ciede2000_bright', 'ciede2000_vivid', 'ciede2000', 'cie76', 'rgb_weighted'].includes(settings.colorMatchAlgo)) {
    throw new PatternCodecError('settings.colorMatchAlgo is invalid');
  }
  assertInteger(settings.sharpening, 'settings.sharpening', 0, 100);
  if (typeof settings.outlineBoost !== 'boolean') throw new PatternCodecError('settings.outlineBoost must be boolean');
  if (settings.vividBoost !== undefined && typeof settings.vividBoost !== 'boolean') throw new PatternCodecError('settings.vividBoost must be boolean');
  if (settings.chromaKeyColor !== null && (typeof settings.chromaKeyColor !== 'string' || !/^#[0-9a-f]{6}$/i.test(settings.chromaKeyColor))) {
    throw new PatternCodecError('settings.chromaKeyColor is invalid');
  }
  assertInteger(settings.chromaKeyTolerance, 'settings.chromaKeyTolerance', 0, 100);
  if (settings.kmeansClustering !== undefined && typeof settings.kmeansClustering !== 'boolean') throw new PatternCodecError('settings.kmeansClustering must be boolean');
  if (settings.pipelineOverride !== undefined && !['auto', 'logo', 'photo'].includes(settings.pipelineOverride)) {
    throw new PatternCodecError('settings.pipelineOverride is invalid');
  }
  if (settings.ditherStrength !== undefined) assertNumber(settings.ditherStrength, 'settings.ditherStrength', 0, 1);
}

function assertPalette(palette: BeadColor[]): Map<string, number> {
  if (!Array.isArray(palette) || palette.length === 0 || palette.length > MAX_PALETTE_COLORS) {
    throw new PatternCodecError(`palette must contain 1 to ${MAX_PALETTE_COLORS} colors`);
  }

  const values = new Map<string, number>();
  palette.forEach((color, index) => {
    if (!color || typeof color.id !== 'string' || color.id.trim().length === 0 || color.id.length > 128) {
      throw new PatternCodecError(`palette color ${index} has an invalid id`);
    }
    if (values.has(color.id)) throw new PatternCodecError(`palette contains duplicate id ${color.id}`);
    values.set(color.id, index + 1);
  });
  return values;
}

export function cloneGrid(grid: GridMatrix): GridMatrix {
  return grid.map((row) => [...row]);
}

export function validateStoredProject(project: StoredPatternProject): void {
  if (project.version !== GRID_CODEC_VERSION) throw new PatternCodecError('Unsupported pattern grid version');
  assertDimension(project.width, 'width');
  assertDimension(project.height, 'height');
  if (!Number.isInteger(project.boardSize) || project.boardSize < 1 || project.boardSize > 256) {
    throw new PatternCodecError('boardSize must be an integer between 1 and 256');
  }
  validatePatternSettings(project.settings, project.width, project.height, project.brand, project.boardSize);
  if (!Array.isArray(project.grid) || project.grid.length !== project.height) {
    throw new PatternCodecError('grid height does not match project height');
  }

  const colorValues = assertPalette(project.palette);
  for (let y = 0; y < project.height; y += 1) {
    const row = project.grid[y];
    if (!Array.isArray(row) || row.length !== project.width) {
      throw new PatternCodecError(`grid row ${y} does not match project width`);
    }
    for (const colorId of row) {
      if (colorId !== null && (!colorValues.has(colorId) || typeof colorId !== 'string')) {
        throw new PatternCodecError(`grid references a color outside the palette`);
      }
    }
  }
}

function bitsRequired(paletteLength: number): number {
  return Math.max(1, Math.ceil(Math.log2(paletteLength + 1)));
}

function flattenedChunkValues(
  grid: GridMatrix,
  colorValues: Map<string, number>,
  x: number,
  y: number,
  width: number,
  height: number,
): number[] {
  const result = new Array<number>(width * height);
  let offset = 0;
  for (let row = y; row < y + height; row += 1) {
    for (let column = x; column < x + width; column += 1) {
      const colorId = grid[row]?.[column] ?? null;
      result[offset] = colorId === null ? 0 : (colorValues.get(colorId) ?? 0);
      offset += 1;
    }
  }
  return result;
}

function bitPack(values: number[], bitsPerCell: number): Uint8Array {
  const byteLength = Math.ceil((values.length * bitsPerCell) / 8);
  const output = new Uint8Array(byteLength);
  let bitOffset = 0;

  for (const value of values) {
    for (let bit = 0; bit < bitsPerCell; bit += 1) {
      if ((value & (1 << bit)) !== 0) {
        output[Math.floor(bitOffset / 8)]! |= 1 << (bitOffset % 8);
      }
      bitOffset += 1;
    }
  }
  return output;
}

function unpackBits(payload: Uint8Array, count: number, bitsPerCell: number): number[] {
  const expectedLength = Math.ceil((count * bitsPerCell) / 8);
  if (payload.byteLength !== expectedLength) throw new PatternCodecError('Bit-packed chunk has an invalid byte length');

  const values = new Array<number>(count);
  let bitOffset = 0;
  for (let index = 0; index < count; index += 1) {
    let value = 0;
    for (let bit = 0; bit < bitsPerCell; bit += 1) {
      const currentByte = payload[Math.floor(bitOffset / 8)]!;
      if ((currentByte & (1 << (bitOffset % 8))) !== 0) value |= 1 << bit;
      bitOffset += 1;
    }
    values[index] = value;
  }
  return values;
}

function pushVarint(target: number[], value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new PatternCodecError('Invalid RLE value');
  let remaining = value;
  do {
    let byte = remaining & 0x7f;
    remaining = Math.floor(remaining / 128);
    if (remaining > 0) byte |= 0x80;
    target.push(byte);
  } while (remaining > 0);
}

function readVarint(payload: Uint8Array, start: number): { value: number; next: number } {
  let value = 0;
  let multiplier = 1;
  let offset = start;
  for (let count = 0; count < 10; count += 1) {
    const byte = payload[offset];
    if (byte === undefined) throw new PatternCodecError('Truncated RLE chunk');
    offset += 1;
    value += (byte & 0x7f) * multiplier;
    if (!Number.isSafeInteger(value)) throw new PatternCodecError('RLE value is too large');
    if ((byte & 0x80) === 0) return { value, next: offset };
    multiplier *= 128;
  }
  throw new PatternCodecError('RLE varint is too long');
}

function rleEncode(values: number[]): Uint8Array {
  if (values.length === 0) return new Uint8Array();
  const output: number[] = [];
  let current = values[0]!;
  let runLength = 1;

  for (let index = 1; index < values.length; index += 1) {
    const value = values[index]!;
    if (value === current) {
      runLength += 1;
      continue;
    }
    pushVarint(output, current);
    pushVarint(output, runLength);
    current = value;
    runLength = 1;
  }
  pushVarint(output, current);
  pushVarint(output, runLength);
  return Uint8Array.from(output);
}

function rleDecode(payload: Uint8Array, expectedLength: number): number[] {
  const values: number[] = [];
  let offset = 0;
  while (offset < payload.length) {
    const color = readVarint(payload, offset);
    const run = readVarint(payload, color.next);
    offset = run.next;
    if (run.value < 1 || values.length + run.value > expectedLength) {
      throw new PatternCodecError('RLE chunk has an invalid run length');
    }
    for (let count = 0; count < run.value; count += 1) values.push(color.value);
  }
  if (values.length !== expectedLength) throw new PatternCodecError('RLE chunk has an invalid cell count');
  return values;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(value: string): Uint8Array {
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new PatternCodecError('Invalid SHA-256 digest');
  const bytes = new Uint8Array(32);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, (index + 1) * 2), 16);
  }
  return bytes;
}

export async function sha256Hex(payload: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new PatternCodecError('Web Crypto is unavailable');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', payload);
  return bytesToHex(new Uint8Array(digest));
}

export async function encodePatternProject(project: StoredPatternProject): Promise<EncodedPatternProject> {
  validateStoredProject(project);
  const colorValues = assertPalette(project.palette);
  const bitsPerCell = bitsRequired(project.palette.length);
  const chunks: EncodedGridChunk[] = [];
  let index = 0;

  for (let y = 0; y < project.height; y += GRID_CHUNK_SIZE) {
    for (let x = 0; x < project.width; x += GRID_CHUNK_SIZE) {
      const width = Math.min(GRID_CHUNK_SIZE, project.width - x);
      const height = Math.min(GRID_CHUNK_SIZE, project.height - y);
      const values = flattenedChunkValues(project.grid, colorValues, x, y, width, height);
      const packed = bitPack(values, bitsPerCell);
      const rle = rleEncode(values);
      const codec: GridChunkCodec = rle.byteLength < packed.byteLength ? 'rle-v1' : 'bit-pack-v1';
      const payload = codec === 'rle-v1' ? rle : packed;
      chunks.push({
        index,
        x,
        y,
        width,
        height,
        codec,
        byteLength: payload.byteLength,
        sha256: await sha256Hex(payload),
        payload,
      });
      index += 1;
    }
  }

  const rootInput = new Uint8Array(chunks.length * 32);
  chunks.forEach((chunk, chunkIndex) => rootInput.set(hexToBytes(chunk.sha256), chunkIndex * 32));
  const manifest: StoredPatternManifest = {
    version: GRID_CODEC_VERSION,
    width: project.width,
    height: project.height,
    boardSize: project.boardSize,
    brand: project.brand,
    name: project.name,
    createdAt: project.createdAt,
    settings: clonePatternSettings(project.settings),
    palette: project.palette.map((color) => ({ ...color, rgb: [...color.rgb] as BeadColor['rgb'] })),
    chunkSize: GRID_CHUNK_SIZE,
    bitsPerCell,
    chunks: chunks.map(({ payload: _payload, ...descriptor }) => descriptor),
    totalBytes: chunks.reduce((total, chunk) => total + chunk.byteLength, 0),
    rootSha256: await sha256Hex(rootInput),
  };
  return { manifest, chunks };
}

function assertManifest(manifest: StoredPatternManifest): void {
  if (manifest.version !== GRID_CODEC_VERSION || manifest.chunkSize !== GRID_CHUNK_SIZE) {
    throw new PatternCodecError('Unsupported grid manifest version');
  }
  assertDimension(manifest.width, 'manifest width');
  assertDimension(manifest.height, 'manifest height');
  if (!Number.isInteger(manifest.bitsPerCell) || manifest.bitsPerCell < 1 || manifest.bitsPerCell > 10) {
    throw new PatternCodecError('Manifest bitsPerCell is invalid');
  }
  assertPalette(manifest.palette);
  validatePatternSettings(manifest.settings, manifest.width, manifest.height, manifest.brand, manifest.boardSize);
  const expectedChunks = Math.ceil(manifest.width / GRID_CHUNK_SIZE) * Math.ceil(manifest.height / GRID_CHUNK_SIZE);
  if (manifest.chunks.length !== expectedChunks) throw new PatternCodecError('Manifest chunk count is invalid');
}

function decodeChunkValues(
  descriptor: GridChunkDescriptor,
  payload: Uint8Array,
  bitsPerCell: number,
  paletteLength: number,
): number[] {
  const expectedCells = descriptor.width * descriptor.height;
  const values = descriptor.codec === 'bit-pack-v1'
    ? unpackBits(payload, expectedCells, bitsPerCell)
    : descriptor.codec === 'rle-v1'
    ? rleDecode(payload, expectedCells)
    : (() => { throw new PatternCodecError('Unsupported chunk codec'); })();

  if (values.some((value) => !Number.isInteger(value) || value < 0 || value > paletteLength)) {
    throw new PatternCodecError('Chunk references an invalid palette entry');
  }
  return values;
}

export async function decodePatternProject(
  manifest: StoredPatternManifest,
  chunks: readonly EncodedGridChunk[],
): Promise<StoredPatternProject> {
  assertManifest(manifest);
  if (chunks.length !== manifest.chunks.length) throw new PatternCodecError('Grid chunk count is incomplete');

  const chunksByIndex = new Map(chunks.map((chunk) => [chunk.index, chunk]));
  const rootInput = new Uint8Array(manifest.chunks.length * 32);
  const grid: GridMatrix = Array.from(
    { length: manifest.height },
    () => Array<string | null>(manifest.width).fill(null),
  );

  for (const descriptor of manifest.chunks) {
    const chunk = chunksByIndex.get(descriptor.index);
    if (!chunk || chunk.byteLength !== descriptor.byteLength || chunk.codec !== descriptor.codec) {
      throw new PatternCodecError(`Missing or inconsistent chunk ${descriptor.index}`);
    }
    if (await sha256Hex(chunk.payload) !== descriptor.sha256) {
      throw new PatternCodecError(`Chunk ${descriptor.index} failed its integrity check`);
    }
    rootInput.set(hexToBytes(descriptor.sha256), descriptor.index * 32);
    const values = decodeChunkValues(descriptor, chunk.payload, manifest.bitsPerCell, manifest.palette.length);
    let offset = 0;
    for (let y = descriptor.y; y < descriptor.y + descriptor.height; y += 1) {
      for (let x = descriptor.x; x < descriptor.x + descriptor.width; x += 1) {
        const value = values[offset]!;
        grid[y]![x] = value === 0 ? null : manifest.palette[value - 1]!.id;
        offset += 1;
      }
    }
  }
  if (await sha256Hex(rootInput) !== manifest.rootSha256) {
    throw new PatternCodecError('Grid manifest failed its integrity check');
  }

  const project: StoredPatternProject = {
    version: GRID_CODEC_VERSION,
    name: manifest.name,
    width: manifest.width,
    height: manifest.height,
    boardSize: manifest.boardSize,
    brand: manifest.brand,
    settings: clonePatternSettings(manifest.settings),
    grid,
    palette: manifest.palette.map((color) => ({ ...color, rgb: [...color.rgb] as BeadColor['rgb'] })),
    createdAt: manifest.createdAt,
  };
  validateStoredProject(project);
  return project;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let output = '';
  for (const byte of bytes) output += String.fromCharCode(byte);
  return btoa(output);
}

export function base64ToBytes(value: string): Uint8Array {
  if (value.length === 0 || value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new PatternCodecError('Invalid base64 chunk payload');
  }
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}
