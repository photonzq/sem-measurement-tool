# SEM measurement tool

A web app for metrology on scanning electron micrographs, which runs entirely in the browser. It works on SEM images:

- trace polygon contours;
- measure distances, angles at a vertex, and angles between two lines;
- take line profiles averaged across a band of adjustable width, with the contours that cross them marked;
- snap clicks to edges, which a noise-robust gradient finds;
- correct a tilted specimen and turn the image;
- list a contour's vertices in a table and edit them there;
- set the brightness and contrast on a histogram of the image, the microscope's info bar left out.

All of these work through one affine map from the stored pixels, so no calibration change ever moves a point on the image. The work is kept in a session file. Contours are exported as a polygon file, e.g. for a mode solver, and as a GDSII layout; measurements go to a CSV file for a spreadsheet.

**Nothing leaves your computer.** The app is a static page with no server behind it. Images are read with the browser's File API and results are saved as downloads, whether the page comes from GitHub Pages or from disk.

- [MATH.md](MATH.md) derives the geometry, the edge detection, the snapping, the display and the line profiles, and analyses the performance.
- [FORMAT.md](FORMAT.md) specifies the files.

## Opening it

- **Online.** The app is the repository's `index.html` with its scripts, so GitHub Pages serves it as it is. Enable Pages once under *Settings → Pages*: *Deploy from a branch*, branch `main`, folder `/ (root)`. The app is then at `https://<owner>.github.io/sem-measurement-tool/`, `<owner>` being the account or organisation that holds the repository. The empty `.nojekyll` file makes Pages serve the files as they are.
- **Offline.** Download the repository (*Code → Download ZIP*) or clone it, and open `index.html` in a browser; a double click is enough. Nothing needs to be installed.

It has been tested in Chromium-based browsers, both served over HTTP and opened from disk in Microsoft Edge. It has not yet been tested in Firefox or Safari.

## Working with it

1. **Open an image**: *Open image…*, Ctrl+O, or drop the file onto the view. TIFF files from FEI / Thermo Fisher or Zeiss come with their pixel size and stage tilt, which the panel shows under *Metadata*. The image opens with automatic contrast; *Display*, at the bottom of the panel, shows its histogram and sets the levels by hand. No tool is selected at first: drag to pan and use the wheel, or two fingers, to zoom.
2. **Check the calibration** under *Scale, tilt and rotation*. Choose the tilt correction:
   - *cross-section* for a FIB face;
   - *tilted surface* for features in a tilted surface;
   - *none* for untilted images, or images the microscope corrected itself.

   Set the origin if the micrometres should start somewhere particular.
3. **Snapping** to edges is on from the start; S switches it. The edge map (G) shows what clicks snap to. It is computed as the image opens, in a few seconds for a large image.
4. **Trace and measure** with the tools: *Contour* (1), *Ruler* (2), *Angle* (3), *2 lines* (4) and *Profile* (5). *Pan* (0), or a click on the active tool, puts the tool down again.
5. **Level the image** if you like. Draw a ruler along something that should be horizontal, such as the substrate, select it and press *Level: horizontal* (H) or *Level: vertical* (V). Lengths and angles do not change; directions and the exported coordinates turn with the image.
6. **Keep the work**: *Save session* (Ctrl+S). *Export polygons* writes the contours for a mode solver, *Export GDS…* writes them as a GDSII layout, each on its layer, and *Export measurements* writes the rulers and angles. To continue later, open the image, then *Open session…*.

Every edit can be undone with Ctrl+Z and redone with Ctrl+Y. That includes points, measurements and calibration changes.

## Tools

- **Pan** (0): no tool. A drag pans and the wheel zooms, and no click edits anything. The app opens with it, and a click on the active tool's button also returns to it.
- **Contour.**
  - A click adds a vertex at the end of the active contour (amber); the other contours are cyan.
  - Ctrl+click inserts a vertex into the nearest segment. While Ctrl is held, before any click, the segment that will receive the vertex is drawn thick in magenta, with the two edges replacing it dashed out to where the vertex will land. That point is snapped as the click will snap it, or exact with Alt. Over an existing vertex nothing shows, since a Ctrl+click there moves that vertex.
  - A drag moves a vertex, a right click deletes one, and Backspace deletes the last. A click on a vertex, without dragging, selects it for the vertex window; Shift+click adds or removes it.
  - The first vertex starts *contour 1*; there is no empty contour before it. N starts a new contour, and C closes or opens the active one.
  - The panel shows each contour's perimeter, area and bounding box, the box taken in the turned frame, and its GDS layer and datatype (1/0 unless set).
