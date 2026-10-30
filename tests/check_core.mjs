// Tests of the app's core, in Node: the page's scripts run in one context, as in the browser.
//
//     node tests/check_core.mjs [FEI folder] [Zeiss TIFF ...]
//
// 1. Files.  The test images come from the command line, or else from tests/local_data.json, which
//    git ignores: copy tests/local_data.example.json and name your own files.  Every TIFF of the
//    FEI folder and every Zeiss file is decoded: vendor, size, bits per sample and info bar must
//    agree, an electron image must have a pixel size, and the decoded values must equal the bytes
//    of the file read directly at the strip offsets.  The local file may also give each Zeiss
//    file's expected pixel size, tilt and info bar.  Every TIFF of a Hitachi folder (local file
//    only) is decoded too, its pixel size checked against the .txt file the microscope writes
//    beside it, and that file opened with the image must give the same, with the stage tilt.
//    Without test images these checks are skipped.  Always: a Hitachi TIFF built in the test is
//    decoded; metadata files opened with an image (Hitachi, JEOL, TESCAN), on images decoded here;
//    TESCAN text and Thermo Fisher XML found in TIFF tags by their content.
// 2. Gradient: exact on a linear ramp.  Snapping: onto a noisy synthetic edge within 0.25 px, not
//    on flat noise, and with the search radius measured through the view metric (E7); on pure noise
//    about as rarely per click as one sample exceeds the threshold (E9), with a mouse's radius and a
//    finger's; the noise of an image mostly clipped measured on its unclipped part.
// 3. Geometry (transform.js): correction factors, the map (G8) and its inverse, the tilt axis
//    (G7), the rigid rotation, angles and line crossings, levelling (G13), the tilt axis along a
//    line (G14), contour measures.
// 4. Files: the polygon file (round trip, frame restored, micrometres back to pixels, bad files
//    refused), the measurements file, the session file (round trip, GDS layers, bad files refused).
// 5. GDSII (gds.js): the eight-byte reals (S2) against bytes computed exactly in Python (those
//    gdstk and KLayout write for the units), random round trips, and a file read back record by
//    record, with the elements it must leave out.
// 6. The vertex window's operations (vertices.js) and the screen step of the arrow keys (G15).
// 7. The Zeiss info zone (Z1) and the Hitachi data bar (H1): found in the files where the local
//    file expects them, and on synthetic images found where drawn and nowhere else.  The session keeps the display levels.
// 8. The display (display.js): the histogram's bins of whole values (D4), over 0-255 for 8-bit
//    images and over the values for 16 and 32 bits; brightness and contrast (D3) against the
//    arithmetic of ImageJ's ContrastAdjuster, transcribed here, and their round trips; the grey
//    map (D1) and the auto levels (D2); the full scale the profile plot marks, per sample type.
// 9. Line profiles (profile.js): samples along a ramp exact, missing outside the image and below
//    the info bar, distances in micrometres (P2), (P4); the tuned sampling loop bit for bit that of
//    bilinear() at every value; the band a rectangle as seen in any frame,
//    its mean and spread, unchanged by a rotation (P1), (P3); contour crossings (P5); the width
//    handle; the profile file.  Squaring (P7)-(P11): the edge's normal from the structure tensor
//    in a tilted, turned frame, on a step, a bright line and a corner; the tensor of a noisy edge,
//    on average, exact in a frame that stretches 3 times; the direction's scatter over noisy
//    images, against one gradient and a sum of gradient vectors; the turn, also about the end not
//    moved, with the crossing's slide along a straight edge; a segment's normal.  Markers (P12): placed
//    where they project, the mean between samples.  Snapping them (P13): sharp, gradual and noisy edges,
//    a bright line's flanks, a ridge; the edge clicked, not merged with a step beside it nor taken by a
//    stronger one farther off; nothing at the end of the data or on a clipped or quieter stretch; a
//    ramp without a steepest point left as clicked; rarely a snap in noise alone.
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
    reverseContour, selectionRange, findInfoZone, findHitachiBar, parseKeyValueText, hitachiCalibration, metadataVendor, withMetadataText, fixedSpan, fullScale, histogramOf, autoLevels, greyMap, sliderBrightness,
    sliderContrast, centreOfBrightness, widthOfContrast, profileGeometry, bilinear, sampleProfile, profileCrossings, widthHandle,
    widthFromPoint, formatProfileFile, edgeNormal, segmentNormal, squaredProfile, markerPlace, profileValueAt,
    snapToSlope, UTIF })`, context);
}

const api = loadApi();

/** The bytes of a file as an ArrayBuffer of its own. */
function readBuffer(file) {
  const b = fs.readFileSync(file);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

/** Sample i of an uncompressed image read straight from the file: its first channel when in colour. */
function directSample(buffer, i) {
  const ifd = api.UTIF.decode(buffer)[0];
  const bits = ifd.t258[0];
  const offsets = ifd.t273;
  const rowsPerStrip = Math.min(ifd.t278 ? ifd.t278[0] : ifd.t257[0], ifd.t257[0]);
  const width = ifd.t256[0];
  const channels = ifd.t277 ? ifd.t277[0] : 1;
  const row = Math.floor(i / width);
  const strip = Math.floor(row / rowsPerStrip);
  const within = ((row - strip * rowsPerStrip) * width + (i % width)) * channels;
  const view = new DataView(buffer);
  const little = new Uint8Array(buffer, 0, 1)[0] === 0x49;
  return bits === 16 ? view.getUint16(offsets[strip] + 2 * within, little) : view.getUint8(offsets[strip] + within);
}

/**
 * The test images: from the command line, or else from tests/local_data.json (git-ignored, see
 * tests/local_data.example.json), which may also give what each Zeiss file must decode to, and a
 * folder of Hitachi images with the rows of their data bar.
 * @returns {{feiFolder: string|null, zeiss: Array<{file: string, pixel_nm?: number, tilt_deg?: number,
 *     info_bar_rows?: number, tilt_correction_on?: boolean, scan_rotation_deg?: number}>,
 *     hitachiFolder: string|null, hitachiBarRows?: number}}
 */
function testImages(args) {
  if (args.length > 0) {
    return { feiFolder: args[0], zeiss: args.slice(1).map((file) => ({ file })), hitachiFolder: null };
  }
  if (!fs.existsSync(LOCAL_DATA)) {
    return { feiFolder: null, zeiss: [], hitachiFolder: null };
  }
  const data = JSON.parse(fs.readFileSync(LOCAL_DATA, "utf-8"));
  return { feiFolder: data.fei_folder ?? null, zeiss: data.zeiss ?? [], hitachiFolder: data.hitachi_folder ?? null,
    hitachiBarRows: data.hitachi_bar_rows };
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
 * Every TIFF of a folder of Hitachi images: decoded as Hitachi, its values as in the file.  With the .txt
 * file the microscope writes beside it: its pixel size that file's PixelSize, and that size 127 mm /
 * (magnification x width).  With ``barRows``: a data bar of so many rows.
 * @param {string|null} folder
 * @param {number|undefined} barRows
 */
function checkHitachi(folder, barRows) {
  if (folder === null) {
    console.log("SKIP  Hitachi: no folder of test images (tests/local_data.json)");
    return;
  }
  const files = fs.existsSync(folder) ? fs.readdirSync(folder).filter((f) => /\.tiff?$/i.test(f)).sort() : [];
  if (files.length === 0) {
    console.log(`SKIP  Hitachi: no TIFF files in ${folder}`);
    return;
  }
  let worst = 0;
  let paired = 0;
  for (const name of files) {
    const buffer = readBuffer(path.join(folder, name));
    const image = api.decodeSEMImage(buffer, name);
    const cal = image.calibration;
    const n = image.width * image.height;
    const same = [0, image.width - 1, Math.floor(n / 2) + 5, n - 1].every((i) => image.data[i] === directSample(buffer, i));
    const txt = path.join(folder, name.replace(/\.tiff?$/i, ".txt"));
    let asTxt = true;
    if (fs.existsSync(txt)) {
      const text = fs.readFileSync(txt, "latin1");
      const md = api.parseKeyValueText(text);
      const width = Number(md.DataSize.split("x")[0]);
      const pixel = Number(md.PixelSize) * 1e-9;
      worst = Math.max(worst, Math.abs((pixel * Number(md.Magnification) * width) / 127e-3 - 1));
      // the .txt opened with the image: used in place of the TIFF's tags
      const opened = api.withMetadataText(image, text, path.basename(txt));
      const oc = opened.calibration;
      asTxt = cal.pixelSizeM !== null && cal.pixelSizeM[0] === pixel && width === image.width
        && oc.pixelSizeM[0] === pixel && oc.metadataFile === path.basename(txt) && oc.tiltDeg === Number(md.StagePositionT)
        && oc.tiltCorrectionOn === (md.TiltCompensation !== "0") && oc.databarRows === cal.databarRows
        && Math.abs(oc.workingDistanceM - Number(md.WorkingDistance.split(" ")[0]) * 1e-6) < 1e-15 && oc.notes.length === 0;
      paired++;
    }
    check(image.vendor === "Hitachi" && same && asTxt && image.imageRows === image.height - cal.databarRows
      && (barRows === undefined || cal.databarRows === barRows),
    `Hitachi ${name}: ${image.width} x ${image.height} ${image.sampleType}, ${cal.system}, pixel ` +
      `${cal.pixelSizeM ? (cal.pixelSizeM[0] * 1e9).toFixed(6) : "none"} nm${fs.existsSync(txt) ? " as in its .txt, " +
        "which opened with it gives the same, the stage tilt and the precise WD" : ""}, ` +
      `data bar found from row ${image.imageRows} (${cal.databarRows} rows left out); values as in the file`);
  }
  if (paired > 0) {
    check(worst < 1e-6, `Hitachi pixel size: PixelSize = 127 mm / (magnification x width) in all ${paired} .txt files, ` +
      `to ${worst.toExponential(1)} (relative)`);
  }
}

/**
 * A little-endian, uncompressed RGB TIFF of grey values 0-255 (``w`` x ``h``, w h even), with tags of
 * type BYTE added: {code: bytes}.  The pixels follow the header and the directory follows them.
 */
function rgbTiff(grey, w, h, byteTags) {
  const p = w * h * 3;
  /** tag, type (1 byte, 3 short, 4 long), values */
  const entries = [[256, 3, [w]], [257, 3, [h]], [258, 3, [8, 8, 8]], [259, 3, [1]], [262, 3, [2]], [273, 4, [8]],
    [277, 3, [3]], [278, 3, [h]], [279, 4, [p]], [284, 3, [1]],
    ...Object.entries(byteTags).map(([tag, bytes]) => [Number(tag), 1, bytes])];
  const size = { 1: 1, 3: 2, 4: 4 };
  const ifd = 8 + p;
  let extra = ifd + 2 + 12 * entries.length + 4;
  const room = entries.reduce((sum, [, type, v]) => sum + (v.length * size[type] > 4 ? v.length * size[type] + 1 : 0), 0);
  const buffer = new ArrayBuffer(extra + room);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  view.setUint16(0, 0x4949, true);
  view.setUint16(2, 42, true);
  view.setUint32(4, ifd, true);
  grey.forEach((v, i) => bytes.fill(v, 8 + 3 * i, 11 + 3 * i));
  view.setUint16(ifd, entries.length, true);
  entries.forEach(([tag, type, values], k) => {
    const at = ifd + 2 + 12 * k;
    const length = values.length * size[type];
    view.setUint16(at, tag, true);
    view.setUint16(at + 2, type, true);
    view.setUint32(at + 4, values.length, true);
    let to = at + 8;
    if (length > 4) {
      view.setUint32(at + 8, extra, true);
      to = extra;
      extra += length + (length % 2);
    }
    values.forEach((v, j) => {
      if (type === 1) {
        bytes[to + j] = v;
      } else if (type === 3) {
        view.setUint16(to + 2 * j, v, true);
      } else {
        view.setUint32(to + 4 * j, v, true);
      }
    });
  });
  return buffer;
}

/** UTF-16LE bytes of a text and its ending 0, as Windows writes its "XP" tags. */
function utf16(text) {
  const out = new Uint8Array(2 * text.length + 2);
  for (let i = 0; i < text.length; i++) {
    out[2 * i] = text.charCodeAt(i) & 255;
    out[2 * i + 1] = text.charCodeAt(i) >> 8;
  }
  return out;
}

/**
 * A Hitachi TIFF built here, 64 x 96 RGB with a data bar of 20 rows (black, a seventh white): its
 * calibration from the XPComment and XPAuthor tags, the bar found (H1), and no bar looked for when
 * DataDisplayCombine is 0.  Also (H1) on synthetic grey images: a bar found where drawn, and none in
 * noise, in a dark band that is not black and white, in a bar shorter than 16 rows or taller than a
 * quarter of the image, or in a white band.
 */
function checkHitachiSynthetic() {
  const [w, h] = [64, 96];
  const noise = gaussian(5);
  const picture = (barRows, value = () => 255) => {
    const g = Array.from({ length: w * h }, () => Math.round(Math.min(250, Math.max(10, 120 + 8 * noise()))));
    for (let y = h - barRows; y < h; y++) {
      for (let x = 0; x < w; x++) {
        g[y * w + x] = (x + 3 * y) % 7 === 0 ? value() : 0;
      }
    }
    return g;
  };
  const comment = (combine) => utf16(["SerialNumber=0000-0000-00", "DataNumber=000000 0001", "SampleName=test",
    "PixelSize=5.512153", "Condition=Vacc=2.0kV   Mag=x18.0k   WD=8.2mm", "EmissionCurrent=4.7", "SignalName=SE(L)",
    `DataDisplayCombine=${combine}`, ""].join("\r\n"));
  const decode = (combine) => api.decodeSEMImage(
    rgbTiff(picture(20), w, h, { 40092: comment(combine), 40093: utf16("SU8200") }), "hitachi.tif");
  const image = decode(1);
  const cal = image.calibration;
  const lines = api.describeCalibration(cal);
  const without = decode(0);
  check(image.vendor === "Hitachi" && cal.system === "Hitachi SU8200" && Math.abs(cal.pixelSizeM[0] - 5.512153e-9) < 1e-20
    && cal.pixelSizeM[1] === cal.pixelSizeM[0] && Math.abs(cal.fieldWidthM - 64 * 5.512153e-9) < 1e-20
    && cal.highVoltageV === 2000 && Math.abs(cal.workingDistanceM - 8.2e-3) < 1e-15 && cal.detector === "SE(L)"
    && cal.tiltDeg === null && cal.databarRows === 20 && image.imageRows === 76 && without.calibration.databarRows === 0
    && lines.includes("stage tilt: not in the TIFF (Hitachi writes it to the .txt file beside the image: open both together)")
    && image.metadataText.startsWith("SerialNumber="),
  "Hitachi TIFF built here (XPComment and XPAuthor, UTF-16): SU8200, pixel 5.512153 nm, field width, 2 kV, WD 8.2 mm, " +
    "SE(L), no stage tilt; data bar of 20 rows found, none looked for with DataDisplayCombine=0");
  const md = api.parseKeyValueText(["[SemImageFile]", "InstructName=SU8200", "Condition=Vacc=2.0kV   WD=8.2mm", "no equals",
    ""].join("\r\n"));
  const grey = (g) => Float32Array.from(g);
  const found = {
    bar: api.findHitachiBar(grey(picture(20)), w, h),
    none: api.findHitachiBar(grey(picture(0)), w, h),
    grey: api.findHitachiBar(grey(picture(20, () => 128)), w, h),
    short: api.findHitachiBar(grey(picture(10)), w, h),
    tall: api.findHitachiBar(grey(picture(30)), w, h),
  };
  const white = picture(0);
  white.fill(255, (h - 20) * w);
  white[0] = 0;
  found.white = api.findHitachiBar(grey(white), w, h);
  check(JSON.stringify(md) === '{"InstructName":"SU8200","Condition":"Vacc=2.0kV   WD=8.2mm"}' && found.bar === 76
    && found.none === null && found.grey === null && found.short === null && found.tall === null && found.white === null,
  `Hitachi data bar (H1) on synthetic images: found from row ${found.bar}; none in noise, in a dark band with grey ` +
    "text, in a bar of 10 rows or of 30 (over a quarter of 96), or in a white band; the .txt's section header skipped " +
    "and Condition kept whole");
}

/** The bytes of an ASCII text and its ending 0, as a TIFF tag of type BYTE holds text. */
function asciiBytes(text) {
  return Uint8Array.from(`${text}\0`, (c) => c.charCodeAt(0));
}

/**
 * Metadata files opened with an image (withMetadataText), and metadata in TIFF tags found by their content, on a
 * 64 x 96 image with a Hitachi-style data bar of 20 rows, as a browser decodes a JPEG.
 */
const META = (() => {
  const [w, h] = [64, 96];
  const grey = Array.from({ length: w * h }, (_, i) => 100 + (i % 37));
  for (let i = (h - 20) * w; i < w * h; i++) {
    grey[i] = i % 7 === 0 ? 255 : 0;
  }
  return { w, h, grey };
})();

/** The image of META as a browser decodes it (no metadata), named ``name``. */
function metaImage(name) {
  return { ...api.decodeSEMImage(rgbTiff(META.grey, META.w, META.h, {}), "x.tif"), name };
}

/** A Hitachi .txt for the image of META. */
function hitachiText() {
  return ["[SemImageFile]", "InstructName=SU8200", "ImageName=sample_0001.tif", `DataSize=${META.w}x${META.h}`,
    "PixelSize=5.512153", "AcceleratingVoltage=2000 Volt", "WorkingDistance=8206.67 um", "SignalName=SE(L)",
    "DataDisplayCombine=1", "StagePositionT=12.5", "TiltCompensation=1", "RasterRotation=3.0", "Date=10/29/2026",
    "Time=19:00:54", ""].join("\r\n");
}

/** A JEOL .txt: magnification, micron bar (pixels) and marker; the recorded size 64 x 80. */
function jeolText(mag, bar, marker) {
  return ["$CM_FORMAT JEOL-SEM", `$CM_MAG ${mag}`, "$CM_FULL_SIZE 64 80", `$$SM_MICRON_BAR ${bar}`,
    `$$SM_MICRON_MARKER ${marker}`, "$CM_ACCEL_VOLT 7.00", "$$SM_WD 10.52", "$$SM_PROBE_CURRENT 1.64e-008",
    "$$SM_SCAN_ROTATION 0.00", "$CM_SIGNAL SEI", "$CM_INSTRUMENT 8530F", "$CM_DATE 2020/08/31", "$CM_TIME 15:32:31", ""]
    .join("\r\n");
}

/** A TESCAN .hdr. */
function tescanText() {
  return ["[MAIN]", "Date=2024-02-07", "Time=10:11:12", "Device=TESCAN SOLARIS X", "ImageStripSize=12",
    "PixelSizeX=5e-09", "PixelSizeY=5e-09", "", "[SEM]", "AcceleratorVoltage=5000.0", "HV=5000", "WD=0.0061",
    "BeamCurrent=1e-10", "StageTilt=55", "ScanRotation=0", "Detector=SE", ""].join("\r\n");
}

/** Thermo Fisher's FeiImage XML, as a Phenom writes it. */
function phenomXml() {
  return '<?xml version="1.0"?><FeiImage xmlns="http://schemas.fei.com/Metadata/v1/2013/07">' +
    "<time>2026-10-29T10:00:00</time><instrument><type>Phenom XL</type></instrument>" +
    '<workingDistance unit="m">0.0049</workingDistance><pixelWidth unit="m">5.555556E-08</pixelWidth>' +
    '<pixelHeight unit="m">5.555556E-08</pixelHeight><highVoltage unit="V">-10000</highVoltage>' +
    "<detector>BSD Full</detector></FeiImage>";
}

/** Hitachi's .txt on an image decoded as a browser decodes a JPEG; on another size; written for another image. */
function checkHitachiText() {
  const browser = metaImage("sample_0001.jpg");
  const hit = api.withMetadataText(browser, hitachiText(), "sample_0001.txt");
  const hc = hit.calibration;
  const half = { ...browser, width: META.w / 2, height: META.h / 2, data: new Float32Array((META.w * META.h) / 4).fill(100) };
  const small = api.withMetadataText(half, hitachiText(), "sample_0001.txt").calibration;
  const other = api.withMetadataText(browser, hitachiText().replace("sample_0001.tif", "other.tif"), "other.txt").calibration;
  check(hit.vendor === "Hitachi" && hc.metadataFile === "sample_0001.txt" && Math.abs(hc.pixelSizeM[0] - 5.512153e-9) < 1e-20
    && hc.highVoltageV === 2000 && Math.abs(hc.workingDistanceM - 8.20667e-3) < 1e-15 && hc.tiltDeg === 12.5
    && hc.tiltCorrectionOn === true && hc.scanRotationDeg === 3 && hc.acquired === "10/29/2026 19:00:54"
    && hc.system === "Hitachi SU8200" && hc.databarRows === 20 && hit.imageRows === META.h - 20 && hc.notes.length === 0
    && !hc.untested && small.pixelSizeM === null && small.notes.length === 1
    && other.notes[0] === "the metadata file was written for other.tif",
  "Hitachi .txt opened with an image decoded as a browser decodes a JPEG: pixel 5.512153 nm, 2 kV, WD 8.20667 mm, stage " +
    "tilt 12.5 deg, tilt compensation on, raster rotation 3 deg, date, data bar found; for an image of another size " +
    "the pixel size is not taken, and a file written for another image is noted");
}

/**
 * JEOL's .txt: the micron bar's pixel size refined to 120 mm / (magnification x width) when that fits it to half a
 * pixel, else as it is; markers in nm, in um with two encodings of the micro sign, and in degrees (none); a data bar
 * below the recorded size.
 */
function checkJeolText() {
  const browser = metaImage("image000.jpg");
  const opened = api.withMetadataText(browser, jeolText(1894, 101, "100um"), "image000.txt");
  const fits = opened.calibration;
  const rough = api.withMetadataText(browser, jeolText(1000, 101, "100um"), "image000.txt").calibration;
  const markers = ["500nm", "1\u03bcm", "1\u00ce\u00bcm", "5deg."]
    .map((m) => api.withMetadataText(browser, jeolText(1000, 101, m), "image000.txt").calibration.pixelSizeM);
  check(opened.vendor === "JEOL" && Math.abs(fits.pixelSizeM[0] - 0.12 / (1894 * 64)) < 1e-20
    && Math.abs(rough.pixelSizeM[0] - 100e-6 / 101) < 1e-20 && fits.untested && opened.imageRows === 80
    && fits.databarRows === 16 && fits.highVoltageV === 7000 && Math.abs(fits.workingDistanceM - 10.52e-3) < 1e-15
    && fits.beamCurrentA === 1.64e-8 && fits.system === "JEOL 8530F" && fits.detector === "SEI"
    && fits.acquired === "2020/08/31 15:32:31" && Math.abs(markers[0][0] - 5e-7 / 101) < 1e-20
    && Math.abs(markers[1][0] - 1e-6 / 101) < 1e-20 && Math.abs(markers[2][0] - 1e-6 / 101) < 1e-20 && markers[3] === null,
  "JEOL .txt: the micron bar's pixel size refined to 120 mm / (magnification x width) where that fits it to half a " +
    "pixel, as it is where not; markers in nm and um (two encodings), none in degrees; data bar below the recorded " +
    "size; 7 kV, WD 10.52 mm, 16.4 nA; marked untested");
}

/** TESCAN's .hdr opened with an image, and the same text in a TIFF tag. */
function checkTescanText() {
  const opened = api.withMetadataText(metaImage("image.jpg"), tescanText(), "image.hdr");
  const tc = opened.calibration;
  const tagged = api.decodeSEMImage(rgbTiff(META.grey, META.w, META.h, { 50431: asciiBytes(tescanText()) }), "tescan.tif");
  check(opened.vendor === "TESCAN" && tc.pixelSizeM[0] === 5e-9 && tc.highVoltageV === 5000 && tc.workingDistanceM === 0.0061
    && tc.beamCurrentA === 1e-10 && tc.tiltDeg === 55 && tc.detector === "SE" && tc.system === "TESCAN SOLARIS X"
    && tc.databarRows === 12 && opened.imageRows === META.h - 12 && tc.untested && tagged.vendor === "TESCAN"
    && tagged.calibration.metadataFile === null && tagged.calibration.databarRows === 12,
  "TESCAN .hdr opened with an image, and the same text in a TIFF tag found by its content: pixel 5 nm, 5 kV, WD 6.1 mm, " +
    "stage tilt 55 deg, info strip of 12 rows; marked untested");
}

/** Thermo Fisher's FeiImage XML (Phenom) in TIFF tag 34683, and the vendor of each text by its content. */
function checkPhenomAndVendors() {
  const phenom = api.decodeSEMImage(rgbTiff(META.grey, META.w, META.h, { 34683: asciiBytes(phenomXml()) }), "phenom.tif");
  const pc = phenom.calibration;
  const vendors = [hitachiText(), jeolText(95, 101, "100um"), tescanText(), phenomXml(),
    "# sem-measurement-tool polygons 1\nname,x_px,y_px\n", "x=1"].map((text) => api.metadataVendor(text));
  check(phenom.vendor === "Phenom" && Math.abs(pc.pixelSizeM[0] - 5.555556e-8) < 1e-20 && pc.highVoltageV === 10000
    && pc.workingDistanceM === 0.0049 && pc.detector === "BSD Full" && pc.system === "Phenom XL" && pc.untested
    && vendors.join() === "Hitachi,JEOL,TESCAN,Phenom,,",
  "Thermo Fisher's FeiImage XML (Phenom) in tag 34683: pixel 55.56 nm, 10 kV, WD 4.9 mm, marked untested; the vendor " +
    `of a text, by its content: ${vendors.map((v) => v ?? "none").join(", ")}`);
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

/**
 * The threshold of a search (E9): on pure noise, a click snaps about as rarely as one sample exceeds k times the median
 * (2^-9 for k = 3), with the radius of a mouse (12) and of a finger (30), where k times the median alone let 19 % and
 * 67 % of clicks snap.  An image more than half clipped to 0 keeps the noise of its unclipped part (the median over
 * |g| > 0, not 0), and clicks there snap no more often than on the same noise unclipped.
 */
function checkSnapThreshold() {
  const size = 300;
  const noise = gaussian(31);
  const image = Float32Array.from({ length: size * size }, () => 1000 + 30 * noise());
  const plain = new api.EdgeMap(image, size, size, 2, 3);
  /** @type {Array<[number, number]>} clicks at least 30 px from the borders */
  const clicks = [];
  for (let y = 30; y < size - 30; y += 15) {
    for (let x = 30; x < size - 30; x += 15) {
      clicks.push([x + 0.3, y + 0.6]);
    }
  }
  const [mouse, finger] = [12, 30].map((r) => clicks.filter(([x, y]) => plain.snap(x, y, r, 3) !== null).length);
  const clipped = new api.EdgeMap(Float32Array.from(image, (v, i) => (i < 160 * size ? 0 : v)), size, size, 2, 3);
  const below = clicks.filter(([, y]) => y > 200);
  const [onClipped, onPlain] = [clipped, plain].map((m) => below.filter(([x, y]) => m.snap(x, y, 12, 3) !== null).length);
  const ratio = clipped.noise / plain.noise;
  check(mouse <= 4 && finger <= 4 && Math.abs(ratio - 1) < 0.25 && onClipped <= onPlain + 1,
    `threshold of a search (E9): of ${clicks.length} clicks on pure noise ${mouse} snap within 12 px and ${finger} ` +
    `within 30 px; an image 53 % clipped to 0 keeps ${ratio.toFixed(2)} of the noise of its unclipped part, and of ` +
    `${below.length} clicks on that part ${onClipped} snap (${onPlain} unclipped)`);
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
    snap: { on: true, sigmaPx: 2.5, median: 5, radiusPx: 15, minContrast: 4, squareProfiles: false, snapMarkers: false },
    measurements: [
      { name: "rib", kind: "contour", color: 0, closed: true, layer: [2, 5], points: [[933.79612, 853.61149], [2136.371, 853.287], [2286.437, 965.003]] },
      { name: "ruler 1", kind: "ruler", color: 1, points: [[1, 2], [3, 4]] },
      { name: 'slab "top", left', kind: "contour", color: 9, closed: false, points: [[100, 965], [2972, 965]] },
      { name: "angle 1", kind: "angle", points: [[1, 2], [3, 4], [5, 7]] },
      { name: "line angle 1", kind: "line-angle", points: [[0, 0], [1, 0], [0, 1], [1, 2]] },
      { name: "profile 1", kind: "profile", points: [[10, 20], [30, 25]], width: 7.25, markers: [[14.123456, 21], [26, 24]] }],
    selected: 2,
    display: [1520, 61200.5],
  };
  const text = api.formatSession(session, "2026-10-23T12:00:00.000Z");
  const back = api.parseSession(text);
  const ms = back.measurements;
  const older = JSON.parse(text);
  delete older.snap.square_profiles;
  delete older.snap.snap_markers;
  const olderSnap = api.parseSession(JSON.stringify(older)).snap;
  const squaredByDefault = olderSnap.squareProfiles === true;
  checkSessionMarkers(text, ms, olderSnap);
  check(JSON.stringify(back.frame) === JSON.stringify(session.frame) && JSON.stringify(back.snap) === JSON.stringify(session.snap)
    && ms.map((m) => m.kind).join() === "contour,ruler,contour,angle,line-angle,profile"
    && worstOf(ms[0].points[0], [933.7961, 853.6115]) === 0 && ms[2].name === 'slab "top", left' && ms[0].closed && !ms[2].closed
    && JSON.stringify([ms[0].layer, ms[2].layer]) === "[[2,5],[1,0]]" && ms[1].closed === undefined
    && ms[5].width === 7.25 && ms[1].width === undefined && text.includes('"width_px": 7.25')
    && back.selected === 2 && back.image.sha256 === IMAGE.sha256 && text.includes("[933.7961, 853.6115]")
    && back.display.join() === "1520,61200.5"
    && api.parseSession(api.formatSession({ ...session, display: null, selected: -1 }, "x")).display === null
    && api.parseSession(api.formatSession({ ...session, selected: -1 }, "x")).selected === -1
    && ms.map((m) => m.color).join() === "0,1,9,3,4,5"
    && text.includes('"square_profiles": false') && squaredByDefault,
  "session round trip: frame, snap settings (squaring profiles: absent, on), the measurements in " +
    "their order with contours among them (points to 1e-4 px, closed flags, GDS layers, 1/0 by default), a profile's band " +
    "width, colours (absent: the place in the list), the selected one (none: -1), display levels (absent: Auto)");
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
    { ...good, measurements: [{ name: "p", kind: "profile", points_px: [[0, 0], [9, 0]], markers_px: [[1, 0], [2, 0], [3, 0]] }] },
    { ...good, measurements: [{ name: "p", kind: "profile", points_px: [[0, 0], [9, 0]], markers_px: [[1, "x"]] }] },
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
    "colour, three markers, a marker not a pair of numbers)");
}

/**
 * A profile's markers A, B in the session of checkSession: written as markers_px to 1e-4 px and read back; none
 * written for the other kinds of measurement; the switch that snaps them written, and on when absent.
 * @param {string} text   the session file
 * @param {Array<object>} ms   its measurements read back, the profile last
 * @param {object} olderSnap   the snap settings read from the file without square_profiles and snap_markers
 */
function checkSessionMarkers(text, ms, olderSnap) {
  const written = JSON.parse(text).measurements;
  const others = written.slice(0, -1).every((m) => !("markers_px" in m));
  check(JSON.stringify(ms[5].markers) === "[[14.1235,21],[26,24]]" && ms[1].markers === undefined && others
    && JSON.stringify(written[5].markers_px) === "[[14.1235,21],[26,24]]" && text.includes('"snap_markers": false')
    && olderSnap.snapMarkers === true,
  "session: a profile's markers A, B kept as markers_px to 1e-4 px and read back, none written for other kinds; " +
    "snapping markers written, and on when absent");
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

/** The full scale the profile plot marks: 2^bits - 1 for whole numbers, 255 for a palette, the largest value for floats. */
function checkFullScale() {
  const cases = [["uint8", 8], ["uint8 (browser decoded)", 8], ["uint8 colour", 8], ["uint8 grey palette", 8],
    ["uint16", 16], ["uint16 inverted", 16], ["uint16 colour", 16], ["uint16 colour palette", 16], ["uint32", 32],
    ["float32", 32], ["float32 inverted", 32]];
  const got = cases.map(([type, bits]) => api.fullScale(type, bits, 1234.5)).join(" ");
  check(got === "255 255 255 255 65535 65535 65535 255 4294967295 1234.5 1234.5",
    `full scale for the profile plot: ${got} for ${cases.map(([type]) => type).join(", ")}: 2^bits - 1 for whole ` +
    "numbers, 255 for a palette, whose colour map gives 0 to 255, and for floats the largest value (here 1234.5)");
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

/**
 * sampleProfile's tuned loop against the plain one, bilinear() at every value: bit for bit, on noise, for bands inside
 * the image, across its left edge and the info bar, ending on the last column and just before it, along a column to
 * the last row above the bar, and in a tilted, turned frame.
 */
function checkProfileFastPath() {
  const [w, h, rows] = [64, 48, 40];
  const noise = gaussian(41);
  const image = { data: Float32Array.from({ length: w * h }, () => 1000 + 300 * noise()), width: w, imageRows: rows };
  const plain = (g) => {
    const n = g.samples;
    const out = { mean: [], spread: [], count: [] };
    for (let i = 0; i < n; i++) {
      const f = n > 1 ? i / (n - 1) : 0;
      const x = g.band.start[0] + f * g.band.d[0];
      const y = g.band.start[1] + f * g.band.d[1];
      const values = g.offsets.map(([ox, oy]) => api.bilinear(image.data, w, rows, x + ox, y + oy)).filter((v) => !Number.isNaN(v));
      const k = values.length;
      let sum = 0;
      values.forEach((v) => { sum += v; });
      const mean = k > 0 ? sum / k : NaN;
      let squares = 0;
      values.forEach((v) => { squares += (v - mean) ** 2; });
      out.mean.push(mean);
      out.spread.push(k > 0 ? Math.sqrt(squares / k) : NaN);
      out.count.push(k);
    }
    return out;
  };
  const bands = [[[[5, 6], [55, 30]], 9, PLAIN], [[[-4, 20], [30, 44]], 7, PLAIN], [[[10, 12], [w - 1, 12]], 1, PLAIN],
    [[[10, 12], [w - 1 - 1e-9, 12]], 1, PLAIN], [[[20, 2], [20, rows - 1]], 5, PLAIN], [[[8, 8], [50, 30]], 6, SLANTED]];
  const same = bands.filter(([points, width, frame]) => {
    const g = api.profileGeometry(points, width, frame);
    const [a, b] = [plain(g), api.sampleProfile(image, g)];
    return ["mean", "spread", "count"].every((key) => a[key].every((v, i) => Object.is(v, b[key][i])));
  }).length;
  check(same === bands.length,
    `profile sampling (P4): the tuned loop gives, bit for bit, the values of bilinear() at every value in ${same} of ` +
    `${bands.length} bands: inside, across the left edge and the info bar, ending on the last column and just before ` +
    "it, along a column to the last row above the bar, and in a tilted, turned frame");
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
  // markers: B at x = 20.5 on the line (t = 0.775, 0.031 um, mean 2 x + 35 = 76), A off the line at x = 8.25 (t = 0.1625)
  const ms = { name: "profile 1", kind: "profile", points: [[5, 10], [25, 10]], width: 3, markers: [[8.25, 13], [20.5, 10]] };
  const p = api.sampleProfile(ramp, api.profileGeometry(ms.points, ms.width, frame));
  const text = api.formatProfileFile(IMAGE, frame, ms, p, [{ name: "square", distance: 0.01 }, { name: "square", distance: 0.03 }]);
  const lines = text.split("\n");
  const rows = lines.filter((l) => l !== "" && !l.startsWith("#"));
  const has = (line) => lines.includes(line);
  check(lines[0] === "# sem-measurement-tool profile 1" && has("# profile: profile 1") && has("# band_width_px: 3")
    && has("# length: 0.040000") && has("# band_width: 0.006000") && has("# samples: 21") && has("# lines_across: 3")
    && has("# crossing: 0.010000 square") && has("# crossing: 0.030000 square") && has("# unit: um")
    && has("# marker: A 0.006500 51.5") && has("# marker: B 0.031000 76") && has("# marker_distance: 0.024500")
    && rows[0] === "distance,mean,std,count,x_px,y_px" && rows.length === 22 && rows[1] === "0.000000,45,2.4494897,3,5.000,10.000",
  "profile file: header with the line, its band (3 view px, 0.006 um), samples, lines, crossings, and markers A, B (one " +
    "off the line, taken where it projects) with the mean there and the distance between them; rows of distance, mean, " +
    "spread across the band (sqrt 6 over rows 9-11), count and position");
}

/**
 * Markers (P12): a marker's place along the line, a point off it taken where it projects in a tilted, turned frame
 * and points beyond the ends held to them; the mean between samples.  Snapping (P13): see checkMarkerSnapping.
 */
function checkProfileMarkers() {
  const v = api.viewMatrix(SLANTED);
  const points = [[10, 20], [70, 45]];
  const along = (t) => [10 + t * 60, 20 + t * 25];
  const [dx, dy] = api.matApply(v, 60, 25);
  const across = api.matApply(api.matInverse(v), (-dy / Math.hypot(dx, dy)) * 7, (dx / Math.hypot(dx, dy)) * 7);
  const off = (t) => [along(t)[0] + across[0], along(t)[1] + across[1]];      // 7 view units across the line
  const places = [0.37, 0.9].map((t) => api.markerPlace(points, off(t), SLANTED));
  const held = [-0.2, 1.3].map((t) => api.markerPlace(points, along(t), SLANTED));
  const placed = Math.abs(places[0] - 0.37) < 1e-12 && Math.abs(places[1] - 0.9) < 1e-12 && held.join() === "0,1";
  const values = [0, 0.125, 0.25, 0.5, 0.625, 1].map((t) => api.profileValueAt({ mean: Float64Array.from([10, 20, 30, NaN, 50]) }, t));
  const between = values.slice(0, 4).join() === "10,15,20,30" && Number.isNaN(values[4]) && values[5] === 50;
  check(placed && between,
    "markers (P12): a point 7 view units off the line in a tilted, turned frame placed where it projects (0.37, 0.9), " +
    "beyond the ends held to 0 and 1; the mean between samples, none next to a missing one");
}

/** An erf edge from 50 to 150 at ``at``, of the width ``w`` samples, over ``n`` samples, plus noise() times ``sd``. */
function erfEdge(n, at, w, sd, noise) {
  return Float64Array.from({ length: n }, (_, i) => 100 + 50 * erf((i - at) / (Math.SQRT2 * w)) + sd * noise());
}

/** Rising erf steps [place, height, width] from 100, over ``n`` samples, plus noise() times ``sd``. */
function erfSteps(n, list, sd, noise) {
  return Float64Array.from({ length: n }, (_, i) => 100 + sd * noise()
    + list.reduce((sum, [at, height, w]) => sum + (height / 2) * (1 + erf((i - at) / (Math.SQRT2 * w))), 0));
}

/** (P13) with the edge map's sigma of 2 samples, 3 noise and a tolerance of 2 samples; a window of 12 by default. */
function snapMarker(mean, at, radius = 12) {
  return api.snapToSlope(mean, at, radius, 2, 3, 2);
}

/** How far a marker settled from x: Infinity when it stayed. */
function offBy(r, x) {
  return r === null ? Infinity : Math.abs(r.at - x);
}

/**
 * Snapping markers (P13), the edge map's sigma of 2 samples, 3 noise, a window of 12 samples, a tolerance of 2: a sharp
 * edge found from either side, nearly clean and noisy; a gradual noisy edge, over 40 noisy profiles, at the scale of
 * its width, and left where it was put when no scale places it within 2 samples; a bright line's nearer flank from
 * either side; the two edges of a ridge 20 samples wide, unpulled by each other; rarely a slope in noise alone; none
 * across a missing value.  A profile without any noise has none to measure a slope against: the "clean" ones carry
 * 0.05 % of their step.
 */
function checkMarkerSnapping() {
  const noise = gaussian(77);
  const clean = erfEdge(120, 40.3, 1.5, 0.05, noise);
  const noisy = erfEdge(120, 40.3, 1.5, 2, noise);
  const sharp = [snapMarker(clean, 33), snapMarker(noisy, 33), snapMarker(noisy, 48)].map((r) => offBy(r, 40.3));
  const gradual = Array.from({ length: 40 }, (_, s) => snapMarker(erfEdge(240, 120.4, 8, 10, gaussian(1 + s)), 114))
    .filter((r) => r !== null);
  const gradualErrors = gradual.map((r) => offBy(r, 120.4)).sort((a, b) => a - b);
  const scales = gradual.map((r) => r.sigma).sort((a, b) => a - b);
  const lineNoise = gaussian(9);
  const line = Float64Array.from({ length: 200 }, (_, i) => 100 + 80 * Math.exp(-((i - 100) ** 2) / 18) + 0.05 * lineNoise());
  const flanks = [92, 99, 101, 108].map((at) => snapMarker(line, at)?.at ?? NaN);
  const ridgeNoise = gaussian(101);
  const ridge = Float64Array.from({ length: 240 }, (_, i) => 100 + 25 * (erf((i - 100) / (Math.SQRT2 * 2))
    - erf((i - 120) / (Math.SQRT2 * 2))) + 3 * ridgeNoise());
  const ridgeErrors = [offBy(snapMarker(ridge, 97), 100), offBy(snapMarker(ridge, 123), 120)];
  const flat = Float64Array.from({ length: 2000 }, () => 100 + 2 * noise());
  const falseSnaps = Array.from({ length: 79 }, (_, j) => snapMarker(flat, 25 + 25 * j)).filter((r) => r !== null).length;
  const gap = Float64Array.from(clean);
  gap[38] = Number.NaN;
  const missing = snapMarker(gap, 40, 3);
  // a bright line of standard deviation 3 smoothed by 2 has its steepest points at 100 -+ sqrt(13)
  const flank = Math.sqrt(13);
  const flanksRight = Math.abs(flanks[0] - (100 - flank)) < 0.1 && Math.abs(flanks[1] - (100 - flank)) < 0.1
    && Math.abs(flanks[2] - (100 + flank)) < 0.1 && Math.abs(flanks[3] - (100 + flank)) < 0.1;
  const middle = gradualErrors[gradualErrors.length >> 1];
  const wide = gradualErrors.filter((e) => e > 3).length;   // a noise peak beside the click taken for the edge: rare
  check(sharp[0] < 0.02 && sharp[1] < 0.2 && sharp[2] < 0.2 && gradual.length >= 30 && middle < 1 && wide <= 2
    && scales[scales.length >> 1] >= 4 && flanksRight && Math.max(...ridgeErrors) < 0.6 && falseSnaps <= 10
    && missing === null,
  `snapping markers (P13): a sharp edge at 40.3 found from 7 samples before and after, ${sharp.map((e) => e.toFixed(3))
    .join(", ")} samples off (nearly clean, noisy, noisy); a gradual edge of width 8 with noise of 10 % of the step, ` +
    `placed in ${gradual.length} of 40 profiles, ${middle.toFixed(2)} samples off at the median, ${wide} more than 3 ` +
    `off (at worst ${gradualErrors[gradualErrors.length - 1].toFixed(2)}), at the median scale ${scales[scales.length >> 1]
      .toFixed(2)}; a bright line's flanks, the nearer from either side, at ${flanks.map((f) => f.toFixed(2)).join(", ")}; ` +
    `a ridge 20 wide, its edges ${ridgeErrors.map((e) => e.toFixed(2)).join(" and ")} samples off; in noise alone ` +
    `${falseSnaps} of 79 windows snap; none across a missing value`);
}

