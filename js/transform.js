"use strict";
/* exported CORRECTIONS, correctionFactor, correctionFactorOrNull, matMul, matInverse, matDet, matApply,
   rotationMatrix, tiltMatrix, measurementMatrix, viewMatrix, toMeasurement, fromMeasurement, normalizeDegrees,
   lineIntersection, measureContour, measureRuler, measureAngle, measureLineAngle, levelRotation, axisFromLine,
   viewStepToStored */
/*
 * Geometry: one affine map from the pixels of the image as stored to the measurement frame, the
 * view drawn through the same map, and the measures taken in that frame.  MATH.md, part 1,
 * derives every step at length; the equation numbers are those of MATH.md.
 *
 * Stored coordinates (G1).  Everything traced or measured is kept in pixel-centre coordinates of
 * the image as stored in the file, u = (x, y): x the column, y the row, y down; the pixel in row i
 * and column j is centred at (j, i) and covers [j - 1/2, j + 1/2] x [i - 1/2, i + 1/2].  A change of
 * pixel size, tilt correction, tilt axis, rotation or origin therefore moves nothing on the image:
 * it changes only the map below.
 *
 * Image formation (G2)-(G4).  At SEM magnifications the image is an orthographic projection along
 * the beam (fields of view of micrometres against working distances of millimetres).  Specimen
 * frame: t along the stage tilt axis, s in the surface across it, n the surface normal.  Tilting
 * the stage by theta about t turns the beam, as seen from the specimen, from -n to
 *
 *     b = sin(theta) s - cos(theta) n.
 *
 * The image plane is normal to b.  It contains t (t . b = 0), so take e1 = t, and the unit vector
 * normal to both b and t, e2 = cos(theta) s + sin(theta) n (e2 . b = cos sin - sin cos = 0).  A
 * specimen vector r = a t + l s + d n appears at (r . e1, r . e2):
 *
 *     r = a t + l s + d n   ->   (a, l cos(theta) + d sin(theta)).                          (G4)
 *
 * Correction (G5)-(G6).  In the surface (d = 0) the image is (a, l cos(theta)): the stretch
 * diag(1, 1 / cos(theta)) restores every vector of the surface exactly ("tilted-surface").  On a
 * face normal to the surface that contains the tilt axis (l = 0; a FIB cross-section) the image is
 * (a, d sin(theta)): diag(1, 1 / sin(theta)) restores it ("cross-section"; k = 1.269 at the 52 deg
 * of a DualBeam).  A vector with both l and d is not recoverable from one projection: the
 * correction is exact in the plane it is chosen for.
 *
 * Tilt axis in the image (G7).  The tilt axis appears along e1, at the angle alpha
 * (counter-clockwise) from the image's x axis, x right and y up, in physical units.  The stretch
 * by k acts across it:
 *
 *     K = R(alpha) diag(1, k) R(-alpha) = | c^2 + k s^2    (1 - k) c s  |,   c = cos(alpha),
 *                                         | (1 - k) c s    s^2 + k c^2  |    s = sin(alpha),
 *
 * which leaves (c, s) unchanged and multiplies (-s, c) by k.
 *
 * The map (G8).  With F = diag(1, -1) (y up), D = diag(p_x, p_y) / 1000 (um per pixel, from the
 * pixel size in nm; the identity, lengths in pixels, when it is unknown) and R(phi) a rotation by
 * phi counter-clockwise, the stored point u lies at
 *
 *     P = A (u - u0),     A = R(phi) K D F,                                                  (G8)
 *
 * u0 the stored point chosen as origin.  The rotation comes last: it is rigid, so lengths, angles
 * and areas do not depend on phi; only directions and bounding boxes turn with it.
 *
 *     det A = det R(phi) det K det D det F = 1 * k * (p_x p_y / 10^6) * (-1)               (G9)
 *
 * so areas scale by k p_x p_y / 10^6 um^2 per pixel^2.  The inverse (G10) is u = u0 + A^-1 P with
 * A^-1 = [[d, -b], [-c, a]] / det A for A = [[a, b], [c, d]].
 *
 * View (G11).  The view frame is (G8) in units of the pixel width and without origin,
 * V = R(phi) K diag(1, -p_y / p_x), so that a zoom of 1 shows one stored pixel per screen pixel.
 * On screen (CSS pixels, y down) a stored point lies at s F V (u + (1/2, 1/2)) + tau, s the zoom
 * and tau the pan; the canvas draws the stored picture through the same transform, pixel (i, j)
 * covering [j, j + 1] x [i, i + 1] in canvas units.  det(s F V) = s^2 k p_y / p_x > 0: the view is
 * never mirrored.  A step (dx, dy) on screen, in view units (x right, y down), is the stored step
 * (s F V)^-1 (s dx, s dy) = V^-1 F (dx, dy), whatever the zoom (F^-1 = F) (G15): the arrow keys
 * move vertices by one view unit, the width of a stored pixel, in the direction they show.
 *
 * Measures (G12).  Lengths |A du|; directions atan2 of A du, counter-clockwise from the X axis;
 * angles between vectors a and b as atan2(|a x b|, a . b), accurate at all angles (acos is not
 * near 0 and 180 deg); areas by the shoelace formula on the mapped points.  Two lines
 * p1 + s (p2 - p1) and p3 + t (p4 - p3) cross at
 *
 *     s = ((p3 - p1) x (p4 - p3)) / ((p2 - p1) x (p4 - p3)),
 *
 * (cross both sides of s e1 - t e2 = p3 - p1 with e2); an affine map keeps lines and their
 * crossings, so this is solved in stored coordinates.
 *
 * Levelling (G13).  Before the rotation the line p1 -> p2 has the direction beta of
 * K D F (p2 - p1).  It turns horizontal for phi = -beta + 180 n and vertical for
 * phi = 90 - beta + 180 n (degrees); the n nearest the present rotation turns the image by at most
 * 90 deg, and when two are 90 deg away (a vertical line made horizontal) the one with the smaller
 * |phi| is taken.  Tilt axis along a line (G14): alpha is the direction of D F (p2 - p1), modulo
 * 180 deg; by (G7) K leaves that direction unchanged.
 */

