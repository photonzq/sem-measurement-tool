"use strict";
/* exported parseFeiText, parseZeissText, parseKeyValueText, parseJeolText, feiCalibration, zeissCalibration,
   hitachiCalibration, jeolCalibration, tescanCalibration, phenomCalibration, emptyCalibration, describeCalibration */
/*
 * Metadata of SEM images, and the calibration taken from it.
 *
 * FEI / Thermo Fisher (Helios, Scios, Quanta, ...): TIFF tag 34682 ("FEI_HELIOS") or, on older
 * systems, 34680 ("FEI_SFEG") holds INI text: [Section] headers and key=value lines, lengths in
 * metres, angles in radians.
 *   pixel size       [Scan] PixelWidth / PixelHeight, or [EScan] / [IScan]; absent for images
 *                    of the chamber camera ([Beam] Beam = OBeam), which stay in pixels
 *   data bar         the TIFF holds [Image] ResolutionY rows of image, then the data bar; the
 *                    bar has (TIFF rows - ResolutionY) rows.  It stays in the image; the
 *                    processing (contrast, edge map, snapping) ignores it.  [PrivateFei]
 *                    DatabarHeight is not used: it reads 0 in Helios 5 UX files with a 140-row bar
 *   stage tilt       [Stage] StageT (rad), else StageTa of the beam section
 *   tilt correction  TiltCorrectionIsOn / TiltCorrectionAngle of the beam section: when on, the
 *                    microscope has already stretched the image vertically
 *
 * Zeiss (SmartSEM: Gemini, Sigma, Auriga, ...): TIFF tag 34118 ("CZ_SEM") holds text lines: first
 * unnamed numbers (in the files seen: an index, the pixel size in metres, magnification, ...),
 * then pairs of lines, a key such as AP_PIXEL_SIZE and its "Label = value unit" (or "Label:
 * value" for date and time).  The info zone is drawn over the image and not recorded; tiff.js
 * finds it in the pixels (Z1) and sets databarRows.
 *   pixel size       AP_PIXEL_SIZE (e.g. "Pixel Size = 10.97 nm"); the unnamed header holds the
 *                    same in metres with more digits, used when the two agree within 1 %
 *   stage tilt       AP_STAGE_AT_T (deg)
 *   tilt correction  DP_TILT_CORRECTION (On/Off) and AP_TILT_ANGLE (deg)
 *   scan rotation    AP_SCANROTATION (deg), active when DP_SCAN_ROT is On
 *
 * Hitachi (SU8200, ...): the full [SemImageFile] text, key=value lines, goes to a .txt file of the
 * image's name beside it.  Part of it is also in TIFF tag 40092, the Windows "XPComment" tag (UTF-16
 * text), with the instrument in tag 40093, "XPAuthor".  The .txt file, opened together with the
 * image, is used in place of the tags, for an image of any format.
 *   pixel size       PixelSize (nm), for an image DataSize wide.  In the files seen it equals 127 mm /
 *                    (magnification x width) to the 7 digits written, and agrees with the micron
 *                    marker drawn in the data bar to 0.1 %: Hitachi defines its magnification with a
 *                    display 127 mm x 95 mm (4 x 5 picture size)
 *   beam             AcceleratingVoltage ("2000 Volt") and WorkingDistance ("8206.67 um"); the TIFF
 *                    tag has them only in Condition, e.g. "Vacc=2.0kV   Mag=x18.0k   WD=8.2mm",
 *                    rounded as the microscope shows them
 *   stage tilt       StagePositionT, read as degrees like StagePositionR (299.7 in a file seen);
 *                    TiltCompensation (0 or 1), the microscope's tilt correction; RasterRotation
 *                    (deg), the scan rotation.  In the .txt file only
 *   detector         SignalName, e.g. SE(L)
 *   data bar         with DataDisplayCombine=1, drawn over the bottom rows of the image and not
 *                    recorded; tiff.js finds it in the pixels (H1)
 *
 * JEOL: a .txt file beside the image, of "$KEY value" lines ("$$" before some keys).  Read from
 * published descriptions and one sample file, not yet tested on real images.
 *   pixel size       the micron bar: $$SM_MICRON_MARKER (e.g. "100um") over $$SM_MICRON_BAR pixels,
 *                    exact to the bar's rounding, half a pixel.  When 120 mm or 127 mm / ($CM_MAG x
 *                    width) falls within that rounding, the more precise value is taken (the sample,
 *                    1280 pixels wide at x95, fits 120 mm)
 *   data bar         the rows below $CM_FULL_SIZE (width height)
 *   beam             $CM_ACCEL_VOLT (kV), $$SM_WD (mm), $$SM_PROBE_CURRENT (A)
 *   scan rotation    $$SM_SCAN_ROTATION (deg); the stage tilt is somewhere in $CM_STAGE_POS, whose
 *                    order of values is not documented, and is not read
 *   detector         $CM_SIGNAL
 *
 * TESCAN: [MAIN] and [SEM] sections of key=value lines in SI units, in a .hdr file beside the image
 * and in a TIFF tag (found by its content, "PixelSizeX=").  Not yet tested on real images.
 *   pixel size       PixelSizeX, PixelSizeY (m)
 *   info strip       ImageStripSize: the rows at the bottom
 *   beam             HV or AcceleratorVoltage (V), WD (m), BeamCurrent or PredictedBeamCurrent (A)
 *   stage tilt       StageTilt and ScanRotation, read as degrees
 *   detector         Detector
 *
 * Thermo Fisher XML ("FeiImage", as Phenom desktop SEMs write it, in TIFF tag 34683): pixelWidth,
 * pixelHeight, workingDistance and highVoltage with their unit attributes.  Not yet tested.
 */

