import './style.css';
import { setUpEffects } from './effects';
import type { ErrorCode, Job, Op, Warning } from './engine/pdf';
import type { FromWorker, ToWorker } from './engine/worker';

type Failure = ErrorCode | 'ENGINE_FAILED';

const ERRORS: Record<Failure, string> = {
  INVALID_PDF: 'This file could not be read as a PDF. It may be damaged or not a PDF.',
  BAD_PASSWORD: 'That password did not work after three tries. Nothing was changed.',
  PASSWORD_REQUIRED: 'This PDF needs its password to continue. Nothing was changed.',
  BAD_RANGE: 'Check the page numbers. Use numbers and ranges like “1-3, 8” within the document’s page count.',
  NOT_ENCRYPTED: 'This PDF is not password-protected, so there is nothing to unlock.',
  UNSUPPORTED_XFA: 'This PDF uses a dynamic XFA form, which cannot be edited safely. Your file was not changed.',
  NO_PAGES_LEFT: 'That would remove every page. Keep at least one.',
  WRONG_FILE_COUNT: 'Add the number of files this tool needs.',
  PROCESSING_FAILED: 'Something went wrong while processing. Your original file is unchanged.',
  ENGINE_FAILED: 'The PDF engine stopped unexpectedly — the file may be too large for this device.',
};

const WARNINGS: Record<Warning, string> = {
  BOOKMARKS_DROPPED: 'Bookmarks from the second and later files were not carried over. The first file’s bookmarks were kept.',
  BOOKMARKS_BROKEN: 'Some bookmarks pointed to pages that were removed, so they no longer lead anywhere.',
  TAGS_NOT_UPDATED: 'This PDF has accessibility tags that were not rebuilt for the new pages, so screen-reader structure may be incomplete.',
  SIGNATURES_INVALIDATED: 'Digital signatures in this PDF will no longer validate, because the document changed.',
  PASSWORD_REMOVED: 'The new file has no password.',
  PERMISSIONS_REMOVED: 'The original’s editing and printing restrictions are not applied to the new file.',
};

const SUFFIX: Record<Op, string> = {
  merge: 'merged',
  split: 'pages',
  rotate: 'rotated',
  delete: 'trimmed',
  unlock: 'unlocked',
};

const MiB = 1024 * 1024;

/**
 * Largest combined input we start a job for. A policy, not a measurement: 128 MiB per GiB of
 * reported device memory, capped at 1 GiB (the engine's WASM heap tops out at 2 GiB).
 */
function inputBudget() {
  const gib = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return gib ? Math.min(gib * 128, 1024) * MiB : 512 * MiB;
}

