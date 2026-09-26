// Single source of truth for brand, tool pages and their search copy.
// Used by the Vite build (prerendered pages, sitemap, llms.txt) and by the app.
import type { Op } from './engine/pdf.ts';

/** qpdf jobs (engine/pdf.ts) plus the tools that run in engine/local.ts. */
export type ToolOp = Op | 'jpg-to-pdf' | 'pdf-to-jpg' | 'office-clean' | 'office-images';
export type Format = 'pdf' | 'word' | 'excel' | 'powerpoint';

export const SITE = {
  name: 'Fizzdoc',
  url: 'https://fizzdoc.in',
  repo: 'https://github.com/kingrishabdugar/localpdf',
  tagline: 'Private PDF, Word, Excel and PowerPoint tools that never upload your files',
};

export interface Tool {
  op: ToolOp;
  format: Format;
  slug: string;
  name: string;
  /** One line for tool cards. */
  summary: string;
  /** Verb on the action button. */
  action: string;
  title: string;
  description: string;
  h1: string;
  lede: string;
  steps: string[];
  faq: [question: string, answer: string][];
}

const PRIVACY_FAQ: [string, string][] = [
  [
    'Are my files uploaded anywhere?',
    'No. Fizzdoc does the work inside your browser tab, using open-source engines compiled to WebAssembly and JavaScript. Your file is read from your device, processed locally, and the result is saved straight back to your device. You can check this yourself: open your browser’s developer tools, go to the Network tab, and run a job — no request carries your file.',
  ],
  [
    'Is Fizzdoc free?',
    'Yes. There is no sign-up, no watermark and no daily limit. Fizzdoc is open source under the MIT license.',
  ],
];

