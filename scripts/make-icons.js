// Gera o ícone da menu bar (forma de onda) como "template image" do macOS:
// preto com transparência, que o sistema pinta de claro/escuro sozinho.
// Uso: node scripts/make-icons.js  ->  src/assets/trayTemplate.png (+ @2x)

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const SIZE = 18; // pontos da menu bar
const BAR_WIDTH = 2.2;
const GAP = 1.5;
const HEIGHTS = [5, 9.5, 14, 9.5, 5];

// Barras em formato de cápsula, centralizadas no ícone.
function insideShape(x, y) {
  const total = HEIGHTS.length * BAR_WIDTH + (HEIGHTS.length - 1) * GAP;
  let left = (SIZE - total) / 2;
  for (const height of HEIGHTS) {
    const r = BAR_WIDTH / 2;
    const cx = left + r;
    const top = SIZE / 2 - height / 2 + r;
    const bottom = SIZE / 2 + height / 2 - r;
    const cy = Math.min(Math.max(y, top), bottom);
    if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) return true;
    left += BAR_WIDTH + GAP;
  }
  return false;
}

function render(scale) {
  const px = SIZE * scale;
  const samples = 6; // supersampling para bordas suaves
  const rgba = Buffer.alloc(px * px * 4);
  for (let py = 0; py < px; py++) {
    for (let pxX = 0; pxX < px; pxX++) {
      let hits = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const x = (pxX + (sx + 0.5) / samples) / scale;
          const y = (py + (sy + 0.5) / samples) / scale;
          if (insideShape(x, y)) hits++;
        }
      }
      rgba[(py * px + pxX) * 4 + 3] = Math.round((hits / samples ** 2) * 255);
    }
  }
  return encodePng(px, px, rgba);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bits por canal
  header[9] = 6; // RGBA
  const rows = [];
  for (let y = 0; y < height; y++) {
    rows.push(Buffer.from([0]), rgba.subarray(y * width * 4, (y + 1) * width * 4));
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const out = path.join(__dirname, '..', 'src', 'assets');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'trayTemplate.png'), render(1));
fs.writeFileSync(path.join(out, 'trayTemplate@2x.png'), render(2));
console.log(`ícones gerados em ${out}`);