- **Ruler.** Two clicks. It shows the length, the components ΔX and ΔY, and the direction, counter-clockwise from +X.
- **Angle.** Three clicks: the end of one arm, the vertex, the end of the other arm. It gives the angle at the vertex, 0–180°.
- **2 lines.** Four clicks, two on each line, give the angle between the two lines as clicked, 0–180°, and its supplement. The lines are extended, dashed, to where they cross. This suits corners that are rounded, such as a sidewall meeting a substrate.
- **Profile.** Two clicks give a line profile: the grey values along the line, averaged across a band around it. See *Line profiles* below.

The **points of a measurement** handle as follows:

- drag a point to move it; it snaps when released;
- right-click a point to delete its measurement;
- Esc, or a right click, cancels a measurement being placed, and Backspace removes its last point;
- Alt with any click or release places a point exactly, without snapping.

The *Measurements* list selects, renames and deletes; the selected measurement is drawn in yellow, the others in coral.

## Vertex window

*Vertices…* under *Contours*, or T, opens a floating window over the image that lists the active contour's vertices: their number and X, Y in the measurement frame. These are the micrometres of the polygon file, or corrected pixels without a pixel size. Drag the window by its title bar and resize it from its lower right corner.

- **Selecting.** A click on a row selects that vertex, Ctrl+click adds or removes one, and Shift+click selects a range. A click on a vertex in the image does the same as a click on its row, Shift+click as Ctrl+click. Selected vertices are ringed in violet in the image, with their numbers.
- **Up, Down.** Move the selected vertices one place earlier or later in the order. Adjacent selected vertices move as a block, and a block at the start or end stays.
- **Drop** (Delete, or Backspace): remove the selected vertices.
- **First** (closed contours, one vertex selected): renumber the contour to start there. The polygon is unchanged.
- **Reverse**: run the contour the other way. A closed contour keeps its first vertex; an open one swaps its ends.
- **Zoom**: centre and zoom the view on the selected vertices, or on the whole contour when none is selected.
- **Typing coordinates.** Double-click an X or Y cell, type the value, and press Enter (Esc keeps the old one). The vertex moves to the stored point that the inverse map (MATH.md, (G10)) gives.
- **Arrow keys** move the selected vertices by one view unit in the direction they point on screen (Shift: ten), whatever the zoom, tilt correction or rotation. One view unit is the width of a stored pixel: a cross-section's rows count $k$ times, so Up moves a vertex by $1/k$ of a row (MATH.md, (G15)).

Every operation can be undone.

## Line profiles

The *Profile* tool (5) takes the grey values along a line, averaged across a band around it.

- **Placing.** Click both ends. A profile's ends are placed exactly where clicked, never snapped: a profile runs across edges, not along them. Drag an end to move it.
- **The band.** It is a rectangle as seen on screen, whatever the tilt correction or rotation. Its width is in the measurement unit, or in pixels of the corrected view.
  - Widen or narrow it by dragging the white square on its side. The profile must be selected for the square to show.
  - Or type the width in the profile window.
  - New profiles take the last width set. A width of one pixel or less is the line alone.
- **Sampling.** Values are read about one stored pixel apart, both along the line and across the band. They are interpolated bilinearly from the stored grey values, not from the display. Points outside the image, or in its info bar, have no value. MATH.md, Part 6, derives the sampling.
- **The profile window** plots the selected profile. It opens by itself when a profile is made, and on a double click or double tap on a profile under *Measurements*; P shows or hides it. It shows:
  - the mean across the band against the distance from the first end;
  - the spread across the band (± one standard deviation), shaded;
  - every contour that crosses the line, as a dashed line in the contour's colour with its name.

  Point at the plot to read the distance, the mean and the spread there; the image marks the same place with a magenta tick. The note under the plot lists the contours crossing the line and where, along it, they cross. Drag the window by its title bar and resize it from its lower right corner.