/**
 * Snapping markers (P13) beside other edges: of two rising steps 10, 14 or 18 samples apart, the one clicked, not the
 * place between where the coarse scales merge them; a weak sharp step, not a strong gradual one 24 samples on that
 * the coarse scales favour, in windows of 12, 24 and 60 samples; a noisy bright line's nearer flank, unpulled by the
 * other.  100 noisy profiles each.
 */
function checkMarkerNeighbours() {
  const runs = 100;
  const stairs = [10, 14, 18].map((apart) => Array.from({ length: runs }, (_, k) =>
    offBy(snapMarker(erfSteps(300, [[100, 40, 1], [100 + apart, 40, 1]], 6, gaussian(1000 + k)), 100), 100)));
  const taken = [12, 24, 60].map((radius) => Array.from({ length: runs }, (_, k) =>
    offBy(snapMarker(erfSteps(400, [[100, 20, 1], [124, 60, 6]], 3, gaussian(2000 + k)), 100, radius), 100)));
  const flank = Math.sqrt(13);
  const line = Array.from({ length: runs }, (_, k) => {
    const g = gaussian(500 + k);
    const mean = Float64Array.from({ length: 200 }, (_v, i) => 100 + 80 * Math.exp(-((i - 100) ** 2) / 18) + 2 * g());
    return [offBy(snapMarker(mean, 96), 100 - flank), offBy(snapMarker(mean, 104), 100 + flank)];
  }).flat();
  const worst = (errors) => Math.max(...errors);
  const stayed = (errors) => errors.filter((e) => e === Infinity).length;
  const placed = (errors) => errors.filter((e) => e !== Infinity);
  // steps 10 apart with noise of 15 % of each are barely told apart at the finest scale: a rare one merges
  const merged = stairs.map((e) => placed(e).filter((v) => v > 2).length);
  check(merged[0] <= 2 && merged[1] === 0 && merged[2] === 0 && stairs.every((e) => stayed(e) <= 2)
    && taken.every((e) => worst(placed(e)) <= 2 && stayed(e) === 0) && worst(placed(line)) <= 2 && stayed(line) === 0,
  `snapping markers beside other edges (P13), ${runs} noisy profiles each: two rising steps 10, 14 and 18 apart, the ` +
    `first clicked, ${merged.join(", ")} more than 2 samples off (${stairs.map(stayed).join(", ")} stay; at ` +
    `separation 14 and 18 at worst ${worst(placed(stairs[1])).toFixed(2)} and ${worst(placed(stairs[2])).toFixed(2)}); ` +
    `a weak sharp step with a strong gradual one 24 on, windows 12, 24 and 60, ${taken.map((e) =>
      worst(placed(e)).toFixed(2)).join(", ")} off at worst; a noisy bright line's nearer flank, ` +
    `${worst(placed(line)).toFixed(2)} off at worst of ${line.length}`);
}

