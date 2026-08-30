import type { AssemblyPreprocessingSettings } from './assemblyProject';

export const MAX_ASSEMBLY_IMAGE_FILE_BYTES = 15 * 1024 * 1024;
export const MAX_ASSEMBLY_IMAGE_PIXELS = 24_000_000;
export const MAX_ASSEMBLY_MODEL_FILE_BYTES = 50 * 1024 * 1024;
const MODEL_EXTENSIONS = ['.glb', '.gltf', '.obj', '.fbx', '.blend', '.stl'];

/** A deliberately small mesh representation used by the assembly page. */
export interface AssemblyMesh {
  vertices: Array<[number, number, number]>;
  triangles: Array<[number, number, number]>;
}

export interface AssemblyModelViews {
  front: string[][];
  side: string[][];
  back: string[][];
  top: string[][];
  vertexCount: number;
  triangleCount: number;
  format: 'obj' | 'stl' | 'glb' | 'gltf';
}

const MAX_MODEL_VERTICES = 300_000;
const MAX_MODEL_TRIANGLES = 300_000;

function extensionOf(name: string): string {
  const lower = name.toLowerCase();
  const index = lower.lastIndexOf('.');
  return index >= 0 ? lower.slice(index) : '';
}

function ensureMesh(mesh: AssemblyMesh): AssemblyMesh {
  if (!mesh.vertices.length) throw new Error('3D 模型中没有可用顶点');
  if (mesh.vertices.length > MAX_MODEL_VERTICES) mesh.vertices = mesh.vertices.slice(0, MAX_MODEL_VERTICES);
  mesh.triangles = mesh.triangles.filter(([a, b, c]) => a >= 0 && b >= 0 && c >= 0 && a < mesh.vertices.length && b < mesh.vertices.length && c < mesh.vertices.length);
  if (mesh.triangles.length > MAX_MODEL_TRIANGLES) mesh.triangles = mesh.triangles.slice(0, MAX_MODEL_TRIANGLES);
  if (!mesh.triangles.length && mesh.vertices.length < 3) throw new Error('3D 模型中没有可用三角面');
  return mesh;
}

/** Parse the common text OBJ subset (v and f records, including negative indices). */
export function parseObjText(text: string): AssemblyMesh {
  const vertices: Array<[number, number, number]> = [];
  const triangles: Array<[number, number, number]> = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    if (parts[0] === 'v' && parts.length >= 4) {
      const xyz = parts.slice(1, 4).map(Number);
      if (xyz.every(Number.isFinite)) vertices.push([xyz[0], xyz[1], xyz[2]]);
      continue;
    }
    if (parts[0] !== 'f' || parts.length < 4) continue;
    const indices = parts.slice(1).map(token => {
      const rawIndex = Number.parseInt(token.split('/')[0], 10);
      if (!Number.isFinite(rawIndex) || rawIndex === 0) return -1;
      return rawIndex > 0 ? rawIndex - 1 : vertices.length + rawIndex;
    }).filter(index => index >= 0);
    for (let index = 1; index + 1 < indices.length; index += 1) triangles.push([indices[0], indices[index], indices[index + 1]]);
  }
  return ensureMesh({ vertices, triangles });
}

function readFloat(view: DataView, offset: number): number { return view.getFloat32(offset, true); }

