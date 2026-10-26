"use strict";
/* exported EdgeMap, sortedSample, percentileOf */
/*
 * Edge strength of a noisy SEM image and snapping a point to the nearest strong edge.  MATH.md,
 * part 2, gives the same derivations with more words.
 *
 * Coordinates: pixel-centre coordinates of the image as stored, x = column and y = row, y down;
 * pixel (row i, column j) is centred at (x = j, y = i).
 *
 * Robust gradient
 * ---------------
 * SEM images carry shot noise and, at short dwell times, isolated bright or dark pixels.  A
 * difference of neighbouring pixels amplifies both, so the gradient is taken of a locally
 * averaged image, the average being a Gaussian of width sigma (pixels):
 *
 *     g = grad (G_sigma * I) = (grad G_sigma) * I,                                       (E1)
 *
 * a convolution with the derivatives of a Gaussian, done separably: smoothing along one axis with
 * G, then differentiating along the other with G' (t) = -(t / sigma^2) G(t).  The kernels are
 * those of scipy.ndimage.gaussian_filter: radius floor(4 sigma + 0.5), G normalized to sum 1,
 * edges replicated ("nearest").  A median filter of 3 x 3 or 5 x 5 pixels may come first: it
 * removes isolated outliers, which the Gaussian would only spread, and keeps steps sharp.
 *
 * What sigma gains.  For white noise of standard deviation s per pixel, the x component of (E1)
 * has the variance s^2 * sum (G')^2 ~ s^2 * integral (x^2 / sigma^4) G_sigma(x, y)^2 dx dy.  The
 * square of G_sigma = exp(-(x^2 + y^2) / (2 sigma^2)) / (2 pi sigma^2) is the normalized Gaussian
 * of width sigma / sqrt 2, exp(-(x^2 + y^2) / sigma^2) / (pi sigma^2), divided by 4 pi sigma^2;
 * its second moment in x is sigma^2 / 2.  Hence
 *
 *     var = (s^2 / sigma^4) (sigma^2 / 2) / (4 pi sigma^2) = s^2 / (8 pi sigma^4),
 *     std = s / (2 sqrt(2 pi) sigma^2).                                                  (E2)
 *
 * A step of height A, blurred by the beam to an error function of width b, becomes after the
 * smoothing an error function of width sqrt(b^2 + sigma^2) (widths of Gaussians add in
 * quadrature).  Its derivative, a Gaussian across the edge, peaks at
 *
 *     A / (sqrt(2 pi) sqrt(b^2 + sigma^2)),                                                (E3)
 *
 * so the signal-to-noise ratio of the edge, (E3) over (E2), is
 *
 *     SNR = (A / s) * 2 sigma^2 / sqrt(b^2 + sigma^2),                                     (E4)
 *
 * growing as 2 sigma^2 / b for sigma << b and as 2 sigma for sigma >> b.  The cost: edges closer
 * than about 2 sigma merge and corners round off over about sigma.
 *
 * The edge strength is |g|.  Its median over the image measures the noisy background, since
 * edges cover a small fraction of an image.  For pure noise g_x and g_y are independent Gaussians
 * of one standard deviation s_g, so |g| is Rayleigh distributed, P(|g| > r) = exp(-r^2 / (2
 * s_g^2)), with the median s_g sqrt(2 ln 2) = 1.18 s_g.  A snap target must be min_contrast times
 * stronger than the median: the default 3 is 3.53 s_g, exceeded by noise with probability
 * exp(-3.53^2 / 2) = 0.2 % per independent sample.  The median is estimated on about a million
 * evenly spread pixels.
 *
 * Snapping
 * --------
 * Candidates are the crest pixels of |g| within the search radius: pixels where |g| is a maximum
 * across the edge (non-maximum suppression, as in Canny's detector).  With u = g / |g| rounded to
 * the nearest of the 8 neighbour directions s (a component counts when its magnitude exceeds
 * sin 22.5 deg = 0.383, so that each direction covers a 45 deg sector), p is a crest pixel when
 * |g|(p) >= |g|(p + s) and |g|(p) >= |g|(p - s), and it must be min_contrast times stronger than
 * the median.  Among the candidates, the one maximizing
 *
 *     |g|(p) * exp(-d(p)^2 / (2 (radius / 2)^2)),     d(p) = distance from the click,     (E5)
 *
 * is taken: the strongest edge, with a preference for near ones (at the radius the weight is
 * exp(-2) = 0.14).
 *
 * Sub-pixel position.  Through f(-1), f(0), f(+1), the strength at the crest pixel p and at
 * p -/+ u (bilinear interpolation), the parabola f(t) = f(0) + t (f(+1) - f(-1)) / 2 + t^2
 * (f(+1) - 2 f(0) + f(-1)) / 2 has its vertex where f'(t) = 0:
 *
 *     t* = (f(-1) - f(+1)) / (2 (f(-1) - 2 f(0) + f(+1))),                                (E6)
 *
 * a maximum when the denominator is negative; the edge point is p + t* u, with t* in [-1, 1].
 * For a Gaussian crest of width w the vertex lies within 0.048 pixel of the true maximum for
 * w = 1, 0.021 for w = 1.5 and 0.012 for w = 2.
 *
 * The stored grid and the view metric
 * -----------------------------------
 * The edge map is computed on the image as stored, whatever the tilt correction, tilt axis or
 * rotation (transform.js, (G8)), for three reasons.  The noise is independent from pixel to pixel
 * of the stored image (one dwell per pixel), which is what the Rayleigh threshold above assumes;
 * after resampling it would be correlated.  The probe is round in the image plane, which the
 * stored grid samples with square pixels (as SEMs record them): its footprint on a tilted surface
 * is an ellipse stretched by 1 / cos(theta), and the projection shrinks it back by cos(theta).  An
 * isotropic Gaussian in stored pixels is
 * therefore the filter matched to the blur, and sigma is given in stored pixels.  And a straight
 * edge keeps its place under an affine map: its strength is constant along it and largest on it,
 * and the map sends the line to a line, so the crest found on the stored grid, mapped, is the
 * crest of the mapped image.  The map changes the strength by a factor that depends on the edge's
 * direction, which only reorders edges of different directions near a click.  The edge map thus
 * depends on sigma and the median filter only: a change of calibration costs nothing.
 *
 * Distances to the click are measured where the user sees them, in the corrected view: with M the
 * 2 x 2 matrix from stored pixel offsets to view units (transform.js, V of (G11)),
 *
 *     d(p) = |M (p - c)|                                                                  (E7)
 *
 * for the click c, in (E5) and in the radius test.  The disc d <= r is, in stored pixels, the
 * ellipse p = c + M^-1 z, |z| <= r.  Its extent along x is the largest e_x . M^-1 z over |z| <= r,
 * which by the Cauchy-Schwarz inequality is r times the length of the first row of M^-1; likewise
 * for y with the second row:
 *
 *     half-widths  r sqrt(B11^2 + B12^2),  r sqrt(B21^2 + B22^2),   B = M^-1,               (E8)
 *
 * the box that the search scans.
 */

