# The mathematics of the SEM measurement tool

This document derives what the app computes from an image:

- **Part 1:** the map from stored pixels to micrometres, and the measures taken through it.
- **Part 2:** the edge strength and the snapping.
- **Part 3:** what each step costs, and where the limits lie.
- **Part 4:** the GDSII export: its grid and its eight-byte reals.
- **Part 5:** the display: the info bar, the levels, brightness and contrast, and the histogram.
- **Part 6:** line profiles: the band, the samples, and the contours that cross the line.

Equation numbers match the comments in the code: (G1)–(G15) in `js/transform.js`, (G16) in `js/app.js`, (E1)–(E8) in `js/edges.js`, (C1) in `js/polygons.js`, (S1)–(S2) in `js/gds.js`, (Z1) in `js/tiff.js`, (D1)–(D4) in `js/display.js` and (P1)–(P5) in `js/profile.js`.

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

The edge strength is $|\mathbf g|$. Edges cover a small fraction of an image, so the median of $|\mathbf g|$ measures the noisy background; it is estimated on about a million evenly spread pixels.

For pure noise, $g_x$ and $g_y$ are independent Gaussians:

- their covariance $s^2\iint \partial_xG\,\partial_yG = (s^2/\sigma^4)\iint xy\,G^2$ vanishes by symmetry;
- they share one standard deviation $s_g$.

So $|\mathbf g|$ is Rayleigh distributed, $P(|\mathbf g| > r) = e^{-r^2/(2s_g^2)}$, with the median $m = s_g\sqrt{2\ln 2} = 1.18\,s_g$. A threshold of $c$ times the median is exceeded by noise with the probability

$$P = e^{-c^2 m^2/(2 s_g^2)} = e^{-c^2\ln 2} = 2^{-c^2}$$

per independent sample. That is 0.2 % at the default $c = 3$, 6 % at $c = 2$, and $1.5\times10^{-5}$ at $c = 4$.

### 2.4 Crests

Candidates for a snap are the **crest pixels** of $|\mathbf g|$: pixels where the strength is a maximum across the edge, the non-maximum suppression of Canny's detector. The unit gradient $u = \mathbf g/|\mathbf g|$ is rounded to the nearest of the 8 neighbour directions $s$. A component counts when its magnitude exceeds $\sin 22.5° = 0.383$, so that each direction covers a 45° sector. Pixel $p$ is a crest pixel when

$$|\mathbf g|(p) \ge |\mathbf g|(p + s) \quad\text{and}\quad |\mathbf g|(p) \ge |\mathbf g|(p - s).$$

It must also be at least $c$ times the median.

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
| a line profile of 3001 samples along a band of 83 lines (249 000 values) | 9 ms |
| the profile window refreshed for a profile of 476 samples × 30 lines, plot included | 1.2 ms |

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

A file exported from the app held a turned, tilt-corrected FEI trace: a polygon on layer 2/0, an open contour as a 20 nm path on 5/1, two contour names, and a ruler and an angle as annotations on 100/0. It was read back with gdstk 1.0.1 and with KLayout 0.30.12.

- Both found the cell, the three layers, one polygon, three paths and four labels, with the units above.
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

A line profile gives the grey values along a line, averaged across a band of adjustable width, and marks where contours cross the line. Like a ruler, it is kept as two stored points; its band adds one number, the width. Everything else follows from these, the measurement frame and the grey values as stored, not the display (Part 5).

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

### 6.6 Cost

Each value takes four pixel reads and a dozen arithmetic operations. In Chromium a value took about 36 ns: a profile of 3001 samples along a band of 83 lines, 249 000 values, took 9 ms. The window therefore computes the profile again at every step of a drag:

- of the band's width handle;
- of a profile's end;
- of a contour vertex, whose crossings move with it.
