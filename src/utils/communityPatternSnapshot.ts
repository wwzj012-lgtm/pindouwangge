import {
  base64ToBytes, bytesToBase64, decodePatternProject, encodePatternProject,
  validateStoredProject, type StoredPatternManifest, type StoredPatternProject,
} from './patternGridCodec';

// A private, ancillary PNG chunk travels with the published image. The immutable
// public snapshot contains only grid data, never private work IDs or entitlements.
const CHUNK_TYPE = 'bpGd';
const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_SNAPSHOT_BYTES = 4 * 1024 * 1024;
const encoder = new TextEncoder();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunks(bytes: Uint8Array): { type: string; start: number; end: number; data: Uint8Array; crc: number }[] | null {
  if (bytes.length > MAX_FILE_BYTES) throw new Error('社区图片超过大小限制');
  if (!SIGNATURE.every((value, index) => bytes[index] === value)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks = [];
  let offset = 8;
  while (offset < bytes.length) {
    if (chunks.length >= 4096) throw new Error('社区图纸 PNG 分块数量超过限制');
    if (offset + 12 > bytes.length) throw new Error('社区图纸 PNG 数据不完整');
    const length = view.getUint32(offset);
    const end = offset + 12 + length;
    if (end > bytes.length) throw new Error('社区图纸 PNG 数据不完整');
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    chunks.push({ type, start: offset, end, data: bytes.subarray(offset + 8, end - 4), crc: view.getUint32(end - 4) });
    offset = end;
    if (type === 'IEND') {
      if (length !== 0 || end !== bytes.length || chunks[0]?.type !== 'IHDR') throw new Error('社区图纸 PNG 结构无效');
      return chunks;
    }
  }
  throw new Error('社区图纸 PNG 缺少结束标记');
}

export async function embedCommunitySnapshot(png: Blob, project: StoredPatternProject): Promise<Blob> {
  const bytes = new Uint8Array(await png.arrayBuffer());
  const chunks = pngChunks(bytes);
  if (!chunks || chunks.some((chunk) => chunk.type === CHUNK_TYPE)) throw new Error('发布图纸必须使用新的 PNG 原图');
  const encoded = await encodePatternProject(project);
  const data = encoder.encode(JSON.stringify({ version: 1, manifest: encoded.manifest, payloads: encoded.chunks.map((chunk) => bytesToBase64(chunk.payload)) }));
  if (data.length > MAX_SNAPSHOT_BYTES) throw new Error('图纸快照超过大小限制');
  const chunk = new Uint8Array(data.length + 12);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set(encoder.encode(CHUNK_TYPE), 4);
  chunk.set(data, 8);
  view.setUint32(chunk.length - 4, crc32(chunk.subarray(4, chunk.length - 4)));
  const end = chunks[chunks.length - 1]!.start;
  const output = new Blob([bytes.slice(0, end), chunk, bytes.slice(end)], { type: 'image/png' });
  if (output.size > MAX_FILE_BYTES) throw new Error('发布图纸超过 15 MiB 大小限制');
  return output;
}

export function communityDraft(project: StoredPatternProject, workId: string): StoredPatternProject & { workId: string } {
  return {
    version: project.version, name: project.name, width: project.width, height: project.height,
    boardSize: project.boardSize, brand: project.brand, settings: { ...project.settings },
    grid: project.grid.map((row) => [...row]),
    palette: project.palette.map((color) => ({ ...color, rgb: [...color.rgb] })),
    createdAt: project.createdAt, workId,
  };
}

export async function readCommunitySnapshot(blob: Blob): Promise<StoredPatternProject | null> {
  if (blob.size > MAX_FILE_BYTES) throw new Error('社区图片超过大小限制');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunks = pngChunks(bytes);
  const snapshots = chunks?.filter((chunk) => chunk.type === CHUNK_TYPE) ?? [];
  if (!snapshots.length) return null; // Old photo posts remain viewable.
  if (snapshots.length !== 1) throw new Error('社区图纸包含重复快照');
  const snapshot = snapshots[0]!;
  if (snapshot.data.length > MAX_SNAPSHOT_BYTES || crc32(bytes.subarray(snapshot.start + 4, snapshot.end - 4)) !== snapshot.crc) {
    throw new Error('社区图纸快照校验失败，请重新加载');
  }
  const envelope = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(snapshot.data)) as {
    version: number; manifest: StoredPatternManifest; payloads: string[];
  };
  const manifest = envelope.manifest;
  if (envelope.version !== 1 || !manifest || !Array.isArray(manifest.chunks) || manifest.chunks.length > 64
    || !Array.isArray(envelope.payloads) || envelope.payloads.length !== manifest.chunks.length) throw new Error('社区图纸快照格式无效');
  // Validate chunk placement before passing public data to the generic codec.
  const columns = Math.ceil(manifest.width / 128);
  manifest.chunks.forEach((chunk, index) => {
    const x = (index % columns) * 128;
    const y = Math.floor(index / columns) * 128;
    if (chunk.index !== index || chunk.x !== x || chunk.y !== y || chunk.width !== Math.min(128, manifest.width - x)
      || chunk.height !== Math.min(128, manifest.height - y) || typeof envelope.payloads[index] !== 'string'
      || envelope.payloads[index]!.length > 50000) throw new Error('社区图纸网格分块无效');
  });
  const project = await decodePatternProject(manifest, manifest.chunks.map((descriptor, index) => ({
    ...descriptor, payload: base64ToBytes(envelope.payloads[index]!),
  })));
  if (typeof project.name !== 'string' || project.name.length > 200 || !Number.isFinite(project.createdAt)
    || project.palette.some((color) => typeof color.code !== 'string' || typeof color.name !== 'string'
      || !/^#[0-9a-f]{6}$/i.test(color.hex) || !Array.isArray(color.rgb) || color.rgb.length !== 3
      || color.rgb.some((value) => !Number.isInteger(value) || value < 0 || value > 255))) throw new Error('社区图纸色板数据无效');
  return project;
}

/** Gallery thumbnails are deliberately small/lossy; publishing must never use them. */
export async function renderCommunityPattern(project: StoredPatternProject): Promise<Blob> {
  // Encode/validate before touching the canvas, and retain every original cell.
  validateStoredProject(project);
  const canvas = document.createElement('canvas');
  const scale = Math.max(1, Math.floor(900 / Math.max(project.width, project.height)));
  canvas.width = project.width * scale;
  canvas.height = project.height * scale;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法创建社区图纸预览');
  const colors = new Map(project.palette.map((color) => [color.id, color.hex]));
  for (let y = 0; y < project.height; y++) {
    for (let x = 0; x < project.width; x++) {
      const id = project.grid[y]![x];
      if (id === null) continue;
      const color = colors.get(id!);
      if (!color || !/^#[0-9a-f]{6}$/i.test(color)) throw new Error('图纸引用了无效色号');
      context.fillStyle = color;
      context.fillRect(x * scale, y * scale, scale, scale);
    }
  }
  const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('图纸 PNG 生成失败')), 'image/png'));
  return embedCommunitySnapshot(png, project);
}