- **Export CSV**, in the window, writes the profile's samples: distance, mean, spread, number of values and position. Its header gives the line, the band and the crossings.
- **Kept like the other measurements.** A profile is listed under *Measurements*, saved in the session with its band width, and written to the measurements file with its length, band width and mean grey value. In the GDS export it becomes a path as wide as its band.

## Display

*Display*, the last section of the panel, sets how the grey values are shown, with the controls of ImageJ's *Brightness/Contrast* window, on a histogram of the image without its info bar.

- **Histogram.** It counts the rows above the info bar (see *Microscope files*), in at most 256 bins.
  - **Span.** As in ImageJ, it spans 0–255 for an 8-bit image: grey, palette or colour, and PNG, JPEG or BMP files. For 16- and 32-bit images it spans the values that occur above the info bar.
  - **Bins.** With whole-number data every bin spans the same number of grey values: one for an 8-bit image, 233 for the FEI test image.
  - *log counts* brings out sparse values such as the tails.
  - The note under it gives the rows counted, the values found, the bins and, for 8 bits, the fixed span.
- **Black and white level.** The black level shows black and the white level white. The values between are spread linearly over the screen's 256 grey steps, and values outside are clipped, which the histogram shades. Type the levels, or drag the triangles under the histogram: the filled one is the black level, the open one the white level.
- **Brightness** moves the window between the two levels across the values, keeping its width.
- **Contrast** narrows or widens the window about its centre. At the middle of the slider the window is as wide as the histogram. To the left it widens without bound, and to the right it narrows to a threshold. These are ImageJ's slider laws (MATH.md, 5.3).
- **Auto** puts the levels at the 0.5 and 99.5 % percentiles, as when the image opens.
- **Full range** puts them at the ends of the histogram, as ImageJ's *Reset* does: 0 and 255 for an 8-bit image, else the darkest and the brightest value.

The sliders follow the levels however they are set. They span what the histogram spans, so the same position means the same levels on every 8-bit image. The one departure from ImageJ: for 16 and 32 bits, ImageJ takes the extreme values of the whole image, including any info bar.

The display changes the picture only. The edge map, the snapping and every measurement use the grey values as stored, whatever the levels. The session keeps the levels; a session without them opens with *Auto*.

## Calibration: scale, tilt, tilt axis, rotation

Every quantity goes through one affine map, $P = A\,(u - u_0)$ with $A = R(\varphi)\,K\,D\,F$ (MATH.md, 1.6). It takes the stored pixel coordinates $u$ to micrometres, $x$ right and $y$ up.

- **Pixel width and height** (nm), $D$. They come from the metadata and can be edited, e.g. for images without metadata. When the pixel size is unknown, lengths are in pixels.
- **Stage tilt θ** and the **tilt correction**, a stretch by $k$ across the tilt axis ($K$):

  | correction | $k$ | exact for |
  |:--|:--|:--|
  | none | 1 | untilted images, or images the microscope has already corrected |
  | cross-section | $1/\sin\theta$ | a face normal to the surface that contains the tilt axis: 1.269 at 52° |
  | tilted surface | $1/\cos\theta$ | anything lying in the tilted surface |
  | custom | as entered | any other case |

  The correction is exact in the plane it is chosen for and only there: one projection cannot restore what lies off that plane (MATH.md, 1.4). The panel warns when the metadata say the microscope applied its own tilt correction, and suggests a correction when the stage is tilted but none is chosen.
- **Tilt axis α**, the direction of the stage tilt axis in the image, counter-clockwise from the horizontal. It defaults to 0: the scan aligned with the axis, as microscopes set it up for their own tilt correction.
  - *Tilt axis along ruler* takes α from the selected ruler. Draw that ruler on a line known to be parallel to the axis, such as the surface line of a FIB face milled parallel to the tilt axis.
  - The app does not take α from the scan rotation in the metadata. The FEI test image records 1.32°, yet its interfaces lie within ±0.4° of the image rows.
  - An α off by δ skews right angles by $(k - 1/k)\,\delta$ and changes lengths at 45° by $(k - 1/k)\,\delta/2$. At a 52° cross-section that is 0.48° and 0.42 % per degree (MATH.md, 1.5).