const formatSize = (bytes: number) =>
  bytes < MiB ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / MiB).toFixed(1)} MB`;

function setUp(op: Op) {
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;
  const input = $<HTMLInputElement>('file-input')!;
  const drop = $('drop')!;
  const list = $<HTMLOListElement>('file-list')!;
  const pages = $<HTMLInputElement>('pages');
  const angle = $<HTMLSelectElement>('angle');
  const runButton = $<HTMLButtonElement>('run')!;
  const cancelButton = $<HTMLButtonElement>('cancel')!;
  const status = $('status')!;
  const progress = $('progress')!;
  const reorderHint = $('reorder-hint');
  const result = $('result')!;
  const download = $<HTMLAnchorElement>('download')!;
  const warnings = $<HTMLUListElement>('warnings')!;
  const dialog = $<HTMLDialogElement>('password-dialog')!;
  const password = $<HTMLInputElement>('password')!;
  const passwordTitle = $('password-title')!;
  const passwordHint = $('password-hint')!;

  const multiple = op === 'merge';
  let files: File[] = [];
  let worker: Worker | undefined;
  let outputUrl: string | undefined;
  let dragIndex: number | null = null;

  const say = (text: string, tone: 'info' | 'error' = 'info') => {
    status.textContent = text;
    status.dataset.tone = tone;
  };

  function clearResult() {
    if (outputUrl) URL.revokeObjectURL(outputUrl);
    outputUrl = undefined;
    result.hidden = true;
    warnings.replaceChildren();
  }

  function render() {
    list.replaceChildren(
      ...files.map((file, index) => {
        const item = document.createElement('li');
        const name = document.createElement('span');
        name.className = 'file-name';
        name.textContent = file.name;
        const size = document.createElement('span');
        size.className = 'file-size';
        size.textContent = formatSize(file.size);
        item.append(name, size);
        if (multiple && !worker) enableReorder(item, index);
        const buttons: [string, string, () => void, boolean][] = [
          ['↑', 'Move up', () => files.splice(index - 1, 2, files[index], files[index - 1]), multiple && index > 0],
          ['↓', 'Move down', () => files.splice(index, 2, files[index + 1], files[index]), multiple && index < files.length - 1],
          ['×', 'Remove', () => files.splice(index, 1), true],
        ];
        for (const [symbol, label, action, shown] of buttons) {
          if (!shown) continue;
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'icon-button';
          button.textContent = symbol;
          button.setAttribute('aria-label', `${label}: ${file.name}`);
          button.disabled = !!worker;
          button.onclick = () => {
            action();
            clearResult();
            render();
          };
          item.append(button);
        }
        return item;
      }),
    );
    runButton.disabled = !!worker || (multiple ? files.length < 2 : files.length !== 1);
    cancelButton.hidden = !worker;
    progress.hidden = !worker;
    if (reorderHint) reorderHint.hidden = files.length < 2 || !!worker;
    input.disabled = !!worker;
    drop.classList.toggle('compact', files.length > 0);
  }

  /** Desktop drag-and-drop reordering for the merge list; the arrow buttons cover touch and keyboard. */
  function enableReorder(item: HTMLLIElement, index: number) {
    item.draggable = true;
    item.ondragstart = (event) => {
      dragIndex = index;
      event.dataTransfer?.setData('text/plain', String(index));
      item.classList.add('lifted');
    };
    item.ondragend = () => {
      dragIndex = null;
      item.classList.remove('lifted');
    };
    item.ondragover = (event) => {
      if (dragIndex === null) return;
      event.preventDefault();
      item.classList.add('drop-target');
    };
    item.ondragleave = () => item.classList.remove('drop-target');
    item.ondrop = (event) => {
      event.preventDefault();
      if (dragIndex === null || dragIndex === index) return render();
      const [moved] = files.splice(dragIndex, 1);
      files.splice(index, 0, moved);
      dragIndex = null;
      clearResult();
      render();
    };
  }

  function addFiles(incoming: File[]) {
    if (worker) return;
    const pdfs = incoming.filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
    if (pdfs.length < incoming.length) say('Only PDF files can be added.', 'error');
    else say('');
    if (!pdfs.length) return;
    files = multiple ? [...files, ...pdfs] : [pdfs[0]];
    clearResult();
    render();
  }

  function askPassword(file: number, attempt: number): Promise<string | null> {
    passwordTitle.textContent = multiple ? `“${files[file].name}” is password-protected` : 'This PDF is password-protected';
    passwordHint.textContent =
      attempt > 1 ? `That password did not work. Try again (${attempt} of 3).` : 'Type its password. It stays on this device.';
    password.value = '';
    dialog.returnValue = '';
    dialog.showModal();
    return new Promise((resolve) => {
      dialog.onclose = () => {
        const value = dialog.returnValue === 'ok' ? password.value : null;
        password.value = '';
        resolve(value);
      };
    });
  }

  function stop() {
    worker?.terminate();
    worker = undefined;
    if (dialog.open) dialog.close();
    render();
  }

  function finish(message: FromWorker) {
    stop();
    if (message.type === 'error') {
      say(ERRORS[message.code], 'error');
      return;
    }
    if (message.type !== 'done') return;
    outputUrl = URL.createObjectURL(message.output);
    download.href = outputUrl;
    download.download = `${files[0].name.replace(/\.pdf$/i, '')}-${SUFFIX[op]}.pdf`;
    const pageLabel = message.pageCount === 1 ? 'page' : 'pages';
    say(`Done — ${message.pageCount} ${pageLabel}, ${formatSize(message.output.size)}. Created on this device.`);
    warnings.replaceChildren(
      ...message.warnings.map((code) => {
        const item = document.createElement('li');
        item.textContent = WARNINGS[code];
        return item;
      }),
    );
    result.hidden = false;
    download.focus();
  }

  function run() {
    if (worker) return;
    clearResult();
    const total = files.reduce((sum, f) => sum + f.size, 0);
    if (total > inputBudget()) {
      say(`These files total ${formatSize(total)}, more than this device can safely process (${formatSize(inputBudget())}).`, 'error');
      return;
    }
    const job: Job = { op, pages: pages?.value, angle: angle ? (Number(angle.value) as Job['angle']) : undefined };
    worker = new Worker(new URL('./engine/worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = async ({ data }: MessageEvent<FromWorker>) => {
      if (data.type !== 'password') return finish(data);
      const answer = await askPassword(data.file, data.attempt);
      worker?.postMessage({ type: 'password', password: answer } satisfies ToWorker);
    };
    worker.onerror = () => {
      stop();
      say(ERRORS.ENGINE_FAILED, 'error');
    };
    worker.postMessage({ type: 'run', job, files } satisfies ToWorker);
    say('Working… your files stay on this device.');
    render();
  }

  input.onchange = () => {
    addFiles([...(input.files ?? [])]);
    input.value = '';
  };
  drop.ondragover = (event) => {
    event.preventDefault();
    drop.classList.add('dragging');
  };
  drop.ondragleave = () => drop.classList.remove('dragging');
  drop.ondrop = (event) => {
    event.preventDefault();
    drop.classList.remove('dragging');
    addFiles([...(event.dataTransfer?.files ?? [])]);
  };
  pages?.addEventListener('input', clearResult);
  angle?.addEventListener('change', clearResult);
  runButton.onclick = run;
  cancelButton.onclick = () => {
    stop();
    say('Canceled. Nothing was changed.');
  };
  addEventListener('pagehide', stop);
  render();
}

setUpEffects();
const op = document.body.dataset.tool as Op | '';
if (op) setUp(op);
