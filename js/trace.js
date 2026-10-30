"use strict";
/* global matApply, matInverse, matDet, viewMatrix, profileGeometry, sampleProfile, slopeAtScale, medianOf */
/* exported TRACE_CRITERIA, strokeStations, firstLeg, newTraceMemo, traceStroke, freehandStroke, stretchNearness,
   joinStroke */
/*
 * Painted edges: the contour tool's stroke along an edge, and the points it places on the edge.
 * MATH.md, part 7, gives the same derivations with more words.  Points are stored coordinates
 * (transform.js, (G1)); lengths are those of the corrected view, V of (G11), as the snap radius.
 *
 * Stations (T1).  The stroke is the pointer's path, u_0 ... u_m stored, w_k = V u_k in the view, with
 * the length l along it and L in all.  Stations lie at l_j = j h, j = 0 ... floor(L / h), h the point
 * spacing: c_j = V^-1 w(l_j), w by linear interpolation.  The stroke's tangent there is the chord
 * t_j = (w(l_j + a) - w(l_j - a)) / |...|, a = max(h, R / 2), clamped to the stroke's ends, so that a
 * hand's tremor does not turn it; n_j = (-t_y, t_x) is its normal and b_j = V^-1 n_j the stored step
 * of one view unit along it.  A station stays where it is while the stroke grows.  Where the stroke
 * turns back, its tangent turning by more than 120 degrees from one station to the next, the stations
 * end: back over the same edge the normal points the other way, the sign of (T3) would pick the other
 * flank of a bright line, and the points would come twice.
 *
 * Cuts of the edge map (T2).  Along each normal, at the offsets r_k = -R + 2 R k / K, k = 0 ... K,
 * K = ceil(2 R max_j |b_j|) (at most a stored pixel apart), the gradient g of (E1), bilinear, gives
 * the slope across, signed, D_jk = g . b_j / (|b_j| median), and the strength |g| / median.
 *
 * The path (T3).  An edge keeps its sign along it: dark to bright across the band stays dark to
 * bright, so the two flanks of a bright line are never mixed.  For the sign s = +1 and s = -1, the
 * offsets k_j that maximize
 *
 *     sum_j [ln max(1, s D_{j k_j}) + ln W(r_{k_j})] - lambda sum_j ((r_{k_j} - r_{k_{j-1}}) / h)^2,
 *     W(r) = exp(-r^2 / (2 R^2)),  lambda = 1,                                                 (T3)
 *
 * come from dynamic programming (Viterbi): F_j(k) = ln max(1, s D_jk) + ln W(r_k) + max_k' (F_{j-1}(k')
 * - lambda ((r_k - r_k') / h)^2), with jumps of at most 2 h, then back from the best end; the sign with
 * the larger best end wins.  W prefers the middle of the band, as the weight of (E5) does a click's
 * surroundings, but more gently (0.61 at the band's border, where (E5) has 0.14): a stroke is a long
 * hint, and where the eye follows a bright line its steepest flank may lie well off it.  The
 * logarithm makes an edge's score relative, and the path keeps to the edge it is on: an edge a third
 * stronger gains ln(4/3) = 0.29 a station, while a jump of 9 px at h = 5 costs 3.2 and the dip
 * between two edges more, so another edge takes over only when it is far stronger or nearer the
 * middle for many stations.  Following one edge that runs off the stroke at 45 degrees costs 1 a
 * station, less than the edge brings (ln c = 1.3 at least, c below).  A station places a point when the edge there
 * stands out and runs along the stroke: |g| >= c median, with c of (E9) for the station's share of the
 * band, N = 2 R h / (|det V| sigma^2), the area of 2 R by h view units in stored pixels over sigma^2;
 * and s D >= |g| / 2, the edge within 60 degrees of the stroke.  A stroke across an edge sees it
 * along its normals, where the path, which follows D, finds nothing, while |g| would pass.  A station
 * that would place a point alone, none of the two on either side placing one, places none: noise
 * rarely stands out at two stations so near, while an edge, even a weak one that stands out only at
 * every other station, does.
 *
 * The cut across the edge (T4).  At the path's point p_j = c_j + r b_j, r refined by the vertex (E6)
 * of s D through k_j and its neighbours, the edge's direction is the chord between the points of
 * the nearest stations placing one within 2 on either side (else the stroke's), its normal nu_j
 * turned to the side of n_j and beta_j = V^-1 nu_j.  A profile (P1)-(P4) runs from p_j - R' beta_j
 * to p_j + R' beta_j, R' = max(R_0, 6 sigma / |beta_j|) so that it reaches 6 sigma either side, with
 * the band width h: each point is the edge averaged over its own stretch.  R_0 is the search radius of
 * the panel, the band's own R for a mouse: a finger's wider band would otherwise move the levels of
 * (T6) and the reach of (T7).  Its mean m_i, i = 0 ...
 * N, lies at r_i = -R' + 2 R' i / N; sigma in samples is sigma_s = sigma N / (2 R' |beta_j|).  The
 * criterion places the edge at a fractional i, and the point at p_j + r beta_j.
 *
 * Steepest slope (T5): the slope of the mean at sigma_s, as (P13) filters it; of its maxima of s
 * times the slope, the one nearest the middle within max(2, 2 sigma_s) samples, at the vertex (E6)
 * of the parabola through it and its neighbours, held to 1/2 sample.
 *
 * Threshold (T6): the levels on either side, b_- and b_+, the medians of m over the outer halves
 * (r <= -R'/2 and r >= R'/2), must differ in the sense s by more than 3 times the noise of one value
 * of m, taken from its first differences there, and by at least a quarter of the swing of the
 * smoothed mean over the middle half (|r| <= R'/2): a bright line's tail, or a bloom far above the
 * step, would else pass for one.  With p the level (a fraction), the threshold
 * T = b_dark + p (b_bright - b_dark).  The mean smoothed at sigma_s crosses T, going from b_- toward
 * b_+, nearest the middle within R'/2; the edge is the crossing of the mean itself nearest that one,
 * within 2 sigma_s, linearly interpolated.  Smoothing widens the edge and would move a crossing at any
 * level but the middle outward: for a step of error-function width b, to p's place on a width of
 * sqrt(b^2 + sigma^2).
 *
 * Bright line (T7): from the middle toward the bright side (s), the first maximum of the smoothed
 * mean within R'/2; it must stand above the level beyond it by at least a tenth of its height above
 * the level on the other side, which a mere wobble on a plateau does not.  The crest is the vertex
 * (E6) through the mean's highest value next to that maximum and its neighbours: smoothing would move
 * the crest of a lopsided line, as the bloom at an edge often is, toward its longer side.
 *
 * A point nearer than h / 2 to the one before is left out.
 *
 * Joining (T8).  The points go in the order painted.  A plain stroke extends the contour: they come
 * after its last vertex, from the end of the stroke nearest it.  A stroke with Ctrl redoes the
 * contour in place: its vertices along the stretch of edge the points cover, within R_0 of their
 * polyline and not beyond its ends by more than h / 2, are covered, and of the runs of covered
 * vertices (cyclic for a closed contour) the nearest to the points, by the mean distance, gives way to
 * them; with none covered, they go into the segment nearest their middle.  Not the band: the eye may
 * follow a bright line while the edge found, and the vertices traced on it before, lie several pixels
 * off; and the band's round ends, and the other side of a narrow feature, would reach vertices that
 * are not on this stretch.  Either way the points face the vertices around them: the order is the one
 * that makes |before - first| + |last - after| the smaller.  Alt places the stations as drawn, without
 * the edge, and the stroke's end when it lies half a spacing beyond the last.
 *
 * Kept between moves.  While a stroke grows, its stations already passed keep their cuts (T2), and the
 * forward scores of (T3) up to the first station whose cut changed stand; a point is placed again only
 * when its station, its path offset or its direction changed.  The result is the same, bit for bit, as
 * placing the whole stroke afresh.
 */

