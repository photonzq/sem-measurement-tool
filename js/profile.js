"use strict";
/* global matApply, matInverse, viewMatrix, measurementMatrix */
/* exported profileBand, profileGeometry, bilinear, sampleProfile, profileCrossings, widthHandle, widthFromPoint,
   edgeNormal, segmentNormal, squaredProfile, magnetHolds, markerPlace, profileValueAt, snapToSlope */
/*
 * Line profiles: the grey values along a line, averaged across a band of adjustable width, and the
 * places where contours cross the line.  MATH.md, part 6, gives the same derivations with more
 * words.  Everything is computed from the stored points and the grey values as stored (not the
 * display), so a profile, like a ruler, stays on its pixels whatever the calibration.
 *
 * The band (P1).  The line runs from u1 to u2, stored coordinates, d = u2 - u1.  In the view frame
 * V of (G11), V d has the length Lv and the unit direction t; n = (-t_y, t_x) is the unit normal.
 * The band is the set of points V u1 + s t + r n with 0 <= s <= Lv and |r| <= w / 2, w being the band
 * width in view units (pixel widths of the corrected view, as the snap radius): a rectangle as it is
 * seen, whatever the tilt correction and the rotation.  Back in stored coordinates a step r across
 * is the vector r V^-1 n, and the band is a parallelogram.
 *
 * Samples along (P2).  N + 1 points u_i = u1 + (i / N) d, i = 0 ... N, with N = max(1, ceil |d|):
 * at most one stored pixel apart, the image's own sampling.  An affine map keeps ratios along a
 * line, so sample i lies at the distance s_i = (i / N) |A d| from u1 in the measurement frame (A of
 * (G8)).  As A = c V, with c = p_x / 1000 um per view unit (c = 1 px without a pixel size),
 * |A d| = c Lv.
 *
 * Lines across (P3).  M = max(1, ceil(w |V^-1 n|)) lines parallel to the centre line, w |V^-1 n|
 * being the band's width in stored pixels, at the offsets r_j = ((j + 1/2) / M - 1/2) w,
 * j = 0 ... M - 1: the middles of M equal strips, at most one stored pixel apart.  A band at most
 * one stored pixel wide has the centre line alone.
 *
 * Values (P4).  The grey value at a stored point (x, y) is interpolated bilinearly between the four
 * nearest pixel centres, which reproduces a linear ramp exactly.  It exists inside the image above
 * its info bar, -1/2 <= x <= W - 1/2 and -1/2 <= y <= R - 1/2 (R rows above the bar), the edge row or
 * column repeated in the outer half pixel; elsewhere it is missing.  The profile at s_i is the mean
 * of the values present on the M lines, with their standard deviation (the spread across the band)
 * and their number.
 *
 * Crossings (P5).  A contour segment from a to b crosses the line where u1 + t d = a + q e,
 * e = b - a, with t and q in [0, 1].  The cross product (z component) of both sides with e removes
 * q, and with d removes t:
 *
 *     t = ((a - u1) x e) / (d x e),      q = ((a - u1) x d) / (d x e).
 *
 * Affine maps keep t, a ratio of lengths along one line, so the crossing lies at s = t |A d|.
 * Parallel segments (d x e = 0) do not cross.  A vertex on the line, met by two segments, counts once.
 *
 * Squaring a profile to an edge (P6)-(P11), MATH.md 6.6.  A profile at the angle delta to the edge's
 * normal crosses it, line by line across the band, at places spread over w tan delta (P6): the
 * band-averaged edge is smeared at first order in delta.  The normal is that of the view, where the
 * band is a rectangle; the gradient g of the stored grid is a covector, which the view sees as
 * V^-T g (P7).  Its direction is taken from the structure tensor J = sum w_i g_i g_i^T over a
 * Gaussian window (P8) rather than from g at one point: g's direction at a point is as noisy as
 * 1 / SNR, opposite gradients (the two flanks of a bright line) cancel in a sum of vectors but not in
 * a sum of g g^T, and the eigenvalues give a coherence ((l1 - l2) / (l1 + l2))^2 that tells a
 * straight edge (near 1) from a corner or noise (near 0) (P9).  J is solved on the stored grid, where
 * the noise adds the same to every direction, and only its eigenvector is carried to the view.  A
 * contour segment that the line crosses gives its normal exactly (P10).  The profile turns about the
 * crossing, its length in the view and the crossing's place along it kept (P11).  While one end
 * moves, the second end of a new profile or an end dragged, a magnet turns it about the other end
 * instead (t = 0 or 1), and the crossing slides along the edge: it catches the profile within 5
 * degrees of square and lets go beyond 8, so that a pointer trembling at the border does not make
 * it flicker.
 *
 * Markers (P12)-(P14), MATH.md 6.7.  Two markers, A and B, measure a distance along a profile.  A
 * marker is a stored point; its place along the line is the fraction t of its projection on the
 * line in the view frame, as in (P11), held to [0, 1] (P12), so that it stays on its image point when
 * the line moves.  The distance between two markers is |t_B - t_A| |A d|.  Snapped, a marker settles
 * where the mean's slope is steepest nearby (P13): the mean filtered by the derivative of a Gaussian,
 * at scales from the edge map's sigma to 4 times it, against the slope's noise measured near the
 * click without the edges there.  The edge clicked is the one the finest scale finds; coarser scales
 * place it only while they find it where it was and reach no other edge, and the one where it stands
 * out of the noise best wins.  A marker stays where it was put when no slope stands out of the noise
 * by the threshold of the search (P14), min_contrast raised for the many slopes a click looks at, or
 * when the peak is placed no better than the click.  The samples being about a stored pixel apart
 * (P2), sigma in samples is about sigma in stored pixels.
 */

