import { describe, expect, it } from 'vitest';
import { findBoxes, findMatches, personalData } from '../src/tools/redact-pdf';

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

describe('personalData', () => {
  const found = (text: string) => personalData(text).map(([a, b]) => text.slice(a, b));

  it('finds emails, UPI IDs and Indian and international ID numbers', () => {
    expect(found('Mail asha.k+bills@mail.example.co.in or pay asha@okaxis today')).toEqual(['asha.k+bills@mail.example.co.in', 'asha@okaxis']);
    expect(found('PAN ABCDE1234F, IFSC HDFC0001234')).toEqual(['ABCDE1234F', 'HDFC0001234']);
    expect(found('IBAN DE89 3704 0044 0532 0130 00.')).toEqual(['DE89 3704 0044 0532 0130 00']);
    expect(found('Aadhaar 1234 5678 9012 and SSN 123-45-6789')).toEqual(['1234 5678 9012', '123-45-6789']);
  });

  it('finds phone, card and account numbers in their usual shapes', () => {
    expect(found('Call +91 98765 43210 or (555) 123-4567.')).toEqual(['+91 98765 43210', '(555) 123-4567']);
    expect(found('Card 4111-1111-1111-1111, A/c 001234567890')).toEqual(['4111-1111-1111-1111', '001234567890']);
  });

  it('leaves dates, amounts, years and page numbers alone', () => {
    expect(found('Paid ₹1,25,000.50 on 12-03-2024 for 2025, page 3 of 12, invoice 42')).toEqual([]);
    expect(found('Total 12345678.90')).toEqual([]);
  });

  it('places boxes over each match in the line', () => {
    const boxes = findBoxes([line('Email a@b.co now')], personalData, byCount);
    expect(boxes).toHaveLength(1);
    // "a@b.co" spans x 136..172.
    expect(boxes[0].x0).toBeLessThan(136);
    expect(boxes[0].x1).toBeGreaterThan(172);
  });
});
