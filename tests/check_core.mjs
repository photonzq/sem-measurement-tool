// Tests of the app's core, in Node: the page's scripts run in one context, as in the browser.
//
//     node tests/check_core.mjs [FEI folder] [Zeiss TIFF ...]
//
// 1. Files.  The test images come from the command line, or else from tests/local_data.json, which
//    git ignores: copy tests/local_data.example.json and name your own files.  Every TIFF of the
//    FEI folder and every Zeiss file is decoded: vendor, size, bits per sample and info bar must
//    agree, an electron image must have a pixel size, and the decoded values must equal the bytes
//    of the file read directly at the strip offsets.  The local file may also give each Zeiss
//    file's expected pixel size, tilt and info bar.  Without test images these checks are skipped.
// 2. Gradient: exact on a linear ramp.  Snapping: onto a noisy synthetic edge within 0.25 px, not
//    on flat noise, and with the search radius measured through the view metric (E7).
// 3. Geometry (transform.js): correction factors, the map (G8) and its inverse, the tilt axis
//    (G7), the rigid rotation, angles and line crossings, levelling (G13), the tilt axis along a
//    line (G14), contour measures.
// 4. Files: the polygon file (round trip, frame restored, micrometres back to pixels, bad files
//    refused), the measurements file, the session file (round trip, GDS layers, bad files refused).
// 5. GDSII (gds.js): the eight-byte reals (S2) against bytes computed exactly in Python (those
//    gdstk and KLayout write for the units), random round trips, and a file read back record by
//    record, with the elements it must leave out.
// 6. The vertex window's operations (vertices.js) and the screen step of the arrow keys (G15).
// 7. The Zeiss info zone (Z1): found in the Zeiss files where the local file expects it, and on
//    synthetic images found where drawn and nowhere else.  The session keeps the display levels.
// 8. The display (display.js): the histogram's bins of whole values (D4), over 0-255 for 8-bit
//    images and over the values for 16 and 32 bits; brightness and contrast (D3) against the
//    arithmetic of ImageJ's ContrastAdjuster, transcribed here, and their round trips; the grey
//    map (D1) and the auto levels (D2).
// 9. Line profiles (profile.js): samples along a ramp exact, missing outside the image and below
//    the info bar, distances in micrometres (P2), (P4); the band a rectangle as seen in any frame,
//    its mean and spread, unchanged by a rotation (P1), (P3); contour crossings (P5); the width
//    handle; the profile file.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPTS = ["vendor/pako_inflate.min.js", "vendor/UTIF.js", "js/metadata.js", "js/tiff.js", "js/edges.js",
  "js/transform.js", "js/polygons.js", "js/session.js", "js/gds.js", "js/vertices.js", "js/display.js", "js/profile.js"];
const LOCAL_DATA = path.join(ROOT, "tests", "local_data.json");
const failures = [];

function check(ok, what) {
  console.log(`${ok ? "ok    " : "FAIL  "}${what}`);
  if (!ok) {
    failures.push(what);
  }
}

function loadApi() {
  // UTIF.js logs skipped tags (e.g. the EXIF sub-directory pointer) unless process.env says otherwise
  const context = vm.createContext({ console, TextDecoder, process: { env: { NODE_ENV: "test" } } });
  vm.runInContext("var self = globalThis; var window = globalThis;", context);
  for (const file of SCRIPTS) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), "utf-8"), context, { filename: file });
  }
  return vm.runInContext(`({ decodeSEMImage, describeCalibration, EdgeMap, gaussianKernels, correctionFactor, matMul,
    matInverse, matDet, matApply, tiltMatrix, measurementMatrix, viewMatrix, toMeasurement, fromMeasurement,
    normalizeDegrees, lineIntersection, measureContour, measureRuler, measureAngle, measureLineAngle, levelRotation,
    axisFromLine, formatPolygonFile, parsePolygonFile, frameFromMeta, formatMeasurementFile, formatSession,
    parseSession, viewStepToStored, gdsReal, gdsRealValue, gdsName, formatGds, moveSelected, dropSelected, makeFirst,
    reverseContour, selectionRange, findInfoZone, fixedSpan, histogramOf, autoLevels, greyMap, sliderBrightness,
    sliderContrast, centreOfBrightness, widthOfContrast, profileGeometry, sampleProfile, profileCrossings, widthHandle,
    widthFromPoint, formatProfileFile, UTIF })`, context);
}

const api = loadApi();