/**
 * Snapping markers (P13) where the data end or carry no noise: an edge within K samples of an end, or of missing
 * samples, is where the slopes stop, not a peak, and the marker stays; an edge clear of them but within the coarsest
 * K is placed; a profile mostly clipped (exactly constant) or mostly quieter does not lower the noise of the rest,
 * where clicks stay as on noise alone; a ramp of constant slope 60 samples long has no steepest point, and most
 * clicks there stay.
 */
function checkMarkerDataEnds() {
  const nearStart = snapMarker(erfSteps(200, [[3, 40, 1]], 2, gaussian(5)), 5);
  const gapped = erfSteps(200, [[60, 40, 1]], 2, gaussian(5));
  gapped.fill(Number.NaN, 0, 57);
  const nearGap = snapMarker(gapped, 62);
  const clear = snapMarker(erfSteps(200, [[20, 40, 1]], 2, gaussian(5)), 21);
  const rest = (quiet) => {
    const g = gaussian(11);
    const mean = Float64Array.from({ length: 400 }, (_, i) => (i < 250 ? quiet * g() : 20 + 2 * g()));
    return Array.from({ length: 26 }, (_, k) => snapMarker(mean, 280 + 4 * k)).filter((r) => r !== null).length;
  };
  const [clipped, quieter] = [rest(0), rest(0.5)];
  const ramps = Array.from({ length: 50 }, (_, k) => {
    const g = gaussian(3000 + k);
    const mean = Float64Array.from({ length: 300 }, (_v, i) => 100 + 40 * Math.min(1, Math.max(0, (i - 120) / 60)) + 1.2 * g());
    return snapMarker(mean, 150);
  }).filter((r) => r !== null).length;
  check(nearStart === null && nearGap === null && clear !== null && Math.abs(clear.at - 20) < 0.2 && clipped <= 1
    && quieter <= 1 && ramps <= 5,
  `snapping markers where the data end (P13): a step 3 samples from the start, clicked at 5, ${nearStart === null
    ? "stays" : `to ${nearStart.at.toFixed(2)}`}; one beside 57 missing samples ${nearGap === null ? "stays" : "moves"}; one 20 ` +
    `from the start, within the coarsest K, ${clear === null ? "stays" : `at ${clear.at.toFixed(2)}`}; 26 clicks on the ` +
    `noise of a profile 62 % clipped snap ${clipped} times, of one 62 % quieter ${quieter}; 50 clicks on ramps of ` +
    `constant slope ${ramps}`);
}

