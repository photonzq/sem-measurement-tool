"use strict";
/* exported GDS_DBU_UM, gdsReal, gdsRealValue, gdsName, formatGds */
/*
 * GDSII stream files, written for layout tools (KLayout, gdstk, GDSFactory, ...).  MATH.md,
 * part 4, gives the same derivations with more words.
 *
 * Records.  A GDSII file is a sequence of records, each
 *
 *     length (uint16, big-endian, these 4 bytes included) | record type (1 byte) | data type (1 byte) | data
 *
 * with an even length of at most 65535 bytes.  The data types used here are 0x00 (none), 0x02
 * (16-bit signed integers), 0x03 (32-bit signed integers), 0x05 (8-byte reals, (S2)) and 0x06
 * (ASCII, padded with one NUL to an even length).  The file holds one library with one cell:
 *
 *     HEADER 600 | BGNLIB dates | LIBNAME | UNITS (S1)
 *     BGNSTR dates | STRNAME | elements ... | ENDSTR
 *     ENDLIB
 *
 * with three kinds of element:
 *
 *     BOUNDARY LAYER DATATYPE XY ENDEL                  a closed contour; XY repeats the first point
 *     PATH LAYER DATATYPE PATHTYPE WIDTH XY ENDEL       an open contour, flush ends (pathtype 0)
 *     TEXT LAYER TEXTTYPE XY STRING ENDEL               a label at one point
 *
 * Units (S1).  Coordinates are 32-bit integers in database units (DBU).  UNITS holds two reals:
 * the DBU in user units and the DBU in metres.  With the user unit 1 um and the DBU 1 nm, these are
 * 1e-3 and 1e-9, and a point at x um is written as round(x / 1e-3).  Rounding moves a point by at
 * most half a DBU along each axis: 0.5 nm, or 0.71 nm along a diagonal, below the pixel size of
 * any trace.  An XY record of n points takes 4 + 8 n bytes, so n <= (65535 - 4) / 8 = 8191; a
 * BOUNDARY, which repeats its first point, has at most 8190 vertices.
 *
 * Eight-byte reals (S2).  GDSII reals are in the excess-64, base-16 format of the IBM System/360:
 *
 *     bit 63 the sign s | bits 62-56 the exponent e, biased by 64 | bits 55-0 the mantissa m,
 *     value = (-1)^s (m / 2^56) 16^(e - 64),
 *
 * normalized so that m / 2^56 lies in [1/16, 1): its leading hexadecimal digit is not 0.  For a
 * double x other than 0, a = |x| is divided by 16 while a >= 1 and multiplied by 16 while
 * a < 1/16, e counting up or down from 64.  Each step is exact, since 16 = 2^4 only shifts the
 * binary exponent.  A double in [1/16, 1) has a binary exponent of -4 or more and 53 significant
 * bits, so its last bit weighs at least 2^(-4 - 52) = 2^-56: a 2^56 is an integer below 2^56, and
 * m = a 2^56 holds a exactly.  The conversion therefore loses nothing, and reading back gives x.
 * The UNITS of a 1 nm grid, 1e-3 and 1e-9, come out as 3E 41 89 37 4B C6 A7 F0 and
 * 39 44 B8 2F A0 9B 5A 54, the bytes that gdstk 1.0.1 and KLayout 0.30.12 write for them.
 */

/** @typedef {[number, number]} GdsPoint */

/**
 * @typedef {Object} GdsElement
 * @property {"boundary"|"path"|"text"} kind
 * @property {number} layer
 * @property {number} datatype     the texttype of a text
 * @property {GdsPoint[]} points   um; a boundary without repeating its first point, a text one point
 * @property {number} [width]      um, the width of a path (0: a line)
 * @property {string} [text]       the string of a text
 */

/**
 * @typedef {Object} GdsLibrary
 * @property {string} libName
 * @property {string} cellName
 * @property {GdsElement[]} elements
 * @property {Date} date           written as the modification and access times
 */

const GDS_DBU_UM = 0.001;            // database unit: 1 nm, in the user unit 1 um
const GDS_MAX_POINTS = 8191;          // (S1)
const GDS_MAX_INT = 2147483647;
const GDS_MAX_LAYER = 32767;

