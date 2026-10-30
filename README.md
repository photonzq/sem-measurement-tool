# SEM measurement tool

**Use it online: [photonzq.github.io/sem-measurement-tool](https://photonzq.github.io/sem-measurement-tool/)**, or offline from a copy of this repository (see *Opening it*).

A web app for metrology on scanning electron micrographs, which runs entirely in the browser. It works on SEM images:

- trace polygon contours;
- measure distances, angles at a vertex, and angles between two lines;
- take line profiles averaged across a band of adjustable width, squared to the edge they cross, with the contours that cross them marked;
- snap clicks to edges, which a noise-robust gradient finds;
- correct a tilted specimen and turn the image;
- list a contour's vertices in a table and edit them there;
- set the brightness and contrast on a histogram of the image, the microscope's info bar left out.

All of these work through one affine map from the stored pixels, so no calibration change ever moves a point on the image. The work is kept in a session file. Contours are measurements like the others, in one list. A contour downloads as a polygon file, e.g. for a mode solver, or as a GDSII layout, and a line profile as its samples or as a plot. Any selection downloads as a CSV file for a spreadsheet, one row per measurement.

**Nothing leaves your computer.** The app is a static page with no server behind it. Images are read with the browser's File API and results are saved as downloads, whether the page comes from GitHub Pages or from disk.

- [MATH.md](MATH.md) derives the geometry, the edge detection, the snapping, the display, the line profiles and their squaring to an edge, and analyses the performance.
- [FORMAT.md](FORMAT.md) specifies the files.

## Opening it

- **Online** at [https://photonzq.github.io/sem-measurement-tool/](https://photonzq.github.io/sem-measurement-tool/), which GitHub Pages serves from this repository's `main` branch. The app is the repository's `index.html` with its scripts, so Pages serves it as it is; the empty `.nojekyll` file keeps Pages from processing the files. A fork or a copy is served the same way once Pages is enabled under *Settings → Pages*: *Deploy from a branch*, branch `main`, folder `/ (root)`. It is then at `https://<owner>.github.io/sem-measurement-tool/`, `<owner>` being the account or organisation that holds it.
- **Offline.** Download the repository (*Code → Download ZIP*) or clone it, and open `index.html` in a browser; a double click is enough. Nothing needs to be installed.

It has been tested in Chromium-based browsers, both served over HTTP and opened from disk in Microsoft Edge. It has not yet been tested in Firefox or Safari.

## Working with it

1. **Open an image**: *Open image…*, Ctrl+O, or drop the file onto the view. TIFF files from FEI / Thermo Fisher or Zeiss come with their pixel size and stage tilt, and Hitachi TIFFs with their pixel size. Where the microscope writes its metadata to a file beside the image (Hitachi's and JEOL's `.txt`, TESCAN's `.hdr`), select or drop both files together; that file is then used, for an image of any format, JPEG included. The panel shows the metadata under *Metadata*. The image opens with automatic contrast; *Display*, at the bottom of the panel, shows its histogram and sets the levels by hand. No tool is selected at first: drag to pan and use the wheel, or two fingers, to zoom.
2. **Check the calibration** under *Scale, tilt and rotation*. Choose the tilt correction:
   - *cross-section* for a FIB face;
   - *tilted surface* for features in a tilted surface;
   - *none* for untilted images, or images the microscope corrected itself.

   Set the origin if the micrometres should start somewhere particular.
3. **Snapping** to edges is on from the start; S switches it. The edge map (G) shows what clicks snap to. It is computed as the image opens, in a few seconds for a large image.
4. **Trace and measure** with the tools: *Contour* (1), *Ruler* (2), *Angle* (3), *2 lines* (4), *Profile* (5) and *Gap* (6). *Pan* (0), or a click on the active tool, puts the tool down again.
5. **Level the image** if you like. Draw a ruler along something that should be horizontal, such as the substrate, and select it. Then press *Level: horizontal* (H) or *Level: vertical* (V); these buttons, and *Tilt axis along ruler*, appear under *Measurements* while a ruler is selected. Lengths and angles do not change; directions and the exported coordinates turn with the image.
6. **Keep the work**: *Save session* (Ctrl+S). To continue later, open the image, then *Open session…*. *Download*, under *Measurements*, saves what is selected:
   - a contour: its vertices for a mode solver, or a GDSII layout;
   - a profile: its samples, or its plot as a PNG image;
   - a ruler or an angle: its row;
   - several: one row each, and the vertices or a GDSII layout of the contours among them.

   Its last entries do the same for all the measurements.

Every edit can be undone with Ctrl+Z and redone with Ctrl+Y. That includes points, measurements and calibration changes. While a measurement is being placed, Ctrl+Z first takes back its last point.

**The status bar** under the view is hidden at first. The *status bar* switch, pinned at the bottom right under the panel, shows it, and the browser keeps the choice. It gives the cursor's position in pixels and micrometres, the grey value there and the edge strength, and the app's messages: a file opened or saved, why a profile was not squared, what to select first. While it is hidden, each message shows for a few seconds in a box at the bottom of the view.

## Tools

- **Pan** (0): no tool. A drag pans and the wheel zooms, and no click edits anything. The app opens with it, and a click on the active tool's button also returns to it.
- **Contour.**
  - A click adds a vertex at the end of the selected contour, which is drawn thicker, with a light halo and white vertices, its first vertex larger.
  - With no contour selected, the first click starts a new one: *contour 1*, *contour 2* and so on. There is never an empty contour waiting. N is done with the selected contour, so that the next click starts a new one; it also takes up the contour tool. C closes or opens the selected contour.
  - Ctrl+click inserts a vertex into the nearest segment. While Ctrl is held, before any click, the segment that will receive the vertex is drawn thick in magenta, with the two edges replacing it dashed out to where the vertex will land. That point is snapped as the click will snap it, or exact with Alt. Over an existing vertex nothing shows, since a Ctrl+click there moves that vertex.
  - A drag moves a vertex, a right click deletes one, and Backspace deletes the last. A click on a vertex, without dragging, selects it for the vertex window; Shift+click adds or removes it. Touching another contour's vertex selects that contour.
  - A selected contour shows its measures under *Measurements*: its perimeter (or length, when open), its area and its bounding box, taken in the turned frame. Its *closed* switch and its GDS layer and datatype (1/0 unless set) are there as well.
- **Ruler.** Two clicks. It shows the length, the components ΔX and ΔY, and the direction, counter-clockwise from +X.
- **Angle.** Three clicks: the end of one arm, the vertex, the end of the other arm. It gives the angle at the vertex, 0–180°.
- **2 lines.** Four clicks, two on each line, give the angle between the two lines as clicked, 0–180°, and its supplement. The lines are extended, dashed, to where they cross. This suits corners that are rounded, such as a sidewall meeting a substrate.
- **Profile.** Two clicks give a line profile: the grey values along the line, averaged across a band around it. See *Line profiles* below.
- **Gap.** Four clicks, two on each of two edges, give the gap between the lines: a waveguide's width, a layer's thickness.
  - It is measured in micrometres, where right angles are true, along the normal of the lines' mean direction, midway between their middles. For parallel lines that is their distance, wherever the points are (MATH.md 1.10, (G17)).
  - The readout also gives how far the lines are from parallel, and the gap's components from line 1 to line 2.
  - The normal is drawn between the lines with arrow heads. A line is dashed out to it when it lies beyond the points.
  - The points snap as a ruler's do.

The **points of a measurement** handle as follows:

- drag a point to move it; it snaps when released;
- right-click a point to delete its measurement;
- Esc, or a right click, cancels a measurement being placed, and Backspace or Ctrl+Z removes its last point;
- Alt with any click or release places a point exactly, without snapping.

## Measurements

One list under *Measurements* holds them all: contours, rulers, angles, gaps and profiles, in the order made, each with its colour and its brief measures. Selected measurements keep their colour and are drawn thicker, with a light halo and white points (see *Overlay colours*).

- **Selecting.** A click or a tap on a row selects that measurement alone. Its box, or Ctrl+click, adds it to the selection or takes it out. Shift+click selects from the row clicked last, and Ctrl+A selects all.
- **The one edited.** A measurement selected alone is the one edited, marked by a bar at the left of its row. It is the contour the contour tool extends, the profile the profile window shows, and the ruler that *Level* and *Tilt axis along ruler* take. Touching a measurement's point with its tool makes it the one edited.
- **Double click or double tap**: a profile's plot, or a contour's vertex window. The arrow keys move through the list; Enter does what a double click does.
- **Rename** a measurement selected alone. **Delete**, or the Delete key, deletes all the selected ones, contours included; Ctrl+Z brings them back.
- **Download** saves the selection, as the menu offers for what is selected:

  | Selected | Downloads |
  |:--|:--|
  | a contour | its vertices, a polygon file (CSV); a GDSII file |
  | a profile | its samples, a profile file (CSV); its plot (PNG) |
  | a ruler, an angle, an angle between lines, a gap | its row of the measurements file (CSV) |
  | several | one row each in a measurements file (CSV); the vertices of the contours among them in one polygon file (CSV); a GDSII file of those contours |

  The menu's last entries save all the measurements in the same three ways, without selecting them.

## Vertex window

*Vertices…*, shown when a contour is selected, opens a floating window over the image. So do T and a double click on a contour in the list. The window lists the selected contour's vertices: their number and X, Y in the measurement frame. These are the micrometres of the polygon file, or corrected pixels without a pixel size. Drag the window by its title bar, anywhere on the page, over the panel too, and resize it from its lower right corner.

- **Selecting.** A click on a row selects that vertex, Ctrl+click adds or removes one, and Shift+click selects a range. A click on a vertex in the image does the same as a click on its row, Shift+click as Ctrl+click. Selected vertices are ringed in violet in the image, with their numbers.
- **Up, Down.** Move the selected vertices one place earlier or later in the order. Adjacent selected vertices move as a block, and a block at the start or end stays.
- **Drop** (Delete, or Backspace): remove the selected vertices.
- **First** (closed contours, one vertex selected): renumber the contour to start there. The polygon is unchanged.
- **Reverse**: run the contour the other way. A closed contour keeps its first vertex; an open one swaps its ends.
- **Zoom**: centre and zoom the view on the selected vertices, or on the whole contour when none is selected.
- **Typing coordinates.** Double-click or double-tap an X or Y cell, type the value, and press Enter (Esc keeps the old one). The vertex moves to the stored point that the inverse map (MATH.md, (G10)) gives.
- **Arrow keys** move the selected vertices by one view unit in the direction they point on screen (Shift: ten), whatever the zoom, tilt correction or rotation. One view unit is the width of a stored pixel: a cross-section's rows count $k$ times, so Up moves a vertex by $1/k$ of a row (MATH.md, (G15)).

Every operation can be undone.

## Line profiles

The *Profile* tool (5) takes the grey values along a line, averaged across a band around it.

- **Placing.** Click both ends. The ends are never snapped, since a profile runs across edges, not along them; the profile is squared instead (below). Drag an end to move it: when it is let go, the profile is squared again, about the other end.
- **Squaring.** A new profile turns to run square to the edge it crosses, as seen on screen. It turns about the point where it crosses the edge, and keeps its length and that point's place along it. The edge is:
  - a traced contour the profile crosses, if there is one (of the crossings, the one nearest the profile's middle);
  - else the image's strongest edge along the profile. Its direction comes from the gradients around the crossing, through the structure tensor, which averages them without letting the two flanks of a bright line cancel (MATH.md 6.6).

  A profile whose end was dragged turns instead about its other end, which stays where it is, and keeps the length it was dragged to. The crossing then slides a little along the edge: by $s\sin\delta$ for a crossing $s$ from that end and a profile $\delta$ off square (MATH.md 6.6).

  For a moment a note beside the cursor shows what was done and the angle turned: "⊥ edge, 4.2°", or the contour's name for a contour. The profile stays as drawn, with "not squared" and the reason in the status bar, in three cases:
  - no edge along it reaches the snapping threshold;
  - the edge has no single direction there: a corner, a junction or a tight curve;
  - it is more than 15° off square ("not squared: 34.1° off"). Such a profile was most likely drawn at its angle on purpose, for instance horizontally across a sloped sidewall. A profile drawn square by eye is a few degrees off.

  How to keep or redo it:
  - Ctrl+Z right after gives the profile back as drawn, or as dragged; a second Ctrl+Z removes it, or undoes the drag.
  - Alt+click places a profile as drawn, and Alt held when a dragged end is let go keeps it as dragged.
  - E squares the profile edited whatever the angle, for instance when it was more than 15° off. It turns about the crossing, as for a new profile.
  - *square profiles to the edge they cross*, under *Snapping*, is on from the start.
- **The band.** It is a rectangle as seen on screen, whatever the tilt correction or rotation. Its width is in the measurement unit, or in pixels of the corrected view.
  - Widen or narrow it by dragging the white square on its side. The profile must be selected for the square to show.
  - Or type the width in the profile window.
  - New profiles take the last width set. A width of one pixel or less is the line alone.
- **Sampling.** Values are read about one stored pixel apart, both along the line and across the band. They are interpolated bilinearly from the stored grey values, not from the display. Points outside the image, or in its info bar, have no value. MATH.md, Part 6, derives the sampling.
- **The profile window** plots the selected profile. It opens by itself when a profile is made, and on a double click or double tap on a profile under *Measurements*; P shows or hides it. It shows:
  - the mean across the band against the distance from the first end;
  - the spread across the band (± one standard deviation), shaded;
  - 0 and the full scale of the image's values, as solid lines labelled on the y axis, which always spans both. A profile clipped at black or at white runs flat along one of them. The full scale is 255 for 8-bit images and those the browser decodes, 65535 for 16-bit ones and $2^{32}-1$ for 32-bit whole numbers. Float images have none: the line marks their largest value above the info bar (see also *Limits*);
  - every contour that crosses the line, as a dashed line in the contour's colour with its name;
  - the markers A and B, as solid dark lines, with the distance between them on a double arrow.

  Point at the plot to read the distance, the mean and the spread there; the image marks the same place with a magenta tick. Where part of the band lies outside the image, the reading also gives how many of its values are left. The note under the plot gives the number of samples along the line and, when contours cross it, which and where along it. Drag the window by its title bar, anywhere on the page, over the panel too, and resize it from its lower right corner.
- **Markers A and B** measure a distance along the profile, for instance from one edge to the other.
  - A click on the plot places A, a second one B. Later clicks move the nearer marker, and a marker can be dragged. A drag that starts elsewhere still reads values, and places nothing. *Clear A, B* removes both. Each of these is an edit that Ctrl+Z undoes.
  - The line under the reading gives where each marker is, the mean there, and the distance A–B. On the image, each is a tick across the band, in the profile's colour, with its letter.
  - *snap A, B to the steepest slope*, in the window and on from the start, lets a marker settle where the profile is steepest within 12 pixels of the plot. This is where an edge is, for an edge-to-edge distance.
    - The slope is that of the mean, smoothed from the edge map's σ up to 4 times it. The edge clicked is the one the finest of these scales finds; the coarser ones place it, and the one where it stands out of the noise best wins, as long as they find it where it was and no other edge is in their reach. A gradual edge in a noisy FIB image is thus placed nearly as well as a sharp one, and a weak edge is not given up for a stronger one nearby, nor merged with a step beside it.
    - Of two edges in reach, such as a bright line's flanks, the nearer is taken.
    - A marker snaps only where the slope stands out of the noise by more than the edge map's *min. edge strength*. As for a click on the image, the threshold rises with the search, so that a click on flat noise rarely snaps: about 4 times the noise at the default 3. The noise is measured near the click, leaving out stretches clipped to black or white and the edges there. A profile that runs mostly through a dark, quiet region thus does not lower the threshold for a noisier part, nor does a strong edge nearby raise it.
    - It also stays where it was put when the steepest point is poorly placed: when no scale places it better than 2 samples, or 2 pixels of the plot, about what a click is good to. A long ramp of nearly constant slope has no steepest point to snap to.
    - Alt places or lets go of one exactly. MATH.md 6.7 derives all this.
  - A marker is kept as a point of the image, and its place along the line is where it projects onto it. When the profile is moved, the markers therefore stay on their features of the image. After squaring, a marker on a straight edge lies on the edge where the turned profile crosses it.
- **Export CSV**, in the window or under *Download*, writes the profile's samples: distance, mean, spread, number of values and position. Its header gives the line, the band, the crossings, and the markers with the distance between them.
- **Export PNG**, in the window or under *Download*, writes the plot as an image of 1200 × 750 pixels at twice that resolution, its markers included. A title above it names the profile and the image and gives its length and band width.
- **Kept like the other measurements.** A profile is listed under *Measurements*, saved in the session with its band width and markers, and written to the measurements file with its length, band width and mean grey value. The details under *Measurements* give the distance between its markers.

## Overlay colours

Measurements are drawn in colours made to show on grey images, dark or bright:

- **One colour each.** Each new measurement takes the next colour of a colour order, as MATLAB colours the lines it plots, and keeps it; the session saves it. The list shows each measurement's colour, and the profile plot marks a crossing contour in that contour's colour.
- **Outlined lines.** Every line has a thin outline in the contrasting grey: white around a dark colour, black around a light one. No single colour stands out on dark, mid and bright grey alike, but an outlined one does.
- **Labels on dark chips.** A value is written in white on a dark chip edged in the measurement's colour, legible on any grey.
- **Selection.** Selected measurements keep their colour, drawn thicker with a light halo, white points and a thicker chip edge.

*Overlay colours*, in the *Display* section, chooses the colours:

| Choice | Colours |
|:--|:--|
| MATLAB (the default) | MATLAB's default colour order: `#0072BD`, `#D95319`, `#EDB120`, `#7E2F8E`, `#77AC30`, `#4DBEEE`, `#A2142F` |
| Okabe-Ito | the colour-blind-safe set: `#E69F00`, `#56B4E9`, `#009E73`, `#F0E442`, `#0072B2`, `#D55E00`, `#CC79A7` |
| custom | seven colours picked by hand in the *Custom colours…* window, which can start again from MATLAB's or from the Okabe-Ito colours |

The browser remembers the choice, which is a matter of taste and not part of the work; the session file keeps only each measurement's place in the order.

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
- **Rotation φ** turns the corrected image ($R(\varphi)$). It is rigid, so lengths, angles and areas never depend on it. Set it with the *Level* buttons, by typing it, with the slider under it, or with *Rotation 0°*.
  - The slider spans ±180°. While it is dragged, only the view turns, about its centre, once per displayed frame. The measurement list and the windows follow when it is let go, and the whole drag is one step for Ctrl+Z.
  - Under it, the buttons −1°, −0.1°, +0.1° and +1° turn by those steps, for a finger as for a mouse. A tap turns once; a press held keeps turning, 20 steps a second after a short pause; either is one step for Ctrl+Z.
  - The arrow keys on the slider turn by 0.1°, and by 1° with Shift.
- **Origin** $u_0$: *Set origin* takes the next click; *Reset origin* returns it to the centre of the top-left pixel.

The view draws the stored image through the same map, so a change of calibration costs no computation: no pixel is resampled in script.

## Snapping

With *Snap* on, as it is from the start (S switches it), a click lands on the strongest edge nearby, and a magenta ring shows in advance where it will land. The method is in MATH.md, Part 2:

- **Edge strength.** The gradient of a Gaussian-smoothed image, after an optional 3 × 3 or 5 × 5 median filter: *smoothing σ*, in pixels of the stored image. Larger σ resists noise better, but merges edges closer than about 2σ.
- **Threshold.** Pure noise exceeds $c$ times the median gradient with the probability $2^{-c^2}$ per independent pixel. A click searches many pixels, though, so candidates must be $\sqrt{k^2 + \log_2 N}$ times the median, $k$ being the *min. edge strength* and $N$ about the number of independent pixels in the search. A click on flat noise then snaps about as rarely as one pixel exceeds $k$ times the median: $2^{-k^2}$, 0.2 % at the default 3. At the default radius that asks for 4.0 times the median, and 4.3 for a finger. Pixels on constant stretches, such as regions clipped to black or white, are left out of the median.
- **Candidates and choice.** Candidates are the crest pixels within the *search radius*, measured in pixels of the corrected view. The choice weighs strength against distance, and a parabola places the point between pixels, to within 0.05 px for a crest one pixel wide. The point may slide a pixel or two **along** the edge.
- **Where the map is computed.** The edge map is computed on the stored image, without the info bar, once per σ and median setting. The noise is independent pixel to pixel there and the probe round, so this is also the matched filter.
- **Bright lines.** Many SEM edges appear as bright lines, which have two flanks. A click snaps to the flank nearest to it, so trace one flank consistently, or use Alt to place points on the line's centre.
- **Profiles** are not snapped but squared to the edge they cross, when placed and when an end is dragged, while *square profiles to the edge they cross* is on (see *Line profiles*). The image's edge must reach *min. edge strength* times the median gradient: squaring looks along a line, not over a disc.

*Show the edge map* (G) overlays the edge strength in green, which shows what the snapping sees.

## Files

| File | Use |
|:--|:--|
| `<image>_session.json` | the session: image name and SHA-256, calibration, the measurements (contours among them), snap settings, display levels. *Open session…* takes it up again on the open image, and asks first if the image differs. |
| `<image>_polygons.csv`, `<image>_<contour>.csv` | the vertices of several contours, or of one, in micrometres and pixels, with each contour's measures, the calibration and the matrix `px_to_um` in a commented header. *Open session…* also reads it. |
| `<image>_measurements.csv`, `<image>_<ruler or angle>.csv` | one row per measurement: value, unit, components, points; a profile's band width and mean grey value; a contour's vertex count, area and bounding box |
| `<image>_<profile>.csv` | the samples of one line profile |
| `<image>_<profile>.png` | the plot of one line profile |
| `<image>.gds`, `<image>_<contour>.gds` | contours as a GDSII layout, for KLayout, gdstk, GDSFactory and other layout tools; written only |

*Save session* writes the first; *Download* under *Measurements* writes the others, for the selection or for all. The names in angle brackets are made safe for a file name. [FORMAT.md](FORMAT.md) specifies them all and includes a dependency-free Python reader for the polygon file.

## GDS export

*Download*, under *Measurements*, writes a GDSII file of one contour, of the contours among the selected measurements, or of all the contours. The file holds one cell, in the coordinates of the polygon file: micrometres in the measurement frame, so tilt-corrected, turned and from the origin. Points sit on a 1 nm grid, with the user unit 1 µm. It needs the pixel size. Rulers, angles and profiles are not written; their values go to the measurements file.

- **Layers.** Each contour has its own GDS layer and datatype, set under *Measurements* when it is selected (1/0 by default) and kept in the session.
- **Elements.** A closed contour becomes a polygon (BOUNDARY), and an open one a path (PATH) of the width set in the dialog (0: a line).
- **Optional, ticked in the dialog:** each contour's name as a text label at its first vertex, on its layer.
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

**Metadata files beside the image.** Hitachi, JEOL and TESCAN write their metadata to a text file of the image's name. Select or drop the image and that file together, and the app uses the file in place of anything the image file holds. It works for an image of any format, a JPEG or a BMP included.

- **Which file.** A `.txt` or `.hdr` file counts as metadata by its content. Any other `.txt` is read as a polygon file, as before. With several metadata files, the one of the image's name is taken.
- **Checks.** When the file describes an image of another size, the pixel size is not taken, for instance for a JPEG saved at half size. When a Hitachi file names another image, the app says so. Either way the status bar and *Metadata* tell what to check.
- **Alone.** A metadata file opened without its image is not used, and the status bar says to open both together.

**Hitachi** (SU8200 and others of its software) writes the full set to the `.txt` file, `[SemImageFile]` followed by key=value lines. Part of it also goes into the TIFF, as UTF-16 text in the Windows tags *XPComment* (40092) and *XPAuthor* (40093, the instrument). The app reads:

- **Pixel size**: `PixelSize`, in nm, from the TIFF or the `.txt`. Three checks, all on the 17 files tested:
  - it equals 127 mm / (magnification × image width) to the 7 digits written, as Hitachi defines its magnification with a display of 127 mm × 95 mm (a 4 × 5 inch picture);
  - it agrees with the micron marker the microscope draws into the data bar to within 0.1 % (±1 px over 350–544 px);
  - EM-tool, an ImageJ toolset, also reads `PixelSize` as nm.

  Older instruments used another reference: the S-4800's photo screen is 120 mm × 90 mm. The app never computes the pixel size from the magnification; it takes `PixelSize` as written.
- **Beam conditions and detector**: in the `.txt`, `AcceleratingVoltage` and `WorkingDistance` (in µm). The TIFF has them only in `Condition`, as rounded on the screen, e.g. `WD=8.2mm`. Also `SignalName`, the model and the date.
- **Stage tilt** (`StagePositionT`, read as degrees, as the rotation `StagePositionR` is), the microscope's **tilt compensation** (`TiltCompensation`) and the **raster rotation**: in the `.txt` only.
- **Data bar**: with `DataDisplayCombine=1`, the microscope draws its data bar, white text and a scale bar on black, over the bottom rows of the image and records nothing about it. The app finds it in each image by its pattern (MATH.md, 5.1): the rows at the bottom that are at least half black and almost entirely black or white, also in a JPEG. They stay in the image below a dashed line, and the histogram, the auto levels and the edge detection leave them out.

Tested on 17 TIFFs from an SU8200 (1280 × 960, 8-bit RGB, the three channels equal). Each decoded to the pixel size of its `.txt` file, with a data bar of 64 rows. The `.txt` opened with its TIFF gave the same, with the stage tilt and the precise working distance. A JPEG copy with the `.txt` gave the same in the browser, and the bar's rule finds the whole bar in JPEG copies saved at quality 50 to 95.

**Not yet tested on real images.** These are read from published descriptions and sample files. *Metadata* says so, and asks you to check the pixel size against the scale bar.

- **JEOL** writes a `.txt` file of `$KEY value` lines (`$$` before some keys).
  - **Pixel size**: from the micron bar, `$$SM_MICRON_MARKER` (e.g. `100um`) over `$$SM_MICRON_BAR` pixels. That is exact to the bar's rounding, half a pixel. Where 120 mm / (`$CM_MAG` × width) falls within that rounding, the app takes this more precise value. The sample file, 1280 px wide at ×95, fits 120 mm; 127 mm is tried too.
  - **Other values**: the voltage, working distance, probe current, scan rotation, detector, model and date. Rows below `$CM_FULL_SIZE` count as a data bar.
  - **Stage tilt**: it sits somewhere in `$CM_STAGE_POS`, whose order of values is not documented, so it is not read.
- **TESCAN** writes `[MAIN]` and `[SEM]` sections of key=value lines in SI units, both to a `.hdr` file and into a TIFF tag. The app finds the tag by its content.
  - **Pixel size**: `PixelSizeX` and `PixelSizeY` (m).
  - **Info strip**: `ImageStripSize`, the rows at the bottom.
  - **Other values**: `HV` or `AcceleratorVoltage`, `WD`, the beam current, `StageTilt` and `ScanRotation` (read as degrees), `Detector`, `Device` and the date.
- **Thermo Fisher XML** (*FeiImage*), as Phenom desktop SEMs write it into TIFF tag 34683: `pixelWidth`, `pixelHeight`, `workingDistance` and `highVoltage`, with their units.

**Other images.** Other TIFFs open without metadata: 8, 16 or 32 bits, grey, palette or RGB, in the compressions UTIF.js decodes. Only uncompressed FEI, Zeiss and Hitachi files were tested. PNG, JPEG and BMP open too, decoded by the browser. Enter the pixel size by hand.

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
  - *Undo* and *Redo*. While a measurement is being placed, *Undo* first takes back its last point, which is not yet an edit to undo;
  - *Fit*, the image to the view;
  - *Snap*, the same switch as in the panel;
  - *Exact*, which places or releases the next point exactly where the finger is, without snapping, and then lets go.
- **Press and hold** a point for half a second, while a ring fills, to open its menu beside the finger:
  - a contour's vertex: *Delete vertex*, *Select in the vertex window*, *Insert a vertex after* (halfway to the next one);
  - any measurement's point, a vertex included: *Delete* the measurement, *Rename…*, and for a profile *Show the plot* and *Square to edge*.

  Held on empty image, nothing happens, and lifting the finger places nothing.
- **The measurement list** takes a tap as a click. A tap on a row selects it alone, a tap on its box adds it to the selection or takes it out, and two taps on a row open its window. Its rows and boxes are larger in the touch layout.
- **Larger targets.** A finger hits a point within 22 px, where the mouse needs 8. After touch input, points and handles are drawn larger. Snapping searches 2.5 times the search radius for a finger, which covers far more of the image than a cursor. The panel's buttons, fields and boxes grow to finger size as well.
- **Floating windows** get title bars and close buttons 44 px tall, and a resize corner that answers a finger; the browser's own corner answers the mouse only.
- **The profile plot** reads out under a finger dragged along it, and the reading stays after the finger lifts. A tap places a marker, and a marker can be dragged by a finger.
- **Number fields** open the number keypad of the Windows touch keyboard.
- **A long press on the controls** no longer selects their text.

These were checked with pointer events simulated in Chromium. They have not yet been tried on a real touch screen or with a real pen.

## Mouse and keys

| Input | Action |
|:--|:--|
| 0 | no tool: drag to pan, wheel to zoom (also a click on the active tool's button) |
| 1 2 3 4 5 6 | tools: contour, ruler, angle (3 clicks), angle between 2 lines (4 clicks), line profile, gap between 2 parallel lines (4 clicks) |
| click | contour: add a vertex to the selected contour, or start a new one; other tools: place the next point (snapped with Snap on, except a profile's ends) |
| Ctrl+click | contour: insert a vertex into the nearest segment |
| hold Ctrl | contour: show the segment that will receive the vertex and where it will land |
| click, Shift+click a vertex | contour: select it in the vertex window; add or remove it |
| Alt+click | place the point exactly, without snapping |
| drag a point | move a vertex or a measurement point; it snaps when released (Alt: not). A profile's end never snaps; the profile turns square about its other end instead (Alt: not) |
| drag the white square | widen or narrow the band of the selected profile |
| click on the profile plot | place marker A, then B, then move the nearer one; snapped to the steepest slope while that option is on (Alt: exactly) |
| drag a marker on the plot | move it; it snaps when let go (Alt: not); a drag that starts elsewhere reads values |
| right click | contour: delete the vertex; other tools: delete the measurement, or cancel the one being placed |
| wheel, touchpad pinch | zoom about the cursor |
| middle drag, Space+drag; drag with no tool | pan |
| two fingers | pinch to zoom, move together to pan |
| one finger | no tool: pan; with a tool, a tap clicks, a drag from a point moves it, any other drag pans |
| press and hold a point (touch) | its menu: delete, select, insert after (a vertex); delete, rename (any measurement); show the plot, square to edge (a profile) |
| click, tap a row of the list | select that measurement alone; twice: a profile's plot, a contour's vertices |
| its box, Ctrl+click | add it to the selection, or take it out |
| Shift+click a row; Ctrl+A | select from the row clicked last; select all |
| N, C | done with the selected contour (the next click starts a new one); close or open the selected contour |
| H, V | level the selected ruler horizontal or vertical |
| S, G | snapping on or off; edge map on or off |
| T | show or hide the vertex window of the selected contour |
| P | show or hide the profile window; it also opens for a new profile, and on a double click or double tap on a profile under *Measurements* |
| E | square the selected profile to the edge it crosses, whatever the angle; new and moved profiles up to 15° off square are squared while the option under *Snapping* is on (Alt with the click or the release: as it is; Ctrl+Z right after: back as it was) |
| arrow keys | move the selected vertices by one view unit on screen (Shift: ten); in the list, the next measurement |
| Backspace | the last point being placed; else the selected vertices, the last vertex (contour tool) or the selected measurements |
| Delete | delete the selected vertices, else the selected measurements, contours included |
| Ctrl+Z, Ctrl+Y | undo, redo; while a measurement is being placed, Ctrl+Z first takes back its last point |
| F, +, − | fit to the window; zoom |
| Ctrl+O, Ctrl+S | open an image; save the session |
| Esc | cancel the measurement being placed, or *Set origin*; close a menu |

## Performance

The costs, measured on the FEI test image of 3072 × 2188 pixels (6.29 Mpx above the data bar), are analysed in [MATH.md, Part 3](MATH.md#part-3-performance):

- **Opening an image** computes for about 0.35 s: decode, checksum, auto levels, histogram and picture. Snapping is on from the start, so the edge map follows at once, and opening took 2.7 s from the click in all.
- **A change of levels** repaints the picture in 40–70 ms, one table look-up per pixel, so the sliders and the histogram handles follow the pointer.
- **The edge map** takes 1.1 s with σ = 2 and no median, 2.1 s with the 3 × 3 median (the default), and 4.2 s with 5 × 5. It is computed only when snapping or the overlay needs it, and again only when σ or the median changes.
- **A snap search** takes microseconds.
- **A line profile** reads about 20 ns per value: 4.9 ms for 3001 samples along a band of 83 lines. A profile and its window are therefore computed again at every step of a drag; MATH.md 6.8 describes how the loop is tuned.
- **Squaring a profile** takes microseconds: a search along its line and one structure tensor of a few hundred pixels.
- **Calibration and rotation changes**, panning and zooming cost one GPU-drawn frame.
- **Dragging the rotation slider** costs about 0.5 ms a frame on an Intel Iris Xe, the GPU's work included, with the FEI image fitted to the view. Zoomed out, the picture is drawn through mipmaps, so its pixels' noise neither aliases nor shimmers as it turns. With the default filtering, the step between neighbouring screen pixels was twice as large as with the mipmaps.
- **Memory**: about 180 MB for that image with the overlay shown.

The page does not respond while an edge map is computed. A Web Worker would remove the wait; MATH.md 3.4 lists this and the other limits.

## Code

| Path | Content |
|:--|:--|
| `index.html` | the page: layout, panel, styles |
| `js/metadata.js` | FEI, Zeiss, Hitachi, JEOL, TESCAN and Thermo Fisher XML metadata: pixel size, data bar, tilt, beam, detector |
| `js/tiff.js` | TIFF decoding with UTIF.js into grey values and calibration; metadata in tags and in files beside the image; the Zeiss info zone and the Hitachi data bar, (Z1) and (H1) in the header |
| `js/edges.js` | edge strength, crests, snapping and the structure tensor; derivations (E1)–(E9) in the header |
| `js/transform.js` | the affine map, measures, levelling, the arrow-key step, the gap between two lines; derivations (G1)–(G15) and (G17) in the header |
| `js/polygons.js` | the polygon, measurements and profile files (CSV) |
| `js/session.js` | the session file (JSON) |
| `js/gds.js` | the GDSII writer: records, units, eight-byte reals; derivations (S1)–(S2) in the header |
| `js/vertices.js` | the vertex window's operations on a contour's vertex list |
| `js/display.js` | the display: levels, brightness and contrast, the histogram's bins; derivations (D1)–(D4) in the header |
| `js/profile.js` | line profiles: the band, the samples, the contour crossings, squaring to an edge, markers; derivations (P1)–(P14) in the header |
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

- **Decoding.** Every FEI TIFF of a folder and the Zeiss files given are decoded and checked: vendor, size, bits per sample, info bar, pixel size, and the values against the file's bytes. With `tests/local_data.json` (below):
  - each Zeiss file must also decode to the pixel size, tilt and info bar given there;
  - every TIFF of a folder of Hitachi images is decoded too, with its data bar of the rows given there. Its pixel size must equal the `PixelSize` of the `.txt` file beside it, a file the microscope writes apart from the TIFF, and 127 mm / (magnification × width).
- **Hitachi files built in the test.** A small RGB TIFF with *XPComment* and *XPAuthor* tags decodes to its pixel size, beam, detector and data bar. On synthetic images the data bar is found where drawn and nowhere else: not in noise, a dark band with grey text, a bar too short or too tall, or a white band.
- **Metadata files and tags.** These checks run on images decoded in the test:
  - A Hitachi `.txt` opened with an image decoded as a browser decodes a JPEG gives all its values. On an image of another size it gives no pixel size, and a file written for another image is noted.
  - JEOL `.txt` files give the micron bar's pixel size, refined by the magnification where that fits, with markers in nm and µm. A marker in degrees gives none.
  - A TESCAN `.hdr`, and the same text in a TIFF tag, give their values and info strip.
  - Thermo Fisher's XML in tag 34683 gives its values.
  - The vendor of each text is told by its content, and a polygon file is told from them.
- **Info zone.** On synthetic images the search finds a zone between two black lines and a zone running to the last row. It finds none in an image without one, in a black line alone, or in a saturated band without lines.
- **Edges.** The gradient on a ramp, snapping on a noisy edge and on flat noise, and the radius through the view metric. On pure noise, how rarely a click snaps with a mouse's radius and a finger's; the noise of an image mostly clipped to black.
- **Geometry.** The geometry checks:
  - correction factors;
  - the map and its inverse;
  - the tilt axis;
  - rigid rotation;
  - angles and line crossings;
  - the gap between two lines, parallel and 2° apart, whatever the rotation;
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
  - The full scale that the profile plot marks, for each sample type.
- **Line profiles.**
  - Samples along a ramp exact, along a row and between pixel centres.
  - Values missing outside the image and in the info bar.
  - Distances in micrometres with pixels of 2 × 3 nm.
  - Band averages and spreads, also with rows that count twice.
  - The same profile with the image turned by 90°.
  - In a tilted, turned frame, every line of the band normal to the profile as seen and at its offset.
  - Contour crossings: a closed contour's closing side, a vertex on the line counted once, none along or beyond the line.
  - Squaring:
    - the edge's normal in a tilted, turned frame, on a step and a bright line, and a corner refused;
    - the tensor of a noisy edge, on average, exact in a frame that stretches 3 times;
    - the direction's scatter over noisy images, against one gradient and a sum of gradient vectors;
    - the turn, which keeps the length, the crossing's place and the sense;
    - the turn about the end not moved, which keeps that end, and the crossing's slide along a straight edge;
    - a contour segment's normal.
  - Markers:
    - a point off the line, in a tilted, turned frame, placed where it projects, and points beyond the ends held to them;
    - the mean between samples;
    - snapping, which finds an edge from either side, sharp or gradual, nearly clean and noisy, and a bright line's nearer flank;
    - the edge clicked, which is neither merged with a step beside it nor given up for a stronger edge farther off;
    - no snap at the end of the data or beside missing values, nor on a clipped or quieter stretch, nor on a ramp without a steepest point, and rarely in noise alone;
    - the markers in the session and in the profile file's header.

The decoding checks need SEM images of your own, which the repository does not hold. Name them on the command line:

```bash
node tests/check_core.mjs "<FEI folder>" "<Zeiss TIFF>" "<Zeiss TIFF>"
```

Or name them once in `tests/local_data.json`, which git ignores. `tests/local_data.example.json` shows its form: the pixel size, tilt and info bar that each Zeiss file must decode to, and a folder of Hitachi TIFFs with their `.txt` files (`hitachi_folder`, `hitachi_bar_rows`), which only this file can name. Without test images, the decoding checks are skipped and the others run.

## Third-party code

`vendor/` holds two libraries, unmodified. Their versions, sources, SHA-256 checksums and licence texts are in `vendor/LICENSES.md`.

- **UTIF.js 3.1.0** (Photopea, MIT licence) decodes TIFF files and exposes their private tags.
- **pako 1.0.11**, its inflate part (MIT licence, with zlib-derived code under the zlib licence), serves Deflate-compressed TIFFs.

The development tools (ESLint, TypeScript, html-validate) are only needed for the checks and are not part of the app.

## Limits

- **TIFF files.** Only the first image of a multi-image TIFF is read.
- **Console message.** UTIF.js writes "unknown TIFF tag type: 13" to the browser console for FEI files, about a directory-pointer tag it skips; it is harmless.
- **Zeiss info zone.** It is recognised by its pattern (MATH.md, 5.1). A zone drawn otherwise, for instance without its black lines, is not found, and then takes part in the histogram, the auto levels and the edge map. Image rows that happened to show the pattern in the lowest third would be taken for a zone and left out.
- **Hitachi files.** The data bar is likewise recognised by its pattern (MATH.md, 5.1). The stage tilt is not in the TIFF: open the image with its `.txt` file for it. Hitachi TIFFs without the *XPComment* tag, as older instruments may write, open without metadata unless opened with their `.txt`.
- **JEOL, TESCAN and Thermo Fisher XML** are read from published descriptions and sample files, not yet from real images. Their angles' units and JEOL's stage tilt are not established. Check the pixel size against the scale bar the first time.
- **Snapping.** Bright lines have two flanks; edges closer than about 2σ merge; a snapped point may slide a pixel or two along its edge.
- **Line profiles.**
  - Straight lines only.
  - The band is averaged with equal weights.
  - The window shows the selected profile only.
  - The plot's y axis spans 0 to the full scale of the file's sample format, not of the detector: 12-bit values stored in 16 bits fill a sixteenth of it, and a profile over a small part of the range plots nearly flat. *Export CSV* has the values in full.
  - Crossings are those of contours with the centre line; other measurements are not marked.
  - Squaring turns a profile to one edge: the contour crossing nearest its middle, else the strongest edge. A profile meant to cross a feature at a set angle stays as drawn when it is more than 15° off square. One nearer to square, such as a horizontal profile across a sidewall steeper than 75°, is turned; Ctrl+Z gives it back as drawn, and Alt+click places it so.
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