/** A square image whose value at stored u is f(q), q = V (u - c) its place in the view frame (G11), plus noise(). */
function viewImage(size, c, frame, f, noise) {
  const v = api.viewMatrix(frame);
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [qx, qy] = api.matApply(v, x - c[0], y - c[1]);
      out[y * size + x] = f(qx, qy) + noise();
    }
  }
  return out;
}

/** erf to 1.5e-7 (Abramowitz and Stegun 7.1.26). */
function erf(x) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))))
    * Math.exp(-x * x);
  return x < 0 ? -y : y;
}

/** The angle between two lines, whatever their sense: 0 to 90 degrees, by atan2 to keep small angles exact (1.10). */
function lineAngle(a, b) {
  return Math.atan2(Math.abs(a[0] * b[1] - a[1] * b[0]), Math.abs(a[0] * b[0] + a[1] * b[1])) / DEG;
}

function checkEdgeNormal() {
  // edges whose normal n makes 25 deg with x in the view of a tilted, turned frame of 2 x 3 nm pixels, the
  // step 400 grey values over 1.5 view units, noise 20 per pixel; the tensor over rho = 4 px at a point on the edge
  const [size, c] = [160, [80, 80]];
  const n = [Math.cos(25 * DEG), Math.sin(25 * DEG)];
  const across = (qx, qy) => qx * n[0] + qy * n[1];
  const map = (f, seed) => {
    const noise = gaussian(seed);
    return new api.EdgeMap(viewImage(size, c, SLANTED, f, () => 20 * noise()), size, size, 2, 3);
  };
  const step = map((qx, qy) => 100 + 200 * (1 + Math.tanh(across(qx, qy) / 1.5)), 7);
  const tensor = step.structureTensor(c[0], c[1], 4);
  const found = api.edgeNormal(tensor, SLANTED);
  // the stored grid's own normal, taken as a direction there, is not square in the view
  const theta = 0.5 * Math.atan2(2 * tensor[1], tensor[0] - tensor[2]);
  const naive = api.matApply(api.viewMatrix(SLANTED), Math.cos(theta), Math.sin(theta));
  // a bright line: its two flanks have opposite gradients, which cancel in a sum of vectors but not of g g^T
  const line = map((qx, qy) => 100 + 400 * Math.exp(-(across(qx, qy) ** 2) / 4.5), 8);
  const onLine = api.edgeNormal(line.structureTensor(c[0], c[1], 4), SLANTED);
  let [sx, sy, sm] = [0, 0, 0];
  for (let y = c[1] - 12; y <= c[1] + 12; y++) {
    for (let x = c[0] - 12; x <= c[0] + 12; x++) {
      const weight = Math.exp(-((x - c[0]) ** 2 + (y - c[1]) ** 2) / 32);
      const i = y * size + x;
      sx += weight * line.gx[i];
      sy += weight * line.gy[i];
      sm += weight * Math.hypot(line.gx[i], line.gy[i]);
    }
  }
  // a corner of two edges square to each other: no single direction
  const corner = map((qx, qy) => 100 + 100 * (1 + Math.tanh(qx / 1.5)) * (1 + Math.tanh(qy / 1.5)), 9);
  const atCorner = api.edgeNormal(corner.structureTensor(c[0], c[1], 4), SLANTED);
  const [eStep, eNaive, eLine] = [lineAngle(found.normal, n), lineAngle(naive, n), lineAngle(onLine.normal, n)];
  check(eStep < 1 && found.coherence > 0.9 && eNaive > 3 && eLine < 1.5 && onLine.coherence > 0.9
    && Math.hypot(sx, sy) / sm < 0.2 && atCorner.coherence < 0.5,
  `edge normal (P7)-(P9) in a tilted, turned frame of 2 x 3 nm pixels, noise 20 % of the step: a step within ` +
    `${eStep.toFixed(2)} deg (coherence ${found.coherence.toFixed(3)}), where the stored grid's own normal is off by ` +
    `${eNaive.toFixed(1)} deg; a bright line within ${eLine.toFixed(2)} deg (coherence ${onLine.coherence.toFixed(3)}), ` +
    `its gradient vectors summing to ${(100 * Math.hypot(sx, sy) / sm).toFixed(1)} % of their lengths; a corner ` +
    `refused, coherence ${atCorner.coherence.toFixed(3)}`);
}

