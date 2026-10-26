"use strict";
/* global CORRECTIONS */
/* exported SESSION_FORMAT, MEASURE_POINTS, formatSession, parseSession */
/*
 * The session file (FORMAT.md): what it takes to resume the work on an image, as JSON.  The
 * image it belongs to (name, size and SHA-256, not the pixels), the measurement frame, the
 * contours, the measurements and the snap settings.  Derived values (lengths, angles, areas,
 * profiles) are not stored: they follow from the points, the frame and the image.  Points are
 * stored coordinates (transform.js, (G1)) rounded to 1e-4 pixel, far below what snapping resolves;
 * a profile's band width is in pixel widths of the corrected view (profile.js).
 */

/**
 * @typedef {Object} SnapSettings
 * @property {boolean} on
 * @property {number} sigmaPx
 * @property {number} median        0 (off), 3 or 5
 * @property {number} radiusPx
 * @property {number} minContrast
 */

/**
 * @typedef {Object} Session
 * @property {ImageInfo} image
 * @property {Frame} frame
 * @property {SnapSettings} snap
 * @property {Contour[]} contours
 * @property {Measurement[]} measurements
 * @property {number} activeContour
 * @property {[number, number]|null} display   the black and white levels; null: Auto
 */

const SESSION_FORMAT = "sem-measurement-tool session";
const SESSION_VERSION = 1;
/** Points of each kind of measurement. @type {Record<MeasureKind, number>} */
const MEASURE_POINTS = { ruler: 2, angle: 3, "line-angle": 4, profile: 2 };

/**
 * @param {number} v
 * @returns {number} rounded to 1e-4
 */
function round4(v) {
  return Math.round(v * 1e4) / 1e4;
}

/**
 * @param {Point[]} points
 * @returns {number[][]}
 */
function storedPoints(points) {
  return points.map((p) => [round4(p[0]), round4(p[1])]);
}

/**
 * The session file of ``session``, saved at ``saved`` (ISO 8601).
 * @param {Session} session
 * @param {string} saved
 * @returns {string}
 */
function formatSession(session, saved) {
  const { image, frame, snap } = session;
  const body = {
    format: SESSION_FORMAT,
    version: SESSION_VERSION,
    saved,
    image: {
      name: image.name, sha256: image.sha256, size_px: [image.width, image.height], databar_rows: image.databarRows,
      microscope: image.microscope,
    },
    frame: {
      pixel_size_nm: frame.pixelNm, tilt_deg: frame.tiltDeg, correction: frame.correction,
      custom_factor: frame.customFactor, tilt_axis_deg: frame.axisDeg, rotation_deg: frame.rotationDeg,
      origin_px: [round4(frame.originPx[0]), round4(frame.originPx[1])],
    },
    snap: {
      on: snap.on, sigma_px: snap.sigmaPx, median: snap.median, radius_px: snap.radiusPx, min_contrast: snap.minContrast,
    },
    contours: session.contours.map((c) => ({
      name: c.name, closed: c.closed, gds_layer: c.layer ?? [1, 0], points_px: storedPoints(c.points),
    })),
    measurements: session.measurements.map((m) => (m.kind === "profile"
      ? { name: m.name, kind: m.kind, width_px: round4(m.width ?? 1), points_px: storedPoints(m.points) }
      : { name: m.name, kind: m.kind, points_px: storedPoints(m.points) })),
    active_contour: session.activeContour,
    display: session.display === null ? undefined
      : { black_level: Number(session.display[0].toPrecision(10)), white_level: Number(session.display[1].toPrecision(10)) },
  };
  // one line per point: [x, y] pairs stay together
  return `${JSON.stringify(body, null, 2).replace(/\[\s+(-?[\d.eE+-]+),\s+(-?[\d.eE+-]+)\s+\]/g, "[$1, $2]")}\n`;
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @param {string} what
 * @returns {Record<string, unknown>}
 */
function objectAt(value, what) {
  if (!isObject(value)) {
    throw new Error(`${what} must be an object`);
  }
  return value;
}

/**
 * @param {unknown} value
 * @param {string} what
 * @param {(v: number) => boolean} [ok]
 * @returns {number}
 */
function numberAt(value, what, ok = () => true) {
  if (typeof value !== "number" || !Number.isFinite(value) || !ok(value)) {
    throw new Error(`${what} is not a valid number: ${JSON.stringify(value)}`);
  }
  return value;
}

/**
 * @param {unknown} value
 * @param {string} what
 * @returns {Point}
 */
function pointAt(value, what) {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new Error(`${what} must be a pair [x, y]`);
  }
  return [numberAt(value[0], `${what}[0]`), numberAt(value[1], `${what}[1]`)];
}

