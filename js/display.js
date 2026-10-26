"use strict";
/* global sortedSample, percentileOf */
/* exported valueRange, fixedSpan, histogramOf, autoLevels, greyMap, sliderBrightness, sliderContrast,
   centreOfBrightness, widthOfContrast */
/*
 * The display: how the grey values become the picture on screen.  Two levels map the values
 * linearly onto the screen's 256 grey steps; brightness and contrast sliders move the same two
 * levels, as ImageJ's Brightness/Contrast window does; a histogram shows where they lie.  MATH.md,
 * part 5, gives the same derivations with more words.  The display changes the picture only: the
 * edge map, the snapping and every measure work on the grey values as stored.  The histogram and
 * the auto levels count, like the edge map, only the rows above the info bar (tiff.js).
 *
 * Levels (D1).  The black level l0 and the white level l1 > l0 show the grey value v as
 *
 *     g(v) = round(255 (v - l0) / (l1 - l0)),  clipped to 0 ... 255:
 *
 * black at and below l0, white at and above l1, linear between.  The picture is painted again on
 * each change of levels, for whole-number data (8 and 16 bits) through a table of g over their
 * value range: one look-up per pixel.
 *
 * Auto levels (D2).  The 0.5 and 99.5 % percentiles of the values above the info bar, from an
 * evenly spread sample of about a million of them: about 0.5 % of the pixels show black and 0.5 %
 * white, whatever the bit depth and the signal level.  Full range: the ends of the span, m0 and
 * m1, as ImageJ's Reset.
 *
 * The span [m0, m1], over which the histogram and the sliders run, is ImageJ's: 0 to 255 for an
 * 8-bit image, grey, palette or colour; for 16 and 32 bits, the darkest to the brightest value
 * above the info bar (ImageJ takes the whole image, knowing nothing of the bar).
 *
 * Brightness and contrast (D3), as ImageJ's ContrastAdjuster sets them and shows them.  Write the
 * window between the levels as its centre C = (l0 + l1) / 2 and its width W = l1 - l0, and the
 * width of the span as S = m1 - m0.  A brightness b in [0, 1] places the centre and keeps the
 * width:
 *
 *     C = m0 + (1 - b) S,    and back  b = 1 - (C - m0) / S,
 *
 * from C = m1 at b = 0 (the picture darkest) to C = m0 at b = 1 (brightest).  A contrast c in
 * [0, 1] sets the slope of the map relative to that of the full span, s = S / W, and keeps the
 * centre:
 *
 *     s = 2 c               (c <= 1/2):   W = S / (2 c),       and back  c = S / (2 W)   (W >= S),
 *     s = 1 / (2 (1 - c))   (c >= 1/2):   W = 2 (1 - c) S,     and back  c = 1 - W / (2 S)  (W <= S).
 *
 * The branches meet at c = 1/2, where s = 1 and W = S.  Towards c = 0 the slope falls linearly to
 * 0 and the window widens without bound; towards c = 1 the window closes linearly, the picture
 * becoming a threshold at C.  Each back formula inverts its forward one on its branch, so the
 * sliders, set from the levels after each change, stay where they were moved.
 *
 * Histogram (D4).  At most 256 bins over the span.  An 8-bit span, or whole-number values, takes
 * n_v = m1 - m0 + 1 whole values.  A bin holds w = ceil(n_v / 256) of them, and there are
 * n = ceil(n_v / w) <= 256 bins.  On the axis a whole value v stands for [v - 1/2, v + 1/2), so the
 * axis runs from a = m0 - 1/2 to a + n w, each bin w wide, and value v falls in bin
 * floor((v - a) / w): for a whole v that is floor((v - m0) / w), and a value that is not whole
 * (the luminance of a colour image) counts at its nearest whole value.  Every bin thus spans
 * equally many whole values: one on an 8-bit image, 233 on the FEI test image (m0 = 6041,
 * m1 = 65468).  Bins of the fractional width (m1 - m0) / 256 would hold 0 or 1 whole values when
 * the span is narrower than 256 values, and 1 or 2 when it is 300 wide: a comb.  Other values
 * (floats) take 256 bins of width (m1 - m0) / 256 from m0, with m1 counted in the last bin.
 */

/**
 * @typedef {Object} Histogram
 * @property {Uint32Array} counts     one per bin, at most 256
 * @property {number} start           the axis value where bin 0 begins
 * @property {number} binWidth        in grey values
 * @property {boolean} wholeBins      each bin spans whole values (an 8-bit span, or whole-number values)
 * @property {[number, number]} span  m0 and m1: what the histogram and the sliders span
 * @property {number} min             the darkest value counted
 * @property {number} max             the brightest
 * @property {number} pixels          values counted
 */

