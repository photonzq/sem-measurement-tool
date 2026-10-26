# File formats

The app reads and writes plain-text files, all UTF-8 without a byte-order mark, and writes one binary layout file:

| File | Written by | Purpose |
|:--|:--|:--|
| session, `<image>_session.json` | **Save session** (Ctrl+S) | the working file: everything needed to take up the work on an image again |
| polygon file, `<image>_polygons.csv` | **Export polygons** | the interface to a mode solver, or any program that takes the traced contours |
| measurements file, `<image>_measurements.csv` | **Export measurements** | rulers, angles and line profiles, for a spreadsheet or a report |
| profile file, `<image>_<profile name>.csv` | **Export CSV** in the profile window | the samples of one line profile; written only |
| GDSII file, `<image>.gds` | **Export GDS…** | the contours as a layout, for KLayout, gdstk, GDSFactory and other layout tools; written only |

**Open session…** reads either a session or a polygon file.

## Coordinates

All the files give points in **pixel coordinates of the image as stored in the file**, before any correction:

- $x$ is the column and $y$ the row, with $y$ down;
- pixel centres lie at integers: the pixel in row $i$ and column $j$ is centred at $(j, i)$, with its edges at $j \pm 0.5$ and $i \pm 0.5$;
- an info bar, an FEI data bar or a Zeiss info zone, is part of the stored image.

These coordinates never change when the calibration does.

The CSV files also give **micrometres**, x to the right and **y up**. They follow from the pixel coordinates through one matrix, written in the header as `px_to_um`:

$$\begin{pmatrix}x_\mathrm{um}\\ y_\mathrm{um}\end{pmatrix} = \begin{pmatrix}a & b\\ c & d\end{pmatrix}\begin{pmatrix}x_\mathrm{px} - x_0\\ y_\mathrm{px} - y_0\end{pmatrix},$$

with $(x_0, y_0)$ the origin `origin_px`. The matrix is $A = R(\varphi)\,K\,D\,F$ of MATH.md (G8), the product of four steps:

- turning $y$ up ($F$);
- the pixel size ($D$);
- the tilt correction across the tilt axis ($K$);
- the rotation of the corrected image ($R(\varphi)$).

MATH.md derives each step. A reader needs only the matrix, not the steps.

| `correction` | factor $k$ | for |
|:--|:--|:--|
| `none` | 1 | untilted images, or images the microscope has already corrected |
| `cross-section` | $1/\sin\theta$ | depths on a face normal to the surface that contains the tilt axis: 1.269 at 52° |
| `tilted-surface` | $1/\cos\theta$ | lengths in the tilted surface |
| `custom` | as entered | anything else |

## The CSV header

The CSV files begin with comment lines starting with `#`:

- **The first line** names the format and its version. A reader checks it and refuses other versions.
- **`# key: value` lines** before the column header carry the metadata below. A key is made of lowercase letters, digits and underscores.
- **Other comment lines** are free text, and comment lines may appear anywhere.

Readers ignore keys they do not know.

| Key | Value | Meaning |
|:--|:--|:--|
| `image` | text | file name of the image |
| `image_sha256` | hex | SHA-256 of that file; the app asks before loading onto a different image |
| `image_size_px` | `width height` | size of the stored image in pixels, an info bar included |
| `databar_rows` | integer | rows of info bar at the bottom: an FEI data bar, or a Zeiss info zone and the rows below it (0 when none). The edge detection, the histogram and the auto levels left them out. |
| `microscope` | text | vendor and system, for the record |
| `pixel_size_nm` | `x y` | pixel width and height in nm. Absent when unknown: micrometres are then empty |
| `tilt_deg` | number | stage tilt θ in degrees |
| `correction` | `none`, `cross-section`, `tilted-surface` or `custom` | the tilt correction |
| `custom_factor` | number | the factor entered for `custom` (written only then) |
| `correction_factor` | number | the factor $k$ actually applied (absent when undefined, e.g. a cross-section at θ = 0) |
| `tilt_axis_deg` | number | α: direction of the tilt axis in the image, counter-clockwise from the horizontal |
| `rotation_deg` | number | φ: rotation of the corrected image, counter-clockwise |
| `origin_px` | `x y` | the origin of the micrometres, in pixel coordinates |
| `px_to_um` | `a b c d` | the matrix above, row by row (µm per pixel); absent without a pixel size |
| `snap` | text | polygon file only: the snap settings, for the record |
| `unit` | `um` or `px` | measurements and profile files: the unit of their lengths |