/**
 * @param {unknown} value
 * @param {string} what
 * @returns {Point[]}
 */
function pointsAt(value, what) {
  if (!Array.isArray(value)) {
    throw new Error(`${what} must be an array of points`);
  }
  return value.map((p, i) => pointAt(p, `${what}[${i}]`));
}

/**
 * A GDSII layer and datatype: integers in 0-32767.
 * @param {unknown} value
 * @param {string} what
 * @returns {[number, number]}
 */
function layerAt(value, what) {
  const [layer, datatype] = pointAt(value, what);
  const ok = (/** @type {number} */ v) => Number.isInteger(v) && v >= 0 && v <= 32767;
  if (!ok(layer) || !ok(datatype)) {
    throw new Error(`${what} must be a layer and a datatype, integers in 0-32767`);
  }
  return [layer, datatype];
}

/**
 * @param {unknown} value
 * @param {string} what
 * @param {Set<string>} seen     names met so far, to refuse a repeated one
 * @returns {string}
 */
function nameAt(value, what, seen) {
  if (typeof value !== "string" || value.trim() === "" || /[\r\n]/.test(value)) {
    throw new Error(`${what} must be a name on one line`);
  }
  if (seen.has(value)) {
    throw new Error(`${what}: the name "${value}" is used twice`);
  }
  seen.add(value);
  return value;
}

/**
 * @param {unknown} value
 * @returns {ImageInfo}
 */
function imageAt(value) {
  const image = objectAt(value, "image");
  const size = pointAt(image.size_px, "image.size_px");
  const text = (/** @type {unknown} */ v) => (typeof v === "string" ? v : null);
  return {
    name: text(image.name) ?? "", sha256: text(image.sha256), width: size[0], height: size[1],
    databarRows: numberAt(image.databar_rows ?? 0, "image.databar_rows", (v) => v >= 0 && Number.isInteger(v)),
    microscope: text(image.microscope),
  };
}

/**
 * @param {unknown} value
 * @returns {Frame}
 */
function frameAt(value) {
  const f = objectAt(value, "frame");
  let pixelNm = null;
  if (f.pixel_size_nm !== null && f.pixel_size_nm !== undefined) {
    const p = pointAt(f.pixel_size_nm, "frame.pixel_size_nm");
    if (!(p[0] > 0 && p[1] > 0)) {
      throw new Error("frame.pixel_size_nm must be positive");
    }
    pixelNm = p;
  }
  if (typeof f.correction !== "string" || !CORRECTIONS.includes(f.correction)) {
    throw new Error(`frame.correction must be one of ${CORRECTIONS.join(", ")}`);
  }
  return {
    pixelNm, tiltDeg: numberAt(f.tilt_deg, "frame.tilt_deg"), correction: f.correction,
    customFactor: numberAt(f.custom_factor ?? 1, "frame.custom_factor", (v) => v > 0),
    axisDeg: numberAt(f.tilt_axis_deg ?? 0, "frame.tilt_axis_deg"),
    rotationDeg: numberAt(f.rotation_deg ?? 0, "frame.rotation_deg"),
    originPx: pointAt(f.origin_px, "frame.origin_px"),
  };
}

