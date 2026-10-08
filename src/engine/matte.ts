// Turns the model's low-resolution mask into a clean, full-resolution cut-out.
//
// The model sees the photo at 512x512, so its mask is soft and blocky at the edges. Two classic,
// fast filters fix that at any resolution while keeping memory to a few small working images:
//
// 1. Fast guided filter (He & Sun, 2015): fits the mask to the photo's own edges, so hair and fur
//    follow the real strands. The fit is computed on a reduced copy and applied to every pixel.
// 2. Blur-fusion foreground estimation (Germer et al., 2021): edge pixels are a mix of subject and
//    old background; this estimates the subject's true colour so no halo of the old background
//    shows on a new one. Also computed small, then added to the full-size photo as a correction.
//
// Everything here is plain arithmetic on typed arrays, so it runs in a worker and in unit tests.

/** Mean over a (2r+1)x(2r+1) window, clamped at the image edges. Planar, w*h values. */
export function boxFilter(src: Float32Array, w: number, h: number, r: number, out = new Float32Array(w * h)): Float32Array {
  const tmp = new Float32Array(w * h);
  // Rows: running sum over x.
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let x = 0; x <= Math.min(r, w - 1); x++) sum += src[row + x];
    for (let x = 0; x < w; x++) {
      const lo = x - r;
      const hi = x + r;
      tmp[row + x] = sum / (Math.min(hi, w - 1) - Math.max(lo, 0) + 1);
      if (hi + 1 < w) sum += src[row + hi + 1];
      if (lo >= 0) sum -= src[row + lo];
    }
  }
  // Columns: running sum over y.
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = 0; y <= Math.min(r, h - 1); y++) sum += tmp[y * w + x];
    for (let y = 0; y < h; y++) {
      const lo = y - r;
      const hi = y + r;
      out[y * w + x] = sum / (Math.min(hi, h - 1) - Math.max(lo, 0) + 1);
      if (hi + 1 < h) sum += tmp[(hi + 1) * w + x];
      if (lo >= 0) sum -= tmp[lo * w + x];
    }
  }
  return out;
}

/** A small working copy of the photo: three planes of 0–1 values. */
export interface Planes {
  w: number;
  h: number;
  r: Float32Array;
  g: Float32Array;
  b: Float32Array;
}

export function planesFromRGBA(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number): Planes {
  const n = w * h;
  const planes = { w, h, r: new Float32Array(n), g: new Float32Array(n), b: new Float32Array(n) };
  for (let i = 0; i < n; i++) {
    planes.r[i] = rgba[i * 4] / 255;
    planes.g[i] = rgba[i * 4 + 1] / 255;
    planes.b[i] = rgba[i * 4 + 2] / 255;
  }
  return planes;
}

/** Linear coefficients of the guided filter, already averaged: alpha ≈ a0·R + a1·G + a2·B + b. */
export interface Fit {
  w: number;
  h: number;
  a0: Float32Array;
  a1: Float32Array;
  a2: Float32Array;
  b: Float32Array;
}

