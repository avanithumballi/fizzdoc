// Edits text where it lives: inside the page's content stream, drawn with the PDF's own font. The
// new text may only use characters that font already has (for an embedded subset font, the ones
// used somewhere in the document), so it looks exactly like the text around it. When that isn't
// possible the caller falls back to covering the old text and drawing new text on top.
import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  StandardFontEmbedder,
  decodePDFRawStream,
  type PDFDocument,
  type PDFObject,
} from 'pdf-lib';

type Matrix = [number, number, number, number, number, number];

const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[1] * n[2],
  m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2],
  m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4],
  m[4] * n[1] + m[5] * n[3] + n[5],
];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

// ---------------------------------------------------------------------------
// Content stream tokens
// ---------------------------------------------------------------------------

export interface Token {
  kind: 'num' | 'name' | 'str' | 'arr' | 'dict' | 'lit';
  start: number;
  end: number;
  num?: number;
  name?: string;
  bytes?: Uint8Array;
  items?: Token[];
}

export interface Op {
  op: string;
  args: Token[];
  /** Byte range from the first operand to the end of the operator. */
  start: number;
  end: number;
}

const isSpace = (c: number) => c === 0 || c === 9 || c === 10 || c === 12 || c === 13 || c === 32;
const isDelim = (c: number) => c === 40 || c === 41 || c === 60 || c === 62 || c === 91 || c === 93 || c === 123 || c === 125 || c === 47 || c === 37;
const hexValue = (c: number) => (c >= 48 && c <= 57 ? c - 48 : c >= 65 && c <= 70 ? c - 55 : c >= 97 && c <= 102 ? c - 87 : -1);

/** Splits a decoded content stream into operators with their operands. Inline images are kept whole. */
export function parseContent(data: Uint8Array): Op[] {
  let i = 0;
  const ops: Op[] = [];

  function skipSpace() {
    while (i < data.length) {
      const c = data[i];
      if (isSpace(c)) i++;
      else if (c === 37) while (i < data.length && data[i] !== 10 && data[i] !== 13) i++;
      else break;
    }
  }

  function literal(): Token {
    const start = i++;
    const out: number[] = [];
    let depth = 1;
    while (i < data.length) {
      const c = data[i++];
      if (c === 92) {
        const n = data[i++];
        const escapes: Record<number, number> = { 110: 10, 114: 13, 116: 9, 98: 8, 102: 12 };
        if (n in escapes) out.push(escapes[n]);
        else if (n >= 48 && n <= 55) {
          let value = n - 48;
          for (let k = 0; k < 2 && data[i] >= 48 && data[i] <= 55; k++) value = value * 8 + data[i++] - 48;
          out.push(value & 255);
        } else if (n === 13) {
          if (data[i] === 10) i++;
        } else if (n !== 10) out.push(n);
      } else if (c === 40) {
        depth++;
        out.push(c);
      } else if (c === 41) {
        if (--depth === 0) break;
        out.push(c);
      } else out.push(c);
    }
    return { kind: 'str', start, end: i, bytes: new Uint8Array(out) };
  }

  function hex(): Token {
    const start = i++;
    const digits: number[] = [];
    while (i < data.length && data[i] !== 62) {
      const v = hexValue(data[i++]);
      if (v >= 0) digits.push(v);
    }
    i++;
    if (digits.length % 2) digits.push(0);
    const bytes = new Uint8Array(digits.length / 2);
    for (let k = 0; k < bytes.length; k++) bytes[k] = digits[2 * k] * 16 + digits[2 * k + 1];
    return { kind: 'str', start, end: i, bytes };
  }

  function word(): string {
    const start = i;
    while (i < data.length && !isSpace(data[i]) && !isDelim(data[i])) i++;
    return String.fromCharCode(...data.subarray(start, i));
  }

  /** The next operand, or a string when the next thing is an operator keyword. */
  function next(): Token | string | undefined {
    skipSpace();
    if (i >= data.length) return undefined;
    const c = data[i];
    const start = i;
    if (c === 40) return literal();
    if (c === 60 && data[i + 1] === 60) {
      i += 2;
      const items: Token[] = [];
      for (;;) {
        skipSpace();
        if (i >= data.length) break;
        if (data[i] === 62 && data[i + 1] === 62) {
          i += 2;
          break;
        }
        const item = next();
        if (item === undefined) break;
        if (typeof item !== 'string') items.push(item);
      }
      return { kind: 'dict', start, end: i, items };
    }
    if (c === 60) return hex();
    if (c === 91) {
      i++;
      const items: Token[] = [];
      for (;;) {
        skipSpace();
        if (i >= data.length) break;
        if (data[i] === 93) {
          i++;
          break;
        }
        const item = next();
        if (item === undefined) break;
        if (typeof item === 'string') items.push({ kind: 'lit', start, end: i, name: item });
        else items.push(item);
      }
      return { kind: 'arr', start, end: i, items };
    }
    if (c === 47) {
      i++;
      const raw = word().replace(/#([0-9a-fA-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
      return { kind: 'name', start, end: i, name: raw };
    }
    if (c === 41 || c === 62 || c === 93 || c === 123 || c === 125) {
      i++; // stray delimiter: skip it
      return next();
    }
    const text = word();
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(text)) return { kind: 'num', start, end: i, num: Number(text) };
    if (text === 'true' || text === 'false' || text === 'null') return { kind: 'lit', start, end: i, name: text };
    return text;
  }

  let args: Token[] = [];
  for (;;) {
    const opStart = (skipSpace(), i);
    const token = next();
    if (token === undefined) break;
    if (typeof token !== 'string') {
      args.push(token);
      continue;
    }
    if (token === 'BI') {
      // Inline image: dictionary up to ID, then raw bytes up to a whitespace-delimited EI.
      const idAt = findKeyword(data, 'ID', i);
      let end = data.length;
      for (let k = idAt + 3; k + 1 < data.length; k++) {
        if (data[k] === 69 && data[k + 1] === 73 && isSpace(data[k - 1]) && (k + 2 >= data.length || isSpace(data[k + 2]))) {
          end = k + 2;
          break;
        }
      }
      i = end;
      ops.push({ op: 'BI', args: [], start: opStart, end });
      args = [];
      continue;
    }
    ops.push({ op: token, args, start: args.length ? args[0].start : opStart, end: i });
    args = [];
  }
  return ops;
}

