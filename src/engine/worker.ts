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
  | { type: 'done'; output: Blob; pageCount: number; warnings: Warning[] }
  | { type: 'count'; pages: number | null }
  | { type: 'error'; code: ErrorCode; pages?: number };

const post = (message: FromWorker) => (self as unknown as Worker).postMessage(message);
let answer: ((password: string | null) => void) | undefined;

self.onmessage = async ({ data }: MessageEvent<ToWorker>) => {
  if (data.type === 'password') {
    answer?.(data.password);
    answer = undefined;
    return;
  }
  try {
    const q = await createQpdf({ locateFile: () => wasmUrl });
    // WORKERFS reads the files lazily from their Blobs instead of copying them into WASM memory.
    q.FS.mkdir('/in');
    const files = data.type === 'count' ? [data.file] : data.files;
    q.FS.mount(q.WORKERFS, { blobs: files.map((blob, i) => ({ name: `${i}.pdf`, data: blob })) }, '/in');
    if (data.type === 'count') return post({ type: 'count', pages: await countPages(q as unknown as Qpdf, '/in/0.pdf') });
    const result = await runJob(
      q as unknown as Qpdf,
      data.files.map((_, i) => `/in/${i}.pdf`),
      data.job,
      (file, attempt) =>
        new Promise((resolve) => {
          answer = resolve;
          post({ type: 'password', file, attempt });
        }),
    );
    const output = new Blob([result.output as Uint8Array<ArrayBuffer>], { type: 'application/pdf' });
    post({ type: 'done', output, pageCount: result.pageCount, warnings: result.warnings });
  } catch (error) {
    if (data.type === 'count') return post({ type: 'count', pages: null });
    post(error instanceof PdfError ? { type: 'error', code: error.code, pages: error.pages } : { type: 'error', code: 'PROCESSING_FAILED' });
  }
};