/** Colour guided filter (He et al.) of `p` by the photo `I`, returned as smoothed coefficients. */
export function guidedFit(I: Planes, p: Float32Array, radius: number, eps: number): Fit {
  const { w, h } = I;
  const n = w * h;
  const box = (a: Float32Array) => boxFilter(a, w, h, radius);
  const product = (a: Float32Array, b: Float32Array) => {
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = a[i] * b[i];
    return out;
  };
  const mr = box(I.r);
  const mg = box(I.g);
  const mb = box(I.b);
  const mp = box(p);
  const crp = box(product(I.r, p));
  const cgp = box(product(I.g, p));
  const cbp = box(product(I.b, p));
  const vrr = box(product(I.r, I.r));
  const vrg = box(product(I.r, I.g));
  const vrb = box(product(I.r, I.b));
  const vgg = box(product(I.g, I.g));
  const vgb = box(product(I.g, I.b));
  const vbb = box(product(I.b, I.b));
  const a0 = new Float32Array(n);
  const a1 = new Float32Array(n);
  const a2 = new Float32Array(n);
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = mr[i];
    const g = mg[i];
    const bl = mb[i];
    const q = mp[i];
    const covR = crp[i] - r * q;
    const covG = cgp[i] - g * q;
    const covB = cbp[i] - bl * q;
    // Covariance of the colours in the window, plus eps on the diagonal; solved by its inverse.
    const s11 = vrr[i] - r * r + eps;
    const s12 = vrg[i] - r * g;
    const s13 = vrb[i] - r * bl;
    const s22 = vgg[i] - g * g + eps;
    const s23 = vgb[i] - g * bl;
    const s33 = vbb[i] - bl * bl + eps;
    const i11 = s22 * s33 - s23 * s23;
    const i12 = s13 * s23 - s12 * s33;
    const i13 = s12 * s23 - s13 * s22;
    const i22 = s11 * s33 - s13 * s13;
    const i23 = s12 * s13 - s11 * s23;
    const i33 = s11 * s22 - s12 * s12;
    const det = s11 * i11 + s12 * i12 + s13 * i13;
    const x0 = (i11 * covR + i12 * covG + i13 * covB) / det;
    const x1 = (i12 * covR + i22 * covG + i23 * covB) / det;
    const x2 = (i13 * covR + i23 * covG + i33 * covB) / det;
    a0[i] = x0;
    a1[i] = x1;
    a2[i] = x2;
    b[i] = q - x0 * r - x1 * g - x2 * bl;
  }
  return { w, h, a0: box(a0), a1: box(a1), a2: box(a2), b: box(b) };
}

/** The filtered mask at the fit's own size, clamped to 0–1. */
export function applyFit(fit: Fit, I: Planes): Float32Array {
  const out = new Float32Array(fit.w * fit.h);
  for (let i = 0; i < out.length; i++) {
    const v = fit.a0[i] * I.r[i] + fit.a1[i] * I.g[i] + fit.a2[i] * I.b[i] + fit.b[i];
    out[i] = v < 0 ? 0 : v > 1 ? 1 : v;
  }
  return out;
}

/**
 * True subject colours behind semi-transparent edge pixels (blur fusion, two passes per radius).
 * Returns the photo with those pixels' colours corrected; fully opaque areas are unchanged.
 */
export function estimateForeground(I: Planes, alpha: Float32Array, radius: number): Planes {
  const { w, h } = I;
  const n = w * h;
  const box = (a: Float32Array) => boxFilter(a, w, h, radius);
  const blurA = box(alpha);
  const inv = new Float32Array(n);
  for (let i = 0; i < n; i++) inv[i] = 1 - alpha[i];
  const blurInv = box(inv);
  let F: Planes = { w, h, r: I.r.slice(), g: I.g.slice(), b: I.b.slice() };
  let B: Planes = { w, h, r: I.r.slice(), g: I.g.slice(), b: I.b.slice() };
  for (let pass = 0; pass < 2; pass++) {
    const next: Planes = { w, h, r: new Float32Array(n), g: new Float32Array(n), b: new Float32Array(n) };
    const nextB: Planes = { w, h, r: new Float32Array(n), g: new Float32Array(n), b: new Float32Array(n) };
    for (const c of ['r', 'g', 'b'] as const) {
      const fa = new Float32Array(n);
      const bb = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        fa[i] = F[c][i] * alpha[i];
        bb[i] = B[c][i] * inv[i];
      }
      const blurF = box(fa);
      const blurB = box(bb);
      for (let i = 0; i < n; i++) {
        const f = blurF[i] / (blurA[i] + 1e-5);
        const bg = blurB[i] / (blurInv[i] + 1e-5);
        const a = alpha[i];
        const v = f + a * (I[c][i] - a * f - (1 - a) * bg);
        next[c][i] = v < 0 ? 0 : v > 1 ? 1 : v;
        nextB[c][i] = bg;
      }
    }
    F = next;
    B = nextB;
  }
  return F;
}