function findKeyword(data: Uint8Array, word: string, from: number) {
  const a = word.charCodeAt(0);
  const b = word.charCodeAt(1);
  for (let k = from; k + 1 < data.length; k++) {
    if (data[k] === a && data[k + 1] === b && (k === 0 || isSpace(data[k - 1])) && (k + 2 >= data.length || isSpace(data[k + 2]))) return k;
  }
  return data.length;
}

// ---------------------------------------------------------------------------
// Fonts: decoding shown codes to Unicode, glyph widths, and encoding new text
// ---------------------------------------------------------------------------

interface FontInfo {
  twoByte: boolean;
  /** Whether new text can be written with this font at all. */
  writable: boolean;
  /** Not embedded: every code its encoding maps is drawable. */
  embedded: boolean;
  toUnicode: Map<number, string>;
  width: (code: number) => number;
  /** Codes the document already draws with this font: the glyphs a subset font is sure to have. */
  seen: Set<number>;
}

const winAnsi = (() => {
  const mappings = (StandardFontEmbedder.for('Helvetica' as never).encoding as unknown as { unicodeMappings: Record<string, [number, string]> }).unicodeMappings;
  const byCode = new Map<number, string>();
  const byName = new Map<string, string>();
  for (const [cp, [code, name]] of Object.entries(mappings)) {
    const char = String.fromCodePoint(Number(cp));
    byCode.set(code, char);
    byName.set(name, char);
  }
  return { byCode, byName };
})();

function glyphNameToUnicode(name: string): string | undefined {
  const known = winAnsi.byName.get(name);
  if (known) return known;
  const uni = /^uni([0-9A-F]{4})$/.exec(name) ?? /^u([0-9A-F]{4,6})$/.exec(name);
  return uni ? String.fromCodePoint(parseInt(uni[1], 16)) : undefined;
}