/**
 * @typedef {Object} Band
 * @property {Point} start       u1
 * @property {Point} d           u2 - u1
 * @property {Point} mid         (u1 + u2) / 2
 * @property {number} viewLength Lv, view units
 * @property {Point} normal      n, view frame
 * @property {Point} across      V^-1 n: the stored vector of one view unit across
 */

/**
 * @typedef {Object} ProfileGeometry
 * @property {Band} band
 * @property {number} samples    N + 1
 * @property {Point[]} offsets   stored offsets of the M lines across
 * @property {number} length     |A d| in the unit; NaN when the correction factor is undefined
 * @property {number} width      the band width in the unit, c w
 * @property {"um"|"px"|null} unit
 */

/**
 * @typedef {Object} Profile
 * @property {Float64Array} distance   s_i, in the unit (NaN when the correction factor is undefined)
 * @property {Float64Array} mean       NaN where no line has a value
 * @property {Float64Array} spread     standard deviation across the band
 * @property {Uint32Array} count       values present at s_i
 * @property {Float64Array} x          stored x of the samples on the centre line
 * @property {Float64Array} y
 */

/**
 * (P1): the line in the view frame and the stored vector across.
 * @param {Point[]} points    u1 and u2
 * @param {Frame} frame
 * @returns {Band}
 */
function profileBand(points, frame) {
  const [u1, u2] = points;
  /** @type {Point} */
  const d = [u2[0] - u1[0], u2[1] - u1[1]];
  const v = viewMatrix(frame);
  const [dx, dy] = matApply(v, d[0], d[1]);
  const viewLength = Math.hypot(dx, dy);
  /** @type {Point} */
  const normal = viewLength > 0 ? [-dy / viewLength, dx / viewLength] : [0, 1];
  return {
    start: u1, d, mid: [u1[0] + d[0] / 2, u1[1] + d[1] / 2], viewLength, normal,
    across: matApply(matInverse(v), normal[0], normal[1]),
  };
}

/**
 * (P2), (P3): where a profile of band width ``width`` (view units) samples the image.
 * @param {Point[]} points
 * @param {number} width
 * @param {Frame} frame
 * @returns {ProfileGeometry}
 */
function profileGeometry(points, width, frame) {
  const band = profileBand(points, frame);
  const w = Math.max(0, width);
  const lines = Math.max(1, Math.ceil(w * Math.hypot(band.across[0], band.across[1]) - 1e-9));
  const offsets = Array.from({ length: lines }, (_, j) => {
    const r = ((j + 0.5) / lines - 0.5) * w;
    return /** @type {Point} */ ([r * band.across[0], r * band.across[1]]);
  });
  const m = measurementMatrix(frame);
  const c = frame.pixelNm ? frame.pixelNm[0] / 1000 : 1;        // unit per view unit: A = c V
  return {
    band, samples: Math.max(1, Math.ceil(Math.hypot(band.d[0], band.d[1]))) + 1, offsets,
    length: m === null ? NaN : c * band.viewLength, width: c * w, unit: m === null ? null : m.unit,
  };
}

/**
 * (P4): the grey value at stored (x, y), bilinear; NaN outside the rows above the info bar.
 * @param {Float32Array} data    row-major, ``width`` per row
 * @param {number} width
 * @param {number} rows          rows above the info bar
 * @param {number} x
 * @param {number} y
 * @returns {number}
 */
function bilinear(data, width, rows, x, y) {
  if (!(x >= -0.5 && x <= width - 0.5 && y >= -0.5 && y <= rows - 0.5)) {
    return NaN;
  }
  const cx = Math.min(Math.max(x, 0), width - 1);
  const cy = Math.min(Math.max(y, 0), rows - 1);
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const x1 = Math.min(x0 + 1, width - 1);
  const y1 = Math.min(y0 + 1, rows - 1);
  const fx = cx - x0;
  const fy = cy - y0;
  const top = data[y0 * width + x0] * (1 - fx) + data[y0 * width + x1] * fx;
  const bottom = data[y1 * width + x0] * (1 - fx) + data[y1 * width + x1] * fx;
  return top * (1 - fy) + bottom * fy;
}

/**
 * (P4) at a stored (x, y) in [0, width - 1) x [0, rows - 1), where bilinear() would neither clamp
 * nor find a value missing: the same operations in the same order, without the tests.
 * @param {Float32Array} data
 * @param {number} width
 * @param {number} x
 * @param {number} y
 * @returns {number}
 */
function bilinearInside(data, width, x, y) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const at = y0 * width + x0;
  const top = data[at] * (1 - fx) + data[at + 1] * fx;
  const bottom = data[at + width] * (1 - fx) + data[at + width + 1] * fx;
  return top * (1 - fy) + bottom * fy;
}

