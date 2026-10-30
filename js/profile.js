"use strict";
/* global matApply, matInverse, viewMatrix, measurementMatrix */
/* exported profileBand, profileGeometry, bilinear, sampleProfile, profileCrossings, widthHandle, widthFromPoint,
   edgeNormal, segmentNormal, squaredProfile */
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
 * crossing, its length in the view and the crossing's place along it kept (P11); after one end was
 * dragged, about the other end instead (t = 0 or 1), and the crossing slides along the edge.
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
