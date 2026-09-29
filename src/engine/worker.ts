// One disposable worker per job: the page terminates it when the job ends or is canceled,
// which also discards the files, passwords and engine memory it held.
import createQpdf from '@neslinesli93/qpdf-wasm';
import wasmUrl from '@neslinesli93/qpdf-wasm/dist/qpdf.wasm?url';
import { PdfError, countPages, runJob, type ErrorCode, type Job, type Qpdf, type Warning } from './pdf';

export type ToWorker =
  | { type: 'run'; job: Job; files: File[] }
  | { type: 'count'; file: File }
  | { type: 'password'; password: string | null };

export type FromWorker =
  | { type: 'password'; file: number; attempt: number }
  | { type: 'progress'; fraction: number }
  | { type: 'done'; output: Blob; pageCount: number; warnings: Warning[] }
  | { type: 'count'; pages: number | null }
  | { type: 'error'; code: ErrorCode; pages?: number };

// qpdf writes the problems it hits (a wrong password, a damaged file) to stderr. The page already
// explains them in plain words, so only qpdf's own diagnostic lines are kept out of the console.
const quiet =
  (write: typeof console.error) =>
  (...args: unknown[]) =>
    /^(this\.program|WARNING): /.test(String(args[0])) || write(...args);
console.error = quiet(console.error);
console.warn = quiet(console.warn);

const post = (message: FromWorker) => (self as unknown as Worker).postMessage(message);

// With --progress, qpdf prints "…: write progress: 42%" lines to stdout, which this build sends to
// console.log (its print option is ignored). They become progress messages instead of console noise.
const log = console.log;
console.log = (...args: unknown[]) => {
  const pct = /: write progress: (\d+)%$/.exec(String(args[0]))?.[1];
  if (pct === undefined) return log(...args);
  post({ type: 'progress', fraction: READ_SHARE + ((1 - READ_SHARE) * Number(pct)) / 100 });
};
let answer: ((password: string | null) => void) | undefined;

// Files are copied into engine memory with one sequential read. qpdf reads its input in thousands of
// small pieces, and on Android every small read of a picked file is slow: a 10 MB PDF read lazily
// took minutes. Only inputs too big to copy safely are still read lazily (WORKERFS).
const COPY_UP_TO = 128 * 1024 * 1024;
// Share of the progress bar for reading the files; qpdf's own "write progress" fills the rest.
const READ_SHARE = 0.3;

// The Qpdf type covers what pdf.ts needs; the worker also sets up the input folder.
type Engine = Qpdf & {
  WORKERFS: unknown;
  FS: Qpdf['FS'] & {
    mkdir(path: string): void;
    mount(type: unknown, options: { blobs: { name: string; data: Blob }[] }, path: string): void;
    writeFile(path: string, data: Uint8Array): void;
  };
};

async function copyIn(q: Engine, files: File[], report: boolean) {
  const total = files.reduce((sum, file) => sum + file.size, 0) || 1;
  let done = 0;
  for (const [i, file] of files.entries()) {
    const bytes = new Uint8Array(file.size);
    let at = 0;
    const reader = file.stream().getReader();
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      bytes.set(chunk.value, at);
      at += chunk.value.length;
      if (report) post({ type: 'progress', fraction: ((done + at) / total) * READ_SHARE });
    }
    done += file.size;
    q.FS.writeFile(`/in/${i}.pdf`, bytes);
  }
}

self.onmessage = async ({ data }: MessageEvent<ToWorker>) => {
  if (data.type === 'password') {
    answer?.(data.password);
    answer = undefined;
    return;
  }
  const run = data.type === 'run';
  try {
    const q = (await createQpdf({ locateFile: () => wasmUrl })) as unknown as Engine;
    q.FS.mkdir('/in');
    const files = run ? data.files : [data.file];
    if (files.reduce((sum, file) => sum + file.size, 0) <= COPY_UP_TO) await copyIn(q, files, run);
    else q.FS.mount(q.WORKERFS, { blobs: files.map((blob, i) => ({ name: `${i}.pdf`, data: blob })) }, '/in');
    if (!run) return post({ type: 'count', pages: await countPages(q, '/in/0.pdf') });
    const result = await runJob(
      q,
      files.map((_, i) => `/in/${i}.pdf`),
      data.job,
      (file, attempt) =>
        new Promise((resolve) => {
          answer = resolve;
          post({ type: 'password', file, attempt });
        }),
      { progress: true },
    );
    const output = new Blob([result.output as Uint8Array<ArrayBuffer>], { type: 'application/pdf' });
    post({ type: 'done', output, pageCount: result.pageCount, warnings: result.warnings });
  } catch (error) {
    if (!run) return post({ type: 'count', pages: null });
    post(error instanceof PdfError ? { type: 'error', code: error.code, pages: error.pages } : { type: 'error', code: 'PROCESSING_FAILED' });
  }
};
