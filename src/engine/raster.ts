// Redraws every page of a PDF as an image. Redact PDF burns its marks in, so the text under them is
// gone from the file, and PDF to scanned PDF uses the same path with an optional scanner look.
import { PDFDocument, PDFHexString, PDFOperator, PDFOperatorNames as Op, PDFNumber, type PDFRef } from 'pdf-lib';
import { LocalError, type Output } from './local';

/** A marked area in PDF user space (unrotated page coordinates, y up). */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export type Look = 'color' | 'gray' | 'scanned';

export interface RasterOptions {
  /** 150 keeps files small, 300 keeps small print sharp. */
  dpi: number;
  look: Look;
  /** Areas to paint black on each page (0-based page index). */
  marks?: (page: number) => Box[];
  /** Adds the visible text outside the marks back as an invisible layer, so the file stays searchable. */
  keepText?: boolean;
}

type Matrix = [number, number, number, number, number, number];
/** `outer` after `inner`, in PDF's [a b c d e f] form. */
const multiply = (outer: Matrix, inner: Matrix): Matrix => [
  outer[0] * inner[0] + outer[2] * inner[1],
  outer[1] * inner[0] + outer[3] * inner[1],
  outer[0] * inner[2] + outer[2] * inner[3],
  outer[1] * inner[2] + outer[3] * inner[3],
  outer[0] * inner[4] + outer[2] * inner[5] + outer[4],
  outer[1] * inner[4] + outer[3] * inner[5] + outer[5],
];
const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

interface TextRun {
  str: string;
  transform: Matrix;
  width: number;
  height: number;
}