/**
 * Index clamped to [0, n - 1].
 * @param {number} i
 * @param {number} n
 * @returns {number}
 */
function clampIndex(i, n) {
  return i < 0 ? 0 : i >= n ? n - 1 : i;
}

/**
 * Median of the 9 values of a 3 x 3 window: the 19-exchange network of Paeth, as given by
 * Devillard ("Fast median search", 1998).  The median ends in p[4].
 * @param {Float32Array} p
 * @returns {number}
 */
function median9(p) {
  /** @param {number} a @param {number} b */
  const sort = (a, b) => {
    if (p[a] > p[b]) {
      const t = p[a];
      p[a] = p[b];
      p[b] = t;
    }
  };
  sort(1, 2); sort(4, 5); sort(7, 8); sort(0, 1); sort(3, 4); sort(6, 7);
  sort(1, 2); sort(4, 5); sort(7, 8); sort(0, 3); sort(5, 8); sort(4, 7);
  sort(3, 6); sort(1, 4); sort(2, 5); sort(4, 7); sort(4, 2); sort(6, 4);
  sort(4, 2);
  return p[4];
}

/**
 * Median of the 25 values of a 5 x 5 window, by insertion sort.
 * @param {Float32Array} p
 * @returns {number}
 */
function median25(p) {
  for (let i = 1; i < 25; i++) {
    const v = p[i];
    let j = i - 1;
    while (j >= 0 && p[j] > v) {
      p[j + 1] = p[j];
      j--;
    }
    p[j + 1] = v;
  }
  return p[12];
}

