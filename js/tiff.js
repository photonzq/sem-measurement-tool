"use strict";
/* global UTIF, emptyCalibration, feiCalibration, parseFeiText, zeissCalibration, parseZeissText */
/* exported decodeSEMImage, findInfoZone */
/*
 * An SEM image file decoded with UTIF.js (vendor/UTIF.js): the grey values of its first image and
 * its vendor metadata (metadata.js).
 *
 * Pixels: 8, 16 or 32 bits per sample, unsigned integers or (32 bits) floats; grey (black or white
 * is zero), palette, or RGB(A) with interleaved samples; any compression UTIF.js decodes (none,
 * LZW, PackBits, Deflate through pako, JPEG, ...).  A palette maps through its colour map (a grey
 * palette, as in Zeiss files, exactly); colour becomes grey with the Rec. 709 luminance weights.
 * UTIF.js returns 16-bit samples little-endian whatever the file's byte order; 32-bit samples
 * keep it.  The image is kept whole: an info bar at the bottom stays in it, and the processing
 * (histogram, auto contrast, edge map, snapping) uses only the rows above it.  FEI writes its data
 * bar below the image rows and records its height (metadata.js); a Zeiss info zone is found in
 * the pixels (Z1).
 *
 * Zeiss info zone (Z1).  SmartSEM draws its data zone over the image, a white box carrying black
 * text framed above and below by a full-width black line, and records nothing about it.  Its
 * place differs between instruments: rows 691-766 of 768 on a GeminiSEM 360, 675-750 on a
 * GeminiSEM 560, image rows below both.  It is therefore found in each image, in the lowest third
 * of the rows:
 *
 *   - a full-width black line: at least 95 % of the row within 2 % of the value range from the
 *     darkest value;
 *   - below it, at least 20 rows that are each at least half white, within 2 % of the range from
 *     the brightest value (the text takes the rest);
 *   - then another such black line, or the last row.
 *
 * The upper line is the top of the zone, and everything from it down counts as the info bar, the
 * rows of image under the zone included (1 and 17 rows in the two images above).  In those images
 * the lines are 99.7 and 100 % black, the rows between them 67 to 100 % white, and no row of image
 * comes near either test.  A Zeiss image without the pattern keeps all its rows.
 */

/**
 * @typedef {Object} SEMImage
 * @property {string} name
 * @property {number} width
 * @property {number} height          rows in the file
 * @property {number} imageRows       rows above an info bar (= height without one); the
 *                                    processing ignores the rows below
 * @property {Float32Array} data      grey values, row-major, height x width
 * @property {string} sampleType      e.g. "uint16", "uint8 palette"
 * @property {number} bitsPerSample   of the file: 8, 16 or 32 (8 for an image the browser decodes);
 *                                    8-bit images span 0-255 on the display (display.js)
 * @property {"FEI"|"Zeiss"|null} vendor
 * @property {string} metadataText    the vendor's metadata text, "" when none
 * @property {Calibration} calibration
 */

/**
 * The text of an ASCII tag as UTIF.js decodes it: [string], or the bytes when the text starts
 * with a byte above 127 (read as Latin-1, as the microscopes write it).
 * @param {UtifIfd} ifd
 * @param {number} code
 * @returns {string|null}
 */
function tagText(ifd, code) {
  const value = ifd[`t${code}`];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof Uint8Array) {
    let s = "";
    for (let i = 0; i < value.length; i++) {
      s += String.fromCharCode(value[i]);
    }
    return s;
  }
  if (Array.isArray(value)) {
    return value.map((v) => String(v)).join("");
  }
  return null;
}

/**
 * The first value of a numeric tag, or ``fallback``.
 * @param {UtifIfd} ifd
 * @param {string} tag
 * @param {number} fallback
 * @returns {number}
 */
function firstValue(ifd, tag, fallback) {
  const value = ifd[tag];
  return Array.isArray(value) && value.length > 0 ? Number(value[0]) : fallback;
}

/**
 * A reader of sample i from the decoded bytes.
 * @param {UtifIfd} ifd
 * @param {Uint8Array} raw
 * @param {number} bits
 * @param {number} format   SampleFormat: 3 for floats
 * @returns {(i: number) => number}
 */
function sampleReader(ifd, raw, bits, format) {
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const little32 = ifd.isLE !== false;
  if (bits === 8) {
    return (i) => raw[i];
  }
  if (bits === 16) {
    return (i) => view.getUint16(2 * i, true);
  }
  return format === 3 ? (i) => view.getFloat32(4 * i, little32) : (i) => view.getUint32(4 * i, little32);
}

/**
 * Grey values of a palette image through its colour map: exact for a grey palette, else the
 * Rec. 709 luminance.  Returns whether the palette is grey.
 * @param {unknown} cmap     ColorMap tag: 3 * 2^bits values, red, then green, then blue
 * @param {number} bits
 * @param {(i: number) => number} read
 * @param {Float32Array} out
 * @returns {boolean}
 */
function paletteGrey(cmap, bits, read, out) {
  const size = 2 ** bits;
  if (!Array.isArray(cmap) || cmap.length < 3 * size || bits > 16) {
    throw new Error("a palette image without a usable colour map");
  }
  const c = cmap.map(Number);
  let grey = true;
  for (let v = 0; v < size && grey; v++) {
    grey = c[v] === c[v + size] && c[v] === c[v + 2 * size];
  }
  for (let i = 0; i < out.length; i++) {
    const v = read(i);
    out[i] = grey ? c[v] / 257 : (0.2126 * c[v] + 0.7152 * c[v + size] + 0.0722 * c[v + 2 * size]) / 257;
  }
  return grey;
}

