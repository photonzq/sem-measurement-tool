"use strict";
/* global decodeSEMImage, emptyCalibration, describeCalibration, EdgeMap, correctionFactor,
   matApply, matInverse, matDet, viewMatrix, toMeasurement, fromMeasurement, normalizeDegrees, measureContour,
   measureRuler, measureAngle, measureLineAngle, levelRotation, axisFromLine, lineIntersection, measurementMatrix,
   viewStepToStored, formatPolygonFile, parsePolygonFile, frameFromMeta, formatMeasurementFile, MEASURE_POINTS,
   formatSession, parseSession, formatGds, gdsName, moveSelected, dropSelected, makeFirst, reverseContour,
   selectionRange, valueRange, fixedSpan, histogramOf, autoLevels, greyMap, sliderBrightness, sliderContrast,
   centreOfBrightness, widthOfContrast, profileGeometry, sampleProfile, profileCrossings, widthHandle,
   widthFromPoint, formatProfileFile */
/*
 * The SEM measurement tool: open an image, trace contours and take measurements (rulers, angles, profiles) with
 * optional snapping to edges, correct a tilted specimen, turn the image, and keep the work in a
 * session file, with exports for a mode solver, a layout tool (GDSII) and a spreadsheet
 * (FORMAT.md).  A floating window lists the vertices of the active contour in the measurement
 * frame and edits them.  Everything runs in the page; files are read with the File API and saved
 * as downloads.
 *
 * Coordinates (transform.js).  Contour vertices, measurement points and the origin are kept in
 * pixel-centre coordinates of the image as stored in the file (an info bar included):
 * x = column, y = row, y down.  The canvas draws the stored picture through one affine transform,
 * s F V of (G11), so nothing is resampled in script: a change of pixel size, tilt correction, tilt
 * axis or rotation only changes matrices.  The edge map lives on the stored grid (edges.js) and
 * depends on the smoothing settings alone.  The picture holds the grey values at 8 bits through
 * the black and white levels (display.js); a change of levels repaints it and touches nothing else.
 * Line profiles (profile.js) sample the grey values as stored, across a band of adjustable width;
 * a floating window plots the selected one, with the contours that cross it.
 */

const ACTIVE_COLOR = "#ffb000";      // amber: the contour being edited
const OTHER_COLOR = "#00b4ff";       // cyan: the other contours
const MEASURE_COLOR = "#ff6464";     // coral: the measurements
const SELECTED_COLOR = "#ffe14d";    // yellow: the selected measurement and the one being placed
const PREVIEW_COLOR = "#ff3ec8";     // magenta: where a click lands (with Snap on, or inserting)
const PICKED_COLOR = "#9b7bff";      // violet: vertices selected in the vertex window
const ORIGIN_COLOR = "#4cff4c";
const EDGE_RGB = [0, 255, 170];      // edge-strength overlay
const HIT_PX = 8;                    // screen pixels within which a point is under the cursor
const ARC_PX = 22;                   // radius of the angle arcs
const HISTORY = 500;
const LABEL_FONT = "12px system-ui, -apple-system, 'Segoe UI', Arial, sans-serif";

/** "pan" is no tool: the mouse, one finger or two only move and zoom the view. @typedef {"pan"|"contour"|MeasureKind} Tool */
/** @type {Tool[]} */
const TOOLS = ["pan", "contour", "ruler", "angle", "line-angle", "profile"];
/** @type {Record<Tool, string>} */
const TOOL_HINTS = {
  pan: "No tool: drag to pan, wheel to zoom; on a touch screen one finger pans and two pinch.  Choose a tool (1-5) " +
    "to trace or measure; click it again, or press 0, to come back here.",
  contour: "Click: add a vertex to the active contour.  Ctrl+click inserts (hold Ctrl to see where), drag moves, " +
    "right click deletes; click a vertex to select it in the vertex window (T).",
  ruler: "Click both ends of a distance.  Drag an end to move it; right click deletes the ruler.",
  angle: "Click the end of one arm, the vertex, then the end of the other arm.",
  "line-angle": "Click two points on one line, then two on the other: the angle between the lines.",
  profile: "Click both ends of a line profile (placed exactly, never snapped).  Drag the square on the band's side " +
    "to widen it, an end to move it; P shows the profile window.",
};
/** @type {Record<MeasureKind, string>} */
const MEASURE_NAMES = { ruler: "ruler", angle: "angle", "line-angle": "line angle", profile: "profile" };
const PLOT_COLOR = "#385c9e";        // the profile's mean in its window
const TAP_PX = 10;                   // a touch that moves less than this is a tap

/** @returns {Frame} */
function defaultFrame() {
  return { pixelNm: null, tiltDeg: 0, correction: "none", customFactor: 1, axisDeg: 0, rotationDeg: 0, originPx: [0, 0] };
}

const app = {
  /** @type {SEMImage|null} */
  image: null,
  /** @type {string|null} */
  sha256: null,
  lo: 0,                             // black level: the grey value shown black
  hi: 1,                             // white level
  /** @type {[number, number]} the levels of the Auto button: the 0.5 and 99.5 % percentiles */
  autoLevels: [0, 1],
  /** @type {[number, number, boolean]} darkest and brightest value of the whole image, all whole numbers */
  range: [0, 1, false],
  /** @type {Histogram|null} of the rows above the info bar */
  hist: null,
  levelsChanged: false,              // the picture must be repainted before the next frame
  /** @type {"black"|"white"|null} the histogram handle being dragged */
  levelDrag: null,
  /** @type {{canvas: HTMLCanvasElement, pixels: ImageData}|null} the stored image at 8 bits */
  picture: null,
  /** @type {EdgeMap|null} */
  edges: null,
  edgesKey: "",
  edgesBusy: false,
  /** @type {HTMLCanvasElement|null} */
  overlay: null,
  /** @type {Contour[]} */
  contours: [{ name: "contour 1", closed: true, points: [] }],
  active: 0,
  /** @type {Measurement[]} */
  measurements: [],
  selected: -1,
  /** @type {{kind: MeasureKind, points: Point[]}|null} a measurement being placed */
  pending: null,
  /** @type {Tool} */
  tool: "pan",
  /**
   * A touch gesture on the view: a finger that may still be a tap, one that pans or drags a point,
   * or two that pinch (G16).
   * @type {{kind: "tap", id: number, start: Point}|{kind: "pan", id: number, last: Point}|{kind: "drag", id: number}
   *   |{kind: "pinch", ids: [number, number], d0: number, c0: Point, s0: number, t0: Point}|null}
   */
  gesture: null,
  /** @type {Frame} */
  frame: defaultFrame(),
  view: { s: 1, tx: 0, ty: 0 },
  /** @type {string[]} */
  history: [],
  /** @type {string[]} */
  future: [],
  dirty: false,
  /** @type {{kind: "vertex"|"point"|"width", index: number, point: number, moved: boolean}|null} */
  drag: null,
  profileWidth: 1,                   // band width of new profiles, pixel widths of the corrected view
  /** @type {number|null} where the cursor is on the profile plot: 0 at the start of the line, 1 at its end */
  profileCursor: null,
  /** @type {{x: number, y: number}|null} */
  pan: null,
  space: false,
  originMode: false,
  /** @type {Point|null} where a click lands with Snap on */
  preview: null,
  /** @type {Point|null} the cursor, stored coordinates */
  cursor: null,
  /** @type {Point|null} the cursor, screen coordinates */
  cursorScreen: null,
  insertHeld: false,                 // Ctrl (or Cmd) is down: a click inserts a vertex
  altHeld: false,                    // Alt is down: a click lands exactly, without snapping
  /** @type {number[]} vertices of the active contour selected in the vertex window, ascending */
  picked: [],
  pickAnchor: -1,
  raf: 0,
};

// ------------------------------------------------------------------------- elements

/**
 * @param {string} id
 * @returns {HTMLElement}
 */
function el(id) {
  const e = document.getElementById(id);
  if (e === null) {
    throw new Error(`the page has no element #${id}`);
  }
  return e;
}

/**
 * @param {string} id
 * @returns {HTMLInputElement}
 */
function inputEl(id) {
  return /** @type {HTMLInputElement} */ (el(id));
}

/**
 * @param {string} id
 * @returns {HTMLSelectElement}
 */
function selectEl(id) {
  return /** @type {HTMLSelectElement} */ (el(id));
}

/**
 * @param {string} id
 * @returns {HTMLButtonElement}
 */
function buttonEl(id) {
  return /** @type {HTMLButtonElement} */ (el(id));
}

const canvas = /** @type {HTMLCanvasElement} */ (el("view"));
const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d"));

/**
 * A positive number from an input, or ``fallback``.
 * @param {string} id
 * @param {number} fallback
 * @returns {number}
 */
function numberFrom(id, fallback) {
  const v = Number(inputEl(id).value);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

const settings = {
  snap: () => inputEl("snap").checked,
  edgesShown: () => inputEl("show-edges").checked,
  sigma: () => numberFrom("sigma", 2),
  median: () => Number(selectEl("median").value),
  radius: () => numberFrom("radius", 12),
  minContrast: () => numberFrom("min-contrast", 3),
};

// ------------------------------------------------------------------------- coordinates

/**
 * s F V of (G11): canvas units (stored pixel edges at integers) to CSS pixels, before the pan.
 * @returns {Mat2}
 */
function screenMatrix() {
  const v = viewMatrix(app.frame);
  const s = app.view.s;
  return [s * v[0], s * v[1], -s * v[2], -s * v[3]];
}

/**
 * The function from stored points to the screen for the current view.
 * @returns {(p: Point) => Point}
 */
function screenMapper() {
  const m = screenMatrix();
  const { tx, ty } = app.view;
  return (p) => {
    const q = matApply(m, p[0] + 0.5, p[1] + 0.5);
    return [q[0] + tx, q[1] + ty];
  };
}

/**
 * Screen position (CSS pixels in the canvas) of a stored point.
 * @param {number} x
 * @param {number} y
 * @returns {Point}
 */
function storedToScreen(x, y) {
  return screenMapper()([x, y]);
}

/**
 * Stored point under a screen position.
 * @param {number} sx
 * @param {number} sy
 * @returns {Point}
 */
function screenToStored(sx, sy) {
  const [a, b] = matApply(matInverse(screenMatrix()), sx - app.view.tx, sy - app.view.ty);
  return [a - 0.5, b - 0.5];
}

/**
 * @param {number} x
 * @param {number} y
 * @returns {boolean}
 */
function insideImage(x, y) {
  return app.image !== null && x >= -0.5 && x <= app.image.width - 0.5 && y >= -0.5 && y <= app.image.height - 0.5;
}

// ------------------------------------------------------------------------- messages

/** @param {string} text */
function setStatus(text) {
  el("status").textContent = text;
}

/** @param {string} text  "" hides it */
function setBusy(text) {
  const b = el("busy");
  b.textContent = text;
  b.style.display = text ? "block" : "none";
}

/** Let the browser paint (e.g. a "busy" message) before a long computation. */
function nextPaint() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve, 0));
    setTimeout(resolve, 250);      // a hidden page gets no animation frames
  });
}

/**
 * A number for the panel: five significant digits.
 * @param {number} v
 * @returns {string}
 */
function show(v) {
  return String(Number(v.toPrecision(5)));
}

/**
 * @param {"um"|"px"} unit
 * @returns {string}
 */
function unitText(unit) {
  return unit === "um" ? "µm" : "px";
}

// ------------------------------------------------------------------------- images

/**
 * Hex SHA-256 of a file, or null where the browser does not offer it.
 * @param {ArrayBuffer} buffer
 * @returns {Promise<string|null>}
 */