export const TOOLS: Tool[] = [
  {
    op: 'merge',
    format: 'pdf',
    slug: 'merge-pdf',
    name: 'Merge PDF',
    summary: 'Combine several PDFs into one, in the order you choose.',
    action: 'Merge PDFs',
    title: 'Merge PDF Files Privately — No Upload, Free | Fizzdoc',
    description:
      'Combine PDF files in your browser. Nothing is uploaded, and form fields and links are kept. Free, no sign-up, open source.',
    h1: 'Merge PDF files without uploading them',
    lede: 'Combine PDFs into one document right in your browser. Nothing is sent to a server, and form fields and internal links survive the merge.',
    steps: [
      'Add two or more PDF files — drag them in or click to choose.',
      'Put them in order with the ↑ and ↓ buttons.',
      'Click “Merge PDFs” and download the combined file.',
    ],
    faq: [
      PRIVACY_FAQ[0],
      [
        'Will bookmarks, form fields and links survive?',
        'Form fields and internal links from every file are kept. Bookmarks from the first file are kept; bookmarks from the other files cannot be combined yet, and Fizzdoc tells you when that happens instead of dropping them silently.',
      ],
      [
        'Can I merge password-protected PDFs?',
        'Yes. You are asked for the password on your device, and the merged file is saved without a password.',
      ],
      [
        'Is there a size limit?',
        'There is no page limit. The size limit depends on your device’s memory — usually several hundred megabytes in total — and Fizzdoc tells you before starting if a job is too large for your device.',
      ],
      PRIVACY_FAQ[1],
    ],
  },
  {
    op: 'split',
    format: 'pdf',
    slug: 'split-pdf',
    name: 'Split PDF',
    summary: 'Extract the pages you need into a new PDF.',
    action: 'Extract pages',
    title: 'Split PDF & Extract Pages Privately — No Upload | Fizzdoc',
    description:
      'Extract pages from a PDF in your browser. Pick ranges like 1-3, 8 — your file never leaves your device. Free, no sign-up, open source.',
    h1: 'Split a PDF and extract pages — privately',
    lede: 'Pull the pages you need into a new PDF. Type ranges like “1-3, 8”; the order you type is the order you get.',
    steps: [
      'Add one PDF file.',
      'Type the pages to keep, for example “1-3, 8” or “5-” for page 5 to the end.',
      'Click “Extract pages” and download the new PDF.',
    ],
    faq: [
      PRIVACY_FAQ[0],
      [
        'Can I reorder pages while extracting?',
        'Yes. Pages come out in the order you type them, so “3, 1-2” puts page 3 first.',
      ],
      [
        'What happens to bookmarks and form fields?',
        'Bookmarks are kept. If a bookmark points to a page you did not keep, Fizzdoc warns you. Form fields on removed pages are removed cleanly.',
      ],
      PRIVACY_FAQ[1],
    ],
  },
  {
    op: 'rotate',
    format: 'pdf',
    slug: 'rotate-pdf',
    name: 'Rotate PDF',
    summary: 'Turn sideways pages the right way, permanently.',
    action: 'Rotate pages',
    title: 'Rotate PDF Pages Permanently — No Upload | Fizzdoc',
    description:
      'Rotate all or selected PDF pages by 90°, 180° or 270° and save the result. Runs in your browser; your file is never uploaded.',
    h1: 'Rotate PDF pages and save them that way',
    lede: 'Fix sideways scans for good. Rotate every page or just the ones you choose — without re-rendering, so quality is untouched.',
    steps: [
      'Add one PDF file.',
      'Choose the angle and, optionally, which pages to rotate.',
      'Click “Rotate pages” and download the fixed PDF.',
    ],
    faq: [
      PRIVACY_FAQ[0],
      [
        'Does rotating reduce quality?',
        'No. Fizzdoc changes each page’s rotation setting; the page content is not re-rendered or re-compressed.',
      ],
      ['Can I rotate only some pages?', 'Yes. Enter pages like “2, 5-7”, or leave the field empty to rotate every page.'],
      PRIVACY_FAQ[1],
    ],
  },
  {
    op: 'delete',
    format: 'pdf',
    slug: 'delete-pdf-pages',
    name: 'Delete PDF Pages',
    summary: 'Remove pages you don’t want to share.',
    action: 'Delete pages',
    title: 'Delete Pages from a PDF — Private, No Upload | Fizzdoc',
    description:
      'Remove unwanted pages from a PDF in your browser. Type the pages to delete; your file never leaves your device. Free and open source.',
    h1: 'Delete pages from a PDF — privately',
    lede: 'Remove blank, duplicate or confidential pages before you share a document, without handing it to anyone.',
    steps: [
      'Add one PDF file.',
      'Type the pages to delete, for example “2, 7-9”.',
      'Click “Delete pages” and download the shorter PDF.',
    ],
    faq: [
      PRIVACY_FAQ[0],
      [
        'Are deleted pages really gone?',
        'Yes. Removed pages are not written to the new file. Your original file on your device is not changed.',
      ],
      PRIVACY_FAQ[1],
    ],
  },
  {
    op: 'unlock',
    format: 'pdf',
    slug: 'unlock-pdf',
    name: 'Unlock PDF',
    summary: 'Save a copy without the password you know.',
    action: 'Remove password',
    title: 'Remove a PDF Password (Unlock PDF) — No Upload | Fizzdoc',
    description:
      'Remove the password from a PDF you are allowed to open. Decryption happens on your device and nothing is uploaded. Free, no sign-up.',
    h1: 'Remove a PDF password — on your device',
    lede: 'Save an unlocked copy of a protected PDF you can already open. The password and the document stay on your device.',
    steps: [
      'Add the protected PDF.',
      'Click “Remove password” and type the password when asked.',
      'Download the unlocked copy.',
    ],
    faq: [
      PRIVACY_FAQ[0],
      [
        'Can Fizzdoc crack a password I do not know?',
        'No. Fizzdoc removes protection only when you know the password, or when the PDF opens without one and only restricts editing or printing. Only unlock files you have the right to modify.',
      ],
      [
        'Is my password sent anywhere?',
        'No. The password is typed into this page and used only by the engine running in your browser tab. It is not stored or logged.',
      ],
      PRIVACY_FAQ[1],
    ],
  },
  {
    op: 'protect',
    format: 'pdf',
    slug: 'protect-pdf',
    name: 'Protect PDF',
    summary: 'Lock a PDF with a password and AES-256 encryption.',
    action: 'Protect PDF',
    title: 'Password Protect a PDF with AES-256 — No Upload | Fizzdoc',
    description:
      'Add a password to a PDF with AES-256 encryption, right in your browser. The file and the password never leave your device. Free, no sign-up.',
    h1: 'Password-protect a PDF — on your device',
    lede: 'Encrypt a PDF with AES-256 so it opens only with your password. Encryption happens in this tab; neither the file nor the password is sent anywhere.',
    steps: ['Add one PDF file.', 'Type a password twice.', 'Click “Protect PDF” and download the encrypted copy.'],
    faq: [
      PRIVACY_FAQ[0],
      [
        'How strong is the protection?',
        'Fizzdoc uses AES-256, the strongest encryption the PDF standard defines, via the qpdf engine. It opens in every modern PDF reader, including Adobe Acrobat, Chrome, Edge, Firefox and Preview.',
      ],
      [
        'What if I forget the password?',
        'It cannot be recovered — not by Fizzdoc, not by anyone. Keep the password somewhere safe, such as a password manager.',
      ],
      PRIVACY_FAQ[1],
    ],
  },
  {
    op: 'clean',
    format: 'pdf',
    slug: 'remove-pdf-metadata',
    name: 'Remove PDF Metadata',
    summary: 'Strip author, title, software and XMP details.',
    action: 'Remove metadata',
    title: 'Remove PDF Metadata (Author, Title, XMP) — No Upload | Fizzdoc',
    description:
      'Delete hidden PDF metadata such as author, title, creator app and XMP data before you share a file. Runs in your browser; nothing is uploaded.',
    h1: 'Remove hidden metadata from a PDF',
    lede: 'PDFs quietly record who wrote them, with which app, and when. Strip the author, title, subject, keywords, producer and XMP metadata before you share.',
    steps: ['Add one PDF file.', 'Click “Remove metadata”.', 'Download the clean copy.'],
    faq: [
      PRIVACY_FAQ[0],
      [
        'What exactly is removed?',
        'The document information dictionary (author, title, subject, keywords, creator and producer) and the XMP metadata stream. Only the modification date is kept, because the file really was just modified. Page content is untouched.',
      ],
      PRIVACY_FAQ[1],
    ],
  },
  {
    op: 'jpg-to-pdf',
    format: 'pdf',
    slug: 'jpg-to-pdf',
    name: 'JPG to PDF',
    summary: 'Turn photos and scans into one PDF.',
    action: 'Create PDF',
    title: 'JPG to PDF Converter — Private, No Upload, Free | Fizzdoc',
    description:
      'Convert JPG, PNG, WebP and other images to a single PDF in your browser. Photos never leave your device. No watermark, no sign-up.',
    h1: 'Convert JPG and PNG images to PDF — privately',
    lede: 'Combine photos, screenshots and scans into one PDF, one page per image, at full resolution. Your pictures stay on your device.',
    steps: [
      'Add one or more images — JPG, PNG, WebP, GIF and more.',
      'Put them in order with the ↑ and ↓ buttons.',
      'Click “Create PDF” and download it.',
    ],
    faq: [
      PRIVACY_FAQ[0],
      [
        'Is image quality reduced?',
        'No. JPG and PNG images are placed in the PDF as they are, without re-compression. Other formats are converted once at high quality.',
      ],
      ['Can I convert iPhone photos?', 'Yes, if your browser can display them. Safari opens HEIC photos directly; on other browsers, share them as JPG first.'],
      PRIVACY_FAQ[1],
    ],
  },
  {
    op: 'pdf-to-jpg',
    format: 'pdf',
    slug: 'pdf-to-jpg',
    name: 'PDF to JPG',
    summary: 'Save every page as a sharp JPG image.',
    action: 'Convert to JPG',
    title: 'PDF to JPG Converter — Private, No Upload, Free | Fizzdoc',
    description:
      'Convert each page of a PDF to a high-quality JPG image in your browser. Nothing is uploaded. Many pages download as one ZIP.',
    h1: 'Convert PDF pages to JPG images — privately',
    lede: 'Render every page to a crisp 150 DPI JPG using Mozilla’s pdf.js, right here in your browser. A multi-page PDF downloads as one ZIP.',
    steps: ['Add one PDF file.', 'Click “Convert to JPG”.', 'Download the image, or a ZIP with one image per page.'],
    faq: [
      PRIVACY_FAQ[0],
      [
        'What resolution are the images?',
        '150 DPI — sharp on screens and fine for printing at the original size. An A4 page becomes a 1240 × 1754 pixel image.',
      ],
      [
        'Does it work with password-protected PDFs?',
        'Remove the password first with Unlock PDF, then convert. Both steps stay on your device.',
      ],
      PRIVACY_FAQ[1],
    ],
  },
];

