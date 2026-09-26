# Third-party notices

The deployed site ships these third-party components in `assets/`:

| Component | License | Source |
|---|---|---|
| qpdf 12.2.0 | Apache-2.0 | https://github.com/qpdf/qpdf |
| @neslinesli93/qpdf-wasm 0.3.0 (Emscripten build and JS loader) | ISC | https://github.com/neslinesli93/qpdf-wasm |
| zlib (compiled into qpdf) | zlib | https://zlib.net |
| libjpeg-turbo (compiled into qpdf) | IJG and BSD-3-Clause | https://libjpeg-turbo.org |
| pdf.js (pdfjs-dist: rendering, text extraction, editor) | Apache-2.0 | https://github.com/mozilla/pdf.js |
| pdf-lib (JPG → PDF, compression, OCR text layer, editing) with pako, @pdf-lib/standard-fonts, @pdf-lib/upng, tslib | MIT (tslib: 0BSD) | https://github.com/Hopding/pdf-lib |
| fflate (Office files, ZIP output) | MIT | https://github.com/101arrowz/fflate |
| Tesseract OCR engine (tesseract.js, tesseract.js-core) | Apache-2.0 | https://github.com/naptha/tesseract.js |
| English language data (@tesseract.js-data/eng, tessdata 4.0.0 best_int) | Apache-2.0 data, MIT package | https://github.com/tesseract-ocr/tessdata |
| Inter typeface (@fontsource-variable/inter) | SIL Open Font License 1.1 | https://rsms.me/inter |

No AGPL components are included. Keep this table in sync when adding an engine.