/** A run's area in PDF space, padded like the search marks so it errs on the side of touching a mark. */
function runBox(run: TextRun): Box {
  const [a, b, c, d, e, f] = run.transform;
  const size = Math.hypot(a, b) || 1;
  const up = Math.hypot(c, d) || 1;
  const height = Math.max(run.height, size);
  const corners = [
    [-size * 0.35, -height * 0.3],
    [run.width + size * 0.35, -height * 0.3],
    [-size * 0.35, height * 1.05],
    [run.width + size * 0.35, height * 1.05],
  ].map(([along, across]) => [e + (a / size) * along + (c / up) * across, f + (b / size) * along + (d / up) * across]);
  const xs = corners.map((p) => p[0]);
  const ys = corners.map((p) => p[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/**
 * A font with no glyphs whose codes are the text's own UTF-16 units, the way OCR tools add an invisible
 * text layer. Nothing is ever drawn with it, so any script can be searched and copied.
 */
function glyphlessFont(out: PDFDocument): PDFRef {
  const ranges = Array.from({ length: 256 }, (_, hi) => {
    const h = hi.toString(16).padStart(2, '0').toUpperCase();
    return `<${h}00> <${h}FF> <${h}00>`;
  });
  const cmap = [
    '/CIDInit /ProcSet findresource begin 12 dict begin begincmap',
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
    '/CMapName /Adobe-Identity-UCS def /CMapType 2 def',
    '1 begincodespacerange <0000> <FFFF> endcodespacerange',
    ...[0, 100, 200].map((start) => {
      const chunk = ranges.slice(start, start + 100);
      return `${chunk.length} beginbfrange\n${chunk.join('\n')}\nendbfrange`;
    }),
    'endcmap CMapName currentdict /CMap defineresource pop end end',
  ].join('\n');
  const descriptor = out.context.obj({
    Type: 'FontDescriptor',
    FontName: 'GlyphLessFont',
    Flags: 5,
    FontBBox: [0, 0, 1000, 1000],
    ItalicAngle: 0,
    Ascent: 1000,
    Descent: 0,
    CapHeight: 1000,
    StemV: 80,
  });
  const cid = out.context.obj({
    Type: 'Font',
    Subtype: 'CIDFontType2',
    BaseFont: 'GlyphLessFont',
    CIDSystemInfo: { Registry: PDFHexString.fromText('Adobe'), Ordering: PDFHexString.fromText('Identity'), Supplement: 0 },
    FontDescriptor: out.context.register(descriptor),
    DW: 1000,
    CIDToGIDMap: 'Identity',
  });
  return out.context.register(
    out.context.obj({
      Type: 'Font',
      Subtype: 'Type0',
      BaseFont: 'GlyphLessFont',
      Encoding: 'Identity-H',
      DescendantFonts: [out.context.register(cid)],
      ToUnicode: out.context.register(out.context.flateStream(cmap)),
    }),
  );
}

/** True when the area holds visible ink: text under a box, or white on white, renders as one flat colour. */
function showsInk(context: OffscreenCanvasRenderingContext2D, x: number, y: number, width: number, height: number) {
  const [x0, y0] = [Math.max(0, Math.floor(x)), Math.max(0, Math.floor(y))];
  const [x1, y1] = [Math.min(context.canvas.width, Math.ceil(x + width)), Math.min(context.canvas.height, Math.ceil(y + height))];
  if (x1 - x0 < 1 || y1 - y0 < 1) return false;
  const { data } = context.getImageData(x0, y0, x1 - x0, y1 - y0);
  let [low, high] = [255, 0];
  for (let i = 0; i < data.length; i += 4) {
    const light = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    if (light < low) low = light;
    if (light > high) high = light;
  }
  return high - low > 40;
}

/**
 * True when the run's letters can be seen on the rendered page. Each letter gets an equal share of the
 * run's width; two blank letters in a row (a word under a box, or white on white), or no ink at all,
 * hide the whole run.
 */
function visible(context: OffscreenCanvasRenderingContext2D, viewport: { convertToViewportPoint(x: number, y: number): number[] }, run: TextRun) {
  const [a, b, c, d, e, f] = run.transform;
  const size = Math.hypot(a, b) || 1;
  const up = Math.hypot(c, d) || 1;
  const height = Math.max(run.height, size) * 0.75;
  const cell = run.width / run.str.length;
  let [blank, inked] = [0, 0];
  for (let i = 0; i < run.str.length; i++) {
    if (/\s/.test(run.str[i])) {
      blank = 0;
      continue;
    }
    const corners = [
      [i * cell, 0],
      [(i + 1) * cell, height],
    ].map(([along, across]) => viewport.convertToViewportPoint(e + (a / size) * along + (c / up) * across, f + (b / size) * along + (d / up) * across));
    const [[ax, ay], [bx, by]] = corners;
    const ink = showsInk(context, Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay));
    [blank, inked] = ink ? [0, inked + 1] : [blank + 1, inked];
    if (blank >= 2) return false;
  }
  return inked > 0;
}

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
export type PdfDoc = Awaited<ReturnType<PdfJs['getDocument']>['promise']>;

export async function openPdf(file: File): Promise<PdfDoc> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default;
  try {
    return await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  } catch (error) {
    throw new LocalError((error as { name?: string }).name === 'PasswordException' ? 'PDF_PASSWORD' : 'INVALID_PDF');
  }
}

/** Small, fixed tile of paper grain, laid over "scanned" pages. Deterministic so tests are stable. */
function grain() {
  const tile = new OffscreenCanvas(128, 128);
  const context = tile.getContext('2d')!;
  const pixels = context.createImageData(128, 128);
  let seed = 7;
  for (let i = 0; i < pixels.data.length; i += 4) {
    seed = (seed * 16807) % 2147483647;
    const shade = seed % 256;
    pixels.data.set([shade, shade, shade, 255], i);
  }
  context.putImageData(pixels, 0, 0);
  return tile;
}

export async function rasterize(
  doc: PdfDoc,
  name: string,
  { dpi, look, marks, keepText }: RasterOptions,
  onProgress?: (fraction: number) => void,
): Promise<Output> {
  const out = await PDFDocument.create();
  out.setProducer('Fizzdoc');
  out.setCreator('Fizzdoc');
  const texture = look === 'scanned' ? grain() : undefined;
  let marked = 0;
  let font: PDFRef | undefined;
  for (let index = 0; index < doc.numPages; index++) {
    const page = await doc.getPage(index + 1);
    const size = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: dpi / 72 });
    const width = Math.ceil(viewport.width);
    const height = Math.ceil(viewport.height);
    const render = new OffscreenCanvas(width, height);
    const renderContext = render.getContext('2d')!;
    renderContext.fillStyle = '#fff'; // PDFs assume white paper; JPEG has no transparency
    renderContext.fillRect(0, 0, width, height);
    await page.render({
      canvas: render as unknown as HTMLCanvasElement,
      canvasContext: renderContext as unknown as CanvasRenderingContext2D,
      viewport,
    }).promise;
    renderContext.fillStyle = '#000';
    for (const box of marks?.(index) ?? []) {
      const [ax, ay] = viewport.convertToViewportPoint(box.x0, box.y0);
      const [bx, by] = viewport.convertToViewportPoint(box.x1, box.y1);
      renderContext.fillRect(Math.floor(Math.min(ax, bx)), Math.floor(Math.min(ay, by)), Math.ceil(Math.abs(bx - ax)) + 1, Math.ceil(Math.abs(by - ay)) + 1);
      marked++;
    }

    // The text left showing on the page, checked against the marks and against the rendered page.
    const keep: TextRun[] = [];
    if (keepText) {
      const covered = marks?.(index) ?? [];
      for (const item of (await page.getTextContent()).items as unknown as TextRun[]) {
        if (typeof item.str !== 'string' || !item.str.trim() || !item.width) continue;
        const box = runBox(item);
        if (covered.some((mark) => overlaps(mark, box))) continue;
        if (visible(renderContext, viewport, item)) keep.push(item);
      }
    }

    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d')!;
    context.fillStyle = look === 'scanned' ? '#f4f3ef' : '#fff';
    context.fillRect(0, 0, width, height);
    if (look !== 'color') context.filter = look === 'scanned' ? 'grayscale(1) contrast(1.15) brightness(0.97)' : 'grayscale(1)';
    if (look === 'scanned') {
      // A slight, page-dependent tilt, like a sheet laid on a scanner by hand.
      context.translate(width / 2, height / 2);
      context.rotate(((index % 2 ? -1 : 1) * (0.25 + (index % 3) * 0.1) * Math.PI) / 180);
      context.translate(-width / 2, -height / 2);
    }
    context.drawImage(render, 0, 0);
    context.resetTransform();
    context.filter = 'none';
    if (texture) {
      context.globalAlpha = 0.05;
      context.fillStyle = context.createPattern(texture, 'repeat')!;
      context.fillRect(0, 0, width, height);
      context.globalAlpha = 1;
    }
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
    const image = await out.embedJpg(new Uint8Array(await blob.arrayBuffer()));
    const sheet = out.addPage([size.width, size.height]);
    sheet.drawImage(image, { x: 0, y: 0, width: size.width, height: size.height });
    if (keep.length) {
      font ??= glyphlessFont(out);
      const key = sheet.node.newFontDictionary('GlyphLessFont', font);
      // PDF space to the upright output page: the page's own rotation and crop, then y up again.
      const place = multiply([1, 0, 0, -1, 0, size.height], size.transform as Matrix);
      const operators = [PDFOperator.of(Op.BeginText), PDFOperator.of(Op.SetFontAndSize, [key, PDFNumber.of(1)]), PDFOperator.of(Op.SetTextRenderingMode, [PDFNumber.of(3)])];
      for (const run of keep) {
        const units = run.str.replace(/[\uD800-\uDFFF]/g, '');
        if (!units) continue;
        const fontSize = Math.hypot(run.transform[0], run.transform[1]) || 1;
        const matrix = multiply(place, run.transform);
        const hex = [...units].map((char) => char.charCodeAt(0).toString(16).padStart(4, '0')).join('');
        operators.push(
          PDFOperator.of(Op.SetTextMatrix, matrix.map((n) => PDFNumber.of(n))),
          // Stretch the run so selecting it highlights the same width as the words on the image.
          PDFOperator.of(Op.SetTextHorizontalScaling, [PDFNumber.of((100 * run.width) / (units.length * fontSize))]),
          PDFOperator.of(Op.ShowText, [PDFHexString.of(hex)]),
        );
      }
      operators.push(PDFOperator.of(Op.EndText));
      sheet.pushOperators(...operators);
    }
    page.cleanup();
    onProgress?.((index + 1) / doc.numPages);
  }
  const pages = doc.numPages;
  return {
    blob: new Blob([(await out.save()) as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }),
    name: `${name}-${marked ? 'redacted' : 'scanned'}.pdf`,
    summary: `${pages} ${pages === 1 ? 'page' : 'pages'}`,
  };
}

/** PDF to scanned PDF: every page becomes an image, with no selectable text left. */
export async function scanPdf(file: File, options: RasterOptions, onProgress?: (fraction: number) => void): Promise<Output> {
  const doc = await openPdf(file);
  try {
    return await rasterize(doc, file.name.replace(/\.pdf$/i, ''), options, onProgress);
  } finally {
    await doc.loadingTask.destroy();
  }
}
