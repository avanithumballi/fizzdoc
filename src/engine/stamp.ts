// Page numbers and text watermarks, drawn onto existing pages with pdf-lib. The original page
// content is kept as it is; the stamp is added on top.
import { LocalError, type Output } from './local';

export type NumberPosition = 'bottom-center' | 'bottom-right' | 'top-right';

const baseName = (file: File) => file.name.replace(/\.[^.]+$/, '');

async function load(file: File) {
  const { PDFDocument } = await import('pdf-lib');
  try {
    return await PDFDocument.load(new Uint8Array(await file.arrayBuffer()));
  } catch (error) {
    // pdf-lib's error classes lose instanceof after transpiling, so match the message.
    throw new LocalError(/encrypt/i.test(String(error)) ? 'PDF_PASSWORD' : 'INVALID_PDF');
  }
}

async function save(pdf: Awaited<ReturnType<typeof load>>, name: string, summary: string): Promise<Output> {
  const bytes = await pdf.save();
  return { blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }), name, summary };
}

/** Where a label of `width` sits on a page, in the page's visible (CropBox) coordinates. */
export function numberAt(position: NumberPosition, box: { x: number; y: number; width: number; height: number }, width: number, size: number) {
  const margin = Math.max(18, Math.min(box.width, box.height) * 0.04);
  const x = position === 'bottom-center' ? box.x + (box.width - width) / 2 : box.x + box.width - margin - width;
  const y = position === 'top-right' ? box.y + box.height - margin - size : box.y + margin;
  return { x, y };
}

/** Maps a point on a page as displayed (after its /Rotate, clockwise) back to the page's own coordinates. */
export function fromDisplayed(rotation: number, box: { x: number; y: number; width: number; height: number }, u: number, v: number) {
  switch (rotation) {
    case 90:
      return { x: box.x + box.width - v, y: box.y + u };
    case 180:
      return { x: box.x + box.width - u, y: box.y + box.height - v };
    case 270:
      return { x: box.x + v, y: box.y + box.height - u };
    default:
      return { x: box.x + u, y: box.y + v };
  }
}

export async function addPageNumbers(
  file: File,
  options: { position?: NumberPosition; start?: number; style?: 'number' | 'page-of' } = {},
): Promise<Output> {
  const pdf = await load(file);
  const { StandardFonts, rgb, degrees } = await import('pdf-lib');
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const pages = pdf.getPages();
  const start = Number.isInteger(options.start) && options.start! > 0 ? options.start! : 1;
  const total = start + pages.length - 1;
  pages.forEach((page, i) => {
    const label = options.style === 'page-of' ? `Page ${start + i} of ${total}` : String(start + i);
    const box = page.getCropBox();
    const size = Math.max(8, Math.min(box.width, box.height) * 0.018);
    // Place the number on the page as it is displayed, then map it back into the page's own
    // coordinates and turn the text with the page, so /Rotate'd pages read upright too.
    const rotation = ((page.getRotation().angle % 360) + 360) % 360;
    const sideways = rotation === 90 || rotation === 270;
    const shown = { x: 0, y: 0, width: sideways ? box.height : box.width, height: sideways ? box.width : box.height };
    const at = numberAt(options.position ?? 'bottom-center', shown, font.widthOfTextAtSize(label, size), size);
    const { x, y } = fromDisplayed(rotation, box, at.x, at.y);
    page.drawText(label, { x, y, size, font, color: rgb(0.2, 0.2, 0.2), rotate: degrees(rotation) });
  });
  return save(pdf, `${baseName(file)}-numbered.pdf`, `${pages.length} ${pages.length === 1 ? 'page' : 'pages'} numbered`);
}

/** Characters the standard PDF fonts can draw; anything else would throw inside pdf-lib. */
export const winAnsiSafe = (text: string) => text.replace(/[^\x20-\x7E\xA0-\xFF]/g, '');

export async function watermarkPdf(file: File, options: { text: string; opacity?: number }): Promise<Output> {
  const text = winAnsiSafe(options.text).trim();
  if (!text) throw new LocalError('NO_WATERMARK');
  const pdf = await load(file);
  const { StandardFonts, rgb, degrees } = await import('pdf-lib');
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  const opacity = Math.min(1, Math.max(0.05, options.opacity ?? 0.2));
  const pages = pdf.getPages();
  for (const page of pages) {
    const box = page.getCropBox();
    // Diagonal across the page, as wide as ~70% of the diagonal.
    const angle = Math.atan2(box.height, box.width);
    const diagonal = Math.hypot(box.width, box.height);
    const size = Math.min(160, (diagonal * 0.7) / Math.max(1, font.widthOfTextAtSize(text, 1)));
    const width = font.widthOfTextAtSize(text, size);
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    // drawText rotates around the text origin, so start half the text back along the diagonal.
    const x = cx - (Math.cos(angle) * width) / 2 + (Math.sin(angle) * size) / 3;
    const y = cy - (Math.sin(angle) * width) / 2 - (Math.cos(angle) * size) / 3;
    page.drawText(text, { x, y, size, font, color: rgb(0.55, 0.55, 0.55), opacity, rotate: degrees((angle * 180) / Math.PI) });
  }
  return save(pdf, `${baseName(file)}-watermarked.pdf`, `${pages.length} ${pages.length === 1 ? 'page' : 'pages'} watermarked`);
}