// Word, Excel and PowerPoint files (and Google Docs, Sheets and Slides downloaded as them) are ZIP
// packages, so the same two tools work for all three; only the words change.
const OFFICE = [
  { format: 'word', app: 'Word', ext: 'docx', google: 'Google Docs', thing: 'document' },
  { format: 'excel', app: 'Excel', ext: 'xlsx', google: 'Google Sheets', thing: 'spreadsheet' },
  { format: 'powerpoint', app: 'PowerPoint', ext: 'pptx', google: 'Google Slides', thing: 'presentation' },
] as const;

const googleFaq = (o: (typeof OFFICE)[number]): [string, string] => [
  `Does it work with ${o.google}?`,
  `Yes. In ${o.google}, choose File → Download → Microsoft ${o.app} (.${o.ext}), then add that file here. Nothing is sent to Google or to us.`,
];

for (const o of OFFICE) {
  TOOLS.push(
    {
      op: 'office-clean',
      format: o.format,
      slug: `remove-${o.format}-metadata`,
      name: `Remove ${o.app} Metadata`,
      summary: `Erase author, company and editor names from a .${o.ext}.`,
      action: 'Remove metadata',
      title: `Remove ${o.app} Metadata — Private, No Upload | Fizzdoc`,
      description: `Delete author, editor, company, title and thumbnail from a ${o.app} file in your browser. Works with ${o.google} downloads. Nothing is uploaded.`,
      h1: `Remove hidden metadata from a ${o.app} ${o.thing}`,
      lede: `Every .${o.ext} records who created it, who edited it last and which company it belongs to. Erase those details before you send it — without uploading the file anywhere.`,
      steps: [`Add one .${o.ext} file (from ${o.app} or ${o.google}).`, 'Click “Remove metadata”.', `Download the clean .${o.ext}.`],
      faq: [
        PRIVACY_FAQ[0],
        [
          'What is removed?',
          'Author, last modified by, title, subject, description, keywords, category, status, company, manager, hyperlink base, custom properties and the embedded preview thumbnail. Created and modified dates are kept because Office needs them. Your content is not touched.',
        ],
        googleFaq(o),
        PRIVACY_FAQ[1],
      ],
    },
    {
      op: 'office-images',
      format: o.format,
      slug: `extract-images-from-${o.format}`,
      name: `Extract Images from ${o.app}`,
      summary: `Save every picture in a .${o.ext} at original quality.`,
      action: 'Extract images',
      title: `Extract Images from ${o.app} — No Upload | Fizzdoc`,
      description: `Download every picture embedded in a ${o.app} ${o.thing} as a ZIP, at original resolution. Works with ${o.google} downloads. Runs in your browser.`,
      h1: `Extract all images from a ${o.app} ${o.thing}`,
      lede: `Get every photo, logo and chart image out of a .${o.ext} in its original format and resolution — no screenshots, no re-compression, no upload.`,
      steps: [`Add one .${o.ext} file (from ${o.app} or ${o.google}).`, 'Click “Extract images”.', 'Download the ZIP of images.'],
      faq: [
        PRIVACY_FAQ[0],
        [
          'Are the images reduced in quality?',
          'No. They are copied out exactly as they are stored inside the file, in their original format (PNG, JPG, GIF, SVG, EMF and so on).',
        ],
        googleFaq(o),
        PRIVACY_FAQ[1],
      ],
    },
  );
}