function checkEdgeNormalExpected() {
  // The tensor a straight edge gives on average: S e e^T for its stored gradient's direction e, plus N I from the
  // noise, whose two components have one variance and no covariance (2.3).  Solved on the stored grid, the normal
  // is the view's covector V^-T e exactly and the coherence (S / (S + 2N))^2, in a frame that stretches 3 times;
  // in the view the noise would become N V^-T V^-1, and favour a direction.
  const frame = { ...PLAIN, correction: "custom", customFactor: 3, axisDeg: 15, rotationDeg: 10 };
  const vi = api.matInverse(api.viewMatrix(frame));
  const [S, N] = [10, 1];
  let [worstAngle, worstCoherence] = [0, 0];
  for (let deg = 0; deg < 180; deg += 5) {
    const e = [Math.cos(deg * DEG), Math.sin(deg * DEG)];
    const found = api.edgeNormal([S * e[0] * e[0] + N, S * e[0] * e[1], S * e[1] * e[1] + N], frame);
    worstAngle = Math.max(worstAngle, lineAngle(found.normal, [vi[0] * e[0] + vi[2] * e[1], vi[1] * e[0] + vi[3] * e[1]]));
    worstCoherence = Math.max(worstCoherence, Math.abs(found.coherence - (S / (S + 2 * N)) ** 2));
  }
  check(worstAngle < 1e-9 && worstCoherence < 1e-12,
    "the tensor of a straight edge with noise, on average (S e e^T + N I): its normal is the covector V^-T e to " +
    `${worstAngle.toExponential(1)} deg and its coherence (S / (S + 2N))^2 in every direction, in a frame that ` +
    "stretches 3 times (P7)-(P9)");
}