**Fields** are separated by commas and quoted per RFC 4180 when they contain a comma or a double quote, as in `"foot, left"`; a double quote inside is written twice. **Numbers** use `.` as decimal point and no thousands separator; NaN and infinity are not allowed.

## Polygon file, version 1

```
# sem-measurement-tool polygons 1
# image: fib_cross_section.tif
# image_sha256: 8719dc9863e3ed63e8a20aa7b6c0d80f25ec7db5c6dff7b46b1199baec3e0567
# image_size_px: 3072 2188
# databar_rows: 140
# microscope: FEI Helios 5 UX
# pixel_size_nm: 1.34896 1.34896
# tilt_deg: 51.996
# correction: cross-section
# correction_factor: 1.269087439
# tilt_axis_deg: 0
# rotation_deg: 0.25
# origin_px: 1536 1024
# px_to_um: 0.001348947159 0.000007469759442 0.000005885929693 -0.001711931896
# snap: sigma_px=2 median=3 radius_px=12 min_contrast=3 snap=on
# (x_um, y_um) = px_to_um (x_px - origin_x, y_px - origin_y), px_to_um = [[a, b], [c, d]] given as a b c d
contour,closed,vertex,x_um,y_um,x_px,y_px
rib,1,0,-0.813614,0.288150,933.796,853.611
rib,1,1,0.808594,0.295783,2136.371,853.287
rib,1,2,1.011859,0.105416,2286.437,965.003
rib,1,3,-1.016184,0.096503,783.010,965.040
slab top,0,0,-1.937529,0.092552,100.000,965.000
slab top,0,1,1.936647,0.109456,2972.000,965.000
```

The app wrote this example, for a FIB cross-section imaged on an FEI DualBeam; only the image's file name has been changed, here and in the examples below. Every micrometre value follows from the pixels through `px_to_um`.

**Column header.** The first line that is not a comment. Required columns are `contour`, `closed`, `vertex`, `x_um` and `y_um`; `x_px` and `y_px` are optional. Readers find columns by name, so their order may change, and ignore columns they do not know.

**Rows.** One per vertex:

- `contour`: the contour's name, unique within the file and on one line.
- `closed`: `1` for a closed polygon, `0` for an open polyline, the same on every row of a contour.
- `vertex`: 0, 1, 2, … in order. The rows of a contour are consecutive, and a closed polygon does not repeat its first vertex at the end.
- `x_um`, `y_um`: micrometres, written with 6 decimals. They are in the rotated, corrected frame, the one the app displays. Both are empty when the pixel size is unknown, and a reader that needs physical units then refuses the file.
- `x_px`, `y_px`: pixel coordinates, written with 3 decimals.

**Reading it** in Python, without dependencies:

```python
import csv

def read_polygons(path):
    """{name: (closed, [(x_um, y_um), ...])} from a sem-measurement-tool polygon file."""
    with open(path, encoding="utf-8") as f:
        first = f.readline().strip()
        if first != "# sem-measurement-tool polygons 1":
            raise ValueError(f"not a sem-measurement-tool polygon file, version 1: {first!r}")
        rows = csv.DictReader(line for line in f if not line.startswith("#"))
        out = {}
        for r in rows:
            closed, points = out.setdefault(r["contour"], (r["closed"] == "1", []))
            if r["x_um"] == "":
                raise ValueError("this file has no physical coordinates (pixel size unknown)")
            points.append((float(r["x_um"]), float(r["y_um"])))
    return out
```

