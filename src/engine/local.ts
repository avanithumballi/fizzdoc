// Conversions that don't need qpdf. Office files (.docx/.xlsx/.pptx, including Google Docs,
// Sheets and Slides downloads) are ZIP packages, so fflate is enough to work on them.
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';

export interface Output {
  blob: Blob;
  name: string;
  /** Human summary, e.g. "3 images". */
  summary: string;
}

export class LocalError extends Error {
  constructor(readonly code: 'NOT_OFFICE' | 'NO_IMAGES' | 'BAD_IMAGE' | 'PDF_PASSWORD' | 'INVALID_PDF' | 'BAD_SIZE' | 'NO_TEXT' | 'NO_WATERMARK') {
    super(code);
  }
}

const baseName = (file: File) => file.name.replace(/\.[^.]+$/, '');
const bytes = async (file: Blob) => new Uint8Array(await file.arrayBuffer());

function openPackage(data: Uint8Array) {
  try {
    const entries = unzipSync(data);
    if (!entries['[Content_Types].xml']) throw new Error();
    return entries;
  } catch {
    throw new LocalError('NOT_OFFICE');
  }
}

// Fields shown by "Inspect document" in Office; dates are kept because blanking them breaks validation.
const CORE_FIELDS = ['dc:creator', 'cp:lastModifiedBy', 'dc:title', 'dc:subject', 'dc:description', 'cp:keywords', 'cp:category', 'cp:contentStatus'];
const APP_FIELDS = ['Company', 'Manager', 'HyperlinkBase'];

const blank = (xml: string, tags: string[]) =>
  tags.reduce((out, tag) => out.replace(new RegExp(`<${tag}(\\s[^>]*)?>[\\s\\S]*?</${tag}>`, 'g'), `<${tag}$1></${tag}>`), xml);

/** Removes author, editor, company, title and the embedded first-page thumbnail. Content is untouched. */
export async function cleanOffice(file: File): Promise<Output> {
  const entries = openPackage(await bytes(file));
  const edit = (path: string, change: (xml: string) => string) => {
    if (entries[path]) entries[path] = strToU8(change(strFromU8(entries[path])));
  };
  edit('docProps/core.xml', (xml) => blank(xml, CORE_FIELDS));
  edit('docProps/app.xml', (xml) => blank(xml, APP_FIELDS));
  edit('docProps/custom.xml', (xml) => xml.replace(/(<vt:[a-z0-9]+>)[\s\S]*?(<\/vt:[a-z0-9]+>)/gi, '$1$2'));
  const thumbnail = Object.keys(entries).find((path) => /^docProps\/thumbnail\.\w+$/.test(path));
  if (thumbnail) {
    delete entries[thumbnail];
    // The package must not point at a part that no longer exists, or Office reports the file as damaged.
    edit('_rels/.rels', (xml) => xml.replace(new RegExp(`<Relationship[^>]*Target="/?${thumbnail.replace('.', '\\.')}"[^>]*/>`), ''));
  }
  const zipped = zipSync(entries as Zippable, { level: 6 });
  const extension = file.name.split('.').pop() ?? 'docx';
  return { blob: new Blob([zipped as Uint8Array<ArrayBuffer>], { type: file.type }), name: `${baseName(file)}-clean.${extension}`, summary: 'Metadata removed' };
}

/** Collects every picture embedded in a Word, Excel or PowerPoint file into one ZIP. */
export async function extractOfficeImages(file: File): Promise<Output> {
  const entries = openPackage(await bytes(file));
  const media: Zippable = {};
  for (const [path, data] of Object.entries(entries)) {
    const match = /^(?:word|xl|ppt)\/media\/(.+)$/.exec(path);
    if (match) media[match[1]] = [data, { level: 0 }];
  }
  const count = Object.keys(media).length;
  if (!count) throw new LocalError('NO_IMAGES');
  const zipped = zipSync(media);
  return {
    blob: new Blob([zipped as Uint8Array<ArrayBuffer>], { type: 'application/zip' }),
    name: `${baseName(file)}-images.zip`,
    summary: `${count} ${count === 1 ? 'image' : 'images'}`,
  };
}

/** One page per image, sized to the image. JPEG and PNG are embedded as-is; other formats go through a canvas. */
export async function imagesToPdf(files: File[]): Promise<Output> {
  const { PDFDocument } = await import('pdf-lib');
  const pdf = await PDFDocument.create();
  for (const file of files) {
    let data = await bytes(file);
    let type = file.type;
    if (type !== 'image/jpeg' && type !== 'image/png') {
      // WebP, GIF, BMP, AVIF…: the browser decodes them, we store a high-quality JPEG.
      try {
        const bitmap = await createImageBitmap(file);
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
        data = await bytes(await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 }));
        type = 'image/jpeg';
      } catch {
        throw new LocalError('BAD_IMAGE');
      }
    }
    let image;
    try {
      image = type === 'image/png' ? await pdf.embedPng(data) : await pdf.embedJpg(data);
    } catch {
      throw new LocalError('BAD_IMAGE');
    }
    pdf.addPage([image.width, image.height]).drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
  }
  const saved = await pdf.save();
  const pages = files.length;
  return {
    blob: new Blob([saved as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }),
    name: `${baseName(files[0])}${pages > 1 ? '-and-more' : ''}.pdf`,
    summary: `${pages} ${pages === 1 ? 'page' : 'pages'}`,
  };
}

/** Renders every page to a JPEG (or PNG) at 150 DPI with pdf.js; several pages come back as a ZIP. */
export async function pdfToImages(file: File, format: 'jpg' | 'png' = 'jpg'): Promise<Output> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs'); // legacy = polyfilled for browsers from 2023 on
  pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default;
  let doc;
  try {
    doc = await pdfjs.getDocument({ data: await bytes(file) }).promise;
  } catch (error) {
    throw new LocalError((error as { name?: string }).name === 'PasswordException' ? 'PDF_PASSWORD' : 'INVALID_PDF');
  }
  // ponytail: every page's JPEG is held in memory until the ZIP is built; stream the ZIP if
  // 1000-page PDFs on phones become a real use case.
  const images: Zippable = {};
  const name = baseName(file);
  let last: Blob | undefined;
  for (let number = 1; number <= doc.numPages; number++) {
    const page = await doc.getPage(number);
    const viewport = page.getViewport({ scale: 150 / 72 });
    const canvas = new OffscreenCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#fff'; // JPEG has no transparency; PDFs assume white paper.
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas: canvas as unknown as HTMLCanvasElement, canvasContext: context as unknown as CanvasRenderingContext2D, viewport }).promise;
    last = await canvas.convertToBlob(format === 'png' ? { type: 'image/png' } : { type: 'image/jpeg', quality: 0.9 });
    images[`${name}-page-${String(number).padStart(3, '0')}.${format}`] = [await bytes(last), { level: 0 }];
    page.cleanup();
  }
  const pages = doc.numPages;
  await doc.loadingTask.destroy();
  if (pages === 1) return { blob: last!, name: `${name}.${format}`, summary: '1 image' };
  return { blob: new Blob([zipSync(images) as Uint8Array<ArrayBuffer>], { type: 'application/zip' }), name: `${name}-images.zip`, summary: `${pages} images` };
}