function streamBytes(doc: PDFDocument, obj: PDFObject | undefined): Uint8Array | undefined {
  const stream = obj instanceof PDFRef ? doc.context.lookup(obj) : obj;
  if (stream instanceof PDFRawStream) return decodePDFRawStream(stream).decode();
  return undefined;
}

/** Reads bfchar and bfrange entries of a ToUnicode CMap. */
export function parseToUnicode(data: Uint8Array): Map<number, string> {
  const map = new Map<number, string>();
  const ops = parseContent(data);
  const code = (t: Token) => (t.bytes ?? new Uint8Array()).reduce((value, byte) => value * 256 + byte, 0);
  const text = (t: Token) => {
    const b = t.bytes ?? new Uint8Array();
    const units: number[] = [];
    for (let k = 0; k + 1 < b.length; k += 2) units.push(b[k] * 256 + b[k + 1]);
    return String.fromCharCode(...units);
  };
  for (const { op, args } of ops) {
    if (op === 'endbfchar') {
      for (let k = 0; k + 1 < args.length; k += 2) if (args[k].kind === 'str' && args[k + 1].kind === 'str') map.set(code(args[k]), text(args[k + 1]));
    } else if (op === 'endbfrange') {
      for (let k = 0; k + 2 < args.length; k += 3) {
        const [lo, hi, dst] = [args[k], args[k + 1], args[k + 2]];
        if (lo.kind !== 'str' || hi.kind !== 'str') continue;
        const from = code(lo);
        const to = Math.min(code(hi), from + 0xffff);
        if (dst.kind === 'arr') dst.items!.forEach((item, n) => item.kind === 'str' && map.set(from + n, text(item)));
        else if (dst.kind === 'str') {
          const base = text(dst);
          const last = base.charCodeAt(base.length - 1);
          for (let c = from; c <= to; c++) map.set(c, base.slice(0, -1) + String.fromCharCode(last + (c - from)));
        }
      }
    }
  }
  return map;
}

const STANDARD_14 = /^(Times-(Roman|Bold|Italic|BoldItalic)|Helvetica(-Bold|-Oblique|-BoldOblique)?|Courier(-Bold|-Oblique|-BoldOblique)?)$/;