/** The bytes of a file as an ArrayBuffer of its own. */
function readBuffer(file) {
  const b = fs.readFileSync(file);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

/** Sample i of an uncompressed, single-sample image read straight from the file. */
function directSample(buffer, i) {
  const ifd = api.UTIF.decode(buffer)[0];
  const bits = ifd.t258[0];
  const offsets = ifd.t273;
  const rowsPerStrip = Math.min(ifd.t278 ? ifd.t278[0] : ifd.t257[0], ifd.t257[0]);
  const width = ifd.t256[0];
  const row = Math.floor(i / width);
  const strip = Math.floor(row / rowsPerStrip);
  const within = (row - strip * rowsPerStrip) * width + (i % width);
  const view = new DataView(buffer);
  const little = new Uint8Array(buffer, 0, 1)[0] === 0x49;
  return bits === 16 ? view.getUint16(offsets[strip] + 2 * within, little) : view.getUint8(offsets[strip] + within);
}

/**
 * The test images: from the command line, or else from tests/local_data.json (git-ignored, see
 * tests/local_data.example.json), which may also give what each Zeiss file must decode to.
 * @returns {{feiFolder: string|null, zeiss: Array<{file: string, pixel_nm?: number, tilt_deg?: number,
 *     info_bar_rows?: number, tilt_correction_on?: boolean, scan_rotation_deg?: number}>}}
 */
function testImages(args) {
  if (args.length > 0) {
    return { feiFolder: args[0], zeiss: args.slice(1).map((file) => ({ file })) };
  }
  if (!fs.existsSync(LOCAL_DATA)) {
    return { feiFolder: null, zeiss: [] };
  }
  const data = JSON.parse(fs.readFileSync(LOCAL_DATA, "utf-8"));
  return { feiFolder: data.fei_folder ?? null, zeiss: data.zeiss ?? [] };
}

function checkFei(folder) {
  if (folder === null) {
    console.log("SKIP  FEI: no folder of test images (command line or tests/local_data.json)");
    return;
  }
  const files = fs.existsSync(folder) ? fs.readdirSync(folder).filter((f) => /\.tiff?$/i.test(f)).sort() : [];
  if (files.length === 0) {
    console.log(`SKIP  FEI: no TIFF files in ${folder}`);
    return;
  }
  for (const name of files) {
    const buffer = readBuffer(path.join(folder, name));
    const image = api.decodeSEMImage(buffer, name);
    const cal = image.calibration;
    const n = image.width * image.height;
    const probes = [0, image.width - 1, Math.floor(n / 2) + 7, n - 1];
    const same = probes.every((i) => image.data[i] === directSample(buffer, i));
    const ebeam = cal.beam === "EBeam";
    const pixel = cal.pixelSizeM ? `${(cal.pixelSizeM[0] * 1e9).toFixed(4)} nm` : "none";
    const ifd = api.UTIF.decode(buffer)[0];
    const fileRows = ifd.t257[0];
    check(image.vendor === "FEI" && same && image.height === fileRows && image.imageRows === fileRows - cal.databarRows
      && image.bitsPerSample === ifd.t258[0]
      && (!ebeam || (cal.pixelSizeM !== null && cal.databarRows > 0 && cal.tiltDeg !== null)),
    `FEI ${name}: ${image.width} x ${image.height} ${image.sampleType} (${image.bitsPerSample} bits), data bar ` +
      `${cal.databarRows} rows kept ` +
      `(image rows ${image.imageRows}), pixel ${pixel}, tilt ${cal.tiltDeg === null ? "none" : cal.tiltDeg.toFixed(2)}, ` +
      `beam ${cal.beam}; values as in the file`);
  }
}

function checkZeiss(entries) {
  if (entries.length === 0) {
    console.log("SKIP  Zeiss: no test images (command line or tests/local_data.json)");
    return;
  }
  for (const want of entries) {
    if (!fs.existsSync(want.file)) {
      console.log(`SKIP  Zeiss: ${want.file} not found`);
      continue;
    }
    const buffer = readBuffer(want.file);
    const image = api.decodeSEMImage(buffer, path.basename(want.file));
    const cal = image.calibration;
    const n = image.width * image.height;
    const same = [0, image.width - 1, Math.floor(n / 2) + 3, n - 1].every((i) => image.data[i] === directSample(buffer, i));
    // what the local file says this image must decode to; each is optional
    const expected = [
      want.pixel_nm === undefined || (cal.pixelSizeM !== null && Math.abs(cal.pixelSizeM[0] * 1e9 - want.pixel_nm) < 1e-4),
      want.tilt_deg === undefined || Math.abs(cal.tiltDeg - want.tilt_deg) < 1e-9,
      want.info_bar_rows === undefined || cal.databarRows === want.info_bar_rows,
      want.tilt_correction_on === undefined || cal.tiltCorrectionOn === want.tilt_correction_on,
      want.scan_rotation_deg === undefined || cal.scanRotationDeg === want.scan_rotation_deg,
    ];
    const given = ["pixel_nm", "tilt_deg", "info_bar_rows", "tilt_correction_on", "scan_rotation_deg"].filter((k) => k in want);
    check(image.vendor === "Zeiss" && same && image.imageRows === image.height - cal.databarRows
      && image.bitsPerSample === api.UTIF.decode(buffer)[0].t258[0] && cal.pixelSizeM !== null && expected.every(Boolean),
    `Zeiss ${path.basename(want.file)}: ${image.width} x ${image.height} ${image.sampleType} (${image.bitsPerSample} bits), ` +
      `pixel ${cal.pixelSizeM ? (cal.pixelSizeM[0] * 1e9).toFixed(5) : "none"} nm, tilt ${cal.tiltDeg}, tilt correction ` +
      `${cal.tiltCorrectionOn}; info zone found from row ${image.imageRows} (${cal.databarRows} rows left out); values as ` +
      `in the file${given.length ? `; as expected: ${given.join(", ")}` : ""}`);
  }
}

/**
 * (Z1) on synthetic 8-bit images, 200 x 160, noise around 120: a Zeiss-like zone (a black line,
 * white rows with a fifth of black text, a black line, image below), the same zone reaching the
 * last row, and three images without a zone (none, a black line alone, a saturated band without
 * lines).
 */
function checkInfoZone() {
  const w = 200;
  const h = 160;
  const noise = gaussian(3);
  const image = (paint) => {
    const data = new Float32Array(w * h).map(() => Math.min(250, Math.max(0, 120 + 8 * noise())));
    paint(data);
    return data;
  };
  const row = (data, y, v) => data.fill(v, y * w, (y + 1) * w);
  const zone = (data, top, bottom) => {
    row(data, top, 0);
    for (let y = top + 1; y < bottom; y++) {
      row(data, y, 255);
      for (let x = 10 + (y % 7); x < w; x += 5) {
        data[y * w + x] = 0;              // text: a fifth of the row black
      }
    }
    if (bottom < h) {
      row(data, bottom, 0);
    }
  };
  const found = {
    framed: api.findInfoZone(image((d) => zone(d, 120, 145)), w, h),
    open: api.findInfoZone(image((d) => zone(d, 125, h)), w, h),
    none: api.findInfoZone(image(() => {}), w, h),
    line: api.findInfoZone(image((d) => row(d, 130, 0)), w, h),
    bright: api.findInfoZone(image((d) => { for (let y = 120; y < h; y++) { row(d, y, 255); } }), w, h),
  };
  check(found.framed === 120 && found.open === 125 && found.none === null && found.line === null && found.bright === null,
    `Zeiss info zone (Z1) on synthetic images: framed zone from row ${found.framed}, zone to the last row from ` +
      `${found.open}; none found without one, for a black line alone, or for a saturated band without lines`);
}

/** Uniform numbers in [0, 1) from a fixed seed (a linear congruential generator). */
function random(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Normal numbers (Box-Muller) from a fixed seed. */
function gaussian(seed) {
  const u = random(seed);
  return () => Math.sqrt(-2 * Math.log(1 - u())) * Math.cos(2 * Math.PI * u());
}

function checkEdges() {
  // On a ramp a x the derivative filter gives a sum_t t^2 g(t) / sigma^2: a itself, up to the
  // second moment that the kernel truncated at 4 sigma (as scipy's) misses.
  const w = 64;
  const h = 48;
  const sigma = 2;
  const { g, radius } = api.gaussianKernels(sigma);
  let moment = 0;
  for (let t = -radius; t <= radius; t++) {
    moment += t * t * g[t + radius];
  }
  const gain = moment / (sigma * sigma);
  const ramp = new Float32Array(w * h).map((_, i) => 3 * (i % w) + 2 * Math.floor(i / w) + 5);
  for (const median of [0, 3]) {
    const edges = new api.EdgeMap(ramp, w, h, sigma, median);
    let worst = 0;
    for (let y = 12; y < h - 12; y++) {
      for (let x = 12; x < w - 12; x++) {
        const i = y * w + x;
        worst = Math.max(worst, Math.abs(edges.gx[i] - 3 * gain), Math.abs(edges.gy[i] - 2 * gain));
      }
    }
    check(worst < 2e-5, `gradient of the ramp 3x + 2y + 5 (median ${median}): (3, 2) times the kernel's ` +
      `second moment over sigma^2, ${gain.toFixed(6)}, to ${worst.toExponential(1)}`);
  }
  const noise = gaussian(1);
  const edgeX = 60.37;
  const W = 160;
  const H = 120;
  const image = new Float32Array(W * H);
  for (let i = 0; i < image.length; i++) {
    image[i] = 100 + 400 * 0.5 * (1 + Math.tanh(((i % W) - edgeX) / 1.2)) + 20 * noise();
  }
  const edges = new api.EdgeMap(image, W, H, 2, 3);
  const hit = edges.snap(50, 61, 12, 3);
  check(hit !== null && Math.abs(hit[0] - edgeX) < 0.25 && Math.abs(hit[1] - 61) < 1.5,
    `snap from 10 px away lands on the edge at x = ${edgeX}: ${hit && hit.map((v) => v.toFixed(3))}`);
  check(edges.snap(130, 60, 12, 3) === null, "a click on flat noise does not snap");
  // (E7): with the rows counted twice (a view stretched by 2), an edge 7 px away across the rows is
  // 14 view units away, beyond a radius of 12; 4 px away it is 8 units away, within
  const rowEdge = 60.4;
  const across = new Float32Array(W * H);
  for (let i = 0; i < across.length; i++) {
    across[i] = 100 + 400 * 0.5 * (1 + Math.tanh((Math.floor(i / W) - rowEdge) / 1.2)) + 20 * noise();
  }
  const rows = new api.EdgeMap(across, W, H, 2, 3);
  const plain = rows.snap(80, rowEdge - 7, 12, 3);
  const far = rows.snap(80, rowEdge - 7, 12, 3, [1, 0, 0, 2]);
  const near = rows.snap(80, rowEdge - 4, 12, 3, [1, 0, 0, 2]);
  check(plain !== null && Math.abs(plain[1] - rowEdge) < 0.25 && far === null && near !== null
    && Math.abs(near[1] - rowEdge) < 0.25,
  `search radius through the view metric: an edge 7 px away is found (${plain && plain[1].toFixed(3)}), ` +
    `not when the rows count twice; 4 px away it is (${near && near[1].toFixed(3)})`);
}

/** The largest absolute difference between two lists of numbers. */
function worstOf(a, b) {
  return Math.max(...a.map((v, i) => Math.abs(v - b[i])));
}

const DEG = Math.PI / 180;

function checkFactors(base) {
  const k = api.correctionFactor(base);
  const surface = api.correctionFactor({ ...base, correction: "tilted-surface" });
  const none = api.correctionFactor({ ...base, correction: "none" });
  const custom = api.correctionFactor({ ...base, correction: "custom", customFactor: 1.5 });
  let refused = 0;
  for (const bad of [{ correction: "cross-section", tiltDeg: 0 }, { correction: "tilted-surface", tiltDeg: 90 },
    { correction: "custom", customFactor: -1 }, { correction: "sideways" }]) {
    try {
      api.correctionFactor({ ...base, ...bad });
    } catch {
      refused++;
    }
  }
  check(Math.abs(k - 1 / Math.sin(52 * DEG)) < 1e-12 && Math.abs(k - 1.2690182) < 1e-6
    && Math.abs(surface - 1 / Math.cos(52 * DEG)) < 1e-12 && none === 1 && custom === 1.5 && refused === 4,
  `correction factors at 52 deg: cross-section ${k.toFixed(6)}, tilted surface ${surface.toFixed(6)}, none 1, ` +
    `custom 1.5; undefined ones refused (${refused} of 4)`);
  return k;
}

function checkMap(base, k) {
  // (G8) with alpha = phi = 0 is the plain scale: x_um = (x - x0) p_x / 1000, y_um = -(y - y0) p_y k / 1000
  const p = api.toMeasurement(base, 30, 5);
  check(worstOf(p, [(30 - 10) * 2 / 1000, -(5 - 20) * 2 * k / 1000]) < 1e-15,
    "(G8) without tilt axis and rotation: (x - x0) p_x / 1000, -(y - y0) p_y k / 1000");
  // (G7): K keeps the axis direction and stretches the normal by k; (G9): det A = -k p_x p_y / 1e6
  const K = api.tiltMatrix(1.7, 25);
  const [c, s] = [Math.cos(25 * DEG), Math.sin(25 * DEG)];
  const general = { ...base, pixelNm: [2, 3], axisDeg: 25, rotationDeg: -33 };
  const A = api.measurementMatrix(general).matrix;
  check(worstOf(api.matApply(K, c, s), [c, s]) < 1e-15 && worstOf(api.matApply(K, -s, c), [-1.7 * s, 1.7 * c]) < 1e-15
    && Math.abs(api.matDet(A) + (k * 2 * 3) / 1e6) < 1e-18,
  `tilt axis at 25 deg: K keeps it and stretches across it; det A = ${api.matDet(A).toExponential(6)} = -k p_x p_y / 1e6`);
  const q = api.toMeasurement(general, 123.4, 567.8);
  check(worstOf(api.fromMeasurement(general, ...q), [123.4, 567.8]) < 1e-9,
    "(G10): micrometres and back with a tilt axis, a rotation and pixels of 2 x 3 nm");
  return general;
}

function checkMeasures(base, k, general) {
  // the rotation is rigid: lengths and angles do not change, directions turn with it
  const ruler = [[100, 200], [180, 140]];
  const triangle = [[100, 200], [150, 260], [220, 230]];
  const turned = { ...general, rotationDeg: general.rotationDeg + 47 };
  const [r0, r1] = [api.measureRuler(ruler, general), api.measureRuler(ruler, turned)];
  check(Math.abs(r0.length - r1.length) < 1e-12
    && Math.abs(api.normalizeDegrees(r1.directionDeg - r0.directionDeg - 47, 360)) < 1e-9
    && Math.abs(api.measureAngle(triangle, general) - api.measureAngle(triangle, turned)) < 1e-9,
  "rotation by 47 deg: lengths and angles unchanged, directions turned by 47 deg");
  // known values: an L stays square when its upright doubles (k = 2); a 45 deg diagonal goes to atan 2
  const double = { ...base, correction: "custom", customFactor: 2, pixelNm: null, originPx: [0, 0] };
  const right = api.measureAngle([[10, 0], [0, 0], [0, -10]], double);
  const diagonal = api.measureRuler([[0, 0], [10, -10]], double);
  check(Math.abs(right - 90) < 1e-12 && Math.abs(diagonal.directionDeg - Math.atan(2) / DEG) < 1e-12
    && diagonal.unit === "px" && Math.abs(diagonal.length - 10 * Math.sqrt(5)) < 1e-12,
  `k = 2: a right angle stays 90 deg; a 45 deg diagonal at ${diagonal.directionDeg.toFixed(4)} deg, length 10 sqrt 5 px`);
  const cross = api.measureLineAngle([[0, 0], [10, 0], [5, -3], [5, 7]], double);
  const slant = api.measureLineAngle([[0, 0], [10, 0], [0, 0], [10, -10]], double);
  const back = api.measureLineAngle([[0, 0], [10, 0], [10, -10], [0, 0]], double);
  check(Math.abs(cross.angleDeg - 90) < 1e-12 && worstOf(cross.crossing, [5, 0]) < 1e-12
    && Math.abs(slant.angleDeg - Math.atan(2) / DEG) < 1e-12 && Math.abs(back.angleDeg + slant.angleDeg - 180) < 1e-12
    && api.lineIntersection([0, 0], [1, 0], [0, 1], [5, 1]) === null,
  "two lines: 90 deg crossing at (5, 0); atan 2 for the diagonal, its supplement when reversed; parallel lines do not cross");
  // (G13): levelled lines are horizontal or vertical, after a turn of at most 90 deg
  const line = [[100, 200], [300, 260]];
  const from = { ...general, rotationDeg: 10 };
  const results = ["horizontal", "vertical"].map((target) => {
    const phi = api.levelRotation(from, line[0], line[1], target);
    const direction = api.measureRuler(line, { ...from, rotationDeg: phi }).directionDeg;
    return Math.abs(api.normalizeDegrees(direction - (target === "horizontal" ? 0 : 90), 180)) < 1e-9
      && Math.abs(api.normalizeDegrees(phi - 10, 360)) <= 90;
  });
  // from vertical to horizontal both turns are 90 deg: the smaller rotation is taken
  const upright = api.levelRotation(from, line[0], line[1], "vertical");
  const flat = api.levelRotation({ ...from, rotationDeg: upright }, line[0], line[1], "horizontal");
  results.push(Math.abs(flat) <= 90 && Math.abs(Math.abs(api.normalizeDegrees(flat - upright, 360)) - 90) < 1e-9);
  // (G14): with the tilt axis along a line, the correction leaves the line's direction alone
  const alpha = api.axisFromLine(general, line[0], line[1]);
  const along = { ...general, axisDeg: alpha, rotationDeg: 0 };
  const corrected = api.measureRuler(line, along).directionDeg;
  const uncorrected = api.measureRuler(line, { ...along, correction: "none" }).directionDeg;
  check(results.every(Boolean) && Math.abs(api.normalizeDegrees(corrected - uncorrected, 180)) < 1e-9
    && Math.abs(api.normalizeDegrees(alpha - uncorrected, 180)) < 1e-9,
  `levelling a line horizontal and vertical; tilt axis along it at ${alpha.toFixed(4)} deg keeps its direction`);
  // contour measures through the whole map: a unit square of 2 nm pixels, corrected and turned
  const square = { name: "sq", closed: true, points: [[0, 0], [1, 0], [1, 1], [0, 1]] };
  const m = api.measureContour(square, { ...base, rotationDeg: 30 });
  const px = api.measureContour(square, { ...base, pixelNm: null, correction: "none" });
  check(Math.abs(m.area - 4e-6 * k) < 1e-15 && Math.abs(m.perimeter - (4e-3 + 4e-3 * k)) < 1e-12 && m.unit === "um"
    && px.unit === "px" && px.area === 1 && px.perimeter === 4
    && api.measurementMatrix({ ...base, tiltDeg: 0 }) === null && api.measureRuler(ruler, { ...base, tiltDeg: 0 }) === null,
  "unit square: 4e-6 k um^2 and 4e-3 (1 + k) um turned or not, 1 px^2 and 4 px without a scale; no measures with k undefined");
}

function checkGeometry() {
  const base = { pixelNm: [2, 2], tiltDeg: 52, correction: "cross-section", customFactor: 1, axisDeg: 0, rotationDeg: 0,
    originPx: [10, 20] };
  const k = checkFactors(base);
  const general = checkMap(base, k);
  checkMeasures(base, k, general);
}

const IMAGE = { name: "x.tif", sha256: "ab".repeat(32), width: 3072, height: 2188, databarRows: 140, microscope: "FEI test" };

function checkPolygonFile() {
  const frame = { pixelNm: [1.34896, 1.34896], tiltDeg: 51.996, correction: "cross-section", customFactor: 1,
    axisDeg: 0.7, rotationDeg: -1.25, originPx: [1536, 1024] };
  const contours = [
    { name: "rib", closed: true, points: [[933.796, 853.611], [2136.371, 853.287], [2286.437, 965.003], [783.01, 965.04]] },
    { name: "slab, top", closed: false, points: [[100, 965], [2972, 965]] },
  ];
  const text = api.formatPolygonFile(IMAGE, frame, contours, "sigma_px=2");
  const back = api.parsePolygonFile(text);
  const samePx = back.contours.every((c, i) => c.px.every((p, j) => worstOf(p, contours[i].points[j]) < 5e-4));
  const um = api.toMeasurement(frame, 933.796, 853.611);
  check(back.contours.length === 2 && back.contours[1].name === "slab, top" && !back.contours[1].closed && samePx
    && worstOf(back.contours[0].um[0], um) < 1e-6 && back.meta.pixel_size_nm === "1.34896 1.34896"
    && back.meta.correction === "cross-section" && text.includes('"slab, top",0,0,'),
  "polygon file round trip: names (a quoted one), closed flags, pixels, micrometres and header");
  const rib = api.measureContour(contours[0], frame);
  const slab = api.measureContour(contours[1], frame);
  const header = text.split("\n").filter((line) => line.startsWith("# measures: "));
  check(header.length === 2
    && header[0] === `# measures: rib, perimeter_um ${rib.perimeter.toFixed(6)}, area_um2 ${rib.area.toFixed(6)}`
    && header[1] === `# measures: "slab, top", length_um ${slab.perimeter.toFixed(6)}`
    && text.indexOf("# measures: ") < text.indexOf("contour,closed,vertex,"),
  "polygon file header: each contour's measures above the columns, perimeter and area when closed, length when open");
  const blank = { pixelNm: null, tiltDeg: 0, correction: "none", customFactor: 1, axisDeg: 0, rotationDeg: 0, originPx: [0, 0] };
  const restored = api.frameFromMeta(back.meta, blank);
  const matrix = back.meta.px_to_um.split(" ").map(Number);
  const pixels = back.contours[0].um.map(([X, Y]) => api.fromMeasurement(restored, X, Y));
  check(JSON.stringify(restored) === JSON.stringify(frame)
    && worstOf(matrix, api.measurementMatrix(frame).matrix) < 1e-12
    && pixels.every((p, j) => worstOf(p, contours[0].points[j]) < 1e-3),
  "the header restores the frame (tilt axis and rotation included), px_to_um is A, and micrometres give the pixels back");
  const bad = [
    ["# something else\ncontour,closed,vertex,x_um,y_um\n", "first line"],
    ["# sem-measurement-tool polygons 1\ncontour,closed,x_um,y_um\n", "missing column"],
    ["# sem-measurement-tool polygons 1\ncontour,closed,vertex,x_um,y_um\na,1,1,0,0\n", "vertex order"],
    ["# sem-measurement-tool polygons 1\ncontour,closed,vertex,x_um,y_um\na,1,0,zero,0\n", "number"],
  ];
  let refused = 0;
  for (const [t] of bad) {
    try {
      api.parsePolygonFile(t);
    } catch {
      refused++;
    }
  }
  check(refused === bad.length, `bad polygon files are refused (${refused} of ${bad.length}: ${bad.map((b) => b[1]).join(", ")})`);
}

function checkMeasurementFile() {
  const frame = { pixelNm: [2, 2], tiltDeg: 52, correction: "cross-section", customFactor: 1, axisDeg: 0, rotationDeg: 0,
    originPx: [0, 0] };
  const k = api.correctionFactor(frame);
  const measurements = [
    { name: "rib width", kind: "ruler", points: [[100, 50], [400, 50]] },
    { name: "foot, left", kind: "angle", points: [[0, 100], [100, 100], [100, 0]] },
    { name: "sidewall", kind: "line-angle", points: [[0, 0], [10, 0], [0, 0], [10, -10]] },
    { name: "profile 1", kind: "profile", points: [[100, 60], [400, 60]], width: 5 },
    { name: "rib", kind: "contour", closed: true, points: [[100, 100], [400, 100], [400, 200], [100, 200]] },
    { name: "slab", kind: "contour", closed: false, points: [[0, 300], [500, 300]] },
  ];
  const text = api.formatMeasurementFile(IMAGE, frame, measurements, (ms) => (ms.kind === "profile" ? 1234.5 : null));
  const rows = text.split("\n").filter((line) => line !== "" && !line.startsWith("#"));
  const slant = (Math.atan(k) / DEG).toFixed(3);
  const h = 0.2 * k;                 // the rectangle's height: 100 rows of 2 nm, stretched by k
  const gap = ",".repeat(14);        // a contour's empty fields, from dx to mean_grey
  check(text.startsWith("# sem-measurement-tool measurements 1\n") && text.includes("\n# unit: um\n") && rows.length === 7
    && rows[0] === "name,kind,value,unit,dx,dy,direction_deg,x1_px,y1_px,x2_px,y2_px,x3_px,y3_px,x4_px,y4_px,width,mean_grey," +
      "closed,vertices,area,bbox_width,bbox_height"
    && rows[1] === `rib width,ruler,0.600000,um,0.600000,0.000000,0.000,100.000,50.000,400.000,50.000${",".repeat(11)}`
    && rows[2].startsWith('"foot, left",angle,90.000,deg,,,,0.000,100.000,')
    && rows[3].startsWith(`sidewall,line-angle,${slant},deg,,,,`)
    && rows[4] === "profile 1,profile,0.600000,um,0.600000,0.000000,0.000,100.000,60.000,400.000,60.000,,,,,0.010000,1234.5,,,,,"
    && rows[5] === `rib,contour,${(2 * (0.6 + h)).toFixed(6)},um${gap}1,4,${(0.6 * h).toFixed(6)},0.600000,${h.toFixed(6)}`
    && rows[6] === `slab,contour,1.000000,um${gap}0,2,,1.000000,0.000000`,
  `measurements file: a ruler of 0.6 um, a right angle, two lines at atan k = ${slant} deg, a profile of 0.6 um with ` +
    "its band of 5 view pixels (0.01 um) and its mean grey, a closed contour (perimeter, vertices, area, bounding box) " +
    "and an open one (its length, no area)");
}

function checkSession() {
  const session = {
    image: IMAGE,
    frame: { pixelNm: [1.34896, 1.34896], tiltDeg: 51.996, correction: "cross-section", customFactor: 1, axisDeg: 0.5,
      rotationDeg: -1.25, originPx: [1536.5, 1024.25] },
    snap: { on: true, sigmaPx: 2.5, median: 5, radiusPx: 15, minContrast: 4 },
    measurements: [
      { name: "rib", kind: "contour", color: 0, closed: true, layer: [2, 5], points: [[933.79612, 853.61149], [2136.371, 853.287], [2286.437, 965.003]] },
      { name: "ruler 1", kind: "ruler", color: 1, points: [[1, 2], [3, 4]] },
      { name: 'slab "top", left', kind: "contour", color: 9, closed: false, points: [[100, 965], [2972, 965]] },
      { name: "angle 1", kind: "angle", points: [[1, 2], [3, 4], [5, 7]] },
      { name: "line angle 1", kind: "line-angle", points: [[0, 0], [1, 0], [0, 1], [1, 2]] },
      { name: "profile 1", kind: "profile", points: [[10, 20], [30, 25]], width: 7.25 }],
    selected: 2,
    display: [1520, 61200.5],
  };
  const text = api.formatSession(session, "2026-10-23T12:00:00.000Z");
  const back = api.parseSession(text);
  const ms = back.measurements;
  check(JSON.stringify(back.frame) === JSON.stringify(session.frame) && JSON.stringify(back.snap) === JSON.stringify(session.snap)
    && ms.map((m) => m.kind).join() === "contour,ruler,contour,angle,line-angle,profile"
    && worstOf(ms[0].points[0], [933.7961, 853.6115]) === 0 && ms[2].name === 'slab "top", left' && ms[0].closed && !ms[2].closed
    && JSON.stringify([ms[0].layer, ms[2].layer]) === "[[2,5],[1,0]]" && ms[1].closed === undefined
    && ms[5].width === 7.25 && ms[1].width === undefined && text.includes('"width_px": 7.25')
    && back.selected === 2 && back.image.sha256 === IMAGE.sha256 && text.includes("[933.7961, 853.6115]")
    && back.display.join() === "1520,61200.5"
    && api.parseSession(api.formatSession({ ...session, display: null, selected: -1 }, "x")).display === null
    && api.parseSession(api.formatSession({ ...session, selected: -1 }, "x")).selected === -1
    && ms.map((m) => m.color).join() === "0,1,9,3,4,5",
  "session round trip: frame, snap settings, the measurements in their order with contours among them (points to " +
    "1e-4 px, closed flags, GDS layers, 1/0 by default), a profile's band width, colours (absent: the place in the " +
    "list), the selected one (none: -1), display levels (absent: Auto)");
  const good = JSON.parse(text);
  const bad = [
    "{ not json",
    { ...good, format: "other" },
    { ...good, version: 2 },
    { ...good, measurements: "none" },
    { ...good, measurements: [{ name: "r", kind: "ruler", points_px: [[0, 0]] }] },
    { ...good, measurements: [{ name: "r", kind: "circle", points_px: [[0, 0]] }] },
    { ...good, measurements: [{ name: "a", kind: "contour", points_px: [[0, 0]] }, { name: "a", kind: "ruler", points_px: [[0, 0], [1, 1]] }] },
    { ...good, frame: { ...good.frame, correction: "sideways" } },
    { ...good, measurements: [{ name: "a", kind: "contour", closed: true, points_px: [[0, "x"]] }] },
    { ...good, measurements: [{ name: "a", kind: "contour", closed: true, gds_layer: [-1, 0], points_px: [[0, 0]] }] },
    { ...good, display: { black_level: 5, white_level: 5 } },
    { ...good, measurements: [{ name: "p", kind: "profile", width_px: -1, points_px: [[0, 0], [1, 1]] }] },
    { ...good, measurements: [{ name: "r", kind: "ruler", color: 1.5, points_px: [[0, 0], [1, 1]] }] },
  ];
  let refused = 0;
  for (const b of bad) {
    try {
      api.parseSession(typeof b === "string" ? b : JSON.stringify(b));
    } catch {
      refused++;
    }
  }
  check(refused === bad.length, `bad session files are refused (${refused} of ${bad.length}: not JSON, format, version, ` +
    "no list, point count, kind, a name used twice across kinds, correction, number, GDS layer, display levels, band width, " +
    "colour)");
}

/** The records of a GDSII file, [type, data type, data], every length checked. */
function gdsRecords(bytes) {
  const out = [];
  for (let at = 0; at < bytes.length;) {
    const length = (bytes[at] << 8) | bytes[at + 1];
    if (length < 4 || length % 2 !== 0 || at + length > bytes.length) {
      throw new Error(`a GDSII record of length ${length} at byte ${at}`);
    }
    out.push([bytes[at + 2], bytes[at + 3], bytes.subarray(at + 4, at + length)]);
    at += length;
  }
  return out;
}

/** Big-endian signed integers of ``size`` bytes. */
function integers(data, size) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return Array.from({ length: data.length / size }, (_, i) => (size === 2 ? view.getInt16(2 * i) : view.getInt32(4 * i)));
}

function checkGdsReals() {
  // (S2): bytes computed exactly with Python's fractions; gdstk 1.0.1 and KLayout 0.30.12 write the first two as UNITS
  const pairs = [[1e-3, "3E4189374BC6A7F0"], [1e-9, "3944B82FA09B5A54"], [1, "4110000000000000"], [-2.5, "C128000000000000"],
    [0.1, "401999999999999A"], [123456.789, "451E240C9FBE76C9"], [1e-12, "37119799812DEA11"], [0, "0000000000000000"]];
  const hex = (b) => Buffer.from(b).toString("hex").toUpperCase();
  const wrong = pairs.filter(([x, h]) => hex(api.gdsReal(x)) !== h);
  const r = random(7);
  let mismatch = 0;
  for (let i = 0; i < 2000; i++) {
    const x = (r() - 0.5) * 10 ** (Math.floor(r() * 40) - 20);
    if (api.gdsRealValue(api.gdsReal(x), 0) !== x) {
      mismatch++;
    }
  }
  check(wrong.length === 0 && mismatch === 0,
    `GDSII reals (S2): ${pairs.length - wrong.length} of ${pairs.length} exact byte patterns (1e-3 -> 3E4189374BC6A7F0, ` +
      `1e-9 -> 3944B82FA09B5A54), 2000 random values read back exactly (${mismatch} not)`);
}

function checkGdsFile() {
  const date = new Date(2026, 9, 25, 14, 5, 6);
  const { bytes, skipped } = api.formatGds({ libName: "LIB", cellName: "rib cell!", date, elements: [
    { kind: "boundary", layer: 1, datatype: 0, points: [[0, 0], [1.2, 0], [1.0004, 0.3], [0.2, 0.3]] },
    { kind: "path", layer: 2, datatype: 5, points: [[-1, 0.1], [2, 0.1]], width: 0.05 },
    { kind: "text", layer: 1, datatype: 0, points: [[0, 0]], text: "rib" },
    { kind: "boundary", layer: 3, datatype: 0, points: [[0, 0], [0.0002, 0], [0.0001, 0.0001]] },   // one point on a 1 nm grid
    { kind: "boundary", layer: 40000, datatype: 0, points: [[0, 0], [1, 0], [1, 1]] },
  ] });
  const recs = gdsRecords(bytes);
  const types = recs.map(([t]) => t.toString(16).padStart(2, "0")).join(" ");
  const want = "00 01 02 03 05 06 08 0d 0e 10 11 09 0d 0e 21 0f 10 11 0c 0d 16 10 19 11 07 04";
  const of = (type, n = 0) => recs.filter(([t]) => t === type)[n][2];
  const ascii = (data) => String.fromCharCode(...data).replace(/\0+$/, "");
  check(types === want && api.gdsRealValue(of(0x03), 0) === 1e-3 && api.gdsRealValue(of(0x03), 8) === 1e-9
    && integers(of(0x01), 2).join() === "2026,10,25,14,5,6,2026,10,25,14,5,6" && ascii(of(0x06)) === "rib_cell_"
    && integers(of(0x10, 0), 4).join() === "0,0,1200,0,1000,300,200,300,0,0" && integers(of(0x0f), 4)[0] === 50
    && integers(of(0x10, 1), 4).join() === "-1000,100,2000,100" && integers(of(0x0e, 1), 2)[0] === 5
    && ascii(of(0x19)) === "rib" && skipped.length === 2 && skipped[0].includes("distinct points")
    && skipped[1].includes("layer 40000"),
  `GDSII file: records ${want}; units 1e-3 um and 1e-9 m; a boundary closed on the 1 nm grid, a 50 nm path, a label; ` +
    `left out with the reason: ${skipped.map((s) => s.split(": ")[1]).join("; ")}`);
}

function checkVertexOps() {
  const P = [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]];
  const before = JSON.stringify(P);
  const xs = (pts) => pts.map((p) => p[0]).join("");
  const up = api.moveSelected(P, [2, 3], -1);
  const stuck = api.moveSelected(P, [0, 1], -1);
  const spread = api.moveSelected(P, [0, 2], 1);
  const closed = api.reverseContour(P, true, [1]);
  const open = api.reverseContour(P, false, [1]);
  check(xs(up.points) === "02314" && up.selected.join() === "1,2" && xs(stuck.points) === "01234"
    && xs(spread.points) === "10324" && spread.selected.join() === "1,3"
    && xs(api.dropSelected(P, [1, 3])) === "024" && xs(api.makeFirst(P, 3)) === "34012"
    && xs(closed.points) === "04321" && closed.selected.join() === "4" && xs(open.points) === "43210"
    && open.selected.join() === "3" && api.selectionRange(4, 1).join() === "1,2,3,4" && JSON.stringify(P) === before,
  "vertex operations: a block moves up together, a block at the start stays, spread vertices move apart; drop, " +
    "make-first, reverse (closed keeps its first vertex, open swaps its ends), ranges; the input is untouched");
  // (G15): F V maps the stored step of an arrow key back onto the screen step, whatever the frame
  const frames = [
    { pixelNm: null, tiltDeg: 0, correction: "none", customFactor: 1, axisDeg: 0, rotationDeg: 0, originPx: [0, 0] },
    { pixelNm: null, tiltDeg: 0, correction: "custom", customFactor: 2, axisDeg: 0, rotationDeg: 0, originPx: [0, 0] },
    { pixelNm: null, tiltDeg: 0, correction: "none", customFactor: 1, axisDeg: 0, rotationDeg: 90, originPx: [0, 0] },
    { pixelNm: [2, 3], tiltDeg: 52, correction: "cross-section", customFactor: 1, axisDeg: 17, rotationDeg: -33, originPx: [5, 5] },
  ];
  let worst = 0;
  for (const f of frames) {
    const v = api.viewMatrix(f);
    for (const [dx, dy] of [[1, 0], [0, -1], [-10, 0], [0, 10]]) {
      const s = api.viewStepToStored(f, dx, dy);
      worst = Math.max(worst, ...api.matApply([v[0], v[1], -v[2], -v[3]], s[0], s[1]).map((w, i) => Math.abs(w - [dx, dy][i])));
    }
  }
  const up1 = (f) => api.viewStepToStored(frames[f], 0, -1).map((v) => Number(v.toFixed(12)) + 0);
  check(worst < 1e-12 && up1(0).join() === "0,-1" && up1(1).join() === "0,-0.5" && up1(2).join() === "1,0",
    `arrow keys (G15): screen steps reproduced to ${worst.toExponential(1)}; Up moves a stored point by (0, -1), ` +
      "by half a row when rows count twice, and along +x when the image is turned by 90 deg");
}

