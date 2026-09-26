<div align="center">

# Fizzdoc

**Private PDF, Word, Excel, PowerPoint and image tools that never upload your files.**

**[fizzdoc.pages.dev](https://fizzdoc.pages.dev)** · Edit, compress, convert and OCR PDFs; convert Word, Excel and images — entirely in your browser.<br>
No server, no sign-up, no watermark. Open source.

[![CI](https://github.com/kingrishabdugar/localpdf/actions/workflows/ci.yml/badge.svg)](https://github.com/kingrishabdugar/localpdf/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-4f46e5.svg)](LICENSE)
![Bytes uploaded: 0](https://img.shields.io/badge/bytes%20uploaded-0-16a34a.svg)
[![GitHub stars](https://img.shields.io/github/stars/kingrishabdugar/localpdf?style=social)](https://github.com/kingrishabdugar/localpdf/stargazers)

**If Fizzdoc saves you time, please ⭐ star this repo — it helps more people find a private alternative.**

</div>

## Why Fizzdoc

Most "free online PDF" sites upload your contracts, payslips and medical records to their servers. A growing number of tools run in the browser instead, but copying pages with the popular pdf-lib library is known to lose bookmarks, the form catalog and internal links.

Fizzdoc does both jobs properly:

- **Your files stay on your device.** Documents are processed by [qpdf](https://github.com/qpdf/qpdf), compiled to WebAssembly and run in a Web Worker in your tab. There is no upload endpoint to send them to.
- **The browser enforces it.** Every page ships a Content Security Policy with `connect-src 'self'`: the page can only talk to its own static host.
- **Your PDF stays intact.** qpdf rewrites the document structure instead of redrawing pages. When something genuinely can't be carried over, Fizzdoc says so — it never drops it silently.

## What survives

Measured by the test suite (`tests/engine.test.ts`) against the fixtures in `tests/fixtures`:

| | Merge | Split / delete | Rotate |
|---|---|---|---|
| Form fields | ✅ from every file | ✅ (fields on removed pages are removed cleanly) | ✅ |
| Internal links | ✅ retargeted to the new pages | ✅ | ✅ |
| Bookmarks | ✅ first file · ⚠️ warns for later files | ✅ · ⚠️ warns if a target page was removed | ✅ |
| Page quality | Lossless — nothing is re-rendered or re-compressed | Lossless | Lossless |
| Password-protected input | 🔑 asks locally, output has no password | 🔑 | 🔑 |

Fizzdoc also warns when a document's digital signatures will stop validating or when accessibility tags can't be rebuilt, and refuses dynamic XFA forms rather than corrupting them.

## Tools

| Format | Tools |
|---|---|
| PDF | Edit PDF (change text in place) · Compress · Merge · Split · Extract pages · Reorder pages · Rotate · Delete pages · Add page numbers · Watermark · Unlock · Protect (AES-256) · Remove metadata · OCR (searchable PDF) · PDF → Word · PDF → PowerPoint · PDF → JPG · PDF → PNG · PDF → Text · PDF → Markdown · JPG → PDF · PNG → PDF · Text → PDF · Markdown → PDF |
| Word (.docx) | Word → PDF · Compress · Remove metadata · Extract images |
| Excel (.xlsx) | Excel → CSV · CSV → Excel · Compress · Remove metadata · Extract images |
| PowerPoint (.pptx) | Compress · Remove metadata · Extract images |
| Images | Compress · Resize (larger or smaller) · Convert (JPG / PNG / WebP) · PNG → JPG · JPG → PNG · WebP → JPG · JPG → WebP · Image to text (OCR, select text on the picture) |

Google Docs, Sheets and Slides work too: download the file as .docx, .xlsx or .pptx (File → Download) and use the matching tool. Nothing is sent to Google.

Every tool has its own page at `/<slug>/`, listed in `src/site.ts`.

## Verify the privacy claim yourself

1. Open any tool page and your browser's developer tools → **Network** tab.
2. Run a job.
3. You'll see the app's own files load (the page, and the qpdf engine on first use) — and no request carrying your document.

The end-to-end suite (`tests/app.e2e.ts`) automates exactly this: it merges files in real Chromium and fails if any request goes to another origin, uses a method other than `GET`, or has a body.

## Develop

Requires Node 22+.

```sh
npm install
npm run dev          # http://localhost:5173/merge-pdf/
npm run check        # typecheck + engine tests
npm run test:e2e     # production build + real-browser tests
npm run build        # static site in dist/
```

## Deploy

`dist/` is a plain static site: one prerendered HTML page per tool, plus `sitemap.xml`, `robots.txt` and `llms.txt`. On Cloudflare Pages, connect the repo with build command `npm run build` and output directory `dist`; `public/_headers` adds the security headers. Set your domain in `src/site.ts`.

## How it works

```
index.html + src/site.ts ──(vite build, src/seo.ts)──▶ dist/<tool>/index.html  (SEO copy, JSON-LD, CSP)
                                                        │
src/app.ts        page UI: file list, options, password dialog, download
   │ postMessage(job, File[])
   ▼
src/engine/worker.ts   one disposable worker per job; mounts files with WORKERFS (no copy into WASM memory)
   │
src/engine/pdf.ts      preflight (qpdf --json) → fidelity warnings → qpdf command → output bytes

src/engine/local.ts    no qpdf needed: Office ZIP packages (fflate), JPG → PDF (pdf-lib), PDF → JPG (pdf.js)
```

Canceling a job terminates its worker, which discards the files, passwords and engine memory it held.

## Roadmap

Ship each tool only once it is proven by tests on real documents:

- Page thumbnails and visual reordering
- Repair PDF (the current qpdf build can't recover damaged files)
- PowerPoint → PDF or images, and legacy .doc / .ppt / .xls (need a full office engine in the browser, tens of MB)
- OCR in more languages (Hindi and others), downloaded only when chosen
- Layout-faithful PDF → Word (tables, columns, images)
- Installable offline app (PWA)

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for diagrams, module responsibilities and design decisions, and open [docs/architecture.html](docs/architecture.html) in a browser for the interactive map.

## Contributing

Issues and pull requests are welcome. Please keep new tools client-side only, add fixtures and tests for what the tool preserves, and update `THIRD_PARTY_NOTICES.md` for any new engine.

## License

[MIT](LICENSE). Bundled third-party components are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