function readFont(doc: PDFDocument, dict: PDFDict): FontInfo {
  const get = (d: PDFDict, key: string) => d.lookup(PDFName.of(key));
  const num = (o: unknown, fallback = 0) => (o instanceof PDFNumber ? o.asNumber() : fallback);
  const subtype = (get(dict, 'Subtype') as PDFName | undefined)?.decodeText();
  const toUnicodeBytes = streamBytes(doc, dict.get(PDFName.of('ToUnicode')));
  const toUnicode = toUnicodeBytes ? parseToUnicode(toUnicodeBytes) : new Map<number, string>();
  const isEmbedded = (descriptor: unknown) =>
    descriptor instanceof PDFDict && ['FontFile', 'FontFile2', 'FontFile3'].some((key) => descriptor.has(PDFName.of(key)));
  const seen = new Set<number>();

  if (subtype === 'Type0') {
    const encoding = get(dict, 'Encoding');
    const descendant = (get(dict, 'DescendantFonts') as PDFArray | undefined)?.lookup(0) as PDFDict | undefined;
    const identity = encoding instanceof PDFName && encoding.decodeText() === 'Identity-H';
    const widths = new Map<number, number>();
    const dw = descendant ? num(get(descendant, 'DW'), 1000) : 1000;
    const w = descendant ? (get(descendant, 'W') as PDFArray | undefined) : undefined;
    for (let k = 0; w && k < w.size(); ) {
      const first = num(w.lookup(k));
      const next = w.lookup(k + 1);
      if (next instanceof PDFArray) {
        for (let n = 0; n < next.size(); n++) widths.set(first + n, num(next.lookup(n)));
        k += 2;
      } else {
        const last = num(next);
        const value = num(w.lookup(k + 2));
        for (let c = first; c <= last && c - first < 65536; c++) widths.set(c, value);
        k += 3;
      }
    }
    return {
      twoByte: true,
      writable: identity && toUnicode.size > 0,
      embedded: true,
      toUnicode: identity ? toUnicode : new Map(),
      width: (c) => widths.get(c) ?? dw,
      seen,
    };
  }

  // Simple fonts: one byte per character.
  const baseFont = (get(dict, 'BaseFont') as PDFName | undefined)?.decodeText().replace(/^[A-Z]{6}\+/, '') ?? '';
  const descriptor = get(dict, 'FontDescriptor');
  const embedded = isEmbedded(descriptor);
  const firstChar = num(get(dict, 'FirstChar'));
  const widthsArray = get(dict, 'Widths') as PDFArray | undefined;
  const missing = descriptor instanceof PDFDict ? num(get(descriptor, 'MissingWidth')) : 0;
  const standard = !widthsArray && STANDARD_14.test(baseFont) ? StandardFontEmbedder.for(baseFont as never) : undefined;
  const unicode = new Map<number, string>();
  const encoding = get(dict, 'Encoding');
  const baseName = encoding instanceof PDFName ? encoding.decodeText() : (encoding instanceof PDFDict ? (get(encoding, 'BaseEncoding') as PDFName | undefined)?.decodeText() : undefined);
  // WinAnsi is the usual base; Standard and MacRoman agree with it on plain ASCII letters and digits.
  for (const [code, char] of winAnsi.byCode) if (baseName === 'WinAnsiEncoding' || baseName === undefined || (code > 32 && code < 127 && code !== 39 && code !== 96)) unicode.set(code, char);
  if (subtype === 'Type3') unicode.clear();
  const differences = encoding instanceof PDFDict ? (get(encoding, 'Differences') as PDFArray | undefined) : undefined;
  for (let k = 0, code = 0; differences && k < differences.size(); k++) {
    const item = differences.lookup(k);
    if (item instanceof PDFNumber) code = item.asNumber();
    else if (item instanceof PDFName) {
      const char = glyphNameToUnicode(item.decodeText());
      if (char) unicode.set(code, char);
      else unicode.delete(code);
      code++;
    }
  }
  for (const [code, char] of toUnicode) unicode.set(code, char);
  return {
    twoByte: false,
    writable: subtype === 'Type1' || subtype === 'TrueType' || subtype === 'MMType1',
    embedded,
    toUnicode: unicode,
    width: (c) => {
      if (widthsArray) {
        const value = widthsArray.lookup(c - firstChar);
        return value instanceof PDFNumber ? value.asNumber() : missing;
      }
      if (standard) {
        const char = unicode.get(c);
        return char ? (standard as unknown as { widthOfTextAtSize(t: string, s: number): number }).widthOfTextAtSize(char, 1000) : missing;
      }
      return missing || 500;
    },
    seen,
  };
}

// ---------------------------------------------------------------------------
// Running the page: where each piece of text is drawn
// ---------------------------------------------------------------------------

export interface Shown {
  op: Op;
  font: FontInfo;
  codes: number[];
  text: string;
  /** Start of the text on the page, in PDF user space, and its baseline direction. */
  x: number;
  y: number;
  dir: [number, number];
  size: number;
}

interface TextState {
  ctm: Matrix;
  font?: FontInfo;
  size: number;
  tc: number;
  tw: number;
  th: number;
  tl: number;
  ts: number;
}