/**
 * Median filter of a 3 x 3 or 5 x 5 window, edges replicated.
 * @param {Float32Array} src
 * @param {number} w
 * @param {number} h
 * @param {number} size 3 or 5
 * @returns {Float32Array}
 */
function medianFilter(src, w, h, size) {
  if (size !== 3 && size !== 5) {
    throw new Error(`median size must be 3 or 5, not ${size}`);
  }
  const r = (size - 1) / 2;
  const out = new Float32Array(w * h);
  const win = new Float32Array(size * size);
  const pick = size === 3 ? median9 : median25;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let k = 0;
      for (let dy = -r; dy <= r; dy++) {
        const row = clampIndex(y + dy, h) * w;
        for (let dx = -r; dx <= r; dx++) {
          win[k++] = src[row + clampIndex(x + dx, w)];
        }
      }
      out[y * w + x] = pick(win);
    }
  }
  return out;
}

/**
 * The Gaussian of width sigma and its derivative, sampled as scipy.ndimage does: radius
 * floor(4 sigma + 0.5), the Gaussian normalized to sum 1, G'(t) = -(t / sigma^2) G(t).
 * @param {number} sigma
 * @returns {{g: Float64Array, dg: Float64Array, radius: number}}
 */
function gaussianKernels(sigma) {
  const radius = Math.max(1, Math.floor(4 * sigma + 0.5));
  const g = new Float64Array(2 * radius + 1);
  const dg = new Float64Array(2 * radius + 1);
  let sum = 0;
  for (let t = -radius; t <= radius; t++) {
    g[t + radius] = Math.exp((-0.5 * t * t) / (sigma * sigma));
    sum += g[t + radius];
  }
  for (let t = -radius; t <= radius; t++) {
    g[t + radius] /= sum;
    dg[t + radius] = (-t / (sigma * sigma)) * g[t + radius];
  }
  return { g, dg, radius };
}

/**
 * Convolution along x (within rows), edges replicated: out(x) = sum_t k(t) src(x - t).
 * @param {Float32Array} src
 * @param {number} w
 * @param {number} h
 * @param {Float64Array} k
 * @param {Float32Array} out
 */
function convolveRows(src, w, h, k, out) {
  const r = (k.length - 1) / 2;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let acc = 0;
      if (x >= r && x < w - r) {
        for (let t = -r; t <= r; t++) {
          acc += k[t + r] * src[row + x - t];
        }
      } else {
        for (let t = -r; t <= r; t++) {
          acc += k[t + r] * src[row + clampIndex(x - t, w)];
        }
      }
      out[row + x] = acc;
    }
  }
}

/**
 * Convolution along y (within columns), edges replicated: out(y) = sum_t k(t) src(y - t).
 * @param {Float32Array} src
 * @param {number} w
 * @param {number} h
 * @param {Float64Array} k
 * @param {Float32Array} out
 */
function convolveColumns(src, w, h, k, out) {
  const r = (k.length - 1) / 2;
  for (let y = 0; y < h; y++) {
    const inner = y >= r && y < h - r;
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let t = -r; t <= r; t++) {
        const yy = inner ? y - t : clampIndex(y - t, h);
        acc += k[t + r] * src[yy * w + x];
      }
      out[y * w + x] = acc;
    }
  }
}

/**
 * Values at evenly spread positions, about ``target`` of them, sorted ascending.
 * @param {Float32Array} values
 * @param {number} target
 * @returns {Float32Array}
 */
function sortedSample(values, target) {
  const step = Math.max(1, Math.floor(values.length / target));
  const sample = new Float32Array(Math.ceil(values.length / step));
  for (let i = 0, k = 0; i < values.length; i += step, k++) {
    sample[k] = values[i];
  }
  return sample.sort();
}

