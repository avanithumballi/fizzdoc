// Text/markdown extraction from PDFs, a tiny markdown-to-HTML renderer for printing, and
// spreadsheet <-> CSV conversion. Office spreadsheets are ZIP packages of XML parts, so fflate
// plus small regex-based readers are enough — no DOM parser, no xlsx library needed.
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { LocalError, type Output } from './local';

const baseName = (file: File) => file.name.replace(/\.[^.]+$/, '');
const bytes = async (file: Blob) => new Uint8Array(await file.arrayBuffer());
const plural = (n: number, word: string) => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`;

// ---------------------------------------------------------------------------------------------
// PDF -> text / markdown
// ---------------------------------------------------------------------------------------------

interface Word {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Line {
  text: string;
  y: number;
  size: number;
  heading: 0 | 1 | 2 | 3;
  list: boolean;
}

const LIST_MARKER = /^[•◦▪–]\s+|^-\s+|^\d+\.\s+|^[a-zA-Z]\)\s+/;

/** Groups words with near-identical baselines into one line, left to right. */
function toLines(words: Word[]): Line[] {
  const sorted = [...words].sort((a, b) => b.y - a.y || a.x - b.x);
  const groups: Word[][] = [];
  for (const word of sorted) {
    const group = groups.at(-1);
    const last = group?.at(-1);
    // Tolerance is relative to font size: glyphs on the same baseline can still jitter a little.
    if (last && Math.abs(word.y - last.y) <= 0.35 * Math.max(word.height, last.height)) group!.push(word);
    else groups.push([word]);
  }
  return groups.map((group) => {
    group.sort((a, b) => a.x - b.x);
    let text = '';
    let prev: Word | undefined;
    for (const word of group) {
      if (prev) {
        const gap = word.x - (prev.x + prev.width);
        if (gap > 0.25 * prev.height && !/\s$/.test(text) && !/^\s/.test(word.text)) text += ' ';
      }
      text += word.text;
      prev = word;
    }
    const size = group.map((w) => w.height).sort((a, b) => a - b)[Math.floor(group.length / 2)];
    return { text: text.trim(), y: group[0].y, size, heading: 0 as const, list: LIST_MARKER.test(text.trim()) };
  }).filter((line) => line.text);
}

/** Marks headings by comparing each line's size to the page's most common ("body") size. */
function markHeadings(lines: Line[]): void {
  if (!lines.length) return;
  const counts = new Map<number, number>();
  for (const line of lines) {
    const key = Math.round(line.size * 2) / 2;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const bodySize = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0] || 1;
  for (const line of lines) {
    if (line.list) continue;
    const ratio = line.size / bodySize;
    line.heading = ratio >= 1.6 ? 1 : ratio >= 1.3 ? 2 : ratio >= 1.15 ? 3 : 0;
  }
}

/** Joins a wrapped line onto a paragraph buffer, undoing an end-of-line hyphen when it looks like a split word. */
function appendToParagraph(buffer: string, text: string): string {
  if (!buffer) return text;
  if (/\p{L}-$/u.test(buffer) && /^\p{Ll}/u.test(text)) return buffer.slice(0, -1) + text;
  return `${buffer} ${text}`;
}

const escapeMd = (text: string) => text.replace(/[\\`*_{}[\]#]/g, '\\$&');

type Block = { kind: 'heading'; level: 1 | 2 | 3; text: string } | { kind: 'list'; text: string } | { kind: 'para'; text: string };

/** Turns a page's lines into paragraph/heading/list blocks, reflowing wrapped body text. */
function toBlocks(lines: Line[]): Block[] {
  const blocks: Block[] = [];
  let buffer = '';
  let prev: Line | undefined;
  const flush = () => {
    if (buffer) blocks.push({ kind: 'para', text: buffer });
    buffer = '';
  };
  for (const line of lines) {
    if (line.heading) {
      flush();
      blocks.push({ kind: 'heading', level: line.heading, text: line.text.replace(LIST_MARKER, '') });
    } else if (line.list) {
      flush();
      blocks.push({ kind: 'list', text: line.text.replace(LIST_MARKER, '') });
    } else {
      const gap = prev ? prev.y - line.y : 0;
      if (buffer && gap > 1.5 * (prev?.size || line.size)) flush();
      buffer = appendToParagraph(buffer, line.text);
    }
    prev = line;
  }
  flush();
  return blocks;
}