/** @typedef {"FEI"|"Zeiss"|"Hitachi"|"JEOL"|"TESCAN"|"Phenom"} Vendor */
/** @typedef {Record<string, Record<string, string|number>>} FeiMetadata */
/** @typedef {{label: string, value: string|number|boolean, unit: string, text: string}} ZeissEntry */
/** @typedef {{header: number[], entries: Record<string, ZeissEntry>}} ZeissMetadata */
/** @typedef {Record<string, string>} KeyValues    keys and values of Hitachi, JEOL or TESCAN text */

/**
 * The calibration of an image: SI units, null where the file does not say.
 * @typedef {Object} Calibration
 * @property {Vendor|null} vendor
 * @property {string|null} metadataFile            the file beside the image whose metadata are used;
 *                                                 null for metadata in the image file
 * @property {boolean} untested                    read from a format not yet tested on real images
 * @property {string[]} notes                      what to check: a size or a name that does not match
 * @property {[number, number]|null} pixelSizeM     pixel width and height (m)
 * @property {number} databarRows                  rows of info bar at the bottom (an FEI data bar, a Zeiss
 *                                                 info zone or a Hitachi data bar found in the image, ...),
 *                                                 ignored by the processing
 * @property {string|null} beam                    e.g. "EBeam", "IBeam", "OBeam" (chamber camera)
 * @property {number|null} highVoltageV
 * @property {number|null} beamCurrentA
 * @property {number|null} workingDistanceM
 * @property {number|null} fieldWidthM             horizontal field width
 * @property {number|null} tiltDeg                 stage tilt
 * @property {boolean|null} tiltCorrectionOn       the microscope's own tilt correction
 * @property {number|null} tiltCorrectionAngleDeg
 * @property {number|null} scanRotationDeg         active scan rotation (0 when off)
 * @property {string|null} detector
 * @property {string|null} system
 * @property {string|null} acquired                date and time as written by the microscope
 */

const NUMBER_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * A number when the text is a decimal number, else the trimmed text.
 * @param {string} text
 * @returns {string|number}
 */
function numberOrText(text) {
  const s = text.trim();
  return NUMBER_RE.test(s) ? Number(s) : s;
}

/**
 * A finite number from a metadata value, or null.
 * @param {unknown} value
 * @returns {number|null}
 */
function finiteNumber(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string" && NUMBER_RE.test(value.trim())) {
    return Number(value.trim());
  }
  return null;
}

/**
 * A non-empty text from a metadata value, or null.
 * @param {unknown} value
 * @returns {string|null}
 */
function nonEmptyText(value) {
  if (value === undefined || value === null) {
    return null;
  }
  const s = String(value).trim();
  return s === "" ? null : s;
}

/**
 * Sections of FEI metadata text.  Lines before the first header and lines without '=' are skipped.
 * @param {string} text
 * @returns {FeiMetadata}
 */
