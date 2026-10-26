"use strict";
/* global CORRECTIONS, correctionFactorOrNull, measurementMatrix, toMeasurement, measureRuler, measureAngle,
   measureLineAngle, profileGeometry */
/* exported formatPolygonFile, parsePolygonFile, frameFromMeta, formatMeasurementFile, formatProfileFile */
/*
 * The CSV files of FORMAT.md: the polygon file, the interface to a mode solver or any program that
 * takes the traced contours; the measurements file, for a spreadsheet or a report; and the profile
 * file, the samples of one line profile.  All header the measurement frame of transform.js: its
 * parameters, for the record and to restore them, and the matrix px_to_um, A of (G8), which is all
 * a reader needs to go between pixels and micrometres:
 *
 *     (x_um, y_um) = A (x_px - origin_x, y_px - origin_y).                                 (C1)
 */

/**
 * @typedef {Object} ImageInfo
 * @property {string} name
 * @property {string|null} sha256
 * @property {number} width
 * @property {number} height
 * @property {number} databarRows
 * @property {string|null} microscope
 */

/**
 * @typedef {Object} PolygonFile
 * @property {Record<string, string>} meta     the header's "# key: value" lines
 * @property {Array<{name: string, closed: boolean, px: Point[]|null, um: Point[]|null}>} contours
 */

const POLYGON_FORMAT_LINE = "# sem-measurement-tool polygons 1";
const MEASUREMENT_FORMAT_LINE = "# sem-measurement-tool measurements 1";
const PROFILE_FORMAT_LINE = "# sem-measurement-tool profile 1";
const REQUIRED_COLUMNS = ["contour", "closed", "vertex", "x_um", "y_um"];

/**
 * A CSV field, quoted per RFC 4180 when it contains a comma or a double quote.
 * @param {string} text
 * @returns {string}
 */