function runPage(ops: Op[], fontFor: (name: string) => FontInfo | undefined): Shown[] {
  const shown: Shown[] = [];
  const stack: TextState[] = [];
  let state: TextState = { ctm: IDENTITY, size: 0, tc: 0, tw: 0, th: 1, tl: 0, ts: 0 };
  let tm: Matrix = IDENTITY;
  let lm: Matrix = IDENTITY;
  const n = (t: Token | undefined) => t?.num ?? 0;
  const moveLine = (tx: number, ty: number) => {
    lm = multiply([1, 0, 0, 1, tx, ty], lm);
    tm = lm;
  };
  const show = (op: Op, strings: Token[]) => {
    const font = state.font;
    if (!font) return;
    const trm = multiply([state.size * state.th, 0, 0, state.size, 0, state.ts], multiply(tm, state.ctm));
    const scale = Math.hypot(trm[0], trm[1]) || 1;
    const record: Shown = { op, font, codes: [], text: '', x: trm[4], y: trm[5], dir: [trm[0] / scale, trm[1] / scale], size: Math.hypot(trm[2], trm[3]) };
    for (const item of strings) {
      if (item.kind === 'num') {
        tm = multiply([1, 0, 0, 1, (-n(item) / 1000) * state.size * state.th, 0], tm);
        continue;
      }
      const bytes = item.bytes ?? new Uint8Array();
      const step = font.twoByte ? 2 : 1;
      for (let k = 0; k + step - 1 < bytes.length; k += step) {
        const code = font.twoByte ? bytes[k] * 256 + bytes[k + 1] : bytes[k];
        record.codes.push(code);
        font.seen.add(code);
        record.text += font.toUnicode.get(code) ?? '�';
        const advance = ((font.width(code) / 1000) * state.size + state.tc + (!font.twoByte && code === 32 ? state.tw : 0)) * state.th;
        tm = multiply([1, 0, 0, 1, advance, 0], tm);
      }
    }
    shown.push(record);
  };
  for (const op of ops) {
    const a = op.args;
    switch (op.op) {
      case 'q':
        stack.push({ ...state });
        break;
      case 'Q':
        state = stack.pop() ?? state;
        break;
      case 'cm':
        if (a.length === 6) state.ctm = multiply(a.map(n) as Matrix, state.ctm);
        break;
      case 'BT':
        tm = lm = IDENTITY;
        break;
      case 'Tf':
        state.font = a[0]?.name !== undefined ? fontFor(a[0].name) : undefined;
        state.size = n(a[1]);
        break;
      case 'Tc':
        state.tc = n(a[0]);
        break;
      case 'Tw':
        state.tw = n(a[0]);
        break;
      case 'Tz':
        state.th = n(a[0]) / 100;
        break;
      case 'TL':
        state.tl = n(a[0]);
        break;
      case 'Ts':
        state.ts = n(a[0]);
        break;
      case 'Td':
        moveLine(n(a[0]), n(a[1]));
        break;
      case 'TD':
        state.tl = -n(a[1]);
        moveLine(n(a[0]), n(a[1]));
        break;
      case 'Tm':
        if (a.length === 6) tm = lm = a.map(n) as Matrix;
        break;
      case 'T*':
        moveLine(0, -state.tl);
        break;
      case 'Tj':
        show(op, a.slice(0, 1));
        break;
      case 'TJ':
        show(op, a[0]?.items ?? []);
        break;
      case "'":
        moveLine(0, -state.tl);
        show(op, a.slice(0, 1));
        break;
      case '"':
        state.tw = n(a[0]);
        state.tc = n(a[1]);
        moveLine(0, -state.tl);
        show(op, a.slice(2, 3));
        break;
    }
  }
  return shown;
}

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------

export interface TextEdit {
  /** The line as the viewer shows it: its start point, baseline direction, font size and length. */
  x: number;
  y: number;
  dir: [number, number];
  size: number;
  width: number;
  text: string;
  newText: string;
}

// Scripts whose glyphs are reordered or joined when drawn (Indic, Arabic, Hebrew, Thai and
// neighbours): the drawn glyph order isn't the typed order, so those lines are never rewritten here.
const SHAPED = /[\u0590-\u08ff\u0900-\u0dff\u0e00-\u0fff\u1000-\u109f\u1780-\u17ff\ua8e0-\ua8ff\ufb1d-\ufdff\ufe70-\ufeff]/;

const squash = (s: string) => s.normalize('NFKC').replace(/\s+/g, '');