/**
 * (P2)-(P4): the profile of the image along a geometry.
 *
 * Speed.  The profile is computed again at every step of a drag, so this loop is tuned.  Its
 * results are bit for bit those of the plain loop, bilinear() at every value (a test compares
 * them):
 *   - The offsets across the band are two flat arrays: indexing them is cheaper than taking
 *     [ox, oy] pairs apart, which cost an iterator per sample.
 *   - A line of the band whose two ends lie in [0, width - 1) x [0, rows - 1) has every sample
 *     there.  The line is straight, and x0 + t (x1 - x0) is monotonic in t in floating point too,
 *     the ends being computed as in the loop.  Its values need neither bilinear()'s test for
 *     missing values nor its clamps at the edges, so they take bilinearInside(), the same
 *     operations in the same order without the tests.  Other lines take bilinear().
 * In Chromium, on the FEI test image, this takes 20 ns per value for a band of 3001 x 83 values
 * (4.9 ms, against 29 ns and 7.2 ms for the plain loop) and 14 ns for one of 476 x 30 (28 ns).  A
 * profile of one line gains little: along a slanted line each sample reads new rows of the image,
 * which no cache holds.
 * Tried and not taken: going along each line in turn, with the spread in one pass from a value
 * shifted by the line's first (at most 8 % faster, and the last bits differ); x | 0 for the floor
 * (7 % on the interpolation alone, lost in the whole).
 * @param {{data: Float32Array, width: number, imageRows: number}} image
 * @param {ProfileGeometry} g
 * @returns {Profile}
 */
function sampleProfile(image, g) {
  const n = g.samples;
  const m = g.offsets.length;
  const { start, d } = g.band;
  const { data, width, imageRows: rows } = image;
  const out = {
    distance: new Float64Array(n), mean: new Float64Array(n), spread: new Float64Array(n), count: new Uint32Array(n),
    x: new Float64Array(n), y: new Float64Array(n),
  };
  const ox = Float64Array.from(g.offsets, (o) => o[0]);
  const oy = Float64Array.from(g.offsets, (o) => o[1]);
  const inside = new Uint8Array(m);           // 1: the whole line lies in the interior
  for (let j = 0; j < m; j++) {
    const xa = start[0] + ox[j];              // the ends exactly as the loop computes them (f = 0, 1)
    const ya = start[1] + oy[j];
    const xb = start[0] + d[0] + ox[j];
    const yb = start[1] + d[1] + oy[j];
    inside[j] = xa >= 0 && xb >= 0 && xa < width - 1 && xb < width - 1 && ya >= 0 && yb >= 0 && ya < rows - 1
      && yb < rows - 1 ? 1 : 0;
  }
  const values = new Float64Array(m);
  for (let i = 0; i < n; i++) {
    const f = n > 1 ? i / (n - 1) : 0;
    const x = start[0] + f * d[0];
    const y = start[1] + f * d[1];
    let k = 0;
    let sum = 0;
    for (let j = 0; j < m; j++) {
      const v = inside[j] === 1 ? bilinearInside(data, width, x + ox[j], y + oy[j])
        : bilinear(data, width, rows, x + ox[j], y + oy[j]);
      if (!Number.isNaN(v)) {
        values[k++] = v;
        sum += v;
      }
    }
    const mean = k > 0 ? sum / k : NaN;
    let squares = 0;
    for (let j = 0; j < k; j++) {
      squares += (values[j] - mean) ** 2;          // two passes: no cancellation for large grey values
    }
    out.distance[i] = f * g.length;
    out.mean[i] = mean;
    out.spread[i] = k > 0 ? Math.sqrt(squares / k) : NaN;
    out.count[i] = k;
    out.x[i] = x;
    out.y[i] = y;
  }
  return out;
}

/**
 * (P5): where the contours cross the line, in order along it.
 * @param {Point[]} points       u1 and u2
 * @param {Array<{closed: boolean, points: Point[]}>} contours
 * @returns {Array<{contour: number, segment: number, t: number}>}   t: 0 at u1, 1 at u2; segment i runs from
 *     vertex i to the next
 */
function profileCrossings(points, contours) {
  const [u1, u2] = points;
  const d = [u2[0] - u1[0], u2[1] - u1[1]];
  const ld = Math.hypot(d[0], d[1]);
  /** @type {Array<{contour: number, segment: number, t: number}>} */
  const out = [];
  contours.forEach((c, ci) => {
    const n = c.points.length;
    const segments = c.closed && n > 2 ? n : n - 1;
    /** @type {Array<[number, number]>} t, and the segment */
    const ts = [];
    for (let i = 0; i < segments; i++) {
      const a = c.points[i];
      const b = c.points[(i + 1) % n];
      const e = [b[0] - a[0], b[1] - a[1]];
      const den = d[0] * e[1] - d[1] * e[0];
      if (!(Math.abs(den) > 1e-12 * ld * Math.hypot(e[0], e[1]))) {
        continue;                                    // parallel, or a point
      }
      const w = [a[0] - u1[0], a[1] - u1[1]];
      const t = (w[0] * e[1] - w[1] * e[0]) / den;
      const q = (w[0] * d[1] - w[1] * d[0]) / den;
      if (t >= 0 && t <= 1 && q >= 0 && q <= 1) {
        ts.push([t, i]);
      }
    }
    ts.sort((p, q) => p[0] - q[0]).forEach(([t, i], k) => {
      if (k === 0 || t - ts[k - 1][0] > 1e-9) {
        out.push({ contour: ci, segment: i, t });
      }
    });
  });
  return out.sort((p, q) => p.t - q.t);
}

