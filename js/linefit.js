"use strict";
/* exported fitLine */
/*
 * A straight line fitted to points of a contour, and how far each point lies from it: a simple measure
 * of line edge roughness.  MATH.md, Part 8, gives the same derivations with more words.  The points
 * are in the measurement frame (G8), micrometres or, without a pixel size, pixels, corrected for the
 * tilt: the residuals are then lengths on the specimen.
 *
 * The line (L1).  Of all lines, the one that minimises the sum of the squared perpendicular distances
 * of the points q_i, i = 1 ... n (total least squares).  A line is the set of points q with
 * n . q = c, for a unit normal n.  F = sum (n . q_i - c)^2, set stationary in c, gives c = n . q_bar:
 * the line passes through the centroid q_bar.  With u_i = q_i - q_bar, F = n^T S n for the scatter
 * matrix S = sum u_i u_i^T = [[a, b], [b, d]].  With n = (-sin theta, cos theta),
 *
 *     F(theta) = (a + d) / 2 - R cos(2 theta - phi),   R = sqrt(((a - d) / 2)^2 + b^2),
 *     phi = atan2(2 b, a - d),
 *
 * least at theta = phi / 2, where F = (a + d) / 2 - R, the smaller eigenvalue of S.  The line runs
 * along t = (cos theta, sin theta), the eigenvector of the larger.  A fit of y on x would depend on the
 * line's angle and on the frame's rotation, and fail for a steep line; this one depends on neither.
 *
 * Residuals (L2).  r_i = n . u_i, the signed distance of q_i from the line, positive to the left of t,
 * which points from the first point toward the last.  The place along the line is
 * s_i = t . (q_i - q_1), from the first point's foot.
 *
 * Figures (L3).  sigma = sqrt(sum r_i^2 / (n - 2)): the fit takes two parameters, the angle and the
 * offset, and n independent deviations of variance sigma^2 leave a sum of squares of (n - 2) sigma^2
 * on average.  3 sigma is the usual figure of line edge roughness; the peak to valley is
 * max r - min r, and the length max s - min s.
 *
 * The angle (L4).  theta, the line's angle counter-clockwise from +X, in (-90, 90] degrees.
 */

/**
 * @typedef {Object} LineFit
 * @property {Point} centroid        q_bar
 * @property {Point} direction       t: a unit vector along the line, from the first point toward the last
 * @property {Point} normal          n: t turned 90 degrees counter-clockwise; residuals are positive on its side
 * @property {number[]} along        s_i: each point's place along the line, from the first point's foot
 * @property {number[]} residuals    r_i: each point's signed distance from the line
 * @property {number} sigma          sqrt(sum r^2 / (n - 2)); NaN for fewer than 3 points
 * @property {number} peakToValley   max r - min r
 * @property {number} length         max s - min s
 * @property {number} angleDeg       theta: the line's angle, counter-clockwise from +X, in (-90, 90]
 */

/**
 * (L1)-(L4): the line fitted to ``points`` by total least squares, each point's place along it and its
 * residual, and the figures; null for fewer than 2 points, or points that all coincide.
 * @param {Point[]} points    in order: the line runs from the first toward the last
 * @returns {LineFit|null}
 */
function fitLine(points) {
  const n = points.length;
  if (n < 2) {
    return null;
  }
  let [cx, cy] = [0, 0];
  for (const [x, y] of points) {
    cx += x;
    cy += y;
  }
  [cx, cy] = [cx / n, cy / n];
  let [a, b, d] = [0, 0, 0];                       // the scatter matrix, from the centred points: no cancellation
  for (const [x, y] of points) {
    const [u, v] = [x - cx, y - cy];
    a += u * u;
    b += u * v;
    d += v * v;
  }
  if (!(a + d > 0)) {
    return null;
  }
  const theta = 0.5 * Math.atan2(2 * b, a - d);
  const [first, last] = [points[0], points[n - 1]];
  const sense = Math.cos(theta) * (last[0] - first[0]) + Math.sin(theta) * (last[1] - first[1]) < 0 ? -1 : 1;
  /** @type {Point} */
  const t = [sense * Math.cos(theta), sense * Math.sin(theta)];
  /** @type {Point} */
  const normal = [-t[1], t[0]];
  const along = points.map(([x, y]) => t[0] * (x - first[0]) + t[1] * (y - first[1]));
  const residuals = points.map(([x, y]) => normal[0] * (x - cx) + normal[1] * (y - cy));
  let [squares, rLo, rHi, sLo, sHi] = [0, Infinity, -Infinity, Infinity, -Infinity];
  residuals.forEach((r, i) => {
    squares += r * r;
    [rLo, rHi] = [Math.min(rLo, r), Math.max(rHi, r)];
    [sLo, sHi] = [Math.min(sLo, along[i]), Math.max(sHi, along[i])];
  });
  return {
    centroid: [cx, cy], direction: t, normal, along, residuals,
    sigma: n > 2 ? Math.sqrt(squares / (n - 2)) : NaN,
    peakToValley: rHi - rLo,
    length: sHi - sLo,
    angleDeg: theta <= -Math.PI / 2 ? 90 : (theta * 180) / Math.PI,    // -90 is the same line as 90
  };
}
