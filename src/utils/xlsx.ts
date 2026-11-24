/**
 * 零依赖 XLSX 引擎（导入/导出 Excel 的底层，无第三方包）：
 * - 写：xlsx = ZIP 若干 XML。用「无压缩存储（stored）」条目 + CRC32 手工打包，
 *   Excel/WPS 均接受；避免引入 exceljs（7MB 依赖、本机 npm 源长期超时装不上）。
 * - 读：解析 Central Directory 取条目，method 0 原样取出、method 8 用浏览器
 *   原生 DecompressionStream('deflate-raw') 解压（Chrome/Edge 103+），
 *   再用 DOMParser 解 worksheet XML（兼容 sharedStrings / inlineStr / 数字）。
 * 序列化规范：位图/二进制一律普通数组与 Uint8Array 内存内转换，不过 JSON。
 */

// ---------- CRC32 ----------
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
const crc32 = (data: Uint8Array): number => {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i += 1) crc = CRC_TABLE[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// ---------- ZIP 写（stored 无压缩） ----------
export function zipStore(files: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  const chunks: Uint8Array[] = [];
  const central: Array<{ name: string; crc: number; size: number; offset: number }> = [];
  let offset = 0;
  const push = (bytes: Uint8Array) => { chunks.push(bytes); offset += bytes.length; };
  const u16 = (value: number) => new Uint8Array([value & 0xFF, (value >> 8) & 0xFF]);
  const u32 = (value: number) => new Uint8Array([value & 0xFF, (value >> 8) & 0xFF, (value >> 16) & 0xFF, (value >>> 24) & 0xFF]);
  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const crc = crc32(file.data);
    const size = file.data.length;
    central.push({ name: file.name, crc, size, offset });
    push(u32(0x04034b50)); push(u16(20)); push(u16(0)); push(u16(0)); push(u16(0)); push(u16(0x2821));
    push(u32(crc)); push(u32(size)); push(u32(size));
    push(u16(nameBytes.length)); push(u16(0));
    push(nameBytes);
    push(file.data);
  }
  const centralStart = offset;
  for (const entry of central) {
    const nameBytes = encoder.encode(entry.name);
    push(u32(0x02014b50)); push(u16(20)); push(u16(20)); push(u16(0)); push(u16(0)); push(u16(0)); push(u16(0x2821));
    push(u32(entry.crc)); push(u32(entry.size)); push(u32(entry.size));
    push(u16(nameBytes.length)); push(u16(0)); push(u16(0)); push(u16(0)); push(u16(0)); push(u32(0)); push(u32(entry.offset));
    push(nameBytes);
  }
  const centralSize = offset - centralStart;
  push(u32(0x06054b50)); push(u16(0)); push(u16(0));
  push(u16(central.length)); push(u16(central.length));
  push(u32(centralSize)); push(u32(centralStart)); push(u16(0));
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let position = 0;
  for (const chunk of chunks) { out.set(chunk, position); position += chunk.length; }
  return out;
}

// ---------- ZIP 读 ----------
export async function unzip(data: Uint8Array): Promise<Map<string, Uint8Array>> {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  // 从尾部找 EOCD（0x06054b50）
  let eocd = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 22 - 65536); i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是有效的 xlsx/zip 文件');
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const entries = new Map<string, Uint8Array>();
  for (let i = 0; i < count; i += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) break;
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(data.subarray(offset + 46, offset + 46 + nameLength));
    // 本地头里再跳一次文件名/额外字段，取数据区
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = data.subarray(dataStart, dataStart + compressedSize);
    if (method === 0) entries.set(name, raw);
    else if (method === 8) entries.set(name, await inflateRaw(raw));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const Ctor = (globalThis as unknown as { DecompressionStream?: new (format: string) => ReadableStream }).DecompressionStream;
  if (!Ctor) throw new Error('当前浏览器不支持 DecompressionStream，无法读取该 Excel 文件');
  const stream = new Ctor('deflate-raw');
  const source = new Response(new Blob([data as BlobPart]).stream()).body!;
  const decompressed = await new Response(source.pipeThrough(stream as unknown as ReadableWritablePair<Uint8Array, Uint8Array>)).arrayBuffer();
  return new Uint8Array(decompressed);
}

// ---------- XML 工具 ----------
const escapeXml = (value: string) => value.replace(/[&<>"']/g, ch => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
})[ch] ?? ch);
const columnLetter = (index: number) => {
  let letters = '';
  let n = index;
  while (n >= 0) { letters = String.fromCharCode(65 + (n % 26)) + letters; n = Math.floor(n / 26) - 1; }
  return letters;
};

export type XlsxCell = { value: string | number; style?: number } | null;

