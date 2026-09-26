// Single source of truth for brand, tool pages and their search copy.
// Used by the Vite build (prerendered pages, sitemap, llms.txt) and by the app.
import type { Op } from './engine/pdf.ts';

/** qpdf jobs (engine/pdf.ts) plus the tools that run in engine/local.ts. */
export type ToolOp =
  | Op
  | 'jpg-to-pdf'
  | 'pdf-to-jpg'
  | 'office-clean'
  | 'office-images'
  | 'office-compress'
  | 'compress-pdf'
  | 'edit-pdf'
  | 'ocr-pdf'
  | 'pdf-to-word'
  | 'pdf-to-powerpoint'
  | 'pdf-to-text'
  | 'text-to-pdf'
  | 'word-to-pdf'
  | 'excel-to-csv'
  | 'csv-to-excel'
  | 'image-convert'
  | 'image-ocr'
  | 'page-numbers'
  | 'watermark-pdf';
export type Format = 'pdf' | 'word' | 'excel' | 'powerpoint' | 'image';

export const SITE = {
  name: 'Fizzdoc',
  url: 'https://fizzdoc.com',
  repo: 'https://github.com/kingrishabdugar/fizzdoc',
  tagline: 'Private PDF, Word, Excel, PowerPoint and image tools that never upload your files',
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
  /** File picker override; the default follows the format (one .pdf, .docx, …). */
  input?: { accept: string; multiple?: boolean };
  /** Fixed engine options for this page, e.g. { format: 'md' } for PDF to Markdown. */
  preset?: Record<string, string>;
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

const PDF_IN = { accept: 'application/pdf,.pdf' };
const IMAGES_IN = { accept: 'image/*', multiple: true };
const SAVE_AS_PDF: [string, string] = [
  'Why does a print window open?',
  'Your browser has a built-in PDF writer that handles every language and font perfectly. Fizzdoc prepares the document and hands it to that writer: choose “Save as PDF” as the destination and click Save. Nothing is printed or sent anywhere.',
];

TOOLS.push(
  {
    op: 'compress-pdf',
    format: 'pdf',
    slug: 'compress-pdf',
    name: 'Compress PDF',
    summary: 'Shrink a PDF by optimizing its images. Text stays sharp.',
    action: 'Compress PDF',
    title: 'Compress PDF Online Without Uploading — Free | Fizzdoc',
    description:
      'Reduce PDF file size in your browser by recompressing oversized images. Text stays selectable and sharp. Nothing is uploaded; free and open source.',
    h1: 'Compress a PDF — without uploading it',
    lede: 'Make a PDF small enough to email or upload to a portal. Fizzdoc recompresses oversized photos and scans and leaves text and vector graphics untouched.',
    steps: ['Add one PDF file.', 'Choose Balanced or Strong compression.', 'Click “Compress PDF” and download the smaller file.'],
    faq: [
      PRIVACY_FAQ[0],
      [
        'How much smaller will my PDF get?',
        'PDFs made from scans and photos often shrink by 40–80%. Text-only PDFs are usually already compact; if Fizzdoc cannot make a file smaller, it tells you and keeps the original.',
      ],
      ['Will text become blurry?', 'No. Only embedded pictures are recompressed. Text, fonts and vector drawings are copied exactly, so text stays sharp and selectable.'],
      PRIVACY_FAQ[1],
    ],
  },
  {
    op: 'edit-pdf',
    format: 'pdf',
    slug: 'edit-pdf',
    name: 'Edit PDF',
    summary: 'Change existing text, add text and white-out, right on the page.',
    action: 'Save PDF',
    title: 'Edit PDF Text Online — Free, No Upload | Fizzdoc',
    description:
      'Click any text in a PDF to change it, add new text, or white-out areas — directly on the page, in your browser. Nothing is uploaded. Free, no sign-up.',
    h1: 'Edit PDF text directly on the page',
    lede: 'Fix a typo, update a date or fill in a blank without the original file. Click the text you want to change and type — it all happens on your device.',
    steps: [
      'Add one PDF file.',
      'Click any text to change it, or use Add text and White-out from the toolbar.',
      'Click “Save PDF” and download the edited file.',
    ],
    faq: [
      PRIVACY_FAQ[0],
      [
        'Will the edited text match the original font?',
        'Fizzdoc picks the closest standard font (sans-serif, serif or monospace, with bold and italic) at the same size and position. Custom brand fonts cannot be reproduced exactly.',
      ],
      [
        'Is the original text removed?',
        'The original text is covered on the page and your new text is drawn on top. For sensitive information that must be gone from the file, delete the page or re-create the document instead.',
      ],
      PRIVACY_FAQ[1],
    ],
  },
  {
    op: 'ocr-pdf',
    format: 'pdf',
    slug: 'ocr-pdf',
    name: 'OCR PDF',
    summary: 'Make a scanned PDF searchable and copyable.',
    action: 'Recognize text',
    title: 'OCR PDF — Make Scanned PDFs Searchable, No Upload | Fizzdoc',
    description:
      'Turn scanned PDFs into searchable, copyable documents with English OCR that runs in your browser. Pages keep their original quality. Nothing is uploaded.',
    h1: 'Make a scanned PDF searchable with OCR',
    lede: 'Recognize the English text in scanned pages and add it as an invisible layer, so you can search, select and copy it. The pages themselves are not changed.',
    steps: ['Add one scanned PDF.', 'Click “Recognize text” and wait while each page is read.', 'Download the searchable PDF.'],
    faq: [
      PRIVACY_FAQ[0],
      [
        'Which languages are supported?',
        'English. The recognition engine (Tesseract) and its English language data are downloaded to your browser once, the first time you use an OCR tool — about a few megabytes.',
      ],
      ['Does OCR change how my pages look?', 'No. The scanned pages are kept exactly as they are; the recognized text is added as an invisible layer on top.'],
      PRIVACY_FAQ[1],
    ],
    input: PDF_IN,
  },
  {
    op: 'pdf-to-word',
    format: 'pdf',
    slug: 'pdf-to-word',
    name: 'PDF to Word',
    summary: 'Turn PDF text into an editable .docx.',
    action: 'Convert to Word',
    title: 'PDF to Word (DOCX) Converter — Private, No Upload | Fizzdoc',
    description:
      'Convert a PDF to an editable Word document in your browser. Headings, paragraphs and page breaks are kept. Nothing is uploaded. Free, no sign-up.',
    h1: 'Convert PDF to an editable Word document',
    lede: 'Get the text of a PDF into Word, with headings and paragraphs rebuilt, so you can edit it. Conversion happens on your device.',
    steps: ['Add one PDF file.', 'Click “Convert to Word”.', 'Download the .docx and open it in Word, Google Docs or LibreOffice.'],
    faq: [
      PRIVACY_FAQ[0],
      [
        'Will the layout look exactly like the PDF?',
        'Fizzdoc rebuilds the text flow — headings, paragraphs, bold and italic, and page breaks — so the document is easy to edit. Complex layouts with columns, tables and images are simplified.',
      ],
      ['What about scanned PDFs?', 'Scanned pages are pictures, not text. Run OCR PDF first, then convert the result to Word.'],
      PRIVACY_FAQ[1],
    ],
  },
  {
    op: 'pdf-to-powerpoint',
    format: 'pdf',
    slug: 'pdf-to-powerpoint',
    name: 'PDF to PowerPoint',
    summary: 'Turn each PDF page into a slide.',
    action: 'Convert to PowerPoint',
    title: 'PDF to PowerPoint (PPTX) — Private, No Upload | Fizzdoc',
    description:
      'Convert a PDF into a PowerPoint presentation with one sharp slide per page, right in your browser. Nothing is uploaded. Free and open source.',
    h1: 'Convert a PDF to a PowerPoint presentation',
    lede: 'Present a PDF as slides. Every page becomes a full-size, high-resolution slide in a .pptx you can open in PowerPoint, Keynote or Google Slides.',
    steps: ['Add one PDF file.', 'Click “Convert to PowerPoint”.', 'Download the .pptx.'],
    faq: [
      PRIVACY_FAQ[0],
      [
        'Can I edit the text on the slides?',
        'Each slide is a picture of the page, so it looks exactly like the PDF. To edit the wording, use PDF to Word instead, or add text boxes on top in PowerPoint.',
      ],
      PRIVACY_FAQ[1],
    ],
  },
  {
    op: 'pdf-to-text',
    format: 'pdf',
    slug: 'pdf-to-text',
    name: 'PDF to Text',
    summary: 'Extract all text from a PDF as a .txt file.',
    action: 'Extract text',
    title: 'PDF to Text (TXT) Converter — Private, No Upload | Fizzdoc',
    description:
      'Extract the text from a PDF into a plain .txt file in your browser, in the right reading order. Nothing is uploaded. Free, no sign-up, open source.',
    h1: 'Extract text from a PDF',
    lede: 'Get every word out of a PDF as plain text, with lines and paragraphs in reading order. Perfect for copying, searching or feeding into other tools.',
    steps: ['Add one PDF file.', 'Click “Extract text”.', 'Download the .txt file.'],
    faq: [
      PRIVACY_FAQ[0],
      ['Why is my text file empty?', 'Scanned PDFs contain pictures of text, not text. Run OCR PDF first, then extract the text.'],
      PRIVACY_FAQ[1],
    ],
    preset: { format: 'txt' },
  },
  {
    op: 'pdf-to-text',
    format: 'pdf',
    slug: 'pdf-to-markdown',
    name: 'PDF to Markdown',
    summary: 'Convert a PDF to clean Markdown with headings and lists.',
    action: 'Convert to Markdown',
    title: 'PDF to Markdown Converter — Private, No Upload | Fizzdoc',
    description:
      'Convert a PDF to Markdown with headings and lists detected, ready for docs, notes or AI tools. Runs in your browser; nothing is uploaded. Free.',
    h1: 'Convert a PDF to Markdown',
    lede: 'Turn a PDF into clean Markdown — headings, paragraphs and lists — for Notion, Obsidian, GitHub or any tool that reads Markdown.',
    steps: ['Add one PDF file.', 'Click “Convert to Markdown”.', 'Download the .md file.'],
    faq: [
      PRIVACY_FAQ[0],
      ['How are headings detected?', 'From the size of the text: lines noticeably larger than the body text become headings, and bulleted or numbered lines become lists.'],
      PRIVACY_FAQ[1],
    ],
    preset: { format: 'md' },
  },
  {
    op: 'text-to-pdf',
    format: 'pdf',
    slug: 'text-to-pdf',
    name: 'Text to PDF',
    summary: 'Turn a .txt file into a clean PDF.',
    action: 'Create PDF',
    title: 'Text to PDF (TXT to PDF) Converter — No Upload | Fizzdoc',
    description:
      'Convert a plain text file to a clean, readable PDF in your browser. Supports every language, including Hindi and other scripts. Nothing is uploaded.',
    h1: 'Convert a text file to PDF',
    lede: 'Turn notes, logs or any .txt file into a neatly formatted A4 PDF. Every language and script is supported.',
    steps: ['Add one .txt file.', 'Click “Create PDF”.', 'Choose “Save as PDF” in the window that opens and click Save.'],
    faq: [PRIVACY_FAQ[0], SAVE_AS_PDF, PRIVACY_FAQ[1]],
    input: { accept: '.txt,text/plain' },
  },
  {
    op: 'text-to-pdf',
    format: 'pdf',
    slug: 'markdown-to-pdf',
    name: 'Markdown to PDF',
    summary: 'Render a .md file as a formatted PDF.',
    action: 'Create PDF',
    title: 'Markdown to PDF Converter — Private, No Upload | Fizzdoc',
    description:
      'Convert Markdown to a formatted PDF with headings, lists, tables and code blocks, right in your browser. Nothing is uploaded. Free and open source.',
    h1: 'Convert Markdown to PDF',
    lede: 'Render a README, notes or documentation written in Markdown into a clean, printable PDF with headings, lists, tables and code blocks.',
    steps: ['Add one .md file.', 'Click “Create PDF”.', 'Choose “Save as PDF” in the window that opens and click Save.'],
    faq: [
      PRIVACY_FAQ[0],
      ['Which Markdown features are supported?', 'Headings, bold, italic, inline code and code blocks, ordered and bulleted lists, quotes, links, horizontal rules and tables. Raw HTML is shown as text for safety.'],
      SAVE_AS_PDF,
      PRIVACY_FAQ[1],
    ],
    input: { accept: '.md,.markdown,text/markdown' },
  },
  {
    op: 'word-to-pdf',
    format: 'word',
    slug: 'word-to-pdf',
    name: 'Word to PDF',
    summary: 'Convert a .docx to PDF, all languages supported.',
    action: 'Convert to PDF',
    title: 'Word to PDF (DOCX to PDF) Converter — No Upload | Fizzdoc',
    description:
      'Convert a Word document to PDF in your browser, keeping headings, lists, tables and images. Works with Google Docs downloads. Nothing is uploaded.',
    h1: 'Convert a Word document to PDF',
    lede: 'Turn a .docx into a PDF with its headings, lists, tables and pictures, using your browser’s own PDF writer. The document never leaves your device.',
    steps: ['Add one .docx file (from Word or Google Docs).', 'Click “Convert to PDF”.', 'Choose “Save as PDF” in the window that opens and click Save.'],
    faq: [
      PRIVACY_FAQ[0],
      [
        'Will it look exactly like in Word?',
        'Text, headings, lists, tables, links and pictures are kept. Headers, footers and advanced layouts such as text boxes and multi-column sections are simplified.',
      ],
      SAVE_AS_PDF,
      PRIVACY_FAQ[1],
    ],
  },
  {
    op: 'excel-to-csv',
    format: 'excel',
    slug: 'excel-to-csv',
    name: 'Excel to CSV',
    summary: 'Export every sheet of an .xlsx to CSV.',
    action: 'Convert to CSV',
    title: 'Excel to CSV (XLSX to CSV) Converter — No Upload | Fizzdoc',
    description:
      'Convert Excel spreadsheets to CSV in your browser. Every sheet is exported, dates become ISO dates, and nothing is uploaded. Works with Google Sheets.',
    h1: 'Convert Excel to CSV',
    lede: 'Export each sheet of an .xlsx workbook to a UTF-8 CSV file that opens correctly everywhere. Dates, numbers and text are kept as they are.',
    steps: ['Add one .xlsx file (from Excel or Google Sheets).', 'Click “Convert to CSV”.', 'Download the CSV, or a ZIP with one CSV per sheet.'],
    faq: [
      PRIVACY_FAQ[0],
      ['What happens to formulas?', 'CSV stores values only, so each cell’s last calculated value is exported — the same thing Excel does.'],
      ['Are non-English characters kept?', 'Yes. The CSV is UTF-8 with a byte-order mark, so Excel, Google Sheets and other apps read accents and non-Latin scripts correctly.'],
      PRIVACY_FAQ[1],
    ],
  },
  {
    op: 'csv-to-excel',
    format: 'excel',
    slug: 'csv-to-excel',
    name: 'CSV to Excel',
    summary: 'Turn a .csv into a proper .xlsx workbook.',
    action: 'Convert to Excel',
    title: 'CSV to Excel (CSV to XLSX) Converter — No Upload | Fizzdoc',
    description:
      'Convert a CSV file to an Excel .xlsx workbook in your browser. Numbers stay numbers, leading zeros are kept, and nothing is uploaded. Free.',
    h1: 'Convert CSV to Excel',
    lede: 'Turn a CSV into a real Excel workbook. Numbers become numbers, codes like 007 keep their leading zeros, and the delimiter is detected for you.',
    steps: ['Add one .csv file.', 'Click “Convert to Excel”.', 'Download the .xlsx.'],
    faq: [
      PRIVACY_FAQ[0],
      ['Does it handle semicolons and tabs?', 'Yes. Commas, semicolons, tabs and pipes are detected automatically, as are quoted fields with line breaks inside them.'],
      PRIVACY_FAQ[1],
    ],
    input: { accept: '.csv,.tsv,text/csv' },
  },
  {
    op: 'image-convert',
    format: 'image',
    slug: 'compress-image',
    name: 'Compress Image',
    summary: 'Make JPG, PNG and WebP images smaller.',
    action: 'Compress images',
    title: 'Compress Images (JPG, PNG, WebP) — No Upload, Free | Fizzdoc',
    description:
      'Reduce image file size in your browser — JPG, PNG, WebP and more, in bulk. Choose the quality or keep it lossless. Photos are never uploaded.',
    h1: 'Compress images without uploading them',
    lede: 'Shrink photos and screenshots for email, websites and forms. Pick a quality level, or keep them lossless — all on your device, in bulk.',
    steps: ['Add one or more images.', 'Choose the output format and quality.', 'Click “Compress images” and download the result.'],
    faq: [
      PRIVACY_FAQ[0],
      [
        'Can I compress without losing quality?',
        'Yes. Choose PNG for pixel-perfect lossless output. For photos, JPG or WebP at 80% quality usually looks identical and is far smaller.',
      ],
      ['Is location data removed?', 'Yes. Re-encoding drops hidden EXIF metadata such as GPS location and camera details.'],
      PRIVACY_FAQ[1],
    ],
    input: IMAGES_IN,
    preset: { mode: 'compress' },
  },
  {
    op: 'image-convert',
    format: 'image',
    slug: 'resize-image',
    name: 'Resize Image',
    summary: 'Make images larger or smaller, by pixels or percent.',
    action: 'Resize images',
    title: 'Resize Images Online (Enlarge or Shrink) — No Upload | Fizzdoc',
    description:
      'Resize images to exact pixels or a percentage — smaller or larger — in your browser, in bulk. Keep the aspect ratio or not. Nothing is uploaded.',
    h1: 'Resize images — bigger or smaller',
    lede: 'Set an exact width and height or scale by percent, for one picture or many. Aspect ratio is kept unless you say otherwise.',
    steps: ['Add one or more images.', 'Enter a new size or a percentage.', 'Click “Resize images” and download the result.'],
    faq: [
      PRIVACY_FAQ[0],
      [
        'Does enlarging an image add detail?',
        'Enlarging makes the picture bigger with smooth, high-quality scaling, but it cannot invent detail that was not captured. It is ideal for meeting minimum-size requirements.',
      ],
      PRIVACY_FAQ[1],
    ],
    input: IMAGES_IN,
    preset: { mode: 'resize' },
  },
  {
    op: 'image-convert',
    format: 'image',
    slug: 'convert-image',
    name: 'Convert Image',
    summary: 'Convert between JPG, PNG and WebP.',
    action: 'Convert images',
    title: 'Convert Images to JPG, PNG or WebP — No Upload | Fizzdoc',
    description:
      'Convert images between JPG, PNG and WebP in your browser, in bulk. Works with GIF, BMP, AVIF and iPhone photos your browser can open. Nothing is uploaded.',
    h1: 'Convert images to JPG, PNG or WebP',
    lede: 'Change the format of one image or a whole batch — for example WebP to JPG or PNG to WebP — without sending them anywhere.',
    steps: ['Add one or more images.', 'Choose the format you need.', 'Click “Convert images” and download the result.'],
    faq: [PRIVACY_FAQ[0], ['Which format should I choose?', 'JPG for photos that must open everywhere, PNG for screenshots and graphics that need sharp edges or transparency, WebP for the smallest files on the web.'], PRIVACY_FAQ[1]],
    input: IMAGES_IN,
    preset: { mode: 'convert' },
  },
  {
    op: 'image-ocr',
    format: 'image',
    slug: 'image-to-text',
    name: 'Image to Text (OCR)',
    summary: 'Select and copy text from any photo or screenshot.',
    action: 'Recognize text',
    title: 'Image to Text (OCR) — Copy Text from Photos, No Upload | Fizzdoc',
    description:
      'Extract text from photos and screenshots with English OCR in your browser, then select and copy it right on the image — like Live Text. Nothing is uploaded.',
    h1: 'Copy text from any image',
    lede: 'Recognize the English text in a photo, scan or screenshot, then select it directly on the picture — just like Live Text on iPhone. Nothing leaves your device.',
    steps: ['Add one image.', 'Click “Recognize text”.', 'Select text right on the image, copy it all, or download it as a .txt file.'],
    faq: [
      PRIVACY_FAQ[0],
      ['Which languages are supported?', 'English. The recognition engine and its English data download to your browser once, the first time you use OCR.'],
      ['How do I get the best results?', 'Use a sharp, well-lit, straight-on photo. Printed text works best; handwriting is recognized less reliably.'],
      PRIVACY_FAQ[1],
    ],
    input: { accept: 'image/*' },
  },
);

// Popular searches that are the same job with a different file type get their own page and copy.
const IMAGE_CONVERSIONS = [
  { from: 'PNG', to: 'JPG', format: 'jpeg', accept: 'image/png,.png', why: 'JPG files are much smaller for photos and open everywhere, including old software and upload forms that reject PNG.' },
  { from: 'JPG', to: 'PNG', format: 'png', accept: 'image/jpeg,.jpg,.jpeg', why: 'PNG is lossless, so the picture will not lose any more quality when you edit and save it again.' },
  { from: 'WebP', to: 'JPG', format: 'jpeg', accept: 'image/webp,.webp', why: 'Many apps, printers and upload forms still cannot open WebP images saved from websites. JPG works everywhere.' },
  { from: 'JPG', to: 'WebP', format: 'webp', accept: 'image/jpeg,.jpg,.jpeg', why: 'WebP images are usually 25–35% smaller than JPG at the same visual quality, which makes websites load faster.' },
] as const;

for (const c of IMAGE_CONVERSIONS) {
  TOOLS.push({
    op: 'image-convert',
    format: 'image',
    slug: `${c.from.toLowerCase()}-to-${c.to.toLowerCase()}`,
    name: `${c.from} to ${c.to}`,
    summary: `Convert ${c.from} images to ${c.to} in bulk.`,
    action: `Convert to ${c.to}`,
    title: `${c.from} to ${c.to} Converter — Free, No Upload | Fizzdoc`,
    description: `Convert ${c.from} images to ${c.to} in your browser, one or many at once. Fast, free, no watermark, and your pictures are never uploaded.`,
    h1: `Convert ${c.from} to ${c.to} — privately`,
    lede: `${c.why} Fizzdoc converts your ${c.from} files right on your device.`,
    steps: [`Add one or more ${c.from} images.`, c.format === 'png' ? 'Nothing to set: PNG is lossless.' : 'Pick a quality, or keep the default.', `Click “Convert to ${c.to}” and download.`],
    faq: [
      PRIVACY_FAQ[0],
      [`Why convert ${c.from} to ${c.to}?`, c.why],
      ['Can I convert many images at once?', 'Yes. Add as many as you like; several images download together as one ZIP file.'],
      PRIVACY_FAQ[1],
    ],
    input: { accept: c.accept, multiple: true },
    preset: { mode: 'convert', format: c.format },
  });
}

TOOLS.push(
  {
    op: 'page-numbers',
    format: 'pdf',
    slug: 'add-page-numbers-to-pdf',
    name: 'Add Page Numbers',
    summary: 'Number every page of a PDF.',
    action: 'Add page numbers',
    title: 'Add Page Numbers to PDF — Free, No Upload | Fizzdoc',
    description:
      'Add page numbers to a PDF in your browser. Choose the position, the starting number and “Page 1 of 10” style. Nothing is uploaded. Free, no sign-up.',
    h1: 'Add page numbers to a PDF',
    lede: 'Number the pages of a report, thesis or contract in seconds. Pick where the numbers go and what number to start from — on your device.',
    steps: ['Add one PDF file.', 'Choose the position, style and first number.', 'Click “Add page numbers” and download.'],
    faq: [
      PRIVACY_FAQ[0],
      ['Can I start from a number other than 1?', 'Yes. Set “Start at” to any number — useful when the PDF is a chapter of a longer document.'],
      ['Does it change my content?', 'No. The numbers are added on top of each page; everything else stays exactly as it was.'],
      PRIVACY_FAQ[1],
    ],
  },
  {
    op: 'watermark-pdf',
    format: 'pdf',
    slug: 'watermark-pdf',
    name: 'Watermark PDF',
    summary: 'Stamp text like CONFIDENTIAL across every page.',
    action: 'Add watermark',
    title: 'Watermark PDF — Add Text Watermark, No Upload | Fizzdoc',
    description:
      'Add a text watermark such as CONFIDENTIAL or DRAFT across every page of a PDF, in your browser. Choose the opacity. Nothing is uploaded. Free.',
    h1: 'Add a watermark to a PDF',
    lede: 'Mark a document as CONFIDENTIAL, DRAFT or with your name before sharing it. The watermark is drawn diagonally across every page.',
    steps: ['Add one PDF file.', 'Type the watermark text and choose how see-through it is.', 'Click “Add watermark” and download.'],
    faq: [
      PRIVACY_FAQ[0],
      ['Can the watermark be removed?', 'A text watermark discourages copying but a determined person with a PDF editor can remove it. For stronger protection, also use Protect PDF.'],
      ['Which characters can I use?', 'Letters, numbers and common symbols in Latin script. Other scripts are not supported by the standard PDF fonts.'],
      PRIVACY_FAQ[1],
    ],
  },
  {
    op: 'pdf-to-jpg',
    format: 'pdf',
    slug: 'pdf-to-png',
    name: 'PDF to PNG',
    summary: 'Save every page as a lossless PNG image.',
    action: 'Convert to PNG',
    title: 'PDF to PNG Converter — Lossless, No Upload | Fizzdoc',
    description:
      'Convert each page of a PDF to a sharp, lossless PNG image in your browser. Many pages download as one ZIP. Nothing is uploaded. Free.',
    h1: 'Convert PDF pages to PNG images',
    lede: 'Render every page to a crisp, lossless PNG — ideal for slides, documentation and screenshots with sharp text. Nothing leaves your device.',
    steps: ['Add one PDF file.', 'Click “Convert to PNG”.', 'Download the image, or a ZIP with one PNG per page.'],
    faq: [
      PRIVACY_FAQ[0],
      ['PNG or JPG?', 'PNG keeps text and lines perfectly sharp but files are larger. For photos and scans, PDF to JPG gives much smaller files.'],
      PRIVACY_FAQ[1],
    ],
    preset: { format: 'png' },
  },
  {
    op: 'split',
    format: 'pdf',
    slug: 'extract-pdf-pages',
    name: 'Extract PDF Pages',
    summary: 'Save selected pages as a new PDF.',
    action: 'Extract pages',
    title: 'Extract Pages from PDF — Free, Private, No Upload | Fizzdoc',
    description:
      'Pull specific pages out of a PDF into a new file, in your browser. Type pages like 2, 5-7. Links and form fields are kept. Nothing is uploaded.',
    h1: 'Extract pages from a PDF',
    lede: 'Need just the signature page or one chapter? Type the pages you want and get them as a new PDF — the original stays untouched.',
    steps: ['Add one PDF file.', 'Type the pages to extract, for example “2, 5-7”.', 'Click “Extract pages” and download the new PDF.'],
    faq: [
      PRIVACY_FAQ[0],
      ['Is the quality reduced?', 'No. Pages are copied as they are — nothing is re-rendered or re-compressed.'],
      PRIVACY_FAQ[1],
    ],
  },
  {
    op: 'split',
    format: 'pdf',
    slug: 'reorder-pdf-pages',
    name: 'Reorder PDF Pages',
    summary: 'Put the pages of a PDF in a new order.',
    action: 'Reorder pages',
    title: 'Reorder PDF Pages (Rearrange) — Free, No Upload | Fizzdoc',
    description:
      'Rearrange the pages of a PDF by typing the order you want, like 3, 1-2, 4-. Runs in your browser; your file is never uploaded. Free, no sign-up.',
    h1: 'Reorder the pages of a PDF',
    lede: 'Fix pages that were scanned out of order or move an appendix to the front. Type the new order and download the rearranged PDF.',
    steps: ['Add one PDF file.', 'Type the new page order, for example “3, 1-2, 4-”.', 'Click “Reorder pages” and download.'],
    faq: [
      PRIVACY_FAQ[0],
      ['How do I write the order?', 'List pages and ranges separated by commas. “4-” means page 4 to the end. Pages you leave out are left out of the new file.'],
      PRIVACY_FAQ[1],
    ],
  },
  {
    op: 'jpg-to-pdf',
    format: 'pdf',
    slug: 'png-to-pdf',
    name: 'PNG to PDF',
    summary: 'Turn PNG screenshots and images into one PDF.',
    action: 'Create PDF',
    title: 'PNG to PDF Converter — Free, No Upload | Fizzdoc',
    description:
      'Combine PNG screenshots and images into a single PDF in your browser, one page per image, at full quality. Nothing is uploaded. No watermark.',
    h1: 'Convert PNG images to PDF',
    lede: 'Put screenshots, diagrams or scanned pages saved as PNG into one tidy PDF — sharp, lossless and in the order you choose.',
    steps: ['Add one or more PNG images.', 'Put them in order with the ↑ and ↓ buttons.', 'Click “Create PDF” and download it.'],
    faq: [
      PRIVACY_FAQ[0],
      ['Is transparency kept?', 'Yes. PNG images are placed in the PDF as they are, including transparent areas.'],
      PRIVACY_FAQ[1],
    ],
    input: { accept: 'image/png,.png', multiple: true },
  },
);

// Word, Excel and PowerPoint files (and Google Docs, Sheets and Slides downloaded as them) are ZIP
// packages, so the same two tools work for all three; only the words change.
const OFFICE = [
  { format: 'word', app: 'Word', ext: 'docx', google: 'Google Docs', thing: 'document', a: 'a' },
  { format: 'excel', app: 'Excel', ext: 'xlsx', google: 'Google Sheets', thing: 'spreadsheet', a: 'an' },
  { format: 'powerpoint', app: 'PowerPoint', ext: 'pptx', google: 'Google Slides', thing: 'presentation', a: 'a' },
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
      description: `Delete author, editor, company, title and thumbnail from ${o.a} ${o.app} file in your browser. Works with ${o.google} downloads. Nothing is uploaded.`,
      h1: `Remove hidden metadata from ${o.a} ${o.app} ${o.thing}`,
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
      h1: `Extract all images from ${o.a} ${o.app} ${o.thing}`,
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
    {
      op: 'office-compress',
      format: o.format,
      slug: `compress-${o.format}`,
      name: `Compress ${o.app}`,
      summary: `Shrink a .${o.ext} by optimizing its pictures.`,
      action: `Compress ${o.app}`,
      title: `Compress ${o.app} Files (.${o.ext}) — No Upload | Fizzdoc`,
      description: `Reduce the size of ${o.a} ${o.app} file by recompressing its photos, in your browser. Content and formatting stay the same. Nothing is uploaded.`,
      h1: `Compress ${o.a} ${o.app} ${o.thing}`,
      lede: `Make a .${o.ext} small enough to email by recompressing oversized photos inside it. Text, formatting and everything else stay exactly the same.`,
      steps: [`Add one .${o.ext} file (from ${o.app} or ${o.google}).`, 'Choose Balanced or Strong compression.', `Click “Compress ${o.app}” and download the smaller file.`],
      faq: [
        PRIVACY_FAQ[0],
        [
          'How much smaller will it get?',
          'Files with large photos often shrink by half or more. Files that are mostly text are already compact; if Fizzdoc cannot make a file smaller, it tells you and keeps the original.',
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
  image: { label: 'Image', badge: 'IMG', ext: 'jpg' },
};

export const HOME = {
  title: 'Fizzdoc — Private PDF, Word, Excel & Image Tools. No Uploads.',
  description:
    'Edit, compress, convert, OCR and merge PDFs; convert Word, Excel and images — right in your browser. Zero uploads, no sign-up, free and open source.',
  h1: 'Document tools that never see your documents',
  lede: 'Edit, compress, convert and OCR PDFs. Convert Word, Excel, PowerPoint and images. Everything runs in your browser — your files never leave your device.',
  what: 'Fizzdoc is a free, open-source set of document tools that runs entirely in your web browser. PDFs are processed with the qpdf, pdf.js and pdf-lib engines, text recognition uses Tesseract, and Office files and images are handled locally too — so nothing is ever uploaded to a server.',
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
