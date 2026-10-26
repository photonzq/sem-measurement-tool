"use strict";
/* exported parseFeiText, parseZeissText, feiCalibration, zeissCalibration, emptyCalibration, describeCalibration */
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
 */

/** @typedef {Record<string, Record<string, string|number>>} FeiMetadata */
/** @typedef {{label: string, value: string|number|boolean, unit: string, text: string}} ZeissEntry */
/** @typedef {{header: number[], entries: Record<string, ZeissEntry>}} ZeissMetadata */

/**
 * The calibration of an image: SI units, null where the file does not say.
 * @typedef {Object} Calibration
 * @property {"FEI"|"Zeiss"|null} vendor
 * @property {[number, number]|null} pixelSizeM     pixel width and height (m)
 * @property {number} databarRows                  rows of info bar at the bottom (an FEI data bar, a Zeiss
 *                                                 info zone found in the image), ignored by the processing
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
    vendor: null, pixelSizeM: null, databarRows: 0, beam: null, highVoltageV: null, beamCurrentA: null,
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
 * Human-readable lines describing a calibration.
 * @param {Calibration} cal
 * @returns {string[]}
 */
function describeCalibration(cal) {
  const lines = [];
  if (cal.system) {
    lines.push(`microscope: ${cal.system}`);
  } else if (cal.vendor) {
    lines.push(`microscope: ${cal.vendor}`);
  } else {
    lines.push("no FEI or Zeiss metadata: enter the pixel size by hand, or lengths stay in pixels");
  }
  if (cal.pixelSizeM) {
    lines.push(`pixel size: ${(cal.pixelSizeM[0] * 1e9).toPrecision(6)} x ${(cal.pixelSizeM[1] * 1e9).toPrecision(6)} nm`);
  } else if (cal.vendor) {
    lines.push("pixel size: not in the metadata (lengths in pixels)");
  }
  if (cal.fieldWidthM !== null) {
    lines.push(`field width: ${(cal.fieldWidthM * 1e6).toPrecision(4)} µm`);
  }
  if (cal.vendor === "FEI") {
    lines.push(cal.databarRows > 0 ? `data bar: the bottom ${cal.databarRows} rows, left out of the processing`
      : "data bar: none below the image");
  } else if (cal.vendor === "Zeiss") {
    lines.push(cal.databarRows > 0 ? `info zone: found in the image, the bottom ${cal.databarRows} rows from its upper ` +
      "line, left out of the processing" : "info zone: not found in the image");
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
