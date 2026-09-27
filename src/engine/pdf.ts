// Environment-agnostic PDF job runner on top of qpdf (WASM). The caller owns the
// qpdf instance and makes the input files available at `inputs` paths.

export type Op = 'merge' | 'split' | 'rotate' | 'delete' | 'unlock' | 'protect' | 'clean';

export interface Job {
  op: Op;
  /** Page selection such as "1-3, 8". Required for split/delete, optional for rotate. */
  pages?: string;
  angle?: 90 | 180 | 270;
  /** New password for protect. */
  password?: string;
}

export type ErrorCode =
  | 'INVALID_PDF'
  | 'BAD_PASSWORD'
  | 'PASSWORD_REQUIRED'
  | 'BAD_RANGE'
  | 'NOT_ENCRYPTED'
  | 'UNSUPPORTED_XFA'
  | 'NO_PAGES_LEFT'
  | 'WRONG_FILE_COUNT'
  | 'NO_PASSWORD'
  | 'PROCESSING_FAILED';

/** Anything the output does not carry over from the input is reported, never dropped silently. */
export type Warning =
  | 'BOOKMARKS_DROPPED'
  | 'BOOKMARKS_BROKEN'
  | 'TAGS_NOT_UPDATED'
  | 'SIGNATURES_INVALIDATED'
  | 'PASSWORD_REMOVED'
  | 'PERMISSIONS_REMOVED';

export class PdfError extends Error {
  /** For BAD_RANGE: the document's page count, so the message can say what is valid. */
  constructor(
    readonly code: ErrorCode,
    readonly pages?: number,
  ) {
    super(code);
  }
}

export interface Qpdf {
  callMain(args: string[]): number;
  FS: {
    readFile(path: string): Uint8Array;
    unlink(path: string): void;
    stat(path: string): { size: number };
    open(path: string, flags: 'r'): unknown;
    read(stream: unknown, buffer: Uint8Array, offset: number, length: number, position: number): number;
    close(stream: unknown): void;
  };
}

export type AskPassword = (file: number, attempt: number) => Promise<string | null>;

export interface Result {
  output: Uint8Array;
  pageCount: number;
  warnings: Warning[];
}

const OUT = '/out.pdf';
const INFO = '/info.json';
const MAX_ATTEMPTS = 3;
const TAIL_BYTES = 1024 * 1024;

// qpdf exits 0 on success and 3 on success with warnings (e.g. a repaired xref).
const ok = (status: number) => status === 0 || status === 3;

/**
 * Parses "1-3, 8, 5" into 1-based page numbers, keeping the typed order and dropping repeats.
 * A range that runs past the last page stops there ("1-5" on a 2-page file is pages 1-2).
 */
export function parsePages(text: string, count: number): number[] {
  const pages = new Set<number>();
  const bad = () => new PdfError('BAD_RANGE', count);
  for (const token of text.replaceAll('–', '-').split(',')) {
    if (!token.trim()) continue;
    const match = /^\s*(\d+)\s*(?:-\s*(\d*)\s*)?$/.exec(token);
    if (!match) throw bad();
    const start = Number(match[1]);
    const end = match[2] === undefined ? start : match[2] === '' ? count : Number(match[2]);
    if (start < 1 || start > count || start > end) throw bad();
    for (let page = start; page <= Math.min(end, count); page++) pages.add(page);
  }
  if (!pages.size) throw bad();
  return [...pages];
}

interface Info {
  pages: number;
  encrypted: boolean;
  /** Target page (1-based) of every bookmark; null when the target is missing. */
  bookmarkPages: (number | null)[];
  xfa: boolean;
  tagged: boolean;
  signed: boolean;
}

interface Outline {
  destpageposfrom1: number | null;
  kids: Outline[];
}

type PdfObject = Record<string, unknown>;

function analyze(json: {
  pages: unknown[];
  outlines: Outline[];
  acroform: { fields: { fieldtype: string }[] };
  encrypt: { encrypted: boolean };
  qpdf: [unknown, Record<string, { value?: PdfObject }>];
}): Omit<Info, 'encrypted'> {
  const objects = json.qpdf[1];
  const deref = (value: unknown) =>
    (typeof value === 'string' && / R$/.test(value) ? objects[`obj:${value}`]?.value : value) as PdfObject | undefined;
  const catalog = deref(objects.trailer?.value?.['/Root']) ?? {};
  const bookmarkPages: (number | null)[] = [];
  const walk = (items: Outline[]) =>
    items.forEach((item) => {
      bookmarkPages.push(item.destpageposfrom1);
      walk(item.kids);
    });
  walk(json.outlines);
  return {
    pages: json.pages.length,
    bookmarkPages,
    xfa: deref(catalog['/AcroForm'])?.['/XFA'] !== undefined,
    tagged: catalog['/StructTreeRoot'] !== undefined,
    signed: json.acroform.fields.some((field) => field.fieldtype === '/Sig'),
  };
}

/**
 * Whether the file's final trailer declares encryption. Only used after an open fails,
 * because this qpdf build exits with the same status for "wrong password" and "damaged file".
 */
function declaresEncryption(q: Qpdf, path: string): boolean {
  const size = q.FS.stat(path).size;
  const length = Math.min(size, TAIL_BYTES);
  const tail = new Uint8Array(length);
  const stream = q.FS.open(path, 'r');
  try {
    q.FS.read(stream, tail, 0, length, size - length);
  } finally {
    q.FS.close(stream);
  }
  return /\/Encrypt\b/.test(new TextDecoder('latin1').decode(tail));
}