/** Parse both ASCII and binary STL. */
export function parseStlBuffer(buffer: ArrayBuffer): AssemblyMesh {
  const bytes = new Uint8Array(buffer);
  const header = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 256)));
  const looksBinary = bytes.length >= 84;
  const declared = looksBinary ? new DataView(buffer).getUint32(80, true) : 0;
  if (looksBinary && declared > 0 && 84 + declared * 50 <= bytes.length) {
    const view = new DataView(buffer); const vertices: Array<[number, number, number]> = []; const triangles: Array<[number, number, number]> = [];
    for (let i = 0; i < declared; i += 1) {
      const base = 84 + i * 50; const start = vertices.length;
      for (let j = 0; j < 3; j += 1) { const offset = base + 12 + j * 12; vertices.push([readFloat(view, offset), readFloat(view, offset + 4), readFloat(view, offset + 8)]); }
      triangles.push([start, start + 1, start + 2]);
      if (vertices.length >= MAX_MODEL_VERTICES || triangles.length >= MAX_MODEL_TRIANGLES) break;
    }
    return ensureMesh({ vertices, triangles });
  }
  const text = new TextDecoder().decode(bytes);
  if (!/\bvertex\s+/i.test(text) && !/^solid\b/i.test(header.trim())) throw new Error('STL 文件格式无法识别');
  const vertices: Array<[number, number, number]> = []; const triangles: Array<[number, number, number]> = [];
  const regex = /vertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)/gi; let match: RegExpExecArray | null;
  while ((match = regex.exec(text))) {
    const point = match.slice(1, 4).map(Number);
    if (point.every(Number.isFinite)) vertices.push([point[0], point[1], point[2]]);
    if (vertices.length % 3 === 0) triangles.push([vertices.length - 3, vertices.length - 2, vertices.length - 1]);
    if (vertices.length >= MAX_MODEL_VERTICES || triangles.length >= MAX_MODEL_TRIANGLES) break;
  }
  return ensureMesh({ vertices, triangles });
}

function parseGlb(buffer: ArrayBuffer): { json: Record<string, unknown>; binary: ArrayBuffer | null } {
  const view = new DataView(buffer);
  if (view.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67) throw new Error('GLB 文件头无效');
  let offset = 12; let json: Record<string, unknown> | null = null; let binary: ArrayBuffer | null = null;
  while (offset + 8 <= view.byteLength) {
    const length = view.getUint32(offset, true); const type = view.getUint32(offset + 4, true); const start = offset + 8; const end = start + length;
    if (end > view.byteLength) throw new Error('GLB 数据块长度无效');
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, start, length)).replace(/\0+$/g, '')) as Record<string, unknown>;
    else if (type === 0x004e4942) binary = buffer.slice(start, end);
    offset = end;
  }
  if (!json) throw new Error('GLB 缺少 JSON 数据块');
  return { json, binary };
}

function decodeDataUri(uri: string): ArrayBuffer {
  const comma = uri.indexOf(','); if (comma < 0) throw new Error('GLTF 内嵌缓冲区无效');
  const payload = uri.slice(comma + 1); const binary = uri.slice(0, comma).includes(';base64');
  if (binary) { const value = typeof atob === 'function' ? atob(payload) : Buffer.from(payload, 'base64').toString('binary'); const bytes = new Uint8Array(value.length); for (let i = 0; i < value.length; i += 1) bytes[i] = value.charCodeAt(i); return bytes.buffer; }
  return new TextEncoder().encode(decodeURIComponent(payload)).buffer;
}