async function sha256Hex(buffer) {
  try {
    const digest = await crypto.subtle.digest("SHA-256", buffer);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

/**
 * A PNG, JPEG or BMP decoded by the browser, as grey values (Rec. 709), without metadata.
 * @param {ArrayBuffer} buffer
 * @param {string} name
 * @returns {Promise<SEMImage>}
 */
async function decodeBrowserImage(buffer, name) {
  const bitmap = await createImageBitmap(new Blob([buffer]));
  const c = document.createElement("canvas");
  c.width = bitmap.width;
  c.height = bitmap.height;
  const g = /** @type {CanvasRenderingContext2D} */ (c.getContext("2d"));
  g.drawImage(bitmap, 0, 0);
  const rgba = g.getImageData(0, 0, c.width, c.height).data;
  const data = new Float32Array(c.width * c.height);
  for (let i = 0; i < data.length; i++) {
    data[i] = 0.2126 * rgba[4 * i] + 0.7152 * rgba[4 * i + 1] + 0.0722 * rgba[4 * i + 2];
  }
  return {
    name, width: c.width, height: c.height, imageRows: c.height, data, sampleType: "uint8 (browser decoded)",
    bitsPerSample: 8, vendor: null, metadataText: "", calibration: emptyCalibration(),
  };
}

/**
 * The canvas that holds the stored image at 8 bits, and its pixels; paintPicture fills them.
 * @param {SEMImage} image
 * @returns {{canvas: HTMLCanvasElement, pixels: ImageData}}
 */
function makePicture(image) {
  const canvas2 = document.createElement("canvas");
  canvas2.width = image.width;
  canvas2.height = image.height;
  const g = /** @type {CanvasRenderingContext2D} */ (canvas2.getContext("2d"));
  return { canvas: canvas2, pixels: g.createImageData(image.width, image.height) };
}

const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

/**
 * Paint the picture: the grey values through the black and white levels (display.js, (D1)), the
 * info bar too.  Whole-number data (8 and 16 bits) go through a table of the image's value range;
 * each pixel is then one table look-up and one 32-bit write.
 */
function paintPicture() {
  const image = app.image;
  const picture = app.picture;
  if (image === null || picture === null) {
    return;
  }
  const grey = greyMap(app.lo, app.hi);
  /** @param {number} v @returns {number} the RGBA word of grey value v */
  const word = (v) => {
    const g = grey(v);
    return LITTLE_ENDIAN ? (0xff000000 | (g * 0x010101)) >>> 0 : ((g * 0x01010100) | 0xff) >>> 0;
  };
  const out = new Uint32Array(picture.pixels.data.buffer);
  const data = image.data;
  const [low, high, whole] = app.range;
  if (whole && high - low <= 65535) {
    const table = new Uint32Array(high - low + 1).map((_, k) => word(low + k));
    for (let i = 0; i < data.length; i++) {
      out[i] = table[data[i] - low];
    }
  } else {
    for (let i = 0; i < data.length; i++) {
      out[i] = word(data[i]);
    }
  }
  /** @type {CanvasRenderingContext2D} */ (picture.canvas.getContext("2d")).putImageData(picture.pixels, 0, 0);
}

/**
 * Open an image from the bytes of a file.  Returns false (with a message) when it cannot be read.
 * @param {string} name
 * @param {ArrayBuffer} buffer
 * @returns {Promise<boolean>}
 */
async function openImageBuffer(name, buffer) {
  setBusy(`Reading ${name} ...`);
  await nextPaint();
  /** @type {SEMImage} */
  let image;
  try {
    const head = new Uint8Array(buffer, 0, Math.min(4, buffer.byteLength));
    const tiff = (head[0] === 0x49 && head[1] === 0x49) || (head[0] === 0x4d && head[1] === 0x4d);
    image = tiff ? decodeSEMImage(buffer, name) : await decodeBrowserImage(buffer, name);
  } catch (err) {
    setBusy("");
    window.alert(`Could not read ${name}:\n${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
  app.sha256 = await sha256Hex(buffer);
  app.image = image;
  const above = image.data.subarray(0, image.width * image.imageRows);      // the info bar left out
  app.autoLevels = autoLevels(above);
  [app.lo, app.hi] = app.autoLevels;
  app.range = valueRange(image.data);
  app.hist = histogramOf(above, fixedSpan(image.bitsPerSample));
  const cal = image.calibration;
  /** @param {number} m @returns {number} nm, without the rounding noise of the unit change */
  const nm = (m) => Number((m * 1e9).toPrecision(12));
  app.frame = { ...defaultFrame(), pixelNm: cal.pixelSizeM ? [nm(cal.pixelSizeM[0]), nm(cal.pixelSizeM[1])] : null,
    tiltDeg: cal.tiltDeg ?? 0 };
  app.contours = [{ name: "contour 1", closed: true, points: [] }];
  app.active = 0;
  clearPicked();
  app.measurements = [];
  app.selected = -1;
  app.pending = null;
  app.history = [];
  app.future = [];
  app.dirty = false;
  app.drag = null;
  app.preview = null;
  app.picture = makePicture(image);
  paintPicture();
  app.levelsChanged = false;
  app.edges = null;
  app.edgesKey = "";
  app.overlay = null;
  el("drop-hint").style.display = "none";
  document.title = `SEM measurement tool - ${name}`;
  showImageInfo();
  showMetadata();
  refreshFrameInputs();
  refreshContours();
  refreshMeasurements();
  refreshDisplay();
  fit();
  setBusy("");
  await refreshEdges();
  return true;
}

/** Compute the edge map when Snap or the edge map needs it and it is missing or outdated. */
async function refreshEdges() {
  const image = app.image;
  if (image === null || app.edgesBusy || !(settings.snap() || settings.edgesShown())) {
    render();
    return;
  }
  const rows = Math.max(1, image.imageRows);       // the info bar is left out
  const key = `${settings.sigma()}|${settings.median()}`;
  if (app.edges === null || app.edgesKey !== key) {
    app.edgesBusy = true;
    setBusy(`Computing the edge map (sigma ${settings.sigma()} px) ...`);
    await nextPaint();
    try {
      app.edges = new EdgeMap(image.data.subarray(0, image.width * rows), image.width, rows, settings.sigma(),
        settings.median());
      app.edgesKey = key;
      app.overlay = null;
    } finally {
      app.edgesBusy = false;
      setBusy("");
    }
  }
  if (settings.edgesShown() && app.overlay === null && app.edges !== null) {
    const strength = app.edges.normalized();
    const c = document.createElement("canvas");
    c.width = app.edges.width;
    c.height = app.edges.height;
    const g = /** @type {CanvasRenderingContext2D} */ (c.getContext("2d"));
    const pixels = g.createImageData(c.width, c.height);
    for (let i = 0; i < strength.length; i++) {
      pixels.data[4 * i] = EDGE_RGB[0];
      pixels.data[4 * i + 1] = EDGE_RGB[1];
      pixels.data[4 * i + 2] = EDGE_RGB[2];
      pixels.data[4 * i + 3] = Math.round(strength[i] * 230);
    }
    g.putImageData(pixels, 0, 0);
    app.overlay = c;
  }
  render();
}

/**
 * Where a click at stored (x, y) lands with Snap on: the nearby edge point, or null.  The search
 * radius is measured in the corrected view (edges.js, (E7)).
 * @param {number} x
 * @param {number} y
 * @returns {Point|null}
 */
function snapTarget(x, y) {
  if (!settings.snap() || app.edges === null) {
    return null;
  }
  return app.edges.snap(x, y, settings.radius(), settings.minContrast(), viewMatrix(app.frame));
}

// ------------------------------------------------------------------------- view

function fit() {
  const image = app.image;
  if (image === null) {
    return;
  }
  const rect = canvas.getBoundingClientRect();
  const v = viewMatrix(app.frame);
  /** @type {Mat2} */
  const fv = [v[0], v[1], -v[2], -v[3]];          // F V: the view at zoom 1
  const corners = [[0, 0], [image.width, 0], [0, image.height], [image.width, image.height]]
    .map(([x, y]) => matApply(fv, x, y));
  const xs = corners.map((p) => p[0]);
  const ys = corners.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const s = Math.min(rect.width / (x1 - x0), rect.height / (y1 - y0)) * 0.98;
  app.view.s = Number.isFinite(s) && s > 0 ? s : 1;
  app.view.tx = (rect.width - app.view.s * (x0 + x1)) / 2;
  app.view.ty = (rect.height - app.view.s * (y0 + y1)) / 2;
  render();
}

/**
 * Zoom by ``factor`` about the screen point (sx, sy), which keeps the canvas point under it (G16).
 * @param {number} factor
 * @param {number} sx
 * @param {number} sy
 */
function zoomAt(factor, sx, sy) {
  const s = Math.min(200, Math.max(0.01, app.view.s * factor));
  const f = s / app.view.s;
  app.view.tx = sx - (sx - app.view.tx) * f;
  app.view.ty = sy - (sy - app.view.ty) * f;
  app.view.s = s;
  render();
}

/**
 * Apply ``change`` to the measurement frame, keeping the stored point at the centre of the view
 * where it is, and show the result.
 * @param {() => void} change
 */
function changeFrame(change) {
  const rect = canvas.getBoundingClientRect();
  const centre = app.image ? screenToStored(rect.width / 2, rect.height / 2) : null;
  change();
  if (centre !== null) {
    const [sx, sy] = storedToScreen(centre[0], centre[1]);
    app.view.tx += rect.width / 2 - sx;
    app.view.ty += rect.height / 2 - sy;
  }
  refreshFrameInputs();
  refreshContours();
  refreshMeasurements();
  render();
}

function render() {
  if (app.raf === 0) {
    app.raf = requestAnimationFrame(draw);
  }
}

function draw() {
  app.raf = 0;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width * dpr));
  const h = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#1e1e1e";
  ctx.fillRect(0, 0, w, h);
  const image = app.image;
  if (image === null || app.picture === null) {
    return;
  }
  if (app.levelsChanged) {
    app.levelsChanged = false;
    paintPicture();                // once per frame, however fast the levels move
  }
  const m = screenMatrix();
  const { tx, ty } = app.view;
  // canvas transforms take (a, b, c, d, e, f) for x' = a x + c y + e, y' = b x + d y + f
  ctx.setTransform(dpr * m[0], dpr * m[2], dpr * m[1], dpr * m[3], dpr * tx, dpr * ty);
  ctx.imageSmoothingEnabled = Math.sqrt(Math.abs(matDet(m))) < 1.5;
  ctx.drawImage(app.picture.canvas, 0, 0);
  if (settings.edgesShown() && app.overlay !== null) {
    ctx.drawImage(app.overlay, 0, 0);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const toScreen = screenMapper();
  if (image.imageRows < image.height) {                     // where the ignored data bar starts
    const a = toScreen([-0.5, image.imageRows - 0.5]);
    const b = toScreen([image.width - 0.5, image.imageRows - 0.5]);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.6)";
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 4]);
    strokeSegment(a, b);
    ctx.setLineDash([]);
  }
  app.contours.forEach((c, ci) => drawContour(c, ci === app.active, toScreen));
  drawPicked(toScreen);
  app.measurements.forEach((ms, i) => drawMeasurement(ms, i === app.selected ? SELECTED_COLOR : MEASURE_COLOR, toScreen, false));
  drawProfileCursor(toScreen);
  drawPending(toScreen);
  drawInsertPreview(toScreen);
  drawMarks(toScreen);
}

/**
 * Rings around the vertices picked in the vertex window, with their numbers.
 * @param {(p: Point) => Point} toScreen
 */
function drawPicked(toScreen) {
  const points = activeContour().points;
  ctx.save();
  ctx.strokeStyle = PICKED_COLOR;
  ctx.lineWidth = 2.5;
  for (const i of app.picked) {
    if (points[i] === undefined) {
      continue;
    }
    const [x, y] = toScreen(points[i]);
    ctx.beginPath();
    ctx.arc(x, y, 8.5, 0, 2 * Math.PI);
    ctx.stroke();
    drawLabel(String(i), [x + 14, y - 12], PICKED_COLOR);
  }
  ctx.restore();
}

/**
 * Where a click inserts a vertex now: the edge a-b of the active contour that receives it and the
 * point p it lands on, exactly as addVertex places it (snapped unless Alt is down); null when a
 * click would not insert (Ctrl up, another tool, a vertex under the cursor, fewer than 2 vertices).
 * @returns {{a: Point, b: Point, p: Point}|null}
 */
function insertTarget() {
  const c = activeContour();
  const n = c.points.length;
  const cursor = app.cursor;
  const screen = app.cursorScreen;
  if (app.tool !== "contour" || !app.insertHeld || cursor === null || screen === null || n < 2 || app.drag !== null
      || app.pan !== null || app.originMode || !insideImage(cursor[0], cursor[1])) {
    return null;
  }
  if (hitVertex(screen[0], screen[1]) !== null) {
    return null;                   // the click would move that vertex instead
  }
  /** @type {Point} */
  const p = (app.altHeld ? null : snapTarget(cursor[0], cursor[1])) ?? [cursor[0], cursor[1]];
  const i = insertionIndex(c, p[0], p[1]);
  return { a: c.points[i - 1], b: c.points[i % n], p };
}

/**
 * The insert preview: the receiving edge drawn thick, the two edges that replace it dashed, and
 * the landing point.
 * @param {(p: Point) => Point} toScreen
 */
function drawInsertPreview(toScreen) {
  const target = insertTarget();
  if (target === null) {
    return;
  }
  const [a, b, p] = [toScreen(target.a), toScreen(target.b), toScreen(target.p)];
  ctx.save();
  ctx.strokeStyle = PREVIEW_COLOR;
  ctx.lineWidth = 5;
  ctx.globalAlpha = 0.8;
  strokeSegment(a, b);
  ctx.globalAlpha = 1;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 3]);
  strokeSegment(a, p);
  strokeSegment(p, b);
  ctx.setLineDash([]);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(p[0], p[1], 6, 0, 2 * Math.PI);
  ctx.stroke();
  ctx.restore();
}

/**
 * Note Ctrl (or Cmd) and Alt from any event, and redraw when the insert preview may change.
 * @param {KeyboardEvent|PointerEvent} e
 */
function trackModifiers(e) {
  const insert = e.ctrlKey || e.metaKey;
  if (insert !== app.insertHeld || e.altKey !== app.altHeld) {
    app.insertHeld = insert;
    app.altHeld = e.altKey;
    render();
  }
}

/**
 * The origin cross and the snap preview.
 * @param {(p: Point) => Point} toScreen
 */
function drawMarks(toScreen) {
  const [ox, oy] = app.frame.originPx;
  if (ox !== 0 || oy !== 0) {
    const [sx, sy] = toScreen([ox, oy]);
    ctx.strokeStyle = ORIGIN_COLOR;
    ctx.lineWidth = 2;
    strokeSegment([sx - 9, sy], [sx + 9, sy]);
    strokeSegment([sx, sy - 9], [sx, sy + 9]);
  }
  if (app.preview !== null) {
    const [sx, sy] = toScreen(app.preview);
    ctx.strokeStyle = PREVIEW_COLOR;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(sx, sy, 6, 0, 2 * Math.PI);
    ctx.stroke();
  }
}

/**
 * @param {Point} a
 * @param {Point} b
 */
function strokeSegment(a, b) {
  ctx.beginPath();
  ctx.moveTo(a[0], a[1]);
  ctx.lineTo(b[0], b[1]);
  ctx.stroke();
}

/**
 * Text with a dark halo, legible on any grey.
 * @param {string} text
 * @param {Point} at
 * @param {string} color
 */
function drawLabel(text, at, color) {
  ctx.font = LABEL_FONT;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.8)";
  ctx.strokeText(text, at[0], at[1]);
  ctx.fillStyle = color;
  ctx.fillText(text, at[0], at[1]);
}

/**
 * The arc of radius ARC_PX about ``centre`` from direction ``u`` to direction ``v`` (screen),
 * the shorter way round; returns the unit bisector, or null when u or v vanish.
 * @param {Point} centre
 * @param {Point} u
 * @param {Point} v
 * @returns {Point|null}
 */
function drawArc(centre, u, v) {
  const lu = Math.hypot(u[0], u[1]);
  const lv = Math.hypot(v[0], v[1]);
  if (!(lu > 0 && lv > 0)) {
    return null;
  }
  const a = Math.atan2(u[1], u[0]);
  let sweep = Math.atan2(v[1], v[0]) - a;
  sweep = Math.atan2(Math.sin(sweep), Math.cos(sweep));       // to (-pi, pi]
  ctx.beginPath();
  ctx.arc(centre[0], centre[1], ARC_PX, a, a + sweep, sweep < 0);
  ctx.stroke();
  const mid = a + sweep / 2;
  return [Math.cos(mid), Math.sin(mid)];
}

/**
 * @param {Contour} c
 * @param {boolean} active
 * @param {(p: Point) => Point} toScreen
 */
function drawContour(c, active, toScreen) {
  const color = active ? ACTIVE_COLOR : OTHER_COLOR;
  const pts = c.points.map(toScreen);
  if (pts.length >= 2) {
    ctx.strokeStyle = color;
    ctx.lineWidth = active ? 2 : 1.5;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (const [x, y] of pts.slice(1)) {
      ctx.lineTo(x, y);
    }
    if (c.closed && pts.length > 2) {
      ctx.closePath();
    }
    ctx.stroke();
  }
  pts.forEach(([x, y], i) => {
    ctx.beginPath();
    ctx.arc(x, y, active && i === 0 ? 5.5 : 3.5, 0, 2 * Math.PI);   // the first vertex is larger
    ctx.fillStyle = active ? "#ffffff" : color;
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = color;
    ctx.stroke();
  });
}

/**
 * The value of a measurement as its label shows it; "?" when the correction is undefined.
 * @param {Measurement} ms
 * @returns {string}
 */
function measurementLabel(ms) {
  if (ms.kind === "ruler" || ms.kind === "profile") {
    const r = measureRuler(ms.points, app.frame);
    return r === null ? "?" : `${show(r.length)} ${unitText(r.unit)}`;
  }
  const angle = ms.kind === "angle" ? measureAngle(ms.points, app.frame)
    : (measureLineAngle(ms.points, app.frame)?.angleDeg ?? null);
  return angle === null ? "?" : `${angle.toFixed(2)}°`;
}

/**
 * A ruler: the segment, end ticks and the length above it.
 * @param {Point[]} pts     screen
 * @param {string|null} label
 * @param {string} color
 */
function drawRuler(pts, label, color) {
  const [a, b] = pts;
  strokeSegment(a, b);
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  /** @type {Point} */
  let n = len > 0 ? [(b[1] - a[1]) / len, -(b[0] - a[0]) / len] : [0, -1];
  if (n[1] > 0 || (n[1] === 0 && n[0] < 0)) {
    n = [-n[0], -n[1]];             // the label goes above the ruler
  }
  for (const p of [a, b]) {
    strokeSegment([p[0] - 5 * n[0], p[1] - 5 * n[1]], [p[0] + 5 * n[0], p[1] + 5 * n[1]]);
  }
  if (label !== null) {
    drawLabel(label, [(a[0] + b[0]) / 2 + 14 * n[0], (a[1] + b[1]) / 2 + 14 * n[1]], color);
  }
}

/**
 * Two lines, dashed out to where they cross, with the arc between their directions there.
 * @param {Point[]} pts      screen, 4 points
 * @param {Point|null} crossing   stored
 * @param {(p: Point) => Point} toScreen
 * @param {{label: string|null, color: string}} text
 */
function drawLineAngle(pts, crossing, toScreen, text) {
  strokeSegment(pts[0], pts[1]);
  strokeSegment(pts[2], pts[3]);
  const span = Math.max(...pts.map((p) => Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1])), 1);
  const c = crossing === null ? null : toScreen(crossing);
  if (c !== null && Math.hypot(c[0] - pts[0][0], c[1] - pts[0][1]) < 20 * span) {
    ctx.save();
    ctx.setLineDash([3, 4]);
    for (const [p, q] of [[pts[0], pts[1]], [pts[2], pts[3]]]) {
      const near = Math.hypot(p[0] - c[0], p[1] - c[1]) < Math.hypot(q[0] - c[0], q[1] - c[1]) ? p : q;
      strokeSegment(near, c);
    }
    ctx.restore();
    const bisector = drawArc(c, [pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]], [pts[3][0] - pts[2][0], pts[3][1] - pts[2][1]]);
    if (text.label !== null && bisector !== null) {
      drawLabel(text.label, [c[0] + (ARC_PX + 14) * bisector[0], c[1] + (ARC_PX + 14) * bisector[1]], text.color);
    }
  } else if (text.label !== null) {
    const mid = pts.reduce((acc, p) => [acc[0] + p[0] / 4, acc[1] + p[1] / 4], [0, 0]);
    drawLabel(text.label, mid, text.color);
  }
}

/**
 * A profile: its centre line with end ticks, its band outlined (dashed) when wider than a few
 * screen pixels, the square handle that sets the width when ``handle``, and its length beyond the
 * band on the side away from the handle.
 * @param {Measurement} ms
 * @param {Point[]} pts       screen
 * @param {(p: Point) => Point} toScreen
 * @param {{label: string|null, color: string, handle: boolean}} how
 */
function drawProfileLine(ms, pts, toScreen, how) {
  const width = ms.width ?? app.profileWidth;
  const [u1, u2] = ms.points;
  const h = widthHandle(ms.points, width, app.frame);
  /** @type {Point} */
  const mid = [(u1[0] + u2[0]) / 2, (u1[1] + u2[1]) / 2];
  const across = [h[0] - mid[0], h[1] - mid[1]];             // half the band, stored
  /** @type {(p: Point, sign: number) => Point} */
  const side = (p, sign) => toScreen([p[0] + sign * across[0], p[1] + sign * across[1]]);
  const [a, b, c, d] = [side(u1, 1), side(u2, 1), side(u2, -1), side(u1, -1)];
  if (Math.hypot(a[0] - d[0], a[1] - d[1]) > 3) {
    ctx.save();
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    for (const p of [b, c, d]) {
      ctx.lineTo(p[0], p[1]);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }
  drawRuler(pts, null, how.color);
  const [hx, hy] = toScreen(h);
  const [mx, my] = toScreen(mid);
  if (how.handle) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(hx - 4, hy - 4, 8, 8);
    ctx.lineWidth = 1.2;
    ctx.strokeRect(hx - 4, hy - 4, 8, 8);
  }
  if (how.label !== null) {
    const reach = Math.hypot(hx - mx, hy - my);
    const line = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]) || 1;
    /** @type {Point} away from the handle; across the line when the band has no width */
    const u = reach > 1e-6 ? [(mx - hx) / reach, (my - hy) / reach] : [(pts[1][1] - pts[0][1]) / line, -(pts[1][0] - pts[0][0]) / line];
    ctx.font = LABEL_FONT;
    const r = reach + 6 + (ctx.measureText(how.label).width / 2) * Math.abs(u[0]) + 8 * Math.abs(u[1]);
    drawLabel(how.label, [mx + r * u[0], my + r * u[1]], how.color);
  }
}

/**
 * The point of the shown profile under the cursor on its plot: a tick across the band.
 * @param {(p: Point) => Point} toScreen
 */
function drawProfileCursor(toScreen) {
  const ms = shownProfile();
  const t = app.profileCursor;
  if (ms === null || t === null) {
    return;
  }
  const [u1, u2] = ms.points;
  /** @type {Point} */
  const p = [u1[0] + t * (u2[0] - u1[0]), u1[1] + t * (u2[1] - u1[1])];
  const h = widthHandle(ms.points, Math.max(ms.width ?? 1, 8 / Math.max(app.view.s, 1e-9)), app.frame);
  const mid = [(u1[0] + u2[0]) / 2, (u1[1] + u2[1]) / 2];
  const [dx, dy] = [h[0] - mid[0], h[1] - mid[1]];
  ctx.save();
  ctx.strokeStyle = PREVIEW_COLOR;
  ctx.lineWidth = 2;
  strokeSegment(toScreen([p[0] - dx, p[1] - dy]), toScreen([p[0] + dx, p[1] + dy]));
  const [x, y] = toScreen(p);
  ctx.beginPath();
  ctx.arc(x, y, 3.5, 0, 2 * Math.PI);
  ctx.stroke();
  ctx.restore();
}

/**
 * A measurement, complete or (``pending``) being placed, possibly with fewer points than its kind.
 * @param {Measurement} ms
 * @param {string} color
 * @param {(p: Point) => Point} toScreen
 * @param {boolean} pending
 */
function drawMeasurement(ms, color, toScreen, pending) {
  const pts = ms.points.map(toScreen);
  const complete = ms.points.length === MEASURE_POINTS[ms.kind];
  const label = complete ? measurementLabel(ms) : null;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  if (pending) {
    ctx.setLineDash([5, 4]);
  }
  if (ms.kind === "ruler" && pts.length >= 2) {
    drawRuler(pts, label, color);
  } else if (ms.kind === "profile" && pts.length >= 2) {
    drawProfileLine(ms, pts, toScreen, { label, color, handle: !pending && color === SELECTED_COLOR });
  } else if (ms.kind === "angle" && pts.length >= 2) {
    strokeSegment(pts[1], pts[0]);
    if (pts.length >= 3) {
      strokeSegment(pts[1], pts[2]);
      const v = pts[1];
      const bisector = drawArc(v, [pts[0][0] - v[0], pts[0][1] - v[1]], [pts[2][0] - v[0], pts[2][1] - v[1]]);
      if (label !== null && bisector !== null) {
        drawLabel(label, [v[0] + (ARC_PX + 14) * bisector[0], v[1] + (ARC_PX + 14) * bisector[1]], color);
      }
    }
  } else if (ms.kind === "line-angle" && pts.length >= 2) {
    if (pts.length === 4) {
      drawLineAngle(pts, lineIntersection(ms.points[0], ms.points[1], ms.points[2], ms.points[3]), toScreen,
        { label, color });
    } else {
      strokeSegment(pts[0], pts[1]);
    }
  }
  ctx.setLineDash([]);
  for (const [x, y] of pts) {
    ctx.beginPath();
    ctx.arc(x, y, 3.5, 0, 2 * Math.PI);
    ctx.fillStyle = color === SELECTED_COLOR ? "#ffffff" : color;
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * The measurement being placed, its next point following the cursor (or the snap preview).
 * @param {(p: Point) => Point} toScreen
 */
function drawPending(toScreen) {
  const p = app.pending;
  if (p === null) {
    return;
  }
  const tip = app.preview ?? app.cursor;
  const points = tip === null ? p.points : [...p.points, tip];
  drawMeasurement({ name: "", kind: p.kind, points }, SELECTED_COLOR, toScreen, true);
}

// ------------------------------------------------------------------------- editing

/** @returns {Contour} */
function activeContour() {
  if (app.contours.length === 0) {
    app.contours.push({ name: "contour 1", closed: true, points: [] });
  }
  app.active = Math.min(Math.max(app.active, 0), app.contours.length - 1);
  return app.contours[app.active];
}

/** @returns {string} */
function snapshot() {
  return JSON.stringify({
    contours: app.contours, active: app.active, measurements: app.measurements, selected: app.selected,
    frame: app.frame,
  });
}

/** @param {string} state */
function restore(state) {
  const s = JSON.parse(state);
  app.pending = null;
  clearPicked();
  app.contours = s.contours;
  app.active = s.active;
  app.measurements = s.measurements;
  app.selected = s.selected;
  changeFrame(() => {
    app.frame = s.frame;
  });
}

/** Record the state before an edit, for undo. */
function pushHistory() {
  app.history.push(snapshot());
  if (app.history.length > HISTORY) {
    app.history.shift();
  }
  app.future = [];
  app.dirty = true;
}

function undo() {
  const state = app.history.pop();
  if (state !== undefined) {
    app.future.push(snapshot());
    restore(state);
    app.dirty = true;
  }
}

function redo() {
  const state = app.future.pop();
  if (state !== undefined) {
    app.history.push(snapshot());
    restore(state);
    app.dirty = true;
  }
}

/**
 * The contour vertex under a screen position (the active contour first), or null.
 * @param {number} sx
 * @param {number} sy
 * @returns {{index: number, point: number}|null}
 */
function hitVertex(sx, sy) {
  const toScreen = screenMapper();
  const order = [app.active, ...app.contours.map((_, i) => i).filter((i) => i !== app.active)];
  for (const ci of order) {
    const c = app.contours[ci];
    const vi = c === undefined ? -1 : nearestPoint(c.points, toScreen, sx, sy);
    if (vi >= 0) {
      return { index: ci, point: vi };
    }
  }
  return null;
}

/**
 * The measurement point under a screen position (the selected measurement first), or null.
 * @param {number} sx
 * @param {number} sy
 * @returns {{index: number, point: number}|null}
 */
function hitMeasurePoint(sx, sy) {
  const toScreen = screenMapper();
  const others = app.measurements.map((_, i) => i).filter((i) => i !== app.selected).reverse();
  for (const mi of app.selected >= 0 ? [app.selected, ...others] : others) {
    const vi = nearestPoint(app.measurements[mi].points, toScreen, sx, sy);
    if (vi >= 0) {
      return { index: mi, point: vi };
    }
  }
  return null;
}

/**
 * Whether the width handle of the selected profile is under a screen position.
 * @param {number} sx
 * @param {number} sy
 * @returns {boolean}
 */
function hitWidthHandle(sx, sy) {
  const ms = app.measurements[app.selected];
  if (ms === undefined || ms.kind !== "profile") {
    return false;
  }
  const [x, y] = screenMapper()(widthHandle(ms.points, ms.width ?? 1, app.frame));
  return Math.max(Math.abs(x - sx), Math.abs(y - sy)) <= HIT_PX;
}

/**
 * Index of the point within HIT_PX of a screen position, the nearest; -1 when none.
 * @param {Point[]} points
 * @param {(p: Point) => Point} toScreen
 * @param {number} sx
 * @param {number} sy
 * @returns {number}
 */
function nearestPoint(points, toScreen, sx, sy) {
  let best = HIT_PX;
  let which = -1;
  points.forEach((p, i) => {
    const [x, y] = toScreen(p);
    const d = Math.hypot(x - sx, y - sy);
    if (d <= best) {
      best = d;
      which = i;
    }
  });
  return which;
}

/**
 * Index at which a point near segment (i, i + 1) is inserted: i + 1 for the nearest segment, the
 * closing one included for a closed contour.  Distances in the corrected view.
 * @param {Contour} c
 * @param {number} x
 * @param {number} y
 * @returns {number}
 */
function insertionIndex(c, x, y) {
  const n = c.points.length;
  if (n < 2) {
    return n;
  }
  const v = viewMatrix(app.frame);
  const q = c.points.map((p) => matApply(v, p[0], p[1]));
  const [px, py] = matApply(v, x, y);
  let best = Infinity;
  let where = n;
  const last = c.closed && n > 2 ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const a = q[i];
    const b = q[(i + 1) % n];
    const abx = b[0] - a[0];
    const aby = b[1] - a[1];
    const len2 = abx * abx + aby * aby;
    const t = len2 > 0 ? Math.min(1, Math.max(0, ((px - a[0]) * abx + (py - a[1]) * aby) / len2)) : 0;
    const d = Math.hypot(px - a[0] - t * abx, py - a[1] - t * aby);
    if (d < best) {
      best = d;
      where = i + 1;
    }
  }
  return where;
}

/**
 * Add a vertex at stored (x, y), snapped unless ``exact``; inserted into the nearest segment with
 * ``insert``.
 * @param {number} x
 * @param {number} y
 * @param {{exact?: boolean, insert?: boolean}} [how]
 */
function addVertex(x, y, how = {}) {
  const target = how.exact ? null : snapTarget(x, y);
  /** @type {Point} */
  const p = target ?? [x, y];
  pushHistory();
  const c = activeContour();
  if (how.insert) {
    const at = insertionIndex(c, p[0], p[1]);
    c.points.splice(at, 0, p);
    app.picked = app.picked.map((i) => (i >= at ? i + 1 : i));
  } else {
    c.points.push(p);
  }
  refreshContours();
  render();
}

/**
 * Make contour ``index`` the active one; its vertex selection starts empty.
 * @param {number} index
 */
function setActive(index) {
  if (index !== app.active) {
    app.active = index;
    clearPicked();
  }
}

function clearPicked() {
  app.picked = [];
  app.pickAnchor = -1;
}

/**
 * The picked indices after vertex ``index`` of the active contour was removed.
 * @param {number} index
 */
function forgetVertex(index) {
  app.picked = app.picked.filter((i) => i !== index).map((i) => (i > index ? i - 1 : i));
}

function newContour() {
  pushHistory();
  const names = new Set(app.contours.map((c) => c.name));
  let k = app.contours.length + 1;
  while (names.has(`contour ${k}`)) {
    k++;
  }
  app.contours.push({ name: `contour ${k}`, closed: true, points: [] });
  setActive(app.contours.length - 1);
  refreshContours();
  render();
}

/**
 * Ask for a new name, unique among ``others``; null when cancelled or unchanged.
 * @param {string} current
 * @param {string[]} others
 * @param {string} what      "contour" or "measurement"
 * @returns {string|null}
 */
function askName(current, others, what) {
  const name = window.prompt(`Name of the ${what}:`, current);
  if (name === null) {
    return null;
  }
  const clean = name.replace(/[\r\n]+/g, " ").trim();
  if (clean === "" || clean === current) {
    return null;
  }
  if (others.includes(clean)) {
    window.alert(`Another ${what} is already called "${clean}".`);
    return null;
  }
  return clean;
}

function renameContour() {
  const c = activeContour();
  const name = askName(c.name, app.contours.filter((o) => o !== c).map((o) => o.name), "contour");
  if (name !== null) {
    pushHistory();
    c.name = name;
    refreshContours();
  }
}

function deleteContour() {
  pushHistory();
  app.contours.splice(app.active, 1);
  if (app.contours.length === 0) {
    app.contours.push({ name: "contour 1", closed: true, points: [] });
  }
  app.active = Math.min(app.active, app.contours.length - 1);
  clearPicked();
  refreshContours();
  render();
}

function deleteLastVertex() {
  const c = activeContour();
  if (c.points.length > 0) {
    pushHistory();
    c.points.pop();
    forgetVertex(c.points.length);
    refreshContours();
    render();
  }
}

/** @param {boolean} closed */
function setClosed(closed) {
  const c = activeContour();
  if (c.closed !== closed) {
    pushHistory();
    c.closed = closed;
    refreshContours();
    render();
  }
}

/** @param {Tool} tool   "pan" for no tool */
function setTool(tool) {
  app.tool = tool;
  app.pending = null;
  app.preview = null;
  for (const t of TOOLS) {
    const b = buttonEl(`tool-${t}`);
    b.classList.toggle("active", t === tool);
    b.setAttribute("aria-pressed", String(t === tool));
  }
  canvas.classList.toggle("navigate", tool === "pan");
  el("tool-hint").textContent = TOOL_HINTS[tool];
  render();
}

/**
 * @param {MeasureKind} kind
 * @returns {string} "ruler 3" and so on, unused so far
 */
function newMeasureName(kind) {
  const names = new Set(app.measurements.map((m) => m.name));
  let k = app.measurements.filter((m) => m.kind === kind).length + 1;
  while (names.has(`${MEASURE_NAMES[kind]} ${k}`)) {
    k++;
  }
  return `${MEASURE_NAMES[kind]} ${k}`;
}

/**
 * Place the next point of the measurement of the current tool at stored (x, y), snapped unless
 * ``exact`` (a profile's ends never snap: a profile runs across edges, not along them); the
 * measurement is complete with its last point.
 * @param {number} x
 * @param {number} y
 * @param {boolean} exact
 */
function placePoint(x, y, exact) {
  if (app.tool === "contour" || app.tool === "pan") {
    return;
  }
  const kind = app.tool;
  const pending = app.pending ?? { kind, points: [] };
  pending.points.push((exact || kind === "profile" ? null : snapTarget(x, y)) ?? [x, y]);
  app.pending = pending;
  if (pending.points.length === MEASURE_POINTS[kind]) {
    pushHistory();
    /** @type {Measurement} */
    const ms = { name: newMeasureName(kind), kind, points: pending.points };
    if (kind === "profile") {
      ms.width = app.profileWidth;
    }
    app.measurements.push(ms);
    app.selected = app.measurements.length - 1;
    app.pending = null;
    refreshMeasurements();
  }
  render();
}

/** @param {number} index */
function deleteMeasurement(index) {
  if (index < 0 || index >= app.measurements.length) {
    return;
  }
  pushHistory();
  app.measurements.splice(index, 1);
  app.selected = Math.min(app.selected, app.measurements.length - 1);
  refreshMeasurements();
  render();
}

function renameMeasurement() {
  const ms = app.measurements[app.selected];
  if (ms === undefined) {
    return;
  }
  const name = askName(ms.name, app.measurements.filter((o) => o !== ms).map((o) => o.name), "measurement");
  if (name !== null) {
    pushHistory();
    ms.name = name;
    refreshMeasurements();
  }
}

/** @returns {Measurement|null} the selected ruler, or null (with a message) */
function selectedRuler() {
  const ms = app.measurements[app.selected];
  if (ms === undefined || ms.kind !== "ruler") {
    setStatus("Select a ruler first: it is the line that is levelled or taken as the tilt axis.");
    return null;
  }
  return ms;
}

/**
 * (G13): turn the image so that the selected ruler is horizontal or vertical.
 * @param {"horizontal"|"vertical"} target
 */
function levelSelected(target) {
  const ms = selectedRuler();
  if (ms === null) {
    return;
  }
  const phi = levelRotation(app.frame, ms.points[0], ms.points[1], target);
  if (phi === null) {
    setStatus("The correction factor is undefined: set the tilt or the correction first.");
    return;
  }
  pushHistory();
  changeFrame(() => {
    app.frame.rotationDeg = Number(phi.toFixed(6));
  });
  setStatus(`Turned the image to ${app.frame.rotationDeg.toFixed(3)}°: ${ms.name} is ${target}.`);
}

/** (G14): take the selected ruler as parallel to the tilt axis. */
function axisFromSelected() {
  const ms = selectedRuler();
  if (ms === null) {
    return;
  }
  pushHistory();
  changeFrame(() => {
    app.frame.axisDeg = Number(axisFromLine(app.frame, ms.points[0], ms.points[1]).toFixed(6));
  });
  setStatus(`Tilt axis at ${app.frame.axisDeg.toFixed(3)}°, along ${ms.name}.`);
}

// ------------------------------------------------------------------------- panel

function showImageInfo() {
  const image = app.image;
  if (image === null) {
    el("image-info").textContent = "No image.";
    return;
  }
  const bar = image.imageRows < image.height
    ? `\ninfo bar: the bottom ${image.height - image.imageRows} rows, below the dashed line, left out of the histogram, ` +
      "the auto contrast and the edge detection"
    : "";
  el("image-info").textContent = `${image.name}\n${image.width} x ${image.height} pixels (${image.sampleType})${bar}`;
}

function showMetadata() {
  const image = app.image;
  if (image === null) {
    return;
  }
  el("metadata-summary").textContent = describeCalibration(image.calibration).join("\n");
  el("metadata-raw").textContent = image.metadataText || "(none)";
}

function refreshContours() {
  const list = selectEl("contour-list");
  list.replaceChildren(...app.contours.map((c, i) => {
    const option = document.createElement("option");
    option.value = String(i);
    const [l, d] = c.layer ?? [1, 0];
    option.textContent = `${c.name}  (${c.points.length} vertices${c.closed ? "" : ", open"}; GDS ${l}/${d})`;
    return option;
  }));
  const c = activeContour();
  list.selectedIndex = app.active;
  inputEl("closed").checked = c.closed;
  const [layer, datatype] = c.layer ?? [1, 0];
  inputEl("contour-layer").value = String(layer);
  inputEl("contour-datatype").value = String(datatype);
  refreshVertexWindow();
  refreshProfileWindow();                // contours that cross the profile
  const m = measureContour(c, app.frame);
  const lines = [`${c.name}: ${c.points.length} vertices, ${c.closed ? "closed" : "open"}`];
  if (m === null) {
    lines.push("(correction factor undefined: no measures)");
  } else {
    const unit = unitText(m.unit);
    lines.push(`perimeter: ${show(m.perimeter)} ${unit}`);
    if (c.closed && m.vertices > 2) {
      lines.push(`area: ${show(m.area)} ${unit}²`);
    }
    lines.push(`bounding box: ${show(m.width)} × ${show(m.height)} ${unit}`);
    if (m.unit === "px" && app.image !== null) {
      lines.push("(no pixel size: lengths in pixels)");
    }
  }
  el("measures").textContent = lines.join("\n");
}

/**
 * The measures of a measurement for the panel: a short one for the list and the details.
 * @param {Measurement} ms
 * @returns {{brief: string, details: string}}
 */
function describeMeasurement(ms) {
  const undefinedFactor = { brief: "?", details: "correction factor undefined: no measures" };
  if (ms.kind === "ruler" || ms.kind === "profile") {
    const r = measureRuler(ms.points, app.frame);
    if (r === null) {
      return undefinedFactor;
    }
    const u = unitText(r.unit);
    const line = {
      brief: `${show(r.length)} ${u} at ${r.directionDeg.toFixed(1)}°`,
      details: `length ${show(r.length)} ${u}\nΔX ${show(r.dx)}, ΔY ${show(r.dy)} ${u}\n` +
        `direction ${r.directionDeg.toFixed(3)}° (counter-clockwise from +X)`,
    };
    if (ms.kind === "ruler") {
      return line;
    }
    const g = profileGeometry(ms.points, ms.width ?? 1, app.frame);
    return {
      brief: `${show(r.length)} ${u}, band ${show(g.width)} ${u}`,
      details: `${line.details}\nband ${show(g.width)} ${u} wide (${show(ms.width ?? 1)} px of the corrected view): ` +
        `${g.offsets.length} line${g.offsets.length === 1 ? "" : "s"} across, ${g.samples} samples along\n` +
        "P shows the profile window",
    };
  }
  if (ms.kind === "angle") {
    const a = measureAngle(ms.points, app.frame);
    const [vx, vy] = ms.points[1];
    return a === null ? undefinedFactor
      : { brief: `${a.toFixed(2)}°`, details: `angle ${a.toFixed(3)}° at the vertex (${vx.toFixed(1)}, ${vy.toFixed(1)}) px` };
  }
  const la = measureLineAngle(ms.points, app.frame);
  if (la === null) {
    return undefinedFactor;
  }
  const where = la.crossing === null ? "the lines are parallel"
    : `they cross at (${la.crossing[0].toFixed(1)}, ${la.crossing[1].toFixed(1)}) px`;
  return {
    brief: `${la.angleDeg.toFixed(2)}°`,
    details: `angle ${la.angleDeg.toFixed(3)}° from line 1 to line 2, as clicked (supplement ` +
      `${(180 - la.angleDeg).toFixed(3)}°)\n${where}`,
  };
}

function refreshMeasurements() {
  const list = selectEl("measurement-list");
  list.replaceChildren(...app.measurements.map((ms, i) => {
    const option = document.createElement("option");
    option.value = String(i);
    option.textContent = `${ms.name}: ${describeMeasurement(ms).brief}`;
    return option;
  }));
  app.selected = Math.min(app.selected, app.measurements.length - 1);
  list.selectedIndex = app.selected;
  const ms = app.measurements[app.selected];
  el("measurement-details").textContent = ms === undefined
    ? (app.measurements.length ? "Select a measurement." : "No measurements.")
    : `${ms.name}\n${describeMeasurement(ms).details}`;
  const ruler = ms !== undefined && ms.kind === "ruler";
  for (const id of ["level-horizontal", "level-vertical", "axis-from-ruler"]) {
    buttonEl(id).disabled = !ruler;
  }
  for (const id of ["rename-measurement", "delete-measurement"]) {
    buttonEl(id).disabled = ms === undefined;
  }
  refreshProfileWindow();
}

function refreshFrameInputs() {
  const f = app.frame;
  inputEl("pixel-x").value = f.pixelNm ? String(f.pixelNm[0]) : "";
  inputEl("pixel-y").value = f.pixelNm ? String(f.pixelNm[1]) : "";
  inputEl("tilt").value = String(Number(f.tiltDeg.toFixed(4)));
  selectEl("correction").value = f.correction;
  inputEl("custom-factor").value = String(f.customFactor);
  inputEl("tilt-axis").value = String(Number(f.axisDeg.toFixed(4)));
  inputEl("rotation").value = String(Number(f.rotationDeg.toFixed(4)));
  refreshFrameNotes();
}

function refreshFrameNotes() {
  const f = app.frame;
  inputEl("custom-factor").disabled = f.correction !== "custom";
  const note = el("factor-note");
  note.classList.remove("warn");
  const cal = app.image ? app.image.calibration : null;
  try {
    const k = correctionFactor(f);
    const lines = [k === 1 ? "correction factor k = 1" : `correction factor k = ${k.toFixed(5)}, across the tilt axis`];
    if (cal && cal.tiltCorrectionOn) {
      lines.push("The microscope applied its own tilt correction: keep 'none'.");
      if (f.correction !== "none") {
        note.classList.add("warn");
      }
    } else if (f.correction === "none" && Math.abs(f.tiltDeg) > 1) {
      const cross = 1 / Math.sin((Math.abs(f.tiltDeg) * Math.PI) / 180);
      lines.push(`The stage is tilted ${f.tiltDeg.toFixed(1)}°: depths on a cross-section face need ` +
        `'cross-section' (k = ${cross.toFixed(4)}), lengths in the tilted surface 'tilted surface'.`);
    }
    if (cal && cal.scanRotationDeg) {
      lines.push(`The file records a scan rotation of ${cal.scanRotationDeg.toFixed(2)}°; the tilt axis is not taken from it.`);
    }
    note.textContent = lines.join("\n");
  } catch (err) {
    note.textContent = `correction factor undefined: ${err instanceof Error ? err.message : String(err)}`;
    note.classList.add("warn");
  }
  const [x0, y0] = f.originPx;
  el("origin-note").textContent = `origin at pixel (${x0.toFixed(1)}, ${y0.toFixed(1)}); µm coordinates have y up`;
  el("set-origin").classList.toggle("active", app.originMode);
}

/** Read the frame inputs into the frame (an undoable edit). */
function frameInputsChanged() {
  /** @param {string} id @param {number} fallback @returns {number} */
  const number = (id, fallback) => {
    const text = inputEl(id).value.trim();
    return text !== "" && Number.isFinite(Number(text)) ? Number(text) : fallback;
  };
  const px = number("pixel-x", 0);
  const py = number("pixel-y", 0);
  /** @type {Frame} */
  const frame = {
    pixelNm: px > 0 && py > 0 ? [px, py] : px > 0 ? [px, px] : null,
    tiltDeg: number("tilt", 0),
    correction: selectEl("correction").value,
    customFactor: number("custom-factor", 1),
    axisDeg: normalizeDegrees(number("tilt-axis", 0), 180),
    rotationDeg: normalizeDegrees(number("rotation", 0), 360),
    originPx: app.frame.originPx,
  };
  if (JSON.stringify(frame) === JSON.stringify(app.frame)) {
    refreshFrameInputs();            // nothing changed (but show the inputs normalized)
    return;
  }
  pushHistory();
  changeFrame(() => {
    app.frame = frame;
  });
}

// ------------------------------------------------------------------------- display

const histCanvas = /** @type {HTMLCanvasElement} */ (el("histogram"));

/**
 * The black and white levels: lo shows black, hi white, linearly between (paintPicture).  Levels
 * closer than a millionth of the value range are pulled apart.  This is the display only: the
 * edge map and the snapping work on the grey values themselves.
 * @param {number} lo
 * @param {number} hi
 */
function setLevels(lo, hi) {
  if (app.image === null || !(Number.isFinite(lo) && Number.isFinite(hi))) {
    refreshDisplay();
    return;
  }
  const gap = Math.max((app.range[1] - app.range[0]) * 1e-6, 1e-9);
  [app.lo, app.hi] = lo <= hi ? [lo, hi] : [hi, lo];
  if (app.hi - app.lo < gap) {
    app.hi = app.lo + gap;
  }
  app.levelsChanged = true;
  refreshDisplay();
  render();
}

/**
 * @returns {[number, number]} the values the sliders span, m0 and m1 of (D3): the histogram's span,
 *     0 to 255 for an 8-bit image, else the values above the info bar
 */
function sliderSpan() {
  return app.hist === null ? [0, 1] : app.hist.span;
}

/**
 * The brightness slider moved to b: the window centred where b puts it, its width kept (D3).
 * @param {number} b
 */
function brightnessMoved(b) {
  const centre = centreOfBrightness(b, sliderSpan());
  const half = (app.hi - app.lo) / 2;
  setLevels(centre - half, centre + half);
}

/**
 * The contrast slider moved to c: the window as wide as c makes it, its centre kept (D3).
 * @param {number} c
 */
function contrastMoved(c) {
  const half = widthOfContrast(c, sliderSpan()) / 2;
  const centre = (app.lo + app.hi) / 2;
  setLevels(centre - half, centre + half);
}

/**
 * A grey value for the panel: whole for whole-number data, else six significant digits.
 * @param {number} v
 * @returns {string}
 */
function greyText(v) {
  return app.range[2] && Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(6)));
}

/** The level inputs, the sliders, the note and the histogram, from the levels. */
function refreshDisplay() {
  const h = app.hist;
  for (const id of ["black-level", "white-level", "brightness", "contrast", "levels-auto", "levels-full"]) {
    /** @type {HTMLInputElement|HTMLButtonElement} */ (el(id)).disabled = h === null;
  }
  if (h === null || app.image === null) {
    el("histogram-note").textContent = "No image.";
    drawHistogram();
    return;
  }
  inputEl("black-level").value = greyText(app.lo);
  inputEl("white-level").value = greyText(app.hi);
  const span = sliderSpan();
  inputEl("brightness").value = String(Math.round(1000 * sliderBrightness([app.lo, app.hi], span)));
  inputEl("contrast").value = String(Math.round(1000 * sliderContrast([app.lo, app.hi], span)));
  const rows = app.image.imageRows;
  const bar = app.image.height - rows;
  const bins = `${h.counts.length} bins${h.wholeBins ? ` of ${h.binWidth} value${h.binWidth === 1 ? "" : "s"}` : ""}`;
  const fixed = fixedSpan(app.image.bitsPerSample);
  const over = fixed === null ? "" : ` over ${fixed[0]} to ${fixed[1]} (${app.image.bitsPerSample} bits)`;
  el("histogram-note").textContent = `rows 0 to ${rows - 1}${bar ? ` (the ${bar}-row info bar left out)` : ""}: ` +
    `${(h.pixels / 1e6).toFixed(2)} M pixels, values ${greyText(h.min)} to ${greyText(h.max)}, in ${bins}${over}`;
  drawHistogram();
}

/**
 * A level handle: a triangle under the histogram's axis at x.
 * @param {CanvasRenderingContext2D} g
 * @param {number} x
 * @param {number} y
 * @param {string} fill
 */
function drawHandle(g, x, y, fill) {
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x - 5, y + 9);
  g.lineTo(x + 5, y + 9);
  g.closePath();
  g.fillStyle = fill;
  g.fill();
  g.strokeStyle = "#272727";
  g.lineWidth = 1;
  g.stroke();
}

/**
 * The histogram (linear or logarithmic counts), the clipped tails shaded, the mapping from black
 * to white drawn as a line, and the two level handles under the axis.  The axis runs from the
 * start of the first bin to the end of the last (D4).
 */
function drawHistogram() {
  const dpr = window.devicePixelRatio || 1;
  const w = histCanvas.clientWidth;
  const h = histCanvas.clientHeight;
  if (!(w > 0 && h > 0)) {
    return;
  }
  histCanvas.width = Math.round(w * dpr);
  histCanvas.height = Math.round(h * dpr);
  const g = /** @type {CanvasRenderingContext2D} */ (histCanvas.getContext("2d"));
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, w, h);
  const hist = app.hist;
  if (hist === null) {
    return;
  }
  const log = inputEl("histogram-log").checked;
  const f = (/** @type {number} */ n) => (log ? Math.log1p(n) : n);
  const top = Math.max(...Array.from(hist.counts, f), 1e-9);
  const base = h - 10;
  const bins = hist.counts.length;
  g.fillStyle = "#8a8a8a";
  hist.counts.forEach((count, b) => {
    const height = (f(count) / top) * (base - 4);
    if (height > 0) {
      g.fillRect((b * w) / bins, base - height, Math.max(w / bins, 1), height);
    }
  });
  const extent = bins * hist.binWidth;
  const x0 = ((app.lo - hist.start) / extent) * w;
  const x1 = ((app.hi - hist.start) / extent) * w;
  g.fillStyle = "rgba(56, 92, 158, 0.13)";
  g.fillRect(0, 0, Math.min(Math.max(x0, 0), w), base);
  g.fillRect(Math.max(Math.min(x1, w), 0), 0, w - Math.max(Math.min(x1, w), 0), base);
  g.strokeStyle = "#385c9e";
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(x0, base);
  g.lineTo(x1, 4);
  g.stroke();
  drawHandle(g, x0, base, "#000000");
  drawHandle(g, x1, base, "#ffffff");
}

/**
 * The grey value under a pointer on the histogram.
 * @param {PointerEvent} e
 * @returns {number}
 */
function histogramValue(e) {
  const r = histCanvas.getBoundingClientRect();
  const h = /** @type {Histogram} */ (app.hist);
  return h.start + ((e.clientX - r.left) / r.width) * h.counts.length * h.binWidth;
}

/**
 * Move the level being dragged on the histogram to v, short of the other.
 * @param {number} v
 */
function dragLevel(v) {
  if (app.levelDrag === "black") {
    setLevels(Math.min(v, app.hi), app.hi);
  } else if (app.levelDrag === "white") {
    setLevels(app.lo, Math.max(v, app.lo));
  }
}

// ------------------------------------------------------------------------- files

/** @returns {SnapSettings} */
function snapSettings() {
  return {
    on: settings.snap(), sigmaPx: settings.sigma(), median: settings.median(), radiusPx: settings.radius(),
    minContrast: settings.minContrast(),
  };
}

/** @returns {ImageInfo} */
function imageInfo() {
  const image = app.image;
  return {
    name: image ? image.name : "(no image)", sha256: app.sha256, width: image ? image.width : 0,
    height: image ? image.height : 0, databarRows: image ? image.height - image.imageRows : 0,
    microscope: image ? image.calibration.system : null,
  };
}

/** @returns {string} the polygon file of the current contours */
function polygonText() {
  const s = snapSettings();
  const snap = `sigma_px=${s.sigmaPx} median=${s.median} radius_px=${s.radiusPx} min_contrast=${s.minContrast} ` +
    `snap=${s.on ? "on" : "off"}`;
  return formatPolygonFile(imageInfo(), app.frame, app.contours.filter((c) => c.points.length > 0), snap);
}

/** @returns {string} the measurements file */
function measurementText() {
  return formatMeasurementFile(imageInfo(), app.frame, app.measurements, (ms) => profileMean(ms));
}

/** @returns {string} the session file */
function sessionText() {
  return formatSession({
    image: imageInfo(), frame: app.frame, snap: snapSettings(), contours: app.contours.filter((c) => c.points.length > 0),
    measurements: app.measurements, activeContour: app.active, display: app.image ? [app.lo, app.hi] : null,
  }, new Date().toISOString());
}

/**
 * Offer ``content`` as a download named ``name``.
 * @param {string|Uint8Array} content
 * @param {string} name
 * @param {string} type
 */
function download(content, name, type) {
  const part = typeof content === "string" ? content : new Uint8Array(content);
  const url = URL.createObjectURL(new Blob([part], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  setStatus(`Saved ${name}`);
}

/** @returns {string} the image's name without its extension */
function stem() {
  return app.image ? app.image.name.replace(/\.[^.]+$/, "") : "sem";
}

function saveSession() {
  download(sessionText(), `${stem()}_session.json`, "application/json");
  app.dirty = false;
}

function exportPolygons() {
  download(polygonText(), `${stem()}_polygons.csv`, "text/csv;charset=utf-8");
}

function exportMeasurements() {
  download(measurementText(), `${stem()}_measurements.csv`, "text/csv;charset=utf-8");
}

/**
 * Whether work saved for the image ``name`` with ``sha256`` may be loaded onto the open one.
 * @param {string|null|undefined} sha256
 * @param {string|null|undefined} name
 * @returns {boolean}
 */
function sameImageOrConfirmed(sha256, name) {
  if (app.image === null) {
    window.alert(`Open the image first${name ? ` (${name})` : ""}.`);
    return false;
  }
  return !(sha256 && app.sha256 && sha256 !== app.sha256) ||
    window.confirm(`This was saved for another image (${name || "unnamed"}).  Load it anyway?`);
}

/**
 * Load contours (and the frame they were traced in) from a polygon file.
 * @param {string} text
 * @param {string} name
 * @returns {boolean}
 */
function loadPolygonText(text, name) {
  /** @type {PolygonFile} */
  let file;
  try {
    file = parsePolygonFile(text);
  } catch (err) {
    window.alert(`Could not read ${name}:\n${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
  if (!sameImageOrConfirmed(file.meta.image_sha256, file.meta.image)) {
    return false;
  }
  const frame = frameFromMeta(file.meta, app.frame);
  /** @type {Contour[]} */
  const contours = [];
  for (const c of file.contours) {
    let points = c.px;
    if (points === null && c.um !== null) {
      const converted = c.um.map((p) => fromMeasurement(frame, p[0], p[1]));
      points = converted.every((p) => p !== null) ? /** @type {Point[]} */ (converted) : null;
    }
    if (points === null) {
      window.alert(`Contour "${c.name}" has neither pixel coordinates nor usable micrometres; it is skipped.`);
      continue;
    }
    contours.push({ name: c.name, closed: c.closed, points });
  }
  pushHistory();
  app.contours = contours.length ? contours : [{ name: "contour 1", closed: true, points: [] }];
  app.active = 0;
  clearPicked();
  changeFrame(() => {
    app.frame = frame;
  });
  setStatus(`Loaded ${contours.length} contour(s) from ${name}`);
  return true;
}

/**
 * Take up a session: frame, contours, measurements and snap settings.
 * @param {string} text
 * @param {string} name
 * @returns {boolean}
 */
function loadSessionText(text, name) {
  /** @type {Session} */
  let session;
  try {
    session = parseSession(text);
  } catch (err) {
    window.alert(`Could not read ${name}:\n${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
  if (!sameImageOrConfirmed(session.image.sha256, session.image.name)) {
    return false;
  }
  pushHistory();
  app.contours = session.contours.length ? session.contours : [{ name: "contour 1", closed: true, points: [] }];
  app.active = session.activeContour;
  clearPicked();
  app.measurements = session.measurements;
  app.selected = session.measurements.length - 1;
  const s = session.snap;
  inputEl("snap").checked = s.on;
  inputEl("sigma").value = String(s.sigmaPx);
  selectEl("median").value = String(s.median);
  inputEl("radius").value = String(s.radiusPx);
  inputEl("min-contrast").value = String(s.minContrast);
  changeFrame(() => {
    app.frame = session.frame;
  });
  if (session.display !== null) {
    setLevels(session.display[0], session.display[1]);
  }
  app.dirty = false;
  refreshEdges();
  setStatus(`Took up ${name}: ${session.contours.length} contour(s), ${session.measurements.length} measurement(s)`);
  return true;
}

/**
 * Open a file: a session (.json) or polygon file (.csv, .txt), else an image.
 * @param {File} file
 */
async function openFile(file) {
  const buffer = await file.arrayBuffer();
  if (/\.json$/i.test(file.name)) {
    loadSessionText(new TextDecoder("utf-8").decode(buffer), file.name);
  } else if (/\.(csv|txt)$/i.test(file.name)) {
    loadPolygonText(new TextDecoder("utf-8").decode(buffer), file.name);
  } else if (!app.dirty || !hasWork() || window.confirm("Discard the unsaved work and open another image?")) {
    await openImageBuffer(file.name, buffer);
  }
}

/** @returns {boolean} whether there are contours or measurements */
function hasWork() {
  return app.measurements.length > 0 || app.contours.some((c) => c.points.length > 0);
}

/** Read the active contour's GDS layer and datatype from the panel (an undoable edit). */
function layerInputsChanged() {
  const layer = Number(inputEl("contour-layer").value);
  const datatype = Number(inputEl("contour-datatype").value);
  const ok = (/** @type {number} */ v) => Number.isInteger(v) && v >= 0 && v <= 32767;
  const c = activeContour();
  const [l, d] = c.layer ?? [1, 0];
  if (!ok(layer) || !ok(datatype)) {
    setStatus("A GDS layer and datatype are whole numbers from 0 to 32767.");
  } else if (layer !== l || datatype !== d) {
    pushHistory();
    c.layer = [layer, datatype];
  }
  refreshContours();
}

// ------------------------------------------------------------------------- vertex window

function toggleVertexWindow() {
  const w = el("vertex-window");
  w.hidden = !w.hidden;
  refreshVertexWindow();
}

/** The rows of the vertex window: the active contour in the measurement frame, (G8). */
function refreshVertexWindow() {
  if (el("vertex-window").hidden) {
    return;
  }
  const c = activeContour();
  const m = measurementMatrix(app.frame);
  const unit = m === null ? "?" : unitText(m.unit);
  const digits = m !== null && m.unit === "um" ? 4 : 2;
  el("vertex-title").textContent = `Vertices of ${c.name}`;
  el("vertex-x-head").textContent = `X (${unit})`;
  el("vertex-y-head").textContent = `Y (${unit})`;
  const picked = new Set(app.picked);
  el("vertex-rows").replaceChildren(...c.points.map((p, i) => {
    const row = document.createElement("tr");
    row.dataset.i = String(i);
    row.classList.toggle("picked", picked.has(i));
    const q = toMeasurement(app.frame, p[0], p[1]);
    [String(i), q ? q[0].toFixed(digits) : "-", q ? q[1].toFixed(digits) : "-"].forEach((text, k) => {
      const cell = document.createElement("td");
      cell.textContent = text;
      if (k > 0) {
        cell.dataset.axis = k === 1 ? "x" : "y";
      }
      row.append(cell);
    });
    return row;
  }));
  const one = app.picked.length === 1;
  buttonEl("vertex-first").disabled = !(one && c.closed);
  for (const id of ["vertex-up", "vertex-down", "vertex-drop"]) {
    buttonEl(id).disabled = app.picked.length === 0;
  }
  buttonEl("vertex-reverse").disabled = c.points.length < 2;
  const why = m === null ? "  The correction factor is undefined: no coordinates." : "";
  el("vertex-note").textContent = `${c.points.length} vertices, ${app.picked.length} selected (${c.closed ? "closed" : "open"}).${why}`;
}

/**
 * Pick vertex ``i`` of the active contour: alone, toggled, or the range from the last one picked.
 * @param {number} i
 * @param {"only"|"toggle"|"range"} how
 */
function pickVertex(i, how) {
  if (how === "range" && app.pickAnchor >= 0) {
    app.picked = selectionRange(app.pickAnchor, i);
  } else if (how === "toggle") {
    const set = new Set(app.picked);
    if (set.has(i)) {
      set.delete(i);
    } else {
      set.add(i);
    }
    app.picked = [...set].sort((a, b) => a - b);
    app.pickAnchor = i;
  } else {
    app.picked = [i];
    app.pickAnchor = i;
  }
  refreshVertexWindow();
  render();
}

/**
 * Replace the active contour's points (an undoable edit) and the selection.
 * @param {Point[]} points
 * @param {number[]} picked
 */
function setVertices(points, picked) {
  const c = activeContour();
  if (JSON.stringify(points) === JSON.stringify(c.points)) {
    return;
  }
  pushHistory();
  c.points = points;
  app.picked = picked;
  refreshContours();
  render();
}

/** @param {number} step  -1 (up, earlier) or 1 */
function movePicked(step) {
  const r = moveSelected(activeContour().points, app.picked, step);
  setVertices(r.points, r.selected);
}

function dropPicked() {
  if (app.picked.length) {
    setVertices(dropSelected(activeContour().points, app.picked), []);
    app.pickAnchor = -1;
  }
}

function makePickedFirst() {
  const c = activeContour();
  if (app.picked.length === 1 && c.closed) {
    setVertices(makeFirst(c.points, app.picked[0]), [0]);
  }
}

function reversePicked() {
  const c = activeContour();
  const r = reverseContour(c.points, c.closed, app.picked);
  setVertices(r.points, r.selected);
}

/**
 * Type a coordinate of vertex ``i`` in the measurement frame; the vertex moves to the stored
 * point that the inverse map (G10) gives.
 * @param {number} i
 * @param {string} axis   "x" or "y"
 * @param {number} value
 */
function setVertexCoordinate(i, axis, value) {
  const c = activeContour();
  const p = c.points[i];
  const q = p === undefined ? null : toMeasurement(app.frame, p[0], p[1]);
  const u = q === null ? null : fromMeasurement(app.frame, axis === "x" ? value : q[0], axis === "y" ? value : q[1]);
  if (u !== null) {
    const points = c.points.slice();
    points[i] = u;
    setVertices(points, app.picked);
  }
}

/**
 * Turn a coordinate cell into an input; Enter (or leaving it) sets the value, Esc drops it.
 * @param {HTMLTableCellElement} cell
 */
function editCoordinate(cell) {
  const row = cell.parentElement;
  const axis = cell.dataset.axis;
  if (!(row instanceof HTMLTableRowElement) || axis === undefined || measurementMatrix(app.frame) === null) {
    return;
  }
  const i = Number(row.dataset.i);
  const input = document.createElement("input");
  input.type = "number";
  input.step = "any";
  input.value = cell.textContent ?? "";
  input.setAttribute("aria-label", `${axis.toUpperCase()} of vertex ${i}`);
  cell.replaceChildren(input);
  input.focus();
  input.select();
  let done = false;
  /** @param {boolean} keep */
  const finish = (keep) => {
    if (done) {
      return;
    }
    done = true;
    const value = Number(input.value);
    if (keep && input.value.trim() !== "" && Number.isFinite(value)) {
      setVertexCoordinate(i, axis, value);
    }
    refreshVertexWindow();
  };
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter" || e.key === "Escape") {
      finish(e.key === "Enter");
    }
  });
  input.addEventListener("blur", () => finish(true));
}

/** Centre the view on the picked vertices (all of the contour when none), at least 40 view units wide. */
function zoomToPicked() {
  const c = activeContour();
  const which = app.picked.length ? app.picked : c.points.map((_, i) => i);
  if (!which.length) {
    return;
  }
  const v = viewMatrix(app.frame);
  /** @type {Mat2} */
  const fv = [v[0], v[1], -v[2], -v[3]];
  const q = which.map((i) => matApply(fv, c.points[i][0] + 0.5, c.points[i][1] + 0.5));
  const xs = q.map((p) => p[0]);
  const ys = q.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const rect = canvas.getBoundingClientRect();
  const s = Math.min(rect.width / Math.max(x1 - x0, 40), rect.height / Math.max(y1 - y0, 40)) * 0.6;
  app.view.s = Math.min(200, Math.max(0.01, s));
  app.view.tx = rect.width / 2 - (app.view.s * (x0 + x1)) / 2;
  app.view.ty = rect.height / 2 - (app.view.s * (y0 + y1)) / 2;
  render();
}

/**
 * Arrow keys move the picked vertices by one view unit on screen, ten with Shift (G15).  Returns
 * whether the key was one of them.
 * @param {KeyboardEvent} e
 * @returns {boolean}
 */
function arrowKey(e) {
  /** @type {Record<string, [number, number]>} */
  const steps = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  const d = steps[e.key];
  if (d === undefined || app.picked.length === 0) {
    return false;
  }
  e.preventDefault();
  const k = e.shiftKey ? 10 : 1;
  const [sx, sy] = viewStepToStored(app.frame, k * d[0], k * d[1]);
  const c = activeContour();
  setVertices(c.points.map((p, i) => (app.picked.includes(i) ? [p[0] + sx, p[1] + sy] : p)), app.picked);
  return true;
}

// ------------------------------------------------------------------------- profile window

const profileCanvas = /** @type {HTMLCanvasElement} */ (el("profile-plot"));

/**
 * @typedef {Object} ProfileData
 * @property {ProfileGeometry} geometry
 * @property {Profile} profile
 * @property {Array<{name: string, contour: number, t: number, distance: number}>} crossings
 */

/** What the plot shows, and where its axis lies on the canvas (CSS pixels), for the cursor. */
const profilePlot = {
  /** @type {ProfileData|null} */
  data: null,
  left: 0,
  right: 1,
};

function toggleProfileWindow() {
  const w = el("profile-window");
  w.hidden = !w.hidden;
  if (w.hidden) {
    app.profileCursor = null;
    render();
  }
  refreshProfileWindow();
}

/** @returns {Measurement|null} the profile the window shows: the selected measurement, when it is a profile */
function shownProfile() {
  const ms = app.measurements[app.selected];
  return ms !== undefined && ms.kind === "profile" ? ms : null;
}

/** @returns {number} the measurement unit (um or px) per pixel width of the corrected view: c of (P2) */
function unitsPerView() {
  return app.frame.pixelNm ? app.frame.pixelNm[0] / 1000 : 1;
}

/**
 * The samples of a profile (P2)-(P4) and the contours that cross it (P5).
 * @param {Measurement} ms
 * @returns {ProfileData|null}
 */
function profileData(ms) {
  if (app.image === null) {
    return null;
  }
  const geometry = profileGeometry(ms.points, ms.width ?? 1, app.frame);
  return {
    geometry, profile: sampleProfile(app.image, geometry),
    crossings: profileCrossings(ms.points, app.contours).map((c) => ({
      ...c, name: app.contours[c.contour].name, distance: c.t * geometry.length,
    })),
  };
}

/**
 * The mean grey value of all the band's samples, or null when none lies in the image.
 * @param {Measurement} ms
 * @returns {number|null}
 */
function profileMean(ms) {
  const data = profileData(ms);
  if (data === null) {
    return null;
  }
  const { mean, count } = data.profile;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < mean.length; i++) {
    if (count[i] > 0) {
      sum += mean[i] * count[i];
      n += count[i];
    }
  }
  return n > 0 ? sum / n : null;
}

/** The window's title, width, notes and plot, from the selected profile. */
function refreshProfileWindow() {
  if (el("profile-window").hidden) {
    return;
  }
  const ms = shownProfile();
  const data = ms === null ? null : profileData(ms);
  profilePlot.data = data;
  el("profile-title").textContent = ms === null ? "Profile" : `Profile: ${ms.name}`;
  const width = inputEl("profile-width");
  width.disabled = data === null;
  el("profile-width-unit").textContent = app.frame.pixelNm ? "µm" : "px";
  if (data !== null && document.activeElement !== width) {
    width.value = String(Number(data.geometry.width.toPrecision(6)));
  }
  buttonEl("profile-export").disabled = data === null;
  el("profile-note").textContent = profileNote(data);
  showProfileReadout();
  drawProfilePlot();
}

/**
 * The window's note: the sampling, and the contours that cross the line.
 * @param {ProfileData|null} data
 * @returns {string}
 */
function profileNote(data) {
  if (data === null) {
    return app.image === null ? "No image." : "Select a profile under Measurements, or draw one with the profile tool (5).";
  }
  const { geometry: g, crossings } = data;
  const unit = g.unit === null ? "" : ` ${unitText(g.unit)}`;
  const lines = [`${g.samples} samples along, ${g.offsets.length} line${g.offsets.length === 1 ? "" : "s"} across the band`];
  /** @type {Map<string, string[]>} */
  const byContour = new Map();
  for (const c of crossings) {
    byContour.set(c.name, [...(byContour.get(c.name) ?? []), Number.isFinite(c.distance) ? show(c.distance) : "?"]);
  }
  lines.push(byContour.size === 0 ? "no contour crosses the line"
    : `crossed by ${[...byContour].map(([name, at]) => `${name} at ${at.join(", ")}${unit}`).join("; ")}`);
  return lines.join("\n");
}

/** The readout under the plot: the value at the cursor, or a hint. */
function showProfileReadout() {
  const data = profilePlot.data;
  const t = app.profileCursor;
  const out = el("profile-readout");
  if (data === null || t === null) {
    out.textContent = data === null ? "" : "Point at the plot to read a value; the image marks the place.";
    return;
  }
  const { profile, geometry } = data;
  const i = Math.round(t * (profile.mean.length - 1));
  const unit = geometry.unit === null ? "" : ` ${unitText(geometry.unit)}`;
  const at = Number.isFinite(profile.distance[i]) ? `${profile.distance[i].toFixed(geometry.unit === "um" ? 4 : 2)}${unit}` : "?";
  const spread = profile.count[i] > 1 ? ` ± ${String(Number(profile.spread[i].toPrecision(4)))} (${profile.count[i]} values across)` : "";
  out.textContent = profile.count[i] === 0 ? `at ${at}: outside the image` : `at ${at}: ${greyText(profile.mean[i])}${spread}`;
}

/**
 * Tick values for an axis from lo to hi: steps of 1, 2 or 5 times a power of ten, about ``n`` of them.
 * @param {number} lo
 * @param {number} hi
 * @param {number} n
 * @returns {{ticks: number[], digits: number}}
 */
function niceTicks(lo, hi, n) {
  const raw = (hi - lo) / Math.max(n, 1);
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((f) => f * power).find((s) => s >= raw) ?? 10 * power;
  const ticks = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) {
    ticks.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  }
  return { ticks, digits: Math.max(0, -Math.floor(Math.log10(step) + 1e-9)) };
}

/**
 * The plot: the mean along the line, its spread across the band shaded, the contours that cross
 * the line as dashed verticals in their colours, and the cursor.
 */
function drawProfilePlot() {
  const dpr = window.devicePixelRatio || 1;
  const w = profileCanvas.clientWidth;
  const h = profileCanvas.clientHeight;
  if (!(w > 0 && h > 0)) {
    return;
  }
  profileCanvas.width = Math.round(w * dpr);
  profileCanvas.height = Math.round(h * dpr);
  const g = /** @type {CanvasRenderingContext2D} */ (profileCanvas.getContext("2d"));
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, w, h);
  g.font = LABEL_FONT;
  const data = profilePlot.data;
  const length = data === null ? NaN : data.geometry.length;
  if (data === null || !(length > 0)) {
    g.fillStyle = "#6f6f6f";
    g.textAlign = "center";
    g.fillText(data === null ? "no profile selected" : "no length: check the tilt correction", w / 2, h / 2);
    return;
  }
  const { profile, crossings, geometry } = data;
  const wide = geometry.offsets.length > 1;
  let lo = Infinity;
  let hi = -Infinity;
  profile.mean.forEach((m, i) => {
    if (profile.count[i] > 0) {
      const s = wide ? profile.spread[i] : 0;
      lo = Math.min(lo, m - s);
      hi = Math.max(hi, m + s);
    }
  });
  if (!(hi >= lo)) {
    [lo, hi] = [0, 1];
  }
  const pad = hi > lo ? 0.06 * (hi - lo) : 1;
  [lo, hi] = [lo - pad, hi + pad];
  const [left, right, top, bottom] = [58, w - 12, 10, h - 30];
  profilePlot.left = left;
  profilePlot.right = right;
  /** @param {number} s @returns {number} */
  const X = (s) => left + (s / length) * (right - left);
  /** @param {number} v @returns {number} */
  const Y = (v) => bottom - ((v - lo) / (hi - lo)) * (bottom - top);
  drawPlotAxes(g, { left, right, top, bottom }, { length, lo, hi, unit: geometry.unit });
  // the spread across the band, then the mean, both broken where no line has a value
  const runs = [];
  let run = [];
  for (let i = 0; i < profile.mean.length; i++) {
    if (profile.count[i] > 0) {
      run.push(i);
    } else if (run.length) {
      runs.push(run);
      run = [];
    }
  }
  if (run.length) {
    runs.push(run);
  }
  for (const r of runs) {
    if (wide) {
      g.fillStyle = "rgba(56, 92, 158, 0.16)";
      g.beginPath();
      r.forEach((i, k) => (k === 0 ? g.moveTo : g.lineTo).call(g, X(profile.distance[i]), Y(profile.mean[i] + profile.spread[i])));
      [...r].reverse().forEach((i) => g.lineTo(X(profile.distance[i]), Y(profile.mean[i] - profile.spread[i])));
      g.closePath();
      g.fill();
    }
    g.strokeStyle = PLOT_COLOR;
    g.lineWidth = 1.5;
    g.beginPath();
    r.forEach((i, k) => (k === 0 ? g.moveTo : g.lineTo).call(g, X(profile.distance[i]), Y(profile.mean[i])));
    g.stroke();
  }
  drawPlotCrossings(g, crossings.map((c) => ({ x: X(c.distance), name: c.name, active: c.contour === app.active })), top, bottom);
  if (app.profileCursor !== null) {
    const x = X(app.profileCursor * length);
    g.strokeStyle = PREVIEW_COLOR;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x, top);
    g.lineTo(x, bottom);
    g.stroke();
    const i = Math.round(app.profileCursor * (profile.mean.length - 1));
    if (profile.count[i] > 0) {
      g.beginPath();
      g.arc(x, Y(profile.mean[i]), 3.5, 0, 2 * Math.PI);
      g.stroke();
    }
  }
}

/**
 * The plot's frame, ticks and labels.
 * @param {CanvasRenderingContext2D} g
 * @param {{left: number, right: number, top: number, bottom: number}} box
 * @param {{length: number, lo: number, hi: number, unit: "um"|"px"|null}} range
 */
function drawPlotAxes(g, box, range) {
  const { left, right, top, bottom } = box;
  g.strokeStyle = "#d4d4d0";
  g.lineWidth = 1;
  g.strokeRect(left, top, right - left, bottom - top);
  g.fillStyle = "#6f6f6f";
  const xs = niceTicks(0, range.length, (right - left) / 80);
  g.textAlign = "center";
  g.textBaseline = "top";
  for (const v of xs.ticks) {
    const x = left + (v / range.length) * (right - left);
    g.fillRect(x, bottom, 1, 4);
    g.fillText(v.toFixed(xs.digits), x, bottom + 6);
  }
  g.textAlign = "right";
  g.fillText(`distance (${range.unit === null ? "?" : unitText(range.unit)})`, right, bottom + 17);
  const ys = niceTicks(range.lo, range.hi, (bottom - top) / 36);
  g.textBaseline = "middle";
  for (const v of ys.ticks) {
    const y = bottom - ((v - range.lo) / (range.hi - range.lo)) * (bottom - top);
    g.fillRect(left - 4, y, 4, 1);
    g.fillText(v.toFixed(ys.digits), left - 6, y);
  }
}

/**
 * The contours that cross the line, as dashed verticals in their colours with their names.
 * @param {CanvasRenderingContext2D} g
 * @param {Array<{x: number, name: string, active: boolean}>} marks
 * @param {number} top
 * @param {number} bottom
 */
function drawPlotCrossings(g, marks, top, bottom) {
  g.save();
  g.textAlign = "left";
  g.textBaseline = "top";
  marks.forEach((m, k) => {
    g.strokeStyle = m.active ? ACTIVE_COLOR : OTHER_COLOR;
    g.lineWidth = 1.5;
    g.setLineDash([5, 3]);
    g.beginPath();
    g.moveTo(m.x, top);
    g.lineTo(m.x, bottom);
    g.stroke();
    g.setLineDash([]);
    const y = top + 3 + (k % 3) * 14;             // names in three rows, so that close ones do not cover each other
    g.lineWidth = 3;
    g.strokeStyle = "rgba(255, 255, 255, 0.9)";
    g.strokeText(m.name, m.x + 3, y);
    g.fillStyle = "#272727";
    g.fillText(m.name, m.x + 3, y);
  });
  g.restore();
}

/**
 * The band width of the shown profile, in pixel widths of the corrected view (an undoable edit).
 * @param {number} width
 */
function setProfileWidth(width) {
  const ms = shownProfile();
  if (ms === null || !(Number.isFinite(width) && width >= 0)) {
    refreshProfileWindow();
    return;
  }
  if (width !== ms.width) {
    pushHistory();
    ms.width = width;
    app.profileWidth = width;
    refreshMeasurements();
    render();
  }
}

/**
 * The cursor on the plot: where along the line it is.
 * @param {PointerEvent} e
 */
function profilePlotPointer(e) {
  if (profilePlot.data === null) {
    return;
  }
  const r = profileCanvas.getBoundingClientRect();
  const t = (e.clientX - r.left - profilePlot.left) / (profilePlot.right - profilePlot.left);
  app.profileCursor = Math.min(1, Math.max(0, t));
  showProfileReadout();
  drawProfilePlot();
  render();
}

function exportProfile() {
  const ms = shownProfile();
  const data = ms === null ? null : profileData(ms);
  if (ms === null || data === null) {
    return;
  }
  const name = ms.name.replace(/[^A-Za-z0-9._-]+/g, "_");
  download(formatProfileFile(imageInfo(), app.frame, ms, data.profile, data.crossings), `${stem()}_${name}.csv`,
    "text/csv;charset=utf-8");
}

// ------------------------------------------------------------------------- GDS

/**
 * The export settings of the GDS dialog.
 * @returns {{cellName: string, pathWidth: number, names: boolean, measurements: boolean, annotation: [number, number]}}
 */
function gdsOptions() {
  const width = Number(inputEl("gds-path-width").value);
  return {
    cellName: inputEl("gds-cell").value.trim(), pathWidth: Number.isFinite(width) && width > 0 ? width : 0,
    names: inputEl("gds-names").checked, measurements: inputEl("gds-measurements").checked,
    annotation: [Number(inputEl("gds-annotation-layer").value), Number(inputEl("gds-annotation-datatype").value)],
  };
}

/**
 * A measurement's value as GDS text (ASCII).
 * @param {Measurement} ms
 * @returns {string}
 */
function gdsValue(ms) {
  if (ms.kind === "ruler" || ms.kind === "profile") {
    const r = measureRuler(ms.points, app.frame);
    const band = ms.kind === "profile" ? `, band ${Number(profileGeometry(ms.points, ms.width ?? 1, app.frame).width.toPrecision(6))} um` : "";
    return r === null ? "?" : `${Number(r.length.toPrecision(6))} um${band}`;
  }
  const a = ms.kind === "angle" ? measureAngle(ms.points, app.frame) : (measureLineAngle(ms.points, app.frame)?.angleDeg ?? null);
  return a === null ? "?" : `${a.toFixed(3)} deg`;
}

/**
 * Where a measurement's label goes (um): a ruler's middle, an angle's vertex, where two lines
 * cross (or their points' centre when they cross far away or not at all).
 * @param {Measurement} ms
 * @param {Point[]} pts    the measurement's points in um
 * @returns {Point}
 */
function gdsLabelAt(ms, pts) {
  const mean = pts.reduce((acc, p) => [acc[0] + p[0] / pts.length, acc[1] + p[1] / pts.length], [0, 0]);
  if (ms.kind === "ruler" || ms.kind === "profile") {
    return [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2];
  }
  if (ms.kind === "angle") {
    return pts[1];
  }
  const span = Math.max(...pts.map((p) => Math.hypot(p[0] - mean[0], p[1] - mean[1])));
  const cross = lineIntersection(pts[0], pts[1], pts[2], pts[3]);
  return cross !== null && Math.hypot(cross[0] - mean[0], cross[1] - mean[1]) < 10 * span ? cross : /** @type {Point} */ (mean);
}

/**
 * The elements of the GDS file, points in the measurement frame (um): closed contours as
 * boundaries and the others as paths, each on its layer, then the names and the measurements
 * when asked.
 * @param {ReturnType<typeof gdsOptions>} options
 * @returns {GdsElement[]}
 */
function gdsElements(options) {
  /** @param {Point} p @returns {Point} */
  const um = (p) => /** @type {Point} */ (toMeasurement(app.frame, p[0], p[1]));
  /** @type {GdsElement[]} */
  const out = [];
  for (const c of app.contours.filter((k) => k.points.length > 0)) {
    const [layer, datatype] = c.layer ?? [1, 0];
    const points = c.points.map(um);
    out.push(c.closed && points.length >= 3 ? { kind: "boundary", layer, datatype, points }
      : { kind: "path", layer, datatype, points, width: options.pathWidth });
    if (options.names) {
      out.push({ kind: "text", layer, datatype, points: [points[0]], text: c.name });
    }
  }
  if (options.measurements) {
    const [layer, datatype] = options.annotation;
    for (const ms of app.measurements) {
      const pts = ms.points.map(um);
      const lines = ms.kind === "line-angle" ? [pts.slice(0, 2), pts.slice(2, 4)] : [pts];
      // a profile's band is a path as wide as the band, with flush ends: the band itself
      const width = ms.kind === "profile" ? profileGeometry(ms.points, ms.width ?? 1, app.frame).width : 0;
      out.push(...lines.map((points) => /** @type {GdsElement} */ ({ kind: "path", layer, datatype, points, width })),
        { kind: "text", layer, datatype, points: [gdsLabelAt(ms, pts)], text: `${ms.name}: ${gdsValue(ms)}` });
    }
  }
  return out;
}

/**
 * The GDS file of the current work (FORMAT.md), or null with a message when there are no
 * micrometres.
 * @param {ReturnType<typeof gdsOptions>} options
 * @returns {{bytes: Uint8Array, skipped: string[]}|null}
 */
function gdsFile(options) {
  const m = measurementMatrix(app.frame);
  if (app.image === null || m === null || m.unit !== "um") {
    window.alert("GDS export needs micrometres: set the pixel size, and a tilt correction that is defined.");
    return null;
  }
  return formatGds({
    libName: "SEM_MEASUREMENT_TOOL", cellName: options.cellName || gdsName(stem(), "TOP"), elements: gdsElements(options),
    date: new Date(),
  });
}

function openGdsDialog() {
  if (app.image === null) {
    return;
  }
  const cell = inputEl("gds-cell");
  if (cell.dataset.image !== app.image.name) {          // a new image: name the cell after it
    cell.value = gdsName(stem(), "TOP");
    cell.dataset.image = app.image.name;
  }
  /** @type {HTMLDialogElement} */ (el("gds-dialog")).showModal();
}

function exportGds() {
  const file = gdsFile(gdsOptions());
  if (file !== null) {
    download(file.bytes, `${stem()}.gds`, "application/octet-stream");
    if (file.skipped.length) {
      window.alert(`Left out of the GDS file:\n${file.skipped.join("\n")}`);
    }
  }
}

// ------------------------------------------------------------------------- events

/**
 * The canvas position of a pointer event.
 * @param {MouseEvent} e
 * @returns {Point}
 */
function eventPoint(e) {
  const rect = canvas.getBoundingClientRect();
  return [e.clientX - rect.left, e.clientY - rect.top];
}

/**
 * Status bar text for the cursor at stored (x, y).
 * @param {number} x
 * @param {number} y
 */
function showCursor(x, y) {
  const parts = [`x ${x.toFixed(1)}  y ${y.toFixed(1)} px`];
  const um = app.frame.pixelNm ? toMeasurement(app.frame, x, y) : null;
  if (um !== null) {
    parts.push(`X ${um[0].toFixed(4)}  Y ${um[1].toFixed(4)} µm`);
  }
  const image = app.image;
  if (image !== null && insideImage(x, y)) {
    const i = Math.min(image.height - 1, Math.max(0, Math.round(y)));
    const j = Math.min(image.width - 1, Math.max(0, Math.round(x)));
    parts.push(`value ${Number(image.data[i * image.width + j].toPrecision(6))}`);
    if (i >= image.imageRows) {
      parts.push("data bar (ignored)");
    } else if (app.edges !== null) {
      parts.push(`edge ${app.edges.contrast(x, y).toFixed(1)} × median`);
    }
  }
  setStatus(parts.join("    "));
}

/**
 * Right click: cancel the measurement being placed, else delete what is under the cursor; with
 * no tool, nothing.
 * @param {number} sx
 * @param {number} sy
 */
function rightClick(sx, sy) {
  if (app.pending !== null) {
    app.pending = null;
    render();
    return;
  }
  if (app.tool === "pan") {
    return;
  }
  if (app.tool === "contour") {
    const hit = hitVertex(sx, sy);
    if (hit !== null) {
      pushHistory();
      setActive(hit.index);
      app.contours[hit.index].points.splice(hit.point, 1);
      forgetVertex(hit.point);
      refreshContours();
      render();
    }
    return;
  }
  const hit = hitMeasurePoint(sx, sy);
  if (hit !== null) {
    deleteMeasurement(hit.index);
  }
}

/**
 * Start dragging what lies under a screen point with the current tool: a vertex (contour tool),
 * or a profile's width handle or a measurement's point (measurement tools, unless one is being
 * placed).  Returns whether a drag began.
 * @param {number} sx
 * @param {number} sy
 * @returns {boolean}
 */
function startDragAt(sx, sy) {
  if (app.tool === "contour") {
    const hit = hitVertex(sx, sy);
    if (hit === null) {
      return false;
    }
    pushHistory();
    app.drag = { kind: "vertex", index: hit.index, point: hit.point, moved: false };
    setActive(hit.index);
    refreshContours();
    render();
    return true;
  }
  if (app.tool === "pan" || app.pending !== null) {
    return false;
  }
  if (hitWidthHandle(sx, sy)) {
    pushHistory();
    app.drag = { kind: "width", index: app.selected, point: 0, moved: false };
    return true;
  }
  const hit = hitMeasurePoint(sx, sy);
  if (hit === null) {
    return false;
  }
  pushHistory();
  app.drag = { kind: "point", index: hit.index, point: hit.point, moved: false };
  app.selected = hit.index;
  refreshMeasurements();
  render();
  return true;
}

/**
 * A click with the current tool where there is nothing to drag: a vertex of the active contour
 * (inserted into the nearest segment with ``insert``), or the next point of a measurement;
 * snapped unless ``exact``.
 * @param {number} sx
 * @param {number} sy
 * @param {boolean} exact
 * @param {boolean} insert
 */
function clickAt(sx, sy, exact, insert) {
  const [x, y] = screenToStored(sx, sy);
  if (!insideImage(x, y)) {
    return;
  }
  if (app.tool === "contour") {
    addVertex(x, y, { exact, insert });
  } else {
    placePoint(x, y, exact);
  }
}

/**
 * "Set origin": the next click or tap puts the origin there.
 * @param {number} sx
 * @param {number} sy
 */
function setOriginAt(sx, sy) {
  pushHistory();
  app.frame.originPx = screenToStored(sx, sy);
  app.originMode = false;
  refreshFrameNotes();
  refreshContours();
  render();
}

/**
 * Move what is dragged to stored (x, y): a point, or the band width of a profile.
 * @param {number} x
 * @param {number} y
 */
function dragTo(x, y) {
  const points = draggedPoints();
  if (points !== null && app.drag !== null) {
    points[app.drag.point] = [x, y];
    app.drag.moved = true;
  } else if (app.drag !== null && app.drag.kind === "width") {
    const ms = app.measurements[app.drag.index];
    ms.width = widthFromPoint(ms.points, app.frame, [x, y]);
    app.profileWidth = ms.width;
    app.drag.moved = true;
  }
  if (app.drag !== null) {
    refreshProfileWindow();          // the profile and its crossings follow the drag
  }
}

/**
 * Release what is dragged at stored (x, y).  A point snaps unless ``exact`` (a profile's ends never
 * do); a vertex let go without moving is selected in the vertex window (added or removed with
 * ``toggle``).
 * @param {number} x
 * @param {number} y
 * @param {boolean} exact
 * @param {boolean} toggle
 */
function endDrag(x, y, exact, toggle) {
  const drag = app.drag;
  const points = draggedPoints();
  app.drag = null;
  if (drag === null) {
    return;
  }
  if (!drag.moved) {
    app.history.pop();             // a click on a point without moving it changed nothing
    if (drag.kind === "vertex") {
      pickVertex(drag.point, toggle ? "toggle" : "only");
    }
    return;
  }
  if (drag.kind === "width" || points === null) {
    refreshMeasurements();
    return;
  }
  const loose = exact || (drag.kind === "point" && app.measurements[drag.index].kind === "profile");
  points[drag.point] = (loose ? null : snapTarget(x, y)) ?? [x, y];
  refreshContours();
  refreshMeasurements();
  render();
}

/** Give up the drag in progress: what it moved goes back where it was. */
function cancelDrag() {
  if (app.drag === null) {
    return;
  }
  app.drag = null;
  const before = app.history.pop();
  if (before !== undefined) {
    restore(before);
  }
}

/**
 * Whether a click, or the release of what is dragged, would snap now: not with no tool, nor for
 * a profile's ends or its band width.
 * @returns {boolean}
 */
function snapsNow() {
  const d = app.drag;
  if (d === null) {
    return app.tool !== "profile" && app.tool !== "pan";
  }
  return d.kind === "vertex" || (d.kind === "point" && app.measurements[d.index].kind !== "profile");
}

/**
 * The points that a drag moves.
 * @returns {Point[]|null}
 */
function draggedPoints() {
  const d = app.drag;
  if (d === null || d.kind === "width") {
    return null;
  }
  return d.kind === "vertex" ? app.contours[d.index].points : app.measurements[d.index].points;
}

// ------------------------------------------------------------------------- touch
//
// Touch pointers, from a touch screen, are kept apart from the mouse and the pen, which share the
// handlers further down.  One finger: with no tool it pans; with a tool, a tap acts as a click, a
// drag that starts on a point moves it, and any other drag pans.  Two fingers pinch: they zoom and
// pan together (G16), and a second finger landing ends what the first had begun, a moved point
// going back where it was.  More fingers are ignored.

/** The touch pointers on the view, by id: where they are (canvas CSS pixels). @type {Map<number, Point>} */
const touches = new Map();

/** (G16) at the start of a pinch: the zoom, the pan, the fingers' midpoint and distance. */
function startPinch() {
  const [[a, pa], [b, pb]] = [...touches];
  app.gesture = {
    kind: "pinch", ids: [a, b], d0: Math.max(Math.hypot(pb[0] - pa[0], pb[1] - pa[1]), 1),
    c0: [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2], s0: app.view.s, t0: [app.view.tx, app.view.ty],
  };
}

/**
 * (G16) for two fingers: the zoom follows their distance, and the canvas point that was under
 * their midpoint at the start stays under the midpoint now.
 */
function pinchMoved() {
  const g = app.gesture;
  if (g === null || g.kind !== "pinch") {
    return;
  }
  const pa = touches.get(g.ids[0]);
  const pb = touches.get(g.ids[1]);
  if (pa === undefined || pb === undefined) {
    return;
  }
  const d = Math.max(Math.hypot(pb[0] - pa[0], pb[1] - pa[1]), 1);
  const s = Math.min(200, Math.max(0.01, (g.s0 * d) / g.d0));
  const f = s / g.s0;
  app.view.s = s;
  app.view.tx = (pa[0] + pb[0]) / 2 - f * (g.c0[0] - g.t0[0]);
  app.view.ty = (pa[1] + pb[1]) / 2 - f * (g.c0[1] - g.t0[1]);
  render();
}

/** @param {PointerEvent} e */
function touchDown(e) {
  const p = eventPoint(e);
  touches.set(e.pointerId, p);
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch {
    // a scripted pointer cannot be captured
  }
  if (touches.size === 1) {
    const edits = app.tool !== "pan" || app.originMode;
    if (edits && !app.originMode && startDragAt(p[0], p[1])) {
      app.gesture = { kind: "drag", id: e.pointerId };
    } else {
      app.gesture = edits ? { kind: "tap", id: e.pointerId, start: p } : { kind: "pan", id: e.pointerId, last: p };
    }
  } else if (touches.size === 2) {
    cancelDrag();                    // a second finger: what the first began gives way to a pinch
    app.preview = null;
    startPinch();
  }
}

/** @param {PointerEvent} e */
function touchMove(e) {
  if (!touches.has(e.pointerId)) {
    return;
  }
  const p = eventPoint(e);
  touches.set(e.pointerId, p);
  let g = app.gesture;
  if (g !== null && g.kind === "pinch") {
    pinchMoved();
    return;
  }
  if (g === null || g.id !== e.pointerId) {
    return;
  }
  if (g.kind === "tap" && Math.hypot(p[0] - g.start[0], p[1] - g.start[1]) > TAP_PX) {
    g = { kind: "pan", id: g.id, last: g.start };    // moved too far for a tap: it pans
    app.gesture = g;
  }
  if (g.kind === "pan") {
    app.view.tx += p[0] - g.last[0];
    app.view.ty += p[1] - g.last[1];
    g.last = p;
    render();
  } else if (g.kind === "drag") {
    const [x, y] = screenToStored(p[0], p[1]);
    dragTo(x, y);
    app.preview = insideImage(x, y) && snapsNow() ? snapTarget(x, y) : null;
    showCursor(x, y);
    render();
  }
}

/**
 * A finger lifted (``cancelled``: taken away by the system).  A tap acts, a drag ends (or, when
 * cancelled, is undone); when a pinch loses a finger, a finger left keeps panning.
 * @param {PointerEvent} e
 * @param {boolean} cancelled
 */
function touchUp(e, cancelled) {
  if (!touches.delete(e.pointerId)) {
    return;
  }
  const g = app.gesture;
  if (g !== null && g.kind === "pinch") {
    if (g.ids.includes(e.pointerId)) {
      if (touches.size >= 2) {
        startPinch();
      } else {
        const rest = [...touches][0];
        app.gesture = rest === undefined ? null : { kind: "pan", id: rest[0], last: rest[1] };
      }
    }
    return;
  }
  if (g === null || g.id !== e.pointerId) {
    return;
  }
  app.gesture = null;
  app.preview = null;
  if (g.kind === "drag") {
    if (cancelled) {
      cancelDrag();
    } else {
      const [sx, sy] = eventPoint(e);
      const [x, y] = screenToStored(sx, sy);
      endDrag(x, y, false, false);
    }
  } else if (g.kind === "tap" && !cancelled) {
    if (app.originMode) {
      setOriginAt(g.start[0], g.start[1]);
    } else {
      clickAt(g.start[0], g.start[1], false, false);
    }
  }
  render();
}

// ------------------------------------------------------------------------- mouse and pen

canvas.addEventListener("pointerdown", (e) => {
  if (app.image === null) {
    return;
  }
  if (e.pointerType === "touch") {
    touchDown(e);
    return;
  }
  const [sx, sy] = eventPoint(e);
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch {
    // a pointer the browser does not track (e.g. a scripted event) cannot be captured
  }
  if (e.button === 0 && app.originMode) {
    setOriginAt(sx, sy);
    return;
  }
  if (e.button === 1 || (e.button === 0 && (app.space || app.tool === "pan"))) {
    app.pan = { x: sx, y: sy };
    canvas.classList.add("panning");
    e.preventDefault();
    return;
  }
  if (e.button === 2) {
    rightClick(sx, sy);
    return;
  }
  if (e.button === 0 && !startDragAt(sx, sy)) {
    clickAt(sx, sy, e.altKey, e.ctrlKey || e.metaKey);
  }
});

canvas.addEventListener("pointermove", (e) => {
  if (e.pointerType === "touch") {
    touchMove(e);
    return;
  }
  const [sx, sy] = eventPoint(e);
  if (app.pan !== null) {
    app.view.tx += sx - app.pan.x;
    app.view.ty += sy - app.pan.y;
    app.pan = { x: sx, y: sy };
    render();
    return;
  }
  if (app.image === null) {
    return;
  }
  const [x, y] = screenToStored(sx, sy);
  app.cursor = [x, y];
  app.cursorScreen = [sx, sy];
  trackModifiers(e);
  dragTo(x, y);
  app.preview = insideImage(x, y) && !e.altKey && snapsNow() ? snapTarget(x, y) : null;
  showCursor(x, y);
  render();
});

canvas.addEventListener("pointerup", (e) => {
  if (e.pointerType === "touch") {
    touchUp(e, false);
    return;
  }
  if (app.pan !== null) {
    app.pan = null;
    canvas.classList.remove("panning");
    return;
  }
  const [sx, sy] = eventPoint(e);
  const [x, y] = screenToStored(sx, sy);
  endDrag(x, y, e.altKey, e.shiftKey);
});

canvas.addEventListener("pointercancel", (e) => {
  if (e.pointerType === "touch") {
    touchUp(e, true);
    return;
  }
  app.pan = null;
  canvas.classList.remove("panning");
  cancelDrag();
  render();
});

canvas.addEventListener("pointerleave", () => {
  app.preview = null;
  app.cursor = null;
  app.cursorScreen = null;
  render();
});

canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  const [sx, sy] = eventPoint(e);
  // pixels; Firefox reports lines (deltaMode 1) for some mice, and pages are possible (2)
  const dy = e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 800 : 1);
  zoomAt(Math.pow(1.25, -Math.sign(dy) * Math.min(3, Math.abs(dy) / 100 || 1)), sx, sy);
}, { passive: false });

canvas.addEventListener("contextmenu", (e) => e.preventDefault());

window.addEventListener("resize", () => {
  render();
  drawHistogram();
});

/**
 * Zoom about the centre of the view.
 * @param {number} factor
 */
function zoomCentre(factor) {
  const rect = canvas.getBoundingClientRect();
  zoomAt(factor, rect.width / 2, rect.height / 2);
}

/** @param {string} id */
function toggleCheckbox(id) {
  inputEl(id).checked = !inputEl(id).checked;
}

/**
 * Backspace: the last point being placed; else the vertices picked in the vertex window; else the
 * last vertex (contour tool) or the selected measurement.
 */
function backspace() {
  if (app.pending !== null) {
    app.pending.points.pop();
    if (app.pending.points.length === 0) {
      app.pending = null;
    }
    render();
  } else if (app.picked.length) {
    dropPicked();
  } else if (app.tool === "contour") {
    deleteLastVertex();
  } else {
    deleteMeasurement(app.selected);
  }
}

/** Plain keys and what they do (letters in lower case). @type {Record<string, () => void>} */
const KEY_ACTIONS = {
  0: () => setTool("pan"),
  1: () => setTool("contour"),
  2: () => setTool("ruler"),
  3: () => setTool("angle"),
  4: () => setTool("line-angle"),
  5: () => setTool("profile"),
  p: () => toggleProfileWindow(),
  n: () => newContour(),
  c: () => setClosed(!activeContour().closed),
  h: () => levelSelected("horizontal"),
  v: () => levelSelected("vertical"),
  s: () => {
    toggleCheckbox("snap");
    snapToggled();
  },
  g: () => {
    toggleCheckbox("show-edges");
    refreshEdges();
  },
  f: () => fit(),
  "+": () => zoomCentre(1.25),
  "=": () => zoomCentre(1.25),
  "-": () => zoomCentre(0.8),
  t: () => toggleVertexWindow(),
  Backspace: () => backspace(),
  Delete: () => {
    if (app.picked.length) {
      dropPicked();
    } else {
      deleteMeasurement(app.selected);
    }
  },
  Escape: () => {
    app.pending = null;
    app.originMode = false;
    clearPicked();
    refreshFrameNotes();
    refreshVertexWindow();
    render();
  },
};

/**
 * Ctrl (or Cmd) shortcuts.  Returns whether the key was one of them.
 * @param {KeyboardEvent} e
 * @param {boolean} typing   the focus is in a text field
 * @returns {boolean}
 */
function ctrlShortcut(e, typing) {
  if (!(e.ctrlKey || e.metaKey)) {
    return false;
  }
  const key = e.key.toLowerCase();
  /** @type {Record<string, () => void>} */
  const always = { s: () => saveSession(), o: () => inputEl("image-file").click() };
  /** @type {Record<string, () => void>} */
  const outsideFields = { z: () => (e.shiftKey ? redo() : undo()), y: () => redo() };
  const action = always[key] ?? (typing ? undefined : outsideFields[key]);
  if (action === undefined) {
    return true;                 // other Ctrl combinations are left to the browser
  }
  e.preventDefault();
  action();
  return true;
}

window.addEventListener("keydown", (e) => {
  trackModifiers(e);
  const target = e.target;
  const typing = (target instanceof HTMLInputElement && target.type !== "checkbox") || target instanceof HTMLSelectElement;
  if (ctrlShortcut(e, typing) || typing || e.altKey) {
    return;
  }
  if (e.key === " ") {
    app.space = true;
    e.preventDefault();
    return;
  }
  if (arrowKey(e)) {
    return;
  }
  const action = KEY_ACTIONS[e.key.length === 1 ? e.key.toLowerCase() : e.key];
  if (action !== undefined) {
    e.preventDefault();
    action();
  }
});

window.addEventListener("keyup", (e) => {
  trackModifiers(e);
  if (e.key === " ") {
    app.space = false;
  }
});

window.addEventListener("blur", () => {            // a key released elsewhere is never seen
  app.insertHeld = false;
  app.altHeld = false;
  app.space = false;
  render();
});

window.addEventListener("beforeunload", (e) => {
  if (app.dirty && hasWork()) {
    e.preventDefault();
  }
});

function snapToggled() {
  if (!settings.snap()) {
    app.preview = null;
  }
  refreshEdges();
}

const wrap = el("view-wrap");
wrap.addEventListener("dragover", (e) => {
  e.preventDefault();
  wrap.classList.add("dragover");
});
wrap.addEventListener("dragleave", () => wrap.classList.remove("dragover"));
wrap.addEventListener("drop", (e) => {
  e.preventDefault();
  wrap.classList.remove("dragover");
  const file = e.dataTransfer && e.dataTransfer.files[0];
  if (file) {
    openFile(file);
  }
});

el("open-image").addEventListener("click", () => inputEl("image-file").click());
el("open-session").addEventListener("click", () => inputEl("session-file").click());
el("save-session").addEventListener("click", () => saveSession());
el("export-polygons").addEventListener("click", () => exportPolygons());
el("export-measurements").addEventListener("click", () => exportMeasurements());
for (const id of ["image-file", "session-file"]) {
  inputEl(id).addEventListener("change", () => {
    const input = inputEl(id);
    const file = input.files && input.files[0];
    if (file) {
      openFile(file);
    }
    input.value = "";
  });
}
for (const tool of TOOLS) {
  // a click on the active tool puts it down: no tool
  el(`tool-${tool}`).addEventListener("click", () => setTool(app.tool === tool ? "pan" : tool));
}
selectEl("contour-list").addEventListener("change", () => {
  setActive(selectEl("contour-list").selectedIndex);
  refreshContours();
  render();
});
el("new-contour").addEventListener("click", () => newContour());
el("rename-contour").addEventListener("click", () => renameContour());
el("delete-contour").addEventListener("click", () => deleteContour());
inputEl("closed").addEventListener("change", () => setClosed(inputEl("closed").checked));
selectEl("measurement-list").addEventListener("change", () => {
  app.selected = selectEl("measurement-list").selectedIndex;
  refreshMeasurements();
  render();
});
for (const id of ["contour-layer", "contour-datatype"]) {
  el(id).addEventListener("change", () => layerInputsChanged());
}
for (const id of ["black-level", "white-level"]) {
  el(id).addEventListener("change", () => setLevels(Number(inputEl("black-level").value), Number(inputEl("white-level").value)));
}
el("brightness").addEventListener("input", () => brightnessMoved(Number(inputEl("brightness").value) / 1000));
el("contrast").addEventListener("input", () => contrastMoved(Number(inputEl("contrast").value) / 1000));
el("levels-auto").addEventListener("click", () => setLevels(app.autoLevels[0], app.autoLevels[1]));
el("levels-full").addEventListener("click", () => {
  if (app.hist !== null) {
    setLevels(app.hist.span[0], app.hist.span[1]);
  }
});
el("histogram-log").addEventListener("change", () => drawHistogram());
histCanvas.addEventListener("pointerdown", (e) => {
  if (app.hist === null) {
    return;
  }
  const v = histogramValue(e);
  app.levelDrag = Math.abs(v - app.lo) <= Math.abs(v - app.hi) ? "black" : "white";
  try {
    histCanvas.setPointerCapture(e.pointerId);
  } catch {
    // a scripted pointer cannot be captured
  }
  dragLevel(v);
});
histCanvas.addEventListener("pointermove", (e) => {
  if (app.levelDrag !== null) {
    dragLevel(histogramValue(e));
  }
});
histCanvas.addEventListener("pointerup", () => {
  app.levelDrag = null;
});
el("export-gds").addEventListener("click", () => openGdsDialog());
el("gds-dialog").addEventListener("close", () => {
  if (/** @type {HTMLDialogElement} */ (el("gds-dialog")).returnValue === "export") {
    exportGds();
  }
});
el("open-vertices").addEventListener("click", () => toggleVertexWindow());
el("vertex-close").addEventListener("click", () => toggleVertexWindow());
el("vertex-up").addEventListener("click", () => movePicked(-1));
el("vertex-down").addEventListener("click", () => movePicked(1));
el("vertex-drop").addEventListener("click", () => dropPicked());
el("vertex-first").addEventListener("click", () => makePickedFirst());
el("vertex-reverse").addEventListener("click", () => reversePicked());
el("vertex-zoom").addEventListener("click", () => zoomToPicked());
el("vertex-rows").addEventListener("click", (e) => {
  const row = e.target instanceof Element ? e.target.closest("tr") : null;
  if (row instanceof HTMLTableRowElement && row.dataset.i !== undefined) {
    pickVertex(Number(row.dataset.i), e.shiftKey ? "range" : e.ctrlKey || e.metaKey ? "toggle" : "only");
  }
});
el("vertex-rows").addEventListener("dblclick", (e) => {
  const cell = e.target instanceof Element ? e.target.closest("td") : null;
  if (cell instanceof HTMLTableCellElement && cell.dataset.axis !== undefined) {
    editCoordinate(cell);
  }
});
/**
 * Let a floating window be moved by its title bar, within the view.
 * @param {HTMLElement} win
 * @param {HTMLElement} bar
 */
function movableWindow(win, bar) {
  /** @type {{dx: number, dy: number}|null} */
  let drag = null;
  bar.addEventListener("pointerdown", (e) => {
    if (e.target instanceof HTMLButtonElement || e.target instanceof HTMLInputElement) {
      return;
    }
    const box = win.getBoundingClientRect();
    drag = { dx: e.clientX - box.left, dy: e.clientY - box.top };
    try {
      bar.setPointerCapture(e.pointerId);
    } catch {
      // a scripted pointer cannot be captured
    }
  });
  bar.addEventListener("pointermove", (e) => {
    if (drag === null) {
      return;
    }
    const area = wrap.getBoundingClientRect();
    const box = win.getBoundingClientRect();
    const left = Math.min(Math.max(e.clientX - area.left - drag.dx, 0), Math.max(area.width - box.width, 0));
    const top = Math.min(Math.max(e.clientY - area.top - drag.dy, 0), Math.max(area.height - box.height, 0));
    win.style.left = `${left}px`;
    win.style.top = `${top}px`;
    win.style.right = "auto";
    win.style.bottom = "auto";
  });
  bar.addEventListener("pointerup", () => {
    drag = null;
  });
}
movableWindow(el("vertex-window"), el("vertex-bar"));
movableWindow(el("profile-window"), el("profile-bar"));
el("profile-close").addEventListener("click", () => toggleProfileWindow());
el("profile-export").addEventListener("click", () => exportProfile());
inputEl("profile-width").addEventListener("change", () => setProfileWidth(Number(inputEl("profile-width").value) / unitsPerView()));
profileCanvas.addEventListener("pointermove", (e) => profilePlotPointer(e));
profileCanvas.addEventListener("pointerleave", () => {
  app.profileCursor = null;
  showProfileReadout();
  drawProfilePlot();
  render();
});
new ResizeObserver(() => drawProfilePlot()).observe(profileCanvas);
el("rename-measurement").addEventListener("click", () => renameMeasurement());
el("delete-measurement").addEventListener("click", () => deleteMeasurement(app.selected));
el("level-horizontal").addEventListener("click", () => levelSelected("horizontal"));
el("level-vertical").addEventListener("click", () => levelSelected("vertical"));
el("axis-from-ruler").addEventListener("click", () => axisFromSelected());
inputEl("snap").addEventListener("change", () => snapToggled());
inputEl("show-edges").addEventListener("change", () => refreshEdges());
for (const id of ["sigma", "median"]) {
  el(id).addEventListener("change", () => refreshEdges());
}
for (const id of ["pixel-x", "pixel-y", "tilt", "correction", "custom-factor", "tilt-axis", "rotation"]) {
  el(id).addEventListener("change", () => frameInputsChanged());
}
el("reset-rotation").addEventListener("click", () => {
  if (app.frame.rotationDeg !== 0) {
    pushHistory();
    changeFrame(() => {
      app.frame.rotationDeg = 0;
    });
  }
});
el("set-origin").addEventListener("click", () => {
  app.originMode = !app.originMode;
  refreshFrameNotes();
});
el("reset-origin").addEventListener("click", () => {
  if (app.frame.originPx[0] !== 0 || app.frame.originPx[1] !== 0) {
    pushHistory();
    app.frame.originPx = [0, 0];
    refreshFrameNotes();
    refreshContours();
    refreshMeasurements();
    render();
  }
});

refreshFrameInputs();
refreshContours();
refreshMeasurements();
refreshDisplay();
setTool("pan");                     // the app opens with no tool: the view pans and zooms

/** The page's state and actions, for scripts that drive it (tests, automation). */
Object.assign(window, {
  semMeasurementTool: {
    state: app, openImageBuffer, loadPolygonText, loadSessionText, polygonText, measurementText, sessionText,
    addVertex, newContour, undo, redo, fit, frameInputsChanged, refreshEdges, storedToScreen, screenToStored,
    snapTarget, setTool, placePoint, levelSelected, axisFromSelected, draw, insertTarget, pickVertex, movePicked,
    dropPicked, makePickedFirst, reversePicked, setVertexCoordinate, zoomToPicked, toggleVertexWindow, gdsElements,
    gdsFile, setLevels, brightnessMoved, contrastMoved, drawHistogram, paintPicture, toggleProfileWindow,
    refreshProfileWindow, shownProfile, profileData, profileMean, setProfileWidth, exportProfile, profilePlot,
  },
});