/** @typedef {[number, number]} Point */
/** A 2 x 2 matrix [[a, b], [c, d]] stored row by row as [a, b, c, d]. @typedef {[number, number, number, number]} Mat2 */
/**
 * A contour: the one kind of measurement with any number of points, a polygon when ``closed``, else
 * a polyline; ``layer`` is its GDSII layer and datatype, [1, 0] when absent.  ``color`` is the place
 * of a measurement's colour in the colour order of the overlay, 0, 1, 2, ... (app.js).
 * @typedef {{name: string, kind: "contour", closed: boolean, points: Point[], layer?: [number, number], color?: number,
 *   width?: undefined}} Contour
 */
/** The kinds of measurement with a set number of points (MEASURE_POINTS). @typedef {"ruler"|"angle"|"line-angle"|"profile"} FixedKind */
/**
 * A ruler (2 points), an angle (3 points: arm end, vertex, arm end), the angle between two lines
 * (4 points: line 1 from, to, line 2 from, to) or a line profile (2 points, and ``width``: the band
 * width in pixel widths of the corrected view, profile.js).
 * @typedef {{name: string, kind: FixedKind, points: Point[], width?: number, color?: number, closed?: undefined,
 *   layer?: undefined}} FixedMeasurement
 */
/** A measurement: a contour, or one of a set number of points. @typedef {Contour|FixedMeasurement} Measurement */
/** @typedef {"contour"|FixedKind} MeasureKind */

/**
 * The measurement frame, as set by the user: the parameters of (G8).
 * @typedef {Object} Frame
 * @property {[number, number]|null} pixelNm   pixel width and height (nm); null when unknown
 * @property {number} tiltDeg                  stage tilt theta
 * @property {string} correction               one of CORRECTIONS
 * @property {number} customFactor             k for "custom"
 * @property {number} axisDeg                  alpha: the tilt axis in the image, counter-clockwise from x
 * @property {number} rotationDeg              phi: rotation of the corrected image, counter-clockwise
 * @property {Point} originPx                  u0, stored coordinates
 */

/**
 * @typedef {Object} ContourMeasures
 * @property {number} vertices
 * @property {number} perimeter    closed: with the closing segment
 * @property {number} area         closed with three vertices or more; else 0
 * @property {number} width        bounding box in the measurement frame
 * @property {number} height
 * @property {"um"|"px"} unit
 */

/**
 * @typedef {Object} RulerMeasures
 * @property {number} length
 * @property {number} dx
 * @property {number} dy
 * @property {number} directionDeg   of point 1 -> 2, counter-clockwise from the X axis, in (-180, 180]
 * @property {"um"|"px"} unit
 */