/**
 * @param {unknown} value
 * @returns {SnapSettings}
 */
function snapAt(value) {
  if (value === undefined) {
    return { on: false, sigmaPx: 2, median: 3, radiusPx: 12, minContrast: 3 };
  }
  const s = objectAt(value, "snap");
  return {
    on: s.on === true,
    sigmaPx: numberAt(s.sigma_px, "snap.sigma_px", (v) => v > 0),
    median: numberAt(s.median, "snap.median", (v) => v === 0 || v === 3 || v === 5),
    radiusPx: numberAt(s.radius_px, "snap.radius_px", (v) => v > 0),
    minContrast: numberAt(s.min_contrast, "snap.min_contrast", (v) => v > 0),
  };
}

/**
 * Read a session file (FORMAT.md).  Throws on anything that breaks the format.
 * @param {string} text
 * @returns {Session}
 */
function parseSession(text) {
  /** @type {unknown} */
  let body;
  try {
    body = JSON.parse(text);
  } catch (err) {
    throw new Error(`not JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  const root = objectAt(body, "the file");
  if (root.format !== SESSION_FORMAT) {
    throw new Error(`not a session file: "format" must be "${SESSION_FORMAT}"`);
  }
  if (root.version !== SESSION_VERSION) {
    throw new Error(`a session file of version ${JSON.stringify(root.version)}; this app reads version ${SESSION_VERSION}`);
  }
  if (!Array.isArray(root.contours) || !Array.isArray(root.measurements)) {
    throw new Error('"contours" and "measurements" must be arrays');
  }
  const contourNames = new Set();
  const contours = root.contours.map((c, i) => {
    const o = objectAt(c, `contours[${i}]`);
    /** @type {Contour} */
    const contour = {
      name: nameAt(o.name, `contours[${i}].name`, contourNames), closed: o.closed !== false,
      points: pointsAt(o.points_px, `contours[${i}].points_px`),
    };
    if (o.gds_layer !== undefined) {
      contour.layer = layerAt(o.gds_layer, `contours[${i}].gds_layer`);
    }
    return contour;
  });
  const measureNames = new Set();
  const measurements = root.measurements.map((m, i) => {
    const o = objectAt(m, `measurements[${i}]`);
    const kind = /** @type {MeasureKind} */ (o.kind);
    if (!Object.prototype.hasOwnProperty.call(MEASURE_POINTS, kind)) {
      throw new Error(`measurements[${i}].kind must be one of ${Object.keys(MEASURE_POINTS).join(", ")}`);
    }
    const points = pointsAt(o.points_px, `measurements[${i}].points_px`);
    if (points.length !== MEASURE_POINTS[kind]) {
      throw new Error(`measurements[${i}]: a ${kind} has ${MEASURE_POINTS[kind]} points, not ${points.length}`);
    }
    /** @type {Measurement} */
    const ms = { name: nameAt(o.name, `measurements[${i}].name`, measureNames), kind, points };
    if (kind === "profile") {
      ms.width = numberAt(o.width_px ?? 1, `measurements[${i}].width_px`, (v) => v >= 0);
    }
    return ms;
  });
  const active = typeof root.active_contour === "number" && Number.isInteger(root.active_contour)
    ? Math.min(Math.max(root.active_contour, 0), Math.max(contours.length - 1, 0)) : 0;
  return {
    image: imageAt(root.image), frame: frameAt(root.frame), snap: snapAt(root.snap), contours, measurements,
    activeContour: active, display: displayAt(root.display),
  };
}

/**
 * The display levels, or null (Auto) when the file has none.
 * @param {unknown} value
 * @returns {[number, number]|null}
 */
function displayAt(value) {
  if (value === undefined) {
    return null;
  }
  const d = objectAt(value, "display");
  const black = numberAt(d.black_level, "display.black_level");
  const white = numberAt(d.white_level, "display.white_level");
  if (!(black < white)) {
    throw new Error("display.black_level must lie below display.white_level");
  }
  return [black, white];
}
