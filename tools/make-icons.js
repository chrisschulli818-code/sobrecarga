// Gera os ícones do app (PNG) sem dependências: verde com um halter branco.
// Uso: node tools/make-icons.js   (saída em ./icons/)
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

const BG = [0x3b, 0x70, 0x3d];
const FG = [0xff, 0xff, 0xff];

// Retângulos do halter em coordenadas 0..1 (bem dentro da zona segura de ícone "maskable").
const RECTS = [
  { x0: 0.18, x1: 0.82, y0: 0.475, y1: 0.525, r: 0.01 }, // barra
  { x0: 0.27, x1: 0.33, y0: 0.32, y1: 0.68, r: 0.02 },   // anilha interna esq.
  { x0: 0.67, x1: 0.73, y0: 0.32, y1: 0.68, r: 0.02 },   // anilha interna dir.
  { x0: 0.20, x1: 0.25, y0: 0.38, y1: 0.62, r: 0.02 },   // anilha externa esq.
  { x0: 0.75, x1: 0.80, y0: 0.38, y1: 0.62, r: 0.02 }    // anilha externa dir.
];

function inRoundRect(px, py, { x0, x1, y0, y1, r }) {
  if (px < x0 || px > x1 || py < y0 || py > y1) return false;
  const cx = Math.min(Math.max(px, x0 + r), x1 - r);
  const cy = Math.min(Math.max(py, y0 + r), y1 - r);
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
}

function render(size) {
  const SS = 3; // supersampling pra bordas suaves
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0; // filtro "none"
    for (let x = 0; x < size; x++) {
      let hits = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const px = (x + (sx + 0.5) / SS) / size;
        const py = (y + (sy + 0.5) / SS) / size;
        if (RECTS.some(r => inRoundRect(px, py, r))) hits++;
      }
      const a = hits / (SS * SS);
      const o = y * (size * 3 + 1) + 1 + x * 3;
      for (let c = 0; c < 3; c++) raw[o + c] = Math.round(BG[c] * (1 - a) + FG[c] * a);
    }
  }
  return raw;
}

const crcTable = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
function crc32(buf) { let c = -1; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8 bits, RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(render(size), { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const out = path.join(__dirname, '..', 'icons');
fs.mkdirSync(out, { recursive: true });
for (const size of [180, 192, 512]) {
  fs.writeFileSync(path.join(out, `icon-${size}.png`), png(size));
}
console.log('ícones gerados em', out);