function parseGltfJson(json: Record<string, unknown>, binary: ArrayBuffer | null): AssemblyMesh {
  const buffers = (json.buffers as Array<{ uri?: string; byteOffset?: number; byteLength?: number }> | undefined) ?? [];
  const bufferViews = (json.bufferViews as Array<{ buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }> | undefined) ?? [];
  const accessors = (json.accessors as Array<{ bufferView?: number; byteOffset?: number; componentType: number; count: number; type: string; min?: number[]; max?: number[] }> | undefined) ?? [];
  const resolveBuffer = (index: number): ArrayBuffer => {
    if (index === 0 && binary) return binary;
    const uri = buffers[index]?.uri;
    if (uri?.startsWith('data:')) return decodeDataUri(uri);
    throw new Error('GLTF 使用外部缓冲区；请上传自包含 GLB 或内嵌数据的 GLTF');
  };
  const readAccessor = (accessorIndex: number): number[] => {
    const accessor = accessors[accessorIndex]; if (!accessor || accessor.bufferView === undefined) throw new Error('GLTF accessor 不完整');
    const viewDef = bufferViews[accessor.bufferView]; const source = resolveBuffer(viewDef.buffer); const componentSize = accessor.componentType === 5126 ? 4 : accessor.componentType === 5125 ? 4 : accessor.componentType === 5123 ? 2 : 1;
    const componentCount = accessor.type === 'VEC3' ? 3 : accessor.type === 'VEC2' ? 2 : accessor.type === 'SCALAR' ? 1 : 4;
    const stride = viewDef.byteStride ?? componentSize * componentCount; const base = (viewDef.byteOffset ?? 0) + (accessor.byteOffset ?? 0); const result: number[] = [];
    const data = new DataView(source);
    for (let i = 0; i < accessor.count; i += 1) for (let j = 0; j < componentCount; j += 1) { const at = base + i * stride + j * componentSize; result.push(accessor.componentType === 5126 ? data.getFloat32(at, true) : accessor.componentType === 5125 ? data.getUint32(at, true) : accessor.componentType === 5123 ? data.getUint16(at, true) : data.getUint8(at)); }
    return result;
  };
  const vertices: Array<[number, number, number]> = []; const triangles: Array<[number, number, number]> = [];
  const meshes = (json.meshes as Array<{ primitives?: Array<{ attributes?: Record<string, number>; indices?: number }> }> | undefined) ?? [];
  for (const mesh of meshes) for (const primitive of mesh.primitives ?? []) {
    const positionAccessor = primitive.attributes?.POSITION; if (positionAccessor === undefined) continue;
    const positions = readAccessor(positionAccessor); const start = vertices.length;
    for (let i = 0; i + 2 < positions.length; i += 3) vertices.push([positions[i], positions[i + 1], positions[i + 2]]);
    const indices = primitive.indices === undefined ? Array.from({ length: positions.length / 3 }, (_, i) => i) : readAccessor(primitive.indices);
    for (let i = 0; i + 2 < indices.length; i += 3) triangles.push([start + indices[i], start + indices[i + 1], start + indices[i + 2]]);
  }
  return ensureMesh({ vertices, triangles });
}

async function parseModelFile(file: Blob & { name?: string }): Promise<{ mesh: AssemblyMesh; format: AssemblyModelViews['format'] }> {
  const ext = extensionOf(file.name ?? '');
  if (ext === '.fbx' || ext === '.blend') throw new Error(`当前暂不支持 ${ext.slice(1).toUpperCase()} 解析；请转换为 OBJ、GLB 或 STL 后再上传。`);
  if (ext === '.obj') return { mesh: parseObjText(await file.text()), format: 'obj' };
  if (ext === '.stl') return { mesh: parseStlBuffer(await file.arrayBuffer()), format: 'stl' };
  if (ext === '.glb') { const parsed = parseGlb(await file.arrayBuffer()); return { mesh: parseGltfJson(parsed.json, parsed.binary), format: 'glb' }; }
  if (ext === '.gltf') { const json = JSON.parse(await file.text()) as Record<string, unknown>; return { mesh: parseGltfJson(json, null), format: 'gltf' }; }
  throw new Error('不支持的 3D 模型格式');
}

function triangleContains(px: number, py: number, a: [number, number], b: [number, number], c: [number, number]): boolean {
  const v0x = c[0] - a[0]; const v0y = c[1] - a[1]; const v1x = b[0] - a[0]; const v1y = b[1] - a[1]; const v2x = px - a[0]; const v2y = py - a[1]; const den = v0x * v1y - v1x * v0y;
  if (Math.abs(den) < 1e-8) return false; const u = (v2x * v1y - v1x * v2y) / den; const v = (v0x * v2y - v2x * v0y) / den; return u >= -1e-6 && v >= -1e-6 && u + v <= 1.000001;
}