- **Rotation φ** turns the corrected image ($R(\varphi)$). It is rigid, so lengths, angles and areas never depend on it. Set it with the *Level* buttons, by typing it, or with *Rotation 0°*.
- **Origin** $u_0$: *Set origin* takes the next click; *Reset origin* returns it to the centre of the top-left pixel.

The view draws the stored image through the same map, so a change of calibration costs no computation: no pixel is resampled in script.

## Snapping

With *Snap* on, as it is from the start (S switches it), a click lands on the strongest edge nearby, and a magenta ring shows in advance where it will land. The method is in MATH.md, Part 2:

- **Edge strength.** The gradient of a Gaussian-smoothed image, after an optional 3 × 3 or 5 × 5 median filter: *smoothing σ*, in pixels of the stored image. Larger σ resists noise better, but merges edges closer than about 2σ.
- **Threshold.** Candidates must be *min. edge strength* times the median gradient of the image. Pure noise exceeds $c$ times the median with the probability $2^{-c^2}$ per independent sample, 0.2 % at the default 3.
- **Candidates and choice.** Candidates are the crest pixels within the *search radius*, measured in pixels of the corrected view. The choice weighs strength against distance, and a parabola places the point between pixels, to within 0.05 px for a crest one pixel wide. The point may slide a pixel or two **along** the edge.
- **Where the map is computed.** The edge map is computed on the stored image, without the info bar, once per σ and median setting. The noise is independent pixel to pixel there and the probe round, so this is also the matched filter.
- **Bright lines.** Many SEM edges appear as bright lines, which have two flanks. A click snaps to the flank nearest to it, so trace one flank consistently, or use Alt to place points on the line's centre.

*Show the edge map* (G) overlays the edge strength in green, which shows what the snapping sees.

## Files

| File | Use |
|:--|:--|
| `<image>_session.json` | the session: image name and SHA-256, calibration, contours, measurements, snap settings, display levels. *Open session…* takes it up again on the open image, and asks first if the image differs. |
| `<image>_polygons.csv` | the contours in micrometres and pixels, with the calibration and the matrix `px_to_um` in a commented header. *Open session…* also reads it. |
| `<image>_measurements.csv` | one row per ruler, angle or profile: value, unit, components, points; a profile's band width and mean grey value |
| `<image>_<profile name>.csv` | the samples of one line profile, from *Export CSV* in the profile window |
| `<image>.gds` | the contours as a GDSII layout, for KLayout, gdstk, GDSFactory and other layout tools; written only |

[FORMAT.md](FORMAT.md) specifies them all and includes a dependency-free Python reader for the polygon file.

## GDS export

*Export GDS…* writes the contours as one GDSII cell, in the coordinates of the polygon file: micrometres in the measurement frame, so tilt-corrected, turned and from the origin. Points sit on a 1 nm grid, with the user unit 1 µm. It needs the pixel size.

- **Layers.** Each contour has its own GDS layer and datatype, set under *Contours* (1/0 by default) and kept in the session.
- **Elements.** A closed contour becomes a polygon (BOUNDARY), and an open one a path (PATH) of the width set in the dialog (0: a line).
- **Optional, ticked in the dialog:**
  - each contour's name as a text label at its first vertex, on its layer;
  - the measurements as annotations on a layer and datatype of their own (100/0 by default): rulers and angles as lines, profiles as paths as wide as their band, with their values as text (e.g. "ruler 1: 0.472136 um").
- **Cell name.** The image's name by default, cut to the 32 characters GDSII tools expect, with anything other than letters, digits, "_", "?" and "$" replaced by "_".
- **Left out, and listed after the export:** a polygon with fewer than three distinct points on the 1 nm grid, a layer outside 0–32767, a contour of more than 8190 vertices.