/**
 * ImageJ's ContrastAdjuster (ij/plugin/frame/ContrastAdjuster.java), its arithmetic transcribed:
 * adjustContrast, adjustBrightness and updateScrollBars (before the slider positions are cut to
 * integers).  defaultMin and defaultMax are the span; slider positions run from 0 to sliderRange.
 */
const IMAGEJ = {
  contrast(cvalue, min, max, span, sliderRange) {
    const center = min + (max - min) / 2;
    const range = span[1] - span[0];
    const mid = sliderRange / 2;
    const slope = cvalue <= mid ? cvalue / mid : mid / (sliderRange - cvalue);
    return slope > 0 ? [center - (0.5 * range) / slope, center + (0.5 * range) / slope] : [min, max];
  },
  brightness(bvalue, min, max, span, sliderRange) {
    const center = span[0] + (span[1] - span[0]) * ((sliderRange - bvalue) / sliderRange);
    const width = max - min;
    return [center - width / 2.0, center + width / 2.0];
  },
  sliders(min, max, span, sliderRange) {
    const mid = sliderRange / 2;
    let c = ((span[1] - span[0]) / (max - min)) * mid;
    if (c > mid) {
      c = sliderRange - ((max - min) / (span[1] - span[0])) * mid;
    }
    const level = min + (max - min) / 2.0;
    return [(1.0 - (level - span[0]) / (span[1] - span[0])) * sliderRange, c];
  },
};