/** The criteria that place a painted edge's points: (T5), (T6), (T7). */
const TRACE_CRITERIA = ["slope", "threshold", "peak"];
const TRACE_STICKINESS = 1;        // (T3) lambda: the cost of moving the path one spacing across between stations
const TRACE_NEIGHBOURS = 2;        // (T4) stations this near on either side give the edge's direction
const TRACE_ALONE = 2;             // (T3) a station placing a point with no other this near on either side places none
const THRESHOLD_STEP = 0.25;       // (T6) the step between the levels, at least this part of the mean's swing near the edge
const TRACE_ALIGN = 0.5;           // (T3) s D / |g| at least this: the edge within 60 degrees of the stroke
const TURN_BACK = -0.5;            // (T1) neighbouring stations' tangents turned by more than 120 degrees: the stroke turns back

/**
 * A station along a stroke (T1).
 * @typedef {Object} Station
 * @property {Point} at        c_j, stored
 * @property {Point} normal    n_j, the stroke's unit normal in the view frame
 * @property {Point} across    b_j = V^-1 n_j: the stored step of one view unit along the normal
 */

/**
 * How a stroke places its points.
 * @typedef {Object} TraceOptions
 * @property {string} criterion     one of TRACE_CRITERIA
 * @property {number} level         p of (T6): 0 at the dark level, 1 at the bright one
 * @property {number} spacing       h, view units
 * @property {number} radius        R, half the band's width, view units
 * @property {number} reach         R_0 of (T4): the panel's search radius, view units
 * @property {number} minContrast   k of (E9)
 */

/**
 * The work of a growing stroke kept from one placing to the next (traceStroke): the stations and their
 * cuts, the forward rows of (T3) for each sign, and the points placed, by what they were placed from.
 * A change of the options, the frame or the edge map starts it afresh.
 * @typedef {Object} TraceMemo
 * @property {string} key
 * @property {EdgeMap|null} edges
 * @property {Station[]} stations
 * @property {Cuts|null} cuts
 * @property {Array<{scores: Float64Array[], from: Int32Array[]}>} rows    the signs +1 and -1
 * @property {Map<string, Point|null>} points
 */

/**
 * (T2): the gradient along the stations' normals, at the offsets r_k.
 * @typedef {Object} Cuts
 * @property {Float64Array} offsets    r_k, view units
 * @property {Float64Array[]} slope    D_jk: the slope across, signed, in units of the median; NaN off the map
 * @property {Float64Array[]} strength |g| / median; NaN off the map
 * @property {number} unchanged        the cuts before this station are those of the last placing
 */

