import { describe, expect, it } from 'vitest';
import {
  applyMatrix,
  groupTextRuns,
  invertMatrix,
  mapStandardFont,
  multiplyMatrix,
  runGeometry,
  sanitizeWinAnsi,
  type Matrix,
  type TextItemLike,
} from '../src/tools/edit-pdf';

describe('matrix helpers', () => {
  it('multiplies a translation onto a scale like pdf.js Util.transform', () => {
    const scale: Matrix = [2, 0, 0, 2, 0, 0];
    const translate: Matrix = [1, 0, 0, 1, 5, 7];
    // scale ∘ translate: translate first, then scale
    expect(multiplyMatrix(scale, translate)).toEqual([2, 0, 0, 2, 10, 14]);
  });

  it('applies identity and rotation matrices as expected', () => {
    expect(applyMatrix([1, 0, 0, 1, 3, 4], 1, 1)).toEqual([4, 5]);
    // 90° rotation: (a,b,c,d) = (0,1,-1,0)
    const [x, y] = applyMatrix([0, 1, -1, 0, 0, 0], 1, 0);
    expect(x).toBeCloseTo(0);
    expect(y).toBeCloseTo(1);
  });

  it('inverts a matrix so applying it undoes the original', () => {
    const m: Matrix = [2, 0.3, -0.1, 1.5, 12, -8];
    const inv = invertMatrix(m);
    const [x, y] = applyMatrix(m, 10, 20);
    const [bx, by] = applyMatrix(inv, x, y);
    expect(bx).toBeCloseTo(10);
    expect(by).toBeCloseTo(20);
  });

  it('returns identity for a degenerate (zero-determinant) matrix instead of throwing', () => {
    expect(invertMatrix([0, 0, 0, 0, 5, 5])).toEqual([1, 0, 0, 1, 0, 0]);
  });
});

function item(str: string, x: number, y: number, width: number, hasEOL = false, size = 12, fontName = 'g_f1'): TextItemLike {
  return { str, transform: [size, 0, 0, size, x, y], width, height: size, fontName, hasEOL };
}

describe('groupTextRuns', () => {
  it('joins adjacent items on the same baseline into one run', () => {
    const runs = groupTextRuns([item('Hello ', 72, 700, 36), item('World', 108, 700, 30, true)]);
    expect(runs).toHaveLength(1);
    expect(runs[0].text).toBe('Hello World');
    expect(runs[0].transform).toEqual([12, 0, 0, 12, 72, 700]);
    expect(runs[0].width).toBeCloseTo(66, 0);
  });

  it('splits into separate runs when the baseline jumps to a new line', () => {
    const runs = groupTextRuns([
      item('Line one', 72, 700, 60, true),
      item('Line two', 72, 680, 60, true),
    ]);
    expect(runs.map((r) => r.text)).toEqual(['Line one', 'Line two']);
  });

  it('splits into separate runs when there is a large horizontal gap (a new column)', () => {
    const runs = groupTextRuns([item('Left', 72, 700, 30), item('Right', 400, 700, 30, true)]);
    expect(runs.map((r) => r.text)).toEqual(['Left', 'Right']);
  });

  it('drops whitespace-only runs and marked-content items without text', () => {
    const runs = groupTextRuns([{ str: '', transform: [12, 0, 0, 12, 0, 0], width: 0, height: 0, fontName: 'x', hasEOL: true }, item('   ', 0, 0, 10, true)]);
    expect(runs).toEqual([]);
  });

  it('ignores marked-content items that carry no str field', () => {
    const items: TextItemLike[] = [item('A', 0, 0, 10), { str: '', hasEOL: false, transform: [1, 0, 0, 1, 0, 0], width: 0, height: 0, fontName: 'x' }, item('B', 10, 0, 10, true)];
    expect(groupTextRuns(items)[0].text).toBe('AB');
  });
});

describe('runGeometry', () => {
  it('places an unrotated run just below its baseline, growing upward', () => {
    const geo = runGeometry({ transform: [12, 0, 0, 12, 100, 200], width: 50, height: 14 });
    expect(geo.angleDeg).toBeCloseTo(0);
    expect(geo.fontSize).toBeCloseTo(12);
    expect(geo.width).toBe(50);
    expect(geo.y).toBeLessThan(200); // dips below the baseline for descenders
    expect(geo.y + geo.height).toBeGreaterThan(200); // and reaches above it
  });

  it('reports a 90° angle for vertical (rotated) text', () => {
    // transform (a,b,c,d) = (0, 12, -12, 0): baseline runs straight up
    const geo = runGeometry({ transform: [0, 12, -12, 0, 50, 50], width: 30, height: 14 });
    expect(geo.angleDeg).toBeCloseTo(90);
  });
});

describe('mapStandardFont', () => {
  it.each([
    ['ABCDEF+ArialMT', 'Helvetica'],
    ['Arial-BoldMT', 'HelveticaBold'],
    ['TimesNewRomanPSMT', 'TimesRoman'],
    ['Times New Roman,Bold', 'TimesRomanBold'],
    ['Georgia-Italic', 'TimesRomanItalic'],
    ['CourierNewPSMT', 'Courier'],
    ['Consolas-BoldOblique', 'CourierBoldOblique'],
    ['SomeSubset+Helvetica-BoldOblique', 'HelveticaBoldOblique'],
  ])('%s -> %s', (name, expected) => {
    expect(mapStandardFont(name)).toBe(expected);
  });
});

describe('sanitizeWinAnsi', () => {
  it('keeps plain ASCII untouched', () => {
    expect(sanitizeWinAnsi('Hello, World! 123')).toEqual({ text: 'Hello, World! 123', changed: false });
  });

  it('maps common smart punctuation to WinAnsi-safe equivalents', () => {
    expect(sanitizeWinAnsi('‘quoted’ – dash…')).toEqual({ text: "'quoted' - dash...", changed: true });
  });

  it('replaces characters outside WinAnsi (e.g. CJK, emoji) with "?" and flags the change', () => {
    const { text, changed } = sanitizeWinAnsi('café 你好 😀');
    expect(changed).toBe(true);
    expect(text).toBe('café ?? ?');
  });

  it('preserves newlines but strips other control characters', () => {
    expect(sanitizeWinAnsi('a\nb\rc\u0007d')).toEqual({ text: 'a\nb\rcd', changed: true });
  });
});