/** The whole values from..to, each ``times`` times, as grey values. */
function run(from, to, times = 1) {
  const n = to - from + 1;
  return Float32Array.from({ length: n * times }, (_, k) => from + (k % n));
}

function checkHistogram() {
  const total = (h) => h.counts.reduce((a, b) => a + b, 0);
  const shape = (h) => [h.counts.length, h.binWidth, h.start, total(h), h.wholeBins, h.span.join("..")].join(" ");
  // 8-bit images span 0-255 whatever their values (ImageJ): the Zeiss test image's values 96-195 three times each,
  // and colour luminances that are not whole.  16 and 32 bits span their values: the same 100 values, the FEI test
  // image's span once each, 300 values, the full 16 bits, floats, and one value
  const eightBit = api.fixedSpan(8);
  const zeiss = api.histogramOf(run(96, 195, 3), eightBit);
  const colour = api.histogramOf(Float32Array.from([0.3, 0.6, 100.49, 254.7]), eightBit);
  const hundred = api.histogramOf(run(96, 195, 3));
  const fei = api.histogramOf(run(6041, 65468));
  const narrow = api.histogramOf(run(1000, 1299));
  const full16 = api.histogramOf(Float32Array.from([0, 300, 65535]));
  const floats = api.histogramOf(Float32Array.from([0.1, 0.5, 0.9, 0.3]));
  const shapes = [zeiss, colour, hundred, fei, narrow, full16, api.histogramOf(new Float32Array(10).fill(7)),
    api.histogramOf(new Float32Array(10).fill(0.25))].map(shape);
  const want = ["256 1 -0.5 300 true 0..255", "256 1 -0.5 4 true 0..255", "100 1 95.5 300 true 96..195",
    "256 233 6040.5 59428 true 6041..65468", "150 2 999.5 300 true 1000..1299", "256 256 -0.5 3 true 0..65535",
    "1 1 6.5 10 true 6.5..7.5", "1 1 -0.25 10 false -0.25..0.75"];
  const even = zeiss.counts.slice(96, 196).every((n) => n === 3) && hundred.counts.every((n) => n === 3)
    && narrow.counts.every((n) => n === 2) && fei.counts.slice(0, 255).every((n) => n === 233) && fei.counts[255] === 13;
  const ends = [full16.counts[0], full16.counts[1], full16.counts[255], floats.counts[0], floats.counts[255],
    colour.counts[0], colour.counts[1], colour.counts[100], colour.counts[255]].join() === "1,1,1,1,1,1,1,1,1";
  const spans = [8, 16, 32].map((bits) => String(api.fixedSpan(bits))).join(" | ");
  // the 100 whole values in 256 bins of the fractional width 99 / 256: bins used
  const fractional = new Set(Array.from(run(96, 195), (v) => Math.min(255, Math.floor((v - 96) * (256 / 99))))).size;
  const [f0, f1] = [Math.fround(0.1), Math.fround(0.9)];
  check(shapes.join("; ") === want.join("; ") && even && ends && spans === "0,255 | null | null" && fractional === 100
    && shape(floats) === `256 ${(f1 - f0) / 256} ${f0} 4 false ${f0}..${f1}`,
  "histogram (D4): 8-bit images over 0-255 in 256 bins of one value, as in ImageJ, the Zeiss values 96-195 each in " +
    "its bin and colour luminances at their nearest whole value; 16 and 32 bits over their values: 100 whole values " +
    `in 100 bins of one (fractional bins of their range leave ${256 - fractional} of 256 empty), the FEI span ` +
    "6041-65468 in 256 bins of 233 values, the last holding the 13 up to the brightest, 300 values in 150 bins of 2, " +
    "the full 16 bits in 256 bins of 256, floats in 256 bins with the extremes in the end bins, one value in one bin");
}

