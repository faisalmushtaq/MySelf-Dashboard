/**
 * Raster figure files. Browsers write PNGs without a resolution, so a 600-dpi
 * figure opens in Word or InDesign at 6× its size; `setPngDpi` records the
 * resolution. `encodeTiff` writes the baseline RGB TIFF journals accept for
 * raster figures (optionally Deflate-compressed).
 */

let CRC_TABLE: Uint32Array | null = null;

export function crc32(bytes: Uint8Array, start = 0, end = bytes.length): number {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = start; i < end; i += 1) crc = CRC_TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

export function isPng(bytes: Uint8Array): boolean {
  return PNG_SIGNATURE.every((b, i) => bytes[i] === b);
}

/** Pixels per metre for a resolution in dots per inch. */
export const ppm = (dpi: number) => Math.round(dpi / 0.0254);

/** The PNG with a pHYs chunk declaring `dpi` (any existing one is replaced). */
export function setPngDpi(png: Uint8Array, dpi: number): Uint8Array {
  if (!isPng(png)) throw new Error("not a PNG file");
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const chunks: Uint8Array[] = [png.subarray(0, 8)];
  let offset = 8;
  let inserted = false;
  while (offset < png.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...png.subarray(offset + 4, offset + 8));
    const total = 12 + length;
    if (type !== "pHYs") chunks.push(png.subarray(offset, offset + total));
    if (type === "IHDR" && !inserted) {
      chunks.push(physChunk(dpi));
      inserted = true;
    }
    offset += total;
    if (type === "IEND") break;
  }
  const out = new Uint8Array(chunks.reduce((s, c) => s + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

function physChunk(dpi: number): Uint8Array {
  const chunk = new Uint8Array(21);
  const v = new DataView(chunk.buffer);
  v.setUint32(0, 9);
  chunk.set([112, 72, 89, 115], 4); // "pHYs"
  v.setUint32(8, ppm(dpi));
  v.setUint32(12, ppm(dpi));
  chunk[16] = 1; // unit: metre
  v.setUint32(17, crc32(chunk, 4, 17));
  return chunk;
}

/** Resolution a PNG declares, in dpi (null when it declares none). */
export function pngDpi(png: Uint8Array): number | null {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let offset = 8;
  while (offset + 8 <= png.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...png.subarray(offset + 4, offset + 8));
    if (type === "pHYs" && png[offset + 16] === 1) return Math.round(view.getUint32(offset + 8) * 0.0254);
    if (type === "IEND") break;
    offset += 12 + length;
  }
  return null;
}

/** RGBA pixels (as from a canvas) to packed RGB, composited on white. */
export function rgbaToRgb(rgba: Uint8Array | Uint8ClampedArray): Uint8Array {
  const out = new Uint8Array((rgba.length / 4) * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    const a = rgba[i + 3]! / 255;
    out[j] = Math.round(rgba[i]! * a + 255 * (1 - a));
    out[j + 1] = Math.round(rgba[i + 1]! * a + 255 * (1 - a));
    out[j + 2] = Math.round(rgba[i + 2]! * a + 255 * (1 - a));
  }
  return out;
}

/**
 * A baseline, little-endian RGB TIFF in a single strip. `data` is packed RGB,
 * or — with compression "deflate" — the zlib stream of it (TIFF compression 8).
 */
export function encodeTiff(o: { width: number; height: number; dpi: number; data: Uint8Array; compression: "none" | "deflate" }): Uint8Array {
  const entries: [tag: number, type: number, count: number, value: number][] = [];
  const SHORT = 3;
  const LONG = 4;
  const RATIONAL = 5;
  const entryCount = 13;
  const ifdOffset = 8;
  const ifdSize = 2 + entryCount * 12 + 4;
  const bpsOffset = ifdOffset + ifdSize;
  const xresOffset = bpsOffset + 6;
  const yresOffset = xresOffset + 8;
  const dataOffset = yresOffset + 8;
  entries.push([256, LONG, 1, o.width]);
  entries.push([257, LONG, 1, o.height]);
  entries.push([258, SHORT, 3, bpsOffset]);
  entries.push([259, SHORT, 1, o.compression === "deflate" ? 8 : 1]);
  entries.push([262, SHORT, 1, 2]); // RGB
  entries.push([273, LONG, 1, dataOffset]);
  entries.push([277, SHORT, 1, 3]);
  entries.push([278, LONG, 1, o.height]);
  entries.push([279, LONG, 1, o.data.length]);
  entries.push([282, RATIONAL, 1, xresOffset]);
  entries.push([283, RATIONAL, 1, yresOffset]);
  entries.push([284, SHORT, 1, 1]); // chunky
  entries.push([296, SHORT, 1, 2]); // inch
  const out = new Uint8Array(dataOffset + o.data.length);
  const v = new DataView(out.buffer);
  out.set([0x49, 0x49, 42, 0]);
  v.setUint32(4, ifdOffset, true);
  v.setUint16(ifdOffset, entryCount, true);
  entries.forEach(([tag, type, count, value], i) => {
    const at = ifdOffset + 2 + i * 12;
    v.setUint16(at, tag, true);
    v.setUint16(at + 2, type, true);
    v.setUint32(at + 4, count, true);
    if (type === SHORT && count === 1) v.setUint16(at + 8, value, true);
    else v.setUint32(at + 8, value, true);
  });
  v.setUint32(ifdOffset + 2 + entryCount * 12, 0, true);
  for (let i = 0; i < 3; i += 1) v.setUint16(bpsOffset + i * 2, 8, true);
  v.setUint32(xresOffset, o.dpi, true);
  v.setUint32(xresOffset + 4, 1, true);
  v.setUint32(yresOffset, o.dpi, true);
  v.setUint32(yresOffset + 4, 1, true);
  out.set(o.data, dataOffset);
  return out;
}

/** Pixel size of a figure printed at `dpi`. */
export function pixelSize(widthMm: number, heightMm: number, dpi: number): { width: number; height: number } {
  return { width: Math.round((widthMm / 25.4) * dpi), height: Math.round((heightMm / 25.4) * dpi) };
}