The files were read back with gdstk 1.0.1 and KLayout 0.30.12. Both see the cell, the layers, the polygons, paths and labels, and the units. Every vertex lies within 0.5 nm of the polygon file's coordinates, the rounding to the 1 nm grid.

## Microscope files

**FEI / Thermo Fisher** (Helios, Scios, Quanta, …) store their metadata as INI text in TIFF tag 34682 (or 34680 on older systems). The app reads:

- **Pixel size**: from `[Scan]`, or `[EScan]` / `[IScan]`, `PixelWidth` and `PixelHeight`.
- **Stage tilt**: from `[Stage] StageT`.
- **Tilt correction**: whether the microscope applied its own, from `TiltCorrectionIsOn` and `TiltCorrectionAngle` of the beam section.
- **Scan rotation**: shown, but not used.
- **Beam conditions, detector and date.**
- **Data bar**: the rows below `[Image] ResolutionY`. The bar stays in the image below a dashed line, and the histogram, the auto levels and the edge detection leave it out.

Images from the chamber camera have no pixel size. In the FEI test image the microscope's centre cross is burned into the pixels: one-pixel lines ±14 px around the image centre, which the edge map sees. The app was tested on 19 TIFFs from a Helios 5 UX: electron images with data bars of 140 and 70 rows, and chamber-camera images.

**Zeiss** (SmartSEM: Gemini, Sigma, …) store their metadata in TIFF tag 34118. The app reads:

- **Pixel size**: `AP_PIXEL_SIZE`, or the more precise value in the header when the two agree within 1 %.
- **Stage tilt**: `AP_STAGE_AT_T`.
- **Tilt correction**: `DP_TILT_CORRECTION` and `AP_TILT_ANGLE`.
- **Scan rotation**: `AP_SCANROTATION` when `DP_SCAN_ROT` is on.
- **Beam conditions, detector, system and date.**
- **Info zone**: SmartSEM draws its data zone over the bottom of the image and records nothing about it, and its place differs between instruments. The app therefore finds it in each image by its pattern (MATH.md, 5.1): a full-width black line, at least 20 rows of white box with black text below it, then another black line or the end of the image. Everything from the upper line down counts as the info bar: it stays in the image below a dashed line, and the histogram, the auto levels and the edge detection leave it out. An image without the pattern keeps all its rows.

Tested on two GeminiSEM TIFFs (1024 × 768, 8-bit grey palette). Their zones start at row 691 (GeminiSEM 360) and row 675 (GeminiSEM 560), so the info bar is 77 and 93 rows.

**Other images.** Other TIFFs open without metadata: 8, 16 or 32 bits, grey, palette or RGB, in the compressions UTIF.js decodes. Only uncompressed FEI and Zeiss files were tested. PNG, JPEG and BMP open too, decoded by the browser. Enter the pixel size by hand.

## Touch screens, pens and touchpads

The view takes touch, pen and touchpad input through the browser's pointer events, as Edge and Chrome deliver them on Windows. The page itself never scrolls or zooms under the fingers.

- **Two fingers**, with any tool, pinch to zoom and move together to pan. The image point under their midpoint stays under it (MATH.md, (G16)).
- **One finger** with no tool pans. With a tool:
  - a tap acts as a click: it adds a vertex or places a measurement's next point, snapped as a click would be;
  - a drag that starts on a point moves it, as a mouse drag does;
  - any other drag pans; a touch that moves less than 10 px is still a tap.

  A second finger landing turns what the first began into a pinch, and a point it was moving goes back where it was.
- **A pen** acts as the mouse: precise taps and drags, and the snap preview while it hovers. Its barrel button should act as a right click.
- **A touchpad** pinch zooms, as the wheel does; two-finger scrolling also zooms. To pan with a touchpad, choose no tool and drag, or hold Space and drag.

Touch has no hover, so the previews that follow the cursor (snap, insert with Ctrl) belong to the mouse and the pen.

**The touch layout.** On a device with a touch screen, or after the first touch, the app adds what a keyboard or a right button gives otherwise.