/**
 * The value at ``percentile`` (0 to 100) of a sorted sample, by linear interpolation.
 * @param {Float32Array} sorted
 * @param {number} percentile
 * @returns {number}
 */
function percentileOf(sorted, percentile) {
  if (sorted.length === 0) {
    return 0;
  }
  const pos = (percentile / 100) * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.min(sorted.length - 1, lo + 1);
  return sorted[lo] + (pos - lo) * (sorted[hi] - sorted[lo]);
}

/** The Gaussian-derivative gradient of an image (E1), its strength and snapping (E5, E6). */
class EdgeMap {
  /**
   * @param {Float32Array} image   grey values, row-major
   * @param {number} width
   * @param {number} height
   * @param {number} sigma         Gaussian width (pixels)
   * @param {number} median        median window before the gradient: 0 (none), 3 or 5
   */
  constructor(image, width, height, sigma, median) {
    if (!(Number.isFinite(sigma) && sigma > 0)) {
      throw new Error(`sigma must be positive, not ${sigma}`);
    }
    if (image.length !== width * height) {
      throw new Error("the image does not have width x height values");
    }
    this.width = width;
    this.height = height;
    this.sigma = sigma;
    this.median = median;
    const src = median === 3 || median === 5 ? medianFilter(image, width, height, median) : image;
    const { g, dg } = gaussianKernels(sigma);
    const n = width * height;
    const tmp = new Float32Array(n);
    /** @type {Float32Array} */
    this.gx = new Float32Array(n);
    /** @type {Float32Array} */
    this.gy = new Float32Array(n);
    convolveColumns(src, width, height, g, tmp);
    convolveRows(tmp, width, height, dg, this.gx);
    convolveRows(src, width, height, g, tmp);
    convolveColumns(tmp, width, height, dg, this.gy);
    /** @type {Float32Array} */
    this.magnitude = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      this.magnitude[i] = Math.sqrt(this.gx[i] * this.gx[i] + this.gy[i] * this.gy[i]);
    }
    const sample = sortedSample(this.magnitude, 1e6);
    const typical = percentileOf(sample, 50);
    /** The median strength: the noisy background (a tiny positive floor for a constant image). */
    this.noise = typical > 0 ? typical : 1e-30;
    /** The 99.5th percentile, for display. */
    this.top = Math.max(percentileOf(sample, 99.5), this.noise * (1 + 1e-6));
  }

  /**
   * Edge strength at the pixel nearest (x, y), in units of the median; 0 outside the image.
   * @param {number} x
   * @param {number} y
   * @returns {number}
   */
  contrast(x, y) {
    const i = Math.round(y);
    const j = Math.round(x);
    if (i < 0 || i >= this.height || j < 0 || j >= this.width) {
      return 0;
    }
    return this.magnitude[i * this.width + j] / this.noise;
  }

  /**
   * Strength for display: 0 at and below the median, 1 at and above the 99.5th percentile.
   * @returns {Float32Array}
   */
  normalized() {
    const out = new Float32Array(this.magnitude.length);
    const span = this.top - this.noise;
    for (let i = 0; i < out.length; i++) {
      const v = (this.magnitude[i] - this.noise) / span;
      out[i] = v < 0 ? 0 : v > 1 ? 1 : v;
    }
    return out;
  }

  /**
   * Strength at (x, y) by bilinear interpolation, edges replicated.
   * @param {number} x
   * @param {number} y
   * @returns {number}
   */
  sample(x, y) {
    const w = this.width;
    const h = this.height;
    const cx = Math.min(Math.max(x, 0), w - 1);
    const cy = Math.min(Math.max(y, 0), h - 1);
    const x0 = Math.floor(cx);
    const y0 = Math.floor(cy);
    const x1 = Math.min(x0 + 1, w - 1);
    const y1 = Math.min(y0 + 1, h - 1);
    const fx = cx - x0;
    const fy = cy - y0;
    const m = this.magnitude;
    const top = m[y0 * w + x0] * (1 - fx) + m[y0 * w + x1] * fx;
    const bottom = m[y1 * w + x0] * (1 - fx) + m[y1 * w + x1] * fx;
    return top * (1 - fy) + bottom * fy;
  }

  /**
   * Whether pixel (column x, row y) is a crest pixel: not exceeded by its two neighbours along
   * the gradient direction rounded to one of 8.  Pixels without gradient are not.
   * @param {number} x
   * @param {number} y
   * @returns {boolean}
   */
  isCrest(x, y) {
    const w = this.width;
    const i = y * w + x;
    const m = this.magnitude[i];
    if (!(m > 0)) {
      return false;
    }
    const limit = Math.sin(Math.PI / 8);
    const sx = Math.abs(this.gx[i]) / m > limit ? Math.sign(this.gx[i]) : 0;
    const sy = Math.abs(this.gy[i]) / m > limit ? Math.sign(this.gy[i]) : 0;
    const ahead = this.magnitude[clampIndex(y + sy, this.height) * w + clampIndex(x + sx, w)];
    const behind = this.magnitude[clampIndex(y - sy, this.height) * w + clampIndex(x - sx, w)];
    return m >= ahead && m >= behind;
  }

  /**
   * The edge point near (x, y): among the crest pixels within ``radius`` (E7) that are
   * ``minContrast`` times stronger than the median, the maximum of (E5), refined by (E6).  null
   * when none.
   * @param {number} x
   * @param {number} y
   * @param {number} radius
   * @param {number} minContrast
   * @param {[number, number, number, number]} [metric]   M of (E7) row by row: stored pixel offsets
   *     to the units of ``radius``; the identity by default
   * @returns {[number, number]|null}
   */
  snap(x, y, radius, minContrast, metric = [1, 0, 0, 1]) {
    if (!(Number.isFinite(radius) && radius > 0)) {
      throw new Error(`radius must be positive, not ${radius}`);
    }
    const [m11, m12, m21, m22] = metric;
    const det = Math.abs(m11 * m22 - m12 * m21);
    if (!(Number.isFinite(det) && det > 0)) {
      throw new Error("the metric must be an invertible matrix");
    }
    const halfX = (radius * Math.hypot(m22, m12)) / det;    // (E8), M^-1 = [[m22, -m12], [-m21, m11]] / det M
    const halfY = (radius * Math.hypot(m21, m11)) / det;
    const x0 = Math.max(0, Math.floor(x - halfX));
    const x1 = Math.min(this.width - 1, Math.ceil(x + halfX));
    const y0 = Math.max(0, Math.floor(y - halfY));
    const y1 = Math.min(this.height - 1, Math.ceil(y + halfY));
    const threshold = minContrast * this.noise;
    const spread = 2 * (radius / 2) * (radius / 2);
    let best = -Infinity;
    let bx = -1;
    let by = -1;
    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        const zx = m11 * (px - x) + m12 * (py - y);
        const zy = m21 * (px - x) + m22 * (py - y);
        const d2 = zx * zx + zy * zy;
        const m = this.magnitude[py * this.width + px];
        if (d2 > radius * radius || m < threshold) {
          continue;
        }
        const score = m * Math.exp(-d2 / spread);
        if (score > best && this.isCrest(px, py)) {
          best = score;
          bx = px;
          by = py;
        }
      }
    }
    return bx < 0 ? null : this.subpixel(bx, by);
  }

  /**
   * The vertex (E6) of the parabola through the strength at p - u, p, p + u.
   * @param {number} px
   * @param {number} py
   * @returns {[number, number]}
   */
  subpixel(px, py) {
    const i = py * this.width + px;
    const norm = this.magnitude[i];
    if (!(norm > 0)) {
      return [px, py];
    }
    const ux = this.gx[i] / norm;
    const uy = this.gy[i] / norm;
    const fMinus = this.sample(px - ux, py - uy);
    const fPlus = this.sample(px + ux, py + uy);
    const curvature = fMinus - 2 * norm + fPlus;
    if (curvature >= 0) {
      return [px, py];
    }
    const t = Math.min(1, Math.max(-1, (fMinus - fPlus) / (2 * curvature)));
    return [px + t * ux, py + t * uy];
  }
}