function parseFeiText(text) {
  /** @type {FeiMetadata} */
  const out = {};
  /** @type {Record<string, string|number>} */
  let section = {};          // lines before the first header land here and are dropped
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\0/g, "").trim();
    if (line.startsWith("[") && line.endsWith("]")) {
      const name = line.slice(1, -1).trim();
      section = out[name] || (out[name] = {});
    } else if (line.includes("=")) {
      const at = line.indexOf("=");
      section[line.slice(0, at).trim()] = numberOrText(line.slice(at + 1));
    }
  }
  return out;
}

/**
 * The unnamed numbers and the named entries of Zeiss metadata text.
 * @param {string} text
 * @returns {ZeissMetadata}
 */
function parseZeissText(text) {
  /** @type {number[]} */
  const header = [];
  /** @type {Record<string, ZeissEntry>} */
  const entries = {};
  /** @type {string|null} */
  let key = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\0/g, "").trim();
    if (line === "") {
      continue;
    }
    if (/^[A-Z][A-Z0-9_]*$/.test(line)) {
      key = line;
      continue;
    }
    if (key === null) {
      header.push(NUMBER_RE.test(line) ? Number(line) : Number.NaN);
      continue;
    }
    let at = line.indexOf("=");
    if (at < 0) {
      at = line.indexOf(":");
    }
    if (at >= 0) {
      const label = line.slice(0, at).trim();
      const valueText = line.slice(at + 1).trim();
      const withUnit = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s+(\S+)$/.exec(valueText);
      /** @type {string|number|boolean} */
      let value = valueText;
      let unit = "";
      if (withUnit) {
        value = Number(withUnit[1]);
        unit = withUnit[2];
      } else if (NUMBER_RE.test(valueText)) {
        value = Number(valueText);
      } else if (valueText === "On" || valueText === "Yes") {
        value = true;
      } else if (valueText === "Off" || valueText === "No") {
        value = false;
      }
      entries[key] = { label, value, unit, text: valueText };
    }
    key = null;
  }
  return { header, entries };
}

/**
 * Key=value lines, of Hitachi text (a TIFF's XPComment, or the [SemImageFile] text of its .txt
 * file) or TESCAN text.  A value runs from the first '=' to the end of its line (Hitachi's
 * Condition holds '=' of its own); section headers and lines without '=' are skipped.
 * @param {string} text
 * @returns {KeyValues}
 */
function parseKeyValueText(text) {
  /** @type {KeyValues} */
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\0/g, "").trim();
    const at = line.indexOf("=");
    if (at > 0 && !line.startsWith("[")) {
      out[line.slice(0, at).trim()] = line.slice(at + 1).trim();
    }
  }
  return out;
}

/**
 * "$KEY value" lines of JEOL metadata text: keys without their dollar signs, values the rest of the
 * line.  The first of a repeated key is kept.
 * @param {string} text
 * @returns {KeyValues}
 */
function parseJeolText(text) {
  /** @type {KeyValues} */
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const m = /^\s*\$+([A-Za-z0-9_%]+)[ \t]*(.*)$/.exec(raw.replace(/\0/g, ""));
    if (m !== null && !(m[1] in out)) {
      out[m[1]] = m[2].trim();
    }
  }
  return out;
}

/**
 * Metres from a Zeiss length entry ("10.97 nm", "11.23 um" with a micro sign, "3.1 mm").
 * @param {ZeissEntry|undefined} entry
 * @returns {number|null}
 */
function zeissLength(entry) {
  if (!entry || typeof entry.value !== "number") {
    return null;
  }
  /** @type {Record<string, number>} */
  const scale = { pm: 1e-12, nm: 1e-9, "µm": 1e-6, "μm": 1e-6, um: 1e-6, mm: 1e-3, m: 1 };
  const factor = scale[entry.unit];
  return factor === undefined ? null : entry.value * factor;
}

/**
 * A Zeiss entry in a given set of units, e.g. volts from "2.00 kV".
 * @param {ZeissEntry|undefined} entry
 * @param {Record<string, number>} units
 * @returns {number|null}
 */
function zeissQuantity(entry, units) {
  if (!entry || typeof entry.value !== "number") {
    return null;
  }
  const factor = units[entry.unit];
  return factor === undefined ? null : entry.value * factor;
}

/**
 * A Zeiss angle in degrees (the unit is the degree sign, or missing).
 * @param {ZeissEntry|undefined} entry
 * @returns {number|null}
 */