/**
 * Turn "white is zero" values into "black is zero" ones, in place.
 * @param {Float32Array} out
 * @param {number} bits
 * @param {boolean} floats
 */
function invertWhiteIsZero(out, bits, floats) {
  let top = floats ? 0 : 2 ** bits - 1;
  if (floats) {
    for (let i = 0; i < out.length; i++) {
      top = Math.max(top, out[i]);
    }
  }
  for (let i = 0; i < out.length; i++) {
    out[i] = top - out[i];
  }
}

/**
 * Grey values of a decoded image.
 * @param {UtifIfd} ifd
 * @param {number} width
 * @param {number} height
 * @returns {{data: Float32Array, type: string, bits: number}}
 */
function greyValues(ifd, width, height) {
  const bits = firstValue(ifd, "t258", 1);
  const spp = firstValue(ifd, "t277", 1);
  const photometric = firstValue(ifd, "t262", 1);
  const format = firstValue(ifd, "t339", 1);
  const raw = ifd.data;
  if (!(raw instanceof Uint8Array)) {
    throw new Error("no pixel data could be decoded");
  }
  if (bits !== 8 && bits !== 16 && bits !== 32) {
    throw new Error(`${bits} bits per sample are not supported (8, 16 or 32)`);
  }
  if (spp > 1 && firstValue(ifd, "t284", 1) === 2) {
    throw new Error("colour images stored as separate planes are not supported");
  }
  if (spp === 2 || spp < 1) {
    throw new Error(`${spp} samples per pixel are not supported`);
  }
  const n = width * height;
  if (raw.length < n * spp * (bits / 8)) {
    throw new Error("the decoded pixel data are shorter than the image");
  }
  const read = sampleReader(ifd, raw, bits, format);
  const out = new Float32Array(n);
  const type = `${format === 3 ? "float" : "uint"}${bits}`;
  if (spp >= 3) {
    for (let i = 0; i < n; i++) {
      out[i] = 0.2126 * read(i * spp) + 0.7152 * read(i * spp + 1) + 0.0722 * read(i * spp + 2);
    }
    return { data: out, type: `${type} colour`, bits };
  }
  if (photometric === 3) {
    const grey = paletteGrey(ifd.t320, bits, read, out);
    return { data: out, type: `${type} ${grey ? "grey" : "colour"} palette`, bits };
  }
  for (let i = 0; i < n; i++) {
    out[i] = read(i);
  }
  if (photometric === 0) {
    invertWhiteIsZero(out, bits, format === 3);
    return { data: out, type: `${type} inverted`, bits };
  }
  return { data: out, type, bits };
}

/**
 * (Z1): the row of the upper black line of a Zeiss info zone, or null when the image has none.
 * @param {Float32Array} data      grey values, row-major
 * @param {number} width
 * @param {number} height
 * @returns {number|null}
 */
function findInfoZone(data, width, height) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of data) {
    lo = v < lo ? v : lo;
    hi = v > hi ? v : hi;
  }
  if (!(hi > lo)) {
    return null;
  }
  const black = lo + 0.02 * (hi - lo);
  const white = hi - 0.02 * (hi - lo);
  /** @param {number} y @param {(v: number) => boolean} test @returns {number} the share of row y that passes */
  const share = (y, test) => {
    let n = 0;
    for (let x = y * width; x < (y + 1) * width; x++) {
      n += test(data[x]) ? 1 : 0;
    }
    return n / width;
  };
  /** @param {number} y */
  const line = (y) => share(y, (v) => v <= black) >= 0.95;
  for (let top = Math.floor((2 * height) / 3); top < height - 20; top++) {
    if (!line(top)) {
      continue;
    }
    let y = top + 1;
    while (y < height && share(y, (v) => v >= white) >= 0.5) {
      y++;
    }
    if (y - top - 1 >= 20 && (y === height || line(y))) {
      return top;
    }
  }
  return null;
}

/**
 * Decode an image file.
 * @param {ArrayBuffer} buffer
 * @param {string} name
 * @returns {SEMImage}
 */
function decodeSEMImage(buffer, name) {
  const ifds = UTIF.decode(buffer);
  const ifd = ifds.find((d) => Array.isArray(d.t256) && Array.isArray(d.t257));
  if (ifd === undefined) {
    throw new Error("no image in this file (is it a TIFF?)");
  }
  UTIF.decodeImage(buffer, ifd);
  const width = Number(ifd.width);
  const height = Number(ifd.height);
  const grey = greyValues(ifd, width, height);
  /** @type {"FEI"|"Zeiss"|null} */
  let vendor = null;
  let text = "";
  let cal = emptyCalibration();
  const fei = tagText(ifd, 34682) ?? tagText(ifd, 34680);
  const zeiss = tagText(ifd, 34118);
  if (fei !== null) {
    vendor = "FEI";
    text = fei;
    cal = feiCalibration(parseFeiText(fei), height);
  } else if (zeiss !== null) {
    vendor = "Zeiss";
    text = zeiss;
    cal = zeissCalibration(parseZeissText(zeiss));
    const top = findInfoZone(grey.data, width, height);
    cal.databarRows = top === null ? 0 : height - top;
  }
  return {
    name, width, height, imageRows: height - cal.databarRows, vendor, metadataText: text, calibration: cal,
    sampleType: grey.type, bitsPerSample: grey.bits, data: grey.data,
  };
}
