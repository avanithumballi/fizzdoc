import './style.css';
import '@fontsource-variable/inter';
import { setUpEffects } from './effects';
import type { ErrorCode, Job, Op, Warning } from './engine/pdf';
import type { LocalError, Output } from './engine/local';
import type { FromWorker, ToWorker } from './engine/worker';
import type { ToolOp } from './site';

/** Tools that run in engine/local.ts; the rest run on qpdf in the worker. */
const LOCAL_OPS: readonly string[] = ['jpg-to-pdf', 'pdf-to-jpg', 'office-clean', 'office-images'];

type Failure = ErrorCode | LocalError['code'] | 'ENGINE_FAILED' | 'PASSWORDS_DIFFER';

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
  NO_PASSWORD: 'Type the password you want to add.',
  PASSWORDS_DIFFER: 'The two passwords do not match.',
  NOT_OFFICE: 'This file is not a valid Word, Excel or PowerPoint document.',
  NO_IMAGES: 'This document has no embedded images.',
  BAD_IMAGE: 'One of the images could not be read. Try JPG or PNG.',
  PDF_PASSWORD: 'This PDF is password-protected. Remove the password with Unlock PDF first.',
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
  protect: 'protected',
  clean: 'clean',
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

function setUp(op: ToolOp) {
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
  // Only PDF pages have the password dialog; Office tools never ask for one.
  const dialog = $<HTMLDialogElement>('password-dialog')!;
  const password = $<HTMLInputElement>('password')!;
  const passwordTitle = $('password-title')!;
  const passwordHint = $('password-hint')!;
  const newPassword = $<HTMLInputElement>('new-password');
  const confirmPassword = $<HTMLInputElement>('confirm-password');
  const workspace = $('workspace')!;

  const multiple = workspace.dataset.multiple === 'true';
  // Mirrors the input's accept list (".pdf", "image/*", …) for dropped files.
  const acceptList = input.accept.split(',');
  const accepted = (file: File) =>
    acceptList.some((rule) =>
      rule.startsWith('.') ? file.name.toLowerCase().endsWith(rule) : rule.endsWith('/*') ? file.type.startsWith(rule.slice(0, -1)) : file.type === rule,
    );
  let files: File[] = [];
  let worker: Worker | undefined;
  let localBusy = false;
  const busy = () => !!worker || localBusy;
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
        if (multiple && !busy()) enableReorder(item, index);
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
          button.disabled = busy();
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
    runButton.disabled = busy() || files.length < (op === 'merge' ? 2 : 1);
    cancelButton.hidden = !worker;
    progress.hidden = !busy();
    if (reorderHint) reorderHint.hidden = files.length < 2 || busy();
    input.disabled = busy();
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
    if (busy()) return;
    const usable = incoming.filter(accepted);
    if (usable.length < incoming.length) say(`Only ${workspace.dataset.kind} files can be added.`, 'error');
    else say('');
    if (!usable.length) return;
    files = multiple ? [...files, ...usable] : [usable[0]];
    clearResult();
    render();
  }

  function askPassword(file: number, attempt: number): Promise<string | null> {
    passwordTitle.textContent = files.length > 1 ? `“${files[file].name}” is password-protected` : 'This PDF is password-protected';
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
    if (dialog?.open) dialog.close();
    render();
  }

  function finish(message: FromWorker) {
    stop();
    if (message.type === 'error') {
      say(ERRORS[message.code], 'error');
      return;
    }
    if (message.type !== 'done') return;
    const pageLabel = message.pageCount === 1 ? 'page' : 'pages';
    show(message.output, `${files[0].name.replace(/\.pdf$/i, '')}-${SUFFIX[op as Op]}.pdf`, `${message.pageCount} ${pageLabel}`);
    warnings.replaceChildren(
      ...message.warnings.map((code) => {
        const item = document.createElement('li');
        item.textContent = WARNINGS[code];
        return item;
      }),
    );
  }

  function show(blob: Blob, name: string, summary: string) {
    if (outputUrl) URL.revokeObjectURL(outputUrl);
    outputUrl = URL.createObjectURL(blob);
    download.href = outputUrl;
    download.download = name;
    download.textContent = `Download ${name.split('.').pop()!.toUpperCase()}`;
    say(`Done — ${summary}, ${formatSize(blob.size)}. Created on this device.`);
    result.hidden = false;
    download.focus();
  }

  async function runLocal() {
    say('Working… your files stay on this device.');
    localBusy = true;
    render();
    try {
      const local = await import('./engine/local');
      const output: Output =
        op === 'jpg-to-pdf'
          ? await local.imagesToPdf(files)
          : op === 'pdf-to-jpg'
            ? await local.pdfToImages(files[0])
            : op === 'office-clean'
              ? await local.cleanOffice(files[0])
              : await local.extractOfficeImages(files[0]);
      show(output.blob, output.name, output.summary);
    } catch (error) {
      const code = (error as LocalError).code;
      if (!code) console.error(error); // unexpected: keep the details for bug reports
      say(code && code in ERRORS ? ERRORS[code] : ERRORS.PROCESSING_FAILED, 'error');
    } finally {
      localBusy = false;
      render();
    }
  }

  function run() {
    if (busy()) return;
    clearResult();
    const total = files.reduce((sum, f) => sum + f.size, 0);
    if (total > inputBudget()) {
      say(`These files total ${formatSize(total)}, more than this device can safely process (${formatSize(inputBudget())}).`, 'error');
      return;
    }
    if (LOCAL_OPS.includes(op)) return void runLocal();
    if (newPassword && newPassword.value !== confirmPassword?.value) return say(ERRORS.PASSWORDS_DIFFER, 'error');
    const job: Job = {
      op: op as Op,
      pages: pages?.value,
      angle: angle ? (Number(angle.value) as Job['angle']) : undefined,
      password: newPassword?.value,
    };
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
  newPassword?.addEventListener('input', clearResult);
  runButton.onclick = run;
  cancelButton.onclick = () => {
    stop();
    say('Canceled. Nothing was changed.');
  };
  addEventListener('pagehide', stop);
  render();
}

setUpEffects();
const op = document.body.dataset.tool as ToolOp | '';
if (op) setUp(op);