export const FORMATS: Record<Format, { label: string; badge: string; ext: string }> = {
  pdf: { label: 'PDF', badge: 'PDF', ext: 'pdf' },
  word: { label: 'Word', badge: 'DOC', ext: 'docx' },
  excel: { label: 'Excel', badge: 'XLS', ext: 'xlsx' },
  powerpoint: { label: 'PowerPoint', badge: 'PPT', ext: 'pptx' },
};

export const HOME = {
  title: 'Fizzdoc — Private PDF, Word, Excel & PowerPoint Tools. No Uploads.',
  description:
    'Merge, split, protect and convert PDFs, and clean Word, Excel and PowerPoint files — right in your browser. Zero uploads, no sign-up, free and open source.',
  h1: 'Document tools that never see your documents',
  lede: 'Merge, split, protect and convert PDFs. Clean Word, Excel and PowerPoint files. Everything runs in your browser — your files never leave your device.',
  what: 'Fizzdoc is a free, open-source set of document tools that runs entirely in your web browser. PDFs are processed with the qpdf and pdf.js engines, and Office files are handled locally too, so nothing is ever uploaded to a server.',
  faq: [
    PRIVACY_FAQ[0],
    [
      'How is Fizzdoc different from iLovePDF, Smallpdf or Adobe’s online tools?',
      'Those services upload your document to their servers to process it. Fizzdoc does the work in your browser tab instead, so there is nothing to upload, store or delete afterwards. It is also open source, and it warns you whenever something such as a bookmark cannot be carried over instead of silently dropping it.',
    ],
    [
      'Does it work with Google Docs, Sheets and Slides?',
      'Yes. Download the file from Google as a Word, Excel or PowerPoint file (File → Download) and use the matching Fizzdoc tool. Nothing is sent to Google or to Fizzdoc.',
    ],
    [
      'Does it work on my phone?',
      'Yes. Fizzdoc works in current versions of Chrome, Safari, Firefox and Edge on desktop and mobile. Very large files may exceed a phone’s memory; Fizzdoc checks this before starting.',
    ],
    PRIVACY_FAQ[1],
  ] as [string, string][],
};