/** Finds the pieces of text that together draw `edit.text`, in drawing order along the line. */
function locate(shown: Shown[], edit: TextEdit, taken: Set<Shown>): Shown[] | undefined {
  const [ux, uy] = edit.dir;
  const tolerance = Math.max(edit.size, 1);
  const candidates = shown
    .filter((s) => !taken.has(s) && s.codes.length && s.dir[0] * ux + s.dir[1] * uy > 0.99)
    .map((s) => {
      const dx = s.x - edit.x;
      const dy = s.y - edit.y;
      return { s, along: dx * ux + dy * uy, across: Math.abs(-dx * uy + dy * ux) };
    })
    .filter((c) => c.across < tolerance * 0.3 && c.along > -tolerance * 0.5 && c.along < edit.width + tolerance * 0.5)
    .sort((p, q) => p.along - q.along);
  if (!candidates.length || Math.abs(candidates[0].along) > tolerance * 0.5) return undefined;
  const parts = candidates.map((c) => c.s);
  return squash(parts.map((s) => s.text).join('')) === squash(edit.text) ? parts : undefined;
}

/** True if the text drawn from the edit's start point now begins with the new text. */
function startsWith(shown: Shown[], edit: TextEdit): boolean {
  const want = squash(edit.newText);
  if (!want) return true;
  const [ux, uy] = edit.dir;
  const tolerance = Math.max(edit.size, 1);
  const line = shown
    .filter((s) => s.codes.length && s.dir[0] * ux + s.dir[1] * uy > 0.99)
    .map((s) => ({ s, along: (s.x - edit.x) * ux + (s.y - edit.y) * uy, across: Math.abs(-(s.x - edit.x) * uy + (s.y - edit.y) * ux) }))
    .filter((c) => c.across < tolerance * 0.3 && c.along > -tolerance * 0.5)
    .sort((p, q) => p.along - q.along);
  let text = '';
  for (const { s } of line) {
    text += squash(s.text);
    if (text.startsWith(want)) return true;
    if (!want.startsWith(text)) return false;
  }
  return false;
}

/** The codes for `text` in this font, with gaps standing in for spaces the font can't draw. */
function encode(font: FontInfo, text: string): (number[] | number)[] | undefined {
  const fromUnicode = new Map<string, number>();
  for (const [code, char] of font.toUnicode) {
    const usable = !font.embedded || font.seen.has(code) || (font.twoByte && font.toUnicode.size > 0);
    if (usable && font.width(code) > 0 && !fromUnicode.has(char)) fromUnicode.set(char, code);
  }
  const space = fromUnicode.get(' ');
  const gap = -(space !== undefined ? font.width(space) : 250);
  const out: (number[] | number)[] = [];
  for (const char of text) {
    const code = fromUnicode.get(char);
    if (code === undefined && /\s/.test(char)) out.push(gap);
    else if (code === undefined) return undefined;
    else if (Array.isArray(out.at(-1))) (out.at(-1) as number[]).push(code);
    else out.push([code]);
  }
  return out;
}

const hexOf = (codes: number[], twoByte: boolean) => `<${codes.map((c) => c.toString(16).padStart(twoByte ? 4 : 2, '0')).join('')}>`;
const latin1 = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const source = (data: Uint8Array, t: Token) => String.fromCharCode(...data.subarray(t.start, t.end));

/** What replaces a text-showing operator: `body` is a TJ array, or null to show nothing. */
function rewrite(data: Uint8Array, op: Op, body: string | null): string {
  const show = body ?? '[]';
  if (op.op === "'") return `T* ${show} TJ`;
  if (op.op === '"') return `${source(data, op.args[0])} Tw ${source(data, op.args[1])} Tc T* ${show} TJ`;
  return `${show} TJ`;
}