/**
 * (P7)-(P9): the normal of an edge in the view frame, from the structure tensor ``j`` = [J11, J12,
 * J22] of the stored frame (EdgeMap.structureTensor).  Its eigenvector e of the larger eigenvalue l1,
 * at the angle (1/2) atan2(2 J12, J11 - J22), is the gradients' common direction on the stored grid,
 * and the view sees it as the covector V^-T e; ((l1 - l2) / (l1 + l2))^2 is the coherence, 1 for a
 * single straight edge and near 0 for none or for two at once.  Both are taken on the stored grid,
 * where the noise adds the same to every direction: the view's tensor V^-T J V^-1 has the same
 * eigenvector without noise, but there the noise favours a direction, turns the eigenvector and
 * lowers the coherence.  null when the window has no gradient.
 * @param {[number, number, number]} j
 * @param {Frame} frame
 * @returns {{normal: Point, coherence: number}|null}   normal: a unit vector of the view frame
 */
function edgeNormal(j, frame) {
  const [j11, j12, j22] = j;
  const trace = j11 + j22;
  if (!(trace > 0)) {
    return null;
  }
  const root = Math.hypot((j11 - j22) / 2, j12);                     // (l1 - l2) / 2
  const angle = 0.5 * Math.atan2(2 * j12, j11 - j22);
  const [ex, ey] = [Math.cos(angle), Math.sin(angle)];
  const [b11, b12, b21, b22] = matInverse(viewMatrix(frame));        // B = V^-1
  const [nx, ny] = [b11 * ex + b21 * ey, b12 * ex + b22 * ey];        // B^T e = V^-T e
  const length = Math.hypot(nx, ny);
  return { normal: [nx / length, ny / length], coherence: (2 * root / trace) ** 2 };
}

/**
 * (P10): the unit normal, in the view frame, of the segment from a to b (stored); null for a point.
 * @param {Point} a
 * @param {Point} b
 * @param {Frame} frame
 * @returns {Point|null}
 */
function segmentNormal(a, b, frame) {
  const [ex, ey] = matApply(viewMatrix(frame), b[0] - a[0], b[1] - a[1]);
  const length = Math.hypot(ex, ey);
  return length > 0 ? [-ey / length, ex / length] : null;
}

/**
 * (P11): a profile from u1 to u2 turned about ``pivot``, a point of its line, to run along ``normal``
 * (a unit vector of the view frame): its length in the view, the pivot's place along it and its
 * sense from u1 to u2 kept.  ``turnedDeg`` is the angle it turned through, 0 to 90 degrees.
 * @param {Point[]} points
 * @param {Point} pivot
 * @param {Point} normal
 * @param {Frame} frame
 * @returns {{points: Point[], turnedDeg: number}}
 */
function squaredProfile(points, pivot, normal, frame) {
  const v = viewMatrix(frame);
  const [u1, u2] = points;
  const [dx, dy] = matApply(v, u2[0] - u1[0], u2[1] - u1[1]);
  const length = Math.hypot(dx, dy);
  const [px, py] = matApply(v, pivot[0] - u1[0], pivot[1] - u1[1]);
  const t = length > 0 ? (px * dx + py * dy) / (length * length) : 0;
  const sense = normal[0] * dx + normal[1] * dy < 0 ? -1 : 1;
  const [bx, by] = matApply(matInverse(v), sense * normal[0] * length, sense * normal[1] * length);  // V^-1 (L n)
  const cos = length > 0 ? Math.min(1, Math.abs(normal[0] * dx + normal[1] * dy) / length) : 1;
  return {
    points: [[pivot[0] - t * bx, pivot[1] - t * by], [pivot[0] + (1 - t) * bx, pivot[1] + (1 - t) * by]],
    turnedDeg: (Math.acos(cos) * 180) / Math.PI,
  };
}

const MAGNET_CATCH_DEG = 5;       // (P11) the magnet catches a profile whose end moves this near square ...
const MAGNET_HOLD_DEG = 8;        // (P11) ... and holds it until it is further off than this

/**
 * (P11): whether the magnet holds square a profile whose end moves, ``offDeg`` off square where the
 * pointer has it: within MAGNET_CATCH_DEG, or MAGNET_HOLD_DEG while it is ``held`` already.
 * @param {number} offDeg
 * @param {boolean} held
 * @returns {boolean}
 */
function magnetHolds(offDeg, held) {
  return offDeg <= (held ? MAGNET_HOLD_DEG : MAGNET_CATCH_DEG);
}

/**
 * (P12): where a marker, a stored point, lies along the profile from u1 to u2: the fraction t of its
 * projection on the line in the view frame, held to [0, 1].
 * @param {Point[]} points
 * @param {Point} marker
 * @param {Frame} frame
 * @returns {number}
 */