/** The largest difference, over all 257 positions of 256-step sliders, between (D3) and ImageJ, in spans. */
function imagejDifference(span, lo, hi) {
  const s = span[1] - span[0];
  let worst = 0;
  for (let k = 0; k <= 256; k++) {
    const centre = (lo + hi) / 2;
    const half = api.widthOfContrast(k / 256, span) / 2;
    const ours = k === 0 ? [lo, hi] : [centre - half, centre + half];     // c = 0: ImageJ leaves the levels
    const theirs = IMAGEJ.contrast(k, lo, hi, span, 256);
    const c = api.centreOfBrightness(k / 256, span);
    const ours2 = [c - (hi - lo) / 2, c + (hi - lo) / 2];
    const theirs2 = IMAGEJ.brightness(k, lo, hi, span, 256);
    worst = Math.max(worst, ...[0, 1].map((i) => Math.abs(ours[i] - theirs[i]) / s),
      ...[0, 1].map((i) => Math.abs(ours2[i] - theirs2[i]) / s));
  }
  return worst;
}

function checkSliders() {
  // (D3) against ImageJ, at every position of its 256-step sliders: three windows on the FEI span, three on the
  // 8-bit span 0-255 (the Zeiss image's auto levels among them)
  const span = [6041, 65468];
  const s = span[1] - span[0];
  const worst = Math.max(...[[14902, 51697], [30000, 30500], [-50000, 150000]].map(([lo, hi]) => imagejDifference(span, lo, hi)),
    ...[[104, 160], [0, 255], [120, 121]].map(([lo, hi]) => imagejDifference([0, 255], lo, hi)));
  let worstSliders = 0;
  const rand = random(11);
  for (let t = 0; t < 1000; t++) {
    const centre = span[0] + rand() * s;
    const width = s * 10 ** (4 * rand() - 2);               // 1 % to 100 times the span
    const levels = [centre - width / 2, centre + width / 2];
    const [b, c] = IMAGEJ.sliders(levels[0], levels[1], span, 1);
    worstSliders = Math.max(worstSliders, Math.abs(api.sliderBrightness(levels, span) - b),
      Math.abs(api.sliderContrast(levels, span) - c));
  }
  let worstTrip = 0;
  for (let k = 1; k <= 1000; k++) {
    const half = api.widthOfContrast(k / 1000, span) / 2;
    const b = 1 - k / 1000;
    const centre = api.centreOfBrightness(b, span);
    const levels = [centre - half, centre + half];
    worstTrip = Math.max(worstTrip, Math.abs(api.sliderContrast(levels, span) - k / 1000),
      Math.abs(api.sliderBrightness(levels, span) - b));
  }
  const width = (c) => api.widthOfContrast(c, span) / s;
  check(worst < 1e-12 && worstSliders < 1e-12 && worstTrip < 1e-12 && width(0.5) === 1 && width(0.25) === 2
    && width(0.75) === 0.5 && width(1) === 0 && width(0) === Infinity && api.centreOfBrightness(0, span) === span[1]
    && api.centreOfBrightness(1, span) === span[0],
  `brightness and contrast (D3) as ImageJ's ContrastAdjuster: levels at all 257 positions of its sliders from six ` +
    `windows on a 16-bit and the 8-bit span within ${worst.toExponential(1)} of the span; slider positions of 1000 ` +
    "random windows within " +
    `${worstSliders.toExponential(1)}; slider -> levels -> slider within ${worstTrip.toExponential(1)}; the window is ` +
    "the span at c = 1/2, twice it at 1/4, half at 3/4, closed at 1");
}