- **The touch toolbar**, at the top left of the view:
  - *Undo* and *Redo*;
  - *Fit*, the image to the view;
  - *Back*, which takes back the last point of the measurement being placed, else the active contour's last vertex, or cancels *Set origin*;
  - *Snap*, the same switch as in the panel;
  - *Exact*, which places or releases the next point exactly where the finger is, without snapping, and then lets go.
- **Press and hold** a point for half a second, while a ring fills, to open its menu beside the finger:
  - a vertex: *Delete vertex*, *Select in the vertex window*, *Insert a vertex after* (halfway to the next one);
  - a measurement's point: *Delete*, *Rename…*, and for a profile *Show the plot*.

  Held on empty image, nothing happens, and lifting the finger places nothing.
- **Larger targets.** A finger hits a point within 22 px, where the mouse needs 8. After touch input, points and handles are drawn larger. Snapping searches 2.5 times the search radius for a finger, which covers far more of the image than a cursor.
- **Floating windows** get title bars and close buttons 44 px tall, and a resize corner that answers a finger; the browser's own corner answers the mouse only.
- **The profile plot** reads out under a finger dragged along it, and the reading stays after the finger lifts.
- **Number fields** open the number keypad of the Windows touch keyboard.
- **A long press on the controls** no longer selects their text.

These were checked with pointer events simulated in Chromium. They have not yet been tried on a real touch screen or with a real pen.

## Mouse and keys