/** Opens one input, asking for its password when needed. Returns the password that worked. */
async function open(q: Qpdf, path: string, file: number, askPassword: AskPassword): Promise<[string, Info]> {
  let password = '';
  for (let attempt = 0; ; attempt++) {
    const status = q.callMain([
      `--password=${password}`,
      '--json=2',
      '--json-key=pages',
      '--json-key=outlines',
      '--json-key=acroform',
      '--json-key=encrypt',
      '--json-key=qpdf',
      path,
      INFO,
    ]);
    if (ok(status)) break;
    if (attempt === 0 && !declaresEncryption(q, path)) throw new PdfError('INVALID_PDF');
    if (attempt === MAX_ATTEMPTS) throw new PdfError('BAD_PASSWORD');
    const answer = await askPassword(file, attempt + 1);
    if (answer === null) throw new PdfError('PASSWORD_REQUIRED');
    password = answer;
  }
  try {
    const json = JSON.parse(new TextDecoder().decode(q.FS.readFile(INFO)));
    return [password, { ...analyze(json), encrypted: json.encrypt.encrypted }];
  } catch {
    throw new PdfError('INVALID_PDF');
  } finally {
    q.FS.unlink(INFO);
  }
}

const EXPECTED_FILES: Record<Op, (n: number) => boolean> = {
  merge: (n) => n >= 2,
  split: (n) => n === 1,
  rotate: (n) => n === 1,
  delete: (n) => n === 1,
  unlock: (n) => n === 1,
  protect: (n) => n === 1,
  clean: (n) => n === 1,
};

/** Page count for the file picker; null when the file needs a password or can't be read. */
export async function countPages(q: Qpdf, path: string): Promise<number | null> {
  try {
    return (await open(q, path, 0, async () => null))[1].pages;
  } catch {
    return null;
  }
}

export async function runJob(q: Qpdf, inputs: string[], job: Job, askPassword: AskPassword): Promise<Result> {
  if (!EXPECTED_FILES[job.op](inputs.length)) throw new PdfError('WRONG_FILE_COUNT');

  const passwords: string[] = [];
  const infos: Info[] = [];
  for (let i = 0; i < inputs.length; i++) {
    const [password, info] = await open(q, inputs[i], i, askPassword);
    passwords.push(password);
    infos.push(info);
  }

  const warnings = new Set<Warning>();
  const first = infos[0];
  if (infos.some((info) => info.xfa) && job.op !== 'unlock') throw new PdfError('UNSUPPORTED_XFA');
  if (job.op === 'unlock' && !first.encrypted) throw new PdfError('NOT_ENCRYPTED');
  if (job.op === 'protect' && !job.password) throw new PdfError('NO_PASSWORD');
  if (job.op !== 'unlock' && job.op !== 'protect') {
    infos.forEach((info, i) => {
      if (info.encrypted) warnings.add(passwords[i] ? 'PASSWORD_REMOVED' : 'PERMISSIONS_REMOVED');
    });
  }
  if (infos.some((info) => info.signed)) warnings.add('SIGNATURES_INVALIDATED');

  // The first input is the primary document: its catalog (bookmarks, form, tags) is kept.
  // qpdf rejects --decrypt together with --encrypt; protect replaces any old encryption anyway.
  const args = [inputs[0], `--password=${passwords[0]}`, job.op === 'protect' ? '' : '--decrypt'].filter(Boolean);
  let pageCount = first.pages;
  if (job.op === 'merge') {
    args.push('--pages', '.', '1-z');
    for (let i = 1; i < inputs.length; i++) args.push(inputs[i], `--password=${passwords[i]}`, '1-z');
    args.push('--');
    pageCount = infos.reduce((sum, info) => sum + info.pages, 0);
    // qpdf carries over form fields and links from every input, but only the primary's bookmarks.
    if (infos.slice(1).some((info) => info.bookmarkPages.length)) warnings.add('BOOKMARKS_DROPPED');
    if (infos.some((info) => info.tagged)) warnings.add('TAGS_NOT_UPDATED');
  }
  if (job.op === 'split' || job.op === 'delete') {
    const chosen = parsePages(job.pages ?? '', first.pages);
    const dropped = new Set(chosen);
    const keep =
      job.op === 'split' ? chosen : Array.from({ length: first.pages }, (_, i) => i + 1).filter((p) => !dropped.has(p));
    if (!keep.length) throw new PdfError('NO_PAGES_LEFT');
    args.push('--pages', '.', keep.join(','), '--');
    pageCount = keep.length;
    // Bookmarks survive, but those pointing at removed pages lose their target.
    const kept = new Set(keep);
    if (first.bookmarkPages.some((page) => page === null || !kept.has(page))) warnings.add('BOOKMARKS_BROKEN');
    if (first.tagged) warnings.add('TAGS_NOT_UPDATED');
  }
  if (job.op === 'rotate') {
    if (![90, 180, 270].includes(job.angle ?? 0)) throw new PdfError('PROCESSING_FAILED');
    const pages = job.pages?.trim() ? parsePages(job.pages, first.pages).join(',') : '1-z';
    args.push(`--rotate=+${job.angle}:${pages}`);
  }
  if (job.op === 'clean') args.push('--remove-info', '--remove-metadata');
  if (job.op === 'protect') {
    args.push('--encrypt', `--user-password=${job.password}`, `--owner-password=${job.password}`, '--bits=256', '--');
  }
  args.push(OUT);

  const status = q.callMain(args);
  passwords.fill('');
  args.fill('');
  if (!ok(status)) throw new PdfError('PROCESSING_FAILED');
  const output = q.FS.readFile(OUT);
  q.FS.unlink(OUT);
  return { output, pageCount, warnings: [...warnings] };
}
