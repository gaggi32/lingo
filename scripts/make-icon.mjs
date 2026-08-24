/**
 * Draws Lingo's app icon and writes it as app-icon.png.
 *
 *     node scripts/make-icon.mjs
 *     npx tauri icon app-icon.png     # fans it out into src-tauri/icons/
 *
 * The mark is the universal translate pairing — a Latin "A" beside the
 * character 文 — on the iris tile the rest of the UI takes its accent from.
 * Both glyphs are built from capsules rather than a font so the icon renders
 * identically on any machine with nothing installed but Node.
 *
 * Everything is drawn with signed distance fields at one sample per pixel:
 * a shape's distance in pixels converts straight into coverage, which gives
 * clean antialiasing without supersampling.
 */

import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const SIZE = 1024;
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "app-icon.png");

// ---- Geometry, in a 0..1 unit square ---------------------------------------

/** iOS/macOS-style corner radius. */
const CORNER = 0.225;
const STROKE = 0.052;

/** "A": two legs and a crossbar. */
const LETTER_A = [
  [0.305, 0.185, 0.145, 0.505],
  [0.305, 0.185, 0.465, 0.505],
  [0.208, 0.398, 0.402, 0.398],
];

/** 文: the top dot, the horizontal, then the crossing pair of diagonals. */
const GLYPH_WEN = [
  [0.706, 0.452, 0.686, 0.512],
  [0.542, 0.552, 0.858, 0.552],
  [0.778, 0.592, 0.562, 0.842],
  [0.622, 0.592, 0.858, 0.842],
];

const STROKES = [...LETTER_A, ...GLYPH_WEN];

// ---- Palette ----------------------------------------------------------------

const TOP_LEFT = [0x8b, 0x6b, 0xff];
const BOTTOM_RIGHT = [0x51, 0x1f, 0xb8];
const INK = [0xff, 0xff, 0xff];

// ---- Signed distance fields -------------------------------------------------

function roundedRect(x, y, half, radius) {
  const dx = Math.abs(x) - (half - radius);
  const dy = Math.abs(y) - (half - radius);
  const ox = Math.max(dx, 0);
  const oy = Math.max(dy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(dx, dy), 0) - radius;
}

function capsule(px, py, ax, ay, bx, by, r) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const len2 = vx * vx + vy * vy;
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, (wx * vx + wy * vy) / len2));
  return Math.hypot(wx - vx * t, wy - vy * t) - r;
}

/** Distance in pixels -> coverage, clamped. */
function coverage(distanceInUnits) {
  const px = distanceInUnits * SIZE;
  return Math.min(1, Math.max(0, 0.5 - px));
}

// ---- Render -----------------------------------------------------------------

const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));

for (let y = 0; y < SIZE; y++) {
  const rowStart = y * (SIZE * 4 + 1);
  raw[rowStart] = 0; // PNG filter type: none

  const v = (y + 0.5) / SIZE;

  for (let x = 0; x < SIZE; x++) {
    const u = (x + 0.5) / SIZE;

    const tileAlpha = coverage(roundedRect(u - 0.5, v - 0.5, 0.5, CORNER));

    // Diagonal gradient, with a soft highlight lifting the top-left corner.
    const t = Math.min(1, Math.max(0, (u + v) / 2));
    const highlight = 0.16 * Math.max(0, 1 - Math.hypot(u - 0.24, v - 0.2) * 1.7);

    let markAlpha = 0;
    for (const [ax, ay, bx, by] of STROKES) {
      markAlpha = Math.max(
        markAlpha,
        coverage(capsule(u, v, ax, ay, bx, by, STROKE / 2)),
      );
      if (markAlpha >= 1) break;
    }

    const i = rowStart + 1 + x * 4;
    for (let c = 0; c < 3; c++) {
      const base = TOP_LEFT[c] + (BOTTOM_RIGHT[c] - TOP_LEFT[c]) * t;
      const lit = Math.min(255, base + highlight * 255);
      raw[i + c] = Math.round(lit + (INK[c] - lit) * markAlpha);
    }
    raw[i + 3] = Math.round(tileAlpha * 255);
  }
}

// ---- PNG container ----------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // colour type: RGBA
ihdr[10] = 0; // deflate
ihdr[11] = 0; // adaptive filtering
ihdr[12] = 0; // no interlace

writeFileSync(
  OUT,
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]),
);

console.log(`Wrote ${OUT} (${SIZE}x${SIZE})`);
