import { describe, expect, it } from 'vitest';
import { findMatches } from '../src/tools/redact-pdf';

// One line of 12pt text starting at (100, 700), 10 characters of 6pt each.
const line = (str: string, transform: [number, number, number, number, number, number] = [12, 0, 0, 12, 100, 700]) => ({
  str,
  transform,
  width: str.length * 6,
  height: 12,
  fontName: 'Helvetica',
  hasEOL: true,
});
const byCount = (text: string) => text.length;

describe('findMatches', () => {
  it('covers every case-insensitive match, with margin on both sides', () => {
    const [first, second] = findMatches([line('Pay Ravi, then ravi again')], 'RAVI', byCount);
    expect(second).toBeDefined();
    // "Ravi" spans x 124..148; the box must reach past both ends and around the glyphs.
    expect(first.x0).toBeLessThan(124);
    expect(first.x1).toBeGreaterThan(148);
    expect(first.y0).toBeLessThan(700);
    expect(first.y1).toBeGreaterThan(712);
    expect(second.x0).toBeGreaterThan(first.x1 - 12);
  });

  it('follows rotated text', () => {
    // Rotated 90°: the baseline runs up the page from (100, 100).
    const [box] = findMatches([line('secret', [0, 12, -12, 0, 100, 100])], 'secret', byCount);
    expect(box.y0).toBeLessThan(100);
    expect(box.y1).toBeGreaterThan(136);
    expect(box.x0).toBeLessThan(88);
  });

  it('ignores empty queries and missing words', () => {
    expect(findMatches([line('hello')], '  ', byCount)).toEqual([]);
    expect(findMatches([line('hello')], 'bye', byCount)).toEqual([]);
  });
});
