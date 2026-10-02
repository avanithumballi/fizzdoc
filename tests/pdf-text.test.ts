import { readFileSync } from 'node:fs';
import { PDFDict, PDFDocument, PDFName, StandardFonts, rgb } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import { editTextInPlace, parseContent, parseToUnicode, type TextEdit } from '../src/engine/pdf-text';
import { groupTextRuns, type TextItemLike } from '../src/tools/edit-pdf';

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
const latin1 = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));

async function readPage(bytes: Uint8Array) {
  const task = pdfjs.getDocument({ data: bytes.slice() });
  const doc = await task.promise;
  const page = await doc.getPage(1);
  const content = await page.getTextContent();
  const items = content.items as unknown as TextItemLike[];
  // pdf.js names fonts per document (g_d0_f2, g_d1_f2…); the f-number identifies the font itself.
  const fonts = new Map(items.filter((i) => i.str.trim()).map((i) => [i.str, i.fontName.replace(/^g_d\d+_/, '')]));
  const runs = groupTextRuns(items);
  await task.destroy();
  return { runs, fonts, text: runs.map((r) => r.text) };
}

async function edit(bytes: Uint8Array, from: string, to: string) {
  const { runs } = await readPage(bytes);
  const run = runs.find((r) => r.text === from);
  if (!run) throw new Error(`no line "${from}"`);
  const [a, b, c, d, e, f] = run.transform;
  const scale = Math.hypot(a, b);
  const change: TextEdit = { x: e, y: f, dir: [a / scale, b / scale], size: Math.hypot(c, d), width: run.width, text: run.text, newText: to };
  const doc = await PDFDocument.load(bytes);
  const [done] = editTextInPlace(doc, 0, [change]);
  return { done, bytes: await doc.save() };
}

describe('content stream parsing', () => {
  it('reads operators, escaped strings, arrays and skips inline images', () => {
    const ops = parseContent(latin1('BT /F1 12 Tf (a\\(b\\) \\101) Tj [(x) -250 <0041>] TJ ET\nBI /W 1 /H 1 ID \x00EI\x01 EI\nq Q'));
    expect(ops.map((o) => o.op)).toEqual(['BT', 'Tf', 'Tj', 'TJ', 'ET', 'BI', 'q', 'Q']);
    expect(String.fromCharCode(...ops[2].args[0].bytes!)).toBe('a(b) A');
    expect(ops[3].args[0].items!.map((t) => t.kind)).toEqual(['str', 'num', 'str']);
  });

  it('maps ToUnicode bfchar and bfrange entries', () => {
    const cmap = latin1('2 beginbfchar <0003> <0020> <0024> <0041> endbfchar 1 beginbfrange <0044> <0046> <0061> endbfrange');
    const map = parseToUnicode(cmap);
    expect([map.get(3), map.get(0x24), map.get(0x44), map.get(0x46)]).toEqual([' ', 'A', 'a', 'c']);
  });
});

describe('editing text in place', () => {
  it('rewrites a line in an embedded subset font and keeps that font', async () => {
    const original = fixture('chrome-text.pdf');
    const before = await readPage(original);
    const { done, bytes } = await edit(original, 'Billed to: Asha Verma, Pune', 'Billed to: Pune Verma, Asha');
    expect(done).toBe(true);
    const after = await readPage(bytes);
    expect(after.text).toContain('Billed to: Pune Verma, Asha');
    expect(after.text).not.toContain('Billed to: Asha Verma, Pune');
    expect(after.text).toContain('Thank you for your business.');
    // Same embedded font as before, not a stand-in.
    expect(after.fonts.get('Billed to: Pune Verma, Asha') ?? [...after.fonts.entries()].find(([s]) => s.startsWith('Billed'))![1]).toBe(
      [...before.fonts.entries()].find(([s]) => s.startsWith('Billed'))![1],
    );
    // The old wording is gone from the file, not just hidden.
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    expect(Buffer.from(bytes).includes(Buffer.from('<0025004C004F004F0048004700030057005200'))).toBe(false);
  });

  it('keeps a split, coloured bold line together', async () => {
    const { done, bytes } = await edit(fixture('chrome-text.pdf'), 'Total due: Rs 4,250', 'Total due: Rs 2,450');
    expect(done).toBe(true);
    expect((await readPage(bytes)).text).toContain('Total due: Rs 2,450');
  });

  it('says no when the font lacks a typed character, and leaves the page alone', async () => {
    const original = fixture('chrome-text.pdf');
    const { done, bytes } = await edit(original, 'Billed to: Asha Verma, Pune', 'Billed to: Zoë Quix');
    expect(done).toBe(false);
    expect((await readPage(bytes)).text).toContain('Billed to: Asha Verma, Pune');
  });

  it('can use any character of a standard font that is not embedded', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 200]);
    page.drawText('Hello world', { x: 40, y: 120, size: 18, font: await doc.embedFont(StandardFonts.HelveticaBold), color: rgb(0.8, 0, 0) });
    page.drawText('Second line', { x: 40, y: 80, size: 12, font: await doc.embedFont(StandardFonts.Helvetica) });
    const { done, bytes } = await edit(await doc.save(), 'Hello world', 'Hi there, Zoë!');
    expect(done).toBe(true);
    const after = await readPage(bytes);
    expect(after.text).toEqual(['Hi there, Zoë!', 'Second line']);
  });
});

describe('what in-place editing refuses', () => {
  it('only uses glyphs an embedded simple font is known to have', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 200]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText('cab', { x: 40, y: 120, size: 18, font });
    page.drawText('Other', { x: 40, y: 80, size: 18, font });
    // Pretend the font is an embedded subset, the way word processors save fonts.
    await doc.flush();
    const fontDict = doc.context.lookup(font.ref, PDFDict);
    fontDict.set(PDFName.of('FontDescriptor'), doc.context.obj({ Type: 'FontDescriptor', FontFile2: doc.context.register(doc.context.stream('x')) }));
    const bytes = await doc.save();
    expect((await edit(bytes, 'cab', 'abc')).done).toBe(true);
    expect((await edit(bytes, 'cab', 'cax')).done).toBe(false); // no "x" anywhere in the file
  });

  it('leaves scripts whose letters are reordered when drawn to the fallback', async () => {
    const doc = await PDFDocument.load(fixture('chrome-text.pdf'));
    const done = editTextInPlace(doc, 0, [{ x: 0, y: 0, dir: [1, 0], size: 12, width: 100, text: 'टीम', newText: 'टीम' }]);
    expect(done).toEqual([false]);
  });
});
