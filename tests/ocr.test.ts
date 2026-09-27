import { PDFDocument, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { downscaleFactor, imageToPdfPoint, placeWord, sanitizeForFont, unsure, type PageBox, type Word } from '../src/engine/ocr';

describe('downscaleFactor', () => {
  it('leaves images at or under the limit alone', () => {
    expect(downscaleFactor(1000, 2000, 3000)).toBe(1);
    expect(downscaleFactor(3000, 1500, 3000)).toBe(1);
  });

  it('shrinks the long side down to the limit', () => {
    expect(downscaleFactor(6000, 3000, 3000)).toBe(0.5);
    expect(downscaleFactor(3000, 6000, 3000)).toBe(0.5);
  });
});

describe('imageToPdfPoint', () => {
  const box = (rotation: number): PageBox => ({ width: 100, height: 200, rotation });

  it('maps corners for an upright page (scale 1)', () => {
    expect(imageToPdfPoint(0, 0, 1, box(0))).toEqual({ x: 0, y: 200 }); // top-left px -> top-left of page
    expect(imageToPdfPoint(0, 200, 1, box(0))).toEqual({ x: 0, y: 0 }); // bottom-left px -> origin
    expect(imageToPdfPoint(100, 200, 1, box(0))).toEqual({ x: 100, y: 0 });
  });

  it('divides by scale', () => {
    expect(imageToPdfPoint(20, 40, 2, box(0))).toEqual({ x: 10, y: 180 });
  });

  it('rotates 90deg clockwise: raster top-left corresponds to the page bottom-left', () => {
    // content box is portrait 100x200; rotated 90, the raster is landscape 200x100.
    expect(imageToPdfPoint(0, 0, 1, box(90))).toEqual({ x: 0, y: 0 });
    expect(imageToPdfPoint(200, 0, 1, box(90))).toEqual({ x: 0, y: 200 });
    expect(imageToPdfPoint(0, 100, 1, box(90))).toEqual({ x: 100, y: 0 });
  });

  it('rotates 180deg: raster top-left corresponds to the page top-right', () => {
    expect(imageToPdfPoint(0, 0, 1, box(180))).toEqual({ x: 100, y: 0 });
    expect(imageToPdfPoint(100, 200, 1, box(180))).toEqual({ x: 0, y: 200 });
  });

  it('rotates 270deg: raster top-left corresponds to the page top-right (opposite of 90)', () => {
    expect(imageToPdfPoint(0, 0, 1, box(270))).toEqual({ x: 100, y: 200 });
    expect(imageToPdfPoint(200, 100, 1, box(270))).toEqual({ x: 0, y: 0 });
  });

  it('normalizes negative and non-multiple-of-90 rotations', () => {
    expect(imageToPdfPoint(0, 0, 1, box(-270))).toEqual(imageToPdfPoint(0, 0, 1, box(90)));
    expect(imageToPdfPoint(0, 0, 1, box(450))).toEqual(imageToPdfPoint(0, 0, 1, box(90)));
  });
});

describe('sanitizeForFont and placeWord', () => {
  const load = async () => {
    const doc = await PDFDocument.create();
    return doc.embedFont(StandardFonts.Helvetica);
  };

  it('keeps plain ASCII untouched', async () => {
    const font = await load();
    expect(sanitizeForFont(font, 'Hello, World!')).toBe('Hello, World!');
  });

  it('replaces characters outside WinAnsi with "?" instead of throwing', async () => {
    const font = await load();
    expect(sanitizeForFont(font, 'caf\u{1F600}e')).toBe('caf?e'); // emoji has no WinAnsi glyph
  });

  const word = (text: string, x0: number, y0: number, x1: number, y1: number): Word => ({
    text,
    confidence: 90,
    bbox: { x0, y0, x1, y1 },
  });

  it('fits the font size to the bbox height and stretches width to match', async () => {
    const font = await load();
    const box: PageBox = { width: 600, height: 800, rotation: 0 };
    // A 100x20px word rendered at 2px/pt -> 50x10pt in PDF space.
    const placed = placeWord(word('Hello', 100, 100, 200, 120), font, 2, box);
    expect(placed).not.toBeNull();
    expect(placed!.size).toBeCloseTo(10, 5);
    const naturalWidth = font.widthOfTextAtSize('Hello', placed!.size);
    expect(naturalWidth * placed!.hScale).toBeCloseTo(50, 5);
    expect(placed!.angle).toBeCloseTo(0, 10);
  });

  it('rotates the baseline angle to match a rotated page', async () => {
    const font = await load();
    const box: PageBox = { width: 600, height: 800, rotation: 90 };
    const placed = placeWord(word('Hi', 0, 0, 40, 20), font, 1, box);
    expect(placed).not.toBeNull();
    expect(placed!.angle).toBeCloseTo(Math.PI / 2, 5);
  });

  it('drops empty or degenerate words', async () => {
    const font = await load();
    const box: PageBox = { width: 600, height: 800, rotation: 0 };
    expect(placeWord(word('   ', 0, 0, 10, 10), font, 1, box)).toBeNull();
    expect(placeWord(word('x', 0, 0, 0, 0), font, 1, box)).toBeNull();
  });
});

describe('unsure', () => {
  it('flags little text or low average confidence, weighted by word length', () => {
    expect(unsure([])).toBe(true);
    expect(unsure([{ text: 'a', confidence: 95 }])).toBe(true);
    expect(unsure([{ text: 'Invoice', confidence: 92 }, { text: 'total', confidence: 88 }])).toBe(false);
    expect(unsure([{ text: 'TART', confidence: 31 }, { text: 'Uh', confidence: 40 }, { text: 'ok', confidence: 90 }])).toBe(true);
  });
});