function markerPlace(points, marker, frame) {
  const v = viewMatrix(frame);
  const [u1, u2] = points;
  const [dx, dy] = matApply(v, u2[0] - u1[0], u2[1] - u1[1]);
  const [px, py] = matApply(v, marker[0] - u1[0], marker[1] - u1[1]);
  const squared = dx * dx + dy * dy;
  return squared > 0 ? Math.min(1, Math.max(0, (px * dx + py * dy) / squared)) : 0;
}

/**
 * The profile's mean at the fraction t along the line, linear between the two samples about it;
 * NaN when one of them has no value (and t is not on the other).
 * @param {Profile} profile
 * @param {number} t
 * @returns {number}
 */
function profileValueAt(profile, t) {
  const m = profile.mean;
  if (m.length === 1) {
    return m[0];
  }
  const x = Math.min(1, Math.max(0, t)) * (m.length - 1);
  const i = Math.min(Math.floor(x), m.length - 2);
  const f = x - i;
  return f <= 0 ? m[i] : f >= 1 ? m[i + 1] : m[i] + f * (m[i + 1] - m[i]);
}

const SLOPE_NOISE_SPAN = 60;      // (P13) a slope's noise is measured over at least this many samples each side of a click
const SLOPE_NOISE_SAMPLES = 20;   // (P13) a scale with fewer samples to measure it on is not used
const SAME_EDGE = 3;              // (P13) noise widths: so little below a peak, or so shallow a dip, is still that peak

/**
 * @typedef {Object} SlopeScale   (P13) the slope of a profile's mean at one scale, near a click
 * @property {number} scale         sigma_q, samples
 * @property {number} k             K = ceil 3 sigma_q: no slope within K samples of an end or a missing value
 * @property {Float64Array} slope   s_i, NaN where missing
 * @property {number} trend         the median slope near the click
 * @property {number} noise         the slope's noise near the click: the scaled median absolute deviation
 * @property {number} noiseStep     the same of s_{i+1} - s_{i-1}, the noise that moves a peak
 * @property {Float64Array} d       |s_i - trend|, NaN where the slope is missing
 * @property {number} reach         round(2 sigma_q), at least 1: a peak is the largest within it
 */

/**
 * @param {ArrayLike<number>} values   finite, at least one
 * @returns {number} the median
 */
function medianOf(values) {
  const sorted = Float64Array.from(values).sort();
  const h = sorted.length >> 1;
  return sorted.length % 2 ? sorted[h] : (sorted[h - 1] + sorted[h]) / 2;
}

/**
 * @param {Float64Array} values
 * @param {number} i
 * @returns {number} values[i], NaN outside the array
 */
function valueAt(values, i) {
  return i >= 0 && i < values.length ? values[i] : Number.NaN;
}

/**
 * (P13): the slope s_i of the mean at the scale ``sigma`` (samples): the mean filtered by the
 * derivative of a Gaussian, weights j G_j / sum j^2 G_j (j = -K ... K, K = ceil 3 sigma), which
 * gives a ramp's slope per sample exactly; NaN within K samples of an end or of a missing value.
 * @param {Float64Array} mean
 * @param {number} sigma
 * @returns {{slope: Float64Array, k: number}}
 */
function slopeAtScale(mean, sigma) {
  const n = mean.length;
  const k = Math.max(1, Math.ceil(3 * sigma));
  const weights = new Float64Array(2 * k + 1);
  let norm = 0;
  for (let j = -k; j <= k; j++) {
    const g = Math.exp(-(j * j) / (2 * sigma * sigma));
    weights[j + k] = j * g;
    norm += j * j * g;
  }
  const slope = new Float64Array(n).fill(Number.NaN);
  for (let i = k; i < n - k; i++) {
    let s = 0;
    for (let j = -k; j <= k; j++) {
      s += weights[j + k] * mean[i + j];
    }
    slope[i] = s / norm;                             // NaN when a value is missing
  }
  return { slope, k };
}

/**
 * (P13): the slope's level over the samples of ``range`` that ``keep`` admits.  Samples whose kernel
 * lies wholly on a stretch where the mean is exactly constant (clipped, or without noise) are left
 * out: they tell nothing of the noise.  Of the rest: the median, the trend; the median absolute
 * deviation from it scaled by 1.4826 to a standard deviation, the noise; and the same of the
 * differences s_{i+1} - s_{i-1}, the noise that moves a peak.  null with fewer than
 * SLOPE_NOISE_SAMPLES samples, or no noise.
 * @param {Float64Array} slope
 * @param {number} k
 * @param {Int32Array} flatUntil   for each i, the last index of the run of equal means from i on
 * @param {[number, number]} range
 * @param {(i: number) => boolean} keep
 * @returns {{trend: number, noise: number, noiseStep: number}|null}
 */