function zeissAngle(entry) {
  return entry && typeof entry.value === "number" ? entry.value : null;
}

/** @returns {Calibration} */
function emptyCalibration() {
  return {
    vendor: null, metadataFile: null, untested: false, notes: [], pixelSizeM: null, databarRows: 0, beam: null,
    highVoltageV: null, beamCurrentA: null,
    workingDistanceM: null, fieldWidthM: null, tiltDeg: null, tiltCorrectionOn: null,
    tiltCorrectionAngleDeg: null, scanRotationDeg: null, detector: null, system: null, acquired: null,
  };
}

/** @typedef {(section: string|null, key: string) => (string|number|undefined)} FeiGetter */

/**
 * Degrees from radians, keeping null.
 * @param {number|null} rad
 * @returns {number|null}
 */
function degrees(rad) {
  return rad === null ? null : (rad * 180) / Math.PI;
}

/**
 * Pixel size, field width and data bar of an FEI image.
 * @param {FeiGetter} get
 * @param {Calibration} cal
 * @param {number} fileRows
 * @param {string|null} beamSection
 */
function feiGeometry(get, cal, fileRows, beamSection) {
  const scan = ["Scan", "EScan", "IScan"].find((s) => (finiteNumber(get(s, "PixelWidth")) || 0) > 0) || null;
  const pw = finiteNumber(get(scan, "PixelWidth"));
  const ph = finiteNumber(get(scan, "PixelHeight"));
  if (pw !== null && pw > 0) {
    cal.pixelSizeM = [pw, ph !== null && ph > 0 ? ph : pw];
  }
  cal.fieldWidthM = finiteNumber(get(scan, "HorFieldsize")) ?? finiteNumber(get(beamSection, "HFW"));
  const rows = finiteNumber(get("Image", "ResolutionY"));
  if (rows !== null && rows > 0 && rows <= fileRows) {
    cal.databarRows = fileRows - Math.round(rows);
  }
}

/**
 * Stage tilt, the microscope's tilt correction and the scan rotation of an FEI image.
 * @param {FeiGetter} get
 * @param {Calibration} cal
 * @param {string|null} beamSection
 */
function feiTilt(get, cal, beamSection) {
  cal.tiltDeg = degrees(finiteNumber(get("Stage", "StageT")) ?? finiteNumber(get(beamSection, "StageTa")));
  const tc = nonEmptyText(get(beamSection, "TiltCorrectionIsOn"));
  cal.tiltCorrectionOn = tc === null ? null : ["yes", "on", "true", "1"].includes(tc.toLowerCase());
  cal.tiltCorrectionAngleDeg = degrees(finiteNumber(get(beamSection, "TiltCorrectionAngle")));
  cal.scanRotationDeg = degrees(finiteNumber(get("Beam", "ScanRotation")));
}

/**
 * Beam conditions, detector, system and acquisition time of an FEI image.
 * @param {FeiGetter} get
 * @param {Calibration} cal
 * @param {string|null} beamSection
 */
function feiConditions(get, cal, beamSection) {
  cal.highVoltageV = finiteNumber(get("Beam", "HV")) ?? finiteNumber(get(beamSection, "HV"));
  cal.beamCurrentA = finiteNumber(get(beamSection, "BeamCurrent"));
  cal.workingDistanceM = finiteNumber(get(beamSection, "WD")) ?? finiteNumber(get("Stage", "WorkingDistance"));
  const detector = nonEmptyText(get("Detectors", "Name"));
  const mode = nonEmptyText(get("Detectors", "Mode"));
  cal.detector = detector === null ? null : detector + (mode !== null && mode !== "None" ? ` (${mode})` : "");
  const system = nonEmptyText(get("System", "SystemType"));
  cal.system = system === null ? null : `FEI ${system}`;
  const date = nonEmptyText(get("User", "Date"));
  const time = nonEmptyText(get("User", "Time"));
  cal.acquired = date === null && time === null ? null : `${date || ""} ${time || ""}`.trim();
}

/**
 * The calibration of an FEI image whose TIFF page has ``fileRows`` rows.
 * @param {FeiMetadata} md
 * @param {number} fileRows
 * @returns {Calibration}
 */
