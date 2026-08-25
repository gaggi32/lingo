/**
 * Draws Lingo's app icon and writes it as app-icon.png.
 *
 *     node scripts/make-icon.mjs
 *     npx tauri icon app-icon.png     # fans it out into src-tauri/icons/
 *
 * The mark is two speech bubbles on a dark teal tile: one drawn as an outline
 * with its tail down-left, one filled and overlapping it with its tail
 * down-right. What was said, and what came back — which is the whole app.
 *
 * Every shape is an axis-aligned rounded box with per-corner radii, so the
 * sharp corner that makes each bubble a bubble is just one radius set small.
 * That means the icon renders identically on any machine with nothing
 * installed but Node.
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

// ---- Geometry ---------------------------------------------------------------
//
// Laid out on the 224-pixel grid the design was drawn on, then normalised into
// the 0..1 unit square the distance fields work in. Boxes are given the way CSS
// gives them — top-left corner, width, height, and the four radii clockwise
// from the top left.

const GRID = 224;
const u = (px) => px / GRID;

/** The tile itself, plus the hairline that lifts its edge off the background. */
const TILE = {
  x: 0,
  y: 0,
  w: 224,
  h: 224,
  r: { tl: 52, tr: 52, br: 52, bl: 52 },
};
const TILE_EDGE = 1;

/** Said: an outline, tail down-left. */
const ASKED = {
  x: 42,
  y: 42,
  w: 104,
  h: 88,
  r: { tl: 26, tr: 26, br: 26, bl: 6 },
  stroke: 12,
};

/** Answered: filled, tail down-right, riding over the first. */
const ANSWERED = {
  x: 80,
  y: 106,
  w: 104,
  h: 88,
  r: { tl: 26, tr: 26, br: 6, bl: 26 },
};

// ---- Palette ----------------------------------------------------------------
//
// Authored in OKLCH, because the two teals have to hold the same apparent
// lightness as each other and sRGB hex will not promise that. Converted here
// rather than pasted as hex so the numbers stay the ones that were designed.

/** OKLCH -> sRGB bytes, gamut-clipped per channel. */
function oklch(L, C, H) {
  const hr = (H * Math.PI) / 180;
  const a = C * Math.cos(hr);
  const b = C * Math.sin(hr);

  // OKLab -> LMS -> linear sRGB (Björn Ottosson's matrices).
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;

  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];

  return linear.map((c) => {
    const clamped = Math.min(1, Math.max(0, c));
    const encoded =
      clamped <= 0.0031308
        ? 12.92 * clamped
        : 1.055 * clamped ** (1 / 2.4) - 0.055;
    return Math.round(encoded * 255);
  });
}

const BACKDROP = oklch(0.24, 0.028, 208);
const EDGE = oklch(0.3, 0.028, 208);
const OUTLINE = oklch(0.97, 0.01, 200);
const FILL = oklch(0.62, 0.13, 188);

// ---- Signed distance fields -------------------------------------------------

/**
 * A rounded box with four independent corner radii.
 *
 * The radius is picked per quadrant before the usual rounded-box distance, so
 * one sharp corner costs nothing but a different number.
 */
function roundedBox(px, py, cx, cy, halfW, halfH, r) {
  const dx = px - cx;
  const dy = py - cy;
  // y grows downward here, so a positive dy is the bottom half.
  const radius = dx >= 0 ? (dy >= 0 ? r.br : r.tr) : dy >= 0 ? r.bl : r.tl;
  const qx = Math.abs(dx) - halfW + radius;
  const qy = Math.abs(dy) - halfH + radius;
  return (
    Math.min(Math.max(qx, qy), 0) +
    Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) -
    radius
  );
}

/**
 * Distance to a CSS-style box, optionally shrunk by `inset` on every side.
 *
 * The inset is how a border is drawn: the same box pulled in by the border
 * width, with each radius reduced to match, exactly as CSS resolves an inner
 * radius. A corner whose radius is smaller than the border simply squares off.
 */
function boxSdf(h, v, box, inset = 0) {
  return roundedBox(
    h,
    v,
    u(box.x + box.w / 2),
    u(box.y + box.h / 2),
    u(box.w / 2 - inset),
    u(box.h / 2 - inset),
    {
      tl: u(Math.max(0, box.r.tl - inset)),
      tr: u(Math.max(0, box.r.tr - inset)),
      br: u(Math.max(0, box.r.br - inset)),
      bl: u(Math.max(0, box.r.bl - inset)),
    },
  );
}

/** Distance in pixels -> coverage, clamped. */
function coverage(distanceInUnits) {
  const px = distanceInUnits * SIZE;
  return Math.min(1, Math.max(0, 0.5 - px));
}

/** Paint `ink` over `dst` at the given coverage, in place. */
function over(dst, ink, alpha) {
  if (alpha <= 0) return;
  for (let c = 0; c < 3; c++) dst[c] += (ink[c] - dst[c]) * alpha;
}

// ---- Render -----------------------------------------------------------------

const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
const px = [0, 0, 0];

for (let y = 0; y < SIZE; y++) {
  const rowStart = y * (SIZE * 4 + 1);
  raw[rowStart] = 0; // PNG filter type: none

  const v = (y + 0.5) / SIZE;

  for (let x = 0; x < SIZE; x++) {
    const h = (x + 0.5) / SIZE;

    const tileAlpha = coverage(boxSdf(h, v, TILE));
    if (tileAlpha <= 0) {
      raw[rowStart + 1 + x * 4 + 3] = 0;
      continue;
    }

    px[0] = BACKDROP[0];
    px[1] = BACKDROP[1];
    px[2] = BACKDROP[2];

    // The hairline edge: inside the tile, outside the tile pulled in by 1.
    over(px, EDGE, 1 - coverage(boxSdf(h, v, TILE, TILE_EDGE)));

    // The outlined bubble is the ring between its box and that box inset by
    // the border width.
    over(
      px,
      OUTLINE,
      coverage(boxSdf(h, v, ASKED)) *
        (1 - coverage(boxSdf(h, v, ASKED, ASKED.stroke))),
    );

    // The filled one paints last, so it reads as the nearer of the two.
    over(px, FILL, coverage(boxSdf(h, v, ANSWERED)));

    const i = rowStart + 1 + x * 4;
    raw[i] = Math.round(px[0]);
    raw[i + 1] = Math.round(px[1]);
    raw[i + 2] = Math.round(px[2]);
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
console.log(
  `  backdrop rgb(${BACKDROP})  edge rgb(${EDGE})\n` +
    `  outline  rgb(${OUTLINE})  fill rgb(${FILL})`,
);