function slopeLevel(slope, k, flatUntil, range, keep) {
  /** @type {number[]} */
  const values = [];
  /** @type {number[]} */
  const steps = [];
  for (let i = range[0]; i <= range[1]; i++) {
    if (Number.isFinite(slope[i]) && flatUntil[i - k] < i + k && keep(i)) {
      values.push(slope[i]);
      if (Number.isFinite(slope[i - 1]) && Number.isFinite(slope[i + 1])) {
        steps.push(slope[i + 1] - slope[i - 1]);
      }
    }
  }
  if (values.length < SLOPE_NOISE_SAMPLES) {
    return null;
  }
  const trend = medianOf(values);
  const noise = 1.4826 * medianOf(values.map((s) => Math.abs(s - trend)));
  const middle = steps.length > 0 ? medianOf(steps) : 0;
  const noiseStep = steps.length > 0 ? 1.4826 * medianOf(steps.map((s) => Math.abs(s - middle))) : Number.NaN;
  return noise > 0 ? { trend, noise, noiseStep } : null;
}

/**
 * (P13): the slope's level near a click, over the samples within ``span`` of ``at`` (slopeLevel).
 * The edges there would raise it: a strong one fills a good part of the span with large slopes, and
 * a median absolute deviation gives way to them long before they are half the samples.  So it is
 * measured again, up to three times, without the samples that stand 4 noise widths out of the last
 * estimate and those within ``reach`` of them, until no more stand out; the last estimate stands
 * when too few samples would be left.  Noise alone reaches 4 so rarely that it keeps its own
 * estimate (3 would cut the noise's own excursions out, and lower the estimate by 10 to 23 % in one
 * window of 20, just where they stand).
 * @param {Float64Array} slope
 * @param {number} k
 * @param {Int32Array} flatUntil
 * @param {number} at
 * @param {number} span
 * @param {number} reach
 * @returns {{trend: number, noise: number, noiseStep: number}|null}
 */
function noiseNear(slope, k, flatUntil, at, span, reach) {
  /** @type {[number, number]} */
  const range = [Math.max(k, Math.ceil(at - span)), Math.min(slope.length - k - 1, Math.floor(at + span))];
  let level = slopeLevel(slope, k, flatUntil, range, () => true);
  const onEdge = new Uint8Array(slope.length);
  for (let pass = 0; pass < 3 && level !== null; pass++) {
    let added = 0;
    for (let i = range[0]; i <= range[1]; i++) {
      if (onEdge[i] === 0 && Math.abs(slope[i] - level.trend) > 4 * level.noise) {
        onEdge.fill(1, Math.max(0, i - reach), Math.min(slope.length, i + reach + 1));
        added++;
      }
    }
    const next = added > 0 ? slopeLevel(slope, k, flatUntil, range, (i) => onEdge[i] === 0) : null;
    if (next === null) {
      break;
    }
    level = next;
  }
  return level;
}

/**
 * (P13): the slopes at the scales sigma 2^(q/2), q = 0 ... 4, each with its level near the click
 * (null for a scale without one), until the kernel is longer than the profile.
 * @param {Float64Array} mean
 * @param {number} at
 * @param {number} radius
 * @param {number} sigma
 * @returns {Array<SlopeScale|null>}
 */
function scaleLadder(mean, at, radius, sigma) {
  const n = mean.length;
  const flatUntil = new Int32Array(n);
  for (let i = n - 1; i >= 0; i--) {
    flatUntil[i] = i < n - 1 && mean[i] === mean[i + 1] ? flatUntil[i + 1] : i;
  }
  /** @type {Array<SlopeScale|null>} */
  const ladder = [];
  for (let q = 0; q <= 4; q++) {
    const scale = sigma * 2 ** (q / 2);
    const { slope, k } = slopeAtScale(mean, scale);
    if (2 * k + 1 > n) {
      break;
    }
    const reach = Math.max(1, Math.round(2 * scale));
    const level = noiseNear(slope, k, flatUntil, at, Math.max(SLOPE_NOISE_SPAN, 4 * radius, 15 * scale), reach);
    ladder.push(level === null ? null : { scale, k, slope, ...level, d: slope.map((s) => Math.abs(s - level.trend)), reach });
  }
  return ladder;
}

/**
 * (P13): whether d_i is a peak: the largest within 2 sigma, with a slope on either side.  The first
 * sample next to a missing slope, at an end or a gap, is where the slopes stop, not a peak.
 * @param {SlopeScale} c
 * @param {number} i
 * @returns {boolean}
 */
function isPeak(c, i) {
  const d = c.d;
  if (!(Number.isFinite(valueAt(d, i - 1)) && Number.isFinite(valueAt(d, i + 1)))) {
    return false;
  }
  for (let j = Math.max(0, i - c.reach); j <= Math.min(d.length - 1, i + c.reach); j++) {
    if (d[j] > d[i]) {
      return false;
    }
  }
  return true;
}

/**
 * (P14): the threshold of a marker's search, in noise widths.  The window of 2 radius + 1 samples
 * holds about (2 radius + 1) / sigma_q independent slopes at each scale, the slope being correlated
 * over about sigma_q: N in all.  For Gaussian noise a sample exceeds c standard deviations with the
 * probability erfc(c / sqrt 2) ~ sqrt(2 / pi) exp(-c^2 / 2) / c, so with
 *
 *     c = sqrt(k^2 + 2 ln N),     N = max(1, sum_q (2 radius + 1) / sigma_q),            (P14)
 *
 * noise alone gives a candidate somewhere in the search with about N erfc(c / sqrt 2) = (k / c)
 * erfc(k / sqrt 2): no more often than one sample exceeds k, ``minContrast``.  MATH.md 6.7.
 * @param {Array<SlopeScale|null>} ladder
 * @param {number} radius
 * @param {number} minContrast
 * @returns {number}
 */