function checkEdgeNormalNoise() {
  // 100 noisy images of each edge, of every direction, in the plain view (V = diag(1, -1)); sigma 2 without the
  // median, as (E4) assumes; at the strongest point along a line square to the edge, as the app finds it: one
  // gradient there (bilinear), the Gaussian-weighted sum of the gradient vectors over the tensor's window
  // (rho = 2 sigma, out to 3 rho), and the tensor
  const [size, rho] = [64, 4];
  const u = random(31);
  const noise = gaussian(32);
  const rms = (a) => Math.sqrt(a.reduce((sum, x) => sum + x * x, 0) / a.length);
  const scatter = (profile) => {
    const [one, sum, tensor] = [[], [], []];
    for (let k = 0; k < 100; k++) {
      const psi = Math.PI * u();
      const n = [Math.cos(psi), Math.sin(psi)];
      const c = [size / 2 + u() - 0.5, size / 2 + u() - 0.5];
      const edges = new api.EdgeMap(viewImage(size, c, PLAIN, (qx, qy) => profile(qx * n[0] + qy * n[1]), noise),
        size, size, 2, 0);
      let [best, p] = [-1, c];
      for (let t = -20; t <= 20; t += 0.5) {
        const q = [c[0] + t * n[0], c[1] - t * n[1]];          // V^-1 n: the line square to the edge
        if (edges.sample(q[0], q[1]) > best) {
          [best, p] = [edges.sample(q[0], q[1]), q];
        }
      }
      const [x0, y0] = [Math.floor(p[0]), Math.floor(p[1])];
      const [fx, fy] = [p[0] - x0, p[1] - y0];
      const at = (a) => (1 - fy) * ((1 - fx) * a[y0 * size + x0] + fx * a[y0 * size + x0 + 1])
        + fy * ((1 - fx) * a[(y0 + 1) * size + x0] + fx * a[(y0 + 1) * size + x0 + 1]);
      one.push(lineAngle([at(edges.gx), -at(edges.gy)], n));    // the view's covector V^-T g
      let [sx, sy] = [0, 0];
      const reach = Math.ceil(3 * rho);
      for (let y = Math.max(0, y0 - reach); y <= Math.min(size - 1, y0 + 1 + reach); y++) {
        for (let x = Math.max(0, x0 - reach); x <= Math.min(size - 1, x0 + 1 + reach); x++) {
          const weight = Math.exp(-((x - p[0]) ** 2 + (y - p[1]) ** 2) / (2 * rho * rho));
          sx += weight * edges.gx[y * size + x];
          sy -= weight * edges.gy[y * size + x];
        }
      }
      sum.push(lineAngle([sx, sy], n));
      tensor.push(lineAngle(api.edgeNormal(edges.structureTensor(p[0], p[1], rho), PLAIN).normal, n));
    }
    return [rms(one), rms(sum), rms(tensor)];
  };
  // a step of 2 noise units, blurred over b = 2 px: SNR 2 * 2 sigma^2 / sqrt(b^2 + sigma^2) = 5.66, 1 / SNR = 10.1 deg
  const step = scatter((x) => 1 + erf(x / (2 * Math.SQRT2)));
  // a bright line of 5 noise units and 0.7 px standard deviation: its two flanks lie within the window
  const line = scatter((x) => 5 * Math.exp(-(x * x) / (2 * 0.49)));
  const snr = (2 * 2 * 4) / Math.sqrt(8);
  check(Math.abs(step[0] * DEG * snr - 1) < 0.2 && step[2] < 0.5 * step[0] && line[2] < 0.5 * line[1],
    `the edge's direction over 100 noisy images (RMS): on a step at SNR ${snr.toFixed(2)} (E4), one gradient ` +
    `${step[0].toFixed(2)} deg (1 / SNR: ${(1 / snr / DEG).toFixed(2)}), the sum of gradient vectors ` +
    `${step[1].toFixed(2)}, the tensor ${step[2].toFixed(2)}; on a bright line of 0.7 px standard deviation, one gradient ` +
    `${line[0].toFixed(2)} deg, the sum of gradient vectors ${line[1].toFixed(2)}, the tensor ${line[2].toFixed(2)}`);
}