/**
 * @typedef {Object} LineAngleMeasures
 * @property {number} angleDeg        between the directed lines 1 -> 2 and 3 -> 4, in [0, 180]
 * @property {Point|null} crossing    where the lines cross, stored coordinates; null when parallel
 */

const CORRECTIONS = ["none", "cross-section", "tilted-surface", "custom"];
const DEGREE = Math.PI / 180;
/** @type {Mat2} */
const FLIP = [1, 0, 0, -1];

/**
 * k of (G6): 1, 1 / sin(theta), 1 / cos(theta) or the custom factor.  Throws where it is not defined.
 * @param {Frame} frame
 * @returns {number}
 */
function correctionFactor(frame) {
  const theta = frame.tiltDeg * DEGREE;
  switch (frame.correction) {
    case "none":
      return 1;
    case "cross-section": {
      const s = Math.sin(theta);
      if (!(s > 1e-9)) {
        throw new Error("a cross-section correction needs a stage tilt above 0°");
      }
      return 1 / s;
    }
    case "tilted-surface": {
      const c = Math.cos(theta);
      if (!(c > 1e-9)) {
        throw new Error("a tilted-surface correction needs a stage tilt below 90°");
      }
      return 1 / c;
    }
    case "custom":
      if (!(Number.isFinite(frame.customFactor) && frame.customFactor > 0)) {
        throw new Error("the custom factor must be positive");
      }
      return frame.customFactor;
    default:
      throw new Error(`unknown correction "${frame.correction}"`);
  }
}

/**
 * correctionFactor, or null where it is not defined.
 * @param {Frame} frame
 * @returns {number|null}
 */
function correctionFactorOrNull(frame) {
  try {
    return correctionFactor(frame);
  } catch {
    return null;
  }
}

/**
 * @param {Mat2} a
 * @param {Mat2} b
 * @returns {Mat2} a b
 */
function matMul(a, b) {
  return [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3]];
}

/**
 * @param {Mat2} a
 * @returns {number}
 */
function matDet(a) {
  return a[0] * a[3] - a[1] * a[2];
}

/**
 * (G10): the inverse.  Throws for a singular matrix.
 * @param {Mat2} a
 * @returns {Mat2}
 */
function matInverse(a) {
  const d = matDet(a);
  if (!(Number.isFinite(d) && Math.abs(d) > 0)) {
    throw new Error("the matrix is singular");
  }
  return [a[3] / d, -a[1] / d, -a[2] / d, a[0] / d];
}

/**
 * @param {Mat2} a
 * @param {number} x
 * @param {number} y
 * @returns {Point} a (x, y)
 */
function matApply(a, x, y) {
  return [a[0] * x + a[1] * y, a[2] * x + a[3] * y];
}

/**
 * R: rotation by ``deg`` counter-clockwise (x right, y up).
 * @param {number} deg
 * @returns {Mat2}
 */
function rotationMatrix(deg) {
  const c = Math.cos(deg * DEGREE);
  const s = Math.sin(deg * DEGREE);
  return [c, -s, s, c];
}

/**
 * K of (G7): the stretch by k across a tilt axis at ``axisDeg``.
 * @param {number} k
 * @param {number} axisDeg
 * @returns {Mat2}
 */
function tiltMatrix(k, axisDeg) {
  const c = Math.cos(axisDeg * DEGREE);
  const s = Math.sin(axisDeg * DEGREE);
  return [c * c + k * s * s, (1 - k) * c * s, (1 - k) * c * s, s * s + k * c * c];
}

/**
 * D F of (G8): um per pixel with the pixel size, else pixels; y up.
 * @param {Frame} frame
 * @returns {Mat2}
 */
function scaleFlip(frame) {
  return frame.pixelNm ? [frame.pixelNm[0] / 1000, 0, 0, -frame.pixelNm[1] / 1000] : FLIP;
}

/**
 * A of (G8) and its unit; null when k is not defined.
 * @param {Frame} frame
 * @returns {{matrix: Mat2, unit: "um"|"px"}|null}
 */
function measurementMatrix(frame) {
  const k = correctionFactorOrNull(frame);
  if (k === null) {
    return null;
  }
  const matrix = matMul(rotationMatrix(frame.rotationDeg), matMul(tiltMatrix(k, frame.axisDeg), scaleFlip(frame)));
  return { matrix, unit: frame.pixelNm ? "um" : "px" };
}

