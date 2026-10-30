# The mathematics of the SEM measurement tool

This document derives what the app computes from an image:

- **Part 1:** the map from stored pixels to micrometres, and the measures taken through it.
- **Part 2:** the edge strength and the snapping.
- **Part 3:** what each step costs, and where the limits lie.
- **Part 4:** the GDSII export: its grid and its eight-byte reals.
- **Part 5:** the display: the info bar, the levels, brightness and contrast, and the histogram.
- **Part 6:** line profiles: the band, the samples, the contours that cross the line, squaring a profile to the edge it crosses, and markers for a distance along it.

Equation numbers match the comments in the code: (G1)–(G15) in `js/transform.js`, (G16) in `js/app.js`, (E1)–(E9) in `js/edges.js`, (C1) in `js/polygons.js`, (S1)–(S2) in `js/gds.js`, (Z1) and (H1) in `js/tiff.js`, (D1)–(D4) in `js/display.js` and (P1)–(P14) in `js/profile.js` (the sums of (P8) in `js/edges.js`).

## Part 1. Geometry

### 1.1 Stored coordinates (G1)

Every point the app keeps is a position in the image as stored in the file:

- contour vertices;
- the points of rulers and angles;
- the origin.

Positions are given in *pixel-centre coordinates* $u = (x, y)$: $x$ the column, $y$ the row, $y$ pointing down. The pixel in row $i$ and column $j$ is centred at $(x, y) = (j, i)$ and covers $[j - \tfrac12, j + \tfrac12] \times [i - \tfrac12, i + \tfrac12]$. Coordinates are real numbers: a snapped point lies between pixel centres. An info bar is part of the stored image: an FEI data bar follows the image rows, and a Zeiss info zone covers the last ones (5.1).

The canvas that holds the picture puts pixel $(i, j)$ on the unit square $[j, j+1] \times [i, i+1]$. A stored point therefore sits at the canvas coordinates

$$c = u + \left(\tfrac12, \tfrac12\right). \qquad \text{(G1)}$$

The user's settings change none of these numbers: pixel size, tilt correction, tilt axis, rotation and origin. They enter only the map of 1.6. A contour therefore stays on the feature it was traced on whatever the calibration, and a saved session can be measured again under another calibration.

### 1.2 Image formation (G2)

An SEM image records one signal value per pixel while the beam scans the specimen. The beam pivots about a point a distance $L$ above the specimen: millimetres, of the order of the working distance or more. The field of view $F$, by contrast, is micrometres. Across the field the beam direction changes by at most $F/(2L)$, which is 0.5 mrad for $F = 4$ µm and $L = 4$ mm. A feature at height $h$ above the focal plane is then displaced by at most $hF/(2L)$: 0.5 nm for $h = 1$ µm, a fraction of a 1.35 nm pixel.

To this accuracy the image is an **orthographic projection** along the beam direction $\mathbf b$, onto the plane normal to $\mathbf b$. With $\mathbf e_1, \mathbf e_2$ orthonormal vectors spanning that plane, a specimen vector $\mathbf r$ appears at

$$(\mathbf r\cdot\mathbf e_1,\ \mathbf r\cdot\mathbf e_2) \qquad \text{(G2)}$$

in physical units, with $y$ up. The stored image samples this plane with pixels of $p_x \times p_y$ nm, a size that comes from the microscope's scan calibration. Lengths measured here are as good as that calibration, which the app cannot check; a calibration standard imaged under the same conditions can.

### 1.3 A tilted specimen (G3), (G4)

**The beam direction.** Take the specimen frame of unit vectors:

- $\mathbf t$ along the stage tilt axis;
- $\mathbf s$ in the surface, perpendicular to $\mathbf t$;
- $\mathbf n$ the surface normal;

with $(\mathbf t, \mathbf s, \mathbf n)$ right-handed. Untilted, the beam travels along $-\mathbf n$. Tilting the stage by $\theta$ about $\mathbf t$ is, seen from the specimen, turning the beam the other way about $\mathbf t$:

$$\mathbf b = \sin\theta\,\mathbf s - \cos\theta\,\mathbf n. \qquad \text{(G3)}$$

**The image plane.** It is normal to $\mathbf b$. Since $\mathbf t\cdot\mathbf b = 0$, the tilt axis lies in it, so take $\mathbf e_1 = \mathbf t$. The second axis is the unit vector normal to both $\mathbf b$ and $\mathbf t$:

$$\mathbf e_2 = \cos\theta\,\mathbf s + \sin\theta\,\mathbf n.$$

Check: $\mathbf e_2\cdot\mathbf b = \cos\theta\sin\theta - \sin\theta\cos\theta = 0$, $\mathbf e_2\cdot\mathbf t = 0$ and $|\mathbf e_2| = 1$. The opposite sign of $\mathbf e_2$ would flip the image vertically and change nothing below.

**The projection.** By (G2) a specimen vector $\mathbf r = a\,\mathbf t + l\,\mathbf s + d\,\mathbf n$ appears at

$$(\mathbf r\cdot\mathbf e_1,\ \mathbf r\cdot\mathbf e_2) = (a,\ l\cos\theta + d\sin\theta). \qquad \text{(G4)}$$

Three directions stand out:

- **Along the tilt axis**, $\mathbf r = a\mathbf t$: it appears at $(a, 0)$, at full length.
- **In the surface, across the axis**, $\mathbf r = l\mathbf s$: it appears at $(0, l\cos\theta)$, shortened by $\cos\theta$.
- **Along the normal**, $\mathbf r = d\mathbf n$: it appears at $(0, d\sin\theta)$, shortened by $\sin\theta$.

### 1.4 Undoing the foreshortening (G5), (G6)

Two planes of the specimen are imaged without loss:

- **The surface** ($d = 0$) appears at $(a, l\cos\theta)$: the plane itself, compressed by $\cos\theta$ along $\mathbf e_2$. The stretch $\mathrm{diag}(1, 1/\cos\theta)$ restores every length and angle in it.
- **A face normal to the surface that contains the tilt axis** ($l = 0$) appears at $(a, d\sin\theta)$. This is the usual FIB cross-section. The stretch $\mathrm{diag}(1, 1/\sin\theta)$ restores it.

In both cases the correction is a stretch by a factor $k$ across the tilt axis. In image coordinates $(X, Y)$, with $X$ along the axis and $Y$ across it:

$$\begin{pmatrix}X\\ Y\end{pmatrix} \mapsto \begin{pmatrix}X\\ kY\end{pmatrix}. \qquad \text{(G5)}$$

The factor $k$ of each correction (G6):

| correction | $k$ | exact for |
|:--|:--|:--|
| none | 1 | untilted images, or images the microscope has already corrected |
| cross-section | $1/\sin\theta$ | a face normal to the surface that contains the tilt axis: $k = 1.269$ at the 52° of a DualBeam |
| tilted surface | $1/\cos\theta$ | anything lying in the tilted surface |
| custom | as entered | any other case worked out by hand |

**What cannot be recovered.** A vector with both an $l$ and a $d$ component cannot be recovered from one projection: (G4) maps three coordinates onto two. Examples are a sidewall seen from above, or a feature off the chosen plane. The correction is exact in the plane it is chosen for, and only there.

**The FIB coincidence tilt.** On a DualBeam with the ion column at 52° from the electron column, the ion beam is normal to the surface at a stage tilt of 52°. A face milled with it parallel to the tilt axis is then seen by the electron beam at $\theta = 52°$.

**The microscope's own tilt correction.** FEI and Zeiss microscopes can stretch the scan themselves. Their image is then already corrected and the correction here stays "none". The app warns when the metadata say the microscope's correction was on.

**A face that does not contain the tilt axis.** Suppose the face is turned by $\beta$ about $\mathbf n$, so that its horizontal direction is $\mathbf w = \cos\beta\,\mathbf t + \sin\beta\,\mathbf s$. By (G4) the face point $a\,\mathbf w + d\,\mathbf n$ appears at $(a\cos\beta,\ a\sin\beta\cos\theta + d\sin\theta)$; after the cross-section stretch it lies at $(a\cos\beta,\ a\sin\beta\cot\theta + d)$. Three things follow:

- Depths are still right: a vertical difference at fixed $a$ is $d$.
- Widths shrink by $\cos\beta$, which is $-0.015$ % at $\beta = 1°$.
- Horizontal lines of the face lean by $\arctan(\tan\beta\cot\theta)$, which is 0.78° for $\beta = 1°$ at $\theta = 52°$.

### 1.5 The tilt axis in the image (G7)

The stretch acts across the tilt axis. When the scan is aligned with the axis, $\mathbf e_1$ is the image's $x$ axis and the stretch is $\mathrm{diag}(1, k)$. In general the axis appears at an angle $\alpha$, counter-clockwise from the image's $x$ axis, with $y$ up and in physical units. The general stretch is built in three steps:

1. rotate the frame by $-\alpha$, which brings the axis onto $x$;
2. stretch $y$ by $k$;
3. rotate back by $\alpha$.

With $R(\alpha) = \begin{pmatrix}\cos\alpha & -\sin\alpha\\ \sin\alpha & \cos\alpha\end{pmatrix}$, $c = \cos\alpha$ and $s = \sin\alpha$, this gives

$$K = R(\alpha)\begin{pmatrix}1&0\\0&k\end{pmatrix}R(-\alpha)
= \begin{pmatrix}c & -ks\\ s & kc\end{pmatrix}\begin{pmatrix}c & s\\ -s & c\end{pmatrix}
= \begin{pmatrix}c^2 + k s^2 & (1-k)\,cs\\ (1-k)\,cs & s^2 + k c^2\end{pmatrix}. \qquad \text{(G7)}$$

$K$ is symmetric, with two eigenvectors:

- $(c, s)$, with eigenvalue 1: the axis keeps its direction and length;
- $(-s, c)$, with eigenvalue $k$: the direction across the axis is stretched.

**Where α comes from.** The app does not take $\alpha$ from the metadata. FEI files record a scan rotation (1.32° in the FEI test image), yet the long interfaces of that cross-section lie within about ±0.4° of the image rows; their best-fit angles are 0.42°, 0°, −0.20° and −0.26°. So the recorded scan rotation does not tell where the tilt axis lies in the image. $\alpha$ comes from one of three places:

- the default 0: the scan aligned with the axis, as microscopes set it up for their own tilt correction;
- a value typed in;
- a ruler along a line known to be parallel to the axis (G14).

**What a wrong α costs.** Say the axis is really at $\delta$ while the app assumes 0. The result is off by $E = \mathrm{diag}(1, k)\,K_\delta^{-1}$, where $K_\delta^{-1} = R(\delta)\,\mathrm{diag}(1, 1/k)\,R(-\delta)$. Multiplying out as in (G7),

$$E = \begin{pmatrix} c^2 + s^2/k & cs\,(k-1)/k\\ cs\,(k-1) & c^2 + k s^2\end{pmatrix}
\approx I + \delta\,(k-1)\begin{pmatrix}0 & 1/k\\ 1 & 0\end{pmatrix},$$

to first order in $\delta$, with $c = \cos\delta \approx 1$ and $s = \sin\delta \approx \delta$. Three consequences:

- **Lengths along $x$ or $y$** change only at second order.
- **A right angle** between $x$ and $y$ skews by the sum of the two off-diagonal terms, $(k - 1/k)\,\delta$.
- **A line at 45°**, $w = (1, 1)/\sqrt2$, changes length by $|Ew| - 1 \approx (k - 1/k)\,\delta/2$.

At $k = 1.269$ (a 52° cross-section) and $\delta = 1°$ these are 0.481° and 0.421 % (exact values; the first-order formulas give 0.481° and 0.420 %).

### 1.6 The map from stored pixels to micrometres (G8)

$$P = A\,(u - u_0), \qquad A = R(\varphi)\,K\,D\,F, \qquad \text{(G8)}$$

with

- $F = \mathrm{diag}(1, -1)$, which turns the stored $y$ (down) up;
- $D = \mathrm{diag}(p_x, p_y)/1000$, µm per pixel from the pixel size in nm. When the pixel size is unknown, $D$ is the identity and lengths come out in pixels.
- $K$, the tilt correction (G7);
- $R(\varphi)$, the rotation of the corrected image, counter-clockwise;
- $u_0$, the stored point taken as the origin.

**Why this order.**

- $D$ comes before $K$ because the stretch is defined in physical units. With non-square pixels, the axis angle $\alpha$ and the direction across it are angles in micrometres, not in pixels.
- $K$ comes before $R$ because the rotation turns the corrected image as a whole. It is rigid, $|R(\varphi)z| = |z|$, so every length, angle and area is independent of $\varphi$; only directions and bounding boxes turn.

The polygon and measurement files write $A$ itself as `px_to_um` (C1). That is all a reader needs to go between pixels and micrometres.

### 1.7 Areas and the determinant (G9)

$$\det A = \det R(\varphi)\,\det K\,\det D\,\det F = 1\cdot k\cdot \frac{p_x p_y}{10^6}\cdot(-1). \qquad \text{(G9)}$$

The area of a polygon $q_1 \dots q_n$ is half the absolute value of $\sum_i q_i \times q_{i+1}$ (the shoelace formula), where $a \times b = a_x b_y - a_y b_x$. The sum is a sum of signed triangle areas, unchanged by a translation. For any 2 × 2 matrix,

$$(Au)\times(Av) = (A_{11}u_x + A_{12}u_y)(A_{21}v_x + A_{22}v_y) - (A_{21}u_x + A_{22}u_y)(A_{11}v_x + A_{12}v_y) = \det A\,(u\times v).$$

A polygon of area $S$ in stored pixels therefore has the area $|\det A|\,S = k\,p_x p_y\,S/10^6$ µm². The factor $k$ is there because the correction stretches. $\det A$ is negative because $F$ mirrors, which only flips the orientation. The app sums over the mapped points directly; the two results are equal.

### 1.8 The inverse (G10)

$$u = u_0 + A^{-1}P, \qquad A^{-1} = \frac{1}{\det A}\begin{pmatrix}A_{22} & -A_{12}\\ -A_{21} & A_{11}\end{pmatrix}. \qquad \text{(G10)}$$

The inverse reads polygon files that carry micrometres only, and places the cursor.

### 1.9 The view (G11)

**The view frame** is (G8) in units of the pixel width, without the origin:

$$V = R(\varphi)\,K\,\mathrm{diag}\!\left(1, -\frac{p_y}{p_x}\right) = \frac{1000}{p_x}\,R(\varphi)\,K\,D\,F.$$

At zoom 1, one stored pixel covers one screen pixel along $x$.

**The screen.** Screen coordinates are CSS pixels with $y$ down. A canvas point $c$ lies on the screen at $Mc + \tau$, where $M = s\,F\,V$, $s$ is the zoom and $\tau$ the pan. With (G1):

- the stored point $u$ lies at $M\,(u + (\tfrac12, \tfrac12)) + \tau$;
- the cursor at the screen point $q$ is over $u = M^{-1}(q - \tau) - (\tfrac12, \tfrac12)$.

**Drawing.** The canvas draws the picture through `setTransform(M11, M21, M12, M22, τx, τy)`, scaled by the device pixel ratio. The browser resamples it, so no pixel is touched in script, whatever the transform. Since

$$\det M = s^2\,\det F\,\det V = s^2\,(-1)\,(-k\,p_y/p_x) > 0,$$

the view is never mirrored.

**Fit and calibration changes.** "Fit" maps the four corners of the canvas rectangle through $FV$, takes their bounding box and scales it into the window. A change of calibration moves $\tau$ so that the stored point under the centre of the window stays there.

**The arrow keys (G15).** An arrow key should move the selected vertices by one view unit in the direction it shows on screen, whatever the zoom, tilt correction or rotation. A stored step $\Delta u$ moves a point on screen by $M\,\Delta u = s\,F\,V\,\Delta u$, the offsets $\tfrac12$ and $\tau$ cancelling in the difference. A screen step of $(d_x, d_y)$ view units, which is $s\,(d_x, d_y)$ CSS pixels with $y$ down, therefore takes

$$\Delta u = (s\,F\,V)^{-1}\, s \begin{pmatrix}d_x\\ d_y\end{pmatrix} = V^{-1} F^{-1} \begin{pmatrix}d_x\\ d_y\end{pmatrix} = V^{-1} \begin{pmatrix}d_x\\ -d_y\end{pmatrix}, \qquad \text{(G15)}$$

using $F^{-1} = F$. The zoom drops out. Three cases:

- **Untilted, unturned, square pixels:** $V = \mathrm{diag}(1, -1)$. Up, $(0, -1)$, gives $\Delta u = (0, -1)$: one row up.
- **Rows that count $k$ times** (a cross-section, $\alpha = \varphi = 0$): $V = \mathrm{diag}(1, -k)$. Up gives $(0, -1/k)$, so the vertex moves by one pixel width of true distance, 0.788 rows at 52°.
- **An image turned by 90°:** $V = R(90°)\,\mathrm{diag}(1, -1)$. Up gives $\Delta u = (1, 0)$: the stored $+x$ direction, which the turn has pointed up the screen.

**Zooming about a point (G16).** The wheel, a touchpad pinch and a two-finger pinch change the zoom from $s$ to $s'$, while an image point stays under the cursor or the fingers. The derivation takes three steps:

1. A canvas point $c$ lies on the screen at $s\,FVc + \tau$, so the point under the screen point $q$ is $c = (s\,FV)^{-1}(q - \tau)$.
2. After the zoom, $c$ lies at $s'\,FVc + \tau'$, and $s'\,FVc = \tfrac{s'}{s}\,s\,FVc = \tfrac{s'}{s}\,(q - \tau)$.
3. Setting this position equal to the wanted screen point $q'$ gives

$$\tau' = q' - \frac{s'}{s}\,(q - \tau). \qquad \text{(G16)}$$

The two inputs use it as follows:

- **The wheel** keeps the point under the cursor: $q' = q$. A notch of 100 pixels multiplies $s$ by $1.25^{\mp1}$, smaller steps a fraction of that (line and page steps are first converted to pixels).
- **A pinch** measures everything from its start, so that the image follows the fingers without drift. With $d_0$ and $d$ the distance between the two fingers at the start and now:
  - $s' = s\,d/d_0$, clipped to 0.01–200;
  - $q$ and $q'$ are the fingers' midpoints at the start and now;
  - $s$ and $\tau$ are the zoom and pan at the start.

  The image point that was under the midpoint then stays under it, however the fingers move in between. Moving both fingers together pans; spreading them zooms about their midpoint.

### 1.10 Measures (G12)

With $\Delta u$ the stored difference of two points:

- **Ruler.** Length $|A\Delta u|$; components $(A\Delta u)_X$ and $(A\Delta u)_Y$; direction $\operatorname{atan2}\big((A\Delta u)_Y, (A\Delta u)_X\big)$, counter-clockwise from $+X$.
- **Angle between two vectors $a$ and $b$.** It is computed as $\operatorname{atan2}(|a\times b|,\ a\cdot b) \in [0°, 180°]$. The alternative, $\arccos\big(a\cdot b/(|a||b|)\big)$, loses accuracy near 0° and 180°: there a rounding error $\varepsilon$ in the cosine becomes an error $\sqrt{2\varepsilon}$ in the angle, $10^{-8}$ rad for $\varepsilon = 10^{-16}$. atan2 keeps the relative accuracy of its arguments at every angle.
- **Three-point angle.** The angle at the vertex $v$ between $A(a - v)$ and $A(b - v)$.
- **Angle between two lines.** The angle between the directions $A(p_2 - p_1)$ and $A(p_4 - p_3)$, as clicked; its supplement is the angle with one line reversed.
- **Where two lines cross.** Write $p_1 + s\,e_1 = p_3 + t\,e_2$ with $e_1 = p_2 - p_1$ and $e_2 = p_4 - p_3$. Taking the cross product of both sides with $e_2$ removes $t$:

  $$s = \frac{(p_3 - p_1)\times e_2}{e_1\times e_2}.$$

  Affine maps send lines to lines and keep where they cross, so this is solved in stored coordinates and mapped for display. $e_1\times e_2 = 0$ means the lines are parallel.
- **Contours.** The perimeter is $\sum_i |A\Delta u_i|$, with the closing segment when the contour is closed. The area is (G9). The bounding box is that of the mapped points, so it turns with $\varphi$.

### 1.11 Levelling (G13) and the tilt axis along a line (G14)

**Levelling (G13).** Before the rotation, a ruler from $p_1$ to $p_2$ has the direction $\beta$ of $K D F (p_2 - p_1)$; after it, $\beta + \varphi$. It is horizontal for $\varphi = -\beta + 180°\,n$ and vertical for $\varphi = 90° - \beta + 180°\,n$. The app takes the candidate nearest the present rotation, a turn of at most 90°. When two candidates are exactly 90° away, as when a vertical ruler is made horizontal, it takes the one with the smaller $|\varphi|$.

**The tilt axis along a line (G14).** A ruler along a line known to be parallel to the tilt axis gives the axis angle. It is the direction of $D F (p_2 - p_1)$, the line in the uncorrected image, reduced to $(-90°, 90°]$. By (G7), $K$ leaves that direction unchanged, so the ruler keeps its direction when the correction is applied.

Typical choices are the surface line of a FIB face that was milled parallel to the tilt axis, or an edge known to be aligned with the stage. Levelling the same ruler afterwards sets $\varphi = -\alpha$. The app checks neither the line's choice nor the face's alignment (1.4).

### 1.12 Numbers in the files

| What | Precision |
|:--|:--|
| Micrometres, CSV files | 6 decimals (1 pm) |
| Pixels, CSV files | 3 decimals |
| `px_to_um` and the correction factor | 10 significant digits |
| Points, session files | $10^{-4}$ pixel |

Rounding thus stays below $10^{-3}$ pixel everywhere. Snapping resolves a few hundredths of a pixel (2.5), and a click a pixel or so.

## Part 2. Edge strength and snapping

### 2.1 The gradient of a smoothed image (E1)

SEM images carry shot noise and, at short dwell times, isolated bright or dark pixels. A difference of neighbouring pixels amplifies both, so the gradient is taken of a locally averaged image, the average being a Gaussian $G_\sigma$ of width $\sigma$ pixels:

$$\mathbf g = \nabla(G_\sigma * I) = (\nabla G_\sigma) * I. \qquad \text{(E1)}$$

The second form is the one computed: a convolution with the derivatives of a Gaussian. It is done separably, $g_x = G'_\sigma(x) * \big(G_\sigma(y) * I\big)$ and likewise for $g_y$, with $G'_\sigma(t) = -(t/\sigma^2)\,G_\sigma(t)$. The kernels are those of `scipy.ndimage.gaussian_filter`:

- radius $\lfloor 4\sigma + 0.5\rfloor$;
- $G_\sigma$ normalised to sum 1;
- edges replicated.

The JavaScript gradient agrees with scipy's to $3\times10^{-7}$ relative on an FEI crop. An optional 3 × 3 or 5 × 5 median filter comes first: it removes isolated outliers, which the Gaussian would only spread, and keeps steps sharp.

On a linear ramp the derivative filter returns the slope times $\sum_t t^2 G_\sigma(t)/\sigma^2$. That is the slope itself, apart from the second moment the kernel misses by stopping at $4\sigma$: the factor is 0.999653 at $\sigma = 2$, and the tests check it.

### 2.2 What σ gains (E2)–(E4)

**Noise (E2).** Take white noise of standard deviation $s$ per pixel. In the continuum limit, the variance of $g_x$ is

$$\operatorname{var} g_x = s^2 \iint (\partial_x G_\sigma)^2 = \frac{s^2}{\sigma^4}\iint x^2\,G_\sigma^2.$$

The square $G_\sigma^2 = e^{-(x^2+y^2)/\sigma^2}/(4\pi^2\sigma^4)$ equals $\frac{1}{4\pi\sigma^2}$ times $e^{-(x^2+y^2)/\sigma^2}/(\pi\sigma^2)$, and the latter is a normalised Gaussian of variance $\sigma^2/2$ per axis. Its second moment in $x$ is $\sigma^2/2$. Hence

$$\operatorname{var} g_x = \frac{s^2}{\sigma^4}\cdot\frac{1}{4\pi\sigma^2}\cdot\frac{\sigma^2}{2} = \frac{s^2}{8\pi\sigma^4}, \qquad \operatorname{std} g_x = \frac{s}{2\sqrt{2\pi}\,\sigma^2}. \qquad \text{(E2)}$$

**Signal (E3).** A step of height $A$, blurred by the probe to an error function of width $b$, becomes after the smoothing an error function of width $\sqrt{b^2+\sigma^2}$ (Gaussian widths add in quadrature). Its derivative is a Gaussian across the edge, peaking at

$$\frac{A}{\sqrt{2\pi}\sqrt{b^2+\sigma^2}}. \qquad \text{(E3)}$$

**Signal-to-noise ratio (E4).** Dividing (E3) by (E2):

$$\mathrm{SNR} = \frac{A}{s}\cdot\frac{2\sigma^2}{\sqrt{b^2+\sigma^2}}. \qquad \text{(E4)}$$

It grows as $2\sigma^2/b$ for $\sigma \ll b$ and as $2\sigma$ for $\sigma \gg b$. The cost is that edges closer than about $2\sigma$ merge, and corners round off over about $\sigma$.

### 2.3 The noise floor

The edge strength is $|\mathbf g|$. Edges cover a small fraction of an image, so the median of $|\mathbf g|$ measures the noisy background; it is estimated on about a million evenly spread pixels. Pixels where $|\mathbf g|$ is exactly 0 are left out. They lie on a constant stretch wider than the kernel, such as a region clipped to black or white, and tell nothing of the noise. In an image more than half clipped they would make the median 0, and every crest a candidate. With them left out, an image of noise 53 % clipped to 0 keeps 1.07 times the median of the same noise unclipped.

For pure noise, $g_x$ and $g_y$ are independent Gaussians:

- their covariance $s^2\iint \partial_xG\,\partial_yG = (s^2/\sigma^4)\iint xy\,G^2$ vanishes by symmetry;
- they share one standard deviation $s_g$.

So $|\mathbf g|$ is Rayleigh distributed, $P(|\mathbf g| > r) = e^{-r^2/(2s_g^2)}$, with the median $m = s_g\sqrt{2\ln 2} = 1.18\,s_g$. A threshold of $c$ times the median is exceeded by noise with the probability

$$P = e^{-c^2 m^2/(2 s_g^2)} = e^{-c^2\ln 2} = 2^{-c^2}$$

per independent sample. That is 0.2 % at the default $c = 3$, 6 % at $c = 2$, and $1.5\times10^{-5}$ at $c = 4$.

**A search holds many samples (E9).** A click searches a disc of radius $r$ in the view: an ellipse of $A = \pi r^2/|\det M|$ stored pixels (2.7). The smoothed gradient is correlated over about $\sigma$, so the disc holds about $N = A/\sigma^2$ independent samples. The chance that noise alone gives a candidate somewhere in it is then about $N\,2^{-c^2}$, while that is small. A threshold of $k$ times the median, $k$ being the *min. edge strength*, therefore let a click on flat noise snap far more often than $2^{-k^2}$: at the defaults ($k = 3$, $\sigma = 2$, $r = 12$, a 3 × 3 median) 19 % of clicks on pure noise, and 67 % with a finger's radius of 30. The threshold is raised until the chance for the whole search is that of one sample at $k$:

$$N\,2^{-c^2} = 2^{-k^2} \quad\Longrightarrow\quad c = \sqrt{k^2 + \log_2 N}, \qquad N = \max\!\Big(1, \frac{A}{\sigma^2}\Big). \qquad \text{(E9)}$$

At the defaults $A = 452$ pixels, $N = 113$ and $c = 3.98$; with a finger's radius, $N = 707$ and $c = 4.30$. Then 2 of 400 mouse clicks and none of 400 finger taps on pure noise snapped, and in the tests none of 256 with either radius.

How many independent samples a disc holds was measured. On images of pure noise, with σ of 1 to 4 pixels, median windows of 0, 3 and 5, and radii of 6, 12 and 30, the share of clicks whose strongest crest exceeds $c$ times the median was fitted to $1 - e^{-N\,2^{-c^2}}$:

- For σ of 2 to 4, $A/(N\sigma^2)$ lies between 0.46 and 1.38, which moves $c$ at the defaults by less than 0.15.
- For σ = 1 without a median window, it is 1.5 to 1.6.
- With σ = 1 after a median window, the smoothing is too slight for the noise to be Gaussian: the ratio falls to 0.04, and a click on noise snaps more often than $2^{-k^2}$.

Squaring a profile (6.6) and markers (6.7) keep $k$ as it is: they look along a line, and have rules of their own.

### 2.4 Crests

Candidates for a snap are the **crest pixels** of $|\mathbf g|$: pixels where the strength is a maximum across the edge, the non-maximum suppression of Canny's detector. The unit gradient $u = \mathbf g/|\mathbf g|$ is rounded to the nearest of the 8 neighbour directions $s$. A component counts when its magnitude exceeds $\sin 22.5° = 0.383$, so that each direction covers a 45° sector. Pixel $p$ is a crest pixel when

$$|\mathbf g|(p) \ge |\mathbf g|(p + s) \quad\text{and}\quad |\mathbf g|(p) \ge |\mathbf g|(p - s).$$

It must also be at least $c$ times the median, $c$ of (E9).

### 2.5 Choosing among the candidates (E5)

Of the crest pixels within the search radius $r$, the one maximising

$$|\mathbf g|(p)\,\exp\!\left(-\frac{d(p)^2}{2\,(r/2)^2}\right) \qquad \text{(E5)}$$

is taken, $d(p)$ being its distance from the click (E7). The rule prefers the strongest edge, and near ones over far ones: at the radius the weight is $e^{-2} = 0.14$. The snapped point can move a pixel or two **along** the edge, where the strength is nearly constant; across the edge it lands on the crest.

### 2.6 Sub-pixel position (E6)

Write $f_-, f_0, f_+$ for the strength at the crest pixel $p$ and at $p \mp u$, bilinearly interpolated. The parabola through the three values is

$$f(t) = f_0 + t\,\frac{f_+ - f_-}{2} + t^2\,\frac{f_+ - 2f_0 + f_-}{2}.$$

It indeed passes through $f(-1) = f_-$, $f(0) = f_0$ and $f(1) = f_+$. Its vertex, where $f'(t) = 0$, is

$$t^* = \frac{f_- - f_+}{2\,(f_- - 2f_0 + f_+)}, \qquad \text{(E6)}$$

which is a maximum when the denominator is negative. The edge point is $p + t^*u$, with $t^*$ in $[-1, 1]$. For a Gaussian crest of width $w$ sampled at any sub-pixel offset, the vertex lies within

| $w$ (px) | 1 | 1.5 | 2 |
|:--|:--|:--|:--|
| largest error (px) | 0.048 | 0.021 | 0.012 |

of the true maximum. With $\sigma = 2$ and a sharp step, $w = \sigma$.

### 2.7 Why the stored grid (E7), (E8)

The edge map is computed on the image as stored, whatever the tilt correction, tilt axis or rotation. There are three reasons.

1. **The noise** is independent from pixel to pixel of the stored image: each pixel is one dwell of the beam. The Rayleigh threshold of 2.3 assumes exactly that. Resampling would correlate neighbouring values and change the statistics.
2. **The probe** is round in the image plane, which the stored grid samples with square pixels, as SEMs record them. Its footprint on a tilted surface is an ellipse stretched by $1/\cos\theta$, which the projection (G4) shrinks back by $\cos\theta$. An isotropic Gaussian in stored pixels is therefore the filter matched to the blur, and $\sigma$ is given in stored pixels.
3. **A straight edge keeps its place under an affine map.** Its strength is constant along it and largest on it, and the map sends lines to lines, so the crest found on the stored grid, mapped, is the crest of the mapped image. The map does change the strength, by a factor that depends on the edge's direction. That only reorders edges of different directions near a click.

The edge map thus depends on $\sigma$ and the median filter alone. A change of pixel size, tilt correction, tilt axis, rotation or origin costs nothing.

**Distance to the click (E7).** Distances are measured where the user sees them, in the corrected view. With $M$ the 2 × 2 matrix from stored pixel offsets to view units ($V$ of 1.9),

$$d(p) = |M\,(p - c)| \qquad \text{(E7)}$$

for the click $c$, both in (E5) and in the radius test.

**The search box (E8).** The disc $d \le r$ is, in stored pixels, the ellipse $p = c + M^{-1}z$ with $|z| \le r$. Its extent along $x$ is the largest $e_x\cdot M^{-1}z$ over $|z| \le r$. By the Cauchy–Schwarz inequality, that is $r$ times the length of the first row of $B = M^{-1}$, and likewise for $y$ with the second row:

$$h_x = r\sqrt{B_{11}^2 + B_{12}^2}, \qquad h_y = r\sqrt{B_{21}^2 + B_{22}^2}. \qquad \text{(E8)}$$

This is the box the search scans.

### 2.8 Bright lines: two edges each

In secondary-electron images, sidewalls and edges often appear as **bright lines** (the edge effect), not as steps. A bright line has two crests of $|\mathbf g|$, one on each flank, and a minimum on its centre line.

For example, on a sidewall line of a Zeiss test image (GeminiSEM 360, 11.59 nm pixels), row 335 gave:

- crests at $x = 409.3$ and $422.8$, 13.5 px or 156 nm apart, each 21 times the median;
- 1.7 times the median between them.

Clicks left of the centre snapped to the left flank, and clicks right of it to the right flank.

Which flank marks the top or the foot of a sloped sidewall depends on the sample and the detector; the app does not decide it. To work with bright lines:

- trace one flank consistently;
- or place the point on the line's centre with Alt (no snapping).

A ridge detector that finds line centres would be a natural addition.

## Part 3. Performance

### 3.1 What runs when

| Event | Work | Cost |
|:--|:--|:--|
| Opening an image | decode; SHA-256; the Zeiss info zone (Z1); auto levels (D2: a sort of $\le 10^6$ samples); value range and histogram (D4); 8-bit picture (D1) | linear in the pixels |
| Change of the display levels | the 8-bit picture painted again (D1) | linear in the pixels: one table look-up each for whole-number data |
| Snap or edge map switched on, $\sigma$ or median changed | the edge map (2.1–2.3), on the rows above any info bar | $\approx 4(2R+1)$ multiply-adds per pixel, $R = \lfloor 4\sigma + 0.5\rfloor$, plus the median |
| Edge map shown | the overlay picture | linear in the pixels, once |
| Change of pixel size, tilt, correction, tilt axis, rotation, origin | new matrices; a redraw | constant |
| Each redraw | one `drawImage` of the picture (and the overlay) through the affine transform; the vertices and labels | resampling on the GPU; linear in the vertices |
| Each pointer move with Snap on | one snap search (2.5, E8) | crest tests on the $\pi r^2/\lvert\det V\rvert$ stored pixels of the search ellipse: 356 for $r = 12$, $k = 1.27$ |
| A profile shown, or dragged, or a contour crossing it edited | its samples (6.2–6.4) and crossings (6.5); the plot | $(N + 1)\,M$ bilinear values, about one per stored pixel of the band; the crossings linear in the contour vertices |
| A profile squared (6.6) | the strongest edge along its line, and the structure tensor there; or the normal of a contour's segment | $N + 1$ bilinear values; at most $(2\lceil 6\sigma\rceil + 2)^2$ pixels, 676 at $\sigma = 2$ |

### 3.2 Measured times

The FEI test image is 3072 × 2188 pixels at 16 bits (13.5 MB), with 3072 × 2048 = 6.29 Mpx above its data bar. Times were measured in Chromium on the development machine, with the page in the background:

| Step | Time |
|:--|:--|
| decode (UTIF.js) | 0.04 s |
| SHA-256 | 0.01 s |
| auto levels (D2) | 0.16 s |
| value range of the whole image | 0.04 s |
| histogram (D4), with its own value range | 0.06 s |
| 8-bit picture through the table (D1) | 0.04–0.07 s |
| opening the image, from the call to the drawn view, snapping off | 0.7–1.0 s |
| edge map, $\sigma = 1$, no median | 0.72 s |
| edge map, $\sigma = 2$, no median | 1.12 s |
| edge map, $\sigma = 2$, 3 × 3 median (default) | 2.11 s |
| edge map, $\sigma = 2$, 5 × 5 median | 4.22 s |
| edge map, $\sigma = 4$, 3 × 3 median | 3.15 s |
| one snap search, radius 12, cross-section view rotated by 30° | 6.5 µs |
| a line profile of 3001 samples along a band of 83 lines (249 000 values) | 4.9 ms (6.8) |
| the profile window refreshed for a profile of 476 samples × 30 lines, plot included | 0.5 ms |

### 3.3 Memory

For an image of $N$ stored pixels, of which $N_e$ lie above the info bar:

| Item | Bytes |
|:--|:--|
| grey values (`Float32Array`) | $4N$ |
| 8-bit picture: its `ImageData`, kept for repainting when the levels change, and the canvas backing store | $8N$ |
| table of the grey map (D1), whole-number data | at most 256 KB |
| edge map: $g_x$, $g_y$, $\lvert\mathbf g\rvert$ | $12N_e$ |
| edge map while computed: the median-filtered copy and one intermediate | $8N_e$ (transient) |
| overlay picture, when shown | $4N_e$ (plus as much transiently) |

For the FEI image ($N = 6.72$ M, $N_e = 6.29$ M):

- about 180 MB stay resident with the overlay shown: $12N + 16N_e$;
- the first edge map peaks at about 205 MB: $12N + 20N_e$, before the overlay;
- recomputing it peaks at up to about 305 MB, $12N + 36N_e$, because the old map and its overlay are held until the new map is ready.

Keeping the `ImageData` costs $4N$, 27 MB here. In exchange a slider drag, which repaints the picture at every step, allocates nothing.

### 3.4 Limits and remedies

- **Canvas size.** Browsers cap canvas dimensions and areas: Chromium allows at most 32 767 px per side, and other browsers allow less. Larger images would need tiling.
- **The main thread blocks** while the edge map is computed, 2–4 s for 6 Mpx; a busy message shows meanwhile. A Web Worker would keep the page responsive. Chromium refuses to load a worker script into a page opened from `file://`, but a worker can be started from a Blob URL holding the code.
- **The 5 × 5 median** doubles the edge-map time: it sorts 25 values by insertion, about 150–300 comparisons per pixel. A selection network, or a histogram method for integer data, would cut that several-fold.
- **Very large images** (beyond about 100 Mpx) exceed the memory above. They would need tiles and a reduced-resolution pyramid for display.
- **The auto levels** take half the computation of opening an image: a sort of about a million samples (5.2). For whole-number data, a count of each value would give the exact percentiles of every pixel without a sort, in one pass with at most 65 536 counters for 16 bits.
- **Hidden pages** get no animation frames. Drawing waits until the page is visible again, while computations go on (the busy-message pause falls back to a timer).

## Part 4. GDSII

The GDS export (`js/gds.js`, FORMAT.md) writes the contours as a binary GDSII stream file. Two things in it need more than bookkeeping: the grid the coordinates are rounded to, and the format of the two real numbers that declare it.

### 4.1 Records

A GDSII file is a sequence of records. Each starts with a big-endian 16-bit length, which counts these four header bytes, then a record type byte and a data type byte, then its data. The length is even and at most 65 535 bytes.

The data types used are:

- 0x00: no data;
- 0x02: 16-bit signed integers, for layers, datatypes and dates;
- 0x03: 32-bit signed integers, for coordinates and widths;
- 0x05: eight-byte reals, for the units;
- 0x06: ASCII text, padded with a NUL to an even length.

The file is

    HEADER 600 | BGNLIB dates | LIBNAME | UNITS
    BGNSTR dates | STRNAME | elements | ENDSTR | ENDLIB

and its elements are BOUNDARY, PATH and TEXT, each closed by ENDEL.

### 4.2 Units and the grid (S1)

Coordinates are 32-bit integers in database units (DBU). UNITS holds two reals:

- the DBU in user units: $10^{-3}$, for a 1 µm user unit and a 1 nm DBU;
- the DBU in metres: $10^{-9}$.

A point at $x$ µm is written as $\operatorname{round}(x/10^{-3})$. Rounding moves it by at most half a DBU along each axis: 0.5 nm, or $0.5\sqrt2 = 0.71$ nm along a diagonal. That is below the pixel size of any trace, and below the 1–2 nm the snapping resolves on a 1.35 nm image.

The 32-bit range, $\pm 2^{31}$ DBU, is ±2.1 m at 1 nm, which no SEM field approaches.

An XY record of $n$ points takes $4 + 8n$ bytes, so $n \le (65\,535 - 4)/8 = 8191$. A BOUNDARY repeats its first point at the end, so it has at most 8190 vertices.

### 4.3 Eight-byte reals (S2)

GDSII stores reals in the excess-64, base-16 format of the IBM System/360. Bit 63 is the sign $s$, bits 62–56 the exponent $e$ biased by 64, and bits 55–0 the mantissa $m$:

$$x = (-1)^s\,\frac{m}{2^{56}}\,16^{\,e - 64}, \qquad \frac{1}{16} \le \frac{m}{2^{56}} < 1,$$

normalized so that the leading hexadecimal digit of $m$ is not 0. For a double $x \ne 0$, the conversion goes in three steps:

1. Set $a = |x|$ and $e = 64$.
2. While $a \ge 1$, divide $a$ by 16 and add 1 to $e$; while $a < 1/16$, multiply $a$ by 16 and subtract 1 from $e$.
3. Set $m = a\,2^{56}$.

**The conversion is exact.** Multiplying or dividing by $16 = 2^4$ only shifts the binary exponent of a double, so step 2 loses nothing. A double in $[1/16, 1)$ has a binary exponent of $-4$ or more and 53 significant bits. Its last bit therefore weighs at least $2^{-4-52} = 2^{-56}$, so $a\,2^{56}$ is an integer below $2^{56}$, and $m$ holds $a$ exactly.

The 56-bit mantissa has three bits more than a double's 53. Reading back, $m/2^{56}\cdot 16^{e-64}$ with exact scaling by powers of 2, therefore returns $x$ itself. The tests check this on 2000 random values from $10^{-20}$ to $10^{20}$.

**The units.** $10^{-3}$ and $10^{-9}$ come out as `3E 41 89 37 4B C6 A7 F0` and `39 44 B8 2F A0 9B 5A 54`. The tests compare these, and five other values, with bytes computed independently from exact fractions in Python. They are also the bytes that gdstk 1.0.1 and KLayout 0.30.12 write for these units.

### 4.4 What was checked against layout tools

A file the app wrote held a turned, tilt-corrected FEI trace: a polygon on layer 2/0, an open contour as a 20 nm path on 5/1, and the two contour names. It was read back with gdstk 1.0.1 and with KLayout 0.30.12.

- Both found the cell, the two layers, one polygon, one path and two labels, with the units above.
- Every vertex lay within 0.48 nm of the polygon file's micrometres, the rounding of (S1).

## Part 5. The display

The display decides how the grey values look on the screen, and nothing else. The edge map, the snapping and every measure work on the grey values as stored (Parts 1 and 2). The histogram and the automatic levels count only the rows of the image proper, without the microscope's info bar; 5.1 finds that bar.

### 5.1 The info bar (Z1)

Microscopes write a bar of text and a scale bar into the image file, below the image or over it. Its values belong to no specimen: saturated white boxes and black text. Counted with the image, they would:

- pull the automatic levels towards the ends of the scale;
- fill the ends of the histogram;
- put strong, meaningless edges into the edge map.

The app therefore leaves the bar's rows out of all three. The bar stays in the picture, below a dashed line.

**FEI** files record the bar. The image has `[Image] ResolutionY` rows, and the bar is the rest of the file's rows: 140 or 70 rows in the test images.

**Zeiss** files record nothing about it. The zone is drawn over the image, at a place that differs between instruments: rows 691–766 of 768 on a GeminiSEM 360, rows 675–750 on a GeminiSEM 560, with rows of image below both. Its pattern is unmistakable, though: a white box carrying black text, framed above and below by full-width black lines. With $v_{\min}$ and $v_{\max}$ the darkest and brightest values of the whole image and $R = v_{\max} - v_{\min}$, call a pixel

- *black* when $v \le v_{\min} + 0.02\,R$;
- *white* when $v \ge v_{\max} - 0.02\,R$.

A row is a *black line* when at least 95 % of its pixels are black. In an image of $H$ rows, the zone starts at the first row $y_0 \ge \lfloor 2H/3\rfloor$ for which

1. row $y_0$ is a black line;
2. the rows below it, $y_0 + 1, y_0 + 2, \dots$, are each at least half white, and there are at least 20 of them;
3. the row after them is a black line, or the image has ended. (Z1)

Everything from $y_0$ down counts as the info bar: $H - y_0$ rows.

**Why these numbers.** In the two test images the frame lines are 99.7 % and 100 % black. The 74 rows between them are 67–100 % white, the text taking the rest. A zone therefore passes each test by a wide margin. Rows of a micrograph carry noise and features, so they come nowhere near 95 % of a row within 2 % of the range from the darkest value. Nor do they give 20 consecutive rows each half saturated. The 2 % are a margin for zones drawn in near-black and near-white rather than at the extremes.

**What it gets wrong, by construction:**

- A zone drawn otherwise, without its frame lines or higher up, is not found. Its rows then count as image, as they did before the detection.
- Rows of image that show the pattern in the lowest third would be taken for a zone: a full-width black band over 20 rows of mostly saturated signal. They would leave the histogram, the auto levels and the edge map, so snapping would not work there. No test image does this.
- Rows of image below the zone, 1 and 17 in the test images, are left out with it. The processed rows thereby stay one block, from row 0 to the zone.

The tests run (Z1) on synthetic images. It must find a zone between two lines and a zone running to the last row. It must find none in an image without one, in a black line alone, or in a saturated band without lines.

**Hitachi** files record that a bar is there (`DataDisplayCombine=1`) but not where. The microscope draws it over the bottom rows of the image: white text and a scale bar on black. Call a pixel *black* when $v \le v_{\min} + 0.1\,R$ and *white* when $v \ge v_{\max} - 0.1\,R$. That is wider than for Zeiss, because a JPEG blurs the edges of the text. The bar is the block of rows that reaches the last row and in which every row is

1. at least half black;
2. at least 90 % black or white;

provided the block is at least 16 rows and at most $H/4$. (H1)

**Why these numbers.** In the 17 test images, from an SU8200 at 1280 × 960, the bar is the bottom 64 rows, 896–959.

- Its rows are 63–100 % black, and every pixel in it is exactly 0 or 255, so both tests pass with wide margins.
- No row of image above it is more than 0.2 % black, far from half a row.
- Saved as JPEG at quality 50 to 95, the bar's rows stay at least 60 % black and 91 % black or white, and the whole bar is found. The second test is the closer one at quality 50; at quality 75 and above every row passes it by over 8 points.
- With the 2 % of the Zeiss test and 99 % here, a JPEG saved at quality 90 kept only the bottom 16 rows of the bar: the ringing around the text pushed its rows out of the second test.

The limits on the block's height keep out two things:

- one or a few black rows at the bottom, which a bar of text cannot be;
- a large region of saturated black and white image reaching the last row, which would otherwise be read as one tall bar. A larger bar is not taken: all the rows then count as image.

**What it gets wrong, by construction.** Rows of image at the bottom that are mostly saturated black, with the rest saturated white, would join the bar. Snapping would then not work there. No test image comes near this.

The tests run (H1) on synthetic images. It must find a bar drawn as Hitachi draws it. It must find none in an image without one, in a dark band whose text is grey, in bars of 10 rows or of more than $H/4$, or in a white band. A Hitachi TIFF built in the tests, with `DataDisplayCombine=0`, must keep all its rows.

**JEOL and TESCAN** record their bars, so nothing is found in the pixels.

- JEOL's `.txt` gives the image's size in `$CM_FULL_SIZE`. When the file has the same width and more rows, the rows below are the data bar.
- TESCAN's `ImageStripSize` gives the rows of its info strip at the bottom.

Neither is yet tested on real images (README, *Microscope files*).

### 5.2 Levels (D1) and the auto levels (D2)

The screen shows 256 grey steps, $g = 0, \dots, 255$. Two levels map the grey values $v$ onto them: the black level $\ell_0$ and the white level $\ell_1 > \ell_0$. The map is the straight line through $(\ell_0, 0)$ and $(\ell_1, 255)$, rounded to the nearest step and clipped:

$$g(v) = \min\!\Big(255,\ \max\!\Big(0,\ \operatorname{round}\frac{255\,(v - \ell_0)}{\ell_1 - \ell_0}\Big)\Big). \qquad \text{(D1)}$$

- **Steps.** Each screen step spans $(\ell_1 - \ell_0)/255$ grey values. The narrower the window, the more steps a given difference of values gets: that is the contrast of the picture.
- **Clipping.** Values at or below $\ell_0$ show black and values at or above $\ell_1$ show white. The histogram shades them.

**Computing it.** The quotient is formed as written, numerator first. For whole values the numerator is exact, so a value exactly halfway between two steps rounds up. A product with the precomputed slope $255/(\ell_1 - \ell_0)$ would not always do so. For example, with $\ell_0 = 100$, $\ell_1 = 200$ and $v = 150$:

- the slope 2.55 is stored as 2.5499999999999998;
- $50 \times 2.55$ comes out as 127.49999999999999;
- it rounds to 127 instead of 128.

**Repainting.** The picture is an 8-bit canvas of the stored image. It is painted again after each change of levels, and the view of 1.9 draws it as before.

- **Whole-number data** (8- and 16-bit images): (D1) is evaluated once per value in the image's range $[a, b]$, a table of $b - a + 1 \le 65\,536$ entries. Each pixel then costs one look-up and one 32-bit write. The FEI test image needs a table of 59 495 entries for its 6.7 M pixels and repaints in 40–70 ms.
- **Other data:** (D1) is evaluated per pixel.

**Auto levels (D2).** An image opens with these levels, and *Auto* restores them: the 0.5 and 99.5 % percentiles of the grey values above the info bar. They come from a sample:

1. take every $s$-th value, $s = \max(1, \lfloor N_e/10^6\rfloor)$: all of them up to two million values, and from one to two million beyond (1 048 576 for the FEI image, $s = 6$);
2. sort the sample;
3. read the $p$-th percentile at the position $p\,(K - 1)/100$ of the $K$ sorted values, interpolating linearly between neighbours.

About 0.5 % of the pixels then show black and 0.5 % white, whatever the bit depth or the signal level. The stretch adapts to the image, and a few extreme pixels cannot squeeze it.

**How good is the sample?** Suppose it were random. The number of sample values below the image's true $p$-quantile is then binomial, with $K$ trials and probability $p$. Its mean is $Kp$ and its standard deviation $\sqrt{Kp(1-p)}$. Divided by $K$, the fraction of the image below the sample's quantile therefore scatters about $p$ by $\sqrt{p(1-p)/K}$. For the smallest sample of a large image, $K = 10^6$, this is

$$\sqrt{\frac{0.005 \times 0.995}{10^6}} = 7\times10^{-5},$$

that is $0.5 \pm 0.007$ %. A regular sample does as well or better, unless the image repeats with the sampling step: every 6th pixel for the FEI image, which falls on the same columns in every row.

**Full range** sets $\ell_0 = m_0$ and $\ell_1 = m_1$, the ends of the span of 5.3, as ImageJ's *Reset* does: 0 and 255 for an 8-bit image, else the darkest and the brightest value above the info bar.

### 5.3 Brightness and contrast (D3)

The two sliders are another way to move the same two levels. They follow ImageJ's *Brightness/Contrast* window, the class `ContrastAdjuster` of ImageJ 1.x. Describe the window by its centre and width:

$$C = \frac{\ell_0 + \ell_1}{2}, \qquad W = \ell_1 - \ell_0, \qquad \ell_{0,1} = C \mp \frac W2.$$

Let $[m_0, m_1]$ be the values the sliders span, of width $S = m_1 - m_0$ (see *The span* below). Both sliders run over $[0, 1]$ in steps of 0.001.

**Brightness $b$.** ImageJ places the centre linearly across the span, from the top down:

$$C = m_0 + (1 - b)\,S, \qquad\text{and back}\qquad b = 1 - \frac{C - m_0}{S}.$$

- At $b = 0$ the centre sits at $m_1$, and most of the image falls below it: the picture is darkest.
- At $b = 1$ the centre sits at $m_0$: brightest.

Moving it keeps $W$, so the contrast stays.

**Contrast $c$.** ImageJ sets the slope of the map relative to a reference: the slope that spreads the span over the whole grey scale. A window of width $W$ has the slope $255/W$ in (D1), and the span the slope $255/S$. Their ratio is the gain

$$\kappa = \frac{255/W}{255/S} = \frac SW.$$

ImageJ makes the gain piecewise in $c$:

$$\kappa = 2c \quad \big(c \le \tfrac12\big), \qquad \kappa = \frac{1}{2\,(1 - c)} \quad \big(c \ge \tfrac12\big).$$

It then sets $W = S/\kappa$ about the current centre, so the width is

$$W = \frac{S}{2c} \quad \big(c \le \tfrac12\big), \qquad W = 2\,(1 - c)\,S \quad \big(c \ge \tfrac12\big). \qquad \text{(D3)}$$

**Back from the window to the slider.** On both branches $\kappa$ rises with $c$, and both give $\kappa = 1$ at $c = \tfrac12$. So a window with $\kappa \le 1$, that is $W \ge S$, belongs to the first branch, and one with $W \le S$ to the second. Solving each for $c$:

$$c = \frac{S}{2W} \quad (W \ge S), \qquad c = 1 - \frac{W}{2S} \quad (W \le S).$$

Check: the first gives $c \le \tfrac12$ when $W \ge S$, and substituting back gives $W = S/(2c)$. The second gives $c \ge \tfrac12$ when $W \le S$, and back $W = 2(1 - c)S$. Each slider position thus shows one width and each width one position, so a slider stays where it was moved. These are ImageJ's `adjustContrast` and `updateScrollBars`.

**What the two halves do.**

- **Left half.** The gain rises linearly from 0 to 1, and the window shrinks from unbounded to the span. At $c = \tfrac14$ the window is twice the span.
- **Right half.** The width falls linearly from $S$ to 0, so the gain rises as $1/(2(1 - c))$: 5 at $c = 0.9$, 50 at 0.99, 500 at 0.999. At $c = 1$ the window closes and the picture becomes a threshold at $C$; the app keeps the levels a millionth of the image's value range apart.
- **The end, $c = 0$.** It would give $\kappa = 0$ and an infinite window. ImageJ then leaves the levels as they are; here the slider stops one step short, at $c = 0.001$, a window of $500\,S$.

**The other slider stays.** As in ImageJ, the slider that is not moved keeps its quantity as the levels have it, not as its position says:

- moving brightness keeps the actual width of the window;
- moving contrast keeps its actual centre.

After every change of levels, the sliders are set from the levels by the formulas back, clipped to $[0, 1]$. That covers a typed level, a dragged handle, *Auto*, *Full range* and a session. A centre outside the span shows as the end of the brightness slider, yet contrast still keeps the true centre.

**The span.** It is ImageJ's, and the histogram spans it too (5.4):

- **8-bit images**, grey, palette or colour (and PNG, JPEG or BMP files, which the browser decodes to 8 bits): $[m_0, m_1] = [0, 255]$, whatever values the image holds. A slider position then means the same levels on every 8-bit image. The Zeiss test image holds the values 96–195, and its auto levels 104 and 160 ($C = 132$, $W = 56$) sit at $b = 1 - 132/255 = 0.482$ and $c = 1 - 56/510 = 0.890$.
- **16- and 32-bit images**: the darkest to the brightest value above the info bar. ImageJ takes the whole image here, as it knows nothing of an info bar; this is the one departure from it.

**Tests.** They transcribe ImageJ's arithmetic and compare it with these formulas:

- the levels set by both sliders, at all 257 positions of a 256-step slider and from three windows, agree to $10^{-16}$ of the span;
- the slider positions of 1000 random windows agree to $10^{-15}$.

### 5.4 The histogram (D4)

The histogram counts the grey values above the info bar in at most 256 bins, over the span $[m_0, m_1]$ of 5.3: 0–255 for an 8-bit image, the values that occur for 16 and 32 bits.

**Whole values.** The 8-bit span, or a span of whole-number values at 16 or 32 bits, comprises the $n_v = m_1 - m_0 + 1$ whole values $m_0, m_0 + 1, \dots, m_1$. Two requirements fix the bins:

- every bin should hold the same whole number $w$ of them, so that bin counts compare like with like;
- there should be at most 256 bins, so $n_v/w \le 256$.

The smallest such $w$ and the number of bins are

$$w = \left\lceil \frac{n_v}{256} \right\rceil, \qquad n = \left\lceil \frac{n_v}{w} \right\rceil. \qquad \text{(D4)}$$

$n \le 256$ holds because $w \ge n_v/256$ makes $n_v/w \le 256$, and the ceiling of a number at most 256 is at most 256.

**The axis.** Each whole value $v$ stands for the interval $[v - \tfrac12, v + \tfrac12)$. With $a = m_0 - \tfrac12$, bin $b$ therefore covers $[a + b\,w,\ a + (b+1)\,w)$, the axis runs from $a$ to $a + n\,w$, and a value falls in the bin

$$\operatorname{bin}(v) = \left\lfloor \frac{v - a}{w} \right\rfloor.$$

- **A whole value** gives $\lfloor (v - m_0)/w \rfloor$. Write $v - m_0 = q\,w + r$ with $q$ and $r$ whole and $0 \le r \le w - 1$. Then $(v - a)/w = q + (r + \tfrac12)/w$, and $0 < (r + \tfrac12)/w < 1$, so the floor is $q$.
- **A value that is not whole** counts at its nearest whole value. This happens in the 8-bit span with the luminance of a colour image, e.g. 100.49 counts at 100.

The last bin may reach past $m_1$, by $nw - n_v$ values that do not occur. It is drawn as wide as the others, since it spans as many values.

| image | span $m_0$–$m_1$ | $n_v$ | $w$ | $n$ |
|:--|:--|:--|:--|:--|
| any 8-bit image, e.g. the Zeiss test image (values 96–195) | 0–255 | 256 | 1 | 256 |
| FEI test image, 16 bits | 6041–65468 | 59 428 | 233 | 256, the last holding 13 values |
| a 16-bit image of values 1000–1299 | 1000–1299 | 300 | 2 | 150 |
| full 16 bits | 0–65535 | 65 536 | 256 | 256 |

**Why not 256 equal bins of the span.** A half-open interval of a fractional length $\delta = (m_1 - m_0)/256$ holds either $\lfloor\delta\rfloor$ or $\lceil\delta\rceil$ whole values, so the counts jump between neighbouring bins:

- **A span of 100 values**, such as 96–195, $\delta = 0.39$: bins hold 0 or 1 value. 156 of the 256 bins stay empty, and the histogram shows a comb of isolated spikes. An 8-bit image cannot have this, its span being exactly 256 values, but a 16-bit image with so narrow a range can.
- **A span of 300 values**, $\delta = 1.17$: bins hold 1 or 2 values, and the counts jump by a factor of 2 from bin to bin.
- **The FEI image**, $\delta = 232.1$: bins hold 232 or 233 values, a ripple of 0.4 %.

**Other values** (16- or 32-bit data that are not whole, such as floats) take 256 bins of width $(m_1 - m_0)/256$ from $m_0$, the brightest value counted in the last bin.

**Counting** is one pass over the values. It divides each by $w$ rather than multiplying by $1/w$. With $w = 49$, $49 \times (1/49)$ is 0.9999999999999999 in floating point, and the floor would put the value $m_0 + 49$ into bin 0 instead of bin 1.

**Drawing.**

- **Bars.** Bin $b$ fills the width from $b/n$ to $(b+1)/n$. Its height is linear in the count, or, with *log counts*, in $\ln(1 + \text{count})$. On the FEI image, whose highest bin holds 105 396 values, a bin a thousand times lower is invisible on the linear scale. On the logarithmic one it stands at $\ln(106.4)/\ln(105\,397) = 40$ % of the height.
- **Handles.** A level $\ell$ sits at the fraction $(\ell - a)/(nw)$ of the width, with $a$ the start of the axis. A whole level thus points at the middle of its value's bar: the black handle at the auto level 104 of the Zeiss image points at the bar of 104. Dragging a handle inverts this map.

## Part 6. Line profiles

A line profile gives the grey values along a line, averaged across a band of adjustable width, and marks where contours cross the line. It can be turned to run square to the edge it crosses (6.6). Like a ruler, it is kept as two stored points; its band adds one number, the width. Everything else follows from these, the measurement frame and the grey values as stored, not the display (Part 5).

### 6.1 The band (P1)

**The line as seen.** The profile runs from $u_1$ to $u_2$, stored coordinates, with $d = u_2 - u_1$. The user sees it through the view frame $V$ of 1.9, in which it is the vector $Vd$. Its length, unit direction and unit normal there are

$$L_v = |Vd|, \qquad t = \frac{Vd}{L_v}, \qquad n = (-t_y,\ t_x),$$

$n$ being $t$ turned by $+90°$.

**The band as seen** is the rectangle of the points

$$V u_1 + s\,t + r\,n, \qquad 0 \le s \le L_v, \quad |r| \le \frac w2, \qquad \text{(P1)}$$

$w$ being the band width in view units.

**The band in stored coordinates.** $V$ is linear, so the band's point $(s, r)$ is the stored point $u_1 + s\,V^{-1}t + r\,V^{-1}n$. A step $r$ across the band is the stored vector $r\,V^{-1}n$. Mapped back, $V\,(V^{-1}n) = n$ is normal to $t$. The two sides are therefore perpendicular as seen, whatever $V$ does. In stored coordinates, the sides $d$ and $V^{-1}n$ are in general not perpendicular: the band is a parallelogram there, because the tilt correction stretches across the tilt axis. A rotation $R(\varphi)$ changes $V$ but not this parallelogram: it turns $t$ and $n$ together, and $V^{-1}$ turns them back.

**Units.** The view frame is the measurement frame in other units. From 1.6 and 1.9,

$$A = R(\varphi)\,K\,D\,F = R(\varphi)\,K\,\frac{1}{1000}\begin{pmatrix}p_x & 0\\ 0 & -p_y\end{pmatrix} = \frac{p_x}{1000}\;R(\varphi)\,K\begin{pmatrix}1 & 0\\ 0 & -p_y/p_x\end{pmatrix} = c\,V,$$

with $c = p_x/1000$ µm per view unit ($c = 1$ px without a pixel size, where $D$ is the identity). So:

- the band is $c\,w$ wide in the measurement frame;
- the profile is $|Ad| = c\,L_v$ long.

The width is kept in view units, like the snap radius. When the pixel size changes, the band then stays on its pixels, as the points do (1.1).

### 6.2 Samples along (P2)

The samples lie on the centre line at

$$u_i = u_1 + \frac iN\,d, \qquad i = 0, \dots, N, \qquad N = \max\big(1, \lceil |d| \rceil\big). \qquad \text{(P2)}$$

Neighbours are $|d|/N \le 1$ stored pixel apart, so every pixel along the line takes part, through the interpolation of 6.4.

The distance of sample $i$ from $u_1$ in the measurement frame follows from the linearity of $A$, $A(\lambda d) = \lambda\,Ad$:

$$s_i = \Big|A\,\frac iN\,d\Big| = \frac iN\,|Ad| = \frac iN\,c\,L_v.$$

The samples are thus evenly spaced in micrometres too. On the FEI test image, a vertical profile of 350 rows in a 52° cross-section gives 351 samples, $1.34896 \times 1.2691 = 1.712$ nm apart.

### 6.3 Lines across (P3)

Across the band, the vector $w\,V^{-1}n$ spans its full width in stored coordinates. Its length is the band's width in stored pixels:

$$w_s = w\,\big|V^{-1}n\big|.$$

The profile averages $M$ lines parallel to the centre line, at the offsets $r_j$ (view units, along $n$):

$$M = \max\big(1, \lceil w_s \rceil\big), \qquad r_j = \Big(\frac{j + \frac12}{M} - \frac12\Big)\,w, \qquad j = 0, \dots, M - 1. \qquad \text{(P3)}$$

The $r_j$ are the middles of $M$ equal strips of the band. Neighbouring lines are $w_s/M \le 1$ stored pixel apart, and a band one stored pixel wide or less has the centre line alone.

Two examples, for a horizontal line:

- **Plain image:** $V = \mathrm{diag}(1, -1)$ and $V^{-1}n = (0, -1)$. A band 5 view units wide averages 5 lines, the rows $-2$ to $+2$ from the line.
- **Rows that count twice** ($k = 2$, tilt axis along $x$): $V = \mathrm{diag}(1, -2)$ and $|V^{-1}n| = \tfrac12$. A band 4 view units wide is 2 rows wide and averages 2 lines, half a row on either side.

### 6.4 Values (P4)

**Interpolation.** The grey value at a stored point $(x, y)$ is interpolated bilinearly between the four nearest pixel centres. With $x_0 = \lfloor x\rfloor$, $y_0 = \lfloor y\rfloor$, $f_x = x - x_0$, $f_y = y - y_0$ and $I_{ab}$ the value of pixel $(x_0 + a, y_0 + b)$:

$$I(x, y) = (1 - f_y)\big[(1 - f_x)\,I_{00} + f_x\,I_{10}\big] + f_y\big[(1 - f_x)\,I_{01} + f_x\,I_{11}\big].$$

It reproduces any linear ramp $I = \alpha + \beta x + \gamma y$ exactly. Inserting it, each bracket becomes $\alpha + \beta(x_0 + f_x) + \gamma y_0$ and $\alpha + \beta(x_0 + f_x) + \gamma(y_0 + 1)$. Weighted by $1 - f_y$ and $f_y$, they sum to $\alpha + \beta x + \gamma (y_0 + f_y) = \alpha + \beta x + \gamma y$. The tests find a ramp reproduced to $1.4\times10^{-14}$, along a row and between pixel centres.

**Where values exist.** Values exist where stored pixels lie: $-\tfrac12 \le x \le W - \tfrac12$ and $-\tfrac12 \le y \le R - \tfrac12$, with $R$ the rows above the info bar (5.1). In the outer half pixel, the nearest row or column is repeated. Elsewhere, outside the image or in its info bar, a value is missing.

**The profile.** At $s_i$, let $k_i \le M$ of the lines have a value, $v_1, \dots, v_{k_i}$. The profile gives their mean and their standard deviation, the spread across the band:

$$m_i = \frac{1}{k_i}\sum_j v_j, \qquad \sigma_i = \sqrt{\frac{1}{k_i}\sum_j (v_j - m_i)^2}. \qquad \text{(P4)}$$

$\sigma_i$ is computed in two passes, the mean first. The one-pass form $\sum v_j^2/k_i - m_i^2$ subtracts two numbers of order $10^9$, 16-bit values squared, to find one that can be many orders smaller.

**What the spread means.** It measures how much the band varies across, from noise and from structure alike: an edge not quite parallel to the band's lines widens it. It is not the error of the mean. The lines are correlated by the interpolation and by the probe, so that $\sigma_i/\sqrt{k_i}$ would understate that error.

**The mean grey value** of the measurements file weights every value in the band equally: $\sum_i k_i\,m_i \,/\, \sum_i k_i$.

### 6.5 Crossings (P5)

A contour segment from $a$ to $b$, with $e = b - a$, crosses the profile's centre line where

$$u_1 + t\,d = a + q\,e, \qquad 0 \le t \le 1, \quad 0 \le q \le 1.$$

Write $w = a - u_1$, so that $t\,d - q\,e = w$, and use the cross product $x \times y = x_1 y_2 - x_2 y_1$, for which $x \times x = 0$ and $y \times x = -\,x \times y$:

- Crossing both sides with $e$ removes $q$: $t\,(d \times e) = w \times e$.
- Crossing both sides with $d$ removes $t$: $-q\,(e \times d) = w \times d$, that is $q\,(d \times e) = w \times d$.

Hence

$$t = \frac{w \times e}{d \times e}, \qquad q = \frac{w \times d}{d \times e}. \qquad \text{(P5)}$$

**Where the crossing lies.** The map keeps $t$: $A(u_1 + t\,d) - A u_1 = t\,Ad$. The crossing therefore lies at $s = t\,|Ad| = t\,c\,L_v$ along the profile, in micrometres as in pixels. As for two lines in 1.10, it is solved in stored coordinates.

**Cases:**

- Every segment of a contour is tried, the closing one of a closed contour included.
- $d \times e = 0$ means the segment is parallel to the line, or a point. It has no single crossing and is not counted.
- A vertex exactly on the line ends one segment ($q = 1$) and starts the next ($q = 0$) at the same $t$. It is counted once.
- Only the centre line is tested: a contour that passes through the band without reaching the centre line is not marked.

### 6.6 Squaring a profile to an edge (P6)–(P11)

A profile measures an edge best when it runs square to it, along the edge's normal as seen. A line drawn by hand is a few degrees off. While **square profiles to the edge they cross** is on (under Snapping, on by default), a new profile therefore turns, about the point where it crosses an edge, to run along that edge's normal. A profile whose end was dragged turns too, when the end is let go, but about its other end (*Turning about the end not moved*, below). **E** squares the profile edited about its crossing. The edge is:

1. a traced contour the profile crosses, if there is one: of the crossings, the one nearest the profile's middle (P10);
2. else the image's strongest edge along the profile, whose direction the structure tensor gives (P7)–(P9).

The profile turns about the crossing and keeps its length and the crossing's place along it (P11). A new or moved profile turns by itself only when it is at most 15° off square (*The largest turn*, below). The squaring is an edit of its own:

- Ctrl+Z gives the profile back as drawn, or as dragged;
- Alt+click, or Exact, places a profile as drawn; Alt held, or Exact, when a dragged end is let go keeps it as dragged.

For 1.6 s a note beside the cursor tells what was done:

- "⊥ edge, 4.2°" for the image's edge, with the contour's name in place of "edge" for a contour;
- "not squared: 34.1° off" when the turn would exceed the cap;
- "not squared" otherwise, with the reason in the status bar.

**What being off square costs (P6).** Work in the view, where the band is a rectangle (P1). Let a straight edge have the unit normal $\hat n$ and the grey profile $f$ across it, so that near it the image is $I(q) = f\big(\hat n\cdot(q - q_e)\big)$, $q_e$ being a point of the edge. Let the profile's direction $t$ make the angle $\delta$ with $\hat n$, and take the axes so that

$$\hat n = (1, 0), \qquad t = (\cos\delta,\ \sin\delta), \qquad n = (-\sin\delta,\ \cos\delta),$$

$n$ being the band's normal of (P1). The band's line at the offset $r$ runs through $q(s, r) = q_0 + s\,t + r\,n$, with $q_0$ the point where the centre line crosses the edge. Since $\hat n\cdot(q_0 - q_e) = 0$, $\hat n\cdot t = \cos\delta$ and $\hat n\cdot n = -\sin\delta$, that line reads

$$I\big(q(s, r)\big) = f(s\cos\delta - r\sin\delta).$$

Two things follow.

- **The stretch.** Along one line, $f$ is read at $s\cos\delta$, so every distance across the edge appears $1/\cos\delta$ times longer along the profile. Two parallel edges $W$ apart appear $W/\cos\delta$ apart, too long by $\sec\delta - 1 = \delta^2/2 + O(\delta^4)$. This is second order in $\delta$.
- **The smear.** Line $r$ crosses the edge where $s\cos\delta = r\sin\delta$, at $s_r = r\tan\delta$. Across the band, $|r| \le w/2$, the crossings spread over $w\tan\delta$, which is first order in $\delta$. The mean (P4) averages copies of the edge shifted by $s_r$, that is, the edge convolved with the distribution of the shifts.
  - In the limit of many lines that distribution is uniform over $w\tan\delta$, with the variance $w^2\tan^2\delta/12$.
  - The $M$ lines of (P3) lie at the middles of $M$ equal strips, $h = w/M$ apart. $M$ points spaced $h$ apart have the variance $h^2(M^2 - 1)/12$, so here it is $w^2\tan^2\delta\,(1 - 1/M^2)/12$.

**The edge's width.** Take an edge whose derivative across it is a Gaussian of standard deviation $b$, as in (E3). Along one line, $\partial_s f(s\cos\delta - r\sin\delta) = \cos\delta\, f'(\dots)$ is a Gaussian in $s$ of standard deviation $b/\cos\delta$, centred at $s_r$. The mean over the lines convolves it with the shifts, and variances add under convolution:

$$b_\delta^2 = \frac{b^2}{\cos^2\delta} + \frac{w^2\tan^2\delta}{12} = b^2 + \tan^2\delta\left(b^2 + \frac{w^2}{12}\right), \qquad \text{(P6)}$$

using $1/\cos^2\delta = 1 + \tan^2\delta$. In the bracket, $b^2$ is the stretch and $w^2/12$ the smear. The smear dominates as soon as $w > \sqrt{12}\,b \approx 3.5\,b$. That is the usual case, since a band is made wide to average the noise.

**Where the edge lies** does not move. The shifts $s_r$ are symmetric about $r = 0$, so the smeared edge keeps its centre at $s = 0$, and the distance between two parallel edges is only stretched.

For a band 20 view units wide across an edge of $b = 2$:

| $\delta$ | 2° | 5° | 10° | 15° |
|:--|:--|:--|:--|:--|
| stretch, $\sec\delta - 1$ | 0.06 % | 0.38 % | 1.54 % | 3.53 % |
| spread of the crossings, $w\tan\delta$ | 0.70 | 1.75 | 3.53 | 5.36 |
| edge width, $b_\delta/b - 1$ (P6) | 0.6 % | 3.5 % | 13.6 % | 29.2 % |

A profile drawn 5° off square thus finds the distance between two parallel edges 0.4 % too long, but each edge 3.5 % wider than it is. At 10° off, each edge is 14 % wider. Squaring removes both, down to the error of the direction it finds. That error is a few degrees for the image's edge at a moderate signal-to-noise ratio, and far less for a contour (below). A residual of 1.4° widens the edge above by 0.3 %, and one of 3° by 1.3 %.

**The normal as seen (P7).** "Square" is meant in the view. There the band is a rectangle (P1). The measurement frame is the view scaled, $A = cV$ (6.1), so a right angle in the view is a right angle in micrometres.

The edge map, however, is computed on the stored grid (2.7): its gradient $g = \nabla_u I$ is the derivative of the grey value with respect to stored coordinates. In the view, where $q = Vu$ up to a shift, the same image is $\tilde I(q) = I(V^{-1}q)$. By the chain rule,

$$\frac{\partial\tilde I}{\partial q_i} = \sum_k \frac{\partial I}{\partial u_k}\,\frac{\partial u_k}{\partial q_i} = \sum_k g_k\,(V^{-1})_{ki}, \qquad\text{that is,}\qquad \nabla_q\tilde I = V^{-T}g. \qquad \text{(P7)}$$

The same follows from what a gradient is: the linear form that gives the change $dI = g\cdot du$ of the grey value over a small step $du$. A stored step $du$ is the view step $dq = V\,du$, so

$$dI = g\cdot V^{-1}dq = (V^{-T}g)\cdot dq.$$

Steps map with $V$ and gradients with $V^{-T}$: $g$ is a covector, not a vector. Along an edge the grey value is constant, so the view's gradient is normal to the edge as seen. Its direction $V^{-T}g/|V^{-T}g|$ is therefore the edge's normal in the view, and a profile square to the edge runs, in stored coordinates, along

$$d \;\parallel\; V^{-1}\,V^{-T}g = (V^TV)^{-1}g.$$

**The mistake this avoids.** Taking $d$ along $g$ itself, as a vector, is right only when $V^TV$ is a multiple of the identity: square pixels and no tilt correction, at any rotation. Otherwise, take $V = \mathrm{diag}(1, k)$: a correction $k$ across a horizontal tilt axis, with square pixels (the mirror $F$ changes no angle).

- An edge whose normal makes the angle $\psi$ with $x$ in the view has $g \parallel V^T\hat n = (\cos\psi,\ k\sin\psi)$.
- $d \parallel g$ is then seen along $Vg = (\cos\psi,\ k^2\sin\psi)$, at the angle $\arctan(k^2\tan\psi)$.

With $T = \tan\psi$, the error is $\varepsilon = \arctan(k^2 T) - \arctan T$. It is largest where

$$\frac{d\varepsilon}{dT} = \frac{k^2}{1 + k^4T^2} - \frac{1}{1 + T^2} = 0 \;\Longleftrightarrow\; k^2(1 + T^2) = 1 + k^4T^2 \;\Longleftrightarrow\; (k^2 - 1)(1 - k^2T^2) = 0,$$

that is, at $T = 1/k$, where

$$\varepsilon_{\max} = \arctan k - \arctan\frac1k.$$

For a general $V = U\Sigma W^T$ (singular value decomposition), $d \parallel g$ is seen along $VV^T\hat n = U\Sigma^2U^T\hat n$. Measured in the axes of $U$, which turns or mirrors and keeps angles, this is the diagonal case with $k$ the ratio $s_1/s_2$ of the two singular values.

| $k = s_1/s_2$ | 1.269 (cross-section at 52°) | 1.624 (tilted surface at 52°) | 1.761 (the tests' frame) | 2 |
|:--|:--|:--|:--|:--|
| $\varepsilon_{\max}$ | 13.5° | 26.8° | 30.8° | 36.9° |
| a width too long by $\sec\varepsilon_{\max} - 1$ | 2.85 % | 12.0 % | 16.4 % | 25.0 % |

The tests' frame has 2 × 3 nm pixels, a 52° cross-section, the tilt axis at 30° and a turn of −20°. There, the stored grid's own normal, taken as a direction, is 30.6° off for an edge whose view normal is at 25°. The normal found as in (P7) is within 0.1°.

**The structure tensor (P8).** The direction comes not from $g$ at one point but from the gradients over a window about the point $p$ where the profile crosses the edge:

$$J = \sum_i w_i\,g_i\,g_i^T, \qquad w_i = \exp\!\left(-\frac{|u_i - p|^2}{2\rho^2}\right), \qquad \rho = 2\sigma. \qquad \text{(P8)}$$

The sum runs over the stored pixels $u_i$ within $\lceil 3\rho\rceil$ of $p$ in $x$ and in $y$, above the info bar; weights beyond $3\rho$ would be below $e^{-4.5} = 1.1\,\%$. This is the structure tensor of image analysis. It was found independently in several settings, among them:

- the precision of a point located from the gradients in a window (Förstner and Gülch 1987);
- the orientation of a neighbourhood, fitted by least squares (Bigün and Granlund 1987; Bigün, Granlund and Wiklund 1991);
- the flow of oriented patterns (Kass and Witkin 1985, 1987).

The full references are at the end of this section. Its three numbers are sums over the edge map already computed:

$$J_{11} = \sum_i w_i\,g_{x,i}^2, \qquad J_{12} = \sum_i w_i\,g_{x,i}\,g_{y,i}, \qquad J_{22} = \sum_i w_i\,g_{y,i}^2.$$

The window is a disc in stored pixels, like the smoothing $\sigma$: its job is to gather independent samples of the noise, which are the stored pixels (2.7). In the view it is an ellipse. On a straight edge every gradient has the same direction, so the window's shape does not bias the result.

**Its eigenvectors.** For a unit vector $e = (\cos\theta, \sin\theta)$,

$$e^TJe = \sum_i w_i\,(g_i\cdot e)^2,$$

the weighted sum of the squared derivatives of the image along $e$. By the double-angle formulas,

$$e^TJe = J_{11}\cos^2\theta + 2J_{12}\sin\theta\cos\theta + J_{22}\sin^2\theta = \frac{J_{11}+J_{22}}{2} + \frac{J_{11}-J_{22}}{2}\cos 2\theta + J_{12}\sin 2\theta.$$

Write $\frac{J_{11}-J_{22}}{2} = \Delta\cos 2\theta_0$ and $J_{12} = \Delta\sin 2\theta_0$, with $\Delta = \sqrt{\big(\frac{J_{11}-J_{22}}{2}\big)^2 + J_{12}^2}$. Then

$$e^TJe = \frac{J_{11}+J_{22}}{2} + \Delta\cos(2\theta - 2\theta_0).$$

- It is largest, $\lambda_1 = \frac{J_{11}+J_{22}}{2} + \Delta$, at $\theta = \theta_0 = \tfrac12\operatorname{atan2}(2J_{12},\ J_{11} - J_{22})$.
- It is smallest, $\lambda_2 = \frac{J_{11}+J_{22}}{2} - \Delta$, at $\theta_0 + 90°$.

The extremes of $e^TJe$ over unit vectors are the eigenvalues of $J$, and they are reached at its eigenvectors. So these are the eigenvalues and eigenvectors. The edge's normal on the stored grid is $e_1 = (\cos\theta_0, \sin\theta_0)$. Its sign is undefined; the turn (P11) settles it.

**A least-squares fit.** Take any unit $e$ and the unit $e_\perp$ normal to it. Then $|g_i|^2 = (g_i\cdot e)^2 + (g_i\cdot e_\perp)^2$, so

$$\sum_i w_i\,(g_i\cdot e)^2 = \sum_i w_i\,|g_i|^2 - \sum_i w_i\,(g_i\cdot e_\perp)^2.$$

The $e$ that maximises the left side therefore minimises $\sum_i w_i\,(g_i\cdot e_\perp)^2$. The edge's tangent $e_\perp$ is thus the direction along which the image changes least, in the weighted mean square over the window: the least-squares fit of a straight edge to the gradients. Bigün and Granlund (1987) reach the same eigenvalue problem from the Fourier side. They fit, by least squares, a line through the origin to the neighbourhood's spectral energy $|\hat f|^2$. By Parseval's relation, the moments $\int \omega_i\omega_j|\hat f|^2$ of that energy are the sums of the gradient products $\int \partial_if\,\partial_jf$, up to a factor $4\pi^2$. On a noise-free straight edge:

- every $g_i$ is normal to the edge;
- the derivative along the tangent vanishes at every pixel, so $\lambda_2 = 0$;
- the fit is exact, whatever the weights.

**Solved on the stored grid, carried to the view.** By (P7), the view's tensor is

$$J_q = \sum_i w_i\,(V^{-T}g_i)(V^{-T}g_i)^T = V^{-T}JV^{-1}.$$

On a noise-free straight edge, $J = S\,e_1e_1^T$ has rank one. So does $J_q = S\,(V^{-T}e_1)(V^{-T}e_1)^T$, whose eigenvector is $V^{-T}e_1$, and the two agree. With noise they do not, and the stored grid is the right place.

There, the gradient's noise $\nu$ has two components of one variance $s_g^2$ and no covariance (2.3), so its mean outer product is $s_g^2 I$. Take an edge whose noise-free gradients are $G_ie_1$. The cross terms $G_i(e_1\nu_i^T + \nu_ie_1^T)$ average to zero, and

$$\langle J\rangle = S\,e_1e_1^T + N\,I, \qquad S = \sum_i w_iG_i^2, \qquad N = s_g^2\sum_i w_i.$$

$N I$ adds the same to $e^TJe$ in every direction and moves neither eigenvector. On average, the stored tensor thus points exactly along $e_1$.

In the view, the same noise becomes $N\,V^{-T}V^{-1} = N\,(VV^T)^{-1}$. It favours the direction in which $V$ stretches least. To see by how much, describe a symmetric matrix $Q$ by the complex number

$$z(Q) = Q_{11} - Q_{22} + 2\mathrm i\,Q_{12},$$

which is linear in $Q$, and whose argument is twice the angle of $Q$'s first eigenvector (the formula for $\theta_0$ above). For a unit vector $e$ at the angle $\psi$, $z(e\,e^T) = e^{2\mathrm i\psi}$, and $z(I) = 0$.

Let $s_1 \ge s_2$ be the singular values of $V$. $V$ maps a unit circle onto an ellipse with the semi-axes $s_1$ and $s_2$. Let $\hat m$, at the angle $\mu$, be the direction of the short axis, and $\hat m^\perp$ that of the long one. These are the eigenvectors of $VV^T$, with the eigenvalues $s_2^2$ and $s_1^2$, so

$$(VV^T)^{-1} = s_1^{-2}\,\hat m^\perp\hat m^{\perp T} + s_2^{-2}\,\hat m\,\hat m^T.$$

Since $e^{2\mathrm i(\mu + 90°)} = -e^{2\mathrm i\mu}$,

$$z\big(\langle J_q\rangle\big) = S_q\,e^{2\mathrm i\psi} + N\,\big(s_2^{-2} - s_1^{-2}\big)\,e^{2\mathrm i\mu},$$

with $S_q = S\,|V^{-T}e_1|^2$ and $\psi$ the angle of the true normal $V^{-T}e_1$ in the view. Half its argument is

$$\psi + \tfrac12\arg\Big(1 + \epsilon\,e^{2\mathrm i(\mu - \psi)}\Big) \approx \psi + \frac{\epsilon}{2}\,\sin 2(\mu - \psi), \qquad \epsilon = \frac{N}{S_q}\,\big(s_2^{-2} - s_1^{-2}\big).$$

On average, the view's eigenvector is thus turned towards $\hat m$ by up to $\epsilon/2$ radians, first order in the noise. The app therefore finds $e_1$, and the coherence (P9), on the stored grid. It carries only the normal to the view, as the covector $V^{-T}e_1$ of (P7).

The tests check that $\langle J\rangle$ gives $V^{-T}e_1$ to $10^{-13}$ degrees, in every direction, in a frame that stretches 3 times. The view's tensor would be up to 23.6° off there, for $S = 10N$. The table below compares the two on noisy steps of SNR 5.66 (2.2), with $b = \sigma = 2$, $\rho = 4$ and 1200 images of every direction per frame. Each cell gives:

- the largest mean error over a 15° range of directions (the bias);
- the RMS error;
- the share refused, with a coherence below 0.5 (P9).

| Frame | $s_1/s_2$ | the view's tensor | the stored grid's tensor |
|:--|:--|:--|:--|
| the tests' frame | 1.76 | 2.9°, 4.1°, 6.8 % | 0.35°, 3.6°, 0.3 % |
| stretched 2 times | 2 | 3.7°, 4.9°, 14.5 % | 0.9°, 4.0°, 0.1 % |
| stretched 3 times, axis 15°, turned 10° | 3 | 9.3°, 9.6°, 37 % | 1.0°, 5.2°, 0.2 % |

The stored grid's bias is within the scatter of such means, about 0.5°. In the view, the coherence of good edges also drops.

**Why not the gradient itself.** There are four reasons.

1. **One gradient is as noisy as $1/\mathrm{SNR}$.** At a point of the edge, $g = G\,e_1 + \nu$: the edge's gradient $G$ (E3) plus the noise. The noise's component along the edge, $\nu_\perp$, turns $g$ by $\delta\theta \approx \nu_\perp/G$. By (E4), its standard deviation is

   $$\frac{s_g}{G} = \frac{1}{\mathrm{SNR}}\ \text{radians}.$$

   That is 4.1° at an SNR of 14.1 and 10.1° at 5.66. An edge that just passes the snapping threshold has $G = 3 \times 1.18\,s_g$ (2.3), an SNR of 3.54, and scatters by 16°. That is as large as the tilt to be corrected.

2. **The tensor weights each pixel by what it knows.** Linearise the angle in the noise. In the frame of $e_1$, $g_i = (G_i + \nu_{\parallel,i},\ \nu_{\perp,i})$. To first order in $\nu$,

   $$J_{12} \approx \sum_i w_iG_i\,\nu_{\perp,i}, \qquad J_{11} - J_{22} \approx \sum_i w_iG_i^2.$$

   For small angles, $\theta_0 = \tfrac12\operatorname{atan2}(2J_{12},\ J_{11} - J_{22}) \approx J_{12}/(J_{11} - J_{22})$, so

   $$\theta_0 \approx \frac{\sum_i w_iG_i^2\,(\nu_{\perp,i}/G_i)}{\sum_i w_iG_i^2}.$$

   Each pixel's own estimate of the angle, $\nu_{\perp,i}/G_i$, has the variance $s_g^2/G_i^2$. The tensor averages these estimates with the weights $w_iG_i^2$: inverse-variance weights, the least-variance way to combine independent estimates, here tapered by the window. Pixels off the edge, whose gradient is mostly noise of any direction, count for little; pixels on it count most. Neighbouring gradients are correlated by the smoothing, so this is a guide to the weights, not the exact variance; the table below measures the variance. Förstner and Gülch (1987, eq. 7b) weight each pixel's edge line by $|\nabla g|^2$ for the same reason: with the grey-value noise $\sigma_n$, the line's position has the standard deviation $\sigma_n/|\nabla g|$. The alternatives weight worse:
   - summing the vectors $g_i$ weights each pixel's angle by $G_i$;
   - averaging the unit vectors $g_i/|g_i|$ weights it by 1, so the background's random directions enter at full weight.

3. **Opposite gradients add.** $(-g)(-g)^T = g\,g^T$. A bright line (2.8), or a dark one, has two flanks whose gradients point opposite ways along the same normal. Summed as vectors, they cancel; summed as $g\,g^T$, they add. In the complex form above, with $g = |g|(\cos\phi, \sin\phi)$,

   $$g_x^2 - g_y^2 = |g|^2\cos 2\phi, \qquad 2g_xg_y = |g|^2\sin 2\phi, \qquad\text{so}\qquad \theta_0 = \tfrac12\arg\sum_i w_i\,(g_{x,i} + \mathrm i\,g_{y,i})^2.$$

   The tensor adds the gradients squared as complex numbers: their lengths are squared and their angles doubled, so that $\phi$ and $\phi + 180°$ fall together. Kass and Witkin (1985) estimate the flow direction exactly so: they square the gradients as complex numbers, sum them over a weighted neighbourhood, and halve the angle of the sum. Bigün and Granlund (1987) compute their orientation the same way, with a Gaussian window. Averaging the angles $\phi$ themselves fails twice:
   - across the cut at ±180°, where 179° and −179° average to 0°;
   - between the two senses of one edge, where 0° and 180° average to 90°, the edge's tangent.

   On a bright line, with the window centred on it, the tests find the gradient vectors summing to 1.0 % of their lengths, a direction left to the noise. The tensor's direction is within 0.1°.

4. **It tells whether there is one direction (P9).** One gradient, or any average of gradients, always gives a direction, at a corner, at a junction and in noise alike. The tensor's two eigenvalues tell whether one direction dominates.

**Measured.** Each row of the table below uses 300 synthetic images:

- white noise of unit standard deviation;
- edges of every direction, at random sub-pixel places, in the plain view;
- $\sigma = 2$ without the median, and $\rho = 4$;
- the strongest point along a line square to the edge, found as the app finds it (below).

The table gives the RMS of the angle between the normal found and the true one, in degrees. "SNR" is that of the edge's crest (E4); for a line of amplitude $A$ and standard deviation $a$ it is $\frac{A}{s}\cdot\frac{a\,e^{-1/2}}{a^2 + \sigma^2}\cdot 2\sqrt{2\pi}\,\sigma^2$, from the derivative of the smoothed line at its flank. $1/\mathrm{SNR}$ is given in degrees.

| Edge | SNR | $1/\mathrm{SNR}$ | one gradient | unit vectors averaged | gradient vectors summed | tensor (P8) |
|:--|:--|:--|:--|:--|:--|:--|
| step of 5, $b = 2$ | 14.1 | 4.05 | 4.16 | 2.47 | 1.51 | 1.36 |
| step of 2, $b = 2$ | 5.66 | 10.1 | 10.2 | 4.74 | 3.53 | 3.24 |
| step of 1.25, $b = 2$ | 3.54 | 16.2 | 18.7 | 12.2 | 11.8 | 11.4; 5.1 for the 69 % kept |
| bright line of 5, std 0.7 px | 9.5 | 6.0 | 5.61 | 15.0 | 7.50 | 1.42 |
| bright line of 5, std 1.5 px | 14.6 | 3.9 | 3.78 | 7.38 | 3.59 | 1.01 |
| bright line of 5, std 3 px | 14.0 | 4.1 | 3.81 | 3.57 | 2.04 | 1.11 |
| bright line of 5, std 6 px | 9.1 | 6.3 | 5.78 | 2.40 | 1.82 | 1.65 |

What it shows:

- One gradient scatters by $1/\mathrm{SNR}$, as derived. Near the threshold it scatters somewhat more, since the angles are no longer small.
- On a step, the tensor is three times better than one gradient. The vector sum comes within 10 % of it, since all the gradients point one way. Unit vectors are 1.5–1.8 times worse.
- On lines narrower than the window, the vector sum is 2–5 times worse than the tensor, and unit vectors up to 10 times: the far flank's gradients cancel the near flank's. Lines wider than the window (std 6 px, flanks 12.6 px apart) behave like steps.
- At the threshold, the coherence refuses 31 % of the steps, and those it keeps are within 5.1°.
- With the default 3 × 3 median, the steps of SNR 14.1 and 5.66 give 1.23° and 3.69°.

The tests repeat the second and fourth rows, on 100 images each.

**The window.** $\rho$ sets what the tensor sees.

- **Precision** grows with $\rho$, as more of the edge enters, with a longer lever. At SNR 5.66, the tensor scatters by 6.0° for $\rho = \sigma$, 3.2° for $\rho = 2\sigma$ and 1.65° for $\rho = 4\sigma$: about as $1/\rho$.
- **The coherence of a good edge falls** with $\rho$, because the window takes in more background, whose noise adds equally to both eigenvalues. At SNR 5.66, its median is 0.90, 0.79 and 0.64 for the same three windows, and the last refuses 3.7 % of the steps.
- **Reach.** The window must lie on the straight part of the edge, clear of other edges. Its weights exceed $e^{-2} = 0.14$ out to $2\rho$, 8 px at the default $\sigma = 2$, and it reaches $3\rho$, 12 px: the default snap radius.
- **Curvature.** On an edge curving with the radius $R$, the normal turns by $s/R$ at the distance $s$ along it. Weighted along the edge by a Gaussian of standard deviation $\rho$, the doubled angles average to $\langle e^{2\mathrm i s/R}\rangle = e^{-2\rho^2/R^2}$, the Gaussian's characteristic function at $2/R$. Two things follow:
  - the direction is not turned on average, since the window is symmetric about the crossing;
  - the coherence drops to about $e^{-4\rho^2/R^2}$, which is 0.5 at $R = 2\rho/\sqrt{\ln 2} = 2.4\rho$, 9.6 px.

  On nearly noise-free discs (SNR 141) of radius 8, 12 and 20 px, the coherence was 0.30, 0.62 and 0.85, against 0.37, 0.64 and 0.85 from the formula, and the direction was within 0.25°. Edges curved more tightly than about 10 px are refused.

$\rho = 2\sigma$ balances these.

**The coherence (P9).**

$$C = \left(\frac{\lambda_1 - \lambda_2}{\lambda_1 + \lambda_2}\right)^2 = \left(\frac{2\Delta}{J_{11} + J_{22}}\right)^2 = \frac{(J_{11} - J_{22})^2 + 4J_{12}^2}{(J_{11} + J_{22})^2}, \qquad \text{(P9)}$$

since $\lambda_1 - \lambda_2 = 2\Delta$ and $\lambda_1 + \lambda_2 = J_{11} + J_{22}$, the trace. In the complex form, with $z_i = g_{x,i} + \mathrm i\,g_{y,i}$,

$$\sqrt C = \frac{\big|\sum_i w_iz_i^2\big|}{\sum_i w_i|z_i|^2}:$$

the length of the mean of the doubled-angle unit vectors, weighted by $|g_i|^2$. It is 1 when all the gradients lie along one line, and near 0 when they spread over all directions. The measure has precedents:

- **Bigün and Granlund (1987)** give the certainty $\big((\lambda_1 - \lambda_0)/(\lambda_1 + \lambda_0)\big)^c$, with an exponent $c$ that sets its dynamic range. Their $\lambda_1 \ge \lambda_0$ are the eigenvalues of the inertia matrix of the spectrum, $\operatorname{tr}(M)\,I - M$, where $M$ is the moment matrix of the spectral energy. Their implementation computes $M$, like $J$, from gradient products averaged over a Gaussian window. In two dimensions $\operatorname{tr}(M)\,I - M$ has the eigenvalues $\operatorname{tr}M - m_1 = m_2$ and $\operatorname{tr}M - m_2 = m_1$, those of $M$ itself, so $C$ is their certainty with $c = 2$.
- **Förstner and Gülch (1987, eq. 15)** measure the roundness of the error ellipse of a located point by $q = 1 - \big[(\mu_1 - \mu_2)/(\mu_1 + \mu_2)\big]^2 = 4\det N/(\operatorname{tr}N)^2$. Their $N$ is the sum of the gradient products over the window: $J$ with equal weights. With the same window, $C = 1 - q$; $q = 0$ marks "an ideal edge".
- **Rao and Schunck (1991)** call such a measure of the degree of anisotropy the coherence.

Below $C = 0.5$ the profile stays as drawn, with the reason. What 0.5 means:

- **A straight edge in noise.** From $\langle J\rangle$ above, $\lambda_1 \approx S + N$ and $\lambda_2 \approx N$, so $C \approx \big(S/(S + 2N)\big)^2$. It equals 0.5 at $S/N = 2/(\sqrt2 - 1) = 4.83$.

  For an edge through the window's centre, with the profile $G(x) = G_0\,e^{-x^2/(2\beta^2)}$ across it and $\beta = \sqrt{b^2 + \sigma^2}$ (E3), the sums along the edge cancel in the ratio, and across it

  $$\frac SN = \frac{G_0^2}{s_g^2}\cdot\frac{\int e^{-x^2/(2\rho^2)}\,e^{-x^2/\beta^2}\,dx}{\int e^{-x^2/(2\rho^2)}\,dx} = \frac{\mathrm{SNR}^2}{\sqrt{1 + 2\rho^2/\beta^2}}.$$

  With $b = \sigma = 2$ and $\rho = 4$, the root is $\sqrt5$. This predicts median coherences of 0.96, 0.77 and 0.54 at SNR 14.1, 5.66 and 3.54; the measured ones were 0.96, 0.79 and 0.56. An edge that just passes the snapping threshold thus has a coherence near 0.5; 31 % of such edges were refused. The coherence refuses straight edges about where snapping does.
- **Two edges.** Take edges with the normals $e$ and $e'$ at the angle $\alpha$, and weights $S$ and $S'$. Then $z(J) = S\,e^{2\mathrm i\psi} + S'\,e^{2\mathrm i(\psi + \alpha)}$.
  - With equal weights, $|z| = 2S|\cos\alpha|$ against a trace of $2S$, so $C = \cos^2\alpha$. A right-angled corner gives 0; the tests' corner gives 0.31.
  - At a right angle with $S \ge S'$, $C = \big((S - S')/(S + S')\big)^2$. It reaches 0.5 only when one edge outweighs the other by $S/S' = 5.8$.

**A traced contour's normal (P10).** When the profile crosses a contour, the segment crossed runs from $a$ to $b$, the closing segment included. It is seen along $V(b - a)$, and its normal in the view is that vector turned by +90°:

$$\hat n = \frac{\big(-(Ve)_y,\ (Ve)_x\big)}{|Ve|}, \qquad e = b - a. \qquad \text{(P10)}$$

Of the crossings (P5), the one nearest the profile's middle is taken: $|t - \tfrac12|$ least. A contour comes first for three reasons:

- it is the edge as the user traced it, so the profile measures the edge the contour does;
- its vertices were snapped one by one, each to a few hundredths of a pixel across the edge (2.6). Vertices $\ell$ apart with independent errors $\varepsilon$ across give the direction an error of about $\sqrt2\,\varepsilon/\ell$: 0.08° for $\varepsilon = 0.05$ px and $\ell = 50$ px;
- it needs neither the edge map nor a coherence.

**The turn (P11).** The profile from $u_1$ to $u_2$ turns about the crossing $p$, a point of its centre line, to run along the normal $\hat n$. Its view vector is $Vd$, of the length $L = |Vd|$, and $p$ lies at the fraction

$$t = \frac{V(p - u_1)\cdot Vd}{L^2}$$

along it. The new ends keep $L$, $t$ and the sense from $u_1$ to $u_2$:

$$u_1' = p - t\,V^{-1}(\varsigma L\hat n), \qquad u_2' = p + (1 - t)\,V^{-1}(\varsigma L\hat n), \qquad \varsigma = \operatorname{sign}(\hat n\cdot Vd). \qquad \text{(P11)}$$

Two checks:

- $u_2' - u_1' = V^{-1}(\varsigma L\hat n)$ is seen as $\varsigma L\hat n$: of the length $L$, along $\pm\hat n$.
- $u_1' + t\,(u_2' - u_1') = p$: the crossing stays at the fraction $t$.

The profile turns through $\arccos(|\hat n\cdot Vd|/L)$, between 0 and 90°, which the note shows. Why these choices:

- **The pivot on the edge** keeps the profile crossing the edge where it did, at the same distance $tL$ from its start, so the edge keeps its place in the plot. Turning about the middle could carry an edge near one end off the profile.
- **The view length** is the length the user drew and sees, and $c\,L$ is the length in micrometres (6.1). The stored length would change with the direction under a tilt correction.
- **The sense** keeps the plot from flipping: $u_1$ stays the end the plot starts from.
- **The band's width** $w$, in view units, is kept.

**Turning about the end not moved.** When an end of a profile is dragged and let go, the profile turns about its other end $a$, which stays, rather than about the crossing. This is (P11) with the pivot $p = a$: $t = 0$ when $a = u_1$, and $t = 1$ when $a = u_2$. The new ends are

$$u_1' = u_1,\quad u_2' = u_1 + V^{-1}(\varsigma L\hat n) \qquad \text{or} \qquad u_1' = u_2 - V^{-1}(\varsigma L\hat n),\quad u_2' = u_2,$$

with $L$ the view length the profile was dragged to. The normal $\hat n$ is still the edge's where the dragged line crosses it, at $c$ (P8)–(P10). The app keeps $a$ to the last bit; the rounding of $t$ near 1 would otherwise move it by about $10^{-16}L$.

Why the other end: it was placed and then left alone, so it is where the user wants it. The drag only says where the moved end should go, and turning about the crossing would move both ends.

What it costs: the crossing slides along the edge. Take the edge straight through $c$, with the unit tangent $\hat\tau \perp \hat n$. Let the profile run at the angle $\delta$ to $\hat n$, with $c$ at the view distance $s$ from $a$. In the view, with the signs of $\hat n$ and $\hat\tau$ chosen to suit,

$$c - a = s\,(\cos\delta\,\hat n + \sin\delta\,\hat\tau).$$

The turned centre line is $a + \lambda\hat n$. The edge is the set of points $x$ with $(x - c)\cdot\hat n = 0$, and the line meets it where $\lambda = (c - a)\cdot\hat n = s\cos\delta$. The new crossing is therefore

$$c' = a + s\cos\delta\,\hat n, \qquad c' - c = -s\sin\delta\,\hat\tau.$$

It slides along the edge by $s\sin\delta$, and comes nearer the end that stayed, from $s$ to $s\cos\delta$; the edge moves by $s\,(1 - \cos\delta)$ in the plot. For $\delta = 5°$ and $s = 100$ view units, that is 8.7 units along the edge and 0.38 units in the plot. At the cap, $\delta = 15°$, it is $0.26\,s$ and $0.034\,s$.

On a straight edge nothing else changes: the normal is the same all along it, so the profile is square at $c'$ too. On an edge curving with the radius $R$, the normal turns between $c$ and $c'$ by the arc over the radius. The profile is then off square at $c'$ by about

$$\delta' \approx \frac{s\sin\delta}{R},$$

0.5° for $s = 100$, $\delta = 5°$ and $R = 1000$ view units. A contour behaves alike: the profile is square to the segment it crossed, and stays so unless the crossing slides past a vertex onto the next segment. E turns about the crossing and so squares the profile exactly where it now crosses, at the price of moving both ends a little.

**The largest turn.** A new profile, or one whose end was dragged, turns by itself only when it is at most $\delta_{\max} = 15°$ off square. Further off, it stays as drawn, and the note gives the angle. E, the profile window's *Square* button and the press-and-hold menu square it whatever the angle. The cap tells apart two kinds of profile:

- **Drawn square by eye.** Such a profile is off by the error of the eye and of the two clicks, typically a few degrees and well within the cap. Two clicks 100 screen pixels apart, each placed to about 2 px across the line, alone turn it by about $\sqrt2 \times 2/100$ rad, 1.6°.
- **Drawn at an angle on purpose.** In a cross-section, a horizontal profile across a sloped sidewall at a set height is $90° - \alpha$ off square for a sidewall at $\alpha$ from the horizontal. That is 20–30° for sidewalls at 60–70°, which the cap leaves as drawn. A profile along an edge is 90° off.

A horizontal profile across a sidewall steeper than 75° is turned; Ctrl+Z gives it back as drawn. The cap limits only when squaring acts unasked, not what it can correct. A profile 15° off square already widens an edge of $b = 2$ by 29 % in a band 20 wide (P6).

**Where the image's edge is taken.** Without a contour, the edge is the strongest point along the centre line. The edge strength $|g|$ (E1) is sampled about one stored pixel apart, at $N + 1$ points as in (P2), and the largest sample at or above the snapping threshold (2.3) is taken. On a straight edge, $|g|$ depends only on the distance across it. Along any line that crosses it, square or not, the largest value therefore lies where the line crosses the crest, so the pivot does not depend on how far the line was off. The tensor is then taken there (P8). The profile stays as drawn when no sample reaches the threshold, or when the coherence is below 0.5 (P9).

**Limits.**

- A line that crosses several edges is squared to one: the contour crossing nearest its middle, or else the image's strongest edge. In a cross-section, a profile across a rib whose two sidewalls slope differently cannot be square to both. A profile meant to run across the rib at a set height stays as drawn when it is more than 15° off square to the sidewall. Nearer to square, it is turned: Ctrl+Z gives it back as drawn, and Alt+click places it so.
- On an edge curving with the radius $R$, the band is square to it only along its centre line. The band's outer lines meet the edge up to $\pm w/(2R)$ off square, and cross it at places that differ by up to $w^2/(8R)$, the sagitta. Keep $w \ll R$.
- The coherence refuses corners, junctions and edges curved more tightly than about $2.4\rho$, and the threshold refuses weak edges. Such a profile stays as drawn; with a contour traced along the edge, it is squared to the contour instead.

**Tests.** The tests check:

- the normal of a step, of a bright line and of a corner in the tests' frame, with the noise 20 % of the step;
- the normal and coherence of $\langle J\rangle$ in a frame that stretches 3 times;
- the scatter of the direction over 100 noisy images, against one gradient and a sum of gradient vectors;
- that (P11) keeps the length, the fraction, the sense and the angle turned;
- that (P11) about an end keeps that end, and that on a straight edge the crossing then slides by $s\sin\delta$ and comes to $s\cos\delta$ from it;
- that (P10) is square to its segment in the tests' frame;
- that the crossings (P5) name the segment crossed.

**References.**

- W. Förstner and E. Gülch, "A fast operator for detection and precise location of distinct points, corners and centres of circular features," *Proc. ISPRS Intercommission Conference on Fast Processing of Photogrammetric Data*, Interlaken, June 1987, pp. 281–305. [Copy at the University of Bonn](https://www.ipb.uni-bonn.de/pdfs/Forstner1987Fast.pdf).
  - The normal-equation matrix $N$ of the gradients is on p. 285.
  - The direction $\tan 2\Phi = 2N_{12}/(N_{11} - N_{22})$, eq. (13), is on p. 287.
  - The roundness $q$, eq. (15), is on p. 288. The middle form of eq. (15) is misprinted there as $\operatorname{tr}^2 N/(4\det N)$, the reciprocal of $4\det N/\operatorname{tr}^2 N$.
- J. Bigün and G. H. Granlund, "Optimal orientation detection of linear symmetry," *Proc. First International Conference on Computer Vision (ICCV)*, London, June 8–11, 1987, IEEE Computer Society Press, pp. 433–438. [Author's copy](https://www2.hh.se/staff/josef/public/publications/bigun87london.pdf).
- J. Bigün, G. H. Granlund and J. Wiklund, "Multidimensional orientation estimation with applications to texture analysis and optical flow," *IEEE Transactions on Pattern Analysis and Machine Intelligence* **13**(8), 775–790 (1991). [doi:10.1109/34.85668](https://doi.org/10.1109/34.85668).
- M. Kass and A. Witkin, "Analyzing oriented patterns," *Proc. Ninth International Joint Conference on Artificial Intelligence (IJCAI-85)*, Los Angeles, 1985, vol. 2, pp. 944–952. [PDF at ijcai.org](https://ijcai.org/Proceedings/85-2/Papers/054.pdf). The doubled-angle estimate is described on p. 945.
- M. Kass and A. Witkin, "Analyzing oriented patterns," *Computer Vision, Graphics, and Image Processing* **37**(3), 362–385 (1987). [doi:10.1016/0734-189X(87)90043-0](https://doi.org/10.1016/0734-189X(87)90043-0).
- A. R. Rao and B. G. Schunck, "Computing oriented texture fields," *CVGIP: Graphical Models and Image Processing* **53**(2), 157–185 (1991). [doi:10.1016/1049-9652(91)90059-S](https://doi.org/10.1016/1049-9652(91)90059-S).

### 6.7 Markers (P12)–(P13)

Two markers, A and B, measure a distance along a profile: from one edge to the other, say. They are placed on the plot, kept with the profile in the session, written to the profile file's header, and drawn as ticks across the band on the image.

**What a marker is (P12).** A marker is a stored point $m$, like every point the app keeps. Its place along the profile from $u_1$ to $u_2$ is the fraction of its projection onto the line in the view, the projection of (P11):

$$t_m = \min\Big(1, \max\Big(0, \frac{V(m - u_1)\cdot Vd}{L^2}\Big)\Big), \qquad L = |Vd|. \qquad \text{(P12)}$$

Its distance from $u_1$ is $s_m = t_m\,|Ad| = t_m\,cL$ (6.2), and the distance between the markers is $|t_B - t_A|\,cL$. Three reasons for this form:

- **The projection is the band's own.** In the view a point of the band is $Vu_1 + s\,\hat t + r\,n$ (P1). Its dot product with $\hat t = Vd/L$, after subtracting $Vu_1$, is $s$, because $n \perp \hat t$. So a marker anywhere in the band, on the line or off it, is read at the sample position of the band's cross-line through it.
- **A point of the image, not a fraction of the line.** When an end of the profile is dragged, or the profile is squared, a fraction $t$ would carry the marker along with the line, away from the feature it marked. A stored point stays on its feature, and its place along the new line follows from (P12).
- **Squaring keeps a marker on its edge.** Let a straight edge have the normal $\hat n$ in the view, and let the squared profile run along $\hat n$ through a point $p$ of the edge: the crossing for E, or $c'$ of *Turning about the end not moved* (6.6). For a point $m$ of the edge, $(Vm - Vp)\cdot\hat n = 0$, so $m$ projects onto the new line at $p$ itself. A marker that sat on the edge where the old profile crossed it therefore lands where the turned profile crosses the edge.

The mean at a marker is interpolated linearly between the two samples that bracket $x = t\,N$: $m(t) = m_i + (x - i)(m_{i+1} - m_i)$ with $i = \lfloor x\rfloor$. It is missing when either of the two is missing, unless $x$ falls on the other.

**Snapping to the steepest slope (P13).** The plot shows the band-averaged mean $m_i$, about one stored pixel per sample (P2). An edge in it is a rise or fall over some samples. Its position, for an edge-to-edge distance, is where it is steepest. For an edge whose profile is symmetric about its centre $c$, $f(c + u) - f_{1/2}$ odd in $u$, that is the centre itself, half way between the levels on either side. The slope is taken as the edge map takes the gradient (2.1): the mean is smoothed by a Gaussian of $\sigma$ samples and differentiated, in one filter:

$$s_i(\sigma) = \sum_{j=-K}^{K} w_j\, m_{i+j}, \qquad w_j = \frac{j\,G_j}{\sum_k k^2 G_k}, \qquad G_j = e^{-j^2/2\sigma^2}, \qquad K = \lceil 3\sigma\rceil. \qquad \text{(P13)}$$

Three properties of the filter, step by step:

- **It reads a ramp's slope exactly.** For $m_i = \alpha i + \beta$, $s_i = (\alpha i + \beta)\sum_j w_j + \alpha\sum_j j\,w_j$. The weights are odd in $j$, so $\sum_j w_j = 0$. And $\sum_j j\,w_j = \sum_j j^2 G_j / \sum_k k^2 G_k = 1$. Hence $s_i = \alpha$: the slope in grey levels per sample.
- **Its noise falls fast with $\sigma$.** White noise of standard deviation $\sigma_m$ on the samples gives $s_i$ the standard deviation $\sigma_s = \sigma_m\sqrt{\sum_j w_j^2} = \sigma_m\sqrt{\sum_j j^2 G_j^2}\,\big/\sum_j j^2 G_j$.
  - For $\sigma = 2$, $\sum_j j^2 G_j = 19.79$ and $\sum_j j^2 G_j^2 = 7.09$, so $\sigma_s = 0.135\,\sigma_m$. The central difference $(m_{i+1} - m_{i-1})/2$ has $0.707\,\sigma_m$, 5.3 times as much.
  - With the sums taken as integrals, $\sum_j j^2 G_j \approx \sqrt{2\pi}\,\sigma^3$ and $\sum_j j^2 G_j^2 \approx \tfrac{\sqrt\pi}{2}\,\sigma^3$. So $\sigma_s \approx \sigma_m\big/\big(2\pi^{1/4}\sigma^{3/2}\big)$: 0.133 for $\sigma = 2$, and as $\sigma^{-3/2}$ in general.
- **It keeps a symmetric edge's centre.** Write the response at any real position $x$, $r(x) = \sum_j w_j f(x + j)$, for an edge symmetric about $c$: $f(c - v) = 2f_{1/2} - f(c + v)$. Then $r(c - u) = \sum_j w_j f(c - u + j)$. Substitute $j \to -j$, with $w_{-j} = -w_j$: this is $-\sum_j w_j f(c - u - j) = -\sum_j w_j\big(2f_{1/2} - f(c + u + j)\big) = r(c + u)$, since $\sum_j w_j = 0$. So $r$ is symmetric about $c$, its largest magnitude lies at $c$, and smoothing at any scale moves no symmetric edge.

**Which scale.** Take an edge of height $H$ whose profile is an erf of width $\sigma_e$. Smoothed at $\sigma$, its slope is a Gaussian of width $\sigma_t = \sqrt{\sigma_e^2 + \sigma^2}$ and height $H/(\sqrt{2\pi}\,\sigma_t)$. Its height over the slope's noise is then

$$\frac{H}{\sqrt{2\pi}\,\sigma_t}\cdot\frac{2\pi^{1/4}\sigma^{3/2}}{\sigma_m} \;\propto\; \frac{\sigma^{3/2}}{\sqrt{\sigma_e^2 + \sigma^2}}.$$

It grows as $\sigma^{3/2}$ while $\sigma \ll \sigma_e$, and only as $\sigma^{1/2}$ beyond. A sharp edge stands far out of the noise at the edge map's $\sigma$. A gradual edge in a noisy image does not. In the FIB test image, with 1.35 nm pixels, the top of the rib is a fall of 9000 grey levels over some 50 samples. The more a peak stands out, the less the noise moves it, so such an edge is placed more precisely at a larger scale. A larger scale has two prices, though:

- **It merges edges.** Two edges of one sign closer than about $2\sigma_t$ make one peak, between them; a little farther apart, each pulls the other's peak towards it. Two edges of opposite sign, a bright line's flanks, push each other's peaks apart.
- **It favours gradual edges.** Once $\sigma \gg \sigma_e$, a sharp edge's peak slope falls as $1/\sigma$, while a gradual edge's hardly falls. At a coarse scale, a weak sharp edge can fall below half a strong gradual one nearby, though at the edge map's $\sigma$ the two stand out alike.

The app therefore tries five scales, $\sigma_q = \sigma\,2^{q/2}$, $q = 0, \dots, 4$: from the edge map's $\sigma$ to 4 times it, 2 to 8 samples by default. At each it takes the departure from the trend, $d_i = |s_i - \tilde s|$, and the noise $\hat\sigma_s$, both near the click (*When it snaps*, below). Then:

1. **The edge clicked** is found at the finest scale that has a candidate within the search window. A candidate is a sample where $d_i$ is
   - a peak: the largest within $2\sigma_q$, with a slope on either side (*Ends and gaps*, below);
   - at least $c\,\hat\sigma_s$, with $c$ of (P14) (*When it snaps*);
   - at least half the largest $d_i$ in the window.

   Of the candidates, the one nearest the click is taken. A click beside one flank of a bright line thus takes that flank. The half-height rule keeps out the noise's small peaks on the shoulders of an edge's slope. The finest scale that finds an edge also tells it from its neighbours best.
2. **Its extent** is the run of samples about its peak, of its sign, where $d_i$ stays within $3\hat\sigma_s$ of the peak's height. It is narrow for a peak far out of the noise, whose place is sure, and wide for one barely out of it, whose place is not.
3. **Other edges**, at a scale, are maxima of $d_i$ outside the extent that are at least $k\,\hat\sigma_s$ high. Between them and the extent, $d_i$ must dip by at least $3\hat\sigma_s$, or change sign, or be missing. A maximum on the shoulder of the edge clicked has no such dip.
4. **A coarser scale places the edge** when two things hold. Its highest peak within the extent (with one sample's margin) is at least $k\,\hat\sigma_s$ high: nothing else is searched there. And no other edge, seen at this scale or at a finer one from the edge's own on, lies within $3\sigma_q$ of that peak: where the kernel, $K = \lceil 3\sigma_q\rceil$ samples long each way, would reach it.
5. **Of the scales that place it**, the one where the peak stands highest above the noise, $d/\hat\sigma_s$, wins. This is the scale where the noise moves the peak least.

The edge's identity thus comes from the finest scale that finds it, and its place from the most reliable scale that sees it alone. Taking the most reliable scale by itself fails in both of the ways above. In the tests' cases, it fails as follows:

- **Merged steps.** Two rising steps of 40 grey levels, 10 or 14 samples apart, merge at $\sigma = 8$ into one peak between them, which then stands out best. Clicked on the first step, that rule put the marker about 5 or 7 samples off, in 200 of 200 and 199 of 200 noisy profiles. The rule above does so in none of 100; 3 and 1 of them stay where they are put.
- **A stronger neighbour.** Take a sharp step of 20 and a gradual one of 60 (width 6) 24 samples on. At $\sigma = 8$ the sharp step falls below half the other, which is then the only candidate and the most reliable. A long profile on a narrow plot has a window of 24 or 60 samples. Clicked on the sharp step with such a window, that rule took the other step in 194 and 200 of 200 profiles; the rule above, in none.

Choosing an edge's scale from the data is an old idea, and two published rules were tried against this one:

- **Lindeberg (1998)** takes the scale where $\sigma^{1/2}|s|$, the slope normalised by the scale, is largest; for a noise-free erf edge that is $\sigma = \sigma_e$. In noise, though, the noise's own $\sigma^{1/2}\sigma_s$ falls as $\sigma^{-1}$, so the finest scale's noise wins as often as the edge does. In the tests, that rule put a gradual edge up to 11 samples off.
- **Elder and Zucker (1998)** take the smallest scale at which the slope is reliably above the noise. That keeps neighbouring edges apart, but it places a gradual edge at a scale where its peak is barely reliable. In the tests it was 1.3 to 1.9 samples off at the median, against 0.4 to 0.9 here.

The rule above finds the edge as Elder and Zucker do, at the smallest scale that finds it, and places it at the most reliable scale that sees it alone.

**Between samples.** At the chosen scale the peak $i^*$ is placed between samples by the vertex of the parabola through $(-1, a)$, $(0, b)$, $(1, c)$, with $a, b, c = d_{i^*-1}, d_{i^*}, d_{i^*+1}$. Write it $y(u) = \kappa u^2 + \beta u + b$. Then $a = \kappa - \beta + b$ and $c = \kappa + \beta + b$ give $\kappa = (a - 2b + c)/2$ and $\beta = (c - a)/2$, and the vertex lies at

$$u^* = -\frac{\beta}{2\kappa} = \frac{a - c}{2\,(a - 2b + c)},$$

held to $\pm\tfrac12$. The parabola only approximates the peak: for a Gaussian peak it is biased towards the nearest sample. For $\sigma_t = 2.5$ and a peak 0.3 samples from $i^*$, the vertex is at 0.292, 0.008 samples short; the nearly clean test measures 0.001.

**How well it is placed.** The vertex moves with the noise at the peak's two neighbours. Write $n_-$, $n_+$ for the noise in $a$ and $c$. At a symmetric peak $a - c = 0$, so to first order $u^*$ moves by $(n_- - n_+)/(2\,(a - 2b + c))$. Its standard deviation is

$$\delta u = \frac{\hat\sigma_\Delta}{2\,|d''|},$$

where $\hat\sigma_\Delta$ is the noise of $s_{i+1} - s_{i-1}$ near the click, the scaled median absolute deviation as for $\hat\sigma_s$, and $d''$ is the peak's second derivative.

The three samples' curvature $a - 2b + c$ is too noisy for $d''$. At the finest scale, a peak barely out of the noise has the sharp curvature of the noise that made it, and $\delta u$ came out small where the place was poor. A fixed window of a few samples fails in the same way on a flat top.

$d''$ is therefore the second derivative of the least-squares parabola through the peak's own run. The run is the samples about the peak, of its sign, whose $d$ stays within $3\hat\sigma_s$ of the peak's height, and at least its two neighbours. A narrow peak far out of the noise has a short run. A flat top has a long one, which the parabola follows as flat, so that $d''$ is small and $\delta u$ large. With $x = i - i^*$, the parabola $y = b_0 + b_1 x + b_2 x^2$ solves the normal equations

$$\begin{pmatrix} S_0 & S_1 & S_2 \\ S_1 & S_2 & S_3 \\ S_2 & S_3 & S_4 \end{pmatrix}\begin{pmatrix} b_0 \\ b_1 \\ b_2 \end{pmatrix} = \begin{pmatrix} T_0 \\ T_1 \\ T_2 \end{pmatrix}, \qquad S_m = \sum_x x^m, \qquad T_m = \sum_x x^m\,d_{i^*+x},$$

over the run. Cramer's rule gives $b_2$, and $d'' = 2b_2$.

The error was compared with $\delta u$ on 300 noisy erf edges for each of seven cases: widths 1.5 to 15 samples, noise 2 to 20 % of the step. It was within $\delta u$ for 60 to 74 % of the edges, and within $2\delta u$ for 92 to 94 %, as a standard deviation should be (68 and 95 %). The gate holds back the badly placed: in the two gradual cases with noise of 5 and 10 %, the edges it held back were 5.6 and 3.9 samples off in rms, against 0.9 and 1.5 for all.

A marker snaps only when the winning scale places it to $\delta u \le \max(2, 2N/W)$ samples: 2 samples, or 2 pixels of the plot, whichever is more, about what a click is good to. Otherwise the slope places it no better than the click, and it stays where it was put. A ramp of nearly constant slope has no steepest point: its peak of $d$ is flat, $d''$ is near 0 and $\delta u$ is large.

**Where it searches.** Within 12 pixels of the plot around the click or the release: $R = \max(2, 12N/W)$ samples, the plot being $W$ pixels wide for $N$ samples. A click is good to a few pixels, and the window takes in the edge clicked near. A long profile on a narrow plot has a wide window: about 68 samples for 3001 samples on a plot 528 pixels wide.

**When it snaps.** A marker clicked on a flat stretch should stay where it was put, not jump to a peak of the noise. At each scale take the median slope $\tilde s$, the profile's trend (0 when flat), and the slope's noise as the scaled median absolute deviation

$$\hat\sigma_s = 1.4826\ \operatorname{median}_i |s_i - \tilde s|.$$

For normal noise the median of $|z|$ is $0.6745$ standard deviations, and $1.4826 = 1/0.6745$. Being a median, $\hat\sigma_s$ is unmoved by the few samples on edges, up to half of them.

Both are taken near the click: over the slopes within $\max(60, 4R, 15\sigma_q)$ samples of it, leaving out those whose kernel lies on a stretch where the mean is exactly constant. With fewer than 20 slopes left, the scale is not used. Taken over the whole profile, they fail in two ways:

- **Clipped stretches.** A stretch clipped to black or white has slopes of exactly 0. On a profile more than half clipped they make $\hat\sigma_s = 0$, any peak a candidate, and its height over the noise infinite. On a profile 62 % at 0, all 26 clicks on the noise of the rest snapped. Such stretches tell nothing of the noise, and are left out; now none of the 26 snaps.
- **Noise that changes along the profile.** In secondary-electron images the noise grows with the signal. A profile mostly through a dark, quiet region gets $\hat\sigma_s$ from that region, too low for a brighter part. On a profile 62 % with a quarter of the rest's noise, all 26 clicks on the noise of the rest snapped. Near the click, none does.

**Edges in the span.** A strong edge near the click fills a good part of the span with large slopes, and a median absolute deviation gives way to them well before they are half the samples. Beside a gradual step of 60 grey levels, a sharp step of 20 read 3.1 to 4.0 times the noise so measured, where the noise of the background makes it 8. So the noise is measured again, up to three times, without the slopes that stand 4 noise widths out of the last estimate and those within $2\sigma_q$ of them, until no more stand out. The threshold of this clipping is 4, not 3. Noise alone reaches 4 so rarely that its estimate stays: the second is 0.993 to 0.998 of the first on average, and the same in 19 windows of 20. A threshold of 3 cuts the noise's own excursions out instead. That lowers the estimate by 10 to 23 % in one window of 20, just where an excursion stands, and makes it a candidate.

**The threshold of a search (P14).** In noise alone a slope exceeds $k$ standard deviations with the probability $\operatorname{erfc}(k/\sqrt2)$, 0.27 % for the default $k = 3$. A click, though, searches its window at five scales: about $(2R+1)/\sigma_q$ independent slopes at each, the slope being correlated over about $\sigma_q$. With $k$ alone, 32 of 237 clicks on pure noise snapped with a window of 12 samples, and 90 of 237 with a window of 60. As for the image (E9), the threshold is raised until the search as a whole is fooled about as rarely as one sample at $k$. For large $c$, $\operatorname{erfc}(c/\sqrt2) \approx \sqrt{2/\pi}\,e^{-c^2/2}/c$, so with

$$c = \sqrt{k^2 + 2\ln N}, \qquad N = \max\Big(1, \sum_q \frac{2R+1}{\sigma_q}\Big) \qquad \text{(P14)}$$

the chance is $N\operatorname{erfc}(c/\sqrt2) \approx N\sqrt{2/\pi}\,e^{-k^2/2}/(Nc) = (k/c)\operatorname{erfc}(k/\sqrt2)$: a little less than one sample's at $k$. The sum runs over the scales that have a noise level. With σ = 2 and $k = 3$, $c$ is 3.6 for a window of 2 samples, 3.9 for 8, 4.0 for 12 and 4.4 for 68. It applies to finding the edge clicked. Once that is found, the coarser scales place it with peaks $k\,\hat\sigma_s$ high, within its extent, where nothing else is searched.

$N$ was measured as for (E9). On pure noise, the share of clicks whose best candidate stands $m$ noise widths out was fitted to $1 - e^{-N\operatorname{erfc}(m/\sqrt2)}$, for σ of 1 to 4 and windows of 2 to 64 samples. The fitted $N$ is 0.76 to 2.09 times the sum above, which moves $c$ by less than 0.2. Now 3 of the 237 clicks snap with a window of 12 (1.3 %), and none with a window of 60; the tests count none of 79 with either. At the small window that is still about 5 times the aim: the noise measured near the click varies from window to window, which the Gaussian tail does not count. Alt places a marker exactly. With no candidate at any scale, the marker stays where it was put.

Why not the edge map's own rule, $k$ times the median strength (2.3)? In two dimensions the strength of noise, $|\nabla|$, is Rayleigh distributed with the median $1.18\,\sigma$, so $3\times$ median is $3.5\,\sigma$. In one dimension $|s|$ is half normal with the median $0.67\,\sigma_s$, and $3\times$ median would be only $2.0\,\sigma_s$. That is exceeded by 4.3 % of the samples, and in noise alone most windows would snap. The scaled deviation gives $k$ the same meaning in one dimension: so many standard deviations of the noise.

**Ends and gaps.** No slope is taken within $K$ samples of an end or of a missing value. A peak must have a slope on either side. The first slope next to a missing one is where the slopes stop, and $d$ rising towards it is the flank of an edge out of reach, not a peak. Counting such samples pushes an edge near an end onto them. A step 20 samples from the start, clicked at 21, then goes to 24, the first slope at $\sigma = 8$, where it stands 49 times the noise out. The rule above places it at 20.09. An edge within $K + 1$ samples of an end or a gap is not snapped at that scale.

**Limits.**

- An edge whose profile is not symmetric is placed at its steepest point, at the scale chosen. That differs from a threshold crossing, for instance half way between the levels, by an amount that depends on the shape and the scale. An edge with a bright bloom on one side, as SE edges often have, is an example. Its peak moves with the scale, and coarser scales that find it outside its extent do not place it.
- Of two edges within the window, the nearer is taken, provided it reaches half the height of the stronger at the finest scale that finds one.
- The band averages the edge across its width, smeared when the profile is off square (P6). Square it first (6.6).
- Sometimes the noise hides an edge at the finest scale but leaves a peak of its own beside the click. The edge clicked is then that peak, and a coarser scale that finds the real edge outside its extent does not place it. In the tests, 1 of 40 gradual edges, with noise of 10 % of the step, was placed more than 3 samples off, at 7.0; over 200 such edges, 4 of the 194 placed.
- Two steps of one sign 10 samples apart, with noise of 15 % of each, are barely told apart at the finest scale. None of 100 clicks merged them, and 3 stayed where they were put.
- On a ramp of constant slope 60 samples long, 1 click in 10 snaps anyway, up to 12 samples from its middle. At a fine scale its plateau shows a peak of its noise, curved enough to look well placed.
- With a window of 12 samples, 1.3 % of clicks on pure noise still snap (*The threshold of a search*).
- A profile without any noise has no noise to measure a slope against, and its markers do not snap. The tests' "clean" profiles carry noise of 0.05 % of their step.

**Tests.** The tests check that:

- a point 7 view units off the line, in the tests' tilted, turned frame, is placed where it projects, at 0.37 and 0.9 along the line, and points beyond the ends are held to 0 and 1;
- the mean between samples is linear, and missing next to a missing sample;
- (P13) finds a sharp erf edge at 40.3 from 7 samples before and after it: 0.001 samples off with noise of 0.05 % of the step, 0.05 with noise of 2 %;
- over 40 noisy profiles, it places an edge of width 8, with noise of 10 % of the step, in 39, 0.63 samples off at the median, at the scale 8; the other one stays;
- it takes a bright line's nearer flank from either side, at $100 \mp \sqrt{13}$ for a line of standard deviation 3 smoothed at 2; in 200 clicks on 100 noisy lines it is at most 0.35 samples off;
- it places the two edges of a ridge 20 samples wide 0.19 and 0.21 samples off;
- of two rising steps 10, 14 or 18 samples apart, it takes the one clicked, never more than 2 samples off, in 100 noisy profiles each; 3, 1 and 1 stay;
- of a weak sharp step with a strong gradual one 24 samples on, it takes the sharp one, with windows of 12, 24 and 60 samples;
- a marker stays by a step 3 samples from the start and by one beside missing samples, while one 20 samples from the start is placed;
- on profiles 62 % clipped or quieter, clicks on the rest's noise stay; on ramps of constant slope, 5 of 50 clicks snap;
- in noise alone none of 79 windows snaps, with a window of 12 samples or of 60 (P14), and no slope is taken across a missing value;
- the session keeps the markers to $10^{-4}$ px and refuses a third, and the profile file's header gives each marker's distance and mean and the distance between them.

On the FIB test image, take the session example's profile with a band width of 5. Down through the top of the rib, the mean falls by about 9000 grey levels over some 50 samples, at a nearly constant slope:

- **Band 5.** Measured near the click, that slope stands 2.2 to 2.7 times the noise out at $\sigma$ = 2 to 5.7. At $\sigma$ = 8 it reaches 3.2 only at the window's edge, where it is no peak. Markers clicked at 103.5, 109 or 112 find no candidate and stay where they are put.
- **Band 40.** The noise falls, and clicked at 112 the slope stands 3.3 to 3.6 times it out at $\sigma$ = 4 to 8. That is short of the 3.9 that the search asks for in this window (P14), and the marker stays where it is put. With $k = 3$ alone it would be a candidate, but its peak would be placed only to about 8 samples at best, no better than the click.

Where the profile crosses the slab top's contour, no edge marks the line, and a marker clicked there stays as well.

**References.**

- T. Lindeberg, "Edge detection and ridge detection with automatic scale selection," *International Journal of Computer Vision* **30**(2), 117–156 (1998). [doi:10.1023/A:1008097225773](https://doi.org/10.1023/A:1008097225773).
- J. H. Elder and S. W. Zucker, "Local scale control for edge detection and blur estimation," *IEEE Transactions on Pattern Analysis and Machine Intelligence* **20**(7), 699–716 (1998). [doi:10.1109/34.689301](https://doi.org/10.1109/34.689301).

### 6.8 Cost

Each value takes four pixel reads and a dozen arithmetic operations. The window computes the profile again at every step of a drag:

- of the band's width handle;
- of a profile's end;
- of a contour vertex, whose crossings move with it.

**The tuned loop.** Most lines of a band lie wholly inside the image, away from its last column and from the last row above the info bar. Such a line is straight, so its two ends tell where all its samples lie. The positions $x_0 + t\,(x_1 - x_0)$ are monotonic in $t$ in floating point too, the ends being computed as in the loop. For these lines the loop skips the test for missing values and the clamps at the edges, and interpolates with the same operations in the same order. The offsets across the band are kept as flat arrays. The results are those of the plain loop, bit for bit, and the tests compare the two on bands inside the image, across its edges and the info bar, and in a tilted frame.

| Band (FEI test image, Chromium) | Values | Plain loop | Tuned loop |
|:--|:--|:--|:--|
| 3001 samples × 83 lines | 249 000 | 7.2 ms, 29 ns per value | 4.9 ms, 20 ns per value |
| 476 samples × 30 lines | 14 300 | 0.4 ms, 28 ns per value | 0.2 ms, 14 ns per value |

A profile of one line gains little. Along a slanted line, each sample reads rows of the image that no cache holds, so the time goes into memory.

**What does not pay.** Going along each line in turn, with the spread computed in one pass from values shifted by the line's first, was at most 8 % faster, and its results differ in the last bits. Flooring with `x | 0` gained 7 % on the interpolation alone, which is lost in the whole. Resizing the plot's canvas at every redraw costs nothing measurable when its size is unchanged. Pointer moves arrive at most once per displayed frame, so a refresh per move is a refresh per frame.

**The whole refresh.** With a plot of 598 × 298 CSS pixels at a device pixel ratio of 2, the window's refresh takes 0.5 ms for the band of 476 × 30 values, of which the plot is 0.08 ms. For the band of 3001 × 83 it takes 5.2 ms, of which the plot is 0.4 ms. Both are well within the 16.7 ms of a frame at 60 Hz. A band of about 450 000 values, for instance 3000 × 150, would fill a frame. Beyond that a drag would lag, and the next steps would be to sample coarsely during the drag and fully on release, or to compute in a Worker.

Squaring costs one search along the line, $N + 1$ bilinear values, and one tensor over at most $(2\lceil 6\sigma\rceil + 2)^2$ pixels, 676 at $\sigma = 2$. In Node, the tensor and its normal took about 10 µs, and a search along 300 samples about 6 µs.