function searchThreshold(ladder, radius, minContrast) {
  let samples = 0;
  for (const c of ladder) {
    samples += c === null ? 0 : (2 * radius + 1) / c.scale;
  }
  return Math.sqrt(minContrast * minContrast + 2 * Math.log(Math.max(1, samples)));
}

/**
 * (P13): the edge clicked: at the finest scale that has one within ``radius`` of ``at``, the
 * candidate nearest it.  A candidate is a peak of d, ``threshold`` times the noise high (c of (P14))
 * and half as high as the window's highest.  null when no scale has one.
 * @param {Array<SlopeScale|null>} ladder
 * @param {number} at
 * @param {number} radius
 * @param {number} threshold
 * @returns {{s: number, pick: number}|null}   s: the scale's place in the ladder; pick: the sample
 */
function clickedEdge(ladder, at, radius, threshold) {
  for (let s = 0; s < ladder.length; s++) {
    const c = ladder[s];
    if (c === null) {
      continue;
    }
    const lo = Math.max(c.k, Math.floor(at - radius));
    const hi = Math.min(c.d.length - c.k - 1, Math.ceil(at + radius));
    let highest = 0;
    for (let i = lo; i <= hi; i++) {
      highest = c.d[i] > highest ? c.d[i] : highest;
    }
    let pick = -1;
    for (let i = lo; i <= hi; i++) {
      const strong = c.d[i] >= threshold * c.noise && c.d[i] >= 0.5 * highest && isPeak(c, i);
      if (strong && (pick < 0 || Math.abs(i - at) < Math.abs(pick - at))) {
        pick = i;
      }
    }
    if (pick >= 0) {
      return { s, pick };
    }
  }
  return null;
}

/**
 * (P13): the extent of the edge clicked: the samples about its peak, of its sign, whose d stays within
 * SAME_EDGE noise widths of the peak's.  Narrow for a peak far out of the noise, wide for one barely
 * out of it, as the place of the peak is sure or not.
 * @param {SlopeScale} c
 * @param {number} pick
 * @returns {[number, number]}
 */
function edgeExtent(c, pick) {
  const floor = c.d[pick] - SAME_EDGE * c.noise;
  const sign = Math.sign(c.slope[pick] - c.trend);
  /** @param {number} i @returns {boolean} */
  const same = (i) => valueAt(c.d, i) >= floor && Math.sign(c.slope[i] - c.trend) === sign;
  let [e0, e1] = [pick, pick];
  while (same(e0 - 1)) {
    e0--;
  }
  while (same(e1 + 1)) {
    e1++;
  }
  return [e0, e1];
}

/**
 * (P13): the other edges at a scale: maxima of d outside the extent, ``minContrast`` times the noise
 * high, with a dip of SAME_EDGE noise widths between them and the extent (a missing slope counts as
 * one).  A maximum on the shoulder of the edge clicked has no such dip.
 * @param {SlopeScale} c
 * @param {[number, number]} extent
 * @param {number} minContrast
 * @returns {number[]}
 */
function otherEdges(c, extent, minContrast) {
  const d = c.d;
  /** @type {number[]} */
  const out = [];
  for (const [from, step] of [[extent[0] - 1, -1], [extent[1] + 1, 1]]) {
    let low = Infinity;
    for (let j = from; j >= 0 && j < d.length; j += step) {
      low = Number.isFinite(d[j]) ? Math.min(low, d[j]) : 0;
      const maximum = d[j] >= valueAt(d, j - 1) && d[j] >= valueAt(d, j + 1);
      if (maximum && d[j] >= minContrast * c.noise && d[j] - low >= SAME_EDGE * c.noise) {
        out.push(j);
      }
    }
  }
  return out;
}

/**
 * (P13): the second derivative of d at a peak: that of the least-squares parabola through the peak's
 * own run, the samples about it of its sign whose d stays within SAME_EDGE noise widths of the peak's
 * (and at least its two neighbours).  A narrow peak far out of the noise has a short run, a flat top
 * a long one, which the parabola then follows as flat.  With x = i - pick, y = b0 + b1 x + b2 x^2
 * solves the normal equations of the sums S_m = sum x^m and T_m = sum x^m y; Cramer's rule gives
 * b2, and the second derivative is 2 b2.
 * @param {SlopeScale} c
 * @param {number} pick
 * @returns {number}
 */
function peakCurvature(c, pick) {
  const floor = c.d[pick] - SAME_EDGE * c.noise;
  const sign = Math.sign(c.slope[pick] - c.trend);
  /** @param {number} i @returns {boolean} */
  const same = (i) => valueAt(c.d, i) >= floor && Math.sign(c.slope[i] - c.trend) === sign;
  let [a, b] = [pick - 1, pick + 1];
  while (same(a - 1)) {
    a--;
  }
  while (same(b + 1)) {
    b++;
  }
  const [s, t] = [[0, 0, 0, 0, 0], [0, 0, 0]];
  for (let i = a; i <= b; i++) {
    const x = i - pick;
    for (let m = 0; m <= 4; m++) {
      s[m] += x ** m;
    }
    for (let m = 0; m <= 2; m++) {
      t[m] += x ** m * c.d[i];
    }
  }
  const det = s[0] * (s[2] * s[4] - s[3] * s[3]) - s[1] * (s[1] * s[4] - s[2] * s[3]) + s[2] * (s[1] * s[3] - s[2] * s[2]);
  const det2 = s[0] * (s[2] * t[2] - s[3] * t[1]) - s[1] * (s[1] * t[2] - s[2] * t[1]) + t[0] * (s[1] * s[3] - s[2] * s[2]);
  return (2 * det2) / det;
}

