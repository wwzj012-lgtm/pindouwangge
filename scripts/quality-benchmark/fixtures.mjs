import sharp from 'sharp';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

export const sha = value => createHash('sha256').update(value).digest('hex');
export const json = value => JSON.stringify(value, null, 2) + '\n';

function painted(kind) {
  const width = 400, height = 400, data = Buffer.alloc(width * height * 4);
  const letters = ['11110/10001/10001/11110/10000/10000/10000', '01110/10001/10001/11111/10001/10001/10001', '11111/00100/00100/00100/00100/00100/00100'];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let rgba = [246, 244, 236, 255];
    if (kind === 'thin-text-contours') {
      const horizontal = [36, 66, 96].some((yy, i) => y >= yy && y < yy + i + 1 && x > 22 && x < 377);
      const diagonal = x > 20 && x < 380 && Math.abs(y - (110 + x * 0.27)) < 0.8;
      const ring = Math.abs(Math.hypot(x - 200, y - 300) - 69) < 1.5;
      const lx = Math.floor((x - 64) / 8), ly = Math.floor((y - 193) / 8);
      const glyph = letters[Math.floor(lx / 8)]?.split('/')[ly]?.[lx % 8] === '1';
      if (horizontal || diagonal || ring || glyph) rgba = [22, 24, 30, 255];
    } else if (kind === 'smooth-tones') {
      const a = x / 399, b = y / 399;
      rgba = [Math.round(25 + 205 * a), Math.round(35 + 170 * b), Math.round(65 + 140 * (a + b) / 2), 255];
      // Smooth synthetic control, explicitly not a photograph.
    } else if (kind === 'transparent-boundary') {
      const d = Math.hypot(x - 200, y - 200);
      const alpha = Math.round(255 * Math.max(0, Math.min(1, (154 - d) / 7)));
      rgba = [217, 73, 117, alpha];
      if (d < 146 && Math.abs(y - 200) < 2 && x > 95 && x < 305) rgba = [22, 24, 30, 255];
      // Deliberately nonzero hidden RGB; it must not bleed into empty cells.
      if (alpha === 0) rgba = [20, 240, 50, 0];
    } else if (kind === 'pixel-art') {
      const px = Math.floor(x / 20), py = Math.floor(y / 20);
      const colors = [[31, 34, 44], [241, 87, 110], [246, 199, 60], [55, 169, 171], [118, 87, 181]];
      if (px > 2 && px < 17 && py > 2 && py < 17) rgba = [...colors[(Math.floor(px / 3) + Math.floor(py / 3)) % colors.length], 255];
      if ((px === 6 || px === 13) && py === 7) rgba = [255, 255, 255, 255];
      if (py === 12 && px >= 7 && px <= 12) rgba = [21, 23, 29, 255];
    } else if (kind === 'multicolor-cartoon') {
      const colors = [[237, 77, 111], [251, 185, 59], [44, 162, 164], [116, 94, 176], [86, 161, 213], [237, 139, 74]];
      const d = Math.hypot(x - 200, y - 200);
      if (d < 152) rgba = [...colors[Math.min(5, Math.floor((Math.atan2(y - 200, x - 200) + Math.PI) / (2 * Math.PI) * 6))], 255];
      if (Math.abs(d - 152) < 3 || ([150, 250].some(cx => Math.hypot(x - cx, y - 165) < 10)) || (y > 236 && y < 240 && x > 145 && x < 255)) rgba = [24, 25, 31, 255];
      if (Math.hypot(x - 224, y - 270) < 5) rgba = [240, 230, 246, 255];
    }
    data.set(rgba, (y * width + x) * 4);
  }
  return { data, width, height };
}

export async function prepareFixtures(root, directory, external = {}) {
  await mkdir(directory, { recursive: true });
  const repo = [
    ...(external.cat ? [['user-cat', external.cat, 'user-authorized original pixel-art illustration; NOT a camera photo']] : []),
    ...(external.logo ? [['user-logo', external.logo, 'user-authorized original pale logo and Chinese text']] : []),
    ['cat', 'public/images/batiao-cat.webp', 'cartoon'],
    ['xiaoxin', 'public/images/boss-xiaoxin.jpg', 'cartoon'],
    ['spiderman', 'public/images/spiderman.webp', 'photo-like; camera provenance unverified'],
    ['anya', 'src/assets/images/sample_preset_anya_1786081021182.jpg', 'complex illustration'],
  ];
  const fixtures = [];
  for (const [id, file, category] of repo) {
    const original = await readFile(path.isAbsolute(file) ? file : path.join(root, file));
    const frozenName = id + path.extname(file);
    // Byte-for-byte copy: browser decoding and production Canvas 1200 path do all resizing.
    await writeFile(path.join(directory, frozenName), original);
    const meta = await sharp(original).metadata();
    fixtures.push({ id, file: frozenName, category, provenance: id.startsWith('user-') ? 'external:' + id : file, originalSha256: sha(original), fileSha256: sha(original), width: meta.width, height: meta.height });
  }
  for (const id of ['thin-text-contours', 'multicolor-cartoon', 'smooth-tones', 'transparent-boundary', 'pixel-art']) {
    const { data, width, height } = painted(id);
    const image = await sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();
    await writeFile(path.join(directory, id + '.png'), image);
    fixtures.push({ id, file: id + '.png', category: id === 'smooth-tones' ? 'synthetic gradient; NOT a photograph' : 'deterministic ' + id, provenance: 'fixtures.mjs deterministic integer geometry v1', fileSha256: sha(image), width, height });
  }
  return fixtures;
}