/**
 * (S2): the 8 bytes of x as a GDSII real.
 * @param {number} x
 * @returns {Uint8Array}
 */
function gdsReal(x) {
  const out = new Uint8Array(8);
  if (!Number.isFinite(x)) {
    throw new Error(`a GDSII real must be finite, not ${x}`);
  }
  if (x === 0) {
    return out;
  }
  let a = Math.abs(x);
  let e = 64;
  while (a >= 1) {
    a /= 16;
    e++;
  }
  while (a < 1 / 16) {
    a *= 16;
    e--;
  }
  if (e < 0 || e > 127) {
    throw new Error(`${x} is out of the range of GDSII reals`);
  }
  let m = BigInt(a * 2 ** 56);       // exact, see (S2)
  out[0] = (x < 0 ? 0x80 : 0) | e;
  for (let i = 7; i >= 1; i--) {
    out[i] = Number(m & 0xffn);
    m >>= 8n;
  }
  return out;
}

/**
 * The value of the GDSII real at ``offset`` in ``bytes`` (the inverse of gdsReal).
 * @param {Uint8Array} bytes
 * @param {number} offset
 * @returns {number}
 */
function gdsRealValue(bytes, offset) {
  let m = 0n;
  for (let i = 1; i < 8; i++) {
    m = (m << 8n) | BigInt(bytes[offset + i]);
  }
  const e = bytes[offset] & 0x7f;
  const value = Number(m) / 2 ** 56 * 16 ** (e - 64);
  return bytes[offset] & 0x80 ? -value : value;
}

/**
 * A cell or library name as GDSII tools expect it: letters, digits, "_", "?" and "$", at most 32
 * characters; anything else becomes "_".
 * @param {string} text
 * @param {string} fallback
 * @returns {string}
 */
function gdsName(text, fallback) {
  const name = text.replace(/[^A-Za-z0-9_?$]/g, "_").slice(0, 32);
  return /[A-Za-z0-9]/.test(name) ? name : fallback;
}

/** A GDSII record stream being assembled. */
class GdsStream {
  constructor() {
    /** @type {Uint8Array[]} */
    this.chunks = [];
    this.size = 0;
  }

  /**
   * @param {number} type        record type
   * @param {number} dataType
   * @param {Uint8Array} [data]
   */
  record(type, dataType, data = new Uint8Array(0)) {
    const length = 4 + data.length;
    if (length > 65535 || length % 2 !== 0) {
      throw new Error(`a GDSII record of ${length} bytes is not allowed`);
    }
    this.chunks.push(Uint8Array.of(length >> 8, length & 0xff, type, dataType), data);
    this.size += length;
  }

  /**
   * @param {number} type
   * @param {number[]} values
   */
  int16(type, values) {
    const data = new Uint8Array(2 * values.length);
    const view = new DataView(data.buffer);
    values.forEach((v, i) => view.setInt16(2 * i, v));
    this.record(type, 0x02, data);
  }

  /**
   * @param {number} type
   * @param {number[]} values
   */
  int32(type, values) {
    const data = new Uint8Array(4 * values.length);
    const view = new DataView(data.buffer);
    values.forEach((v, i) => view.setInt32(4 * i, v));
    this.record(type, 0x03, data);
  }

  /**
   * @param {number} type
   * @param {number[]} values
   */
  real(type, values) {
    const data = new Uint8Array(8 * values.length);
    values.forEach((v, i) => data.set(gdsReal(v), 8 * i));
    this.record(type, 0x05, data);
  }

  /**
   * ASCII text (anything else becomes "?"), padded with a NUL to an even length.
   * @param {number} type
   * @param {string} text
   */
  ascii(type, text) {
    const codes = [...text].map((ch) => (ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) < 127 ? ch.charCodeAt(0) : 63));
    if (codes.length % 2) {
      codes.push(0);
    }
    this.record(type, 0x06, Uint8Array.from(codes));
  }

  /** @returns {Uint8Array} */
  bytes() {
    const out = new Uint8Array(this.size);
    let at = 0;
    for (const c of this.chunks) {
      out.set(c, at);
      at += c.length;
    }
    return out;
  }
}