/**
 * (P13): the scales that place the edge clicked, from its own scale on: a peak within its extent
 * (one sample's margin), and, above the finest scale, no other edge (seen at this scale or a finer
 * one from the edge's own) within 3 sigma, where the kernel would reach it.  Each with the
 * uncertainty of its peak's place: the noise that moves the peak over its curvature.
 * @param {Array<SlopeScale|null>} ladder
 * @param {{s: number, pick: number}} clicked
 * @param {[number, number]} extent
 * @param {number} minContrast
 * @returns {Array<{c: SlopeScale, pick: number, uncertainty: number}>}
 */
function placings(ladder, clicked, extent, minContrast) {
  /** @type {number[]} */
  const seen = [];
  const out = [];
  for (let s = clicked.s; s < ladder.length; s++) {
    const c = ladder[s];
    if (c === null) {
      continue;
    }
    seen.push(...otherEdges(c, extent, minContrast));
    let pick = s === clicked.s ? clicked.pick : -1;
    for (let i = extent[0] - 1; s !== clicked.s && i <= extent[1] + 1; i++) {
      if (c.d[i] >= minContrast * c.noise && isPeak(c, i) && (pick < 0 || c.d[i] > c.d[pick])) {
        pick = i;
      }
    }
    const at = pick;
    if (at < 0 || (s > 0 && seen.some((j) => Math.abs(j - at) <= 3 * c.scale))) {
      continue;
    }
    const curvature = peakCurvature(c, at);
    out.push({ c, pick: at, uncertainty: curvature < 0 ? c.noiseStep / (2 * -curvature) : Infinity });
  }
  return out;
}

/**
 * (P13): where a marker put at the fractional sample index ``at`` settles: the steepest point of
 * the mean nearby.  The edge clicked is found at the finest scale that has a candidate within
 * ``radius`` samples (clickedEdge); the scales that place it, unpulled by other edges, are those of
 * placings(); of them the one where the peak stands highest above the noise wins, and the peak is
 * placed between samples by the vertex of the parabola through it and its two neighbours.  null,
 * the marker staying where it was put, when no scale has a candidate, or when the winning scale
 * places the peak no better than ``tolerance`` samples (one standard deviation): no better than the
 * click.  MATH.md 6.7.
 * @param {Float64Array} mean
 * @param {number} at
 * @param {number} radius
 * @param {number} sigma
 * @param {number} minContrast
 * @param {number} tolerance
 * @returns {{at: number, sigma: number, snr: number, uncertainty: number}|null}
 */
function snapToSlope(mean, at, radius, sigma, minContrast, tolerance) {
  const ladder = scaleLadder(mean, at, radius, sigma);
  const clicked = clickedEdge(ladder, at, radius, searchThreshold(ladder, radius, minContrast));
  if (clicked === null) {
    return null;
  }
  const extent = edgeExtent(/** @type {SlopeScale} */ (ladder[clicked.s]), clicked.pick);
  const placed = placings(ladder, clicked, extent, minContrast);
  if (placed.length === 0) {
    return null;
  }
  const best = placed.reduce((a, b) => (b.c.d[b.pick] / b.c.noise > a.c.d[a.pick] / a.c.noise ? b : a));
  if (!(best.uncertainty <= tolerance)) {
    return null;
  }
  const { c, pick } = best;
  const [a, b, e] = [c.d[pick - 1], c.d[pick], c.d[pick + 1]];
  const curvature = a - 2 * b + e;
  const shift = curvature < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - e)) / curvature)) : 0;
  return { at: pick + shift, sigma: c.scale, snr: b / c.noise, uncertainty: best.uncertainty };
}

/**
 * The handle that sets the band width: the middle of one long side, stored coordinates.
 * @param {Point[]} points
 * @param {number} width       view units
 * @param {Frame} frame
 * @returns {Point}
 */
function widthHandle(points, width, frame) {
  const b = profileBand(points, frame);
  const h = Math.max(0, width) / 2;
  return [b.mid[0] + h * b.across[0], b.mid[1] + h * b.across[1]];
}

/**
 * The band width (view units) that puts the handle at stored point q: twice its distance from
 * the line, measured across in the view frame.
 * @param {Point[]} points
 * @param {Frame} frame
 * @param {Point} q
 * @returns {number}
 */
function widthFromPoint(points, frame, q) {
  const b = profileBand(points, frame);
  const [x, y] = matApply(viewMatrix(frame), q[0] - b.mid[0], q[1] - b.mid[1]);
  return 2 * Math.abs(x * b.normal[0] + y * b.normal[1]);
}
