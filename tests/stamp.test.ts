import { readFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { PDFDocument as Doc, degrees } from 'pdf-lib';
import { addPageNumbers, fromDisplayed, numberAt, watermarkPdf, winAnsiSafe } from '../src/engine/stamp';

const file = (name: string) => new File([readFileSync(new URL(`./fixtures/${name}`, import.meta.url))], name, { type: 'application/pdf' });
const contents = async (blob: Blob) => {
  const pdf = await PDFDocument.load(new Uint8Array(await blob.arrayBuffer()));
  return { pdf, pages: pdf.getPages().length };
};

describe('numberAt', () => {
  const box = { x: 0, y: 0, width: 600, height: 800 };
  it('centres at the bottom, and hugs the right margin otherwise', () => {
    expect(numberAt('bottom-center', box, 20, 10)).toEqual({ x: 290, y: 24 });
    expect(numberAt('bottom-right', box, 20, 10).x).toBe(556);
    expect(numberAt('top-right', box, 20, 10).y).toBe(766);
  });
  it('respects a CropBox that does not start at 0,0', () => {
    expect(numberAt('bottom-center', { ...box, x: 100, y: 50 }, 20, 10)).toEqual({ x: 390, y: 74 });
  });
});

describe('fromDisplayed', () => {
  const box = { x: 0, y: 0, width: 600, height: 800 };
  it('maps the displayed bottom-left corner back onto the page for every rotation', () => {
    expect(fromDisplayed(0, box, 0, 0)).toEqual({ x: 0, y: 0 });
    expect(fromDisplayed(90, box, 0, 0)).toEqual({ x: 600, y: 0 });
    expect(fromDisplayed(180, box, 0, 0)).toEqual({ x: 600, y: 800 });
    expect(fromDisplayed(270, box, 0, 0)).toEqual({ x: 0, y: 800 });
  });
  it('keeps an offset CropBox', () => {
    expect(fromDisplayed(90, { ...box, x: 10, y: 20 }, 5, 7)).toEqual({ x: 603, y: 25 });
  });
});

describe('addPageNumbers', () => {
  it('numbers rotated pages', async () => {
    const pdf = await Doc.create();
    for (const r of [0, 90, 180, 270]) pdf.addPage([600, 800]).setRotation(degrees(r));
    const input = new File([Buffer.from(await pdf.save())], 'rotated.pdf', { type: 'application/pdf' });
    const out = await addPageNumbers(input);
    expect(out.summary).toBe('4 pages numbered');
    expect((await contents(out.blob)).pages).toBe(4);
  });
  it('numbers every page and keeps the page count', async () => {
    const out = await addPageNumbers(file('mixed.pdf'), { start: 5, style: 'page-of' });
    expect(out.name).toBe('mixed-numbered.pdf');
    expect(out.summary).toBe('3 pages numbered');
    expect((await contents(out.blob)).pages).toBe(3);
  });
  it('rejects an encrypted PDF with a clear code', async () => {
    await expect(addPageNumbers(file('user-password.pdf'))).rejects.toMatchObject({ code: 'PDF_PASSWORD' });
  });
});

describe('watermarkPdf', () => {
  it('stamps every page', async () => {
    const out = await watermarkPdf(file('mixed.pdf'), { text: 'CONFIDENTIAL', opacity: 0.3 });
    expect(out.summary).toBe('3 pages watermarked');
    expect((await contents(out.blob)).pages).toBe(3);
  });
  it('refuses empty or undrawable text instead of producing a blank stamp', async () => {
    await expect(watermarkPdf(file('mixed.pdf'), { text: '  ' })).rejects.toMatchObject({ code: 'NO_WATERMARK' });
    await expect(watermarkPdf(file('mixed.pdf'), { text: 'गोपनीय' })).rejects.toMatchObject({ code: 'NO_WATERMARK' });
  });
  it('keeps Latin-1 text and drops what the standard fonts cannot draw', () => {
    expect(winAnsiSafe('Café ✓ 2026')).toBe('Café  2026');
  });
});
