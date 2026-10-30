"use strict";
/* global decodeSEMImage, emptyCalibration, describeCalibration, EdgeMap, correctionFactor,
   matApply, matInverse, matDet, viewMatrix, toMeasurement, fromMeasurement, normalizeDegrees, measureContour,
   measureRuler, measureAngle, measureLineAngle, measureGap, levelRotation, axisFromLine, lineIntersection,
   measurementMatrix,
   viewStepToStored, formatPolygonFile, parsePolygonFile, frameFromMeta, formatMeasurementFile, MEASURE_POINTS,
   formatSession, parseSession, formatGds, gdsName, moveSelected, dropSelected, makeFirst, reverseContour,
   selectionRange, valueRange, fixedSpan, fullScale, histogramOf, autoLevels, greyMap, sliderBrightness, sliderContrast,
   centreOfBrightness, widthOfContrast, profileGeometry, sampleProfile, profileCrossings, widthHandle,
   widthFromPoint, formatProfileFile, edgeNormal, segmentNormal, squaredProfile, markerPlace, profileValueAt, snapToSlope,
   metadataVendor, withMetadataText, fileStem */
/*
 * The SEM measurement tool: open an image, take measurements (contours, rulers, angles, profiles) with
 * optional snapping to edges, correct a tilted specimen, turn the image, and keep the work in a
 * session file, with downloads for a mode solver, a layout tool (GDSII), a spreadsheet and a report
 * (FORMAT.md).  One list holds the measurements: a click selects one, its box adds it to a selection
 * of several, and the downloads follow the selection.  A floating window lists the vertices of the
 * selected contour in the measurement frame and edits them.  Everything runs in the page; files are
 * read with the File API and saved as downloads.
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

/**
 * Colour orders of the overlay: each new measurement takes the next colour, which it keeps (its
 * ``color``).  Lines are drawn outlined in a contrasting grey, so that every colour shows on dark and
 * on bright parts of an image alike.
 * @type {Record<string, string[]>}
 */
const PALETTES = {
  matlab: ["#0072BD", "#D95319", "#EDB120", "#7E2F8E", "#77AC30", "#4DBEEE", "#A2142F"],      // MATLAB's default colour order
  "okabe-ito": ["#E69F00", "#56B4E9", "#009E73", "#F0E442", "#0072B2", "#D55E00", "#CC79A7"],   // colour-blind safe
};
const COLOURS_KEY = "sem-measurement-tool colours";       // where the browser keeps the choice (localStorage)
const STATUS_KEY = "sem-measurement-tool status bar";     // "on" when the status bar is shown (localStorage)
/** The colours chosen: a palette, or "custom" with its own order. */
const colours = { palette: "matlab", custom: [...PALETTES.matlab] };
const PREVIEW_COLOR = "#ff3ec8";     // magenta: where a click lands (with Snap on, or inserting)
const PICKED_COLOR = "#9b7bff";      // violet: vertices selected in the vertex window
const ORIGIN_COLOR = "#4cff4c";
const EDGE_RGB = [0, 255, 170];      // edge-strength overlay
const HIT_PX = 8;                    // screen pixels within which a point is under the cursor
const ARC_PX = 22;                   // radius of the angle arcs
const HISTORY = 500;
const LABEL_FONT = "12px Bahnschrift, Arial, 'Helvetica Neue', Helvetica, system-ui, sans-serif";   // as the page's
const FILE_FONT = "12px ui-monospace, Consolas, monospace";      // file names, as on the page (.file)
const LABEL_HEIGHT = 18;             // of the dark chip a label sits on, CSS pixels

/** "pan" is no tool: the mouse, one finger or two only move and zoom the view. @typedef {"pan"|MeasureKind} Tool */
/** @type {Tool[]} */
const TOOLS = ["pan", "contour", "ruler", "angle", "line-angle", "profile", "gap"];
/** @type {Record<Tool, string>} */
const TOOL_HINTS = {
  pan: "No tool: drag to pan, wheel to zoom; on a touch screen one finger pans and two pinch.  Choose a tool (1-6) " +
    "to trace or measure; click it again, or press 0, to come back here.",
  contour: "Click: add a vertex to the selected contour; with no contour selected, the first click starts a new one " +
    "(N: done with this one).  Ctrl+click inserts (hold Ctrl to see where), drag moves, right click deletes; click a " +
    "vertex to select it in the vertex window (T).",
  ruler: "Click both ends of a distance.  Drag an end to move it; right click deletes the ruler.",
  angle: "Click the end of one arm, the vertex, then the end of the other arm.",
  "line-angle": "Click two points on one line, then two on the other: the angle between the lines.",
  gap: "Click two points on one edge, then two on the other: the gap between the lines, along their common normal " +
    "midway between their middles.",
  profile: "Click both ends of a line profile (never snapped); it turns square to the edge it crosses, by up to 15°, " +
    "while that option is on (Alt+click: as drawn; Ctrl+Z right after: back as drawn).  Drag the square on the band's " +
    "side to widen it, an end to move it: it turns square again about the other end (Alt: as dragged); E squares it " +
    "whatever the turn, P shows the profile window.",
};
/** @type {Record<MeasureKind, string>} */
const MEASURE_NAMES = {
  contour: "contour", ruler: "ruler", angle: "angle", "line-angle": "line angle", gap: "gap", profile: "profile",
};
const PLOT_COLOR = "#385c9e";        // the profile's mean in its window
const MARKER_COLOR = "#272727";      // the markers A and B on the profile plot
const TAP_PX = 10;                   // a touch that moves less than this is a tap
const TOUCH_HIT_PX = 22;             // HIT_PX for a finger, which covers far more than a cursor tip
const TOUCH_SNAP = 2.5;              // a finger searches this many times the snap radius for an edge
const HOLD_MS = 500;                 // a finger held still this long on a point opens its menu
const DOUBLE_MS = 500;               // two clicks or taps on one list row within this time are a double click
const FLASH_MS = 1600;               // how long the note beside the cursor stays after a profile is squared
const MIN_COHERENCE = 0.5;           // (P9) below it, an image edge has no single direction to square a profile to
const MAX_TURN_DEG = 15;             // (P11) a new or moved profile turns by itself up to this far; E: whatever the turn

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
  /** @type {Measurement[]} contours, rulers, angles and profiles, in the order of the list */
  measurements: [],
  selected: -1,                      // the measurement edited, -1 for none; the contour tool extends it when it is a contour
  /** @type {number[]} the measurements selected in the list, ascending; ``selected`` is one of them (when any) */
  checked: [],
  listAnchor: -1,                    // the row a Shift+click in the list selects from
  /** @type {{kind: FixedKind, points: Point[]}|null} a measurement being placed */
  pending: null,
  /** @type {Tool} */
  tool: "pan",
  /**
   * A touch gesture on the view: a finger that may still be a tap, one that pans or drags a point,
   * one held for a menu (its lift does nothing), or two that pinch (G16).
   * @type {{kind: "tap", id: number, start: Point}|{kind: "pan", id: number, last: Point}|{kind: "drag", id: number}
   *   |{kind: "held", id: number}|{kind: "pinch", ids: [number, number], d0: number, c0: Point, s0: number, t0: Point}
   *   |null}
   */
  gesture: null,
  /** @type {"mouse"|"pen"|"touch"} what last pressed on the view: it sets how near a point must be to be hit */
  lastPointer: "mouse",
  /** @type {{id: number, start: Point, t0: number, timer: number}|null} a finger that may become a press and hold */
  hold: null,
  exactOnce: false,                  // the next point placed or released lands exactly, without snapping
  /** @type {{text: string, at: Point, until: number, done: boolean}|null} a note beside the cursor, for a moment */
  flash: null,
  message: "",                       // the status bar's last message (not the cursor's readout)
  /** @type {Frame} */
  frame: defaultFrame(),
  view: { s: 1, tx: 0, ty: 0 },
  /** @type {string[]} */
  history: [],
  /** @type {string[]} */
  future: [],
  dirty: false,
  /**
   * @type {{kind: "point"|"width", index: number, point: number, moved: boolean, before: string}|null} a measurement's
   *   point or a profile's band width; ``before``, the state before it, is recorded for undo at its first move
   */
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
  /** @type {number[]} vertices of the selected contour picked in the vertex window, ascending */
  picked: [],
  pickAnchor: -1,
  raf: 0,
  /**
   * @type {{deg0: number, before: string, rect: DOMRect}|null} a rotation in progress, by the slider or a step
   *   button held: the rotation and the state before it, recorded for undo when it ends, and the view's size
   */
  rotating: null,
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
  squareProfiles: () => inputEl("square-profiles").checked,
  snapMarkers: () => inputEl("snap-markers").checked,
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
  app.message = text;
  el("status").textContent = text;
  if (!statusBarShown()) {
    showToast(text);
  }
}

/** @returns {boolean} whether the status bar is shown under the view */
function statusBarShown() {
  return inputEl("show-status").checked;
}

/**
 * Show or hide the status bar under the view; the browser keeps the choice.  Hidden, the view takes
 * its row, the cursor's readout is not kept up, and messages show for a moment over the view.
 * @param {boolean} on
 * @param {boolean} [keep]   false: only apply it (at start)
 */
function showStatusBar(on, keep = true) {
  inputEl("show-status").checked = on;
  el("app").classList.toggle("no-status", !on);
  if (on) {
    el("status").textContent = app.message || el("status").textContent;
    el("toast").classList.remove("shown");
  }
  if (keep) {
    try {
      localStorage.setItem(STATUS_KEY, on ? "on" : "off");
    } catch {
      // storage refused (a private window, say): the choice lasts as long as the page
    }
  }
  keepWindowsInView();
  render();
  drawHistogram();
}

/** @type {number} the timer that hides the message over the view */
let toastTimer = 0;

/**
 * A message of the status bar over the view, for a few seconds, longer for a longer one.
 * @param {string} text
 */
function showToast(text) {
  const toast = el("toast");
  toast.textContent = text;
  toast.classList.toggle("shown", text !== "");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("shown"), Math.min(10000, 3000 + 40 * text.length));
}

/** @param {string|TextParts} text  "" hides it */
function setBusy(text) {
  const b = el("busy");
  fillParts(b, typeof text === "string" ? [text] : text);
  b.style.display = b.textContent ? "block" : "none";
}

/**
 * Text in which file names stand apart: each {file} is shown in the monospace font, as file names
 * always are.
 * @typedef {Array<string|{file: string}>} TextParts
 */

/**
 * Fill an element with text parts, each file name in a span of class "file".
 * @param {HTMLElement} element
 * @param {TextParts} parts
 */