function renderTxt(pages: Block[][]): string {
  return pages
    .map((blocks) => blocks.map((b) => b.text).join('\n\n'))
    .join('\n\n');
}

function renderMd(pages: Block[][]): string {
  return pages
    .map((blocks) =>
      blocks
        .map((b) => {
          if (b.kind === 'heading') return `${'#'.repeat(b.level)} ${escapeMd(b.text)}`;
          if (b.kind === 'list') return `- ${escapeMd(b.text)}`;
          return escapeMd(b.text);
        })
        .join('\n\n'),
    )
    .join('\n\n---\n\n');
}

export async function pdfToText(file: File, options: { format: 'txt' | 'md' }): Promise<Output> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // pdf.js falls back to an in-process "fake worker" when no workerSrc is set and no worker can be
  // spawned (Node); in the browser we point it at the same bundled worker pdfToImages uses.
  if (typeof window !== 'undefined') {
    pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default;
  }
  let doc;
  try {
    doc = await pdfjs.getDocument({ data: await bytes(file) }).promise;
  } catch (error) {
    throw new LocalError((error as { name?: string }).name === 'PasswordException' ? 'PDF_PASSWORD' : 'INVALID_PDF');
  }
  const pageBlocks: Block[][] = [];
  let words = 0;
  for (let number = 1; number <= doc.numPages; number++) {
    const page = await doc.getPage(number);
    const content = await page.getTextContent();
    const items: Word[] = (content.items as { str: string; transform: number[]; width: number; height: number }[])
      .filter((item) => item.str.trim())
      .map((item) => ({ text: item.str, x: item.transform[4], y: item.transform[5], width: item.width, height: item.height || 1 }));
    const lines = toLines(items);
    markHeadings(lines);
    const blocks = toBlocks(lines);
    if (blocks.length) pageBlocks.push(blocks);
    for (const block of blocks) words += block.text.split(/\s+/).filter(Boolean).length;
    page.cleanup();
  }
  await doc.loadingTask.destroy();
  if (!pageBlocks.length) throw new LocalError('NO_TEXT');
  const text = options.format === 'md' ? renderMd(pageBlocks) : renderTxt(pageBlocks);
  const name = `${baseName(file)}.${options.format}`;
  const type = options.format === 'md' ? 'text/markdown' : 'text/plain;charset=utf-8';
  return { blob: new Blob([text], { type }), name, summary: `${plural(doc.numPages, 'page')} · ${plural(words, 'word')}` };
}

// ---------------------------------------------------------------------------------------------
// text/markdown -> print-ready HTML
// ---------------------------------------------------------------------------------------------

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const PAGE_CSS = `
:root { color-scheme: light; }
body { font-family: -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif; line-height: 1.5; color: #1a1a1a; max-width: 760px; margin: 0 auto; padding: 24px; }
h1, h2, h3, h4 { line-height: 1.25; margin: 1.2em 0 0.4em; }
p { margin: 0.6em 0; }
ul, ol { margin: 0.4em 0; padding-left: 1.6em; }
li { margin: 0.2em 0; }
blockquote { margin: 0.6em 0; padding: 0.2em 1em; border-left: 3px solid #ccc; color: #444; }
code { font-family: ui-monospace, Consolas, Menlo, monospace; background: #f2f2f2; padding: 0.1em 0.3em; border-radius: 3px; }
pre { background: #f2f2f2; padding: 0.8em 1em; border-radius: 6px; overflow-x: auto; white-space: pre-wrap; word-wrap: break-word; }
pre code { background: none; padding: 0; }
table { border-collapse: collapse; margin: 0.6em 0; width: 100%; }
th, td { border: 1px solid #ccc; padding: 0.4em 0.6em; text-align: left; }
hr { border: none; border-top: 1px solid #ccc; margin: 1.5em 0; }
a { color: #1a56db; }
@media print {
  @page { size: A4; margin: 18mm; }
  body { max-width: none; padding: 0; }
}
`;