## Measurements file, version 1

```
# sem-measurement-tool measurements 1
# image: fib_cross_section.tif
# image_sha256: 8719dc9863e3ed63e8a20aa7b6c0d80f25ec7db5c6dff7b46b1199baec3e0567
# image_size_px: 3072 2188
# databar_rows: 140
# microscope: FEI Helios 5 UX
# pixel_size_nm: 1.34896 1.34896
# tilt_deg: 51.996
# correction: cross-section
# correction_factor: 1.269087439
# tilt_axis_deg: 0
# rotation_deg: 0.25
# origin_px: 1536 1024
# px_to_um: 0.001348947159 0.000007469759442 0.000005885929693 -0.001711931896
# unit: um
# lengths in the unit above, angles in degrees; points in pixels of the image as stored; width and mean_grey: the band of a line profile
name,kind,value,unit,dx,dy,direction_deg,x1_px,y1_px,x2_px,y2_px,x3_px,y3_px,x4_px,y4_px,width,mean_grey
rib width,ruler,1.622226,um,1.622208,0.007633,0.270,933.796,853.611,2136.371,853.287,,,,,,
"foot, left",angle,136.833,deg,,,,100.000,965.000,783.010,965.040,933.796,853.611,,,,
sidewall,line-angle,43.163,deg,,,,100.000,965.000,700.000,965.000,783.010,965.040,933.796,853.611,,
profile 1,profile,0.599182,um,0.002614,-0.599176,-89.750,1500.000,750.000,1500.000,1100.000,,,,,0.006745,27367.601
```

One row per measurement. The `kind` column decides which other columns are filled:

| `kind` | points | `value` | `unit` | `dx`, `dy`, `direction_deg` |
|:--|:--|:--|:--|:--|
| `ruler` | 1 → 2 | length | `um`, or `px` without a pixel size | the components of point 2 − point 1 in the measurement frame, and its direction, counter-clockwise from +x in (−180°, 180°] |
| `angle` | arm end, vertex, arm end | the angle at the vertex, in [0°, 180°] | `deg` | empty |
| `line-angle` | line 1 from, to; line 2 from, to | the angle between the two lines as clicked, in [0°, 180°]; the supplement is the angle with one line reversed | `deg` | empty |
| `profile` | 1 → 2 | the profile's length | as a ruler | as a ruler |

`width` and `mean_grey` are filled for profiles only:

- `width` is the band width in the unit.
- `mean_grey` is the mean of all the grey values sampled in the band (MATH.md, 6.4), with eight significant digits. It is empty when no sample lies in the image.

Unused point columns are empty. Lengths in µm carry 6 decimals, in pixels 3; angles carry 3 decimals. All values are empty when the correction factor is undefined.

Version 1 files written before profiles existed end at `y4_px`. Readers that find columns by name read both.

## Session file, version 1

JSON, as the app writes it. Each $[x, y]$ pair stays on one line:

```json
{
  "format": "sem-measurement-tool session",
  "version": 1,
  "saved": "2026-10-23T15:04:05.000Z",
  "image": {
    "name": "fib_cross_section.tif",
    "sha256": "8719dc9863e3ed63e8a20aa7b6c0d80f25ec7db5c6dff7b46b1199baec3e0567",
    "size_px": [3072, 2188],
    "databar_rows": 140,
    "microscope": "FEI Helios 5 UX"
  },
  "frame": {
    "pixel_size_nm": [1.34896, 1.34896],
    "tilt_deg": 51.996,
    "correction": "cross-section",
    "custom_factor": 1,
    "tilt_axis_deg": 0,
    "rotation_deg": 0.25,
    "origin_px": [1536, 1024]
  },
  "snap": {
    "on": true,
    "sigma_px": 2,
    "median": 3,
    "radius_px": 12,
    "min_contrast": 3
  },
  "contours": [
    {
      "name": "rib",
      "closed": true,
      "gds_layer": [1, 0],
      "points_px": [
        [933.796, 853.611],
        [2136.371, 853.287],
        [2286.437, 965.003],
        [783.01, 965.04]
      ]
    },
    {
      "name": "slab top",
      "closed": false,
      "gds_layer": [2, 0],
      "points_px": [
        [100, 965],
        [2972, 965]
      ]
    }
  ],
  "measurements": [
    {
      "name": "rib width",
      "kind": "ruler",
      "points_px": [
        [933.796, 853.611],
        [2136.371, 853.287]
      ]
    },
    {
      "name": "foot, left",
      "kind": "angle",
      "points_px": [
        [100, 965],
        [783.01, 965.04],
        [933.796, 853.611]
      ]
    },
    {
      "name": "sidewall",
      "kind": "line-angle",
      "points_px": [
        [100, 965],
        [700, 965],
        [783.01, 965.04],
        [933.796, 853.611]
      ]
    },
    {
      "name": "profile 1",
      "kind": "profile",
      "width_px": 5,
      "points_px": [
        [1500, 750],
        [1500, 1100]
      ]
    }
  ],
  "active_contour": 0,
  "display": {
    "black_level": 14902,
    "white_level": 51697
  }
}
```

| Field | Content |
|:--|:--|
| `format`, `version` | exactly `"sem-measurement-tool session"` and `1`; anything else is refused |
| `saved` | when the file was written (ISO 8601, UTC) |
| `image` | the image the work belongs to: `name`, `sha256` (or null), `size_px`, `databar_rows` (the info bar, as in the CSV header), `microscope` (or null). The pixels themselves are not in the file. |
| `frame` | the measurement frame, the keys of the CSV header: `pixel_size_nm` (null when unknown), `tilt_deg`, `correction`, `custom_factor`, `tilt_axis_deg`, `rotation_deg`, `origin_px` |
| `snap` | `on`, `sigma_px`, `median` (0, 3 or 5), `radius_px`, `min_contrast`. Optional; the defaults apply without it. |
| `contours` | `name` (unique, on one line), `closed`, `gds_layer` (the GDSII layer and datatype, integers in 0–32767; [1, 0] when absent), `points_px` (pixel coordinates, rounded to 1e-4 px) |
| `measurements` | `name` (unique), `kind` (`ruler`: 2 points, `angle`: 3, `line-angle`: 4, `profile`: 2, in the order of the measurements file), `points_px`; for a profile, `width_px`: its band width in pixel widths of the corrected view, 0 or more (1 when absent) |
| `active_contour` | index of the contour that receives new vertices |
| `display` | the display levels when the session was saved: `black_level` and `white_level`, grey values of the stored image, the black level below the white (MATH.md, 5.2). Optional; without it the image opens with the auto levels. The levels change no measure. |

Derived values are not stored but recomputed when the session is opened: lengths, angles, areas and the matrix. The image must be open first. Its SHA-256 is compared with the session's, and the app asks before applying a session saved for another image.

**Validation.** The app refuses a session file, with a message naming the field, when:

- the text is not JSON;
- the format or version is wrong;
- a correction is unknown;
- a number is not finite or out of range;
- a point is not a pair;
- a name is empty or repeated;
- a measurement has the wrong number of points for its kind;
- a GDS layer or datatype is not an integer in 0–32767;
- the black level does not lie below the white level;
- a profile's band width is negative or not a number.

## Profile file, version 1

The samples of one line profile (MATH.md, Part 6), written by **Export CSV** in the profile window. The first lines of the example below come from the profile of the session example on the FEI test image, the rest of its 351 rows left out:

```
# sem-measurement-tool profile 1
# image: fib_cross_section.tif
# image_sha256: 8719dc9863e3ed63e8a20aa7b6c0d80f25ec7db5c6dff7b46b1199baec3e0567
# image_size_px: 3072 2188
# databar_rows: 140
# microscope: FEI Helios 5 UX
# pixel_size_nm: 1.34896 1.34896
# tilt_deg: 51.996
# correction: cross-section
# correction_factor: 1.269087439
# tilt_axis_deg: 0
# rotation_deg: 0.25
# origin_px: 1536 1024
# px_to_um: 0.001348947159 0.000007469759442 0.000005885929693 -0.001711931896
# unit: um
# profile: profile 1
# from_px: 1500.000 750.000
# to_px: 1500.000 1100.000
# band_width_px: 5
# length: 0.599182
# band_width: 0.006745
# samples: 351
# lines_across: 5
# crossing: 0.177116 rib
# crossing: 0.368069 slab top
# crossing: 0.368107 rib
# distance along the line in the unit above; mean, std and count of the grey values across the band
distance,mean,std,count,x_px,y_px
0.000000,31389.4,899.06031,5,1500.000,750.000
0.001712,30071.8,749.82249,5,1500.000,751.000
0.003424,30967,695.34337,5,1500.000,752.000
0.005136,30635,593.16878,5,1500.000,753.000
```

**Header.** The keys of the CSV header (*The CSV header* above), then:

| Key | Value | Meaning |
|:--|:--|:--|
| `profile` | text | the profile's name |
| `from_px`, `to_px` | `x y` | its ends, pixel coordinates; distances run from `from_px` |
| `band_width_px` | number | the band width in pixel widths of the corrected view, as in the session |
| `length`, `band_width` | number | the profile's length and the band width in the unit (absent when the correction factor is undefined) |
| `samples` | integer | samples along the line: about one per stored pixel (MATH.md, (P2)) |
| `lines_across` | integer | lines averaged across the band (MATH.md, (P3)) |
| `crossing` | `distance name` | a contour crossing the line: the distance from `from_px` in the unit, then the contour's name. One line per crossing, in order along the line. |

**Rows.** One per sample, in order along the line:

- `distance`: from `from_px`, in the unit, with 6 decimals in µm and 3 in pixels;
- `mean`: the mean of the band's grey values there (eight significant digits);
- `std`: their standard deviation, the spread across the band (0 for a band of one line);
- `count`: how many of the lines have a value there; outside the image or in its info bar there is none, and `mean` and `std` are then empty;
- `x_px`, `y_px`: the sample's position on the centre line, pixel coordinates.

The grey values are those stored in the image, not the display's.

## GDSII file

A binary GDSII stream file (release 6.0) with one library holding one cell. MATH.md, part 4, derives its units and its eight-byte reals.

| Part | Content |
|:--|:--|
| library | `SEM_MEASUREMENT_TOOL`; the date of the export as its modification and access times |
| units | user unit 1 µm, database unit 1 nm: UNITS holds 1e-3 and 1e-9 |
| cell | the name typed in the dialog, by default the image's name: at most 32 characters, anything but letters, digits, `_`, `?` and `$` turned into `_` |
| coordinates | those of the polygon file, micrometres in the measurement frame (`px_to_um` and `origin_px`), rounded to the 1 nm grid |
| closed contour | a BOUNDARY on the contour's layer and datatype, its first point repeated at the end as GDSII requires |
| open contour | a PATH (flush ends, pathtype 0) on its layer and datatype, of the width typed in the dialog (0: a line) |
| contour name (optional) | a TEXT at the first vertex, on the contour's layer, its texttype the contour's datatype |
| measurement (optional) | its points as PATHs of width 0 (two for an angle between lines), and its name and value as a TEXT (`ruler 1: 0.472136 um`, `angle 1: 111.025 deg`), at the ruler's middle, the angle's vertex or where the lines cross; a profile as one PATH as wide as its band, whose flush ends make it the band itself, labelled with its length and band width; all on the annotation layer and datatype |

Rounding to the 1 nm grid can make neighbouring points coincide; repeated points are dropped. The export then leaves out, and lists:

- a polygon left with fewer than three distinct points;
- a path left with fewer than two;
- a layer or datatype outside 0–32767;
- an element of more than 8191 points: an XY record holds at most (65535 − 4) / 8, so a polygon has at most 8190 vertices.

Text is ASCII; any other character becomes `?`.