/**
 * (T1): the stations every ``spacing`` view units along a stroke, from its start.
 * @param {Point[]} stroke    stored, in the order drawn
 * @param {number} spacing    h, view units
 * @param {number} radius     R, view units: the tangent is a chord of max(h, R / 2) either side
 * @param {Frame} frame
 * @returns {Station[]}
 */
function strokeStations(stroke, spacing, radius, frame) {
  if (stroke.length === 0 || !(spacing > 0)) {
    return [];
  }
  const v = viewMatrix(frame);
  const back = matInverse(v);
  const w = stroke.map((p) => matApply(v, p[0], p[1]));
  const along = new Float64Array(w.length);
  for (let i = 1; i < w.length; i++) {
    along[i] = along[i - 1] + Math.hypot(w[i][0] - w[i - 1][0], w[i][1] - w[i - 1][1]);
  }
  const total = along[w.length - 1];
  /** @param {number} s @returns {Point} the view point at the length s along the stroke */
  const pointAt = (s) => {
    let lo = 0;
    let hi = w.length - 1;
    while (hi - lo > 1) {                            // along[lo] <= s <= along[hi]
      const mid = (lo + hi) >> 1;
      if (along[mid] <= s) {
        lo = mid;
      } else {
        hi = mid;
      }
    }
    const span = along[hi] - along[lo];
    const f = span > 0 ? Math.min(1, Math.max(0, (s - along[lo]) / span)) : 0;
    return [w[lo][0] + f * (w[hi][0] - w[lo][0]), w[lo][1] + f * (w[hi][1] - w[lo][1])];
  };
  const reach = Math.max(spacing, radius / 2);
  const count = Math.floor(total / spacing + 1e-9) + 1;
  /** @type {Station[]} */
  const stations = [];
  /** @type {Point} */
  let tangent = [1, 0];
  for (let j = 0; j < count; j++) {
    const s = j * spacing;
    const a = pointAt(Math.max(0, s - reach));
    const b = pointAt(Math.min(total, s + reach));
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length > 0) {
      tangent = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
    }
    const here = pointAt(s);
    /** @type {Point} */
    const normal = [-tangent[1], tangent[0]];
    stations.push({ at: matApply(back, here[0], here[1]), normal, across: matApply(back, normal[0], normal[1]) });
  }
  return stations;
}

/**
 * (T1): the stations up to where the stroke turns back, its tangent turning by more than 120 degrees
 * between neighbouring stations.
 * @param {Station[]} stations
 * @returns {Station[]}
 */
function firstLeg(stations) {
  for (let j = 1; j < stations.length; j++) {
    const [a, b] = [stations[j - 1].normal, stations[j].normal];
    if (a[0] * b[0] + a[1] * b[1] < TURN_BACK) {
      return stations.slice(0, j);
    }
  }
  return stations;
}

/** @returns {TraceMemo} the work of a stroke not yet placed */
function newTraceMemo() {
  return { key: "", edges: null, stations: [], cuts: null, rows: [], points: new Map() };
}

/**
 * The memo for these options, frame and edge map: the one given while they stay, else a fresh one.
 * @param {TraceMemo|null} memo
 * @param {EdgeMap} edges
 * @param {TraceOptions} options
 * @param {Frame} frame
 * @returns {TraceMemo}
 */
function memoFor(memo, edges, options, frame) {
  const { criterion, level, spacing, radius, reach, minContrast } = options;
  const key = JSON.stringify([criterion, level, spacing, radius, reach, minContrast, frame]);
  if (memo !== null && memo.key === key && memo.edges === edges) {
    return memo;
  }
  const fresh = newTraceMemo();
  fresh.key = key;
  fresh.edges = edges;
  if (memo !== null) {
    Object.assign(memo, fresh);                    // the caller's memo, emptied and keyed afresh
    return memo;
  }
  return fresh;
}

/**
 * The gradient (E1) at stored (x, y), bilinear; null off the edge map.
 * @param {EdgeMap} edges
 * @param {number} x
 * @param {number} y
 * @returns {Point|null}
 */
function gradientAt(edges, x, y) {
  const w = edges.width;
  const h = edges.height;
  if (!(x >= 0 && y >= 0 && x <= w - 1 && y <= h - 1)) {
    return null;
  }
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, w - 1);
  const y1 = Math.min(y0 + 1, h - 1);
  const fx = x - x0;
  const fy = y - y0;
  /** @param {Float32Array} a @returns {number} */
  const lerp = (a) => (a[y0 * w + x0] * (1 - fx) + a[y0 * w + x1] * fx) * (1 - fy)
    + (a[y1 * w + x0] * (1 - fx) + a[y1 * w + x1] * fx) * fy;
  return [lerp(edges.gx), lerp(edges.gy)];
}

/**
 * (T2): the slope across and the strength along each station's normal; those of the memo for the
 * stations that are the same, with the same offsets.
 * @param {EdgeMap} edges
 * @param {Station[]} stations
 * @param {number} radius
 * @param {TraceMemo} memo
 * @returns {Cuts}
 */