function feiCalibration(md, fileRows) {
  /** @type {FeiGetter} */
  const get = (section, key) => (section !== null && md[section] ? md[section][key] : undefined);
  const cal = emptyCalibration();
  cal.vendor = "FEI";
  cal.beam = nonEmptyText(get("Beam", "Beam"));
  const beamSection = cal.beam !== null && md[cal.beam] ? cal.beam : null;
  feiGeometry(get, cal, fileRows, beamSection);
  feiTilt(get, cal, beamSection);
  feiConditions(get, cal, beamSection);
  return cal;
}

/**
 * The calibration of a Zeiss image.  Its data bar is drawn over the image and is not cut off.
 * @param {ZeissMetadata} md
 * @returns {Calibration}
 */
function zeissCalibration(md) {
  const e = md.entries;
  const cal = emptyCalibration();
  cal.vendor = "Zeiss";
  cal.beam = "EBeam";
  let pixel = zeissLength(e.AP_PIXEL_SIZE) ?? zeissLength(e.AP_IMAGE_PIXEL_SIZE);
  if (pixel !== null && pixel > 0) {
    const precise = md.header.length > 3 ? md.header[3] : Number.NaN;
    if (Number.isFinite(precise) && Math.abs(precise / pixel - 1) < 0.01) {
      pixel = precise;                    // the same value, with more digits
    }
    cal.pixelSizeM = [pixel, pixel];
  }
  cal.tiltDeg = zeissAngle(e.AP_STAGE_AT_T);
  const tc = e.DP_TILT_CORRECTION;
  cal.tiltCorrectionOn = tc && typeof tc.value === "boolean" ? tc.value : null;
  cal.tiltCorrectionAngleDeg = zeissAngle(e.AP_TILT_ANGLE);
  const rotationOn = e.DP_SCAN_ROT && e.DP_SCAN_ROT.value === true;
  cal.scanRotationDeg = rotationOn ? zeissAngle(e.AP_SCANROTATION) : 0;
  cal.highVoltageV = zeissQuantity(e.AP_ACTUALKV, { V: 1, kV: 1e3 });
  cal.beamCurrentA = zeissQuantity(e.AP_IPROBE, { pA: 1e-12, nA: 1e-9, "µA": 1e-6, "μA": 1e-6, uA: 1e-6 });
  cal.workingDistanceM = zeissLength(e.AP_WD);
  cal.fieldWidthM = zeissLength(e.AP_WIDTH);
  cal.detector = e.DP_DETECTOR_TYPE ? nonEmptyText(e.DP_DETECTOR_TYPE.text) : null;
  cal.system = e.SV_SERIAL_NUMBER ? `Zeiss ${e.SV_SERIAL_NUMBER.text}` : "Zeiss";
  const date = e.AP_DATE ? e.AP_DATE.text : "";
  const time = e.AP_TIME ? e.AP_TIME.text : "";
  cal.acquired = date || time ? `${date} ${time}`.trim() : null;
  return cal;
}

/**
 * A quantity in SI units from Hitachi's Condition line, e.g. "Vacc=2.0kV   Mag=x18.0k   WD=8.2mm".
 * @param {string|undefined} condition
 * @param {string} key                  "Vacc" or "WD"
 * @param {Record<string, number>} units
 * @returns {number|null}
 */
function hitachiCondition(condition, key, units) {
  const m = new RegExp(`(?:^|\\s)${key}=([+-]?\\d+(?:\\.\\d+)?)\\s*([a-zA-Zµμ]+)`).exec(condition ?? "");
  const factor = m === null ? undefined : units[m[2]];
  return m === null || factor === undefined ? null : Number(m[1]) * factor;
}

/**
 * A quantity in SI units from text such as "2000 Volt" or "8206.67 um"; null when its unit is not
 * among ``units``.
 * @param {string|undefined} text
 * @param {Record<string, number>} units
 * @returns {number|null}
 */
function textQuantity(text, units) {
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*(\S+)$/.exec((text ?? "").trim());
  const factor = m === null ? undefined : units[m[2]];
  return m === null || factor === undefined ? null : Number(m[1]) * factor;
}

/**
 * "date time" from two values that may be missing; null when both are.
 * @param {unknown} date
 * @param {unknown} time
 * @returns {string|null}
 */
function dateTime(date, time) {
  const d = nonEmptyText(date);
  const t = nonEmptyText(time);
  return d === null && t === null ? null : `${d ?? ""} ${t ?? ""}`.trim();
}

