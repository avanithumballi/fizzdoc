// One disposable worker per job: the page terminates it when the job ends or is canceled,
// which also discards the files, passwords and engine memory it held.
import createQpdf from '@neslinesli93/qpdf-wasm';
import wasmUrl from '@neslinesli93/qpdf-wasm/dist/qpdf.wasm?url';
import { PdfError, runJob, type ErrorCode, type Job, type Qpdf, type Warning } from './pdf';

export type ToWorker = { type: 'run'; job: Job; files: File[] } | { type: 'password'; password: string | null };

export type FromWorker =
  | { type: 'password'; file: number; attempt: number }
  | { type: 'done'; output: Blob; pageCount: number; warnings: Warning[] }
  | { type: 'error'; code: ErrorCode };

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
    q.FS.mount(q.WORKERFS, { blobs: data.files.map((blob, i) => ({ name: `${i}.pdf`, data: blob })) }, '/in');
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
    post({ type: 'error', code: error instanceof PdfError ? error.code : 'PROCESSING_FAILED' });
  }
};