function checkLevels() {
  // (D1) and (D2)
  const grey = api.greyMap(100, 200);
  const steps = Array.from({ length: 256 }, (_, k) => grey(100 + (100 / 255) * k)).every((g, k) => g === k);
  const auto = api.autoLevels(run(0, 9999));
  const autoFlat = api.autoLevels(new Float32Array(50).fill(3));
  check(grey(100) === 0 && grey(200) === 255 && grey(150) === 128 && grey(-1e9) === 0 && grey(1e9) === 255 && steps
    && Math.abs(auto[0] - 49.995) < 1e-6 && Math.abs(auto[1] - 9949.005) < 1e-6 && autoFlat[0] === 3 && autoFlat[1] > 3,
  "grey map (D1): black at the black level, white at the white level, 255 equal steps between, clipped outside; auto " +
    `levels (D2) of the values 0-9999 at ${auto.map((v) => v.toFixed(3)).join(" and ")}, the 0.5 and 99.5 % percentiles`);
}

const PLAIN = { pixelNm: null, tiltDeg: 0, correction: "none", customFactor: 1, axisDeg: 0, rotationDeg: 0, originPx: [0, 0] };
const SLANTED = { pixelNm: [2, 3], tiltDeg: 52, correction: "cross-section", customFactor: 1, axisDeg: 30, rotationDeg: -20,
  originPx: [0, 0] };

