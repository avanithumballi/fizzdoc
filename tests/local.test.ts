import { readFileSync } from 'node:fs';
import { strFromU8, unzipSync } from 'fflate';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { cleanOffice, extractOfficeImages, imagesToPdf } from '../src/engine/local';

const file = (name: string, type = '') =>
  new File([readFileSync(new URL(`./fixtures/${name}`, import.meta.url))], name, { type });
const unzip = async (blob: Blob) => unzipSync(new Uint8Array(await blob.arrayBuffer()));

describe.each(['report.docx', 'sheet.xlsx', 'deck.pptx'])('%s', (name) => {
  it('loses author, editor and title but keeps its content and a valid package', async () => {
    const original = await unzip(file(name));
    const cleaned = await unzip((await cleanOffice(file(name))).blob);
    const core = strFromU8(cleaned['docProps/core.xml']);
    expect(strFromU8(original['docProps/core.xml'])).toContain('Secret Author');
    expect(core).not.toMatch(/Secret|Private title|internal only/);
    expect(Object.keys(cleaned).filter((p) => !p.startsWith('docProps/thumbnail'))).toEqual(
      Object.keys(original).filter((p) => !p.startsWith('docProps/thumbnail')),
    );
    // No relationship may point at the removed thumbnail.
    expect(strFromU8(cleaned['_rels/.rels'])).not.toContain('thumbnail');
    const body = Object.keys(original).find((p) => /^(word\/document|xl\/worksheets\/sheet1|ppt\/slides\/slide1)\.xml$/.test(p))!;
    expect(cleaned[body]).toEqual(original[body]);
  });

  it('extracts its embedded picture', async () => {
    const result = await extractOfficeImages(file(name));
    expect(Object.keys(await unzip(result.blob))).toEqual(['image1.png']);
    expect(result.summary).toBe('1 image');
  });
});

it('rejects files that are not Office documents', async () => {
  await expect(cleanOffice(file('photo.png'))).rejects.toThrow('NOT_OFFICE');
});

it('turns JPEG and PNG images into one PDF page each', async () => {
  const result = await imagesToPdf([file('photo.jpg', 'image/jpeg'), file('photo.png', 'image/png')]);
  const pdf = await PDFDocument.load(await result.blob.arrayBuffer());
  expect(pdf.getPages().map((page) => [page.getWidth(), page.getHeight()])).toEqual([[120, 80], [120, 80]]);
  expect(result.summary).toBe('2 pages');
});