/**
 * @param {Date} d
 * @returns {number[]} year, month, day, hour, minute, second
 */
function gdsDate(d) {
  return [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()];
}

/**
 * Points in DBU (S1), repeated neighbours (after rounding) dropped; a closed list also loses a
 * last point equal to its first.
 * @param {GdsPoint[]} points
 * @param {boolean} closed
 * @returns {number[][]}
 */
function toDbu(points, closed) {
  /** @type {number[][]} */
  const out = [];
  for (const [x, y] of points) {
    const p = [Math.round(x / GDS_DBU_UM), Math.round(y / GDS_DBU_UM)];
    if (!p.every((v) => Number.isFinite(v) && Math.abs(v) <= GDS_MAX_INT)) {
      throw new Error(`the point (${x}, ${y}) um is out of the range of GDSII coordinates`);
    }
    const last = out[out.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) {
      out.push(p);
    }
  }
  if (closed && out.length > 1 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) {
    out.pop();
  }
  return out;
}

/**
 * @param {GdsElement} el
 * @returns {string}  what is wrong with the layer or datatype, or ""
 */
function layerProblem(el) {
  const ok = (/** @type {number} */ v) => Number.isInteger(v) && v >= 0 && v <= GDS_MAX_LAYER;
  return ok(el.layer) && ok(el.datatype) ? "" : `layer ${el.layer}/${el.datatype} is not in 0-${GDS_MAX_LAYER}`;
}

/**
 * Write one element, or say why it cannot be.
 * @param {GdsStream} s
 * @param {GdsElement} el
 * @returns {string}  "" when written, else the reason it was left out
 */
function writeElement(s, el) {
  const problem = layerProblem(el);
  if (problem) {
    return problem;
  }
  const closed = el.kind === "boundary";
  const pts = toDbu(el.points, closed);
  const need = closed ? 3 : el.kind === "path" ? 2 : 1;
  if (pts.length < need) {
    return `${pts.length} distinct points on the 1 nm grid, ${need} needed`;
  }
  const xy = closed ? [...pts, pts[0]] : el.kind === "text" ? pts.slice(0, 1) : pts;
  if (xy.length > GDS_MAX_POINTS) {
    return `${xy.length} points, more than the ${GDS_MAX_POINTS} of an XY record`;
  }
  s.record(closed ? 0x08 : el.kind === "path" ? 0x09 : 0x0c, 0x00);
  s.int16(0x0d, [el.layer]);
  s.int16(el.kind === "text" ? 0x16 : 0x0e, [el.datatype]);
  if (el.kind === "path") {
    s.int16(0x21, [0]);
    s.int32(0x0f, [Math.round(Math.max(0, el.width ?? 0) / GDS_DBU_UM)]);
  }
  s.int32(0x10, xy.flat());
  if (el.kind === "text") {
    s.ascii(0x19, (el.text ?? "").slice(0, 512));
  }
  s.record(0x11, 0x00);
  return "";
}

/**
 * The GDSII file of ``lib``: its bytes, and the elements left out with the reason.
 * @param {GdsLibrary} lib
 * @returns {{bytes: Uint8Array, skipped: string[]}}
 */
function formatGds(lib) {
  const s = new GdsStream();
  const date = gdsDate(lib.date);
  s.int16(0x00, [600]);
  s.int16(0x01, [...date, ...date]);
  s.ascii(0x02, gdsName(lib.libName, "LIB"));
  s.real(0x03, [GDS_DBU_UM, GDS_DBU_UM * 1e-6]);
  s.int16(0x05, [...date, ...date]);
  s.ascii(0x06, gdsName(lib.cellName, "TOP"));
  /** @type {string[]} */
  const skipped = [];
  lib.elements.forEach((el, i) => {
    const why = writeElement(s, el);
    if (why) {
      skipped.push(`element ${i + 1} (${el.kind}${el.text ? ` "${el.text}"` : ""}): ${why}`);
    }
  });
  s.record(0x07, 0x00);
  s.record(0x04, 0x00);
  return { bytes: s.bytes(), skipped };
}