/** A w x h image of the grey values f(x, y), its rows from ``rows`` on an info bar. */
function rampImage(w, h, f, rows = h) {
  const data = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      data[y * w + x] = f(x, y);
    }
  }
  return { data, width: w, height: h, imageRows: rows };
}

function checkProfileSampling() {
  const plane = (x, y) => 2 * x + 3 * y + 5;
  const ramp = rampImage(40, 30, plane);
  // along a row: one sample per pixel, distances in px; between pixel centres bilinear values reproduce the ramp
  const g1 = api.profileGeometry([[5, 10], [25, 10]], 1, PLAIN);
  const p1 = api.sampleProfile(ramp, g1);
  const p2 = api.sampleProfile(ramp, api.profileGeometry([[3.25, 4.5], [20.75, 18.5]], 1, PLAIN));
  const worst = Math.max(...[p1, p2].flatMap((p) => Array.from(p.mean, (m, i) => Math.abs(m - plane(p.x[i], p.y[i])))),
    ...Array.from(p1.distance, (d, i) => Math.abs(d - i)));
  const single = g1.samples === 21 && g1.offsets.length === 1 && g1.unit === "px" && p2.mean.length === 24
    && Array.from(p1.count).every((n) => n === 1) && Array.from(p1.spread).every((s) => s === 0);
  // outside the image, and below the info bar, values are missing
  const down = api.sampleProfile(rampImage(40, 30, plane, 20), api.profileGeometry([[10, 15], [10, 25]], 1, PLAIN));
  const left = api.sampleProfile(ramp, api.profileGeometry([[-3, 5], [3, 5]], 1, PLAIN));
  const missing = Array.from(down.count).join("") === "11111000000" && Number.isNaN(down.mean[10])
    && Array.from(left.count).join("") === "0001111";
  // micrometres, pixels of 2 x 3 nm: 20 columns are 0.04 um, 20 rows 0.06 um
  const um = { ...PLAIN, pixelNm: [2, 3] };
  const across = api.profileGeometry([[5, 10], [25, 10]], 1, um);
  const along = api.profileGeometry([[5, 10], [5, 30]], 1, um);
  check(worst < 1e-9 && single && missing && Math.abs(across.length - 0.04) < 1e-15 && Math.abs(along.length - 0.06) < 1e-15
    && across.unit === "um",
  `profile samples (P2), (P4): one per stored pixel, a ramp reproduced to ${worst.toExponential(1)} along a row and ` +
    "between pixel centres; missing below the info bar and outside the image; 20 columns of 2 nm and 20 rows of 3 nm " +
    "give 0.04 and 0.06 um");
}