function checkSquaredProfile() {
  const v = api.viewMatrix(SLANTED);
  const view = (p, q) => api.matApply(v, q[0] - p[0], q[1] - p[1]);
  const points = [[10, 20], [70, 45]];
  const pivot = [10 + 0.3 * 60, 20 + 0.3 * 25];
  const n = [Math.cos(100 * DEG), Math.sin(100 * DEG)];
  const r = api.squaredProfile(points, pivot, n, SLANTED);
  const before = view(points[0], points[1]);
  const after = view(r.points[0], r.points[1]);
  const [l0, l1] = [Math.hypot(...before), Math.hypot(...after)];
  const p = view(r.points[0], pivot);
  const t = (p[0] * after[0] + p[1] * after[1]) / (l1 * l1);
  const offLine = Math.abs(p[0] * after[1] - p[1] * after[0]) / l1;
  const parallel = Math.abs(after[0] * n[1] - after[1] * n[0]) / l1;
  const sense = before[0] * after[0] + before[1] * after[1] > 0;
  check(Math.abs(l1 - l0) < 1e-9 * l0 && Math.abs(t - 0.3) < 1e-9 && offLine < 1e-9 && parallel < 1e-12 && sense
    && Math.abs(lineAngle(before, after) - r.turnedDeg) < 1e-9,
  `squared profile (P11): along the normal in the view, through the pivot, the same length in the view, the pivot ` +
    `still 0.3 along it and the same sense; turned ${r.turnedDeg.toFixed(3)} deg, as measured`);
  const [a, b] = [[12, 40], [55, 31]];
  const sn = api.segmentNormal(a, b, SLANTED);
  const e = view(a, b);
  const square = Math.abs(sn[0] * e[0] + sn[1] * e[1]) / Math.hypot(...e);
  const crossed = api.profileCrossings([[5, 10], [25, 10]], [{ closed: true, points: [[10, 5], [20, 5], [20, 15], [10, 15]] }]);
  check(square < 1e-12 && Math.abs(Math.hypot(...sn) - 1) < 1e-12
    && crossed.map((x) => `${x.segment}@${x.t}`).join(" ") === "3@0.25 1@0.75",
  "a contour segment's normal (P10) is square to it in the view of a tilted, turned frame; crossings name the segment " +
    "crossed (a square's closing side at 0.25, its right side at 0.75)");
}