function sampleCuts(edges, stations, radius, memo) {
  const widest = stations.reduce((m, s) => Math.max(m, Math.hypot(s.across[0], s.across[1])), 0);
  const k = Math.max(2, Math.ceil(2 * radius * widest));
  const kept = memo.cuts !== null && memo.cuts.offsets.length === k + 1 ? memo.cuts : null;
  const offsets = kept?.offsets ?? Float64Array.from({ length: k + 1 }, (_v, i) => -radius + (2 * radius * i) / k);
  /** @type {Float64Array[]} */
  const slope = [];
  /** @type {Float64Array[]} */
  const strength = [];
  let unchanged = 0;
  for (const s of stations) {
    const j = slope.length;
    const was = memo.stations[j];
    if (kept !== null && j === unchanged && was !== undefined && was.at[0] === s.at[0] && was.at[1] === s.at[1]
        && was.normal[0] === s.normal[0] && was.normal[1] === s.normal[1]) {
      slope.push(kept.slope[j]);
      strength.push(kept.strength[j]);
      unchanged++;
      continue;
    }
    const length = Math.hypot(s.across[0], s.across[1]);
    const d = new Float64Array(k + 1);
    const m = new Float64Array(k + 1);
    for (let i = 0; i <= k; i++) {
      const g = gradientAt(edges, s.at[0] + offsets[i] * s.across[0], s.at[1] + offsets[i] * s.across[1]);
      d[i] = g === null ? Number.NaN : (g[0] * s.across[0] + g[1] * s.across[1]) / (length * edges.noise);
      m[i] = g === null ? Number.NaN : Math.hypot(g[0], g[1]) / edges.noise;
    }
    slope.push(d);
    strength.push(m);
  }
  memo.stations = stations;
  memo.cuts = { offsets, slope, strength, unchanged };
  return memo.cuts;
}

/**
 * (T3) for one sign: the forward scores F_j and their choices, kept in ``rows`` and computed again
 * from station ``first`` on; then the path back from the best end, and that end's score.
 * @param {Float64Array[]} slope
 * @param {Float64Array} prior     ln W(r_k)
 * @param {Float64Array} jump      the cost of a jump of i samples, i = 0 ... the longest allowed
 * @param {number} sign
 * @param {{scores: Float64Array[], from: Int32Array[]}} rows
 * @param {number} first
 * @returns {{path: Int32Array, total: number}}
 */
function viterbi(slope, prior, jump, sign, rows, first) {
  const n = slope.length;
  const k = prior.length;
  /** @param {number} j @param {number} i @returns {number} */
  const gain = (j, i) => {
    const v = sign * slope[j][i];
    return (v > 1 ? Math.log(v) : 0) + prior[i];    // off the map (NaN), as flat ground
  };
  const keep = Math.min(rows.scores.length, first, n);
  rows.scores.length = keep;
  rows.from.length = keep;
  for (let j = keep; j < n; j++) {
    const score = new Float64Array(k);
    const from = new Int32Array(k);
    const before = rows.scores[j - 1];
    for (let i = 0; i < k; i++) {
      let top = j === 0 ? 0 : -Infinity;
      let arg = i;
      for (let q = Math.max(0, i - jump.length + 1); j > 0 && q < Math.min(k, i + jump.length); q++) {
        const v = before[q] - jump[Math.abs(i - q)];
        if (v > top) {
          top = v;
          arg = q;
        }
      }
      score[i] = top + gain(j, i);
      from[i] = arg;
    }
    rows.scores.push(score);
    rows.from.push(from);
  }
  const last = rows.scores[n - 1];
  let end = 0;
  for (let i = 1; i < k; i++) {
    if (last[i] > last[end]) {
      end = i;
    }
  }
  const path = new Int32Array(n);
  path[n - 1] = end;
  for (let j = n - 1; j > 0; j--) {
    path[j - 1] = rows.from[j][path[j]];
  }
  return { path, total: last[end] };
}

/**
 * (T3): the path through the cuts, of the sign that scores best; the forward rows kept in the memo.
 * @param {Cuts} cuts
 * @param {TraceOptions} options
 * @param {TraceMemo} memo
 * @returns {{sign: number, path: Int32Array}}
 */
function bestPath(cuts, options, memo) {
  const { offsets, slope } = cuts;
  const { radius, spacing } = options;
  const prior = Float64Array.from(offsets, (r) => -0.5 * (r / radius) ** 2);
  const step = offsets[1] - offsets[0];
  const longest = Math.min(offsets.length - 1, Math.ceil((2 * spacing) / step));
  const jump = Float64Array.from({ length: longest + 1 }, (_v, i) => TRACE_STICKINESS * ((i * step) / spacing) ** 2);
  /** @type {{sign: number, path: Int32Array, total: number}} */
  let best = { sign: 1, path: new Int32Array(slope.length), total: -Infinity };
  for (const [m, sign] of [1, -1].entries()) {
    memo.rows[m] = memo.rows[m] ?? { scores: [], from: [] };
    const found = viterbi(slope, prior, jump, sign, memo.rows[m], cuts.unchanged);
    if (found.total > best.total) {
      best = { sign, path: found.path, total: found.total };
    }
  }
  return { sign: best.sign, path: best.path };
}

/**
 * (T3): which stations place a point: where the edge on the path stands out by c of (E9) and runs
 * within 60 degrees of the stroke (s D >= |g| / 2), unless alone: no other within TRACE_ALONE stations
 * on either side.
 * @param {{slope: Float64Array[], strength: Float64Array[]}} cuts
 * @param {{sign: number, path: Int32Array}} trace
 * @param {number} threshold   c
 * @returns {Uint8Array}
 */