function contentStreams(doc: PDFDocument, pageIndex: number): { refs: PDFRef[]; data: Uint8Array } | undefined {
  const node = doc.getPage(pageIndex).node;
  const contents = node.get(PDFName.of('Contents'));
  const refs = contents instanceof PDFRef ? [contents] : contents instanceof PDFArray ? contents.asArray() : [];
  const parts: Uint8Array[] = [];
  for (const ref of refs) {
    if (!(ref instanceof PDFRef)) return undefined;
    const bytes = streamBytes(doc, ref);
    if (!bytes) return undefined;
    parts.push(bytes, latin1('\n'));
  }
  if (!parts.length) return undefined;
  const data = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  parts.reduce((at, p) => (data.set(p, at), at + p.length), 0);
  return { refs: refs as PDFRef[], data };
}

function fontsOf(doc: PDFDocument, pageIndex: number, cache: Map<PDFDict, FontInfo>) {
  const resources = doc.getPage(pageIndex).node.Resources();
  const fonts = resources?.lookup(PDFName.of('Font'));
  return (name: string) => {
    const dict = fonts instanceof PDFDict ? fonts.lookup(PDFName.of(name)) : undefined;
    if (!(dict instanceof PDFDict)) return undefined;
    let info = cache.get(dict);
    if (!info) cache.set(dict, (info = readFont(doc, dict)));
    return info;
  };
}

/**
 * Rewrites the given lines on one page in place. Returns, for each edit, whether it was done; the
 * caller handles the rest another way. The page is left untouched if anything looks off.
 */
export function editTextInPlace(doc: PDFDocument, pageIndex: number, edits: TextEdit[]): boolean[] {
  const done = edits.map(() => false);
  const content = contentStreams(doc, pageIndex);
  if (!content) return done;
  const cache = new Map<PDFDict, FontInfo>();
  // Learn which glyphs each font really has from every page, not just this one.
  doc.getPages().forEach((_, index) => {
    if (index === pageIndex) return;
    const other = contentStreams(doc, index);
    if (other) runPage(parseContent(other.data), fontsOf(doc, index, cache));
  });
  const fontFor = fontsOf(doc, pageIndex, cache);
  const shown = runPage(parseContent(content.data), fontFor);

  const replacements: { start: number; end: number; text: string }[] = [];
  const taken = new Set<Shown>();
  edits.forEach((edit, index) => {
    if (SHAPED.test(edit.text + edit.newText)) return;
    const parts = locate(shown, edit, taken);
    if (!parts) return;
    const font = parts[0].font;
    if (!font.writable) return;
    const encoded = encode(font, edit.newText);
    if (!encoded) return;
    const body = `[${encoded.map((item) => (typeof item === 'number' ? String(Math.round(item)) : hexOf(item, font.twoByte))).join(' ')}]`;
    parts.forEach((part, n) => {
      taken.add(part);
      replacements.push({ start: part.op.start, end: part.op.end, text: rewrite(content.data, part.op, n === 0 ? body : null) });
    });
    done[index] = true;
  });
  if (!replacements.length) return done;

  replacements.sort((p, q) => q.start - p.start);
  let data = content.data;
  for (const r of replacements) {
    const text = latin1(r.text);
    const next = new Uint8Array(data.length - (r.end - r.start) + text.length);
    next.set(data.subarray(0, r.start));
    next.set(text, r.start);
    next.set(data.subarray(r.end), r.start + text.length);
    data = next;
  }

  // Check the result says what we meant before touching the file.
  const after = runPage(parseContent(data), fontFor);
  const ok = edits.every((edit, index) => !done[index] || startsWith(after, edit));
  if (!ok) return edits.map(() => false);

  const page = doc.getPage(pageIndex).node;
  const stream = doc.context.flateStream(data);
  page.set(PDFName.of('Contents'), doc.context.register(stream));
  // Drop the old streams so the replaced text doesn't linger in the file, unless another page uses them.
  const elsewhere = new Set<string>();
  doc.getPages().forEach((other, index) => {
    if (index === pageIndex) return;
    const c = other.node.get(PDFName.of('Contents'));
    for (const ref of c instanceof PDFArray ? c.asArray() : [c]) if (ref instanceof PDFRef) elsewhere.add(ref.toString());
  });
  for (const ref of content.refs) if (!elsewhere.has(ref.toString()) && doc.context.lookup(ref) instanceof PDFStream) doc.context.delete(ref);
  return done;
}