/**
 * The darkest and the brightest of the values, and whether all are whole numbers.  Indexed loops
 * here and below: for-of over a typed array took four to five times as long in Chromium (130 ms
 * against 36 ms for the 6.7 M values of the FEI test image).
 * @param {Float32Array} data
 * @returns {[number, number, boolean]}
 */
function valueRange(data) {
  let low = Infinity;
  let high = -Infinity;
  let whole = true;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    low = v < low ? v : low;
    high = v > high ? v : high;
    whole = whole && Math.floor(v) === v;
  }
  return [low, high, whole];
}

/**
 * The span an image's values have whatever they are, as ImageJ has it: 0 to 255 for 8 bits per
 * sample (grey, palette or colour), none for 16 and 32 bits, which span their values.
 * @param {number} bitsPerSample
 * @returns {[number, number]|null}
 */
function fixedSpan(bitsPerSample) {
  return bitsPerSample === 8 ? [0, 255] : null;
}

/**
 * The histogram of the values (D4), over the fixed span when there is one, else over the values.
 * @param {Float32Array} data
 * @param {[number, number]|null} [fixed]   fixedSpan of the image
 * @returns {Histogram}
 */
function histogramOf(data, fixed = null) {
  const [min, max, whole] = data.length > 0 ? valueRange(data) : [0, 0, true];
  /** @type {[number, number]} */
  let span = fixed ?? [min, max];
  const wholeBins = fixed !== null || whole;
  let start = span[0] - 0.5;
  let binWidth = 1;                             // one value: one bin
  let bins = 1;
  if (wholeBins) {
    binWidth = Math.ceil((span[1] - span[0] + 1) / 256);
    bins = Math.ceil((span[1] - span[0] + 1) / binWidth);
  } else if (max > min) {
    start = min;
    binWidth = (max - min) / 256;
    bins = 256;
  }
  if (!(span[1] > span[0])) {
    span = [span[0] - 0.5, span[1] + 0.5];      // one value: the sliders need a width
  }
  const counts = new Uint32Array(bins);
  const last = bins - 1;
  for (let i = 0; i < data.length; i++) {
    // a division, not a product with 1 / binWidth: 49 * (1 / 49) falls short of 1
    counts[Math.min(last, Math.max(0, Math.floor((data[i] - start) / binWidth)))]++;
  }
  return { counts, start, binWidth, wholeBins, span, min, max, pixels: data.length };
}

/**
 * The levels of the Auto button (D2): the 0.5 and 99.5 % percentiles of the values.
 * @param {Float32Array} data
 * @returns {[number, number]}
 */
function autoLevels(data) {
  const sample = sortedSample(data, 1e6);
  const low = percentileOf(sample, 0.5);
  return [low, Math.max(percentileOf(sample, 99.5), low + 1e-6)];
}

/**
 * The screen grey, 0 to 255, of a value under the black level lo and the white level hi (D1).
 * @param {number} lo
 * @param {number} hi
 * @returns {(v: number) => number}
 */
function greyMap(lo, hi) {
  const width = hi - lo;
  // 255 (v - lo) first: exact for whole values, so that a value halfway between two steps rounds
  // up, where a product with 255 / width (50 * 2.55 = 127.49999999999999) would not
  return (v) => Math.max(0, Math.min(255, Math.round((255 * (v - lo)) / width)));
}

/**
 * @param {number} v
 * @returns {number} v clipped to [0, 1]
 */
function clamp01(v) {
  return Math.min(1, Math.max(0, v));
}

/**
 * The brightness b, in [0, 1], of the levels (D3).
 * @param {[number, number]} levels   black and white level
 * @param {[number, number]} span     m0 and m1
 * @returns {number}
 */
function sliderBrightness(levels, span) {
  return clamp01(1 - ((levels[0] + levels[1]) / 2 - span[0]) / (span[1] - span[0]));
}

/**
 * The contrast c, in [0, 1], of the levels (D3).
 * @param {[number, number]} levels
 * @param {[number, number]} span
 * @returns {number}
 */
function sliderContrast(levels, span) {
  const s = span[1] - span[0];
  const w = levels[1] - levels[0];
  return clamp01(w >= s ? s / (2 * w) : 1 - w / (2 * s));
}

/**
 * The window centre C of the brightness b (D3).
 * @param {number} b
 * @param {[number, number]} span
 * @returns {number}
 */
function centreOfBrightness(b, span) {
  return span[0] + (1 - b) * (span[1] - span[0]);
}

/**
 * The window width W of the contrast c (D3): infinite at c = 0, 0 at c = 1.
 * @param {number} c
 * @param {[number, number]} span
 * @returns {number}
 */
function widthOfContrast(c, span) {
  const s = span[1] - span[0];
  return c <= 0.5 ? s / (2 * c) : 2 * (1 - c) * s;
}