function placingStations(cuts, trace, threshold) {
  const found = Uint8Array.from(trace.path, (i, j) => {
    const strength = cuts.strength[j][i];
    return strength >= threshold && trace.sign * cuts.slope[j][i] >= TRACE_ALIGN * strength ? 1 : 0;
  });
  return found.map((f, j) => {
    for (let d = 1; f === 1 && d <= TRACE_ALONE; d++) {
      if (found[j - d] === 1 || found[j + d] === 1) {
        return 1;
      }
    }
    return 0;
  });
}

/**
 * (E6) on three values: the vertex of the parabola through them, -1/2 to 1/2 from the middle one;
 * 0 when they do not make a maximum.
 * @param {number} before
 * @param {number} middle
 * @param {number} after
 * @returns {number}
 */
function vertexShift(before, middle, after) {
  const curvature = before - 2 * middle + after;
  if (!(curvature < 0)) {
    return 0;
  }
  return Math.min(0.5, Math.max(-0.5, (before - after) / (2 * curvature)));
}

/**
 * A Gaussian average of width ``sigma`` samples, normalized, out to ceil(3 sigma); NaN within that
 * of an end or of a missing value.
 * @param {Float64Array} values
 * @param {number} sigma
 * @returns {Float64Array}
 */
function smoothed(values, sigma) {
  const n = values.length;
  const k = Math.max(1, Math.ceil(3 * sigma));
  const weights = Float64Array.from({ length: 2 * k + 1 }, (_v, i) => Math.exp(-((i - k) ** 2) / (2 * sigma * sigma)));
  const sum = weights.reduce((a, b) => a + b, 0);
  const out = new Float64Array(n).fill(Number.NaN);
  for (let i = k; i < n - k; i++) {
    let s = 0;
    for (let j = -k; j <= k; j++) {
      s += weights[j + k] * values[i + j];
    }
    out[i] = s / sum;
  }
  return out;
}

/**
 * The values present from index ``from`` to ``to`` (both included) and the differences of those next
 * to each other.
 * @param {Float64Array} values
 * @param {number} from
 * @param {number} to
 * @returns {{values: number[], steps: number[]}}
 */
function sideValues(values, from, to) {
  /** @type {number[]} */
  const present = [];
  /** @type {number[]} */
  const steps = [];
  for (let i = Math.max(0, from); i <= Math.min(values.length - 1, to); i++) {
    if (Number.isFinite(values[i])) {
      present.push(values[i]);
      if (i > from && Number.isFinite(values[i - 1])) {
        steps.push(values[i] - values[i - 1]);
      }
    }
  }
  return { values: present, steps };
}

/**
 * (T5): the steepest slope of sign ``sign`` nearest the middle of a cut's mean.
 * @param {Float64Array} mean
 * @param {number} sigma    samples
 * @param {number} sign
 * @returns {number|null}   the fractional sample
 */
function slopePlace(mean, sigma, sign) {
  const { slope } = slopeAtScale(mean, sigma);
  const centre = (mean.length - 1) / 2;
  const reach = Math.max(2, 2 * sigma);
  let best = -1;
  for (let i = 1; i < slope.length - 1; i++) {
    const v = sign * slope[i];
    if (v > 0 && v >= sign * slope[i - 1] && v >= sign * slope[i + 1] && Math.abs(i - centre) <= reach
        && (best < 0 || Math.abs(i - centre) < Math.abs(best - centre))) {
      best = i;
    }
  }
  return best < 0 ? null : best + vertexShift(sign * slope[best - 1], sign * slope[best], sign * slope[best + 1]);
}

/**
 * (T6): where the smoothed mean crosses the level ``level`` of the way from the dark side's level to
 * the bright side's, going the way of ``sign``, nearest the middle.
 * @param {Float64Array} mean
 * @param {number} sigma
 * @param {number} sign
 * @param {number} level   0 to 1
 * @returns {number|null}
 */
function thresholdPlace(mean, sigma, sign, level) {
  const last = mean.length - 1;
  const centre = last / 2;
  const lower = sideValues(mean, 0, Math.floor(last / 4));
  const upper = sideValues(mean, Math.ceil((3 * last) / 4), last);
  if (lower.values.length < 3 || upper.values.length < 3) {
    return null;
  }
  const before = medianOf(lower.values);
  const after = medianOf(upper.values);
  const steps = [...lower.steps, ...upper.steps];
  const noise = steps.length > 0 ? (1.4826 * medianOf(steps.map(Math.abs))) / Math.SQRT2 : 0;
  if (!(sign * (after - before) > 3 * noise)) {
    return null;                                     // no step between the levels, or the other way
  }
  const smooth = smoothed(mean, sigma);
  const middle = smooth.subarray(Math.ceil(last / 4), Math.floor((3 * last) / 4) + 1).filter(Number.isFinite);
  if (!(Math.abs(after - before) >= THRESHOLD_STEP * (Math.max(...middle) - Math.min(...middle)))) {
    return null;                                     // a line, or a bloom far above the step: no step to take a level of
  }
  const target = Math.min(before, after) + level * Math.abs(after - before);
  const near = crossing(smooth, sign, target, centre, last / 4);
  return near === null ? null : crossing(mean, sign, target, near, Math.max(1, 2 * sigma)) ?? near;
}