/**
 * V of (G11): the view frame in units of the pixel width; k = 1 where it is not defined, so that
 * the image still shows.
 * @param {Frame} frame
 * @returns {Mat2}
 */
function viewMatrix(frame) {
  const k = correctionFactorOrNull(frame) ?? 1;
  const aspect = frame.pixelNm ? frame.pixelNm[1] / frame.pixelNm[0] : 1;
  return matMul(rotationMatrix(frame.rotationDeg), matMul(tiltMatrix(k, frame.axisDeg), [1, 0, 0, -aspect]));
}

/**
 * (G15): the stored step that moves a point by (dx, dy) view units on screen (x right, y down).
 * @param {Frame} frame
 * @param {number} dx
 * @param {number} dy
 * @returns {Point}
 */
function viewStepToStored(frame, dx, dy) {
  return matApply(matInverse(viewMatrix(frame)), dx, -dy);
}

/**
 * (G8): the measurement coordinates of a stored point; null when k is not defined.
 * @param {Frame} frame
 * @param {number} x
 * @param {number} y
 * @returns {Point|null}
 */
function toMeasurement(frame, x, y) {
  const m = measurementMatrix(frame);
  return m === null ? null : matApply(m.matrix, x - frame.originPx[0], y - frame.originPx[1]);
}

/**
 * (G10): the stored point at measurement coordinates (X, Y); null when k is not defined.
 * @param {Frame} frame
 * @param {number} X
 * @param {number} Y
 * @returns {Point|null}
 */
function fromMeasurement(frame, X, Y) {
  const m = measurementMatrix(frame);
  if (m === null) {
    return null;
  }
  const [dx, dy] = matApply(matInverse(m.matrix), X, Y);
  return [frame.originPx[0] + dx, frame.originPx[1] + dy];
}

/**
 * An angle reduced to (-period / 2, period / 2]: 360 for directions, 180 for lines.
 * @param {number} deg
 * @param {number} period
 * @returns {number}
 */
function normalizeDegrees(deg, period) {
  const half = period / 2;
  if (deg > -half && deg <= half) {
    return deg;                    // already in range: kept exactly as typed
  }
  const v = ((((deg + half) % period) + period) % period) - half;
  return v === -half ? half : v;
}

/**
 * Direction of (x, y), degrees counter-clockwise from the x axis, in (-180, 180].
 * @param {Point} v
 * @returns {number}
 */
function directionOf(v) {
  return normalizeDegrees(Math.atan2(v[1], v[0]) / DEGREE, 360);
}

/**
 * (G12): the angle between two vectors, degrees in [0, 180].
 * @param {Point} a
 * @param {Point} b
 * @returns {number}
 */
function angleBetween(a, b) {
  return Math.atan2(Math.abs(a[0] * b[1] - a[1] * b[0]), a[0] * b[0] + a[1] * b[1]) / DEGREE;
}

/**
 * (G12): where the lines p1 p2 and p3 p4 cross; null when they are parallel or a line is a point.
 * @param {Point} p1
 * @param {Point} p2
 * @param {Point} p3
 * @param {Point} p4
 * @returns {Point|null}
 */
function lineIntersection(p1, p2, p3, p4) {
  const e1 = [p2[0] - p1[0], p2[1] - p1[1]];
  const e2 = [p4[0] - p3[0], p4[1] - p3[1]];
  const den = e1[0] * e2[1] - e1[1] * e2[0];
  if (!(Math.abs(den) > 1e-12 * Math.hypot(e1[0], e1[1]) * Math.hypot(e2[0], e2[1]))) {
    return null;
  }
  const s = ((p3[0] - p1[0]) * e2[1] - (p3[1] - p1[1]) * e2[0]) / den;
  return [p1[0] + s * e1[0], p1[1] + s * e1[1]];
}

/**
 * Measures of a contour in the measurement frame (G12); null when k is not defined.
 * @param {{closed: boolean, points: Point[]}} contour
 * @param {Frame} frame
 * @returns {ContourMeasures|null}
 */
