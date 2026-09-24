// Single source of truth for brand, tool pages and their search copy.
// Used by the Vite build (prerendered pages, sitemap, llms.txt) and by the app.
import type { Op } from './engine/pdf.ts';

export const SITE = {
  name: 'HushPDF',
  url: 'https://hushpdf.com',
  repo: 'https://github.com/kingrishabdugar/localpdf',
  tagline: 'Private PDF tools that never upload your files',
};

export interface Tool {
  op: Op;
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
    'No. HushPDF runs the open-source qpdf engine inside your browser with WebAssembly. Your PDF is read from your device, processed in a background worker, and the result is saved straight back to your device. You can check this yourself: open your browser’s developer tools, go to the Network tab, and run a job — no request carries your file.',
  ],
  [
    'Is HushPDF free?',
    'Yes. There is no sign-up, no watermark and no daily limit. HushPDF is open source under the MIT license.',
  ],
];

export const TOOLS: Tool[] = [
  {
    op: 'merge',
    slug: 'merge-pdf',
    name: 'Merge PDF',
    summary: 'Combine several PDFs into one, in the order you choose.',
    action: 'Merge PDFs',
    title: 'Merge PDF Files Privately — No Upload, Free | HushPDF',
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
        'Form fields and internal links from every file are kept. Bookmarks from the first file are kept; bookmarks from the other files cannot be combined yet, and HushPDF tells you when that happens instead of dropping them silently.',
      ],
      [
        'Can I merge password-protected PDFs?',
        'Yes. You are asked for the password on your device, and the merged file is saved without a password.',
      ],
      [
        'Is there a size limit?',
        'There is no page limit. The size limit depends on your device’s memory — usually several hundred megabytes in total — and HushPDF tells you before starting if a job is too large for your device.',
      ],
      PRIVACY_FAQ[1],
    ],
  },
  {
    op: 'split',
    slug: 'split-pdf',
    name: 'Split PDF',
    summary: 'Extract the pages you need into a new PDF.',
    action: 'Extract pages',
    title: 'Split PDF & Extract Pages Privately — No Upload | HushPDF',
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
        'Bookmarks are kept. If a bookmark points to a page you did not keep, HushPDF warns you. Form fields on removed pages are removed cleanly.',
      ],
      PRIVACY_FAQ[1],
    ],
  },
  {
    op: 'rotate',
    slug: 'rotate-pdf',
    name: 'Rotate PDF',
    summary: 'Turn sideways pages the right way, permanently.',
    action: 'Rotate pages',
    title: 'Rotate PDF Pages Permanently — No Upload | HushPDF',
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
        'No. HushPDF changes each page’s rotation setting; the page content is not re-rendered or re-compressed.',
      ],
      ['Can I rotate only some pages?', 'Yes. Enter pages like “2, 5-7”, or leave the field empty to rotate every page.'],
      PRIVACY_FAQ[1],
    ],
  },
  {
    op: 'delete',
    slug: 'delete-pdf-pages',
    name: 'Delete PDF Pages',
    summary: 'Remove pages you don’t want to share.',
    action: 'Delete pages',
    title: 'Delete Pages from a PDF — Private, No Upload | HushPDF',
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
    slug: 'unlock-pdf',
    name: 'Unlock PDF',
    summary: 'Save a copy without the password you know.',
    action: 'Remove password',
    title: 'Remove a PDF Password (Unlock PDF) — No Upload | HushPDF',
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
        'Can HushPDF crack a password I do not know?',
        'No. HushPDF removes protection only when you know the password, or when the PDF opens without one and only restricts editing or printing. Only unlock files you have the right to modify.',
      ],
      [
        'Is my password sent anywhere?',
        'No. The password is typed into this page and used only by the engine running in your browser tab. It is not stored or logged.',
      ],
      PRIVACY_FAQ[1],
    ],
  },
];

export const HOME = {
  title: 'HushPDF — Private PDF Tools That Never Upload Your Files',
  description:
    'Merge, split, rotate, delete pages and unlock PDFs right in your browser. Zero uploads, no sign-up, open source. Keeps form fields and links intact.',
  h1: 'PDF tools that keep your files to themselves',
  lede: 'Merge, split, rotate and unlock PDFs in your browser. Your documents never leave your device — not even for a second.',
  what: 'HushPDF is a free, open-source set of PDF tools that runs entirely in your web browser. Files are processed on your own device with the qpdf engine compiled to WebAssembly, so nothing is uploaded to a server.',
  faq: [
    PRIVACY_FAQ[0],
    [
      'How is HushPDF different from other online PDF tools?',
      'Most online PDF tools upload your document to their servers. HushPDF does the work in your browser tab instead. It is also built on qpdf, a mature PDF engine, and warns you whenever something such as a bookmark cannot be carried over — instead of silently dropping it.',
    ],
    [
      'Does it work on my phone?',
      'Yes. HushPDF works in current versions of Chrome, Safari, Firefox and Edge on desktop and mobile. Very large files may exceed a phone’s memory; HushPDF checks this before starting.',
    ],
    PRIVACY_FAQ[1],
  ] as [string, string][],
};