/**
 * (T6): where ``values`` cross ``target`` going the way of ``sign``, linearly interpolated: the
 * crossing nearest ``at`` within ``reach``.
 * @param {Float64Array} values
 * @param {number} sign
 * @param {number} target
 * @param {number} at
 * @param {number} reach
 * @returns {number|null}
 */
function crossing(values, sign, target, at, reach) {
  /** @type {number|null} */
  let best = null;
  for (let i = 0; i + 1 < values.length; i++) {
    const u0 = sign * (values[i] - target);
    const u1 = sign * (values[i + 1] - target);
    if (u0 < 0 && u1 >= 0) {
      const x = i - u0 / (u1 - u0);
      if (Math.abs(x - at) <= reach && (best === null || Math.abs(x - at) < Math.abs(best - at))) {
        best = x;
      }
    }
  }
  return best;
}

/**
 * (T7): the crest of the bright line beside the edge found, toward the bright side.
 * @param {Float64Array} mean
 * @param {number} sigma
 * @param {number} sign
 * @returns {number|null}
 */
function peakPlace(mean, sigma, sign) {
  const last = mean.length - 1;
  const centre = last / 2;
  const smooth = smoothed(mean, sigma);
  let i = Math.round(centre);
  let ahead = i + sign;
  while (Math.abs(ahead - centre) <= last / 4 && Number.isFinite(smooth[i]) && smooth[ahead] >= smooth[i]) {
    i = ahead;
    ahead = i + sign;
  }
  if (!(Number.isFinite(smooth[i]) && smooth[ahead] < smooth[i] && Number.isFinite(smooth[i - sign]))) {
    return null;                                     // still rising at the reach, or off the data
  }
  const far = sideValues(mean, sign > 0 ? Math.ceil((3 * last) / 4) : 0, sign > 0 ? last : Math.floor(last / 4)).values;
  const near = sideValues(mean, sign > 0 ? 0 : Math.ceil((3 * last) / 4), sign > 0 ? Math.floor(last / 4) : last).values;
  if (far.length === 0 || near.length === 0) {
    return null;
  }
  const crest = smooth[i];
  const beyond = medianOf(far);
  if (!(crest - beyond >= 0.1 * (crest - medianOf(near)) && crest > beyond)) {
    return null;
  }
  let top = i;
  for (const k of [i - 1, i + 1]) {
    top = mean[k] > mean[top] ? k : top;
  }
  if (!(Number.isFinite(mean[top - 1]) && Number.isFinite(mean[top]) && Number.isFinite(mean[top + 1]))) {
    return i + vertexShift(smooth[i - 1], smooth[i], smooth[i + 1]);
  }
  return top + vertexShift(mean[top - 1], mean[top], mean[top + 1]);
}

/**
 * (T5)-(T7): where the chosen criterion places the edge on a cut's mean.
 * @param {Float64Array} mean
 * @param {number} sigma
 * @param {number} sign
 * @param {TraceOptions} options
 * @returns {number|null}
 */
function placeOnCut(mean, sigma, sign, options) {
  if (options.criterion === "threshold") {
    return thresholdPlace(mean, sigma, sign, options.level);
  }
  if (options.criterion === "peak") {
    return peakPlace(mean, sigma, sign);
  }
  return slopePlace(mean, sigma, sign);
}

/**
 * (T4): the points of the stations that place one, each by the criterion on a cut across the edge;
 * those the memo has for the same station point, direction and sign taken from it.
 * @param {{data: Float32Array, width: number, imageRows: number}} image
 * @param {number} sigma
 * @param {{stations: Station[], cuts: Cuts, sign: number, path: Int32Array, placing: Uint8Array}} trace
 * @param {TraceOptions} options
 * @param {Frame} frame
 * @param {TraceMemo} memo
 * @returns {Point[]}
 */
function cutPoints(image, sigma, trace, options, frame, memo) {
  const v = viewMatrix(frame);
  const back = matInverse(v);
  const { stations, cuts, sign, path, placing } = trace;
  const along = stations.map((s, j) => {
    const i = path[j];
    const d = cuts.slope[j];
    const shift = i > 0 && i < d.length - 1 ? vertexShift(sign * d[i - 1], sign * d[i], sign * d[i + 1]) : 0;
    const r = cuts.offsets[i] + (Number.isFinite(shift) ? shift : 0) * (cuts.offsets[1] - cuts.offsets[0]);
    return /** @type {Point} */ ([s.at[0] + r * s.across[0], s.at[1] + r * s.across[1]]);
  });
  /** @type {Point[]} */
  const points = [];
  stations.forEach((s, j) => {
    if (placing[j] !== 1) {
      return;
    }
    let [before, after] = [j, j];
    for (let d = 1; d <= TRACE_NEIGHBOURS; d++) {
      before = before === j && placing[j - d] === 1 ? j - d : before;
      after = after === j && placing[j + d] === 1 ? j + d : after;
    }
    const [ax, ay] = matApply(v, along[before][0], along[before][1]);
    const [bx, by] = matApply(v, along[after][0], along[after][1]);
    const chord = Math.hypot(bx - ax, by - ay);
    /** @type {Point} */
    let nu = chord > 0 ? [-(by - ay) / chord, (bx - ax) / chord] : s.normal;
    if (nu[0] * s.normal[0] + nu[1] * s.normal[1] < 0) {
      nu = [-nu[0], -nu[1]];
    }
    const p = along[j];
    const key = `${sign} ${p[0]} ${p[1]} ${nu[0]} ${nu[1]}`;
    let point = memo.points.get(key);
    if (point === undefined) {
      const beta = matApply(back, nu[0], nu[1]);
      const stretch = Math.hypot(beta[0], beta[1]);
      const reach = Math.max(options.reach, (6 * sigma) / stretch);
      const g = profileGeometry([[p[0] - reach * beta[0], p[1] - reach * beta[1]],
        [p[0] + reach * beta[0], p[1] + reach * beta[1]]], options.spacing, frame);
      const mean = sampleProfile(image, g).mean;
      const last = mean.length - 1;
      const x = placeOnCut(mean, (sigma * last) / (2 * reach * stretch), sign, options);
      const r = x === null ? 0 : -reach + (2 * reach * x) / last;
      point = x === null ? null : [p[0] + r * beta[0], p[1] + r * beta[1]];
      memo.points.set(key, point);
    }
    if (point !== null) {
      points.push(point);
    }
  });
  return spaced(points, options.spacing / 2, v);
}

