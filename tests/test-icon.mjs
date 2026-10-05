// T6.2：图标 PNG 产物校验（纯 PNG 解析，验证尺寸/格式/透明度/颜色语义）
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

function parsePng(file) {
  const buf = fs.readFileSync(file);
  if (buf[0] !== 0x89 || buf.slice(1, 4).toString() !== 'PNG') {
    throw new Error('not a PNG');
  }
  let off = 8;
  let ihdr = null;
  const idatChunks = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.slice(off + 4, off + 8).toString();
    const data = buf.slice(off + 8, off + 8 + len);
    if (type === 'IHDR') ihdr = data;
    if (type === 'IDAT') idatChunks.push(data);
    if (type === 'IEND') break;
    off += 12 + len;
  }
  if (!ihdr) throw new Error('missing IHDR');
  const w = ihdr.readUInt32BE(0);
  const h = ihdr.readUInt32BE(4);
  const bitDepth = ihdr[8];
  const colorType = ihdr[9];
  const compressed = Buffer.concat(idatChunks);
  const raw = zlib.inflateSync(compressed);
  const stride = w * 4;
  const rows = [];
  for (let y = 0; y < h; y++) {
    // filter byte 已去掉
    rows.push(raw.slice(1 + y * (stride + 1), 1 + y * (stride + 1) + stride));
  }
  return { w, h, bitDepth, colorType, raw: rows };
}

function rgba(rows, x, y) {
  const off = x * 4;
  const row = rows[y];
  return [row[off], row[off + 1], row[off + 2], row[off + 3]];
}

function checkIcon(t, file, size, label) {
  t.ok(fs.existsSync(file), `${label} 文件存在`);
  const p = parsePng(file);
  t.eq(p.w, size, `${label} 宽度 ${size}`);
  t.eq(p.h, size, `${label} 高度 ${size}`);
  t.eq(p.bitDepth, 8, `${label} 位深 8`);
  t.eq(p.colorType, 6, `${label} 颜色类型 RGBA`);
  t.eq(p.raw.length, size, `${label} 行数正确`);
  t.eq(p.raw[0].length, size * 4, `${label} 行字节数正确`);

  const c = size / 2;
  const corner = rgba(p.raw, 2, 2);
  const center = rgba(p.raw, c, c);
  t.ok(corner[3] < 20, `${label} 左上角圆角外透明 (a=${corner[3]})`);
  t.ok(center[3] > 200, `${label} 中心脸部不透明 (a=${center[3]})`);

  // 底部背景区偏蓝（B 明显 > R）
  const bg = rgba(p.raw, c, Math.floor(size * 0.92));
  t.ok(bg[3] > 200, `${label} 底部背景不透明`);
  t.ok(bg[2] > bg[0] + 20, `${label} 底部背景偏蓝 (b=${bg[2]}, r=${bg[0]})`);

  // 脸部区域偏暖（R > B）
  const face = rgba(p.raw, c, Math.floor(size * 0.6));
  t.ok(face[3] > 200, `${label} 脸部不透明`);
  t.ok(face[0] > face[2] + 15, `${label} 脸部肤色偏暖 (r=${face[0]}, b=${face[2]})`);

  // 头发顶部灰（R≈G≈B，且数值中等）
  const hair = rgba(p.raw, c, Math.floor(size * 0.22));
  t.ok(hair[3] > 200, `${label} 头发不透明`);
  const hairSpread = Math.max(hair[0], hair[1], hair[2]) - Math.min(hair[0], hair[1], hair[2]);
  t.ok(hairSpread < 25, `${label} 头发为灰色 (r=${hair[0]},g=${hair[1]},b=${hair[2]}, spread=${hairSpread})`);
}

export function run(t) {
  checkIcon(t, path.join(ROOT, 'build', 'icon.png'), 256, 'build/icon.png');
  checkIcon(t, path.join(ROOT, 'src', 'assets', 'icon-tray.png'), 32, 'src/assets/icon-tray.png');
}
