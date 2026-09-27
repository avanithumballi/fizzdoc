// Redraws every page of a PDF as an image. Redact PDF burns its marks in, so the text under them is
// gone from the file, and PDF to scanned PDF uses the same path with an optional scanner look.
import { PDFDocument } from 'pdf-lib';
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
  { dpi, look, marks }: RasterOptions,
  onProgress?: (fraction: number) => void,
): Promise<Output> {
  const out = await PDFDocument.create();
  out.setProducer('Fizzdoc');
  out.setCreator('Fizzdoc');
  const texture = look === 'scanned' ? grain() : undefined;
  let marked = 0;
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
    out.addPage([size.width, size.height]).drawImage(image, { x: 0, y: 0, width: size.width, height: size.height });
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