function projectMesh(mesh: AssemblyMesh, width: number, height: number, colorId: string, axes: [0 | 1 | 2, 0 | 1 | 2], mirror = false): string[][] {
  const grid = Array.from({ length: height }, () => Array<string>(width).fill(''));
  const mins = [Infinity, Infinity, Infinity]; const maxs = [-Infinity, -Infinity, -Infinity];
  for (const point of mesh.vertices) for (let axis = 0; axis < 3; axis += 1) { mins[axis] = Math.min(mins[axis], point[axis]); maxs[axis] = Math.max(maxs[axis], point[axis]); }
  const span = axes.map(axis => Math.max(1e-6, maxs[axis] - mins[axis]));
  const mapPoint = (point: [number, number, number]): [number, number] => { const nx = (point[axes[0]] - mins[axes[0]]) / span[0]; const ny = (point[axes[1]] - mins[axes[1]]) / span[1]; return [mirror ? 1 - nx : nx, 1 - ny]; };
  const set = (x: number, y: number) => { if (x >= 0 && x < width && y >= 0 && y < height) grid[y][x] = colorId; };
  const toCell = (point: [number, number]): [number, number] => [Math.round(point[0] * (width - 1)), Math.round(point[1] * (height - 1))];
  const rasterTriangle = (a: [number, number], b: [number, number], c: [number, number]) => {
    const points = [a, b, c].map(toCell); const left = Math.max(0, Math.min(...points.map(point => point[0]))); const right = Math.min(width - 1, Math.max(...points.map(point => point[0]))); const top = Math.max(0, Math.min(...points.map(point => point[1]))); const bottom = Math.min(height - 1, Math.max(...points.map(point => point[1])));
    for (let y = top; y <= bottom; y += 1) for (let x = left; x <= right; x += 1) if (triangleContains(x / Math.max(1, width - 1), y / Math.max(1, height - 1), a, b, c)) set(x, y);
  };
  if (mesh.triangles.length) for (const [ia, ib, ic] of mesh.triangles) rasterTriangle(mapPoint(mesh.vertices[ia]), mapPoint(mesh.vertices[ib]), mapPoint(mesh.vertices[ic]));
  else for (const point of mesh.vertices) { const [x, y] = toCell(mapPoint(point)); set(x, y); }
  return grid;
}

/** Parse a supported model and produce four filled orthographic bead masks. */
export async function modelFileToAssemblyViews(file: Blob & { name?: string }, width: number, height: number, colorId: string): Promise<AssemblyModelViews> {
  const { mesh, format } = await parseModelFile(file); return {
    front: projectMesh(mesh, width, height, colorId, [0, 1]),
    side: projectMesh(mesh, width, height, colorId, [2, 1]),
    back: projectMesh(mesh, width, height, colorId, [0, 1], true),
    top: projectMesh(mesh, width, height, colorId, [0, 2]),
    vertexCount: mesh.vertices.length, triangleCount: mesh.triangles.length, format,
  };
}

type FileMetadata = Pick<File, 'name' | 'type' | 'size'>;

export function validateAssemblyImageFile(file: FileMetadata): string | null {
  if (!file.type.startsWith('image/')) return '请选择图片文件';
  if (file.size > MAX_ASSEMBLY_IMAGE_FILE_BYTES) return '图片不能超过 15 MB';
  return null;
}

export function validateAssemblyModelFile(file: FileMetadata): string | null {
  if (file.size > MAX_ASSEMBLY_MODEL_FILE_BYTES) return '3D 模型不能超过 50 MB';
  const ext = extensionOf(file.name);
  if (ext === '.fbx' || ext === '.blend') return `当前暂不支持 ${ext.slice(1).toUpperCase()} 解析；请转换为 OBJ、GLB 或 STL 后再上传`;
  if (!MODEL_EXTENSIONS.some(extension => file.name.toLowerCase().endsWith(extension))) return '仅支持 GLB、GLTF、OBJ、FBX 或 STL 模型';
  return null;
}

export function isLatestAssemblyGeneration(requestId: number, latestRequestId: number): boolean { return requestId === latestRequestId; }

export function mapAssemblyPreprocessing(preprocessing: AssemblyPreprocessingSettings): { keepAspectRatio: false; colorLimit: number; chromaKeyColor: string | null; chromaKeyTolerance: number; quantizationStrength: number } {
  return {
    keepAspectRatio: false,
    colorLimit: preprocessing.colorLimit,
    chromaKeyColor: preprocessing.removeWhiteBackground ? '#FFFFFF' : null,
    chromaKeyTolerance: preprocessing.backgroundTolerance,
    quantizationStrength: preprocessing.quantizationStrength,
  };
}
