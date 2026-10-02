// "<Brand> alternative" pages: what people type when they look for a private or free replacement.
// They describe only what Fizzdoc does and make no claims about the other services, whose names
// are used only to say what the page is about. Brand names belong to their owners; Fizzdoc is not
// affiliated with them.

export interface Alternative {
  slug: string;
  brand: string;
  title: string;
  description: string;
  h1: string;
  lede: string;
  /** Their best-known jobs mapped to the Fizzdoc tool that does the same. */
  tools: string[];
  faq: [question: string, answer: string][];
}

const NOT_AFFILIATED = (brand: string): [string, string] => [
  `Is Fizzdoc made by ${brand}?`,
  `No. Fizzdoc is an independent, open-source project and is not affiliated with or endorsed by ${brand}. ${brand} is a trademark of its owner and is named only to say what this page is about.`,
];
const HOW_PRIVATE: [string, string] = [
  'How can Fizzdoc work without uploading my file?',
  'Every tool runs inside your browser tab, using engines compiled to WebAssembly. Your file is read from your device, processed there and saved back to it. The page is only allowed to talk to fizzdoc.com, which serves nothing but the website itself, and you can watch your browser’s Network tab to see that no file leaves.',
];

export const ALTERNATIVES: Alternative[] = [
  {
    slug: 'ilovepdf-alternative',
    brand: 'iLovePDF',
    title: 'Free iLovePDF Alternative — No Upload, No Limits | Fizzdoc',
    description:
      'Looking for an iLovePDF alternative? Fizzdoc merges, compresses, converts, edits and unlocks PDFs free, in your browser. Your files are never uploaded.',
    h1: 'A private, free alternative to iLovePDF',
    lede: 'Fizzdoc does the everyday iLovePDF jobs (merge, split, compress, convert, unlock, OCR) without sending your file anywhere. The work happens in your browser, it is free with no daily limit, and it is open source.',
    tools: ['merge-pdf', 'split-pdf', 'compress-pdf', 'pdf-to-word', 'word-to-pdf', 'pdf-to-jpg', 'jpg-to-pdf', 'unlock-pdf', 'protect-pdf', 'ocr-pdf', 'add-page-numbers-to-pdf', 'watermark-pdf'],
    faq: [
      HOW_PRIVATE,
      ['Is Fizzdoc really free?', 'Yes. There is no paid plan, no sign-up, no watermark and no daily or file-size quota beyond what your device can handle. The code is open source under Apache-2.0.'],
      NOT_AFFILIATED('iLovePDF'),
    ],
  },
  {
    slug: 'smallpdf-alternative',
    brand: 'Smallpdf',
    title: 'Free Smallpdf Alternative — No Upload, No Sign-up | Fizzdoc',
    description:
      'A free Smallpdf alternative that keeps your files on your device: compress, merge, convert, edit and unlock PDFs in your browser. No account, no limits.',
    h1: 'A private, free alternative to Smallpdf',
    lede: 'Fizzdoc covers the Smallpdf jobs people use most (compress, merge, convert to and from Word, JPG and PowerPoint, edit and unlock) with no account, no daily cap and no upload.',
    tools: ['compress-pdf', 'merge-pdf', 'pdf-to-word', 'word-to-pdf', 'pdf-to-powerpoint', 'pdf-to-jpg', 'edit-pdf', 'unlock-pdf', 'split-pdf', 'rotate-pdf', 'delete-pdf-pages', 'protect-pdf'],
    faq: [
      HOW_PRIVATE,
      ['Do I need an account?', 'No. Open a tool and use it; nothing is saved anywhere, and there is no limit on how many files you process.'],
      NOT_AFFILIATED('Smallpdf'),
    ],
  },
  {
    slug: 'sejda-alternative',
    brand: 'Sejda',
    title: 'Free Sejda Alternative — Edit PDF Text in the Same Font | Fizzdoc',
    description:
      'A free Sejda alternative: edit PDF text in the PDF’s own font, then redact, merge, split or compress, all in your browser. Nothing is uploaded.',
    h1: 'A private, free alternative to Sejda',
    lede: 'Change text right inside the PDF, in its own font, size and colour, then redact, merge, split, compress or reorder pages, all in your browser. There is no task limit or page cap: only your device’s memory sets the size.',
    tools: ['edit-pdf', 'redact-pdf', 'merge-pdf', 'split-pdf', 'compress-pdf', 'reorder-pdf-pages', 'delete-pdf-pages', 'rotate-pdf', 'extract-pdf-pages', 'watermark-pdf', 'add-page-numbers-to-pdf', 'pdf-to-word'],
    faq: [
      HOW_PRIVATE,
      ['Does edited text keep the original font?', 'Yes, when the PDF’s font already has every letter you type: the line is rewritten inside the file with the same font, size and colour. If a letter is missing, that line uses the closest standard font instead.'],
      ['Is there a limit on tasks or pages?', 'No. Very large files are limited only by your device’s memory, and Fizzdoc checks before it starts.'],
      NOT_AFFILIATED('Sejda'),
    ],
  },
  {
    slug: 'cloudconvert-alternative',
    brand: 'CloudConvert',
    title: 'Free CloudConvert Alternative — Convert Files, No Upload | Fizzdoc',
    description:
      'A free CloudConvert alternative for everyday conversions: PDF, Word, Excel, CSV, JSON, images and audio, converted in your browser. Nothing is uploaded.',
    h1: 'A private, free alternative to CloudConvert',
    lede: 'Convert PDF to Word, Excel to CSV or JSON, images between JPG, PNG and WebP, Mermaid to PNG and speech to text, on your own device. No account and no upload.',
    tools: ['pdf-to-word', 'word-to-pdf', 'excel-to-csv', 'csv-to-excel', 'excel-to-json', 'json-to-excel', 'convert-image', 'pdf-to-jpg', 'jpg-to-pdf', 'mermaid-to-png', 'audio-to-text', 'pdf-to-text'],
    faq: [
      HOW_PRIVATE,
      ['Which conversions does Fizzdoc do?', 'PDF to and from Word, JPG and PNG, PDF to PowerPoint, text and Markdown, Excel to and from CSV and JSON, image format changes, Mermaid to PNG or SVG, and audio or video to text and subtitles.'],
      NOT_AFFILIATED('CloudConvert'),
    ],
  },
  {
    slug: 'tinypng-alternative',
    brand: 'TinyPNG',
    title: 'Free TinyPNG Alternative — Compress Images, No Upload | Fizzdoc',
    description:
      'A free TinyPNG alternative that compresses JPG, PNG and WebP in your browser, in bulk, or to an exact size in KB. Your photos are never uploaded.',
    h1: 'A private, free alternative to TinyPNG',
    lede: 'Make photos and screenshots smaller without sending them anywhere. Compress in bulk, pick the quality, or hit an exact size such as 50 KB for a form, all on your device.',
    tools: ['compress-image', 'compress-image-to-50kb', 'compress-image-to-100kb', 'resize-image', 'convert-image', 'png-to-pdf'],
    faq: [
      HOW_PRIVATE,
      ['Can I compress many images at once?', 'Yes. Add as many as you like; they are compressed one after another on your device and saved in a ZIP.'],
      NOT_AFFILIATED('TinyPNG'),
    ],
  },
  {
    slug: 'pdf24-alternative',
    brand: 'PDF24',
    title: 'PDF24 Alternative Online — Free, No Upload | Fizzdoc',
    description:
      'A PDF24 alternative that runs in your browser without uploading: merge, compress, convert, edit, redact and OCR PDFs free, with no install.',
    h1: 'A private, no-install alternative to PDF24 online',
    lede: 'Get PDF24-style tools that never upload your file and need nothing installed: merge, compress, convert, edit, redact, OCR and more, right in the browser on any computer or phone.',
    tools: ['merge-pdf', 'compress-pdf', 'split-pdf', 'pdf-to-word', 'word-to-pdf', 'jpg-to-pdf', 'edit-pdf', 'redact-pdf', 'ocr-pdf', 'protect-pdf', 'unlock-pdf', 'pdf-to-scanned-pdf'],
    faq: [
      HOW_PRIVATE,
      ['Do I need to install anything?', 'No. Fizzdoc runs in the browser on Windows, Mac, Linux, Android and iPhone, including office or school computers where you can’t install software.'],
      NOT_AFFILIATED('PDF24'),
    ],
  },
  {
    slug: 'adobe-acrobat-online-alternative',
    brand: 'Adobe Acrobat online',
    title: 'Free Adobe Acrobat Online Alternative — No Upload | Fizzdoc',
    description:
      'A free alternative to Adobe Acrobat’s online tools: merge, compress, convert, edit, protect and OCR PDFs in your browser, with no account and no upload.',
    h1: 'A private, free alternative to Adobe Acrobat online',
    lede: 'Do the quick PDF jobs (merge, compress, convert, edit text, protect, unlock, OCR) with no account, no payment and no upload of your document.',
    tools: ['merge-pdf', 'compress-pdf', 'pdf-to-word', 'word-to-pdf', 'edit-pdf', 'protect-pdf', 'unlock-pdf', 'ocr-pdf', 'pdf-to-jpg', 'rotate-pdf', 'delete-pdf-pages', 'redact-pdf'],
    faq: [
      HOW_PRIVATE,
      ['Do I need an Adobe account or Acrobat installed?', 'No. Fizzdoc runs in any modern browser on Windows, Mac, Linux, Android and iPhone, with no account and nothing to install.'],
      NOT_AFFILIATED('Adobe'),
    ],
  },
];

export const ALTERNATIVES_HUB = {
  slug: 'alternatives',
  title: 'Free Private Alternatives to iLovePDF, Smallpdf & More | Fizzdoc',
  description:
    'Compare Fizzdoc with iLovePDF, Smallpdf, Sejda, CloudConvert, TinyPNG, PDF24 and Adobe online: same everyday tools, free, and your files are never uploaded.',
  h1: 'Private, free alternatives for everyday file jobs',
  lede: 'Fizzdoc does everyday PDF, image, Office and audio jobs inside your browser, free and without uploading your files. If you usually use one of these services for a job, here is the Fizzdoc tool for it.',
  faq: [
    HOW_PRIVATE,
    ['What can’t Fizzdoc do yet?', 'Some jobs aren’t built yet, such as e-signatures, PDF to Excel and video conversion. The list of planned tools is open on GitHub, and contributions are welcome.'],
    ['Are these services affiliated with Fizzdoc?', 'No. Fizzdoc is independent and open source. The names on these pages are trademarks of their owners and are used only to say what each page is about.'],
  ] as [string, string][],
};