/**
 * The points without those nearer than ``least`` view units to the one kept before.
 * @param {Point[]} points
 * @param {number} least
 * @param {Mat2} v
 * @returns {Point[]}
 */
function spaced(points, least, v) {
  /** @type {Point[]} */
  const kept = [];
  for (const p of points) {
    const q = kept[kept.length - 1];
    if (q === undefined || Math.hypot(...matApply(v, p[0] - q[0], p[1] - q[1])) >= least) {
      kept.push(p);
    }
  }
  return kept;
}

/**
 * (T1)-(T7): the points a stroke places on the edge it paints over, in the order painted, up to where
 * it turns back.  ``memo``, kept with a growing stroke, saves the work its last placing did (the
 * result is the same without it).
 * @param {{data: Float32Array, width: number, imageRows: number}} image
 * @param {EdgeMap} edges     of the same image
 * @param {Point[]} stroke    stored
 * @param {TraceOptions} options
 * @param {Frame} frame
 * @param {TraceMemo|null} [memo]
 * @returns {Point[]}
 */
function traceStroke(image, edges, stroke, options, frame, memo = null) {
  const stations = firstLeg(strokeStations(stroke, options.spacing, options.radius, frame));
  if (stations.length === 0) {
    return [];
  }
  const kept = memoFor(memo, edges, options, frame);
  const cuts = sampleCuts(edges, stations, options.radius, kept);
  const found = bestPath(cuts, options, kept);
  const det = Math.abs(matDet(viewMatrix(frame)));
  const samples = Math.max(1, (2 * options.radius * options.spacing) / (det * edges.sigma * edges.sigma));
  const threshold = Math.sqrt(options.minContrast ** 2 + Math.log2(samples));
  const placing = placingStations(cuts, found, threshold);
  return cutPoints(image, edges.sigma, { stations, cuts, ...found, placing }, options, frame, kept);
}

/**
 * Alt: the stations of a stroke as drawn (T1), without the edge, and its end when that lies at least
 * half a spacing beyond the last of them.
 * @param {Point[]} stroke
 * @param {number} spacing
 * @param {Frame} frame
 * @returns {Point[]}
 */
function freehandStroke(stroke, spacing, frame) {
  const points = strokeStations(stroke, spacing, 0, frame).map((s) => s.at);
  const [end, last] = [stroke[stroke.length - 1], points[points.length - 1]];
  if (end !== undefined && last !== undefined
      && Math.hypot(...matApply(viewMatrix(frame), end[0] - last[0], end[1] - last[1])) >= spacing / 2) {
    points.push([end[0], end[1]]);
  }
  return points;
}

/**
 * (T8): how near a stored point lies to the stretch of edge a stroke's points cover: its distance in
 * the view from their polyline, when that is within ``radius`` and the point lies not beyond either
 * end by more than half a ``spacing``; else Infinity.  For a single point, within half a spacing.
 * @param {Point[]} points    the stroke's, in order
 * @param {number} radius
 * @param {number} spacing
 * @param {Frame} frame
 * @returns {(p: Point) => number}
 */
function stretchNearness(points, radius, spacing, frame) {
  const v = viewMatrix(frame);
  const w = points.map((p) => matApply(v, p[0], p[1]));
  /** @param {Point} q @param {Point} end @param {Point} next @returns {number} how far q lies beyond ``end`` */
  const beyond = (q, end, next) => {
    const [dx, dy] = [end[0] - next[0], end[1] - next[1]];
    const length = Math.hypot(dx, dy);
    return length > 0 ? ((q[0] - end[0]) * dx + (q[1] - end[1]) * dy) / length : 0;
  };
  return (p) => {
    const q = matApply(v, p[0], p[1]);
    if (w.length < 2) {
      const d = w.length === 1 ? Math.hypot(q[0] - w[0][0], q[1] - w[0][1]) : Infinity;
      return d <= Math.min(radius, spacing / 2) ? d : Infinity;
    }
    if (beyond(q, w[0], w[1]) > spacing / 2 || beyond(q, w[w.length - 1], w[w.length - 2]) > spacing / 2) {
      return Infinity;
    }
    let d = Infinity;
    for (let i = 1; i < w.length; i++) {
      d = Math.min(d, distanceToSegment(q, w[i - 1], w[i]));
    }
    return d <= radius ? d : Infinity;
  };
}

