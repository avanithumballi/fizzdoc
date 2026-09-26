import { readFileSync } from 'node:fs';
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  buildDocxPackage,
  buildPptxPackage,
  docxToHtml,
  linesFromItems,
  paragraphsFromLines,
  parseXml,
  type DocParagraph,
} from '../src/engine/office';

const file = (name: string, type = '') =>
  new File([readFileSync(new URL(`./fixtures/${name}`, import.meta.url))], name, { type });
const unzip = (data: Uint8Array) => unzipSync(data);

describe('parseXml', () => {
  it('reads a tolerant tree, decodes entities and skips PIs/comments', () => {
    const root = parseXml('<?xml version="1.0"?><a x="1"><!-- c --><b>A &amp; B</b><c/></a>');
    const a = root.children[0];
    expect(a.tag).toBe('a');
    expect(a.attrs.x).toBe('1');
    expect(a.children.map((c) => c.tag)).toEqual(['b', 'c']);
    expect(a.children[0].children[0].attrs.value).toBe('A & B');
  });
});

describe('docxToHtml', () => {
  it('rejects non-Office files', async () => {
    await expect(docxToHtml(file('photo.png'))).rejects.toThrow('NOT_OFFICE');
  });

  it('rejects a zip that is not a Word document (e.g. an xlsx)', async () => {
    await expect(docxToHtml(file('sheet.xlsx'))).rejects.toThrow('NOT_OFFICE');
  });

  it('converts the plain report fixture: heading, text and an inline image', async () => {
    const { html, title } = await docxToHtml(file('report.docx'));
    expect(title).toBe('Private title'); // docProps/core.xml dc:title, not the heading text
    expect(html).toContain('<h1>Quarterly report</h1>');
    expect(html).toContain('Confidential numbers.');
    expect(html).toMatch(/<img src="data:image\/png;base64,/);
    expect(html).toContain('@page');
    expect(html).not.toMatch(/<script/i);
  });

  it('handles headings via basedOn, bold/italic/links, nested lists, merged+shaded table cells and page breaks', async () => {
    const { html, title } = await docxToHtml(file('rich.docx'));
    expect(title).toBe('Rich sample');
    expect(html).toContain('<h1>Rich document</h1>');
    expect(html).toContain('<h1>Custom-styled heading</h1>'); // resolved through basedOn -> "heading 1"
    expect(html).toContain('<strong>Bold</strong>');
    expect(html).toContain('<em>italic</em>');
    expect(html).toContain('<a href="https://example.com"><u>link</u></a>');
    expect(html).toMatch(/<ul>[\s\S]*<li[^>]*>Bullet one<\/li>[\s\S]*<ul>[\s\S]*<li[^>]*>Nested bullet<\/li>[\s\S]*<\/ul>[\s\S]*<\/ul>/);
    expect(html).toMatch(/<ol[^>]*>[\s\S]*Numbered one[\s\S]*Numbered two[\s\S]*<\/ol>/);
    expect(html).toMatch(/colspan="2"/);
    expect(html).toMatch(/rowspan="2"/);
    expect(html).toMatch(/background-color:#FFFF00/);
    expect(html).toContain('break-before:page');
    expect(html).toMatch(/<img src="data:image\/png;base64,/);
  });
});

describe('pdfToDocx text grouping (pure)', () => {
  const item = (str: string, x: number, y: number, size = 12, fontName = 'Helvetica', hasEOL = false) => ({
    str,
    transform: [size, 0, 0, size, x, y],
    width: str.length * size * 0.5,
    height: size,
    fontName,
    hasEOL,
  });

  it('groups same-baseline items into a line and adds a space across a gap', () => {
    const lines = linesFromItems([item('Hello', 0, 700), item('World', 40, 700)]);
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toBe('Hello World');
  });

  it('splits into paragraphs on a big vertical gap and keeps bold/italic hints', () => {
    const items = [
      item('Title', 0, 750, 24, 'Arial-Bold'),
      item('Body line one.', 0, 700, 12, 'Arial'),
      item('Body line two.', 0, 686, 12, 'Arial'),
      item('New paragraph.', 0, 640, 12, 'Arial-Italic'),
    ];
    const paragraphs = paragraphsFromLines(linesFromItems(items));
    expect(paragraphs.map((p) => p.text)).toEqual(['Title', 'Body line one. Body line two.', 'New paragraph.']);
    expect(paragraphs[0].bold).toBe(true);
    expect(paragraphs[2].italic).toBe(true);
  });

  it('strips a leading bullet glyph and flags the paragraph', () => {
    const paragraphs = paragraphsFromLines(linesFromItems([item('• First point', 0, 700)]));
    expect(paragraphs[0].bullet).toBe(true);
    expect(paragraphs[0].text).toBe('First point');
  });
});

describe('buildDocxPackage (pure)', () => {
  it('produces a structurally valid, well-formed docx', () => {
    const paragraphs: DocParagraph[][] = [
      [
        { text: 'Big Title', fontSize: 24, bold: false, italic: false, bullet: false },
        { text: 'Some body text here.', fontSize: 12, bold: false, italic: false, bullet: false },
      ],
      [{ text: 'Second page paragraph.', fontSize: 12, bold: true, italic: false, bullet: false }],
    ];
    const zipped = buildDocxPackage(paragraphs, { widthPt: 612, heightPt: 792 }, 'Converted PDF');
    const entries = unzip(zipped);
    expect(entries['[Content_Types].xml']).toBeDefined();
    expect(entries['_rels/.rels']).toBeDefined();
    expect(entries['word/document.xml']).toBeDefined();
    expect(entries['word/styles.xml']).toBeDefined();
    expect(entries['docProps/core.xml']).toBeDefined();
    expect(entries['docProps/app.xml']).toBeDefined();

    const rels = strFromU8(entries['_rels/.rels']);
    for (const target of ['word/document.xml', 'docProps/core.xml', 'docProps/app.xml']) expect(rels).toContain(target);

    const doc = strFromU8(entries['word/document.xml']);
    expect(doc).toContain('Big Title');
    expect(doc).toContain('Some body text here.');
    expect(doc).toContain('<w:pageBreakBefore/>'); // second page's first paragraph
    expect(doc).toContain('w:pStyle w:val="Title"'); // 2x body size -> promoted to the Title style
    expect(doc).toContain('<w:pgSz w:w="12240" w:h="15840"/>');
    // parses as XML without truncation
    const openTags = (doc.match(/<w:p>/g) ?? []).length;
    const closeTags = (doc.match(/<\/w:p>/g) ?? []).length;
    expect(openTags).toBe(closeTags);
  });
});

describe('buildPptxPackage (pure)', () => {
  const fakeJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]); // not a real image, only package structure is checked here

  it('produces a structurally valid pptx with one full-bleed picture per slide', () => {
    const images = [
      { width: 1600, height: 900, jpeg: fakeJpeg },
      { width: 1600, height: 900, jpeg: fakeJpeg },
      { width: 1600, height: 900, jpeg: fakeJpeg },
    ];
    const zipped = buildPptxPackage(images);
    const entries = unzip(zipped);

    const required = [
      '[Content_Types].xml',
      '_rels/.rels',
      'ppt/presentation.xml',
      'ppt/_rels/presentation.xml.rels',
      'ppt/slideMasters/slideMaster1.xml',
      'ppt/slideLayouts/slideLayout1.xml',
      'ppt/theme/theme1.xml',
      'docProps/core.xml',
      'docProps/app.xml',
    ];
    for (const path of required) expect(entries[path], path).toBeDefined();
    for (let i = 1; i <= 3; i++) {
      expect(entries[`ppt/slides/slide${i}.xml`], `slide${i}.xml`).toBeDefined();
      expect(entries[`ppt/slides/_rels/slide${i}.xml.rels`], `slide${i} rels`).toBeDefined();
      expect(entries[`ppt/media/image${i}.jpeg`], `image${i}.jpeg`).toBeDefined();
    }

    const contentTypes = strFromU8(entries['[Content_Types].xml']);
    for (let i = 1; i <= 3; i++) expect(contentTypes).toContain(`/ppt/slides/slide${i}.xml`);
    expect(contentTypes).toContain('image/jpeg');

    // every slide's r:embed target actually exists in the package
    for (let i = 1; i <= 3; i++) {
      const rels = strFromU8(entries[`ppt/slides/_rels/slide${i}.xml.rels`]);
      const target = /Target="([^"]+)"/.exec(rels)![1];
      const resolved = new URL(target, `zip:///ppt/slides/slide${i}.xml`).pathname.replace(/^\//, '');
      expect(entries[resolved], resolved).toBeDefined();
    }

    const presentation = strFromU8(entries['ppt/presentation.xml']);
    expect(presentation).toMatch(/<p:sldSz cx="\d+" cy="\d+"\/>/);
    // 16:9 aspect (1600x900) is preserved
    const [, cx, cy] = /<p:sldSz cx="(\d+)" cy="(\d+)"\/>/.exec(presentation)!;
    expect(Math.abs(Number(cx) / Number(cy) - 16 / 9)).toBeLessThan(0.01);
  });

  it('clamps slide size to PowerPoint limits for extreme aspect ratios', () => {
    const zipped = buildPptxPackage([{ width: 100000, height: 10, jpeg: fakeJpeg }]);
    const presentation = strFromU8(unzip(zipped)['ppt/presentation.xml']);
    const [, cx, cy] = /<p:sldSz cx="(\d+)" cy="(\d+)"\/>/.exec(presentation)!;
    expect(Number(cx)).toBeLessThanOrEqual(51206400);
    expect(Number(cy)).toBeGreaterThanOrEqual(914400);
  });
});
