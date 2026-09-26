import './style.css';
import '@fontsource-variable/inter';
import { setUpEffects } from './effects';
import type { ErrorCode, Job, Op, Warning } from './engine/pdf';
import type { LocalError, Output } from './engine/local';
import type { FromWorker, ToWorker } from './engine/worker';
import type { ToolOp } from './site';

/** A document for the browser's own PDF writer (print → Save as PDF): handles every script and font. */
interface Printable {
  html: string;
  title: string;
}
type Options = Record<string, string>;
type LocalJob = (files: File[], options: Options) => Promise<Output | Printable>;

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
  BAD_SIZE: 'The width and height must each be between 1 and 16,384 pixels.',
  NO_TEXT: 'This PDF has no text to extract — it is probably a scanned image. Run OCR PDF first, then try again.',
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
  const viewer = $('viewer');
  const optionsPanel = workspace.querySelector('.options')!;

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
  let printFrame: HTMLIFrameElement | undefined;
  let editor: { file: File; ready: Promise<{ save(): Promise<Output>; destroy(): void }> } | undefined;

  const progressLabel = (fraction: number) => say(`Working… ${Math.round(fraction * 100)}% — your files stay on this device.`);
  const baseName = (file: File) => file.name.replace(/\.[^.]+$/, '');
  const number = (value: string | undefined) => (value ? Number(value) : undefined);

  // Every tool that runs outside the qpdf worker. Engines load on first use.
  const LOCAL: Partial<Record<ToolOp, LocalJob>> = {
    'jpg-to-pdf': async (f) => (await import('./engine/local')).imagesToPdf(f),
    'pdf-to-jpg': async (f) => (await import('./engine/local')).pdfToImages(f[0]),
    'office-clean': async (f) => (await import('./engine/local')).cleanOffice(f[0]),
    'office-images': async (f) => (await import('./engine/local')).extractOfficeImages(f[0]),
    'compress-pdf': async (f, o) => (await import('./engine/compress')).compressPdf(f[0], { level: o.level === 'strong' ? 'strong' : 'light' }),
    'office-compress': async (f, o) => (await import('./engine/compress')).compressOffice(f[0], { level: o.level === 'strong' ? 'strong' : 'light' }),
    'image-convert': async (f, o) =>
      (await import('./engine/compress')).convertImages(f, {
        format: (o.format ?? 'original') as 'jpeg' | 'png' | 'webp' | 'original',
        quality: (number(o.quality) ?? 90) / 100,
        width: number(o.width),
        height: number(o.height),
        scale: number(o.scale),
        keepAspect: o.keepAspect !== 'false',
      }),
    'pdf-to-text': async (f, o) => (await import('./engine/convert')).pdfToText(f[0], { format: o.format === 'md' ? 'md' : 'txt' }),
    'text-to-pdf': async (f) => (await import('./engine/convert')).textToHtml(f[0]),
    'excel-to-csv': async (f) => (await import('./engine/convert')).xlsxToCsv(f[0]),
    'csv-to-excel': async (f) => (await import('./engine/convert')).csvToXlsx(f[0]),
    'word-to-pdf': async (f) => (await import('./engine/office')).docxToHtml(f[0]),
    'pdf-to-word': async (f) => (await import('./engine/office')).pdfToDocx(f[0]),
    'pdf-to-powerpoint': async (f) => (await import('./engine/office')).pdfToPptx(f[0]),
    'ocr-pdf': async (f) => (await import('./engine/ocr')).ocrPdf(f[0], progressLabel),
    'image-ocr': async (f) => {
      const [{ ocrImage }, { showTextOverlay }] = await Promise.all([import('./engine/ocr'), import('./tools/ocr-viewer')]);
      const recognized = await ocrImage(f[0], progressLabel);
      showTextOverlay(viewer!, f[0], recognized);
      const words = recognized.words.length;
      return {
        blob: new Blob([recognized.text], { type: 'text/plain;charset=utf-8' }),
        name: `${baseName(f[0])}.txt`,
        summary: `${words} ${words === 1 ? 'word' : 'words'} recognized`,
      };
    },
    'edit-pdf': async () => (await editor!.ready).save(),
  };

  /** The editor follows the chosen file: opening a new one replaces it, removing it closes it. */
  function syncEditor() {
    if (op !== 'edit-pdf' || editor?.file === files[0]) return;
    editor?.ready.then((e) => e.destroy(), () => {});
    viewer!.replaceChildren();
    editor = undefined;
    if (!files[0]) return;
    const file = files[0];
    const ready = import('./tools/edit-pdf').then((m) => m.openEditor(file, viewer!));
    editor = { file, ready };
    ready.catch((error) => {
      files = [];
      render();
      fail(error);
    });
  }

  function fail(error: unknown) {
    const code = (error as LocalError).code as Failure | undefined;
    if (!code) console.error(error); // unexpected: keep the details for bug reports
    say(code && code in ERRORS ? ERRORS[code] : ERRORS.PROCESSING_FAILED, 'error');
  }

  const options = (): Options =>
    Object.fromEntries(
      [...optionsPanel.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[name]')].map((field) => [
        field.name,
        field instanceof HTMLInputElement && field.type === 'checkbox' ? String(field.checked) : field.value,
      ]),
    );
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
    if (op === 'image-ocr') viewer?.replaceChildren();
    printFrame?.remove();
    printFrame = undefined;
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
    syncEditor();
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
    download.onclick = null;
    download.href = outputUrl;
    download.download = name;
    download.textContent = `Download ${name.split('.').pop()!.toUpperCase()}`;
    say(`Done — ${summary}, ${formatSize(blob.size)}. Created on this device.`);
    result.hidden = false;
    download.focus();
  }

  /** Hands a prepared document to the browser's print dialog, where "Save as PDF" writes the file. */
  function printDocument(doc: Printable) {
    printFrame?.remove();
    printFrame = document.createElement('iframe');
    printFrame.className = 'print-frame';
    printFrame.title = doc.title;
    printFrame.srcdoc = doc.html;
    const frame = printFrame;
    frame.onload = () => frame.contentWindow?.print();
    document.body.append(frame);
    download.removeAttribute('download');
    download.href = '#';
    download.textContent = 'Save as PDF';
    download.onclick = (event) => {
      event.preventDefault();
      frame.contentWindow?.print();
    };
    say('Ready — choose “Save as PDF” in the print window, then Save. Created on this device.');
    result.hidden = false;
  }

  async function runLocal(job: LocalJob) {
    say('Working… your files stay on this device.');
    localBusy = true;
    render();
    try {
      const output = await job(files, options());
      if ('html' in output) printDocument(output);
      else show(output.blob, output.name, output.summary);
    } catch (error) {
      fail(error);
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
    const local = LOCAL[op];
    if (local) return void runLocal(local);
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
  optionsPanel.addEventListener('input', (event) => {
    const field = event.target as HTMLInputElement;
    // Range sliders show their value next to the label.
    if (field.type === 'range') field.previousElementSibling!.textContent = `${field.value}%`;
    clearResult();
  });
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