const MICRO_METRES = { um: 1e-6, "µm": 1e-6, "μm": 1e-6 };

/**
 * The calibration of Hitachi metadata, a TIFF's XPComment or a .txt file, for an image ``width``
 * pixels wide.  Its data bar is drawn over the image and is not cut off.
 * @param {KeyValues} md
 * @param {string|null} model     the instrument when the text does not name it: the TIFF's XPAuthor tag
 * @param {number} width
 * @returns {Calibration}
 */
function hitachiCalibration(md, model, width) {
  const cal = emptyCalibration();
  cal.vendor = "Hitachi";
  cal.beam = "EBeam";
  const pixel = finiteNumber(md.PixelSize);
  if (pixel !== null && pixel > 0) {
    cal.pixelSizeM = [pixel * 1e-9, pixel * 1e-9];
    cal.fieldWidthM = pixel * 1e-9 * width;
  }
  cal.highVoltageV = textQuantity(md.AcceleratingVoltage, { Volt: 1, V: 1, kV: 1e3 })
    ?? hitachiCondition(md.Condition, "Vacc", { V: 1, kV: 1e3 });
  cal.workingDistanceM = textQuantity(md.WorkingDistance, { ...MICRO_METRES, mm: 1e-3 })
    ?? hitachiCondition(md.Condition, "WD", { ...MICRO_METRES, mm: 1e-3 });
  cal.tiltDeg = finiteNumber(md.StagePositionT);
  const compensation = finiteNumber(md.TiltCompensation);
  cal.tiltCorrectionOn = compensation === null ? null : compensation !== 0;
  cal.scanRotationDeg = finiteNumber(md.RasterRotation);
  cal.detector = nonEmptyText(md.SignalName);
  const name = nonEmptyText(md.InstructName) ?? nonEmptyText(model);
  cal.system = name === null ? "Hitachi" : `Hitachi ${name}`;
  cal.acquired = dateTime(md.Date, md.Time);
  return cal;
}

/**
 * Metres from a JEOL micron marker: "100um", "500nm", "1mm", a micro sign in any encoding; null
 * otherwise (e.g. "5deg." in channelling mode).
 * @param {string|undefined} text
 * @returns {number|null}
 */
function markerLength(text) {
  const m = /^(\d+(?:\.\d+)?)\s*(nm|mm|um|[^\x20-\x7e]+m)$/.exec((text ?? "").trim());
  if (m === null) {
    return null;
  }
  return Number(m[1]) * (m[2] === "nm" ? 1e-9 : m[2] === "mm" ? 1e-3 : 1e-6);
}

/**
 * The calibration of JEOL metadata for an image ``width`` pixels wide.
 * @param {KeyValues} md
 * @param {number} width
 * @returns {Calibration}
 */
function jeolCalibration(md, width) {
  const cal = emptyCalibration();
  cal.vendor = "JEOL";
  cal.beam = "EBeam";
  cal.untested = true;
  const full = (md.CM_FULL_SIZE ?? "").split(/\s+/).map(Number);
  const scanWidth = full[0] > 0 ? full[0] : width;
  const bar = finiteNumber(md.SM_MICRON_BAR);
  const length = markerLength(md.SM_MICRON_MARKER);
  if (bar !== null && bar > 0 && length !== null) {
    let pixel = length / bar;
    const mag = finiteNumber(md.CM_MAG) ?? Number.NaN;
    for (const picture of [0.12, 0.127]) {     // a picture this wide, if the bar fits it to its rounding
      const p = picture / (mag * scanWidth);
      if (Math.abs(length / p - bar) <= 0.5) {
        pixel = p;
        break;
      }
    }
    cal.pixelSizeM = [pixel, pixel];
    cal.fieldWidthM = pixel * scanWidth;
  }
  const kv = finiteNumber(md.CM_ACCEL_VOLT);
  cal.highVoltageV = kv === null ? null : kv * 1e3;
  const wd = finiteNumber(md.SM_WD);
  cal.workingDistanceM = wd === null ? null : wd * 1e-3;
  cal.beamCurrentA = finiteNumber(md.SM_PROBE_CURRENT);
  cal.scanRotationDeg = finiteNumber(md.SM_SCAN_ROTATION);
  cal.detector = nonEmptyText(md.CM_SIGNAL) ?? nonEmptyText(md.CM_DETECTOR_NAME);
  const model = nonEmptyText(md.CM_INSTRUMENT);
  cal.system = model === null ? "JEOL" : `JEOL ${model}`;
  cal.acquired = dateTime(md.CM_DATE, md.CM_TIME);
  return cal;
}