/**
 * Turning about the end not moved: (P11) with the pivot at an end keeps that end, and on a straight edge the crossing
 * slides along it by s sin(delta) and comes to s cos(delta) from the end kept, in a tilted, turned frame.
 */
function checkSquaredAboutEnd() {
  const v = api.viewMatrix(SLANTED);
  const view = (p, q) => api.matApply(v, q[0] - p[0], q[1] - p[1]);
  const [c0, along] = [[40, 30], [7, 23]];                         // the edge: a straight line through c0, stored
  const n = api.segmentNormal(c0, [c0[0] + along[0], c0[1] + along[1]], SLANTED);
  const cross = (p, q) => {                                        // where the line from p to q meets the edge
    const d = [q[0] - p[0], q[1] - p[1]];
    const t = ((c0[0] - p[0]) * along[1] - (c0[1] - p[1]) * along[0]) / (d[0] * along[1] - d[1] * along[0]);
    return [p[0] + t * d[0], p[1] + t * d[1]];
  };
  const [a, b] = [[10, 20], [70, 45]];
  const c = cross(a, b);
  const s = Math.hypot(...view(a, c));
  const ab = view(a, b);
  const delta = Math.acos(Math.abs(ab[0] * n[0] + ab[1] * n[1]) / Math.hypot(...ab));
  const first = api.squaredProfile([a, b], a, n, SLANTED);        // b dragged, a its first end kept: t = 0
  const second = api.squaredProfile([b, a], a, n, SLANTED);       // the same with a its second end: t = 1
  const c1 = cross(first.points[0], first.points[1]);
  const slide = Math.hypot(...view(c, c1));
  const near = Math.hypot(...view(a, c1));
  const kept = first.points[0][0] === a[0] && first.points[0][1] === a[1]
    && Math.hypot(...view(second.points[1], a)) < 1e-12 * Math.hypot(...ab);
  check(kept && Math.abs(slide - s * Math.sin(delta)) < 1e-9 * s && Math.abs(near - s * Math.cos(delta)) < 1e-9 * s
    && Math.abs(first.turnedDeg - delta / DEG) < 1e-9,
  "turned about the end not moved (P11 with t = 0 or 1): that end kept, and on a straight edge in a tilted, turned " +
    `frame the crossing slides along it by s sin(delta) = ${(s * Math.sin(delta)).toFixed(4)} and comes to ` +
    `s cos(delta) = ${(s * Math.cos(delta)).toFixed(4)} from that end (s = ${s.toFixed(4)}, delta = ` +
    `${(delta / DEG).toFixed(2)} deg)`);
}

const images = testImages(process.argv.slice(2));
checkFei(images.feiFolder);
checkZeiss(images.zeiss);
checkHitachi(images.hitachiFolder, images.hitachiBarRows);
checkHitachiSynthetic();
checkHitachiText();
checkJeolText();
checkTescanText();
checkPhenomAndVendors();
checkInfoZone();
checkEdges();
checkSnapThreshold();
checkGeometry();
checkPolygonFile();
checkMeasurementFile();
checkSession();
checkGdsReals();
checkGdsFile();
checkVertexOps();
checkHistogram();
checkFullScale();
checkSliders();
checkLevels();
checkProfileSampling();
checkProfileFastPath();
checkProfileBand();
checkProfileCrossings();
checkProfileFile();
checkProfileMarkers();
checkMarkerSnapping();
checkMarkerNeighbours();
checkMarkerDataEnds();
checkEdgeNormal();
checkEdgeNormalExpected();
checkEdgeNormalNoise();
checkSquaredProfile();
checkSquaredAboutEnd();
console.log(failures.length ? `FAIL: ${failures.length} check(s)` : "PASS");
process.exit(failures.length ? 1 : 0);