| Input | Action |
|:--|:--|
| 0 | no tool: drag to pan, wheel to zoom (also a click on the active tool's button) |
| 1 2 3 4 5 | tools: contour, ruler, angle (3 clicks), angle between 2 lines (4 clicks), line profile |
| click | contour: add a vertex; other tools: place the next point (snapped with Snap on, except a profile's ends) |
| Ctrl+click | contour: insert a vertex into the nearest segment |
| hold Ctrl | contour: show the segment that will receive the vertex and where it will land |
| click, Shift+click a vertex | contour: select it in the vertex window; add or remove it |
| Alt+click | place the point exactly, without snapping |
| drag a point | move a vertex or a measurement point; it snaps when released (Alt: not; a profile's ends never) |
| drag the white square | widen or narrow the band of the selected profile |
| right click | contour: delete the vertex; other tools: delete the measurement, or cancel the one being placed |
| wheel, touchpad pinch | zoom about the cursor |
| middle drag, Space+drag; drag with no tool | pan |
| two fingers | pinch to zoom, move together to pan |
| one finger | no tool: pan; with a tool, a tap clicks, a drag from a point moves it, any other drag pans |
| press and hold a point (touch) | its menu: delete, select, insert after (a vertex); delete, rename, show the plot (a measurement) |
| N, C | new contour; close or open the active one |
| H, V | level the selected ruler horizontal or vertical |
| S, G | snapping on or off; edge map on or off |
| T | show or hide the vertex window |
| P | show or hide the profile window; it also opens for a new profile, and on a double click or double tap on a profile under *Measurements* |
| arrow keys | move the selected vertices by one view unit on screen (Shift: ten) |
| Backspace | the last point being placed; else the selected vertices, the last vertex (contour) or the selected measurement |
| Delete | delete the selected vertices, else the selected measurement |
| Ctrl+Z, Ctrl+Y | undo, redo |
| F, +, − | fit to the window; zoom |
| Ctrl+O, Ctrl+S | open an image; save the session |
| Esc | cancel the measurement being placed, or *Set origin* |

## Performance

The costs, measured on the FEI test image of 3072 × 2188 pixels (6.29 Mpx above the data bar), are analysed in [MATH.md, Part 3](MATH.md#part-3-performance):

- **Opening an image** computes for about 0.35 s: decode, checksum, auto levels, histogram and picture. Snapping is on from the start, so the edge map follows at once, and opening took 2.7 s from the click in all.
- **A change of levels** repaints the picture in 40–70 ms, one table look-up per pixel, so the sliders and the histogram handles follow the pointer.
- **The edge map** takes 1.1 s with σ = 2 and no median, 2.1 s with the 3 × 3 median (the default), and 4.2 s with 5 × 5. It is computed only when snapping or the overlay needs it, and again only when σ or the median changes.
- **A snap search** takes microseconds.
- **A line profile** reads about 36 ns per value: 9 ms for 3001 samples along a band of 83 lines. A profile and its window are therefore computed again at every step of a drag.
- **Calibration and rotation changes**, panning and zooming cost one GPU-drawn frame.
- **Memory**: about 180 MB for that image with the overlay shown.

The page does not respond while an edge map is computed. A Web Worker would remove the wait; MATH.md 3.4 lists this and the other limits.

## Code

| Path | Content |
|:--|:--|
| `index.html` | the page: layout, panel, styles |
| `js/metadata.js` | FEI and Zeiss metadata: pixel size, data bar, tilt, beam, detector |
| `js/tiff.js` | TIFF decoding with UTIF.js into grey values and calibration; the Zeiss info zone, (Z1) in the header |
| `js/edges.js` | edge strength, crests and snapping; derivations (E1)–(E8) in the header |
| `js/transform.js` | the affine map, measures, levelling, the arrow-key step; derivations (G1)–(G15) in the header |
| `js/polygons.js` | the polygon, measurements and profile files (CSV) |
| `js/session.js` | the session file (JSON) |
| `js/gds.js` | the GDSII writer: records, units, eight-byte reals; derivations (S1)–(S2) in the header |
| `js/vertices.js` | the vertex window's operations on a contour's vertex list |
| `js/display.js` | the display: levels, brightness and contrast, the histogram's bins; derivations (D1)–(D4) in the header |
| `js/profile.js` | line profiles: the band, the samples, the contour crossings; derivations (P1)–(P5) in the header |
| `js/app.js` | the user interface, mouse, pen and touch input; zooming about a point, (G16), in its comments |
| `vendor/` | UTIF.js and pako (inflate), unmodified, with their licences |
| `types/vendor.d.ts` | types of UTIF.js for the type check |
| `tests/` | static checks and core tests; `local_data.example.json`, the form of the git-ignored file that names your test images |
| `LICENSE` | the public-domain dedication (The Unlicense) |
| `.nojekyll` | tells GitHub Pages to serve the files as they are |

The scripts are classic scripts, not ES modules, because browsers refuse modules from `file://`. They share the page's global scope, and each names what it takes from the others in a `/* global */` comment and what it gives in `/* exported */`. Types are JSDoc, checked by TypeScript in strict mode. `window.semMeasurementTool` exposes the state and the main actions to scripts that drive the page, such as tests.

## Checks

```bash
npm install
```

```bash
npm run check
```

```bash
npm test
```

*npm run check* runs the static checks:

- syntax (`node --check`);
- ESLint, with the recommended rules and stricter ones;
- TypeScript type checking of the JSDoc types under `strict`;
- html-validate;
- the page checks: every element the scripts look up exists, every script the page loads exists, and the vendored files match their SHA-256 in `vendor/LICENSES.md`.

Without `node_modules` in this folder, point the static checks at a folder that has the tools:

```bash
node tests/run_static_checks.mjs --tools <folder with node_modules>
```

*npm test* runs `tests/check_core.mjs`, which loads the scripts in Node and covers:

- **Decoding.** Every FEI TIFF of a folder and the Zeiss files given are decoded and checked: vendor, size, bits per sample, info bar, pixel size, and the values against the file's bytes. With `tests/local_data.json` (below), each Zeiss file must also decode to the pixel size, tilt and info bar given there.
- **Info zone.** On synthetic images the search finds a zone between two black lines and a zone running to the last row. It finds none in an image without one, in a black line alone, or in a saturated band without lines.
- **Edges.** The gradient on a ramp, snapping on a noisy edge and on flat noise, and the radius through the view metric.
- **Geometry.** The geometry checks:
  - correction factors;
  - the map and its inverse;
  - the tilt axis;
  - rigid rotation;
  - angles and line crossings;
  - levelling and the tilt axis along a line;
  - contour measures.
- **Files.** Round trips of the polygon, measurements and session files (GDS layers, display levels and profile band widths included), the profile file, and the refusal of bad ones.
- **GDSII.**
  - The eight-byte reals against bytes computed exactly in Python, which are also what gdstk and KLayout write for the units.
  - 2000 random values read back exactly.
  - A file read back record by record: units, dates, a polygon closed on the 1 nm grid, a path with its width, a label, and the elements it must leave out, with their reasons.
- **Vertex window.** Its operations (move as blocks, drop, make first, reverse, ranges) and the arrow-key step in four frames, a 90° rotation and a tilted cross-section among them.
- **Display.**
  - The histogram's bins: 8-bit images over 0–255, one value per bin, with colour luminances at their nearest value; equal whole-value bins over the values of 16-bit images; floats; a single value.
  - Brightness and contrast against the arithmetic of ImageJ's ContrastAdjuster, transcribed in the test, at every position of its sliders and for 1000 random windows.
  - The sliders' round trip from levels to positions and back.
  - The grey map and the auto levels.
- **Line profiles.**
  - Samples along a ramp exact, along a row and between pixel centres.
  - Values missing outside the image and in the info bar.
  - Distances in micrometres with pixels of 2 × 3 nm.
  - Band averages and spreads, also with rows that count twice.
  - The same profile with the image turned by 90°.
  - In a tilted, turned frame, every line of the band normal to the profile as seen and at its offset.
  - Contour crossings: a closed contour's closing side, a vertex on the line counted once, none along or beyond the line.

The decoding checks need SEM images of your own, which the repository does not hold. Name them on the command line:

```bash
node tests/check_core.mjs "<FEI folder>" "<Zeiss TIFF>" "<Zeiss TIFF>"
```

Or name them once in `tests/local_data.json`, which git ignores. `tests/local_data.example.json` shows its form, including the pixel size, tilt and info bar that each Zeiss file must decode to. Without test images, the decoding checks are skipped and the others run.

## Third-party code

`vendor/` holds two libraries, unmodified. Their versions, sources, SHA-256 checksums and licence texts are in `vendor/LICENSES.md`.

- **UTIF.js 3.1.0** (Photopea, MIT licence) decodes TIFF files and exposes their private tags.
- **pako 1.0.11**, its inflate part (MIT licence, with zlib-derived code under the zlib licence), serves Deflate-compressed TIFFs.

The development tools (ESLint, TypeScript, html-validate) are only needed for the checks and are not part of the app.

## Limits

- **TIFF files.** Only the first image of a multi-image TIFF is read.
- **Console message.** UTIF.js writes "unknown TIFF tag type: 13" to the browser console for FEI files, about a directory-pointer tag it skips; it is harmless.
- **Zeiss info zone.** It is recognised by its pattern (MATH.md, 5.1). A zone drawn otherwise, for instance without its black lines, is not found, and then takes part in the histogram, the auto levels and the edge map. Image rows that happened to show the pattern in the lowest third would be taken for a zone and left out.
- **Snapping.** Bright lines have two flanks; edges closer than about 2σ merge; a snapped point may slide a pixel or two along its edge.
- **Line profiles.**
  - Straight lines only.
  - The band is averaged with equal weights.
  - The window shows the selected profile only.
  - Crossings are those of contours with the centre line; other measurements are not marked.
- **Tilt correction.**
  - It is exact only in the chosen plane.
  - It assumes an orthographic projection, which holds to a fraction of a pixel at usual magnifications (MATH.md, 1.2).
  - The tilt axis direction must be known.
- **Scale.** Lengths are as good as the microscope's magnification calibration.
- **GDSII.**
  - One cell, without hierarchy; paths have flush ends.
  - Labels are ASCII: other characters become "?".
  - The app writes GDS files but does not read them.
- **Size and responsiveness.** The edge map blocks the page for seconds on large images. Browsers limit canvas sizes, to 32 767 px per side in Chromium, and very large images exceed the memory budget (MATH.md, 3.4).

---

Made with AI tools. License: public domain ([The Unlicense](LICENSE)); the two libraries in `vendor/` stay under their MIT terms ([vendor/LICENSES.md](vendor/LICENSES.md)).