/**
 * The calibration of TESCAN metadata (its key=value lines, sections merged) for an image ``width``
 * pixels wide.
 * @param {KeyValues} md
 * @param {number} width
 * @returns {Calibration}
 */
function tescanCalibration(md, width) {
  const cal = emptyCalibration();
  cal.vendor = "TESCAN";
  cal.beam = "EBeam";
  cal.untested = true;
  const px = finiteNumber(md.PixelSizeX);
  const py = finiteNumber(md.PixelSizeY);
  if (px !== null && px > 0) {
    cal.pixelSizeM = [px, py !== null && py > 0 ? py : px];
    cal.fieldWidthM = px * width;
  }
  cal.highVoltageV = finiteNumber(md.HV) ?? finiteNumber(md.AcceleratorVoltage);
  cal.workingDistanceM = finiteNumber(md.WD);
  cal.beamCurrentA = finiteNumber(md.BeamCurrent) ?? finiteNumber(md.PredictedBeamCurrent);
  cal.tiltDeg = finiteNumber(md.StageTilt);
  cal.scanRotationDeg = finiteNumber(md.ScanRotation);
  cal.detector = nonEmptyText(md.Detector);
  const device = nonEmptyText(md.Device);
  cal.system = device === null ? "TESCAN" : /tescan/i.test(device) ? device : `TESCAN ${device}`;
  cal.acquired = dateTime(md.Date, md.Time);
  return cal;
}

/**
 * The text of the first element ``tag`` of XML text, and its unit attribute; null without it.
 * @param {string} xml
 * @param {string} tag
 * @returns {{text: string, unit: string}|null}
 */
function xmlElement(xml, tag) {
  const m = new RegExp(`<${tag}(\\s[^>]*)?>([^<]*)</${tag}>`).exec(xml);
  if (m === null) {
    return null;
  }
  const unit = /\sunit="([^"]*)"/.exec(m[1] ?? "");
  return { text: m[2].trim(), unit: unit === null ? "" : unit[1] };
}

/**
 * A quantity of FeiImage XML in SI units, from its unit attribute (none: as written).
 * @param {string} xml
 * @param {string} tag
 * @returns {number|null}
 */
function xmlQuantity(xml, tag) {
  const e = xmlElement(xml, tag);
  /** @type {Record<string, number>} */
  const units = { "": 1, m: 1, mm: 1e-3, ...MICRO_METRES, nm: 1e-9, V: 1, kV: 1e3, A: 1 };
  const value = e === null ? null : finiteNumber(e.text);
  const factor = e === null ? undefined : units[e.unit];
  return value === null || factor === undefined ? null : value * factor;
}

/**
 * The calibration of Thermo Fisher's FeiImage XML, as Phenom desktop SEMs write it, for an image
 * ``width`` pixels wide.
 * @param {string} xml
 * @param {number} width
 * @returns {Calibration}
 */
function phenomCalibration(xml, width) {
  const cal = emptyCalibration();
  cal.vendor = "Phenom";
  cal.beam = "EBeam";
  cal.untested = true;
  const pw = xmlQuantity(xml, "pixelWidth");
  const ph = xmlQuantity(xml, "pixelHeight");
  if (pw !== null && pw > 0) {
    cal.pixelSizeM = [pw, ph !== null && ph > 0 ? ph : pw];
    cal.fieldWidthM = pw * width;
  }
  const hv = xmlQuantity(xml, "highVoltage");
  cal.highVoltageV = hv === null ? null : Math.abs(hv);
  cal.workingDistanceM = xmlQuantity(xml, "workingDistance");
  const detector = xmlElement(xml, "detector");
  cal.detector = detector === null ? null : nonEmptyText(detector.text);
  const type = /<instrument\b[^>]*>[\s\S]*?<type>([^<]*)<\/type>/.exec(xml);
  cal.system = type === null ? "Phenom" : nonEmptyText(type[1]) ?? "Phenom";
  const time = xmlElement(xml, "time");
  cal.acquired = time === null ? null : nonEmptyText(time.text);
  return cal;
}

/**
 * The line of describeCalibration on the info bar; null without vendor metadata.
 * @param {Calibration} cal
 * @returns {string|null}
 */