function htmlDocument(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${PAGE_CSS}</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

/** Plain text: paragraphs split on blank lines, single newlines kept as line breaks. Everything escaped. */
function txtToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((para) => para.trim())
    .filter(Boolean)
    .map((para) => `<p>${escapeHtml(para).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

/** [text](href), scanned by hand so a parenthesis inside href (as in a bare "javascript:alert(1)") doesn't break parsing. */
function renderLinks(text: string): string {
  let result = '';
  let i = 0;
  while (i < text.length) {
    // Images would need fetching from the web, which the page never does: show their description.
    const image = text[i] === '!' && text[i + 1] === '[' ? /^!\[([^\]]*)\]\([^)]*\)/.exec(text.slice(i)) : null;
    if (image) {
      result += image[1] ? `<em>[${image[1]}]</em>` : '';
      i += image[0].length;
      continue;
    }
    if (text[i] === '[') {
      const close = text.indexOf(']', i);
      if (close !== -1 && text[close + 1] === '(') {
        let depth = 1;
        let j = close + 2;
        while (j < text.length && depth > 0) {
          if (text[j] === '(') depth++;
          else if (text[j] === ')') depth--;
          j++;
        }
        if (depth === 0) {
          const label = text.slice(i + 1, close);
          const href = text.slice(close + 2, j - 1);
          result += /^(https?:|mailto:)/i.test(href.replace(/&amp;/g, '&')) ? `<a href="${href.replace(/"/g, '&quot;')}">${label}</a>` : label;
          i = j;
          continue;
        }
      }
    }
    result += text[i];
    i++;
  }
  return result;
}