function measureContour(contour, frame) {
  const m = measurementMatrix(frame);
  if (m === null) {
    return null;
  }
  const [x0, y0] = frame.originPx;
  const q = contour.points.map((p) => matApply(m.matrix, p[0] - x0, p[1] - y0));
  const n = q.length;
  if (n === 0) {
    return { vertices: 0, perimeter: 0, area: 0, width: 0, height: 0, unit: m.unit };
  }
  const closed = contour.closed && n > 2;
  let perimeter = 0;
  let twiceArea = 0;
  for (let i = 0; i < n; i++) {
    const j = i + 1 < n ? i + 1 : 0;
    if (j === 0 && !closed) {
      break;
    }
    perimeter += Math.hypot(q[j][0] - q[i][0], q[j][1] - q[i][1]);
    twiceArea += q[i][0] * q[j][1] - q[j][0] * q[i][1];         // shoelace formula
  }
  const xs = q.map((p) => p[0]);
  const ys = q.map((p) => p[1]);
  return {
    vertices: n, perimeter, area: closed ? Math.abs(twiceArea) / 2 : 0,
    width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys), unit: m.unit,
  };
}

/**
 * A ruler from points[0] to points[1] (G12); null when k is not defined.
 * @param {Point[]} points
 * @param {Frame} frame
 * @returns {RulerMeasures|null}
 */
function measureRuler(points, frame) {
  const m = measurementMatrix(frame);
  if (m === null) {
    return null;
  }
  const d = matApply(m.matrix, points[1][0] - points[0][0], points[1][1] - points[0][1]);
  return { length: Math.hypot(d[0], d[1]), dx: d[0], dy: d[1], directionDeg: directionOf(d), unit: m.unit };
}

/**
 * The angle at points[1] between the arms to points[0] and points[2], degrees in [0, 180]
 * (G12); null when k is not defined.
 * @param {Point[]} points
 * @param {Frame} frame
 * @returns {number|null}
 */
function measureAngle(points, frame) {
  const m = measurementMatrix(frame);
  if (m === null) {
    return null;
  }
  const [a, v, b] = points;
  return angleBetween(matApply(m.matrix, a[0] - v[0], a[1] - v[1]), matApply(m.matrix, b[0] - v[0], b[1] - v[1]));
}

/**
 * The angle between the directed lines points[0] -> points[1] and points[2] -> points[3] (G12);
 * null when k is not defined.
 * @param {Point[]} points
 * @param {Frame} frame
 * @returns {LineAngleMeasures|null}
 */
function measureLineAngle(points, frame) {
  const m = measurementMatrix(frame);
  if (m === null) {
    return null;
  }
  const [p1, p2, p3, p4] = points;
  const d1 = matApply(m.matrix, p2[0] - p1[0], p2[1] - p1[1]);
  const d2 = matApply(m.matrix, p4[0] - p3[0], p4[1] - p3[1]);
  return { angleDeg: angleBetween(d1, d2), crossing: lineIntersection(p1, p2, p3, p4) };
}

/**
 * (G13): the rotation, degrees in (-180, 180], that turns the line p1 -> p2 horizontal or
 * vertical, the nearest to the present one; null when k is not defined.
 * @param {Frame} frame
 * @param {Point} p1
 * @param {Point} p2
 * @param {"horizontal"|"vertical"} target
 * @returns {number|null}
 */
function levelRotation(frame, p1, p2, target) {
  const unrotated = measurementMatrix({ ...frame, rotationDeg: 0 });
  if (unrotated === null) {
    return null;
  }
  const beta = directionOf(matApply(unrotated.matrix, p2[0] - p1[0], p2[1] - p1[1]));
  const goal = target === "horizontal" ? -beta : 90 - beta;
  const n = (frame.rotationDeg - goal) / 180;
  const [a, b] = [Math.floor(n), Math.ceil(n)].map((m) => goal + 180 * m);
  const turn = Math.abs(a - frame.rotationDeg) - Math.abs(b - frame.rotationDeg);
  // the smaller turn; when both are 90 deg (from vertical to horizontal), the smaller rotation
  const pick = Math.abs(turn) > 1e-9 ? (turn < 0 ? a : b)
    : (Math.abs(normalizeDegrees(a, 360)) <= Math.abs(normalizeDegrees(b, 360)) ? a : b);
  return normalizeDegrees(pick, 360);
}

/**
 * (G14): the tilt axis angle, degrees in (-90, 90], of a line p1 -> p2 taken parallel to it.
 * @param {Frame} frame
 * @param {Point} p1
 * @param {Point} p2
 * @returns {number}
 */
function axisFromLine(frame, p1, p2) {
  return normalizeDegrees(directionOf(matApply(scaleFlip(frame), p2[0] - p1[0], p2[1] - p1[1])), 180);
}