/** 生成 worksheet XML：r 位移 1-based；value 字符串走 inlineStr，数字裸写。 */
function sheetXml(rows: XlsxCell[][], columnWidths?: number[]): string {
  const rowsXml = rows.map((cells, rowIndex) => {
    const cellsXml = cells.map((cell, columnIndex) => {
      if (!cell) return '';
      const ref = `${columnLetter(columnIndex)}${rowIndex + 1}`;
      const s = cell.style ? ` s="${cell.style}"` : '';
      if (typeof cell.value === 'number') return `<c r="${ref}"${s}><v>${cell.value}</v></c>`;
      return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${escapeXml(cell.value)}</t></is></c>`;
    }).join('');
    return `<row r="${rowIndex + 1}">${cellsXml}</row>`;
  }).join('');
  const cols = columnWidths?.length
    ? `<cols>${columnWidths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join('')}</cols>`
    : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${cols}<sheetData>${rowsXml}</sheetData></worksheet>`;
}

/** styles.xml：fonts[0 普通,1 粗黑,2 粗白] + fills[0 none,1 gray125, 2.. 自定义色] + 边框 + cellXfs。 */
function stylesXml(fills: string[]): string {
  const fillsXml = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>']
    .concat(fills.map(hex => `<fill><patternFill patternType="solid"><fgColor rgb="FF${hex}"/><bgColor indexed="64"/></patternFill></fill>`)).join('');
  const xfs = [
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>',
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>',
  ];
  for (let fillIndex = 2; fillIndex < fills.length + 2; fillIndex += 1) {
    xfs.push(`<xf numFmtId="0" fontId="1" fillId="${fillIndex}" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>`);
    xfs.push(`<xf numFmtId="0" fontId="2" fillId="${fillIndex}" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>`);
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FF1A1A1A"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>
<fills count="${fills.length + 2}">${fillsXml}</fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFB7B7B7"/></left><right style="thin"><color rgb="FFB7B7B7"/></right><top style="thin"><color rgb="FFB7B7B7"/></top><bottom style="thin"><color rgb="FFB7B7B7"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs>
</styleSheet>`;
}

function workbookXml(sheetNames: string[]): string {
  const sheets = sheetNames.map((name, index) =>
    `<sheet name="${escapeXml(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets}</sheets></workbook>`;
}

const workbookRelsXml = (sheetCount: number) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${Array.from({ length: sheetCount }, (_v, index) =>
  `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')}<Relationship Id="rId${sheetCount + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

const contentTypesXml = (sheetCount: number) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${Array.from({ length: sheetCount }, (_v, index) =>
  `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;

/** 打包 xlsx：sheets = [{ name, rows, columnWidths? }]；fills 供样式表注册填充色。 */
export function buildXlsx(sheets: Array<{ name: string; rows: XlsxCell[][]; columnWidths?: number[] }>, fills: string[] = []): Uint8Array {
  const files = [
    { name: '[Content_Types].xml', data: encoder.encode(contentTypesXml(sheets.length)) },
    { name: '_rels/.rels', data: encoder.encode(rootRelsXml) },
    { name: 'xl/workbook.xml', data: encoder.encode(workbookXml(sheets.map(sheet => sheet.name))) },
    { name: 'xl/_rels/workbook.xml.rels', data: encoder.encode(workbookRelsXml(sheets.length)) },
    { name: 'xl/styles.xml', data: encoder.encode(stylesXml(fills)) },
    ...sheets.map((sheet, index) => ({ name: `xl/worksheets/sheet${index + 1}.xml`, data: encoder.encode(sheetXml(sheet.rows, sheet.columnWidths)) })),
  ];
  return zipStore(files);
}

export function downloadXlsx(data: Uint8Array, filename: string): void {
  const blob = new Blob([data as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

// ---------- 读（解析第一个工作表为二维字符串/数字数组） ----------
const columnIndexOf = (ref: string) => {
  let index = -1;
  for (const ch of ref) {
    if (ch >= 'A' && ch <= 'Z') index = (index + 1) * 26 + (ch.charCodeAt(0) - 65);
    else break;
  }
  return index;
};

/** 解析 xlsx：返回第一个工作表的行网格（数字/字符串），单元格空缺为 ''。 */
export async function parseXlsx(data: Uint8Array): Promise<Array<Array<string | number>>> {
  const entries = await unzip(data);
  const workbook = decoder.decode(entries.get('xl/workbook.xml') ?? new Uint8Array());
  const firstName = /<sheet[^>]*name="([^"]*)"/.exec(workbook)?.[1] ?? 'sheet1';
  const sheetKey = entries.get(`xl/worksheets/sheet1.xml`) ? 'xl/worksheets/sheet1.xml'
    : [...entries.keys()].find(key => key.includes('worksheets/') && key.endsWith('.xml'));
  if (!sheetKey) throw new Error('xlsx 里没有工作表');
  const doc = new DOMParser().parseFromString(decoder.decode(entries.get(sheetKey)!), 'application/xml');
  const sharedRaw = entries.get('xl/sharedStrings.xml');
  const shared: string[] = [];
  if (sharedRaw) {
    const sharedDoc = new DOMParser().parseFromString(decoder.decode(sharedRaw), 'application/xml');
    for (const item of sharedDoc.getElementsByTagName('si')) {
      shared.push(Array.from(item.getElementsByTagName('t')).map(t => t.textContent ?? '').join(''));
    }
  }
  const grid: Array<Array<string | number>> = [];
  for (const row of doc.getElementsByTagName('row')) {
    const rowIndex = Number(row.getAttribute('r') ?? grid.length + 1) - 1;
    while (grid.length <= rowIndex) grid.push([]);
    for (const cell of row.getElementsByTagName('c')) {
      const ref = cell.getAttribute('r') ?? '';
      const columnIndex = columnIndexOf(ref);
      const type = cell.getAttribute('t');
      let value: string | number = '';
      if (type === 'inlineStr') value = Array.from(cell.getElementsByTagName('t')).map(t => t.textContent ?? '').join('');
      else {
        const raw = cell.getElementsByTagName('v')[0]?.textContent ?? '';
        value = type === 's' ? shared[Number(raw)] ?? '' : raw;
      }
      const numeric = typeof value === 'string' && value !== '' && /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value;
      while (grid[rowIndex].length <= columnIndex) grid[rowIndex].push('');
      grid[rowIndex][columnIndex] = numeric;
    }
  }
  void firstName;
  return grid;
}