// Minimal, deliberately small markdown renderer: escape everything first, then only ever add
// tags around patterns we recognize, so no input can produce real HTML we did not intend.
function inlineMd(raw: string): string {
  const escaped = escapeHtml(raw);
  const codeSpans: string[] = [];
  const withoutCode = escaped.replace(/`([^`]+)`/g, (_, code: string) => {
    codeSpans.push(code);
    return `\u0000${codeSpans.length - 1}\u0000`;
  });
  const withLinks = renderLinks(withoutCode);
  const withBold = withLinks.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_]+)__/g, '<strong>$1</strong>');
  const withItalic = withBold.replace(/\*([^*]+)\*/g, '<em>$1</em>').replace(/(?<![A-Za-z0-9])_([^_]+)_(?![A-Za-z0-9])/g, '<em>$1</em>');
  return withItalic.replace(/\u0000(\d+)\u0000/g, (_, i: string) => `<code>${codeSpans[Number(i)]}</code>`);
}

interface ListState {
  tag: 'ul' | 'ol';
  indent: number;
}

/** Small GFM-ish markdown -> HTML block renderer (headings, lists w/ one nesting level, quotes, tables, code, rules). */
function mdToHtml(source: string): string {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  const listStack: ListState[] = [];
  const liOpenStack: boolean[] = []; // parallel to listStack: whether that level's current <li> is still open
  let paragraph: string[] = [];
  let quote: string[] = [];

  const closeLists = (upTo = 0) => {
    while (listStack.length > upTo) {
      if (liOpenStack.pop()) out.push('</li>');
      out.push(`</${listStack.pop()!.tag}>`);
    }
  };
  const flushParagraph = () => {
    if (paragraph.length) out.push(`<p>${inlineMd(paragraph.join(' '))}</p>`);
    paragraph = [];
  };
  const flushQuote = () => {
    if (quote.length) out.push(`<blockquote><p>${inlineMd(quote.join(' '))}</p></blockquote>`);
    quote = [];
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (/^```/.test(line.trim())) {
      flushParagraph();
      flushQuote();
      closeLists();
      const fenceLang = line.trim().slice(3).trim();
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        code.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      const cls = fenceLang ? ` class="language-${escapeHtml(fenceLang)}"` : '';
      out.push(`<pre><code${cls}>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      flushQuote();
      closeLists();
      i++;
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushQuote();
      closeLists();
      const level = heading[1].length;
      out.push(`<h${level}>${inlineMd(heading[2].trim())}</h${level}>`);
      i++;
      continue;
    }

    if (/^ {0,3}([-*_])( *\1){2,}\s*$/.test(line)) {
      flushParagraph();
      flushQuote();
      closeLists();
      out.push('<hr>');
      i++;
      continue;
    }

    // GFM pipe table: a header row immediately followed by a |---|---| separator row.
    if (line.includes('|') && lines[i + 1] && /^\s*\|?[\s:|-]+\|[\s:|-]*\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      flushParagraph();
      flushQuote();
      closeLists();
      const splitRow = (row: string) =>
        row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
      const header = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      let table = '<table><thead><tr>' + header.map((h) => `<th>${inlineMd(h)}</th>`).join('') + '</tr></thead>';
      if (rows.length) table += '<tbody>' + rows.map((r) => `<tr>${r.map((c) => `<td>${inlineMd(c)}</td>`).join('')}</tr>`).join('') + '</tbody>';
      table += '</table>';
      out.push(table);
      continue;
    }

    if (/^>\s?/.test(line)) {
      flushParagraph();
      closeLists();
      quote.push(line.replace(/^>\s?/, ''));
      i++;
      continue;
    }
    flushQuote();

    const listItem = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (listItem) {
      flushParagraph();
      const indent = listItem[1].length;
      const tag: 'ul' | 'ol' = /\d/.test(listItem[2]) ? 'ol' : 'ul';
      // Close deeper levels (their <li>, then their list), landing on the level this item belongs to.
      while (listStack.length && listStack.at(-1)!.indent > indent) {
        if (liOpenStack.pop()) out.push('</li>');
        out.push(`</${listStack.pop()!.tag}>`);
      }
      const top = listStack.at(-1);
      if (top && top.indent === indent) {
        if (liOpenStack[liOpenStack.length - 1]) {
          out.push('</li>');
          liOpenStack[liOpenStack.length - 1] = false;
        }
        if (top.tag !== tag) {
          out.push(`</${listStack.pop()!.tag}>`);
          liOpenStack.pop();
          out.push(`<${tag}>`);
          listStack.push({ tag, indent });
          liOpenStack.push(false);
        }
      } else {
        // Deeper than the current top (or no list open yet): nest inside the still-open parent <li>.
        out.push(`<${tag}>`);
        listStack.push({ tag, indent });
        liOpenStack.push(false);
      }
      out.push(`<li>${inlineMd(listItem[3])}`);
      liOpenStack[liOpenStack.length - 1] = true;
      i++;
      continue;
    }
    closeLists();

    paragraph.push(line.trim());
    i++;
  }
  flushParagraph();
  flushQuote();
  closeLists();
  return out.join('\n');
}

/** Renders a .txt or .md file to a self-contained, print-ready HTML page (no scripts, no external resources). */
export async function textToHtml(file: File): Promise<{ html: string; title: string }> {
  const text = (await file.text()).replace(/^﻿/, '');
  const isMd = /\.md$|\.markdown$/i.test(file.name);
  const title = baseName(file);
  const body = isMd ? mdToHtml(text) : txtToHtml(text);
  return { html: htmlDocument(title, body), title };
}

// ---------------------------------------------------------------------------------------------
// xlsx -> csv
// ---------------------------------------------------------------------------------------------

const decodeXmlEntities = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, '&');

function openZip(data: Uint8Array): Record<string, Uint8Array> {
  try {
    const entries = unzipSync(data);
    if (!entries['[Content_Types].xml']) throw new Error();
    return entries;
  } catch {
    throw new LocalError('NOT_OFFICE');
  }
}

function colToIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? 'A';
  let idx = 0;
  for (const ch of letters) idx = idx * 26 + (ch.charCodeAt(0) - 64);
  return idx - 1;
}

function colLetters(index: number): string {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function parseSharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  const items: string[] = [];
  for (const m of xml.matchAll(/<si(?:\/>|>([\s\S]*?)<\/si>)/g)) {
    const body = m[1] ?? '';
    const texts = [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => decodeXmlEntities(t[1]));
    items.push(texts.join(''));
  }
  return items;
}

interface DateFormat {
  isDate: boolean;
  withTime: boolean;
}

function parseStyles(xml: string | undefined): (styleIndex: number | undefined) => DateFormat {
  const none: DateFormat = { isDate: false, withTime: false };
  if (!xml) return () => none;
  const customFormats = new Map<number, string>();
  const numFmtsBlock = /<numFmts\b[^>]*>([\s\S]*?)<\/numFmts>/.exec(xml)?.[1] ?? '';
  for (const m of numFmtsBlock.matchAll(/<numFmt\b[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"[^>]*\/>/g)) {
    customFormats.set(Number(m[1]), decodeXmlEntities(m[2]));
  }
  const cellXfsBlock = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml)?.[1] ?? '';
  const xfs = [...cellXfsBlock.matchAll(/<xf\b([^>]*?)(?:\/>|>[\s\S]*?<\/xf>)/g)].map(
    (m) => Number(/numFmtId="(\d+)"/.exec(m[1])?.[1] ?? 0),
  );
  const cache = new Map<number, DateFormat>();
  // Built-in numFmtId 14-22 are the standard date/time formats; anything else is a date only if
  // its custom code spells out day/month/year/hour/second letters outside quoted literals or [color] tags.
  function classify(numFmtId: number): DateFormat {
    if (cache.has(numFmtId)) return cache.get(numFmtId)!;
    let result: DateFormat;
    if (numFmtId >= 14 && numFmtId <= 22) result = { isDate: true, withTime: numFmtId >= 18 };
    else {
      const code = customFormats.get(numFmtId);
      const stripped = code?.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '') ?? '';
      const isDate = /[dmyhs]/i.test(stripped);
      result = { isDate, withTime: isDate && /[hs]/i.test(stripped) };
    }
    cache.set(numFmtId, result);
    return result;
  }
  return (styleIndex) => (styleIndex === undefined ? none : classify(xfs[styleIndex] ?? 0));
}

function fractionToTime(fraction: number): string {
  const totalSec = Math.round(fraction * 86400);
  const h = String(Math.floor(totalSec / 3600)).padStart(2, '0');
  const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
  const s = String(totalSec % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

/** Excel serial date -> ISO string, including the 1900 system's fake Feb-29-1900 leap day. */
function excelSerialToIso(serial: number, date1904: boolean, withTime: boolean): string {
  const wholeDays = Math.floor(serial);
  const fraction = serial - wholeDays;
  let ms: number;
  if (date1904) {
    ms = Date.UTC(1904, 0, 1) + wholeDays * 86400000;
  } else if (wholeDays === 60) {
    // Excel labels this nonexistent date "2/29/1900"; there is no real Date for it.
    return withTime ? `1900-02-29 ${fractionToTime(fraction)}` : '1900-02-29';
  } else {
    const days = wholeDays > 60 ? wholeDays - 2 : wholeDays - 1;
    ms = Date.UTC(1900, 0, 1) + days * 86400000;
  }
  ms += Math.round(fraction * 86400000);
  const iso = new Date(ms).toISOString();
  return withTime ? `${iso.slice(0, 10)} ${iso.slice(11, 19)}` : iso.slice(0, 10);
}

interface RawCell {
  type?: string;
  style?: number;
  value: string;
}

const csvField = (value: string) => (/[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
const toCsv = (grid: string[][]) => grid.map((row) => row.map(csvField).join(',')).join('\r\n') + (grid.length ? '\r\n' : '');

const sanitizeSheetName = (name: string) => name.replace(/[\\/:*?"<>|[\]]/g, '_').trim() || 'Sheet';

export async function xlsxToCsv(file: File): Promise<Output> {
  const entries = openZip(await bytes(file));
  const workbookXml = entries['xl/workbook.xml'] ? strFromU8(entries['xl/workbook.xml']) : undefined;
  if (!workbookXml) throw new LocalError('NOT_OFFICE');
  const relsXml = entries['xl/_rels/workbook.xml.rels'] ? strFromU8(entries['xl/_rels/workbook.xml.rels']) : '';
  const relTargets = new Map<string, string>();
  for (const m of relsXml.matchAll(/<Relationship\b[^>]*\/>/g)) {
    const id = /Id="([^"]*)"/.exec(m[0])?.[1];
    const target = /Target="([^"]*)"/.exec(m[0])?.[1];
    if (id && target) relTargets.set(id, target.replace(/^\/?xl\//, '').replace(/^\//, ''));
  }
  const sheetMeta = [...workbookXml.matchAll(/<sheet\b[^>]*\/>/g)].map((m) => ({
    name: decodeXmlEntities(/name="([^"]*)"/.exec(m[0])?.[1] ?? 'Sheet'),
    rid: /r:id="([^"]*)"/.exec(m[0])?.[1] ?? '',
  }));
  const date1904 = /<workbookPr\b[^>]*date1904="(?:1|true)"/.test(workbookXml);
  const sharedStrings = parseSharedStrings(entries['xl/sharedStrings.xml'] ? strFromU8(entries['xl/sharedStrings.xml']) : undefined);
  const isDate = parseStyles(entries['xl/styles.xml'] ? strFromU8(entries['xl/styles.xml']) : undefined);

  const cellText = (cell: RawCell | undefined): string => {
    if (!cell) return '';
    if (cell.type === 's') return sharedStrings[Number(cell.value)] ?? '';
    if (cell.type === 'b') return cell.value === '1' ? 'TRUE' : 'FALSE';
    if (cell.type === 'e' || cell.type === 'str' || cell.type === 'inlineStr') return cell.value;
    const fmt = isDate(cell.style);
    if (fmt.isDate && cell.value !== '') {
      const num = Number(cell.value);
      if (!Number.isNaN(num)) return excelSerialToIso(num, date1904, fmt.withTime);
    }
    return cell.value;
  };

  const sheets: { name: string; csv: string; rows: number }[] = [];
  for (const meta of sheetMeta) {
    const path = 'xl/' + (relTargets.get(meta.rid) ?? '');
    const sheetXml = entries[path] ? strFromU8(entries[path]) : undefined;
    if (!sheetXml) continue;
    const sheetData = /<sheetData>([\s\S]*?)<\/sheetData>/.exec(sheetXml)?.[1] ?? '';
    const rows = new Map<number, Map<number, RawCell>>();
    let maxCol = -1;
    let maxRow = 0;
    for (const rm of sheetData.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const rNum = Number(/r="(\d+)"/.exec(rm[1])?.[1] ?? 0);
      if (!rNum) continue;
      maxRow = Math.max(maxRow, rNum);
      const cellMap = new Map<number, RawCell>();
      for (const cm of (rm[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = /r="([A-Z]+\d+)"/.exec(cm[1])?.[1];
        if (!ref) continue;
        const col = colToIndex(ref);
        maxCol = Math.max(maxCol, col);
        const type = /t="([^"]*)"/.exec(cm[1])?.[1];
        const style = /s="(\d+)"/.exec(cm[1])?.[1];
        const cellBody = cm[2] ?? '';
        const value =
          type === 'inlineStr'
            ? [...cellBody.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => decodeXmlEntities(t[1])).join('')
            : decodeXmlEntities(/<v>([\s\S]*?)<\/v>/.exec(cellBody)?.[1] ?? '');
        cellMap.set(col, { type, style: style ? Number(style) : undefined, value });
      }
      rows.set(rNum, cellMap);
    }
    const grid: string[][] = [];
    for (let r = 1; r <= maxRow; r++) {
      const cellMap = rows.get(r);
      const row: string[] = [];
      for (let c = 0; c <= maxCol; c++) row.push(cellText(cellMap?.get(c)));
      grid.push(row);
    }
    sheets.push({ name: meta.name, csv: toCsv(grid), rows: grid.length });
  }
  if (!sheets.length) throw new LocalError('NOT_OFFICE');

  const totalRows = sheets.reduce((sum, s) => sum + s.rows, 0);
  const summary = `${plural(sheets.length, 'sheet')} · ${plural(totalRows, 'row')}`;
  if (sheets.length === 1) {
    return {
      blob: new Blob(['﻿', sheets[0].csv], { type: 'text/csv;charset=utf-8' }),
      name: `${baseName(file)}.csv`,
      summary,
    };
  }
  const used = new Set<string>();
  const zipped: Zippable = {};
  for (const sheet of sheets) {
    let name = sanitizeSheetName(sheet.name);
    let candidate = name;
    for (let n = 2; used.has(candidate); n++) candidate = `${name} (${n})`;
    used.add(candidate);
    zipped[`${candidate}.csv`] = [strToU8('﻿' + sheet.csv), { level: 6 }];
  }
  return { blob: new Blob([zipSync(zipped) as Uint8Array<ArrayBuffer>], { type: 'application/zip' }), name: `${baseName(file)}-sheets.zip`, summary };
}

// ---------------------------------------------------------------------------------------------
// csv -> xlsx
// ---------------------------------------------------------------------------------------------

function detectDelimiter(text: string): string {
  const candidates = [',', ';', '\t', '|'];
  const sampleLines = text.split(/\r\n|\r|\n/).slice(0, 5).filter((l) => l.length);
  let best = ',';
  let bestScore = -1;
  for (const d of candidates) {
    // Rough outside-quotes count; only used to pick a delimiter, not to parse.
    const counts = sampleLines.map((line) => {
      let count = 0;
      let inQuotes = false;
      for (const ch of line) {
        if (ch === '"') inQuotes = !inQuotes;
        else if (ch === d && !inQuotes) count++;
      }
      return count;
    });
    if (!counts.length || counts[0] === 0) continue;
    const consistent = counts.every((c) => c === counts[0]);
    const score = (consistent ? 1000 : 0) + Math.min(...counts);
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === delimiter) {
      row.push(field);
      field = '';
      i++;
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const isRoundTripNumber = (value: string) => value !== '' && Number.isFinite(Number(value)) && String(Number(value)) === value;
// XML 1.0 disallows most control characters even when escaped.
const stripInvalidXmlChars = (value: string) => value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
const escapeXml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export async function csvToXlsx(file: File): Promise<Output> {
  const raw = (await file.text()).replace(/^﻿/, '');
  const delimiter = detectDelimiter(raw);
  const grid = parseCsv(raw, delimiter);

  let maxCols = 0;
  let rowsXml = '';
  grid.forEach((row, ri) => {
    maxCols = Math.max(maxCols, row.length);
    let cellsXml = '';
    row.forEach((value, ci) => {
      if (value === '') return;
      const ref = `${colLetters(ci)}${ri + 1}`;
      if (isRoundTripNumber(value)) {
        cellsXml += `<c r="${ref}"><v>${value}</v></c>`;
      } else {
        const clean = stripInvalidXmlChars(value);
        const preserve = /^\s|\s$|\n/.test(clean) ? ' xml:space="preserve"' : '';
        cellsXml += `<c r="${ref}" t="inlineStr"><is><t${preserve}>${escapeXml(clean)}</t></is></c>`;
      }
    });
    rowsXml += `<row r="${ri + 1}">${cellsXml}</row>`;
  });
  const dimension = grid.length ? `A1:${colLetters(Math.max(maxCols - 1, 0))}${grid.length}` : 'A1';
  const sheetName = sanitizeSheetName(baseName(file)).slice(0, 31) || 'Sheet1';

  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="${dimension}"/><sheetData>${rowsXml}</sheetData></worksheet>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`;

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;

  const entries: Zippable = {
    '[Content_Types].xml': strToU8(contentTypes),
    '_rels/.rels': strToU8(rootRels),
    'xl/workbook.xml': strToU8(workbookXml),
    'xl/_rels/workbook.xml.rels': strToU8(workbookRels),
    'xl/worksheets/sheet1.xml': strToU8(sheetXml),
  };
  const zipped = zipSync(entries, { level: 6 });
  const rows = grid.length;
  return {
    blob: new Blob([zipped as Uint8Array<ArrayBuffer>], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    name: `${baseName(file)}.xlsx`,
    summary: plural(rows, 'row'),
  };
}