function csvField(text) {
  const one = text.replace(/[\r\n]+/g, " ");
  return /[",]/.test(one) ? `"${one.replace(/"/g, '""')}"` : one;
}

/**
 * The fields of one CSV line (RFC 4180 quoting, no line breaks inside fields).
 * @param {string} line
 * @returns {string[]}
 */
function csvFields(line) {
  const out = [];
  let i = 0;
  while (i <= line.length) {
    if (line[i] === '"') {
      let value = "";
      i++;
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') {
          value += '"';
          i += 2;
        } else if (line[i] === '"') {
          i++;
          break;
        } else {
          value += line[i++];
        }
      }
      out.push(value);
      i = line.indexOf(",", i) < 0 ? line.length + 1 : line.indexOf(",", i) + 1;
    } else {
      const end = line.indexOf(",", i);
      out.push((end < 0 ? line.slice(i) : line.slice(i, end)).trim());
      i = end < 0 ? line.length + 1 : end + 1;
    }
  }
  return out;
}

/**
 * A number as written in the file: ``digits`` decimals, without a negative zero.
 * @param {number} value
 * @param {number} digits
 * @returns {string}
 */
function formatNumber(value, digits) {
  const s = value.toFixed(digits);
  return /^-0\.?0*$/.test(s) ? s.slice(1) : s;
}

/**
 * The header lines of the image and of the measurement frame, shared by both files.
 * @param {ImageInfo} image
 * @param {Frame} frame
 * @returns {string[]}
 */
function headerLines(image, frame) {
  const lines = [`# image: ${image.name.replace(/[\r\n]+/g, " ")}`];
  if (image.sha256) {
    lines.push(`# image_sha256: ${image.sha256}`);
  }
  lines.push(`# image_size_px: ${image.width} ${image.height}`, `# databar_rows: ${image.databarRows}`);
  if (image.microscope) {
    lines.push(`# microscope: ${image.microscope.replace(/[\r\n]+/g, " ")}`);
  }
  if (frame.pixelNm) {
    lines.push(`# pixel_size_nm: ${frame.pixelNm[0]} ${frame.pixelNm[1]}`);
  }
  lines.push(`# tilt_deg: ${frame.tiltDeg}`, `# correction: ${frame.correction}`);
  if (frame.correction === "custom") {
    lines.push(`# custom_factor: ${frame.customFactor}`);
  }
  const k = correctionFactorOrNull(frame);
  if (k !== null) {
    lines.push(`# correction_factor: ${k.toPrecision(10)}`);
  }
  lines.push(`# tilt_axis_deg: ${frame.axisDeg}`, `# rotation_deg: ${frame.rotationDeg}`,
    `# origin_px: ${frame.originPx[0]} ${frame.originPx[1]}`);
  const m = measurementMatrix(frame);
  if (m !== null && m.unit === "um") {
    lines.push(`# px_to_um: ${m.matrix.map((v) => Number(v.toPrecision(10))).join(" ")}`);
  }
  return lines;
}

/**
 * The polygon file (FORMAT.md) for ``contours`` traced on ``image``.
 * @param {ImageInfo} image
 * @param {Frame} frame
 * @param {Contour[]} contours
 * @param {string} snap     snap settings, for the record
 * @returns {string}
 */
function formatPolygonFile(image, frame, contours, snap) {
  const physical = frame.pixelNm !== null && correctionFactorOrNull(frame) !== null;
  const lines = [POLYGON_FORMAT_LINE, ...headerLines(image, frame), `# snap: ${snap}`,
    "# (x_um, y_um) = px_to_um (x_px - origin_x, y_px - origin_y), px_to_um = [[a, b], [c, d]] given as a b c d",
    "contour,closed,vertex,x_um,y_um,x_px,y_px"];
  for (const c of contours) {
    c.points.forEach((p, i) => {
      const um = physical ? toMeasurement(frame, p[0], p[1]) : null;
      const columns = um === null ? ["", ""] : [formatNumber(um[0], 6), formatNumber(um[1], 6)];
      lines.push([csvField(c.name), c.closed ? "1" : "0", String(i), ...columns,
        formatNumber(p[0], 3), formatNumber(p[1], 3)].join(","));
    });
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Read a polygon file (FORMAT.md).  Throws on anything that breaks the format.
 * @param {string} text
 * @returns {PolygonFile}
 */
function parsePolygonFile(text) {
  const lines = text.split(/\r?\n/);
  const first = lines[0] || "";
  const BYTE_ORDER_MARK = 0xfeff;
  if ((first.charCodeAt(0) === BYTE_ORDER_MARK ? first.slice(1) : first).trim() !== POLYGON_FORMAT_LINE) {
    throw new Error(`not a polygon file of version 1: the first line must be "${POLYGON_FORMAT_LINE}"`);
  }
  /** @type {Record<string, string>} */
  const meta = {};
  /** @type {string[]|null} */
  let columns = null;
  /** @type {Map<string, {name: string, closed: boolean, rows: number, px: Point[], um: Point[], hasPx: boolean, hasUm: boolean}>} */
  const byName = new Map();
  for (let n = 1; n < lines.length; n++) {
    const line = lines[n];
    if (line.trim() === "") {
      continue;
    }
    if (line.startsWith("#")) {
      const m = /^#\s*([a-z0-9_]+)\s*:\s*(.*)$/.exec(line);
      if (m && columns === null) {
        meta[m[1]] = m[2].trim();
      }
      continue;
    }
    const fields = csvFields(line);
    if (columns === null) {
      columns = fields.map((f) => f.trim());
      const missing = REQUIRED_COLUMNS.filter((c) => !(columns || []).includes(c));
      if (missing.length) {
        throw new Error(`line ${n + 1}: the columns ${missing.join(", ")} are missing`);
      }
      continue;
    }
    const cols = columns;
    /** @param {string} name */
    const field = (name) => (cols.includes(name) ? fields[cols.indexOf(name)] || "" : "");
    /** @param {string} name */
    const number = (name) => {
      const value = Number(field(name));
      if (field(name) === "" || !Number.isFinite(value)) {
        throw new Error(`line ${n + 1}: ${name} is not a number: "${field(name)}"`);
      }
      return value;
    };
    const name = field("contour");
    let entry = byName.get(name);
    if (entry === undefined) {
      entry = { name, closed: field("closed") === "1", rows: 0, px: [], um: [], hasPx: true, hasUm: true };
      byName.set(name, entry);
    }
    if (number("vertex") !== entry.rows) {
      throw new Error(`line ${n + 1}: vertex ${field("vertex")} of "${name}" is out of order (expected ${entry.rows})`);
    }
    entry.rows++;
    if (field("x_px") !== "" && field("y_px") !== "") {
      entry.px.push([number("x_px"), number("y_px")]);
    } else {
      entry.hasPx = false;
    }
    if (field("x_um") !== "" && field("y_um") !== "") {
      entry.um.push([number("x_um"), number("y_um")]);
    } else {
      entry.hasUm = false;
    }
  }
  if (columns === null) {
    throw new Error("no column header line");
  }
  return {
    meta,
    contours: [...byName.values()].map((e) => ({
      name: e.name, closed: e.closed, px: e.hasPx ? e.px : null, um: e.hasUm ? e.um : null,
    })),
  };
}

/**
 * The measurement frame of a file's header; what it does not give (or gives unreadably) is taken
 * from ``base``.
 * @param {Record<string, string>} meta
 * @param {Frame} base
 * @returns {Frame}
 */
function frameFromMeta(meta, base) {
  /** @param {string|undefined} value @returns {number[]} */
  const numbers = (value) => (value || "").split(/\s+/).filter((v) => v !== "").map(Number);
  /** @param {string} key @param {number} fallback @returns {number} */
  const number = (key, fallback) => {
    const v = meta[key] === undefined || meta[key] === "" ? NaN : Number(meta[key]);
    return Number.isFinite(v) ? v : fallback;
  };
  /** @type {Frame} */
  const frame = { ...base, originPx: [base.originPx[0], base.originPx[1]] };
  const pixel = numbers(meta.pixel_size_nm);
  if (pixel.length >= 2 && pixel.every((v) => Number.isFinite(v) && v > 0)) {
    frame.pixelNm = [pixel[0], pixel[1]];
  }
  frame.tiltDeg = number("tilt_deg", base.tiltDeg);
  if (meta.correction && CORRECTIONS.includes(meta.correction)) {
    frame.correction = meta.correction;
  }
  const custom = number("custom_factor", NaN);
  if (custom > 0) {
    frame.customFactor = custom;
  }
  frame.axisDeg = number("tilt_axis_deg", base.axisDeg);
  frame.rotationDeg = number("rotation_deg", base.rotationDeg);
  const origin = numbers(meta.origin_px);
  if (origin.length >= 2 && origin.every(Number.isFinite)) {
    frame.originPx = [origin[0], origin[1]];
  }
  return frame;
}

/**
 * The fields of one measurement in the measurements file: value, unit, dx, dy, direction.
 * @param {Measurement} m
 * @param {Frame} frame
 * @param {number} digits     decimals of lengths
 * @returns {string[]}
 */
function measurementValues(m, frame, digits) {
  if (m.kind === "ruler" || m.kind === "profile") {
    const r = measureRuler(m.points, frame);
    return r === null ? ["", "", "", "", ""]
      : [formatNumber(r.length, digits), r.unit, formatNumber(r.dx, digits), formatNumber(r.dy, digits),
        formatNumber(r.directionDeg, 3)];
  }
  const angle = m.kind === "angle" ? measureAngle(m.points, frame) : measureLineAngle(m.points, frame)?.angleDeg ?? null;
  return angle === null ? ["", "deg", "", "", ""] : [formatNumber(angle, 3), "deg", "", "", ""];
}

/**
 * A grey value as written in the files: eight significant digits, nothing when missing.
 * @param {number|null} v
 * @returns {string}
 */
function greyField(v) {
  return v === null || !Number.isFinite(v) ? "" : String(Number(v.toPrecision(8)));
}

/**
 * The measurements file (FORMAT.md) for ``measurements`` taken on ``image``.  ``meanGrey`` gives
 * the mean grey value in a profile's band (null when it has none).
 * @param {ImageInfo} image
 * @param {Frame} frame
 * @param {Measurement[]} measurements
 * @param {(ms: Measurement) => number|null} [meanGrey]
 * @returns {string}
 */
function formatMeasurementFile(image, frame, measurements, meanGrey = () => null) {
  const m = measurementMatrix(frame);
  const unit = m === null ? null : m.unit;
  const lines = [MEASUREMENT_FORMAT_LINE, ...headerLines(image, frame)];
  if (unit !== null) {
    lines.push(`# unit: ${unit}`);
  }
  lines.push("# lengths in the unit above, angles in degrees; points in pixels of the image as stored; width and " +
    "mean_grey: the band of a line profile",
  "name,kind,value,unit,dx,dy,direction_deg,x1_px,y1_px,x2_px,y2_px,x3_px,y3_px,x4_px,y4_px,width,mean_grey");
  const digits = unit === "um" ? 6 : 3;
  for (const ms of measurements) {
    const points = [];
    for (let i = 0; i < 4; i++) {
      const p = ms.points[i];
      points.push(p ? formatNumber(p[0], 3) : "", p ? formatNumber(p[1], 3) : "");
    }
    const band = ms.kind === "profile" && unit !== null
      ? [formatNumber(profileGeometry(ms.points, ms.width ?? 1, frame).width, digits), greyField(meanGrey(ms))] : ["", ""];
    lines.push([csvField(ms.name), ms.kind, ...measurementValues(ms, frame, digits), ...points, ...band].join(","));
  }
  return `${lines.join("\n")}\n`;
}

/**
 * The profile file (FORMAT.md) of the profile ``ms``: its samples (profile.js) and where the
 * contours cross it.
 * @param {ImageInfo} image
 * @param {Frame} frame
 * @param {Measurement} ms
 * @param {Profile} profile
 * @param {Array<{name: string, distance: number}>} crossings
 * @returns {string}
 */
function formatProfileFile(image, frame, ms, profile, crossings) {
  const g = profileGeometry(ms.points, ms.width ?? 1, frame);
  const digits = g.unit === "um" ? 6 : 3;
  const [p1, p2] = ms.points;
  const lines = [PROFILE_FORMAT_LINE, ...headerLines(image, frame)];
  if (g.unit !== null) {
    lines.push(`# unit: ${g.unit}`);
  }
  lines.push(`# profile: ${ms.name.replace(/[\r\n]+/g, " ")}`,
    `# from_px: ${formatNumber(p1[0], 3)} ${formatNumber(p1[1], 3)}`, `# to_px: ${formatNumber(p2[0], 3)} ${formatNumber(p2[1], 3)}`,
    `# band_width_px: ${Number((ms.width ?? 1).toPrecision(10))}`);
  if (g.unit !== null) {
    lines.push(`# length: ${formatNumber(g.length, digits)}`, `# band_width: ${formatNumber(g.width, digits)}`);
  }
  lines.push(`# samples: ${g.samples}`, `# lines_across: ${g.offsets.length}`);
  for (const c of crossings) {
    lines.push(`# crossing: ${Number.isFinite(c.distance) ? formatNumber(c.distance, digits) : "?"} ${c.name.replace(/[\r\n]+/g, " ")}`);
  }
  lines.push("# distance along the line in the unit above; mean, std and count of the grey values across the band",
    "distance,mean,std,count,x_px,y_px");
  for (let i = 0; i < profile.mean.length; i++) {
    const d = profile.distance[i];
    lines.push([Number.isFinite(d) ? formatNumber(d, digits) : "", greyField(profile.mean[i]), greyField(profile.spread[i]),
      String(profile.count[i]), formatNumber(profile.x[i], 3), formatNumber(profile.y[i], 3)].join(","));
  }
  return `${lines.join("\n")}\n`;
}