/**
 * @param {Point} p
 * @param {Point} a
 * @param {Point} b
 * @returns {number} the distance from p to the segment from a to b
 */
function distanceToSegment(p, a, b) {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const squared = dx * dx + dy * dy;
  const t = squared > 0 ? Math.min(1, Math.max(0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / squared)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

/**
 * (T8): the runs of consecutive vertices that ``nearness`` covers (a finite distance), a closed
 * contour's last and first run joined when they meet, each with the sum of its vertices' distances.
 * @param {Point[]} points
 * @param {boolean} closed
 * @param {(p: Point) => number} nearness
 * @returns {Array<{first: number, count: number, sum: number}>}
 */
function coveredRuns(points, closed, nearness) {
  const n = points.length;
  const near = points.map(nearness);
  /** @type {Array<{first: number, count: number, sum: number}>} */
  const runs = [];
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(near[i]) && (i === 0 || !Number.isFinite(near[i - 1]))) {
      let [j, sum] = [i, 0];
      while (j < n && Number.isFinite(near[j])) {
        sum += near[j];
        j++;
      }
      runs.push({ first: i, count: j - i, sum });
    }
  }
  const last = runs[runs.length - 1];
  if (closed && runs.length > 1 && runs[0].first === 0 && last.first + last.count === n) {
    last.count += runs[0].count;                   // it runs on past the last vertex to the first
    last.sum += runs[0].sum;
    runs.shift();
  }
  return runs;
}

/**
 * (T8): a contour's points with those of a stroke joined: after the last vertex (``redo`` false), or
 * in place of the run of vertices that ``nearness`` covers nearest to them, by the mean distance (the
 * longer of two alike), or into the segment nearest them.
 * @param {Point[]} points    the contour's
 * @param {boolean} closed
 * @param {Point[]} added     the stroke's, in the order painted
 * @param {boolean} redo
 * @param {(p: Point) => number} nearness
 * @param {Frame} frame
 * @returns {{points: Point[], start: number, count: number, removed: number[]}}   the stroke's points are
 *     points[start ... start + count - 1]; ``removed``, the indices of the vertices they took the place of
 */
function joinStroke(points, closed, added, redo, nearness, frame) {
  const n = points.length;
  const v = viewMatrix(frame);
  if (added.length === 0) {
    return { points: [...points], start: n, count: 0, removed: [] };
  }
  /** @param {Point|null} a @param {Point} b @returns {number} */
  const gap = (a, b) => (a === null ? 0 : Math.hypot(...matApply(v, b[0] - a[0], b[1] - a[1])));
  /** @param {Point|null} before @param {Point|null} after @returns {Point[]} */
  const facing = (before, after) => {
    const [first, last] = [added[0], added[added.length - 1]];
    const turned = gap(before, last) + (after === null ? 0 : gap(first, after));
    return turned < gap(before, first) + (after === null ? 0 : gap(last, after)) ? [...added].reverse() : added;
  };
  const runs = redo ? coveredRuns(points, closed, nearness) : [];
  if (runs.length > 0) {
    const mean = (/** @type {{count: number, sum: number}} */ r) => r.sum / r.count;
    const run = runs.reduce((a, b) => (mean(b) < mean(a) || (mean(b) === mean(a) && b.count > a.count) ? b : a));
    const end = run.first + run.count;
    const all = run.count >= n;
    const before = all || (!closed && run.first === 0) ? null : points[(run.first - 1 + n) % n];
    const after = all || (!closed && end >= n) ? null : points[end % n];
    const placed = facing(before, after);
    const removed = Array.from({ length: run.count }, (_v, i) => (run.first + i) % n);
    if (end <= n) {
      return { points: [...points.slice(0, run.first), ...placed, ...points.slice(end)], start: run.first,
        count: placed.length, removed };
    }
    return { points: [...placed, ...points.slice(end - n, run.first)], start: 0, count: placed.length, removed };
  }
  if (redo && n >= 2) {
    const at = nearestSegment(points, closed, added[added.length >> 1], v);
    const placed = facing(points[at - 1], points[at % n]);
    return { points: [...points.slice(0, at), ...placed, ...points.slice(at)], start: at, count: placed.length, removed: [] };
  }
  const placed = n > 0 && gap(points[n - 1], added[added.length - 1]) < gap(points[n - 1], added[0]) ? [...added].reverse()
    : added;
  return { points: [...points, ...placed], start: n, count: placed.length, removed: [] };
}

/**
 * The index at which a point near segment (i, i + 1) goes: i + 1 for the segment nearest ``p`` in
 * the view, the closing one included for a closed contour of more than 2 vertices.
 * @param {Point[]} points    at least 2
 * @param {boolean} closed
 * @param {Point} p
 * @param {Mat2} v
 * @returns {number}
 */
function nearestSegment(points, closed, p, v) {
  const n = points.length;
  const q = points.map((a) => matApply(v, a[0], a[1]));
  const at = matApply(v, p[0], p[1]);
  const last = closed && n > 2 ? n : n - 1;
  let where = 1;
  let best = Infinity;
  for (let i = 0; i < last; i++) {
    const d = distanceToSegment(at, q[i], q[(i + 1) % n]);
    if (d < best) {
      best = d;
      where = i + 1;
    }
  }
  return where;
}