function infoBarLine(cal) {
  const rows = cal.databarRows;
  switch (cal.vendor) {
    case "FEI":
      return rows > 0 ? `data bar: the bottom ${rows} rows, left out of the processing` : "data bar: none below the image";
    case "Zeiss":
      return rows > 0 ? `info zone: found in the image, the bottom ${rows} rows from its upper line, left out of the ` +
        "processing" : "info zone: not found in the image";
    case "Hitachi":
      return rows > 0 ? `data bar: found in the image, the bottom ${rows} rows, left out of the processing`
        : "data bar: not found in the image";
    case "JEOL":
      return rows > 0 ? `data bar: the bottom ${rows} rows, below the image size recorded, left out of the processing`
        : null;
    case "TESCAN":
      return rows > 0 ? `info strip: the bottom ${rows} rows (ImageStripSize), left out of the processing` : null;
    default:
      return null;
  }
}

/**
 * The first lines of describeCalibration: the microscope, where the metadata come from, and what
 * to check.
 * @param {Calibration} cal
 * @returns {string[]}
 */
function sourceLines(cal) {
  const lines = [cal.system || cal.vendor ? `microscope: ${cal.system || cal.vendor}`
    : "no microscope metadata: enter the pixel size by hand, or open the image together with its .txt or .hdr file"];
  if (cal.metadataFile !== null) {
    lines.push(`metadata: from ${cal.metadataFile}, opened with the image`);
  }
  if (cal.untested) {
    lines.push("metadata format not yet tested on real images: check the pixel size against the scale bar");
  }
  return lines.concat(cal.notes.map((note) => `check: ${note}`));
}

/**
 * Human-readable lines describing a calibration.
 * @param {Calibration} cal
 * @returns {string[]}
 */
function describeCalibration(cal) {
  const lines = sourceLines(cal);
  if (cal.pixelSizeM) {
    lines.push(`pixel size: ${(cal.pixelSizeM[0] * 1e9).toPrecision(6)} x ${(cal.pixelSizeM[1] * 1e9).toPrecision(6)} nm`);
  } else if (cal.vendor) {
    lines.push("pixel size: not in the metadata (lengths in pixels)");
  }
  if (cal.fieldWidthM !== null) {
    lines.push(`field width: ${(cal.fieldWidthM * 1e6).toPrecision(4)} µm`);
  }
  const bar = infoBarLine(cal);
  if (bar !== null) {
    lines.push(bar);
  }
  const parts = [];
  if (cal.beam) {
    parts.push(cal.beam);
  }
  if (cal.highVoltageV) {
    parts.push(`${(cal.highVoltageV / 1e3).toPrecision(3)} kV`);
  }
  if (cal.beamCurrentA) {
    parts.push(cal.beamCurrentA < 1e-9 ? `${(cal.beamCurrentA * 1e12).toPrecision(3)} pA`
      : `${(cal.beamCurrentA * 1e9).toPrecision(3)} nA`);
  }
  if (parts.length) {
    lines.push(`beam: ${parts.join(", ")}`);
  }
  if (cal.workingDistanceM !== null) {
    lines.push(`working distance: ${(cal.workingDistanceM * 1e3).toFixed(2)} mm`);
  }
  if (cal.tiltDeg !== null) {
    lines.push(`stage tilt: ${cal.tiltDeg.toFixed(2)}°`);
  } else if (cal.vendor === "Hitachi") {
    lines.push(cal.metadataFile === null ? "stage tilt: not in the TIFF (Hitachi writes it to the .txt file beside " +
      "the image: open both together)" : "stage tilt: not in the metadata file");
  }
  if (cal.tiltCorrectionOn !== null) {
    const angle = cal.tiltCorrectionAngleDeg === null ? "" : ` (angle ${cal.tiltCorrectionAngleDeg.toFixed(2)}°)`;
    lines.push(`microscope tilt correction: ${cal.tiltCorrectionOn ? "ON" : "off"}${angle}`);
  }
  if (cal.scanRotationDeg) {
    lines.push(`scan rotation: ${cal.scanRotationDeg.toFixed(2)}°`);
  }
  if (cal.detector) {
    lines.push(`detector: ${cal.detector}`);
  }
  if (cal.acquired) {
    lines.push(`acquired: ${cal.acquired}`);
  }
  return lines;
}