function fillParts(element, parts) {
  element.replaceChildren(...parts.map((part) => {
    if (typeof part === "string") {
      return document.createTextNode(part);
    }
    const span = document.createElement("span");
    span.className = "file";
    span.textContent = part.file;
    return span;
  }));
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
 * Open an image from the bytes of a file, with the text of its metadata file when one was opened
 * with it (used in place of the image file's own).  Returns false (with a message) when it cannot
 * be read.
 * @param {string} name
 * @param {ArrayBuffer} buffer
 * @param {{name: string, text: string}|null} [metadata]
 * @returns {Promise<boolean>}
 */
async function openImageBuffer(name, buffer, metadata = null) {
  setBusy(["Reading ", { file: name }, " ..."]);
  await nextPaint();
  /** @type {SEMImage} */
  let image;
  try {
    const head = new Uint8Array(buffer, 0, Math.min(4, buffer.byteLength));
    const tiff = (head[0] === 0x49 && head[1] === 0x49) || (head[0] === 0x4d && head[1] === 0x4d);
    image = tiff ? decodeSEMImage(buffer, name) : await decodeBrowserImage(buffer, name);
    if (metadata !== null) {
      image = withMetadataText(image, metadata.text, metadata.name) ?? image;
    }
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
  app.measurements = [];
  selectOnly(-1);
  clearPicked();
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
  refreshMeasurements();
  refreshDisplay();
  fit();
  setBusy("");
  const from = cal.metadataFile === null ? "" : ` with the metadata of ${cal.metadataFile}`;
  const notes = cal.notes.length ? `; check: ${cal.notes.join("; ")}` : "";
  setStatus(`Opened ${name}${from}: ${image.width} x ${image.height} pixels${notes}`);
  await refreshEdges();
  return true;
}

/** Compute the edge map when Snap, the squaring of profiles or the edge map needs it and it is missing or outdated. */
async function refreshEdges() {
  const image = app.image;
  if (image === null || app.edgesBusy || !(settings.snap() || settings.squareProfiles() || settings.edgesShown())) {
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
  const reach = settings.radius() * (app.lastPointer === "touch" ? TOUCH_SNAP : 1);
  return app.edges.snap(x, y, reach, settings.minContrast(), viewMatrix(app.frame));
}

/** @returns {number} screen pixels within which a point is under the pointer: more for a finger */
function hitPx() {
  return app.lastPointer === "touch" ? TOUCH_HIT_PX : HIT_PX;
}

/** @returns {number} how much larger points and handles are drawn after touch input */
function handleScale() {
  return app.lastPointer === "touch" ? 1.6 : 1;
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
  refreshMeasurements();
  render();
}

function render() {
  if (app.raf === 0) {
    app.raf = requestAnimationFrame(draw);
  }
  refreshTouchBar();
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
  // mipmapped when zoomed out: the pixels' noise neither aliases nor shimmers as the view turns
  ctx.imageSmoothingQuality = "high";
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
  const checked = new Set(app.checked);
  app.measurements.forEach((ms, i) => {            // the contours first, under the other measurements
    if (ms.kind === "contour") {
      drawContour(ms, colorOf(ms), { selected: checked.has(i), edited: i === app.selected }, toScreen);
    }
  });
  drawPicked(toScreen);
  app.measurements.forEach((ms, i) => {
    if (ms.kind !== "contour") {
      drawMeasurement(ms, colorOf(ms), toScreen, { selected: checked.has(i), handle: i === app.selected });
    }
  });
  drawProfileCursor(toScreen);
  drawPending(toScreen);
  drawInsertPreview(toScreen);
  drawMarks(toScreen);
  drawHoldRing();
  drawFlash();
}

/**
 * Rings around the vertices picked in the vertex window, with their numbers.
 * @param {(p: Point) => Point} toScreen
 */
function drawPicked(toScreen) {
  const c = currentContour();
  if (c === null) {
    return;
  }
  const points = c.points;
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
 * Where a click inserts a vertex now: the edge a-b of the selected contour that receives it and the
 * point p it lands on, exactly as addVertex places it (snapped unless Alt is down); null when a
 * click would not insert (Ctrl up, another tool, a vertex under the cursor, fewer than 2 vertices).
 * @returns {{a: Point, b: Point, p: Point}|null}
 */
function insertTarget() {
  const c = currentContour();
  if (c === null) {
    return null;
  }
  const n = c.points.length;
  const cursor = app.cursor;
  const screen = app.cursorScreen;
  if (app.tool !== "contour" || !app.insertHeld || cursor === null || screen === null || n < 2 || app.drag !== null
      || app.pan !== null || app.originMode || !insideImage(cursor[0], cursor[1])) {
    return null;
  }
  if (hitPoint(screen[0], screen[1], true) !== null) {
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
 * Note Ctrl (or Cmd) and Alt from any event, and redraw when the insert or the snap preview may change.
 * @param {KeyboardEvent|PointerEvent} e
 */
function trackModifiers(e) {
  const insert = e.ctrlKey || e.metaKey;
  if (insert !== app.insertHeld || e.altKey !== app.altHeld) {
    app.insertHeld = insert;
    app.altHeld = e.altKey;
    const c = app.cursor;
    if (c !== null && app.lastPointer !== "touch") {   // the snap preview follows Alt at once, not at the next move
      app.preview = insideImage(c[0], c[1]) && !app.altHeld && snapsNow() ? snapTarget(c[0], c[1]) : null;
    }
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
 * The colour a measurement is drawn in: its colour in the order chosen.
 * @param {Measurement} ms
 * @returns {string}
 */
function colorOf(ms) {
  const order = colours.palette === "custom" ? colours.custom : PALETTES[colours.palette] ?? PALETTES.matlab;
  return order[(ms.color ?? 0) % order.length];
}

/**
 * The colour of a new measurement: the one after the highest of ``list`` in the order.
 * @param {Measurement[]} [list]
 * @returns {number}
 */
function nextColorIndex(list = app.measurements) {
  return list.reduce((next, ms) => Math.max(next, (ms.color ?? -1) + 1), 0);
}

/**
 * The grey that outlines lines of a colour: white around a dark colour, black around a light one,
 * by relative luminance (WCAG), so that the line shows on dark and on bright grey alike.
 * @param {string} color   #rrggbb
 * @returns {string}
 */
function casingOf(color) {
  const [r, g, b] = [1, 3, 5].map((k) => {
    const v = parseInt(color.slice(k, k + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.2 ? "rgba(255, 255, 255, 0.75)" : "rgba(0, 0, 0, 0.85)";
}

/**
 * Stroke a path of the overlay: a light halo under a selected one, the casing of its colour, then
 * the colour.
 * @param {Path2D} path
 * @param {string} color
 * @param {{selected?: boolean, dash?: number[], width?: number}} [how]
 */
function strokeOverlay(path, color, how = {}) {
  const width = how.width ?? (how.selected ? 2.6 : 1.6);
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  if (how.selected) {
    ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
    ctx.lineWidth = width + 8;
    ctx.stroke(path);
  }
  ctx.setLineDash(how.dash ?? []);
  ctx.strokeStyle = casingOf(color);
  ctx.lineWidth = width + 2;         // a pixel of outline on either side
  ctx.stroke(path);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke(path);
  ctx.restore();
}

/**
 * The points of a measurement: filled with its colour and edged in the casing; white, edged in the
 * colour, when it is selected.  ``first`` scales the first point (the start of the contour edited).
 * @param {Point[]} pts      screen
 * @param {string} color
 * @param {boolean} selected
 * @param {number} [first]
 */
function drawPoints(pts, color, selected, first = 1) {
  const k = handleScale();
  ctx.save();
  pts.forEach(([x, y], i) => {
    ctx.beginPath();
    ctx.arc(x, y, (selected ? 4 : 3.5) * k * (i === 0 ? first : 1), 0, 2 * Math.PI);
    ctx.fillStyle = selected ? "#ffffff" : color;
    ctx.fill();
    ctx.lineWidth = selected ? 1.6 : 1.2;
    ctx.strokeStyle = selected ? color : casingOf(color);
    ctx.stroke();
  });
  ctx.restore();
}

/**
 * A label on a dark chip edged in its measurement's colour: white text, legible on any grey.
 * @param {string} text
 * @param {Point} at          the chip's centre
 * @param {string} color
 * @param {boolean} [selected]   a thicker edge
 */
function drawLabel(text, at, color, selected = false) {
  ctx.save();
  ctx.font = LABEL_FONT;
  const w = ctx.measureText(text).width + 10;
  ctx.beginPath();
  ctx.roundRect(at[0] - w / 2, at[1] - LABEL_HEIGHT / 2, w, LABEL_HEIGHT, 4);
  ctx.fillStyle = "rgba(0, 0, 0, 0.72)";
  ctx.fill();
  ctx.lineWidth = selected ? 2.2 : 1.4;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, at[0], at[1] + 0.5);
  ctx.restore();
}

/**
 * @param {Path2D} path
 * @param {Point} a
 * @param {Point} b
 */
function addSegment(path, a, b) {
  path.moveTo(a[0], a[1]);
  path.lineTo(b[0], b[1]);
}

/**
 * Add to ``path`` the arc of radius ARC_PX about ``centre`` from direction ``u`` to direction ``v``
 * (screen), the shorter way round; returns the unit bisector, or null when u or v vanish.
 * @param {Path2D} path
 * @param {Point} centre
 * @param {Point} u
 * @param {Point} v
 * @returns {Point|null}
 */
function addArc(path, centre, u, v) {
  const lu = Math.hypot(u[0], u[1]);
  const lv = Math.hypot(v[0], v[1]);
  if (!(lu > 0 && lv > 0)) {
    return null;
  }
  const a = Math.atan2(u[1], u[0]);
  let sweep = Math.atan2(v[1], v[0]) - a;
  sweep = Math.atan2(Math.sin(sweep), Math.cos(sweep));       // to (-pi, pi]
  path.moveTo(centre[0] + ARC_PX * Math.cos(a), centre[1] + ARC_PX * Math.sin(a));
  path.arc(centre[0], centre[1], ARC_PX, a, a + sweep, sweep < 0);
  const mid = a + sweep / 2;
  return [Math.cos(mid), Math.sin(mid)];
}

/**
 * A contour in its colour: when selected thicker, with a halo and white vertices; the first vertex
 * of the one edited larger.
 * @param {Contour} c
 * @param {string} color
 * @param {{selected: boolean, edited: boolean}} how
 * @param {(p: Point) => Point} toScreen
 */
function drawContour(c, color, how, toScreen) {
  const pts = c.points.map(toScreen);
  if (pts.length >= 2) {
    const path = new Path2D();
    path.moveTo(pts[0][0], pts[0][1]);
    for (const [x, y] of pts.slice(1)) {
      path.lineTo(x, y);
    }
    if (c.closed && pts.length > 2) {
      path.closePath();
    }
    strokeOverlay(path, color, { selected: how.selected });
  }
  drawPoints(pts, color, how.selected, how.edited ? 1.5 : 1);
}

/**
 * The value of a measurement as its label shows it; "?" when the correction is undefined.
 * @param {FixedMeasurement} ms
 * @returns {string}
 */
function measurementLabel(ms) {
  if (ms.kind === "ruler" || ms.kind === "profile") {
    const r = measureRuler(ms.points, app.frame);
    return r === null ? "?" : `${show(r.length)} ${unitText(r.unit)}`;
  }
  if (ms.kind === "gap") {
    const g = measureGap(ms.points, app.frame);
    return g === null ? "?" : `${show(g.gap)} ${unitText(g.unit)}`;
  }
  const angle = ms.kind === "angle" ? measureAngle(ms.points, app.frame)
    : (measureLineAngle(ms.points, app.frame)?.angleDeg ?? null);
  return angle === null ? "?" : `${angle.toFixed(2)}°`;
}

/**
 * A ruler's segment and end ticks, added to ``path``; returns where its label goes, above it.
 * @param {Path2D} path
 * @param {Point[]} pts     screen
 * @returns {Point}
 */
function addRuler(path, pts) {
  const [a, b] = pts;
  addSegment(path, a, b);
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  /** @type {Point} */
  let n = len > 0 ? [(b[1] - a[1]) / len, -(b[0] - a[0]) / len] : [0, -1];
  if (n[1] > 0 || (n[1] === 0 && n[0] < 0)) {
    n = [-n[0], -n[1]];             // the label goes above the ruler
  }
  for (const p of [a, b]) {
    addSegment(path, [p[0] - 5 * n[0], p[1] - 5 * n[1]], [p[0] + 5 * n[0], p[1] + 5 * n[1]]);
  }
  return [(a[0] + b[0]) / 2 + 16 * n[0], (a[1] + b[1]) / 2 + 16 * n[1]];
}

/**
 * Two lines, added to ``solid``, and their extensions to where they cross, added to ``dashed``,
 * with the arc between their directions there.  Returns where the label goes: beyond the arc, or
 * among the points when the lines cross far away or not at all; null when the arc has no bisector.
 * @param {Path2D} solid
 * @param {Path2D} dashed
 * @param {Point[]} pts      screen, 4 points
 * @param {Point|null} crossing   stored
 * @param {(p: Point) => Point} toScreen
 * @returns {Point|null}
 */
function addLineAngle(solid, dashed, pts, crossing, toScreen) {
  addSegment(solid, pts[0], pts[1]);
  addSegment(solid, pts[2], pts[3]);
  const span = Math.max(...pts.map((p) => Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1])), 1);
  const c = crossing === null ? null : toScreen(crossing);
  if (c !== null && Math.hypot(c[0] - pts[0][0], c[1] - pts[0][1]) < 20 * span) {
    for (const [p, q] of [[pts[0], pts[1]], [pts[2], pts[3]]]) {
      addSegment(dashed, Math.hypot(p[0] - c[0], p[1] - c[1]) < Math.hypot(q[0] - c[0], q[1] - c[1]) ? p : q, c);
    }
    const bisector = addArc(solid, c, [pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]], [pts[3][0] - pts[2][0], pts[3][1] - pts[2][1]]);
    return bisector === null ? null : [c[0] + (ARC_PX + 16) * bisector[0], c[1] + (ARC_PX + 16) * bisector[1]];
  }
  return /** @type {Point} */ (pts.reduce((acc, p) => [acc[0] + p[0] / 4, acc[1] + p[1] / 4], [0, 0]));
}

/**
 * The gap between two lines (G17), added to the paths: the lines as clicked (``solid``), the common
 * normal between them with arrow heads, and dashed out from each line's nearer end to where the
 * normal meets it when that is beyond the points.  Returns where the label goes: beside the middle
 * of the normal; null when the gap has no measures (the correction undefined, or a line a point).
 * @param {Path2D} solid
 * @param {Path2D} dashed
 * @param {Point[]} stored    4 points
 * @param {Point[]} pts       the same on screen
 * @param {(p: Point) => Point} toScreen
 * @returns {Point|null}
 */
function addGap(solid, dashed, stored, pts, toScreen) {
  addSegment(solid, pts[0], pts[1]);
  addSegment(solid, pts[2], pts[3]);
  const g = measureGap(stored, app.frame);
  if (g === null) {
    return null;
  }
  const [f1, f2] = g.feet.map(toScreen);
  for (const [foot, a, b] of [[f1, pts[0], pts[1]], [f2, pts[2], pts[3]]]) {
    const along = (b[0] - a[0]) * (foot[0] - a[0]) + (b[1] - a[1]) * (foot[1] - a[1]);
    const length2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;
    if (along < 0 || along > length2) {                 // beyond the points: dashed out to the foot
      addSegment(dashed, along < 0 ? a : b, foot);
    }
  }
  const len = Math.hypot(f2[0] - f1[0], f2[1] - f1[1]);
  if (len < 1) {
    return f1;
  }
  const [ex, ey] = [(f2[0] - f1[0]) / len, (f2[1] - f1[1]) / len];
  addSegment(solid, f1, f2);
  if (len > 14) {                                       // the heads, pointing out to the lines
    /** @type {Array<[Point, number]>} */
    const heads = [[f1, 1], [f2, -1]];
    for (const [tip, sign] of heads) {
      addSegment(solid, tip, [tip[0] + sign * (7 * ex - 4 * ey), tip[1] + sign * (7 * ey + 4 * ex)]);
      addSegment(solid, tip, [tip[0] + sign * (7 * ex + 4 * ey), tip[1] + sign * (7 * ey - 4 * ex)]);
    }
  }
  /** @type {Point} */
  let side = [-ey, ex];                                 // beside the normal, the upper side
  if (side[1] > 0 || (side[1] === 0 && side[0] < 0)) {
    side = [-side[0], -side[1]];
  }
  // as far out as the label's box reaches that way, half its width or height, and a margin: clear of the arrow
  ctx.save();
  ctx.font = LABEL_FONT;
  const half = (ctx.measureText(`${show(g.gap)} ${unitText(g.unit)}`).width + 10) / 2;
  ctx.restore();
  const reach = half * Math.abs(side[0]) + (LABEL_HEIGHT / 2) * Math.abs(side[1]) + 6;
  return [(f1[0] + f2[0]) / 2 + reach * side[0], (f1[1] + f2[1]) / 2 + reach * side[1]];
}

/**
 * A profile's band, outlined (dashed) when wider than a few screen pixels; returns where the
 * profile's label goes: beyond the band, on the side away from the square that sets the width.
 * @param {FixedMeasurement} ms
 * @param {Point[]} pts       screen
 * @param {(p: Point) => Point} toScreen
 * @param {string} color
 * @param {string|null} label
 * @returns {Point|null}
 */
function drawProfileBand(ms, pts, toScreen, color, label) {
  const [u1, u2] = ms.points;
  const h = widthHandle(ms.points, ms.width ?? app.profileWidth, app.frame);
  /** @type {Point} */
  const mid = [(u1[0] + u2[0]) / 2, (u1[1] + u2[1]) / 2];
  const across = [h[0] - mid[0], h[1] - mid[1]];             // half the band, stored
  /** @type {(p: Point, sign: number) => Point} */
  const side = (p, sign) => toScreen([p[0] + sign * across[0], p[1] + sign * across[1]]);
  const [a, b, c, d] = [side(u1, 1), side(u2, 1), side(u2, -1), side(u1, -1)];
  if (Math.hypot(a[0] - d[0], a[1] - d[1]) > 3) {
    const band = new Path2D();
    band.moveTo(a[0], a[1]);
    for (const p of [b, c, d]) {
      band.lineTo(p[0], p[1]);
    }
    band.closePath();
    strokeOverlay(band, color, { dash: [4, 3], width: 1 });
  }
  if (label === null) {
    return null;
  }
  const [hx, hy] = toScreen(h);
  const [mx, my] = toScreen(mid);
  const reach = Math.hypot(hx - mx, hy - my);
  const line = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]) || 1;
  /** @type {Point} away from the handle; across the line when the band has no width */
  const u = reach > 1e-6 ? [(mx - hx) / reach, (my - hy) / reach] : [(pts[1][1] - pts[0][1]) / line, -(pts[1][0] - pts[0][0]) / line];
  ctx.font = LABEL_FONT;
  const r = reach + 8 + (ctx.measureText(label).width / 2 + 5) * Math.abs(u[0]) + (LABEL_HEIGHT / 2) * Math.abs(u[1]);
  return [mx + r * u[0], my + r * u[1]];
}

/**
 * The square on a profile's band that sets its width: white, edged in the profile's colour.
 * @param {FixedMeasurement} ms
 * @param {(p: Point) => Point} toScreen
 * @param {string} color
 */
function drawWidthHandle(ms, toScreen, color) {
  const [hx, hy] = toScreen(widthHandle(ms.points, ms.width ?? app.profileWidth, app.frame));
  const r = 4 * handleScale();      // larger for a finger
  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(hx - r, hy - r, 2 * r, 2 * r);
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = color;
  ctx.strokeRect(hx - r, hy - r, 2 * r, 2 * r);
  ctx.restore();
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
 * A profile's markers on the image: ticks across the band, at least 16 screen pixels long, where
 * they lie along the line (P12), in the profile's colour, with their letters beyond one end.
 * @param {FixedMeasurement} ms
 * @param {(p: Point) => Point} toScreen
 * @param {string} color
 */
function drawProfileMarkers(ms, toScreen, color) {
  const markers = ms.markers ?? [];
  if (markers.length === 0) {
    return;
  }
  const [u1, u2] = ms.points;
  const h = widthHandle(ms.points, Math.max(ms.width ?? 1, 16 / Math.max(app.view.s, 1e-9)), app.frame);
  /** @type {Point} half the tick, stored */
  const half = [h[0] - (u1[0] + u2[0]) / 2, h[1] - (u1[1] + u2[1]) / 2];
  const ticks = new Path2D();
  /** @type {Array<[string, Point, Point]>} the letter, the tick's end and its direction on screen */
  const letters = [];
  markers.forEach((m, k) => {
    const t = markerPlace(ms.points, m, app.frame);
    /** @type {Point} */
    const p = [u1[0] + t * (u2[0] - u1[0]), u1[1] + t * (u2[1] - u1[1])];
    const a = toScreen([p[0] - half[0], p[1] - half[1]]);
    const b = toScreen([p[0] + half[0], p[1] + half[1]]);
    addSegment(ticks, a, b);
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    letters.push(["AB"[k], b, [(b[0] - a[0]) / length, (b[1] - a[1]) / length]]);
  });
  strokeOverlay(ticks, color, { width: 2.4 });
  ctx.save();
  ctx.font = `600 ${LABEL_FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  for (const [letter, b, u] of letters) {
    const [x, y] = [b[0] + 9 * u[0], b[1] + 9 * u[1]];
    ctx.lineWidth = 3;
    ctx.strokeStyle = casingOf(color);
    ctx.strokeText(letter, x, y);
    ctx.fillStyle = color;
    ctx.fillText(letter, x, y);
  }
  ctx.restore();
}

/**
 * A measurement other than a contour, complete or being placed (``pending``, dashed), possibly with
 * fewer points than its kind: selected, thicker with a halo and white points; the profile edited
 * (``handle``) with the square that sets its width.
 * @param {FixedMeasurement} ms
 * @param {string} color
 * @param {(p: Point) => Point} toScreen
 * @param {{pending?: boolean, selected?: boolean, handle?: boolean}} how
 */
function drawMeasurement(ms, color, toScreen, how) {
  const pts = ms.points.map(toScreen);
  const label = ms.points.length === MEASURE_POINTS[ms.kind] ? measurementLabel(ms) : null;
  const selected = how.selected === true;
  const solid = new Path2D();
  const dashed = new Path2D();
  const labelAt = addShape(ms, { solid, dashed }, pts, toScreen, () => drawProfileBand(ms, pts, toScreen, color, label));
  strokeOverlay(solid, color, { selected, dash: how.pending ? [5, 4] : [] });
  strokeOverlay(dashed, color, { dash: [3, 4], width: 1.2 });
  if (ms.kind === "profile" && !how.pending && pts.length >= 2) {
    drawProfileMarkers(ms, toScreen, color);
  }
  if (ms.kind === "profile" && how.handle && !how.pending && pts.length >= 2) {
    drawWidthHandle(ms, toScreen, color);
  }
  if (label !== null && labelAt !== null) {
    drawLabel(label, labelAt, color, selected);
  }
  drawPoints(pts, color, selected);
}

/**
 * A measurement's shape as far as its points go, added to the paths; returns where its label goes,
 * or null.  ``band`` draws a profile's band and tells where a profile's label goes.
 * @param {FixedMeasurement} ms
 * @param {{solid: Path2D, dashed: Path2D}} paths
 * @param {Point[]} pts      screen
 * @param {(p: Point) => Point} toScreen
 * @param {() => Point|null} band
 * @returns {Point|null}
 */
function addShape(ms, paths, pts, toScreen, band) {
  const { solid, dashed } = paths;
  if (pts.length < 2) {
    return null;
  }
  if (ms.kind === "ruler") {
    return addRuler(solid, pts);
  }
  if (ms.kind === "profile") {
    const at = band();
    addRuler(solid, pts);
    return at;
  }
  if (ms.kind === "angle") {
    addSegment(solid, pts[1], pts[0]);
    if (pts.length < 3) {
      return null;
    }
    const v = pts[1];
    addSegment(solid, v, pts[2]);
    const bisector = addArc(solid, v, [pts[0][0] - v[0], pts[0][1] - v[1]], [pts[2][0] - v[0], pts[2][1] - v[1]]);
    return bisector === null ? null : [v[0] + (ARC_PX + 16) * bisector[0], v[1] + (ARC_PX + 16) * bisector[1]];
  }
  if (pts.length < 4) {                              // two lines, the first so far
    addSegment(solid, pts[0], pts[1]);
    return null;
  }
  return ms.kind === "gap" ? addGap(solid, dashed, ms.points, pts, toScreen)
    : addLineAngle(solid, dashed, pts, lineIntersection(ms.points[0], ms.points[1], ms.points[2], ms.points[3]), toScreen);
}

/**
 * The measurement being placed, dashed in the colour it will take, its next point following the
 * cursor (or the snap preview).
 * @param {(p: Point) => Point} toScreen
 */
function drawPending(toScreen) {
  const p = app.pending;
  if (p === null) {
    return;
  }
  const tip = app.preview ?? app.cursor;
  /** @type {FixedMeasurement} */
  const ms = { name: "", kind: p.kind, color: nextColorIndex(), points: tip === null ? p.points : [...p.points, tip] };
  drawMeasurement(ms, colorOf(ms), toScreen, { pending: true });
}

// ------------------------------------------------------------------------- selection
//
// The list selects measurements, one or several (``checked``); one of them, or none, is the one
// edited (``selected``): the contour the contour tool extends, the profile of the profile window,
// the ruler that levels the image.  A measurement selected alone is the one edited.

/**
 * Select measurement ``index`` alone (-1: none).
 * @param {number} index
 */
function selectOnly(index) {
  if (index !== app.selected) {
    clearPicked();
  }
  app.selected = index;
  app.checked = index >= 0 ? [index] : [];
  app.listAnchor = index;
}

/**
 * After a change of the selection: the one edited stays only while it is selected, and one selected
 * alone is the one edited.  The vertices picked in the vertex window go with a change of contour.
 * @param {number} before   the one edited before the change
 */
function settleSelection(before) {
  if (app.checked.length === 1) {
    app.selected = app.checked[0];
  } else if (!app.checked.includes(app.selected)) {
    app.selected = -1;
  }
  if (app.selected !== before) {
    clearPicked();
  }
}

/**
 * Make measurement ``index`` the one edited: within the selection when it is part of it, else alone.
 * @param {number} index
 */
function focusMeasurement(index) {
  if (!app.checked.includes(index)) {
    selectOnly(index);
  } else if (index !== app.selected) {
    clearPicked();
    app.selected = index;
  }
}

/**
 * Add measurement ``index`` to the selection, or take it out: its box in the list, or Ctrl+click.
 * @param {number} index
 */
function toggleChecked(index) {
  const before = app.selected;
  const set = new Set(app.checked);
  if (!set.delete(index)) {
    set.add(index);
  }
  app.checked = [...set].sort((a, b) => a - b);
  app.listAnchor = index;
  settleSelection(before);
}

/**
 * Select the measurements from the row clicked last to ``index``: Shift+click.
 * @param {number} index
 */
function checkRange(index) {
  const before = app.selected;
  const from = app.listAnchor >= 0 && app.listAnchor < app.measurements.length ? app.listAnchor : index;
  const [a, b] = from <= index ? [from, index] : [index, from];
  app.checked = Array.from({ length: b - a + 1 }, (_, k) => a + k);
  settleSelection(before);
}

/** Select all the measurements: Ctrl+A. */
function checkAll() {
  const before = app.selected;
  app.checked = app.measurements.map((_, i) => i);
  settleSelection(before);
  refreshMeasurements();
  render();
}

// ------------------------------------------------------------------------- editing

/** @returns {Contour|null} the selected measurement when it is a contour: the one the contour tool extends */
function currentContour() {
  const ms = app.measurements[app.selected];
  return ms !== undefined && ms.kind === "contour" ? ms : null;
}

/**
 * The contour that receives a new vertex: the selected one, else a new contour ("contour 1" and so
 * on), then selected alone.
 * @returns {Contour}
 */
function contourForVertex() {
  const c = currentContour();
  if (c !== null) {
    return c;
  }
  /** @type {Contour} */
  const made = { name: newMeasureName("contour"), kind: "contour", color: nextColorIndex(), closed: true, points: [] };
  app.measurements.push(made);
  selectOnly(app.measurements.length - 1);
  return made;
}

/** @returns {string} */
function snapshot() {
  return JSON.stringify({ measurements: app.measurements, selected: app.selected, checked: app.checked, frame: app.frame });
}

/** @param {string} state */
function restore(state) {
  const s = JSON.parse(state);
  app.pending = null;
  clearPicked();
  app.measurements = s.measurements;
  app.selected = s.selected;
  app.checked = s.checked;
  changeFrame(() => {
    app.frame = s.frame;
  });
}

/**
 * Record the state before an edit, for undo: by default the state now.
 * @param {string} [state]   a snapshot taken earlier: for a drag, at the press, recorded at its first move
 */
function pushHistory(state = snapshot()) {
  app.history.push(state);
  if (app.history.length > HISTORY) {
    app.history.shift();
  }
  app.future = [];
  app.dirty = true;
}

/** Undo: the last point of a measurement being placed, which is no edit yet; else the last edit. */
function undo() {
  if (app.pending !== null) {
    dropPendingPoint();
    return;
  }
  const state = app.history.pop();
  if (state !== undefined) {
    app.future.push(snapshot());
    restore(state);
    app.dirty = true;
  }
}

/** Take back the last point of the measurement being placed: the measurement goes with its first. */
function dropPendingPoint() {
  if (app.pending !== null) {
    app.pending.points.pop();
    if (app.pending.points.length === 0) {
      app.pending = null;
    }
    render();
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
 * The point under a screen position: a contour's vertex (``contour``), else a point of another kind
 * of measurement; the selected measurement's first, then the later measurements' (drawn on top)
 * before the earlier.  Null when there is none.
 * @param {number} sx
 * @param {number} sy
 * @param {boolean} contour
 * @returns {{index: number, point: number}|null}
 */
function hitPoint(sx, sy, contour) {
  const toScreen = screenMapper();
  const others = app.measurements.map((_, i) => i).filter((i) => i !== app.selected).reverse();
  for (const i of app.selected >= 0 ? [app.selected, ...others] : others) {
    const ms = app.measurements[i];
    const vi = (ms.kind === "contour") === contour ? nearestPoint(ms.points, toScreen, sx, sy) : -1;
    if (vi >= 0) {
      return { index: i, point: vi };
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
  return Math.max(Math.abs(x - sx), Math.abs(y - sy)) <= hitPx();
}

/**
 * Index of the point within hitPx() of a screen position, the nearest; -1 when none.
 * @param {Point[]} points
 * @param {(p: Point) => Point} toScreen
 * @param {number} sx
 * @param {number} sy
 * @returns {number}
 */
function nearestPoint(points, toScreen, sx, sy) {
  let best = hitPx();
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
  const c = contourForVertex();
  if (how.insert) {
    const at = insertionIndex(c, p[0], p[1]);
    c.points.splice(at, 0, p);
    app.picked = app.picked.map((i) => (i >= at ? i + 1 : i));
  } else {
    c.points.push(p);
  }
  refreshMeasurements();
  render();
}

function clearPicked() {
  app.picked = [];
  app.pickAnchor = -1;
}

/**
 * The picked indices after vertex ``index`` of the selected contour was removed.
 * @param {number} index
 */
function forgetVertex(index) {
  app.picked = app.picked.filter((i) => i !== index).map((i) => (i > index ? i - 1 : i));
}

/** N: done with the selected contour.  Nothing is selected, and the contour tool starts a new one. */
function finishContour() {
  selectOnly(-1);
  if (app.tool !== "contour") {
    setTool("contour");
  }
  refreshMeasurements();
  render();
}

/**
 * Ask for a new name, unique among ``others``; null when cancelled or unchanged.
 * @param {string} current
 * @param {string[]} others   the names of the other measurements
 * @param {string} what       e.g. "contour"
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
    window.alert(`Another measurement is already called "${clean}".`);
    return null;
  }
  return clean;
}

function deleteLastVertex() {
  const c = currentContour();
  if (c !== null && c.points.length > 0) {
    pushHistory();
    c.points.pop();
    forgetVertex(c.points.length);
    refreshMeasurements();
    render();
  }
}

/** @param {boolean} closed */
function setClosed(closed) {
  const c = currentContour();
  if (c === null) {
    refreshMeasurements();
    return;
  }
  if (c.closed !== closed) {
    pushHistory();
    c.closed = closed;
    refreshMeasurements();
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
    /** @type {FixedMeasurement} */
    const ms = { name: newMeasureName(kind), kind, color: nextColorIndex(), points: pending.points };
    if (kind === "profile") {
      ms.width = app.profileWidth;
    }
    app.measurements.push(ms);
    selectOnly(app.measurements.length - 1);
    app.pending = null;
    if (kind === "profile" && settings.squareProfiles() && !exact) {
      squareMeasurement(ms, storedToScreen(x, y), MAX_TURN_DEG);   // a step of its own: Ctrl+Z gives it back as drawn
    }
    refreshMeasurements();
    if (kind === "profile") {
      openProfileWindow();           // a new profile shows its plot at once
    }
  }
  render();
}

/**
 * Delete measurements, contours included (an undoable edit); the others keep their place in the
 * selection.
 * @param {number[]} indices
 */
function deleteMeasurements(indices) {
  const gone = new Set(indices.filter((i) => i >= 0 && i < app.measurements.length));
  if (gone.size === 0) {
    return;
  }
  pushHistory();
  const before = app.selected;
  let kept = 0;
  /** the new index of each measurement; -1 for one deleted */
  const moved = app.measurements.map((_, i) => (gone.has(i) ? -1 : kept++));
  app.measurements = app.measurements.filter((_, i) => !gone.has(i));
  app.checked = app.checked.map((i) => moved[i]).filter((i) => i >= 0);
  app.selected = app.selected >= 0 ? moved[app.selected] : -1;
  app.listAnchor = -1;
  settleSelection(before);
  refreshMeasurements();
  render();
}

/**
 * Rename a measurement: by default the one selected, when it is alone.
 * @param {number} [index]
 */
function renameMeasurement(index = app.checked.length === 1 ? app.checked[0] : -1) {
  const ms = app.measurements[index];
  if (ms === undefined) {
    return;
  }
  const name = askName(ms.name, app.measurements.filter((o) => o !== ms).map((o) => o.name), MEASURE_NAMES[ms.kind]);
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
  buttonEl("save-session").disabled = image === null;
  const info = el("image-info");
  if (image === null) {
    info.textContent = "No image.";
    info.title = "";
    return;
  }
  const rows = image.height - image.imageRows;
  fillParts(info, [{ file: image.name }, `\n${image.width} x ${image.height} pixels (${image.sampleType})` +
    `${rows > 0 ? `, info bar ${rows} pixels` : ""}`]);
  // what the bar means, on hovering: the line itself gives only its height
  info.title = rows > 0 ? `The info bar, the bottom ${rows} rows below the dashed line, is left out of the histogram, ` +
    "the auto contrast and the edge detection." : "";
}

function showMetadata() {
  const image = app.image;
  if (image === null) {
    return;
  }
  el("metadata-summary").textContent = describeCalibration(image.calibration).join("\n");
  el("metadata-raw").textContent = image.metadataText || "(none)";
}

/**
 * The rows of the measurement list: a box that adds the row to the selection or takes it out, then
 * the name and the brief measures.  The rows stay the same elements across refreshes, only their
 * text and state change: a row clicked twice must be the same element.
 */
function fillMeasurementList() {
  const list = el("measurement-list");
  const checked = new Set(app.checked);
  while (list.children.length > app.measurements.length) {
    /** @type {Element} */ (list.lastElementChild).remove();
  }
  app.measurements.forEach((ms, i) => {
    let row = list.children[i];
    if (row === undefined) {
      row = document.createElement("div");
      row.className = "item";
      row.id = `measurement-row-${i}`;
      row.setAttribute("role", "option");
      const box = document.createElement("span");
      box.className = "box";
      box.title = "Add to the selection, or take out (Ctrl+click)";
      const swatch = document.createElement("span");           // the measurement's colour on the image
      swatch.className = "swatch";
      swatch.setAttribute("aria-hidden", "true");
      row.append(box, swatch, document.createElement("span"));
      list.append(row);
    }
    const swatch = /** @type {HTMLElement} */ (row.children[1]);
    const color = colorOf(ms);
    if (swatch.dataset.color !== color) {
      swatch.dataset.color = color;
      swatch.style.background = color;
    }
    const text = `${ms.name}: ${describeMeasurement(ms).brief}`;
    const label = /** @type {Element} */ (row.lastElementChild);
    if (label.textContent !== text) {
      label.textContent = text;
    }
    const on = String(checked.has(i));
    if (row.getAttribute("aria-selected") !== on) {
      row.setAttribute("aria-selected", on);
    }
    row.classList.toggle("edited", i === app.selected);
  });
  if (app.selected >= 0) {
    list.setAttribute("aria-activedescendant", `measurement-row-${app.selected}`);
  } else {
    list.removeAttribute("aria-activedescendant");
  }
}

/**
 * The measures of a contour for the panel: a short one for the list and the details.
 * @param {Contour} c
 * @returns {{brief: string, details: string}}
 */
function describeContour(c) {
  const shape = `${c.points.length} ${c.points.length === 1 ? "vertex" : "vertices"}`;
  const m = measureContour(c, app.frame);
  if (m === null) {
    return { brief: `${shape}${c.closed ? "" : ", open"}`, details: `${shape}\ncorrection factor undefined: no measures` };
  }
  const u = unitText(m.unit);
  const length = `${c.closed ? "perimeter" : "length"} ${show(m.perimeter)} ${u}`;
  const area = c.closed && m.vertices > 2 ? `area ${show(m.area)} ${u}²` : null;
  const lines = [`${shape}, ${c.closed ? "closed" : "open"}`, length];
  if (area !== null) {
    lines.push(area);
  }
  lines.push(`bounding box ${show(m.width)} × ${show(m.height)} ${u}`);
  if (m.unit === "px" && app.image !== null) {
    lines.push("(no pixel size: lengths in pixels)");
  }
  return { brief: `${shape}, ${area ?? (c.closed ? length : `open, ${length}`)}`, details: lines.join("\n") };
}

/**
 * The measures of a measurement for the panel: a short one for the list and the details.
 * @param {Measurement} ms
 * @returns {{brief: string, details: string}}
 */
function describeMeasurement(ms) {
  if (ms.kind === "contour") {
    return describeContour(ms);
  }
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
    const at = (ms.markers ?? []).map((m) => markerPlace(ms.points, m, app.frame));
    const markers = at.length === 2 ? `markers A, B ${show(Math.abs(at[1] - at[0]) * g.length)} ${u} apart\n` : "";
    return {
      brief: `${show(r.length)} ${u}, band ${show(g.width)} ${u}`,
      details: `${line.details}\nband ${show(g.width)} ${u} wide\n${markers}P shows the profile window`,
    };
  }
  if (ms.kind === "gap") {
    const g = measureGap(ms.points, app.frame);
    if (g === null) {
      return { brief: "?", details: "no measures: the correction factor is undefined, or a line is a point" };
    }
    const text = `${show(g.gap)} ${unitText(g.unit)}`;
    return { brief: text, details: `gap ${text}` };
  }
  if (ms.kind === "angle") {
    const a = measureAngle(ms.points, app.frame);
    return a === null ? undefinedFactor : { brief: `${a.toFixed(2)}°`, details: `angle ${a.toFixed(3)}°` };
  }
  const la = measureLineAngle(ms.points, app.frame);
  if (la === null) {
    return undefinedFactor;
  }
  return {
    brief: `${la.angleDeg.toFixed(2)}°`,
    details: `angle ${la.angleDeg.toFixed(3)}° from line 1 to line 2, as clicked (supplement ` +
      `${(180 - la.angleDeg).toFixed(3)}°)`,
  };
}

/** The list, the details and the controls of the selection, and the windows that follow it. */
function refreshMeasurements() {
  const n = app.measurements.length;
  app.checked = app.checked.filter((i) => i < n);
  if (app.selected >= n) {
    app.selected = -1;
  }
  fillMeasurementList();
  const ms = app.measurements[app.selected];
  const count = app.checked.length;
  el("measurement-details").textContent = selectionText(ms, count, n);
  el("ruler-controls").hidden = !(ms !== undefined && ms.kind === "ruler");   // they act on the ruler edited
  buttonEl("rename-measurement").disabled = count !== 1;
  buttonEl("delete-measurement").disabled = count === 0;
  buttonEl("download").disabled = n === 0;
  const c = currentContour();
  el("contour-controls").hidden = c === null;
  if (c !== null) {
    inputEl("closed").checked = c.closed;
    const [layer, datatype] = c.layer ?? [1, 0];
    inputEl("contour-layer").value = String(layer);
    inputEl("contour-datatype").value = String(datatype);
  }
  refreshVertexWindow();
  refreshProfileWindow();
}

/**
 * The details under the list: the measurement edited, and how many are selected.
 * @param {Measurement|undefined} ms     the one edited
 * @param {number} count                 how many are selected
 * @param {number} n                     how many there are
 * @returns {string}
 */
function selectionText(ms, count, n) {
  if (n === 0) {
    return "Trace a contour (tool 1), or measure with tools 2 to 5.";
  }
  if (count === 0) {
    return "Select a measurement: click or tap it here, or one of its points with its tool.";
  }
  const several = count > 1 ? `${count} selected: Download gives one CSV row each.` : "";
  if (ms === undefined) {
    return several;
  }
  const about = `${ms.name}\n${describeMeasurement(ms).details}`;
  return several ? `${several}\n\n${about}` : about;
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
  inputEl("rotation-slider").value = String(f.rotationDeg);
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
    /** @type {Record<string, string>} the law of k, which the correction's menu leaves out to stay short */
    const law = { "cross-section": "1/sin θ = ", "tilted-surface": "1/cos θ = " };
    const lines = [k === 1 ? "correction factor k = 1" : `correction factor k = ${law[f.correction] ?? ""}${k.toFixed(5)}, across the tilt axis`];
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

/**
 * Turn the view to the rotation ``deg``, as the slider is dragged or a step button held: only the view
 * turns, about its centre, and the rotation field and the slider follow.  render() draws at most once
 * per displayed frame, the picture through a transform (draw), so this costs one transformed image a
 * frame.  The measurement list, the notes and the windows, which cost more and which a rotation
 * changes little, follow when the rotation ends (rotationDone).
 * @param {number} deg
 */
function rotateView(deg) {
  if (app.rotating === null) {
    app.rotating = { deg0: app.frame.rotationDeg, before: snapshot(), rect: canvas.getBoundingClientRect() };
  }
  const { rect } = app.rotating;
  const centre = app.image === null ? null : screenToStored(rect.width / 2, rect.height / 2);
  app.frame.rotationDeg = normalizeDegrees(deg, 360);
  if (centre !== null) {
    const [sx, sy] = storedToScreen(centre[0], centre[1]);
    app.view.tx += rect.width / 2 - sx;
    app.view.ty += rect.height / 2 - sy;
  }
  inputEl("rotation").value = String(Number(app.frame.rotationDeg.toFixed(4)));
  inputEl("rotation-slider").value = String(app.frame.rotationDeg);
  render();
}

/** A rotation ended: the slider let go, a key or a step button: one undoable edit, and all that the rotation changes follows. */
function rotationDone() {
  const r = app.rotating;
  app.rotating = null;
  if (r !== null && r.deg0 !== app.frame.rotationDeg) {
    pushHistory(r.before);
  }
  refreshFrameInputs();
  refreshMeasurements();
  render();
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

// ------------------------------------------------------------------------- colours
//
// The overlay's colours: a colour order, MATLAB's by default, Okabe-Ito's, or one picked by hand in
// the window of custom colours.  The browser keeps the choice: a matter of taste, not of the work,
// so the session file does not hold it.

/** Take up the colours the browser kept, if any. */
function loadColours() {
  try {
    const saved = JSON.parse(localStorage.getItem(COLOURS_KEY) ?? "null");
    const hex = (/** @type {unknown} */ c) => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c);
    if (saved !== null && typeof saved === "object") {
      if (Array.isArray(saved.custom) && saved.custom.length === colours.custom.length && saved.custom.every(hex)) {
        colours.custom = saved.custom;
      }
      if (["matlab", "okabe-ito", "custom"].includes(saved.palette)) {
        colours.palette = saved.palette;
      }
    }
  } catch {
    // no storage (blocked, or a private window): the defaults
  }
}

function saveColours() {
  try {
    localStorage.setItem(COLOURS_KEY, JSON.stringify(colours));
  } catch {
    // no storage: the choice lasts as long as the page
  }
}

/**
 * Draw with the colours of ``palette``: "matlab", "okabe-ito" or "custom".
 * @param {string} palette
 */
function setPalette(palette) {
  colours.palette = palette;
  saveColours();
  selectEl("palette").value = palette;
  refreshMeasurements();             // the swatches of the list, and the crossings on the profile plot
  render();
}

/** The window of custom colours: a picker for each colour of the order. */
function refreshColourWindow() {
  const slots = el("colour-slots");
  if (slots.children.length !== 2 * colours.custom.length) {
    slots.replaceChildren(...colours.custom.flatMap((_, k) => {
      const label = document.createElement("label");
      label.htmlFor = `colour-${k}`;
      label.textContent = String(k + 1);
      const input = document.createElement("input");
      input.type = "color";
      input.id = `colour-${k}`;
      input.addEventListener("input", () => {
        colours.custom[k] = input.value;
        setPalette("custom");
      });
      return [label, input];
    }));
  }
  colours.custom.forEach((c, k) => {
    const input = /** @type {HTMLInputElement} */ (slots.children[2 * k + 1]);
    if (input.value.toLowerCase() !== c.toLowerCase()) {
      input.value = c;
    }
  });
}

function toggleColourWindow() {
  const w = el("colour-window");
  w.hidden = !w.hidden;
  keepWindowsInView();
  refreshColourWindow();
}

// ------------------------------------------------------------------------- files

/** @returns {SnapSettings} */
function snapSettings() {
  return {
    on: settings.snap(), sigmaPx: settings.sigma(), median: settings.median(), radiusPx: settings.radius(),
    minContrast: settings.minContrast(), squareProfiles: settings.squareProfiles(), snapMarkers: settings.snapMarkers(),
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

/**
 * The polygon file of ``contours``: their vertices, those with any.
 * @param {Contour[]} contours
 * @returns {string}
 */
function polygonText(contours) {
  const s = snapSettings();
  const snap = `sigma_px=${s.sigmaPx} median=${s.median} radius_px=${s.radiusPx} min_contrast=${s.minContrast} ` +
    `snap=${s.on ? "on" : "off"}`;
  return formatPolygonFile(imageInfo(), app.frame, contours.filter((c) => c.points.length > 0), snap);
}

/**
 * The measurements file: one row for each of ``list``.
 * @param {Measurement[]} list
 * @returns {string}
 */
function measurementText(list) {
  return formatMeasurementFile(imageInfo(), app.frame, list, (ms) => profileMean(ms));
}

/** @returns {string} the session file */
function sessionText() {
  return formatSession({
    image: imageInfo(), frame: app.frame, snap: snapSettings(), measurements: app.measurements, selected: app.selected,
    display: app.image ? [app.lo, app.hi] : null,
  }, new Date().toISOString());
}

/**
 * Offer ``content`` as a download named ``name``.
 * @param {string|Uint8Array|Blob} content
 * @param {string} name
 * @param {string} type
 */
function download(content, name, type) {
  const blob = content instanceof Blob ? content : new Blob([typeof content === "string" ? content : new Uint8Array(content)], { type });
  const url = URL.createObjectURL(blob);
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
  if (app.image === null) {
    setStatus("Open an image first: a session belongs to an image.");
    return;
  }
  download(sessionText(), `${stem()}_session.json`, "application/json");
  app.dirty = false;
}

/**
 * A name made safe for a file name.
 * @param {string} name
 * @returns {string}
 */
function fileSafe(name) {
  return name.replace(/[^A-Za-z0-9._-]+/g, "_");
}

/**
 * Download the vertices of ``contours`` as a polygon file named ``name``.
 * @param {Contour[]} contours
 * @param {string} name
 */
function exportPolygons(contours, name) {
  download(polygonText(contours), name, "text/csv;charset=utf-8");
}

/**
 * Download a measurements file named ``name``, one row for each of ``list``.
 * @param {Measurement[]} list
 * @param {string} name
 */
function exportMeasurements(list, name) {
  download(measurementText(list), name, "text/csv;charset=utf-8");
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
 * ``name``, or "name (2)" and so on when ``taken`` has it; what it gives is added to ``taken``.
 * @param {string} name
 * @param {Set<string>} taken
 * @returns {string}
 */
function uniqueName(name, taken) {
  let out = name;
  for (let k = 2; taken.has(out); k++) {
    out = `${name} (${k})`;
  }
  taken.add(out);
  return out;
}

/**
 * Load contours (and the frame they were traced in) from a polygon file: they take the place of
 * the contours traced so far, and the other measurements stay.
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
  const others = app.measurements.filter((m) => m.kind !== "contour");
  const taken = new Set(others.map((m) => m.name));
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
    contours.push({ name: uniqueName(c.name, taken), kind: "contour", color: nextColorIndex([...others, ...contours]), closed: c.closed,
      points });
  }
  pushHistory();
  app.measurements = [...others, ...contours];
  selectOnly(-1);
  changeFrame(() => {
    app.frame = frame;
  });
  setStatus(`Loaded ${contours.length} contour(s) from ${name}`);
  return true;
}

/**
 * Take up a session: frame, measurements and snap settings.
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
  clearPicked();
  app.measurements = session.measurements;
  selectOnly(session.selected);
  const s = session.snap;
  inputEl("snap").checked = s.on;
  inputEl("square-profiles").checked = s.squareProfiles;
  inputEl("snap-markers").checked = s.snapMarkers;
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
  setStatus(`Took up ${name}: ${session.measurements.length} measurement(s)`);
  return true;
}

/**
 * The text of a small file: UTF-8, or Windows-1252 when it is not valid UTF-8 (a micro sign, say).
 * @param {File} file
 * @returns {Promise<string>}
 */
async function readText(file) {
  const bytes = await file.arrayBuffer();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

/**
 * Open files chosen or dropped together: an image with its metadata file (a .txt or .hdr file
 * whose text one vendor's is: Hitachi, JEOL, TESCAN), then sessions (.json) and polygon files
 * (.csv, other .txt).  The metadata file of the image's name is taken, else the only one.
 * @param {File[]} files
 */
async function openFiles(files) {
  /** @type {File[]} */
  const images = [];
  /** @type {Array<{name: string, text: string}>} */
  const metadata = [];
  /** @type {Array<{name: string, text: string}>} */
  const others = [];
  for (const file of files) {
    if (/\.(json|csv|txt|hdr)$/i.test(file.name)) {
      const text = await readText(file);
      (/\.(txt|hdr)$/i.test(file.name) && metadataVendor(text) !== null ? metadata : others).push({ name: file.name, text });
    } else {
      images.push(file);
    }
  }
  const image = images[0];
  if (image === undefined && metadata.length > 0) {
    setStatus(`${metadata[0].name} holds microscope metadata: open it together with its image (select or drop both).`);
  }
  if (image !== undefined && (!app.dirty || !hasWork() || window.confirm("Discard the unsaved work and open another image?"))) {
    const own = metadata.find((m) => fileStem(m.name) === fileStem(image.name)) ?? (metadata.length === 1 ? metadata[0] : null);
    if (!(await openImageBuffer(image.name, await image.arrayBuffer(), own))) {
      return;
    }
    const left = [...images.slice(1).map((f) => f.name), ...metadata.filter((m) => m !== own).map((m) => m.name)];
    if (left.length) {
      setStatus(`${app.message}; not opened: ${left.join(", ")} (one image, and its metadata file, at a time)`);
    }
  }
  for (const other of others) {
    if (/\.json$/i.test(other.name)) {
      loadSessionText(other.text, other.name);
    } else {
      loadPolygonText(other.text, other.name);
    }
  }
}

/** @returns {boolean} whether any measurement has points */
function hasWork() {
  return app.measurements.some((m) => m.points.length > 0);
}

/** Read the selected contour's GDS layer and datatype from the panel (an undoable edit). */
function layerInputsChanged() {
  const layer = Number(inputEl("contour-layer").value);
  const datatype = Number(inputEl("contour-datatype").value);
  const ok = (/** @type {number} */ v) => Number.isInteger(v) && v >= 0 && v <= 32767;
  const c = currentContour();
  if (c === null) {
    refreshMeasurements();
    return;
  }
  const [l, d] = c.layer ?? [1, 0];
  if (!ok(layer) || !ok(datatype)) {
    setStatus("A GDS layer and datatype are whole numbers from 0 to 32767.");
  } else if (layer !== l || datatype !== d) {
    pushHistory();
    c.layer = [layer, datatype];
  }
  refreshMeasurements();
}

// ------------------------------------------------------------------------- vertex window

function toggleVertexWindow() {
  const w = el("vertex-window");
  w.hidden = !w.hidden;
  keepWindowsInView();
  refreshVertexWindow();
}

/** The rows of the vertex window: the selected contour in the measurement frame, (G8). */
function refreshVertexWindow() {
  if (el("vertex-window").hidden) {
    return;
  }
  const current = currentContour();
  const c = current ?? { name: "", closed: true, points: [] };
  const m = measurementMatrix(app.frame);
  const unit = m === null ? "?" : unitText(m.unit);
  const digits = m !== null && m.unit === "um" ? 4 : 2;
  el("vertex-title").textContent = current === null ? "Vertices: no contour selected" : `Vertices of ${c.name}`;
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
  buttonEl("vertex-zoom").disabled = c.points.length === 0;
  const why = m === null ? "  The correction factor is undefined: no coordinates." : "";
  el("vertex-note").textContent = current === null
    ? "Select a contour under Measurements, or start one with the contour tool (1)."
    : `${c.points.length} vertices, ${app.picked.length} selected (${c.closed ? "closed" : "open"}).${why}`;
}

/**
 * Pick vertex ``i`` of the selected contour: alone, toggled, or the range from the last one picked.
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
 * Replace the selected contour's points (an undoable edit) and the picked vertices.
 * @param {Point[]} points
 * @param {number[]} picked
 */
function setVertices(points, picked) {
  const c = currentContour();
  if (c === null || JSON.stringify(points) === JSON.stringify(c.points)) {
    return;
  }
  pushHistory();
  c.points = points;
  app.picked = picked;
  refreshMeasurements();
  render();
}

/** @param {number} step  -1 (up, earlier) or 1 */
function movePicked(step) {
  const c = currentContour();
  if (c !== null) {
    const r = moveSelected(c.points, app.picked, step);
    setVertices(r.points, r.selected);
  }
}

function dropPicked() {
  const c = currentContour();
  if (c !== null && app.picked.length) {
    setVertices(dropSelected(c.points, app.picked), []);
    app.pickAnchor = -1;
  }
}

function makePickedFirst() {
  const c = currentContour();
  if (c !== null && app.picked.length === 1 && c.closed) {
    setVertices(makeFirst(c.points, app.picked[0]), [0]);
  }
}

function reversePicked() {
  const c = currentContour();
  if (c === null) {
    return;
  }
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
  const c = currentContour();
  const p = c === null ? undefined : c.points[i];
  const q = p === undefined ? null : toMeasurement(app.frame, p[0], p[1]);
  const u = q === null ? null : fromMeasurement(app.frame, axis === "x" ? value : q[0], axis === "y" ? value : q[1]);
  if (u !== null && c !== null) {
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
  input.inputMode = "decimal";       // the number keypad of a touch keyboard
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
  const c = currentContour();
  if (c === null) {
    return;
  }
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
  const c = currentContour();
  if (c === null) {
    return false;
  }
  setVertices(c.points.map((p, i) => (app.picked.includes(i) ? [p[0] + sx, p[1] + sy] : p)), app.picked);
  return true;
}

// ------------------------------------------------------------------------- profile window

const profileCanvas = /** @type {HTMLCanvasElement} */ (el("profile-plot"));

/**
 * @typedef {Object} ProfileData
 * @property {ProfileGeometry} geometry
 * @property {Profile} profile
 * @property {Array<{name: string, index: number, t: number, distance: number}>} crossings   index: the contour's in the list
 * @property {MarkerReading[]} markers   A, then B: as many as the profile has
 */

/** A marker as the window reads it (P12): its label, its place t along the line, its distance and the mean there. */
/** @typedef {{label: string, t: number, distance: number, value: number}} MarkerReading */

/**
 * What the plot shows, and where its axes lie on the canvas (CSS pixels), for the cursor; a press
 * on the plot that may still be a click (it places a marker), and a marker being dragged, with the
 * state before it, recorded for undo at its first move.
 */
const profilePlot = {
  /** @type {ProfileData|null} */
  data: null,
  left: 0,
  right: 1,
  top: 0,
  bottom: 0,
  /** @type {{x: number, y: number}|null} */
  press: null,
  /** @type {{index: number, moved: boolean, before: string}|null} */
  markerDrag: null,
};

function toggleProfileWindow() {
  const w = el("profile-window");
  w.hidden = !w.hidden;
  if (w.hidden) {
    app.profileCursor = null;
    render();
  }
  keepWindowsInView();
  refreshProfileWindow();
}

/** Show the profile window (of the selected profile), if it is not shown already. */
function openProfileWindow() {
  el("profile-window").hidden = false;
  keepWindowsInView();
  refreshProfileWindow();
}

/** @returns {FixedMeasurement|null} the profile the window shows: the selected measurement, when it is a profile */
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
  const contours = app.measurements.flatMap((m, i) => (m.kind === "contour" ? [{ index: i, contour: m }] : []));
  const profile = sampleProfile(app.image, geometry);
  return {
    geometry, profile,
    crossings: profileCrossings(ms.points, contours.map((c) => c.contour)).map((c) => ({
      name: contours[c.contour].contour.name, index: contours[c.contour].index, t: c.t, distance: c.t * geometry.length,
    })),
    markers: markerReadings(ms, geometry, profile),
  };
}

/**
 * The markers of a profile, A then B, as the window reads them (P12).
 * @param {Measurement} ms
 * @param {ProfileGeometry} geometry
 * @param {Profile} profile
 * @returns {MarkerReading[]}
 */
function markerReadings(ms, geometry, profile) {
  return (ms.markers ?? []).map((m, k) => {
    const t = markerPlace(ms.points, m, app.frame);
    return { label: "AB"[k], t, distance: t * geometry.length, value: profileValueAt(profile, t) };
  });
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
  buttonEl("profile-png").disabled = data === null;
  buttonEl("profile-square").disabled = data === null;
  el("profile-note").textContent = profileNote(data);
  showProfileReadout();
  showMarkerReadout();
  drawProfilePlot();
}

/** The line of the markers under the readout: A and B, where they are, the mean there, and how far apart. */
function showMarkerReadout() {
  const data = profilePlot.data;
  const out = el("profile-markers");
  buttonEl("clear-markers").disabled = data === null || data.markers.length === 0;
  if (data === null || data.markers.length === 0) {
    out.textContent = "";
    return;
  }
  const unit = data.geometry.unit;
  const parts = data.markers.map((m) => `${m.label} at ${profileDistanceText(m.distance, unit)}: ` +
    `${Number.isFinite(m.value) ? greyText(m.value) : "no value"}`);
  const [a, b] = data.markers;
  parts.push(b === undefined ? "click again for B" : `A–B ${profileDistanceText(Math.abs(b.distance - a.distance), unit)}`);
  out.textContent = parts.join("; ");
}

/**
 * A distance along a profile as the window writes it: 4 decimals in µm, 2 in pixels.
 * @param {number} s
 * @param {"um"|"px"|null} unit
 * @returns {string}
 */
function profileDistanceText(s, unit) {
  return Number.isFinite(s) ? `${s.toFixed(unit === "um" ? 4 : 2)}${unit === null ? "" : ` ${unitText(unit)}`}` : "?";
}

/**
 * The window's note: the samples along the line, and the contours that cross it, if any.  The lines across
 * the band are left out: the band width above gives them.
 * @param {ProfileData|null} data
 * @returns {string}
 */
function profileNote(data) {
  if (data === null) {
    return app.image === null ? "No image." : "Select a profile under Measurements, or draw one with the profile tool (5).";
  }
  const { geometry: g, crossings } = data;
  const unit = g.unit === null ? "" : ` ${unitText(g.unit)}`;
  const lines = [`${g.samples} samples along`];
  /** @type {Map<string, string[]>} */
  const byContour = new Map();
  for (const c of crossings) {
    byContour.set(c.name, [...(byContour.get(c.name) ?? []), Number.isFinite(c.distance) ? show(c.distance) : "?"]);
  }
  if (byContour.size > 0) {
    lines.push(`crossed by ${[...byContour].map(([name, at]) => `${name} at ${at.join(", ")}${unit}`).join("; ")}`);
  }
  return lines.join("\n");
}

/** The readout under the plot: the value at the cursor, or a hint. */
function showProfileReadout() {
  const data = profilePlot.data;
  const t = app.profileCursor;
  const out = el("profile-readout");
  if (data === null || t === null) {
    out.textContent = data === null ? "" : "Point at the plot to read a value; click it to place markers A and B.";
    return;
  }
  const { profile, geometry } = data;
  const i = Math.round(t * (profile.mean.length - 1));
  const unit = geometry.unit === null ? "" : ` ${unitText(geometry.unit)}`;
  const at = Number.isFinite(profile.distance[i]) ? `${profile.distance[i].toFixed(geometry.unit === "um" ? 4 : 2)}${unit}` : "?";
  const [n, across] = [profile.count[i], geometry.offsets.length];
  const spread = n > 1 ? ` ± ${String(Number(profile.spread[i].toPrecision(4)))}` : "";
  const part = n < across ? ` (${n} of ${across} values across, the rest outside the image)` : "";   // the count only when short
  out.textContent = n === 0 ? `at ${at}: outside the image` : `at ${at}: ${greyText(profile.mean[i])}${spread}${part}`;
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

/** The plot in the profile window, at the window's size and the screen's resolution. */
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
  const axis = plotProfile(g, w, h, profilePlot.data, { cursor: app.profileCursor, title: null });
  Object.assign(profilePlot, axis);
}

/**
 * The labels of a profile plot's y axis: those of the lines at 0 and the full scale, then the ticks
 * that keep 16 pixels clear of the lines, so that no two labels touch (an 8-bit image's 250 and 260
 * are left out beside 255); with the width of the widest, for the margin.
 * @param {CanvasRenderingContext2D} g
 * @param {{lo: number, hi: number, limits: number[]}} range
 * @param {number} height   of the plot, CSS pixels
 * @returns {{labels: Array<{v: number, text: string, limit: boolean}>, width: number}}
 */
function yAxisLabels(g, range, height) {
  const { lo, hi, limits } = range;
  const clear = (16 * (hi - lo)) / height;
  /** @type {Array<{v: number, text: string, limit: boolean}>} */
  const labels = [];
  for (const v of limits) {
    if (labels.every((l) => Math.abs(l.v - v) >= clear)) {
      labels.push({ v, text: greyText(v), limit: true });
    }
  }
  const ys = niceTicks(lo, hi, height / 36);
  for (const v of ys.ticks) {
    if (limits.every((l) => Math.abs(l - v) >= clear)) {
      labels.push({ v, text: v.toFixed(ys.digits), limit: false });
    }
  }
  let width = 0;
  for (const l of labels) {
    g.font = l.limit ? `600 ${LABEL_FONT}` : LABEL_FONT;
    width = Math.max(width, g.measureText(l.text).width);
  }
  g.font = LABEL_FONT;
  return { labels, width };
}

/**
 * A profile plot on ``g``, ``w`` x ``h`` CSS pixels: the mean along the line, its spread across the
 * band shaded, 0 and the full scale of the image's values as solid lines, so that the values
 * clipped at either end show, the contours that cross the line as dashed verticals (those selected
 * thicker), the cursor (0 to 1 along the line, or null) and a title above (or null).  Returns where
 * the axes lie, for the cursor and the markers.
 * @param {CanvasRenderingContext2D} g
 * @param {number} w
 * @param {number} h
 * @param {ProfileData|null} data
 * @param {{cursor: number|null, title: TextParts|null}} how
 * @returns {{left: number, right: number, top: number, bottom: number}}
 */
function plotProfile(g, w, h, data, how) {
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, w, h);
  const top = how.title === null ? 10 : 34;
  if (how.title !== null) {
    g.fillStyle = "#272727";
    g.textAlign = "left";
    g.textBaseline = "top";
    let x = 12;
    for (const part of how.title) {                 // a file name in the monospace font
      g.font = `600 ${typeof part === "string" ? LABEL_FONT : FILE_FONT}`;
      const text = typeof part === "string" ? part : part.file;
      g.fillText(text, x, 10);
      x += g.measureText(text).width;
    }
  }
  g.font = LABEL_FONT;
  const length = data === null ? NaN : data.geometry.length;
  if (data === null || !(length > 0)) {
    g.fillStyle = "#6f6f6f";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(data === null ? "no profile selected" : "no length: check the tilt correction", w / 2, h / 2);
    return { left: 0, right: 1, top: 0, bottom: 0 };
  }
  const { profile, crossings, geometry } = data;
  const wide = geometry.offsets.length > 1;
  // the values with their spread, 0 and the full scale, whatever the values: a profile clipped at
  // either end runs along a line
  const full = app.image === null ? NaN : fullScale(app.image.sampleType, app.image.bitsPerSample, app.hist?.max ?? NaN);
  const limits = [0, full].filter(Number.isFinite);
  let lo = Math.min(...limits);
  let hi = Math.max(...limits);
  profile.mean.forEach((m, i) => {
    if (profile.count[i] > 0) {
      const s = wide ? profile.spread[i] : 0;
      lo = Math.min(lo, m - s);
      hi = Math.max(hi, m + s);
    }
  });
  if (!(hi > lo)) {
    hi = lo + 1;
  }
  const pad = 0.05 * (hi - lo);
  [lo, hi] = [lo - pad, hi + pad];
  const bottom = h - 30;
  const ys = yAxisLabels(g, { lo, hi, limits }, bottom - top);
  const [left, right] = [Math.max(58, Math.ceil(ys.width) + 12), w - 12];   // wide enough for the labels
  /** @param {number} s @returns {number} */
  const X = (s) => left + (s / length) * (right - left);
  /** @param {number} v @returns {number} */
  const Y = (v) => bottom - ((v - lo) / (hi - lo)) * (bottom - top);
  drawPlotAxes(g, { left, right, top, bottom }, { length, lo, hi, unit: geometry.unit, limits, labels: ys.labels });
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
  const checked = new Set(app.checked);
  drawPlotCrossings(g, crossings.map((c) => ({
    x: X(c.distance), name: c.name, color: colorOf(app.measurements[c.index]), active: checked.has(c.index),
  })), top, bottom);
  const [ma, mb] = data.markers;
  drawPlotMarkers(g, data.markers.map((m) => ({ x: left + m.t * (right - left), label: m.label })), top, bottom,
    mb === undefined ? null : profileDistanceText(Math.abs(mb.distance - ma.distance), geometry.unit));
  if (how.cursor !== null) {
    const x = X(how.cursor * length);
    g.strokeStyle = PREVIEW_COLOR;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x, top);
    g.lineTo(x, bottom);
    g.stroke();
    const i = Math.round(how.cursor * (profile.mean.length - 1));
    if (profile.count[i] > 0) {
      g.beginPath();
      g.arc(x, Y(profile.mean[i]), 3.5, 0, 2 * Math.PI);
      g.stroke();
    }
  }
  return { left, right, top, bottom };
}

/**
 * The plot's frame, ticks and labels, and the solid lines at 0 and the full scale.
 * @param {CanvasRenderingContext2D} g
 * @param {{left: number, right: number, top: number, bottom: number}} box
 * @param {{length: number, lo: number, hi: number, unit: "um"|"px"|null, limits: number[],
 *          labels: Array<{v: number, text: string, limit: boolean}>}} range
 */
function drawPlotAxes(g, box, range) {
  const { left, right, top, bottom } = box;
  g.strokeStyle = "#d4d4d0";
  g.lineWidth = 1;
  g.strokeRect(left, top, right - left, bottom - top);
  /** @param {number} v @returns {number} */
  const Y = (v) => bottom - ((v - range.lo) / (range.hi - range.lo)) * (bottom - top);
  g.strokeStyle = "#8c8c8c";                         // darker than the frame, under the profile
  g.beginPath();
  for (const v of range.limits) {
    const y = Math.round(Y(v)) + 0.5;                // on whole pixels: sharp
    g.moveTo(left, y);
    g.lineTo(right, y);
  }
  g.stroke();
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
  g.textBaseline = "middle";
  for (const l of range.labels) {
    const y = l.limit ? Math.round(Y(l.v)) + 0.5 : Y(l.v);
    g.font = l.limit ? `600 ${LABEL_FONT}` : LABEL_FONT;  // the lines' labels bold and dark
    g.fillStyle = l.limit ? "#272727" : "#6f6f6f";
    g.fillRect(left - 4, l.limit ? y - 0.5 : y, 4, 1);
    g.fillText(l.text, left - 6, y);
  }
  g.font = LABEL_FONT;
}

/**
 * The contours that cross the line, as dashed verticals in their colours with their names; those
 * selected thicker.
 * @param {CanvasRenderingContext2D} g
 * @param {Array<{x: number, name: string, color: string, active: boolean}>} marks
 * @param {number} top
 * @param {number} bottom
 */
function drawPlotCrossings(g, marks, top, bottom) {
  g.save();
  g.textAlign = "left";
  g.textBaseline = "top";
  marks.forEach((m, k) => {
    g.strokeStyle = m.color;
    g.lineWidth = m.active ? 2.5 : 1.5;
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
 * The markers on the plot: solid dark lines, their letters on dark chips at the foot, and between
 * A and B a double arrow with the distance.
 * @param {CanvasRenderingContext2D} g
 * @param {Array<{x: number, label: string}>} marks
 * @param {number} top
 * @param {number} bottom
 * @param {string|null} apart     the distance between A and B, when both are set
 */
function drawPlotMarkers(g, marks, top, bottom, apart) {
  g.save();
  g.strokeStyle = MARKER_COLOR;
  g.fillStyle = MARKER_COLOR;
  g.lineWidth = 1.5;
  for (const m of marks) {
    g.beginPath();
    g.moveTo(m.x, top);
    g.lineTo(m.x, bottom);
    g.stroke();
  }
  g.font = `600 ${LABEL_FONT}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  /** @param {string} text @param {number} x @param {number} y */
  const chip = (text, x, y) => {
    const w = g.measureText(text).width + 8;
    g.fillStyle = MARKER_COLOR;
    g.beginPath();
    g.roundRect(x - w / 2, y - 8, w, 16, 3);
    g.fill();
    g.fillStyle = "#ffffff";
    g.fillText(text, x, y + 0.5);
  };
  if (apart !== null && marks.length === 2) {
    const [x0, x1] = [Math.min(marks[0].x, marks[1].x), Math.max(marks[0].x, marks[1].x)];
    const y = bottom - Math.max(32, 0.1 * (bottom - top));   // clear of the chips, and of the 0 line on a tall plot
    g.beginPath();
    g.moveTo(x0, y);
    g.lineTo(x1, y);
    if (x1 - x0 > 14) {                              // the heads, pointing out to the markers
      g.moveTo(x0 + 6, y - 4);
      g.lineTo(x0, y);
      g.lineTo(x0 + 6, y + 4);
      g.moveTo(x1 - 6, y - 4);
      g.lineTo(x1, y);
      g.lineTo(x1 - 6, y + 4);
    }
    g.stroke();
    const w = g.measureText(apart).width + 8;
    chip(apart, x1 - x0 > w + 16 ? (x0 + x1) / 2 : x1 + 6 + w / 2, y);   // beside B when they are close
  }
  for (const m of marks) {
    chip(m.label, m.x, bottom - 12);
  }
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
  app.profileCursor = plotFraction(e);
  showProfileReadout();
  drawProfilePlot();
  render();
}

/**
 * @param {PointerEvent} e
 * @returns {number} where the pointer is along the line on the plot: 0 at its start, 1 at its end
 */
function plotFraction(e) {
  const r = profileCanvas.getBoundingClientRect();
  return Math.min(1, Math.max(0, (e.clientX - r.left - profilePlot.left) / (profilePlot.right - profilePlot.left)));
}

/**
 * @param {PointerEvent} e
 * @returns {number} the marker under the pointer on the plot (0: A, 1: B), -1 for none
 */
function markerUnder(e) {
  const data = profilePlot.data;
  if (data === null) {
    return -1;
  }
  const x = e.clientX - profileCanvas.getBoundingClientRect().left;
  let best = -1;
  let reach = e.pointerType === "touch" ? 14 : 6;
  data.markers.forEach((m, k) => {
    const dx = Math.abs(profilePlot.left + m.t * (profilePlot.right - profilePlot.left) - x);
    if (dx <= reach) {
      [best, reach] = [k, dx];
    }
  });
  return best;
}

/**
 * @param {Point[]} points
 * @param {number} t
 * @returns {Point} the point at the fraction t along the line from the first point to the second
 */
function pointAlong(points, t) {
  const [u1, u2] = points;
  return [u1[0] + t * (u2[0] - u1[0]), u1[1] + t * (u2[1] - u1[1])];
}

/**
 * Where a marker put at the fraction t settles (P13): at the steepest slope of the mean within 12
 * pixels of the plot, while snapping markers is on and unless ``exact`` (Alt, or the Exact latch);
 * else, or when no slope there stands out of the noise, or when the slope places the edge no better
 * than 2 samples or 2 pixels of the plot (whichever is more, about what a click is good to), at t.
 * @param {number} t
 * @param {boolean} exact
 * @returns {number}
 */
function settledFraction(t, exact) {
  const data = profilePlot.data;
  const loose = takeExact() || exact;
  if (data === null || loose || !settings.snapMarkers() || data.profile.mean.length < 3) {
    return t;
  }
  const last = data.profile.mean.length - 1;
  const perPixel = last / Math.max(1, profilePlot.right - profilePlot.left);    // samples per pixel of the plot
  const found = snapToSlope(data.profile.mean, t * last, Math.max(2, 12 * perPixel), settings.sigma(),
    settings.minContrast(), Math.max(2, 2 * perPixel));
  return found === null ? t : found.at / last;
}

/**
 * A click on the plot at the fraction t: A, then B, then the nearer of the two moves there; snapped
 * (P13) unless ``exact``.  An edit that Ctrl+Z undoes.
 * @param {number} t
 * @param {boolean} exact
 */
function placeMarker(t, exact) {
  const ms = shownProfile();
  if (ms === null || profilePlot.data === null) {
    return;
  }
  pushHistory();
  const markers = ms.markers ?? [];
  const p = pointAlong(ms.points, settledFraction(t, exact));
  if (markers.length < 2) {
    markers.push(p);
  } else {
    const [ta, tb] = markers.map((m) => markerPlace(ms.points, m, app.frame));
    markers[Math.abs(tb - t) < Math.abs(ta - t) ? 1 : 0] = p;
  }
  ms.markers = markers;
  refreshMeasurements();
  render();
}

/**
 * Move a marker of the shown profile to the fraction t as it is dragged; the plot follows.
 * @param {number} index
 * @param {number} t
 */
function moveMarker(index, t) {
  const ms = shownProfile();
  const data = profilePlot.data;
  if (ms === null || ms.markers === undefined || data === null) {
    return;
  }
  ms.markers[index] = pointAlong(ms.points, t);
  data.markers = markerReadings(ms, data.geometry, data.profile);
  showMarkerReadout();
}

/**
 * Let go of a dragged marker: it settles (P13) unless ``exact``.
 * @param {number} index
 * @param {boolean} exact
 */
function settleMarker(index, exact) {
  const ms = shownProfile();
  if (ms === null || ms.markers === undefined) {
    return;
  }
  ms.markers[index] = pointAlong(ms.points, settledFraction(markerPlace(ms.points, ms.markers[index], app.frame), exact));
  refreshMeasurements();
  render();
}

/** Clear A and B of the shown profile: an edit that Ctrl+Z undoes. */
function clearMarkers() {
  const ms = shownProfile();
  if (ms === null || ms.markers === undefined || ms.markers.length === 0) {
    return;
  }
  pushHistory();
  delete ms.markers;
  refreshMeasurements();
  render();
}

/**
 * Download the samples of a profile as a profile file: by default of the one the window shows.
 * @param {FixedMeasurement|null} [ms]
 */
function exportProfile(ms = shownProfile()) {
  const data = ms === null ? null : profileData(ms);
  if (ms === null || data === null) {
    return;
  }
  download(formatProfileFile(imageInfo(), app.frame, ms, data.profile, data.crossings), `${stem()}_${fileSafe(ms.name)}.csv`,
    "text/csv;charset=utf-8");
}

/**
 * Download the plot of a profile as a PNG image, by default of the one the window shows: 1200 x 750
 * CSS pixels at twice that resolution, titled with the image, the profile, its length and band.
 * @param {FixedMeasurement|null} [ms]
 */
function exportProfilePng(ms = shownProfile()) {
  const data = ms === null ? null : profileData(ms);
  if (ms === null || data === null) {
    return;
  }
  const [w, h, scale] = [1200, 750, 2];
  const c = document.createElement("canvas");
  c.width = w * scale;
  c.height = h * scale;
  const g = /** @type {CanvasRenderingContext2D} */ (c.getContext("2d"));
  g.setTransform(scale, 0, 0, scale, 0, 0);
  const { length, width, unit } = data.geometry;
  const u = unit === null ? "" : ` ${unitText(unit)}`;
  const about = Number.isFinite(length) ? `: ${show(length)}${u} long, band ${show(width)}${u} wide` : "";
  plotProfile(g, w, h, data, { cursor: null, title: [`${ms.name} on `, app.image ? { file: app.image.name } : "no image", about] });
  const name = `${stem()}_${fileSafe(ms.name)}.png`;
  c.toBlob((blob) => {
    if (blob !== null) {
      download(blob, name, "image/png");
    }
  }, "image/png");
}

// ------------------------------------------------------------------------- squaring profiles
//
// A profile is squared to the edge it crosses (MATH.md 6.6): to the normal of a traced contour it
// crosses (the crossing nearest its middle), else of the image's strongest edge along it, whose
// direction the structure tensor gives on the stored grid (P8), (P9), carried to the corrected view
// (P7).  New profiles are squared while the option is on, unless placed with Alt or Exact or further
// off square than MAX_TURN_DEG, as an edit of their own that Ctrl+Z undoes; so is a profile whose
// end is dragged, when let go, about its other end, which stays.  E squares the profile edited,
// whatever the turn.  Either way a note beside the cursor tells, for a moment, what was done.

/**
 * The strongest edge along a line: where the edge strength (E1), sampled about a stored pixel
 * apart, peaks at or above the snapping threshold; null when it stays below.
 * @param {Point[]} points
 * @param {EdgeMap} edges
 * @returns {Point|null}
 */
function strongestEdgeAlong(points, edges) {
  const [u1, u2] = points;
  const n = Math.max(2, Math.ceil(Math.hypot(u2[0] - u1[0], u2[1] - u1[1])));
  let best = settings.minContrast() * edges.noise;
  /** @type {Point|null} */
  let at = null;
  for (let i = 0; i <= n; i++) {
    const x = u1[0] + (i / n) * (u2[0] - u1[0]);
    const y = u1[1] + (i / n) * (u2[1] - u1[1]);
    const strength = x >= 0 && y >= 0 && x <= edges.width - 1 && y <= edges.height - 1 ? edges.sample(x, y) : 0;
    if (strength >= best) {
      best = strength;
      at = [x, y];
    }
  }
  return at;
}

/**
 * What squaring a profile from u1 to u2 to the edge it crosses gives: its new points, the angle it
 * turned through and the contour it was squared to (null: the image's edge); or why it stays.
 * ``pivot`` is where it crosses the edge, or its middle.  The profile turns about that crossing, or,
 * with ``keep`` (0 or 1), about that end, which stays where it is (P11 with t = 0 or 1).
 * @param {Point[]} points
 * @param {number|null} [keep]
 * @returns {{points: Point[], turnedDeg: number, to: string|null, pivot: Point}|{reason: string, pivot: Point}}
 */
function squareProfile(points, keep = null) {
  const [u1, u2] = points;
  /** @param {number} t @returns {Point} */
  const along = (t) => [u1[0] + t * (u2[0] - u1[0]), u1[1] + t * (u2[1] - u1[1])];
  /** @param {Point} pivot @param {Point} normal @returns {{points: Point[], turnedDeg: number}} */
  const turn = (pivot, normal) => {
    if (keep === null) {
      return squaredProfile(points, pivot, normal, app.frame);
    }
    const turned = squaredProfile(points, points[keep], normal, app.frame);
    turned.points[keep] = [points[keep][0], points[keep][1]];   // to the last bit, whatever the rounding of t
    return turned;
  };
  const contours = app.measurements.flatMap((m) => (m.kind === "contour" ? [m] : []));
  const crossings = profileCrossings(points, contours);
  if (crossings.length) {
    const c = crossings.reduce((a, b) => (Math.abs(b.t - 0.5) < Math.abs(a.t - 0.5) ? b : a));
    const contour = contours[c.contour];
    const normal = segmentNormal(contour.points[c.segment], contour.points[(c.segment + 1) % contour.points.length], app.frame);
    if (normal !== null) {
      const pivot = along(c.t);
      return { ...turn(pivot, normal), to: contour.name, pivot };
    }
  }
  const edges = app.edges;
  if (edges === null) {
    return { reason: "the edge map is not ready", pivot: along(0.5) };
  }
  const pivot = strongestEdgeAlong(points, edges);
  if (pivot === null) {
    return { reason: "no edge along it reaches the snapping threshold", pivot: along(0.5) };
  }
  const found = edgeNormal(edges.structureTensor(pivot[0], pivot[1], 2 * edges.sigma), app.frame);
  if (found === null || found.coherence < MIN_COHERENCE) {
    const c = found === null ? 0 : found.coherence;
    return { reason: `the edge where it crosses has no single direction (coherence ${c.toFixed(2)})`, pivot };
  }
  return { ...turn(pivot, found.normal), to: null, pivot };
}

/**
 * Square a profile to the edge it crosses, as an edit of its own that Ctrl+Z undoes, and tell what
 * was done: in the status bar, and in a note beside ``at`` (canvas CSS pixels; null: beside the
 * place where it crosses the edge).  A profile further off square than ``maxTurnDeg`` stays as it is.
 * With ``keep`` (0 or 1), the profile turns about that end, which stays: the end not moved when
 * another was dragged.
 * @param {FixedMeasurement} ms
 * @param {Point|null} at
 * @param {number} maxTurnDeg     MAX_TURN_DEG for a new or moved profile, Infinity for E
 * @param {number|null} [keep]
 */
function squareMeasurement(ms, at, maxTurnDeg, keep = null) {
  const result = squareProfile(ms.points, keep);
  const near = at ?? storedToScreen(result.pivot[0], result.pivot[1]);
  const as = keep === null ? "as drawn" : "as dragged";
  if ("reason" in result) {
    setStatus(`${ms.name} stays ${as}: ${result.reason}.`);
    flashNote("not squared", near, false);
    return;
  }
  const turned = `${result.turnedDeg.toFixed(1)}°`;
  const to = result.to ?? "the image's edge";
  if (result.turnedDeg > maxTurnDeg) {
    setStatus(`${ms.name} stays ${as}: it is ${turned} off square to ${to}, more than the ${maxTurnDeg}° a ` +
      "profile turns by itself.  E squares it.");
    flashNote(`not squared: ${turned} off`, near, false);
    return;
  }
  pushHistory();
  ms.points = result.points;
  setStatus(`${ms.name} squared to ${to}${keep === null ? "" : ", about the end not moved"}: turned ${turned}.  ` +
    `Ctrl+Z gives it back ${as}; ${keep === null ? "Alt+click places a profile" : "Alt when letting go keeps it"} ${as}.`);
  flashNote(`⊥ ${result.to ?? "edge"}, ${turned}`, near, true);
}

/** E: square the profile edited to the edge it crosses, whatever the turn. */
function squareSelected() {
  const ms = shownProfile();
  if (ms === null) {
    setStatus("Select a profile first: E squares it to the edge it crosses.");
    return;
  }
  squareMeasurement(ms, app.cursorScreen, Infinity);
  refreshMeasurements();
  render();
}

/**
 * A note beside a point of the view (canvas CSS pixels) for FLASH_MS, fading at the end.
 * @param {string} text
 * @param {Point} at
 * @param {boolean} done      false: greyed, for what was not done
 */
function flashNote(text, at, done) {
  const running = app.flash !== null;
  app.flash = { text, at, until: performance.now() + FLASH_MS, done };
  if (!running) {
    requestAnimationFrame(animateFlash);
  }
}

function animateFlash() {
  if (app.flash === null) {
    return;
  }
  if (performance.now() >= app.flash.until) {
    app.flash = null;
  } else {
    requestAnimationFrame(animateFlash);
  }
  render();
}

/** The note of flashNote: a chip beside its point, in the preview colour (grey when nothing was done). */
function drawFlash() {
  const f = app.flash;
  const left = f === null ? 0 : f.until - performance.now();
  if (f === null || left <= 0) {
    return;
  }
  ctx.save();
  ctx.font = LABEL_FONT;
  const half = ctx.measureText(f.text).width / 2 + 5;
  ctx.globalAlpha = Math.min(1, left / 500);
  drawLabel(f.text, [f.at[0] + 16 + half, f.at[1] - 20], f.done ? PREVIEW_COLOR : "#9a9a9a", true);
  ctx.restore();
}

// ------------------------------------------------------------------------- GDS

/**
 * The export settings of the GDS dialog.
 * @returns {{cellName: string, pathWidth: number, names: boolean}}
 */
function gdsOptions() {
  const width = Number(inputEl("gds-path-width").value);
  return {
    cellName: inputEl("gds-cell").value.trim(), pathWidth: Number.isFinite(width) && width > 0 ? width : 0,
    names: inputEl("gds-names").checked,
  };
}

/**
 * The elements of a GDS file of ``contours``, points in the measurement frame (um): the closed ones
 * as boundaries and the others as paths, each on its layer, with their names when asked.
 * @param {ReturnType<typeof gdsOptions>} options
 * @param {Contour[]} contours
 * @returns {GdsElement[]}
 */
function gdsElements(options, contours) {
  /** @param {Point} p @returns {Point} */
  const um = (p) => /** @type {Point} */ (toMeasurement(app.frame, p[0], p[1]));
  /** @type {GdsElement[]} */
  const out = [];
  for (const c of contours.filter((k) => k.points.length > 0)) {
    const [layer, datatype] = c.layer ?? [1, 0];
    const points = c.points.map(um);
    out.push(c.closed && points.length >= 3 ? { kind: "boundary", layer, datatype, points }
      : { kind: "path", layer, datatype, points, width: options.pathWidth });
    if (options.names) {
      out.push({ kind: "text", layer, datatype, points: [points[0]], text: c.name });
    }
  }
  return out;
}

/**
 * The GDS file of ``contours`` (FORMAT.md), or null with a message when there are no micrometres.
 * @param {ReturnType<typeof gdsOptions>} options
 * @param {Contour[]} contours
 * @returns {{bytes: Uint8Array, skipped: string[]}|null}
 */
function gdsFile(options, contours) {
  const m = measurementMatrix(app.frame);
  if (app.image === null || m === null || m.unit !== "um") {
    window.alert("GDS export needs micrometres: set the pixel size, and a tilt correction that is defined.");
    return null;
  }
  return formatGds({
    libName: "SEM_MEASUREMENT_TOOL", cellName: options.cellName || gdsName(stem(), "TOP"),
    elements: gdsElements(options, contours), date: new Date(),
  });
}

/** What the GDS dialog writes: these contours, to a file of this name. */
const gdsTarget = {
  /** @type {Contour[]} */
  contours: [],
  name: "",
};

/**
 * Ask how to write ``contours`` as a GDS file named ``name``.
 * @param {Contour[]} contours
 * @param {string} name
 */
function openGdsDialog(contours, name) {
  if (app.image === null || contours.length === 0) {
    return;
  }
  gdsTarget.contours = contours;
  gdsTarget.name = name;
  el("gds-heading").textContent = contours.length === 1 ? `Export GDS: ${contours[0].name}` : `Export GDS: ${contours.length} contours`;
  const cell = inputEl("gds-cell");
  if (cell.dataset.image !== app.image.name) {          // a new image: name the cell after it
    cell.value = gdsName(stem(), "TOP");
    cell.dataset.image = app.image.name;
  }
  /** @type {HTMLDialogElement} */ (el("gds-dialog")).showModal();
}

function exportGds() {
  const file = gdsFile(gdsOptions(), gdsTarget.contours);
  if (file !== null) {
    download(file.bytes, gdsTarget.name, "application/octet-stream");
    if (file.skipped.length) {
      window.alert(`Left out of the GDS file:\n${file.skipped.join("\n")}`);
    }
  }
}

// ------------------------------------------------------------------------- downloads
//
// The Download button under the list offers what the selection can be saved as (FORMAT.md).  A
// contour alone: its vertices (a polygon file) or a GDS file.  A profile alone: its samples (a
// profile file) or its plot (PNG).  Another measurement alone: its row of the measurements file.
// Several: one row each, and the vertices and a GDS file of the contours among them.  Then the
// same for all the measurements.

/** @typedef {{label: string, act: () => void, disabled?: boolean}} MenuItem */

/**
 * The downloads of the selection, then (after a null, the separator) those of all the measurements.
 * @returns {Array<MenuItem|null>}
 */
function downloadItems() {
  const picked = app.checked.map((i) => app.measurements[i]);
  /** @type {Array<MenuItem|null>} */
  const items = [];
  if (picked.length === 1) {
    const ms = picked[0];
    const base = `${stem()}_${fileSafe(ms.name)}`;
    if (ms.kind === "contour") {
      const empty = ms.points.length === 0;
      items.push({ label: `${ms.name}: vertices (CSV)`, disabled: empty, act: () => exportPolygons([ms], `${base}.csv`) },
        { label: `${ms.name}: GDS...`, disabled: empty, act: () => openGdsDialog([ms], `${base}.gds`) });
    } else if (ms.kind === "profile") {
      items.push({ label: `${ms.name}: samples (CSV)`, act: () => exportProfile(ms) },
        { label: `${ms.name}: plot (PNG)`, act: () => exportProfilePng(ms) });
    } else {
      items.push({ label: `${ms.name} (CSV)`, act: () => exportMeasurements([ms], `${base}.csv`) });
    }
    items.push(null);
  } else if (picked.length > 1) {
    items.push(...downloadsOfSeveral(picked, true), null);
  }
  items.push(...downloadsOfSeveral(app.measurements, false));
  return items;
}

/**
 * The downloads of several measurements, the selected ones or all: one row each, and the vertices
 * and a GDS file of the contours among them (those with vertices).
 * @param {Measurement[]} list
 * @param {boolean} selected
 * @returns {MenuItem[]}
 */
function downloadsOfSeveral(list, selected) {
  const contours = list.flatMap((m) => (m.kind === "contour" && m.points.length > 0 ? [m] : []));
  const k = contours.length;
  const these = `${selected ? "Selected" : "All"} contours (${k})`;
  return [
    { label: selected ? `${list.length} selected: one row each (CSV)` : `All ${list.length} measurements: one row each (CSV)`,
      disabled: list.length === 0, act: () => exportMeasurements(list, `${stem()}_measurements.csv`) },
    { label: `${these}: vertices (CSV)`, disabled: k === 0, act: () => exportPolygons(contours, `${stem()}_polygons.csv`) },
    { label: `${these}: GDS...`, disabled: k === 0, act: () => openGdsDialog(contours, `${stem()}.gds`) },
  ];
}

/** Open the download menu under its button, or close it when it is open. */
function toggleDownloadMenu() {
  const menu = el("download-menu");
  if (!menu.hidden) {
    closeDownloadMenu();
    return;
  }
  menu.replaceChildren(...downloadItems().map((item) => {
    if (item === null) {
      const line = document.createElement("div");
      line.setAttribute("role", "separator");
      return line;
    }
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("role", "menuitem");
    b.textContent = item.label;
    b.disabled = item.disabled === true;
    b.addEventListener("click", () => {
      closeDownloadMenu();
      item.act();
    });
    return b;
  }));
  menu.hidden = false;
  const button = el("download");
  button.setAttribute("aria-expanded", "true");
  const at = button.getBoundingClientRect();
  const box = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(Math.min(at.left, window.innerWidth - box.width - 4), 4)}px`;
  const below = at.bottom + 4;
  menu.style.top = `${below + box.height <= window.innerHeight - 4 ? below : Math.max(at.top - box.height - 4, 4)}px`;
}

function closeDownloadMenu() {
  const menu = el("download-menu");
  const focused = menu.contains(document.activeElement);
  menu.hidden = true;
  el("download").setAttribute("aria-expanded", "false");
  if (focused) {
    el("download").focus();          // the keyboard comes back to the button
  }
}

/**
 * A double click on a measurement in the list: a profile's plot, or a contour's vertices.
 * @param {number} index
 */
function openWindowOf(index) {
  const ms = app.measurements[index];
  if (ms !== undefined && ms.kind === "profile") {
    openProfileWindow();
  } else if (ms !== undefined && ms.kind === "contour" && el("vertex-window").hidden) {
    toggleVertexWindow();
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
  if (!statusBarShown()) {
    return;
  }
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
  el("status").textContent = parts.join("    ");     // not a message: no note over the view, and not kept
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
  const hit = hitPoint(sx, sy, app.tool === "contour");
  if (hit !== null && app.tool === "contour") {
    deleteVertex(hit.index, hit.point);
  } else if (hit !== null) {
    deleteMeasurements([hit.index]);
  }
}

/**
 * Delete vertex ``vi`` of contour ``index`` (an undoable edit); that contour becomes the one edited.
 * @param {number} index
 * @param {number} vi
 */
function deleteVertex(index, vi) {
  pushHistory();
  focusMeasurement(index);
  app.measurements[index].points.splice(vi, 1);
  forgetVertex(vi);
  refreshMeasurements();
  render();
}

/**
 * Insert a vertex halfway between vertex ``vi`` of contour ``index`` and the next one (an undoable edit).
 * @param {number} index
 * @param {number} vi
 */
function insertVertexAfter(index, vi) {
  const c = app.measurements[index];
  const a = c.points[vi];
  const b = c.points[(vi + 1) % c.points.length];
  pushHistory();
  focusMeasurement(index);
  c.points.splice(vi + 1, 0, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
  app.picked = app.picked.map((k) => (k > vi ? k + 1 : k));
  refreshMeasurements();
  render();
}

/**
 * Start dragging what lies under a screen point with the current tool: a contour's vertex (contour
 * tool), or the width handle of the profile edited or another measurement's point (the other
 * tools, unless one is being placed).  What is dragged becomes the measurement edited.  Returns
 * whether a drag began.
 * @param {number} sx
 * @param {number} sy
 * @returns {boolean}
 */
function startDragAt(sx, sy) {
  if (app.tool === "pan" || app.pending !== null) {
    return false;
  }
  const contour = app.tool === "contour";
  if (!contour && hitWidthHandle(sx, sy)) {
    app.drag = { kind: "width", index: app.selected, point: 0, moved: false, before: snapshot() };
    return true;
  }
  const hit = hitPoint(sx, sy, contour);
  if (hit === null) {
    return false;
  }
  app.drag = { kind: "point", index: hit.index, point: hit.point, moved: false, before: snapshot() };
  focusMeasurement(hit.index);
  refreshMeasurements();
  render();
  return true;
}

/**
 * A click with the current tool where there is nothing to drag: a vertex of the selected contour, or
 * of a new one (inserted into the nearest segment with ``insert``), or the next point of a
 * measurement; snapped unless ``exact``.
 * @param {number} sx
 * @param {number} sy
 * @param {boolean} exact
 * @param {boolean} insert
 */
function clickAt(sx, sy, exact, insert) {
  const [x, y] = screenToStored(sx, sy);
  if (!insideImage(x, y) || app.tool === "pan") {
    return;
  }
  const loose = takeExact() || exact;
  if (app.tool === "contour") {
    addVertex(x, y, { exact: loose, insert });
  } else {
    placePoint(x, y, loose);
  }
}

/**
 * Whether the Exact latch was set; it is used up by the one point it applies to.
 * @returns {boolean}
 */
function takeExact() {
  if (!app.exactOnce) {
    return false;
  }
  app.exactOnce = false;
  render();
  return true;
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
  refreshMeasurements();
  render();
}

/**
 * Move what is dragged to stored (x, y): a point, or the band width of a profile.
 * @param {number} x
 * @param {number} y
 */
function dragTo(x, y) {
  const points = draggedPoints();
  if (app.drag !== null && !app.drag.moved) {
    pushHistory(app.drag.before);    // the drag becomes an edit with its first move
  }
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
 * Release what is dragged at stored (x, y).  A point snaps unless ``exact``; a profile's end never
 * does, but the profile is then squared about its other end while that option is on, unless
 * ``exact``.  A vertex let go without moving is selected in the vertex window (added or removed
 * with ``toggle``).
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
    // a click on a point without moving it changed nothing, and recorded nothing: redo is kept
    if (drag.kind === "point" && app.measurements[drag.index].kind === "contour") {
      pickVertex(drag.point, toggle ? "toggle" : "only");
    }
    return;
  }
  if (drag.kind === "width" || points === null) {
    refreshMeasurements();
    return;
  }
  const ms = app.measurements[drag.index];
  const asIs = takeExact() || exact;
  points[drag.point] = (asIs || ms.kind === "profile" ? null : snapTarget(x, y)) ?? [x, y];
  if (ms.kind === "profile" && settings.squareProfiles() && !asIs) {
    // a step of its own after the drag's: Ctrl+Z gives it back as dragged
    squareMeasurement(ms, storedToScreen(x, y), MAX_TURN_DEG, 1 - drag.point);
  }
  refreshMeasurements();
  render();
}

/** Give up the drag in progress: what it moved goes back where it was. */
function cancelDrag() {
  const drag = app.drag;
  if (drag === null) {
    return;
  }
  app.drag = null;
  if (drag.moved) {
    app.history.pop();
    restore(drag.before);
  }
}

/**
 * Whether a click, or the release of what is dragged, would snap now: not with no tool, nor with
 * the Exact latch set, nor for a profile's ends or its band width.
 * @returns {boolean}
 */
function snapsNow() {
  const d = app.drag;
  if (app.exactOnce) {
    return false;
  }
  if (d === null) {
    return app.tool !== "profile" && app.tool !== "pan";
  }
  return d.kind === "point" && app.measurements[d.index].kind !== "profile";
}

/**
 * The points that a drag moves.
 * @returns {Point[]|null}
 */
function draggedPoints() {
  const d = app.drag;
  return d === null || d.kind === "width" ? null : app.measurements[d.index].points;
}

// ------------------------------------------------------------------------- touch tools
//
// For a touch screen: a toolbar on the view for what a keyboard or a right button does otherwise
// (undo, a point being placed included, redo, fit, snapping, one exact point), larger targets for a finger, and a
// press and hold on a point for its menu.  The touch layout comes with a touch screen, or with the
// first touch.

/** The touch layout: larger window bars, buttons and handles, and the touch toolbar. */
function enterTouchLayout() {
  if (!document.body.classList.contains("touch")) {
    document.body.classList.add("touch");
    el("touch-bar").hidden = false;
    refreshTouchBar();
  }
}

/**
 * Note what pressed or hovers on the view: a finger takes larger targets and snap reach.
 * @param {PointerEvent} e
 */
function notePointer(e) {
  const type = e.pointerType === "touch" ? "touch" : e.pointerType === "pen" ? "pen" : "mouse";
  if (type !== app.lastPointer) {
    app.lastPointer = type;
    render();
  }
}

/**
 * Set a toolbar button's state, touching the page only when it changes.
 * @param {string} id
 * @param {boolean} disabled
 * @param {boolean|null} pressed    null: not a toggle
 */
function setBarButton(id, disabled, pressed) {
  const b = buttonEl(id);
  if (b.disabled !== disabled) {
    b.disabled = disabled;
  }
  if (pressed !== null && b.getAttribute("aria-pressed") !== String(pressed)) {
    b.setAttribute("aria-pressed", String(pressed));
  }
}

/** The toolbar's buttons, from the state: what can be undone (a point being placed included), redone, snapped. */
function refreshTouchBar() {
  if (el("touch-bar").hidden) {
    return;
  }
  setBarButton("touch-undo", app.history.length === 0 && app.pending === null, null);
  setBarButton("touch-redo", app.future.length === 0, null);
  setBarButton("touch-fit", app.image === null, null);
  setBarButton("touch-snap", false, settings.snap());
  setBarButton("touch-exact", app.tool === "pan", app.exactOnce);
}

/**
 * A finger came down where a press and hold may open a menu: start the clock (and the ring).
 * @param {number} id
 * @param {Point} p
 */
function startHold(id, p) {
  cancelHold();
  app.hold = { id, start: p, t0: performance.now(), timer: window.setTimeout(holdFired, HOLD_MS) };
  requestAnimationFrame(animateHold);
}

function cancelHold() {
  if (app.hold !== null) {
    window.clearTimeout(app.hold.timer);
    app.hold = null;
    render();
  }
}

function animateHold() {
  if (app.hold !== null) {
    render();
    requestAnimationFrame(animateHold);
  }
}

/**
 * The ring that fills while a finger is held still, from a quarter of the time on, so that a
 * quick tap shows nothing.
 */
function drawHoldRing() {
  const h = app.hold;
  if (h === null) {
    return;
  }
  const t = (performance.now() - h.t0) / HOLD_MS;
  if (t < 0.25) {
    return;
  }
  ctx.save();
  ctx.strokeStyle = PREVIEW_COLOR;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(h.start[0], h.start[1], 30, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * Math.min(1, t));
  ctx.stroke();
  ctx.restore();
}

/**
 * The finger was held still long enough.  On a point it opens that point's menu, and the drag the
 * finger had begun is given up; elsewhere nothing happens.  Either way its lift does nothing.
 */
function holdFired() {
  const h = app.hold;
  app.hold = null;
  const g = app.gesture;
  if (h === null || g === null || !(g.kind === "tap" || g.kind === "drag") || g.id !== h.id) {
    render();
    return;
  }
  const target = app.drag === null ? null : { kind: app.drag.kind, index: app.drag.index, point: app.drag.point };
  cancelDrag();
  app.gesture = { kind: "held", id: h.id };
  app.preview = null;
  if (target !== null) {
    openHoldMenu(holdMenuItems(target), h.start);
  }
  render();
}

/**
 * The actions for the point a finger was held on: for a contour's vertex, the vertex's, then for any
 * measurement its own.
 * @param {{kind: "point"|"width", index: number, point: number}} target
 * @returns {Array<{label: string, act: () => void, disabled?: boolean}>}
 */
function holdMenuItems(target) {
  const ms = app.measurements[target.index];
  /** @param {() => void} then @returns {() => void} */
  const focusThen = (then) => () => {
    focusMeasurement(target.index);
    refreshMeasurements();
    render();
    then();
  };
  /** @type {Array<{label: string, act: () => void, disabled?: boolean}>} */
  const items = [];
  if (ms.kind === "contour" && target.kind === "point") {
    const i = target.point;
    const last = ms.closed && ms.points.length > 2 ? Infinity : ms.points.length - 1;
    items.push({ label: "Delete vertex", act: () => deleteVertex(target.index, i) },
      {
        label: "Select in the vertex window", act: focusThen(() => {
          pickVertex(i, "only");
          if (el("vertex-window").hidden) {
            toggleVertexWindow();
          }
        }),
      },
      { label: "Insert a vertex after", disabled: i >= last, act: () => insertVertexAfter(target.index, i) });
  }
  items.push({ label: `Delete ${ms.name}`, act: () => deleteMeasurements([target.index]) },
    { label: "Rename...", act: () => renameMeasurement(target.index) });
  if (ms.kind === "profile") {
    items.push({ label: "Show the plot", act: focusThen(() => openProfileWindow()) },
      { label: "Square to edge", act: focusThen(() => squareSelected()) });
  }
  return items;
}

/**
 * Show a menu beside a point of the view (not under the finger), kept inside the view.
 * @param {Array<{label: string, act: () => void, disabled?: boolean}>} items
 * @param {Point} at     canvas CSS pixels
 */
function openHoldMenu(items, at) {
  const menu = el("hold-menu");
  menu.replaceChildren(...items.map((item) => {
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("role", "menuitem");
    b.textContent = item.label;
    b.disabled = item.disabled === true;
    b.addEventListener("click", () => {
      closeHoldMenu();
      item.act();
    });
    return b;
  }));
  menu.hidden = false;
  const area = el("view-wrap").getBoundingClientRect();
  const box = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(Math.min(at[0] + 28, area.width - box.width - 4), 4)}px`;
  menu.style.top = `${Math.max(Math.min(at[1] - box.height - 12, area.height - box.height - 4), 4)}px`;
}

function closeHoldMenu() {
  el("hold-menu").hidden = true;
}

/**
 * Let a floating window be resized from its lower right corner by any pointer, a finger included:
 * the browser's own resize corner answers the mouse only.
 * @param {HTMLElement} win
 */
function resizableWindow(win) {
  const grip = document.createElement("div");
  grip.className = "grip";
  grip.setAttribute("aria-hidden", "true");
  win.append(grip);
  /** @type {{x: number, y: number, w: number, h: number}|null} */
  let start = null;
  grip.addEventListener("pointerdown", (e) => {
    const area = windowArea();
    const box = win.getBoundingClientRect();
    win.style.left = `${box.left - area.left}px`;            // anchored at its top left while it grows
    win.style.top = `${box.top - area.top}px`;
    win.style.right = "auto";
    win.style.bottom = "auto";
    start = { x: e.clientX, y: e.clientY, w: box.width, h: box.height };
    try {
      grip.setPointerCapture(e.pointerId);
    } catch {
      // a scripted pointer cannot be captured
    }
    e.preventDefault();
  });
  grip.addEventListener("pointermove", (e) => {
    if (start === null) {
      return;
    }
    const area = windowArea();
    const box = win.getBoundingClientRect();
    const style = window.getComputedStyle(win);
    const w = Math.min(Math.max(start.w + e.clientX - start.x, parseFloat(style.minWidth) || 200), area.right - box.left - 4);
    const h = Math.min(Math.max(start.h + e.clientY - start.y, parseFloat(style.minHeight) || 150), area.bottom - box.top - 4);
    win.style.width = `${w}px`;
    win.style.height = `${h}px`;
  });
  grip.addEventListener("pointerup", () => {
    start = null;
  });
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
    if (app.tool !== "pan" && !app.originMode) {
      startHold(e.pointerId, p);     // held still, it opens the menu of the point under it
    }
  } else if (touches.size === 2) {
    cancelHold();
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
  const h = app.hold;
  if (h !== null && h.id === e.pointerId && Math.hypot(p[0] - h.start[0], p[1] - h.start[1]) > TAP_PX) {
    cancelHold();                    // it moves: no press and hold
  }
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
  if (app.hold !== null && app.hold.id === e.pointerId) {
    cancelHold();
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
  notePointer(e);
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
  notePointer(e);                    // a mouse or pen hovering after touch takes its own, finer hit radius
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
  closeDownloadMenu();
  keepWindowsInView();
  render();
  drawHistogram();
});

/**
 * The area the floating windows may take: the whole page, the panel included (they are fixed to the
 * page, and open over the view).
 * @returns {{left: number, top: number, width: number, height: number, right: number, bottom: number}}
 */
function windowArea() {
  const { clientWidth: width, clientHeight: height } = document.documentElement;
  return { left: 0, top: 0, width, height, right: width, bottom: height };
}

/**
 * Keep the floating windows inside the page, e.g. after the browser window shrank, or when one opens on a page too
 * narrow for it beside the panel: their bars stay in reach.  A window inside is left alone, so that one never moved
 * keeps the place the page gives it.
 */
function keepWindowsInView() {
  const area = windowArea();
  for (const id of ["vertex-window", "profile-window", "colour-window"]) {
    const win = el(id);
    if (win.hidden) {
      continue;
    }
    const box = win.getBoundingClientRect();
    const left = Math.min(Math.max(box.left - area.left, 0), Math.max(area.width - box.width, 0));
    const top = Math.min(Math.max(box.top - area.top, 0), Math.max(area.height - box.height, 0));
    if (left !== box.left - area.left || top !== box.top - area.top) {
      win.style.left = `${left}px`;
      win.style.top = `${top}px`;
      win.style.right = "auto";
      win.style.bottom = "auto";
    }
  }
}

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
 * selected contour's last vertex (contour tool) or the selected measurements.
 */
function backspace() {
  if (app.pending !== null) {
    dropPendingPoint();
  } else if (app.picked.length) {
    dropPicked();
  } else if (app.tool === "contour") {
    deleteLastVertex();
  } else {
    deleteMeasurements(app.checked);
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
  6: () => setTool("gap"),
  p: () => toggleProfileWindow(),
  e: () => squareSelected(),
  n: () => finishContour(),
  c: () => setClosed(!(currentContour()?.closed ?? false)),
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
      deleteMeasurements(app.checked);
    }
  },
  Escape: () => {
    app.pending = null;
    app.originMode = false;
    closeHoldMenu();
    closeDownloadMenu();
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
  const outsideFields = { z: () => (e.shiftKey ? redo() : undo()), y: () => redo(), a: () => checkAll() };
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
  if (/** @type {HTMLDialogElement} */ (el("gds-dialog")).open) {
    return;                          // the dialog has the keys; Esc closes it
  }
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
/**
 * Whether a drag carries files.
 * @param {DragEvent} e
 * @returns {boolean}
 */
function dragsFiles(e) {
  return e.dataTransfer !== null && [...e.dataTransfer.types].includes("Files");
}
wrap.addEventListener("dragover", (e) => {
  if (dragsFiles(e)) {
    wrap.classList.add("dragover");
  }
});
wrap.addEventListener("dragleave", () => wrap.classList.remove("dragover"));
// a file dropped anywhere on the page opens as on the view: the browser would show it in place of the app
window.addEventListener("dragover", (e) => {
  if (dragsFiles(e)) {
    e.preventDefault();
  }
});
window.addEventListener("drop", (e) => {
  if (!dragsFiles(e)) {
    return;
  }
  e.preventDefault();
  wrap.classList.remove("dragover");
  const files = e.dataTransfer ? [...e.dataTransfer.files] : [];
  if (files.length) {
    openFiles(files);
  }
});

el("open-image").addEventListener("click", () => inputEl("image-file").click());
el("open-session").addEventListener("click", () => inputEl("session-file").click());
el("save-session").addEventListener("click", () => saveSession());
for (const id of ["image-file", "session-file"]) {
  inputEl(id).addEventListener("change", () => {
    const input = inputEl(id);
    const files = input.files ? [...input.files] : [];
    if (files.length) {
      openFiles(files);
    }
    input.value = "";
  });
}
for (const tool of TOOLS) {
  // a click on the active tool puts it down: no tool
  el(`tool-${tool}`).addEventListener("click", () => setTool(app.tool === tool ? "pan" : tool));
}
el("new-contour").addEventListener("click", () => finishContour());
inputEl("closed").addEventListener("change", () => setClosed(inputEl("closed").checked));
/** The last plain click on a row of the measurement list: two on one row within DOUBLE_MS make a double click. */
let listClick = { index: -1, time: -Infinity };
el("measurement-list").addEventListener("click", (e) => {
  // a click, which a tap is as well: on the box, or with Ctrl, it adds the row to the selection or
  // takes it out; with Shift it selects from the row clicked last; else it selects the row alone,
  // and a second one soon after opens its window (timed here: a double tap does not always send dblclick)
  const row = e.target instanceof Element ? e.target.closest(".item") : null;
  const index = row === null ? -1 : [...el("measurement-list").children].indexOf(row);
  if (index < 0) {
    return;
  }
  const toggle = (e.target instanceof Element && e.target.closest(".box") !== null) || e.ctrlKey || e.metaKey;
  const now = performance.now();
  const second = !toggle && !e.shiftKey && index === listClick.index && now - listClick.time < DOUBLE_MS;
  listClick = second || toggle || e.shiftKey ? { index: -1, time: -Infinity } : { index, time: now };
  if (toggle) {
    toggleChecked(index);
  } else if (e.shiftKey) {
    checkRange(index);
  } else {
    selectOnly(index);
  }
  refreshMeasurements();
  render();
  if (second) {
    openWindowOf(index);
  }
});
el("measurement-list").addEventListener("keydown", (e) => {
  // the keyboard in the list: arrows, Home and End select a row alone, Enter opens its window
  const n = app.measurements.length;
  const at = app.selected >= 0 ? app.selected : app.checked.length ? app.checked[0] : -1;
  /** @type {Record<string, number>} */
  const moves = { ArrowUp: at < 0 ? n - 1 : Math.max(at - 1, 0), ArrowDown: at < 0 ? 0 : Math.min(at + 1, n - 1), Home: 0, End: n - 1 };
  const plain = !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;
  if (n > 0 && plain && moves[e.key] !== undefined) {
    selectOnly(moves[e.key]);
    refreshMeasurements();
    render();
    el("measurement-list").children[moves[e.key]].scrollIntoView({ block: "nearest" });
  } else if (plain && e.key === "Enter" && at >= 0) {
    openWindowOf(at);
  } else {
    return;                          // other keys are the page's (Delete, Ctrl+A, the tools)
  }
  e.preventDefault();
  e.stopPropagation();
});
el("download").addEventListener("click", (e) => {
  toggleDownloadMenu();
  const first = el("download-menu").querySelector("button:enabled");
  if (e.detail === 0 && first instanceof HTMLButtonElement) {
    first.focus();                   // opened from the keyboard: the arrows go through the menu
  }
});
el("download-menu").addEventListener("keydown", (e) => {
  const items = [...el("download-menu").querySelectorAll("button:enabled")];
  const at = items.findIndex((b) => b === document.activeElement);
  const step = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
  if (step !== 0 && items.length) {
    e.preventDefault();
    e.stopPropagation();
    const next = at < 0 ? (step > 0 ? 0 : items.length - 1) : (at + step + items.length) % items.length;
    /** @type {HTMLElement} */ (items[next]).focus();
  }
});
el("panel").addEventListener("scroll", () => closeDownloadMenu());
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
selectEl("palette").addEventListener("change", () => setPalette(selectEl("palette").value));
el("open-colours").addEventListener("click", () => toggleColourWindow());
el("colour-close").addEventListener("click", () => toggleColourWindow());
el("colours-from-matlab").addEventListener("click", () => {
  colours.custom = [...PALETTES.matlab];
  refreshColourWindow();
  setPalette("custom");
});
el("colours-from-okabe-ito").addEventListener("click", () => {
  colours.custom = [...PALETTES["okabe-ito"]];
  refreshColourWindow();
  setPalette("custom");
});
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
/** The last plain click on a coordinate of the vertex window: two on one within DOUBLE_MS edit it. */
let cellClick = { key: "", time: -Infinity };
el("vertex-rows").addEventListener("click", (e) => {
  // a click picks the vertex, and a second one on the same X or Y soon after edits it: timed here, as a
  // double tap does not always send dblclick, and the rows are drawn anew on each pick
  if (e.target instanceof HTMLInputElement) {
    return;                          // a click within the value being edited
  }
  const cell = e.target instanceof Element ? e.target.closest("td") : null;
  const row = cell === null ? null : cell.closest("tr");
  if (!(row instanceof HTMLTableRowElement) || row.dataset.i === undefined || cell === null) {
    return;
  }
  const i = Number(row.dataset.i);
  const axis = e.shiftKey || e.ctrlKey || e.metaKey ? undefined : cell.dataset.axis;
  const key = axis === undefined ? "" : `${i} ${axis}`;
  const now = performance.now();
  const second = key !== "" && key === cellClick.key && now - cellClick.time < DOUBLE_MS;
  cellClick = second ? { key: "", time: -Infinity } : { key, time: now };
  pickVertex(i, e.shiftKey ? "range" : e.ctrlKey || e.metaKey ? "toggle" : "only");
  const fresh = second ? el("vertex-rows").querySelector(`tr[data-i="${i}"] td[data-axis="${axis}"]`) : null;
  if (fresh instanceof HTMLTableCellElement) {
    editCoordinate(fresh);
  }
});
/**
 * Let a floating window be moved by its title bar, anywhere on the page: over the panel too.
 * @param {HTMLElement} win
 * @param {HTMLElement} bar
 */
function movableWindow(win, bar) {
  /** @type {{dx: number, dy: number}|null} */
  let drag = null;
  bar.addEventListener("pointerdown", (e) => {
    if (e.target instanceof Element && e.target.closest("button, input") !== null) {
      return;                        // a press on a control of the bar (its close cross included), not on the bar
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
    const area = windowArea();
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
movableWindow(el("colour-window"), el("colour-bar"));
resizableWindow(el("vertex-window"));
resizableWindow(el("profile-window"));
el("touch-undo").addEventListener("click", () => undo());
el("touch-redo").addEventListener("click", () => redo());
el("touch-fit").addEventListener("click", () => fit());
el("touch-snap").addEventListener("click", () => {
  toggleCheckbox("snap");
  snapToggled();
  render();
});
el("touch-exact").addEventListener("click", () => {
  app.exactOnce = !app.exactOnce;
  app.preview = null;
  render();
});
window.addEventListener("pointerdown", (e) => {
  if (e.pointerType === "touch") {
    enterTouchLayout();              // the first touch brings the touch layout
  }
  const menu = el("hold-menu");
  if (!menu.hidden && !(e.target instanceof Node && menu.contains(e.target))) {
    closeHoldMenu();                 // a press anywhere else closes the menu
  }
  const downloads = el("download-menu");
  const inside = e.target instanceof Node && (downloads.contains(e.target) || el("download").contains(e.target));
  if (!downloads.hidden && !inside) {
    closeDownloadMenu();             // and the download menu, but for its own button, which closes it itself
  }
}, true);
if (window.matchMedia("(any-pointer: coarse)").matches) {
  enterTouchLayout();                // a touch screen: the touch layout from the start
}
inputEl("show-status").addEventListener("change", () => showStatusBar(inputEl("show-status").checked));
{
  let shown = false;                 // hidden unless the browser kept "on"
  try {
    shown = localStorage.getItem(STATUS_KEY) === "on";
  } catch {
    // storage refused: hidden
  }
  showStatusBar(shown, false);
}
el("profile-close").addEventListener("click", () => toggleProfileWindow());
el("profile-export").addEventListener("click", () => exportProfile());
el("profile-png").addEventListener("click", () => exportProfilePng());
el("profile-square").addEventListener("click", () => squareSelected());
el("clear-markers").addEventListener("click", () => clearMarkers());
inputEl("square-profiles").addEventListener("change", () => refreshEdges());
inputEl("profile-width").addEventListener("change", () => setProfileWidth(Number(inputEl("profile-width").value) / unitsPerView()));
// On the plot a press of the main button within the axes on a marker drags it; any other press
// there is a click, which places a marker, until it moves more than 4 pixels and only reads values
// along the plot.  A press on the labels around the axes, or of another button, places nothing.
profileCanvas.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) {
    return;
  }
  try {
    profileCanvas.setPointerCapture(e.pointerId);    // a finger can slide along the plot, and off it
  } catch {
    // a scripted pointer cannot be captured
  }
  const r = profileCanvas.getBoundingClientRect();
  const [x, y] = [e.clientX - r.left, e.clientY - r.top];
  const within = x >= profilePlot.left && x <= profilePlot.right && y >= profilePlot.top && y <= profilePlot.bottom;
  const hit = within ? markerUnder(e) : -1;
  if (hit >= 0) {
    profilePlot.markerDrag = { index: hit, moved: false, before: snapshot() };
  } else if (within) {
    profilePlot.press = { x: e.clientX, y: e.clientY };
  }
  profilePlotPointer(e);
});
profileCanvas.addEventListener("pointermove", (e) => {
  const { markerDrag: drag, press } = profilePlot;
  if (drag !== null) {
    if (!drag.moved) {
      pushHistory(drag.before);      // the drag becomes an edit with its first move
    }
    moveMarker(drag.index, plotFraction(e));
    drag.moved = true;
  } else if (press !== null && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 4) {
    profilePlot.press = null;
  }
  profilePlotPointer(e);
});
profileCanvas.addEventListener("pointerup", (e) => {
  const { markerDrag: drag, press } = profilePlot;
  profilePlot.markerDrag = null;
  profilePlot.press = null;
  if (drag !== null && drag.moved) {               // a press without moving changed nothing, and recorded nothing
    settleMarker(drag.index, e.altKey);
  } else if (press !== null) {
    placeMarker(plotFraction(e), e.altKey);
  }
});
profileCanvas.addEventListener("pointercancel", () => {
  const drag = profilePlot.markerDrag;
  profilePlot.press = null;
  profilePlot.markerDrag = null;
  if (drag !== null && drag.moved) {               // the marker goes back where it was
    app.history.pop();
    restore(drag.before);
    refreshMeasurements();
    render();
  }
});
profileCanvas.addEventListener("pointerleave", (e) => {
  if (e.pointerType === "touch") {
    return;                          // a lifted finger leaves its reading in place
  }
  app.profileCursor = null;
  showProfileReadout();
  drawProfilePlot();
  render();
});
new ResizeObserver(() => drawProfilePlot()).observe(profileCanvas);
el("rename-measurement").addEventListener("click", () => renameMeasurement());
el("delete-measurement").addEventListener("click", () => deleteMeasurements(app.checked));
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
const rotationSlider = inputEl("rotation-slider");
rotationSlider.addEventListener("input", () => rotateView(Number(rotationSlider.value)));
rotationSlider.addEventListener("change", () => rotationDone());
rotationSlider.addEventListener("keydown", (e) => {
  /** @type {Record<string, number>} */
  const steps = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 };
  if (e.shiftKey && e.key in steps) {                // 1 degree a step; the arrow keys alone step 0.1
    e.preventDefault();
    rotateView(Math.min(180, Math.max(-180, Number(rotationSlider.value) + steps[e.key])));
    rotationDone();
  }
});
// The step buttons: a press turns by the step at once, and held, after 450 ms, 20 steps a second;
// either ends as one undoable edit.  Enter or Space on a focused button turns once.
for (const [id, step] of /** @type {Array<[string, number]>} */ ([["turn-cw-1", -1], ["turn-cw-01", -0.1],
  ["turn-ccw-01", 0.1], ["turn-ccw-1", 1]])) {
  const button = buttonEl(id);
  let repeat = 0;
  const turn = () => rotateView(app.frame.rotationDeg + step);
  const stop = () => {
    if (repeat !== 0) {
      clearTimeout(repeat);
      repeat = 0;
      rotationDone();
    }
  };
  button.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) {
      return;
    }
    e.preventDefault();                              // no focus change and no selection: a finger's press stays a press
    try {
      button.setPointerCapture(e.pointerId);
    } catch {
      // a scripted pointer cannot be captured
    }
    turn();
    /** @param {number} delay */
    const again = (delay) => {
      repeat = window.setTimeout(() => {
        turn();
        again(50);
      }, delay);
    };
    again(450);
  });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
    button.addEventListener(type, stop);
  }
  button.addEventListener("contextmenu", (e) => e.preventDefault());   // a long press keeps turning, no menu
  button.addEventListener("click", (e) => {
    if (e.detail === 0) {                            // from the keyboard; a pointer's click has turned already
      turn();
      rotationDone();
    }
  });
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
    refreshMeasurements();
    render();
  }
});

loadColours();
selectEl("palette").value = colours.palette;
refreshFrameInputs();
refreshMeasurements();
refreshDisplay();
setTool("pan");                     // the app opens with no tool: the view pans and zooms

/** The page's state and actions, for scripts that drive it (tests, automation). */
Object.assign(window, {
  semMeasurementTool: {
    state: app, openImageBuffer, openFiles, loadPolygonText, loadSessionText, polygonText, measurementText, sessionText,
    addVertex, finishContour, undo, redo, fit, frameInputsChanged, refreshEdges, storedToScreen, screenToStored,
    snapTarget, setTool, placePoint, levelSelected, axisFromSelected, draw, insertTarget, pickVertex, movePicked,
    dropPicked, makePickedFirst, reversePicked, setVertexCoordinate, zoomToPicked, toggleVertexWindow, gdsElements,
    gdsFile, setLevels, brightnessMoved, contrastMoved, drawHistogram, paintPicture, toggleProfileWindow,
    refreshProfileWindow, shownProfile, profileData, profileMean, setProfileWidth, exportProfile, exportProfilePng,
    profilePlot, selectOnly, toggleChecked, checkRange, checkAll, deleteMeasurements, downloadItems, refreshMeasurements,
    squareProfile, squareSelected,
  },
});