/**
 * Writes the cut-out into the full-size photo, in place: the alpha channel from the fit, and edge
 * colours shifted by the small foreground correction (fg − photo), both sampled bilinearly.
 */
export function applyFullSize(rgba: Uint8ClampedArray, W: number, H: number, fit: Fit, small: Planes, fg: Planes) {
  const { w, h } = fit;
  const n = w * h;
  const dr = new Float32Array(n);
  const dg = new Float32Array(n);
  const db = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    dr[i] = fg.r[i] - small.r[i];
    dg[i] = fg.g[i] - small.g[i];
    db[i] = fg.b[i] - small.b[i];
  }
  const sx = w / W;
  const sy = h / H;
  for (let y = 0; y < H; y++) {
    // Pixel centres, as canvas downscaling and bilinear upscaling both use.
    const fy = Math.min(Math.max((y + 0.5) * sy - 0.5, 0), h - 1);
    const y0 = Math.floor(fy);
    const y1 = Math.min(y0 + 1, h - 1);
    const ty = fy - y0;
    for (let x = 0; x < W; x++) {
      const fx = Math.min(Math.max((x + 0.5) * sx - 0.5, 0), w - 1);
      const x0 = Math.floor(fx);
      const x1 = Math.min(x0 + 1, w - 1);
      const tx = fx - x0;
      const i00 = y0 * w + x0;
      const i01 = y0 * w + x1;
      const i10 = y1 * w + x0;
      const i11 = y1 * w + x1;
      const w00 = (1 - tx) * (1 - ty);
      const w01 = tx * (1 - ty);
      const w10 = (1 - tx) * ty;
      const w11 = tx * ty;
      const sample = (a: Float32Array) => a[i00] * w00 + a[i01] * w01 + a[i10] * w10 + a[i11] * w11;
      const o = (y * W + x) * 4;
      const R = rgba[o] / 255;
      const G = rgba[o + 1] / 255;
      const B = rgba[o + 2] / 255;
      let alpha = sample(fit.a0) * R + sample(fit.a1) * G + sample(fit.a2) * B + sample(fit.b);
      alpha = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
      rgba[o + 3] = Math.round(alpha * 255);
      if (alpha > 0 && alpha < 0.996) {
        rgba[o] = Math.round((R + sample(dr)) * 255);
        rgba[o + 1] = Math.round((G + sample(dg)) * 255);
        rgba[o + 2] = Math.round((B + sample(db)) * 255);
      }
    }
  }
}

/**
 * Doubles the mask's contrast around 0.5. The model's mask, enlarged, is soft at every edge; this
 * firms solid edges up before the guided filter, while fine strands of hair keep their in-between
 * values. (Tested on portraits: 2 kept flyaway hairs, 3 started to lose them.)
 */
export function firm(mask: Float32Array, contrast = 2): Float32Array {
  return mask.map((v) => Math.min(1, Math.max(0, (v - 0.5) * contrast + 0.5)));
}

/**
 * The whole refinement: `rgba` is the full-size photo (changed in place into the cut-out), `small`
 * a reduced copy of it, and `mask` the model's 0–1 mask already resized to the small copy's size.
 */
export function refine(rgba: Uint8ClampedArray, W: number, H: number, small: Planes, mask: Float32Array, modelSize: number) {
  // Window sizes scale with how much bigger the small copy is than the model's view.
  const scale = Math.max(small.w, small.h) / modelSize;
  const fit = guidedFit(small, firm(mask), Math.max(1, Math.round(1.5 * scale)), 1e-5);
  const alpha = applyFit(fit, small);
  const fg = estimateForeground(small, alpha, Math.max(2, Math.round(2 * scale)));
  applyFullSize(rgba, W, H, fit, small, fg);
}