function checkProfileBand() {
  const rows = rampImage(40, 30, (x, y) => y);
  const band = (w, frame) => api.sampleProfile(rows, api.profileGeometry([[5, 10], [25, 10]], w, frame));
  const flat = (p, mean, spread, n) => Array.from(p.mean).every((m, i) => Math.abs(m - mean) < 1e-12
    && Math.abs(p.spread[i] - spread) < 1e-12 && p.count[i] === n);
  const stretched = { ...PLAIN, correction: "custom", customFactor: 2 };          // rows count twice
  const five = band(5, PLAIN);                                                      // lines on rows 8 ... 12
  const four = band(4, stretched);                                                  // 4 view px = 2 rows: 2 lines
  const turned = band(4, { ...stretched, rotationDeg: 90 });
  // in any frame the band is a rectangle as seen: each line's offset, mapped by V, is normal to the line and |r_j| long
  const pts = [[100, 80], [140, 95]];
  const g = api.profileGeometry(pts, 12.5, SLANTED);
  const v = api.viewMatrix(SLANTED);
  const dv = api.matApply(v, 40, 15);
  let worst = 0;
  g.offsets.forEach((o, j) => {
    const q = api.matApply(v, o[0], o[1]);
    const r = ((j + 0.5) / g.offsets.length - 0.5) * 12.5;
    worst = Math.max(worst, Math.abs(q[0] * dv[0] + q[1] * dv[1]) / Math.hypot(dv[0], dv[1]), Math.abs(Math.hypot(q[0], q[1]) - Math.abs(r)));
  });
  const trip = Math.abs(api.widthFromPoint(pts, SLANTED, api.widthHandle(pts, 12.5, SLANTED)) - 12.5);
  check(flat(five, 10, Math.SQRT2, 5) && flat(four, 10, 0.5, 2) && flat(turned, 10, 0.5, 2) && worst < 1e-12 && trip < 1e-12
    && g.offsets.length === Math.ceil(12.5 * Math.hypot(...g.band.across) - 1e-9),
  "profile band (P1), (P3): 5 view px across rows average 5 lines (mean 10, spread sqrt 2); rows that count twice " +
    "make 4 view px 2 lines (spread 0.5), turned by 90 deg the same; in a tilted, turned frame of 2 x 3 nm pixels " +
    `every line is normal to the profile as seen and at its offset, to ${worst.toExponential(1)}; the width handle ` +
    "gives the width back");
}

function checkProfileCrossings() {
  const line = [[5, 10], [25, 10]];
  const contours = [
    { name: "square", closed: true, points: [[10, 5], [20, 5], [20, 15], [10, 15]] },
    { name: "wire", closed: false, points: [[15, 0], [15, 20]] },
    { name: "kink", closed: false, points: [[12, 5], [12, 10], [14, 15]] },       // a vertex on the line
    { name: "along", closed: false, points: [[8, 10], [9, 10]] },                // on the line: no crossing
    { name: "beyond", closed: false, points: [[30, 0], [30, 20]] },              // past its end
  ];
  const got = api.profileCrossings(line, contours).map((c) => `${c.contour}@${c.t}`).join(" ");
  // t is kept by the map: a quarter along in pixels is a quarter along in micrometres, in a tilted, turned frame
  const g = api.profileGeometry(line, 1, SLANTED);
  const a = api.toMeasurement(SLANTED, 5, 10);
  const b = api.toMeasurement(SLANTED, 10, 10);
  const quarter = Math.abs(Math.hypot(b[0] - a[0], b[1] - a[1]) - 0.25 * g.length);
  check(got === "0@0.25 2@0.35 1@0.5 0@0.75" && quarter < 1e-15,
    `contour crossings (P5): ${got} (contour@t): a closed square twice, its closing side included, an open wire, a ` +
      "vertex on the line once; none for a segment along the line or past its end; t the same in micrometres");
}

function checkProfileFile() {
  const ramp = rampImage(40, 30, (x, y) => 2 * x + 3 * y + 5);
  const frame = { ...PLAIN, pixelNm: [2, 2] };
  const ms = { name: "profile 1", kind: "profile", points: [[5, 10], [25, 10]], width: 3 };
  const p = api.sampleProfile(ramp, api.profileGeometry(ms.points, ms.width, frame));
  const text = api.formatProfileFile(IMAGE, frame, ms, p, [{ name: "square", distance: 0.01 }, { name: "square", distance: 0.03 }]);
  const lines = text.split("\n");
  const rows = lines.filter((l) => l !== "" && !l.startsWith("#"));
  const has = (line) => lines.includes(line);
  check(lines[0] === "# sem-measurement-tool profile 1" && has("# profile: profile 1") && has("# band_width_px: 3")
    && has("# length: 0.040000") && has("# band_width: 0.006000") && has("# samples: 21") && has("# lines_across: 3")
    && has("# crossing: 0.010000 square") && has("# crossing: 0.030000 square") && has("# unit: um")
    && rows[0] === "distance,mean,std,count,x_px,y_px" && rows.length === 22 && rows[1] === "0.000000,45,2.4494897,3,5.000,10.000",
  "profile file: header with the line, its band (3 view px, 0.006 um), samples, lines and crossings; rows of distance, " +
    "mean, spread across the band (sqrt 6 over rows 9-11), count and position");
}

const images = testImages(process.argv.slice(2));
checkFei(images.feiFolder);
checkZeiss(images.zeiss);
checkInfoZone();
checkEdges();
checkGeometry();
checkPolygonFile();
checkMeasurementFile();
checkSession();
checkGdsReals();
checkGdsFile();
checkVertexOps();
checkHistogram();
checkSliders();
checkLevels();
checkProfileSampling();
checkProfileBand();
checkProfileCrossings();
checkProfileFile();
console.log(failures.length ? `FAIL: ${failures.length} check(s)` : "PASS");
process.exit(failures.length ? 1 : 0);
