import { describe, expect, it } from 'vitest';
import { applyFit, boxFilter, estimateForeground, firm, guidedFit, planesFromRGBA, refine, type Planes } from '../src/engine/matte';

/** Straightforward window mean, to check the running-sum version against. */
function slowBox(src: Float32Array, w: number, h: number, r: number) {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let count = 0;
      for (let yy = Math.max(0, y - r); yy <= Math.min(h - 1, y + r); yy++)
        for (let xx = Math.max(0, x - r); xx <= Math.min(w - 1, x + r); xx++) {
          sum += src[yy * w + xx];
          count++;
        }
      out[y * w + x] = sum / count;
    }
  return out;
}

/** A w×h photo: a red disc on a light grey background, with soft (mixed) pixels at its edge. */
function disc(w: number, h: number) {
  const rgba = new Uint8ClampedArray(w * h * 4);
  const truth = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const d = Math.hypot(x + 0.5 - w / 2, y + 0.5 - h / 2) - w / 4;
      const a = Math.min(1, Math.max(0, 0.5 - d)); // one-pixel soft edge
      truth[y * w + x] = a;
      const o = (y * w + x) * 4;
      rgba.set([Math.round(220 * a + 230 * (1 - a)), Math.round(30 * a + 230 * (1 - a)), Math.round(30 * a + 230 * (1 - a)), 255], o);
    }
  return { rgba, truth };
}

describe('box filter', () => {
  it('matches a brute-force window mean, edges included', () => {
    const w = 13;
    const h = 7;
    const src = Float32Array.from({ length: w * h }, (_, i) => Math.sin(i * 1.7) + (i % 5));
    for (const r of [0, 1, 3, 9]) {
      const fast = boxFilter(src, w, h, r);
      const slow = slowBox(src, w, h, r);
      fast.forEach((v, i) => expect(v).toBeCloseTo(slow[i], 4));
    }
  });
});

describe('guided filter', () => {
  it('leaves a flat mask flat', () => {
    const { rgba } = disc(32, 32);
    const I = planesFromRGBA(rgba, 32, 32);
    const out = applyFit(guidedFit(I, new Float32Array(32 * 32).fill(0.7), 3, 1e-5), I);
    out.forEach((v) => expect(v).toBeCloseTo(0.7, 3));
  });

  it('fits an enlarged low-resolution mask to the photo’s real edge', () => {
    // A wavy blob, and the mask a model 4 times smaller would give back, enlarged smoothly.
    const w = 128;
    const k = 4;
    const s = w / k;
    const rgba = new Uint8ClampedArray(w * w * 4);
    const truth = new Float32Array(w * w);
    for (let y = 0; y < w; y++)
      for (let x = 0; x < w; x++) {
        const radius = 32 + 6 * Math.sin(Math.atan2(y - 64, x - 64) * 7);
        const a = Math.min(1, Math.max(0, 0.5 - (Math.hypot(x + 0.5 - 64, y + 0.5 - 64) - radius)));
        truth[y * w + x] = a;
        rgba.set([200 * a + 60 * (1 - a), 40 * a + 180 * (1 - a), 50 * a + 120 * (1 - a), 255], (y * w + x) * 4);
      }
    const low = new Float32Array(s * s).map((_, i) => {
      let sum = 0;
      for (let yy = 0; yy < k; yy++) for (let xx = 0; xx < k; xx++) sum += truth[(Math.floor(i / s) * k + yy) * w + (i % s) * k + xx];
      return sum / (k * k);
    });
    const enlarged = new Float32Array(w * w).map((_, i) => {
      const fx = Math.min(Math.max(((i % w) + 0.5) / k - 0.5, 0), s - 1);
      const fy = Math.min(Math.max((Math.floor(i / w) + 0.5) / k - 0.5, 0), s - 1);
      const [x0, y0] = [Math.floor(fx), Math.floor(fy)];
      const [x1, y1] = [Math.min(x0 + 1, s - 1), Math.min(y0 + 1, s - 1)];
      const [tx, ty] = [fx - x0, fy - y0];
      return low[y0 * s + x0] * (1 - tx) * (1 - ty) + low[y0 * s + x1] * tx * (1 - ty) + low[y1 * s + x0] * (1 - tx) * ty + low[y1 * s + x1] * tx * ty;
    });
    const I = planesFromRGBA(rgba, w, w);
    const fitted = applyFit(guidedFit(I, firm(enlarged), 3, 1e-5), I);
    const error = (m: Float32Array) => m.reduce((sum, v, i) => sum + Math.abs(v - truth[i]), 0) / m.length;
    expect(error(fitted)).toBeLessThan(error(enlarged) / 2.5);
  });
});

describe('foreground colours', () => {
  it('recovers the subject’s colour in mixed edge pixels', () => {
    const w = 64;
    const { rgba, truth } = disc(w, w);
    const I = planesFromRGBA(rgba, w, w);
    const F = estimateForeground(I, truth, 3);
    let checked = 0;
    for (let i = 0; i < truth.length; i++) {
      if (truth[i] < 0.3 || truth[i] > 0.7) continue;
      // The photo's edge pixel is half grey; the estimate should be close to the disc's red.
      expect(I.g[i]).toBeGreaterThan(0.4);
      expect(F.r[i]).toBeGreaterThan(0.75);
      expect(F.g[i]).toBeLessThan(0.3);
      checked++;
    }
    expect(checked).toBeGreaterThan(10);
  });
});

describe('refine', () => {
  it('builds a full-size cut-out from a small mask', () => {
    const W = 200;
    const { rgba } = disc(W, W);
    // The small copy and a coarse mask from it, as the worker prepares them.
    const s = 50;
    const small: Planes = planesFromRGBA(disc(s, s).rgba, s, s);
    const coarse = boxFilter(disc(s, s).truth, s, s, 2);
    refine(rgba, W, W, small, coarse, 25);
    const alphaAt = (x: number, y: number) => rgba[(y * W + x) * 4 + 3];
    expect(alphaAt(100, 100)).toBe(255); // centre of the disc
    expect(alphaAt(5, 5)).toBe(0); // background corner
    expect(alphaAt(100, 55)).toBeGreaterThan(200); // just inside the edge (radius 50 around 100,100)
    expect(alphaAt(100, 45)).toBeLessThan(60); // just outside it
    // Opaque pixels keep their exact colour.
    expect([...rgba.subarray((100 * W + 100) * 4, (100 * W + 100) * 4 + 3)]).toEqual([220, 30, 30]);
  });
});
