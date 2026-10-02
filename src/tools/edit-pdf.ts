// "Edit PDF": change text in place, add new text, white-out areas. Everything runs
// against the original file in memory. On save, changed lines are rewritten inside the page with
// the PDF's own font when it has every character (engine/pdf-text.ts); otherwise the old line is
// covered and the new one drawn in the closest standard font.
import './edit-pdf.css';
import { LocalError, type Output } from '../engine/local';
import { t } from '../i18n';

// ---------------------------------------------------------------------------
// Pure geometry / mapping helpers (unit-tested in tests/edit-pdf.test.ts).
// ---------------------------------------------------------------------------

/** 2D affine matrix [a, b, c, d, e, f], same convention as PDF/pdf.js/Canvas. */
export type Matrix = [number, number, number, number, number, number];

/** Composes two matrices the way pdf.js' Util.transform does: applies `m2` first, then `m1`. */
export function multiplyMatrix(m1: Matrix, m2: Matrix): Matrix {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

export function applyMatrix(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

export function invertMatrix(m: Matrix): Matrix {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (!det) return [1, 0, 0, 1, 0, 0]; // degenerate (zero scale); caller should not hit this
  const ia = d / det, ib = -b / det, ic = -c / det, id = a / det;
  return [ia, ib, ic, id, -(ia * e + ic * f), -(ib * e + id * f)];
}

/** The bits of a pdf.js TextItem we depend on (kept narrow so it's testable without pdf.js). */
export interface TextItemLike {
  str: string;
  transform: Matrix;
  width: number;
  height: number;
  fontName: string;
  hasEOL?: boolean;
}

export interface TextRun {
  text: string;
  /** Transform of the run's first glyph: (e, f) is the baseline start point in PDF space. */
  transform: Matrix;
  /** Baseline-to-baseline-end distance, in PDF units. */
  width: number;
  /** Approximate glyph box height, in PDF units. */
  height: number;
  fontName: string;
}

function runFontSize(t: Matrix): number {
  return Math.hypot(t[0], t[1]) || Math.hypot(t[2], t[3]) || 1;
}

/** Same line & size & direction as the item before it, and butted up against its end. */
function continuesLine(prev: TextItemLike, item: TextItemLike): boolean {
  const size = runFontSize(prev.transform);
  const [pa, pb, , , pe, pf] = prev.transform;
  // (pa, pb) has magnitude `size`, so divide it out to get a unit baseline direction.
  const endX = pe + (pa / size) * prev.width;
  const endY = pf + (pb / size) * prev.width;
  const dist = Math.hypot(item.transform[4] - endX, item.transform[5] - endY);
  const sameSize = Math.abs(runFontSize(item.transform) - size) < size * 0.35;
  return sameSize && dist < size * 0.9;
}

/** Groups adjacent same-line text items (as returned by pdf.js getTextContent) into editable runs. */
export function groupTextRuns(items: TextItemLike[]): TextRun[] {
  const runs: TextRun[] = [];
  let current: TextItemLike[] = [];
  const flush = () => {
    if (!current.length) return;
    const text = current.map((i) => i.str).join('');
    if (text.trim()) {
      const first = current[0];
      const last = current[current.length - 1];
      const lastSize = runFontSize(last.transform);
      const width = Math.hypot(
        last.transform[4] + (last.transform[0] / lastSize) * last.width - first.transform[4],
        last.transform[5] + (last.transform[1] / lastSize) * last.width - first.transform[5],
      );
      const height = Math.max(...current.map((i) => i.height || 0), runFontSize(first.transform) * 1.15);
      runs.push({ text, transform: first.transform, width, height, fontName: first.fontName });
    }
    current = [];
  };
  for (const item of items) {
    if (!item.str) {
      if (item.hasEOL) flush();
      continue;
    }
    if (current.length && !continuesLine(current[current.length - 1], item)) flush();
    current.push(item);
    if (item.hasEOL) flush();
  }
  flush();
  return runs;
}

export interface RunGeometry {
  /** Bottom-left corner of the run's bounding box in PDF space, before the `angleDeg` rotation. */
  x: number;
  y: number;
  width: number;
  height: number;
  angleDeg: number;
  fontSize: number;
}

/** The axis-aligned (pre-rotation) rectangle a run occupies, for white-out and box placement. */
export function runGeometry(run: Pick<TextRun, 'transform' | 'width' | 'height'>): RunGeometry {
  const [a, b, c, d, e, f] = run.transform;
  const fontSize = runFontSize(run.transform);
  const angleDeg = (Math.atan2(b, a) * 180) / Math.PI;
  const height = run.height || fontSize * 1.15;
  const descentFrac = 0.22; // typical descent share of a font's total bbox height
  const perp = Math.hypot(c, d) || 1;
  const nx = c / perp, ny = d / perp; // unit "up" direction of the glyph box
  return { x: e - nx * height * descentFrac, y: f - ny * height * descentFrac, width: run.width, height, angleDeg, fontSize };
}

export type StdFont =
  | 'Helvetica' | 'HelveticaBold' | 'HelveticaOblique' | 'HelveticaBoldOblique'
  | 'TimesRoman' | 'TimesRomanBold' | 'TimesRomanItalic' | 'TimesRomanBoldItalic'
  | 'Courier' | 'CourierBold' | 'CourierOblique' | 'CourierBoldOblique';

/** Best-effort standard-font lookalike from a (possibly mangled) embedded font name. */
export function mapStandardFont(fontName: string): StdFont {
  const name = fontName.toLowerCase();
  const bold = /bold|black|heavy|semibold/.test(name);
  const italic = /italic|oblique/.test(name);
  if (/courier|mono|consolas|typewriter/.test(name)) {
    return bold && italic ? 'CourierBoldOblique' : bold ? 'CourierBold' : italic ? 'CourierOblique' : 'Courier';
  }
  if (/times|serif|georgia|garamond|cambria|minion|palatino|book\s?antiqua/.test(name)) {
    return bold && italic ? 'TimesRomanBoldItalic' : bold ? 'TimesRomanBold' : italic ? 'TimesRomanItalic' : 'TimesRoman';
  }
  return bold && italic ? 'HelveticaBoldOblique' : bold ? 'HelveticaBold' : italic ? 'HelveticaOblique' : 'Helvetica';
}

/** CSS approximation of a StdFont, for the on-page contenteditable boxes. */
function cssFontFor(std: StdFont): { family: string; weight: number; style: string } {
  return {
    family: std.startsWith('Times') ? 'Georgia, "Times New Roman", serif' : std.startsWith('Courier') ? '"Courier New", monospace' : 'Arial, Helvetica, sans-serif',
    weight: std.includes('Bold') ? 700 : 400,
    style: std.includes('Oblique') || std.includes('Italic') ? 'italic' : 'normal',
  };
}

// WinAnsiEncoding has no glyphs for these byte values (cp1252 gaps).
const WINANSI_UNDEFINED = new Set([0x81, 0x8d, 0x8f, 0x90, 0x9d]);
// Common "smart" punctuation that has a plain WinAnsi-safe equivalent.
const WINANSI_FALLBACK: Record<number, string> = {
  0x2018: "'", 0x2019: "'", 0x201c: '"', 0x201d: '"',
  0x2013: '-', 0x2014: '-', 0x2026: '...', 0x00a0: ' ',
};

/** Replaces characters the standard PDF fonts (WinAnsi) can't render, so drawText never throws. */
export function sanitizeWinAnsi(text: string): { text: string; changed: boolean } {
  let changed = false;
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code === 0x0a || code === 0x0d) { out += ch; continue; }
    if (code < 0x20) { changed = true; continue; }
    if (code <= 0xff && !WINANSI_UNDEFINED.has(code)) { out += ch; continue; }
    const fallback = WINANSI_FALLBACK[code];
    out += fallback ?? '?';
    changed = true;
  }
  return { text: out, changed };
}

// ---------------------------------------------------------------------------
// Editor (browser-only; exercised by the Playwright harness, not vitest).
// ---------------------------------------------------------------------------

type Mode = 'edit-text' | 'add-text' | 'white-out';
type PdfJsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
type PdfDocumentProxy = Awaited<ReturnType<PdfJsModule['getDocument']>['promise']>;
type PdfPage = Awaited<ReturnType<PdfDocumentProxy['getPage']>>;
type PdfViewport = ReturnType<PdfPage['getViewport']>;

interface AddedText {
  id: number;
  x: number; // PDF space, top-left of the box
  y: number;
  size: number;
  font: StdFont;
  text: string;
}

interface Whiteout {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PageState {
  index: number; // 0-based
  page?: PdfPage;
  wrapper: HTMLDivElement;
  canvas: HTMLCanvasElement;
  overlay: HTMLDivElement;
  viewport?: PdfViewport;
  dpr: number;
  runs: TextRun[];
  textEdits: Map<number, string>;
  added: AddedText[];
  whiteouts: Whiteout[];
  rendered: boolean;
}

const ZOOM_STEPS = [0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 2.5, 3];

function screenRect(viewport: PdfViewport, x: number, y: number, w: number, h: number, dpr: number) {
  const corners = [[x, y], [x + w, y], [x, y + h], [x + w, y + h]].map(([px, py]) => viewport.convertToViewportPoint(px, py));
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  return { left: minX / dpr, top: minY / dpr, width: (maxX - minX) / dpr, height: (maxY - minY) / dpr };
}

export interface Editor {
  save(): Promise<Output>;
  destroy(): void;
}

export async function openEditor(file: File, viewer: HTMLElement): Promise<Editor> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default;
  const originalBytes = new Uint8Array(await file.arrayBuffer());

  let doc: PdfDocumentProxy;
  try {
    doc = await pdfjs.getDocument({ data: originalBytes.slice() }).promise;
  } catch (error) {
    throw new LocalError((error as { name?: string }).name === 'PasswordException' ? 'PDF_PASSWORD' : 'INVALID_PDF');
  }

  const baseName = file.name.replace(/\.pdf$/i, '');

  // ---- chrome ----
  viewer.classList.add('edit-pdf');
  viewer.replaceChildren();
  const toolbar = document.createElement('div');
  toolbar.className = 'edit-toolbar';
  const modeGroup = document.createElement('div');
  modeGroup.className = 'edit-mode-group';
  modeGroup.setAttribute('role', 'group');
  modeGroup.setAttribute('aria-label', t('ed.tools'));

  function makeButton(label: string, title: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'edit-btn';
    button.textContent = label;
    button.title = title;
    button.setAttribute('aria-label', title);
    return button;
  }

  const editBtn = makeButton(t('ed.editText'), t('ed.editText'));
  editBtn.classList.add('mode-btn');
  const addBtn = makeButton(t('ed.addText'), t('ed.addText'));
  addBtn.classList.add('mode-btn');
  const whiteBtn = makeButton(t('ed.whiteout'), t('ed.whiteout'));
  whiteBtn.classList.add('mode-btn');
  modeGroup.append(editBtn, addBtn, whiteBtn);

  const undoBtn = makeButton(t('ed.undo'), t('ed.undoLabel'));
  undoBtn.classList.add('edit-btn-icon');

  const zoomGroup = document.createElement('div');
  zoomGroup.className = 'edit-zoom-group';
  const zoomOutBtn = makeButton('−', t('ed.zoomOut'));
  zoomOutBtn.classList.add('edit-btn-icon');
  const zoomLabel = document.createElement('span');
  zoomLabel.className = 'edit-zoom-label';
  const zoomInBtn = makeButton('+', t('ed.zoomIn'));
  zoomInBtn.classList.add('edit-btn-icon');
  zoomGroup.append(zoomOutBtn, zoomLabel, zoomInBtn);

  const pageLabel = document.createElement('span');
  pageLabel.className = 'edit-page-label';

  const notice = document.createElement('span');
  notice.className = 'edit-notice';
  notice.hidden = true;
  notice.textContent = t('ed.replaced');

  toolbar.append(modeGroup, undoBtn, zoomGroup, pageLabel, notice);

  const scroller = document.createElement('div');
  scroller.className = 'edit-scroll';
  const hint = document.createElement('p');
  hint.className = 'edit-hint';
  hint.textContent = t('ed.hint');
  viewer.append(toolbar, scroller, hint);

  // ---- state ----
  let mode: Mode = 'edit-text';
  let zoomIndex = ZOOM_STEPS.indexOf(1);
  let editingKey: { page: number; idx: number } | null = null;
  let noticeShown = false;
  let nextId = 1;
  const undoStack: (() => void)[] = [];

  function showNotice() {
    if (noticeShown) return;
    noticeShown = true;
    notice.hidden = false;
  }

  function pushUndo(undo: () => void) {
    undoStack.push(undo);
    undoBtn.disabled = false;
  }

  function setMode(next: Mode) {
    mode = next;
    for (const [btn, m] of [[editBtn, 'edit-text'], [addBtn, 'add-text'], [whiteBtn, 'white-out']] as const) {
      btn.setAttribute('aria-pressed', String(m === mode));
    }
    scroller.dataset.mode = mode;
    editingKey = null;
    pageStates.filter((s) => s.rendered).forEach(rebuildOverlay);
  }

  const pageStates: PageState[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const wrapper = document.createElement('div');
    wrapper.className = 'edit-page';
    wrapper.dataset.index = String(n - 1);
    const canvas = document.createElement('canvas');
    const overlay = document.createElement('div');
    overlay.className = 'edit-overlay';
    wrapper.append(canvas, overlay);
    scroller.append(wrapper);
    pageStates.push({ index: n - 1, wrapper, canvas, overlay, dpr: 1, runs: [], textEdits: new Map(), added: [], whiteouts: [], rendered: false });
  }

  // Start at the largest zoom where the first page fits the width, so a phone shows the whole page.
  if (pageStates.length) {
    const width = (await ensurePage(pageStates[0])).getViewport({ scale: 1 }).width;
    const room = scroller.clientWidth - 40;
    while (room > 0 && zoomIndex > 0 && width * ZOOM_STEPS[zoomIndex] > room) zoomIndex--;
  }

  function updatePageLabel() {
    const mid = scroller.scrollTop + scroller.clientHeight / 2;
    let current = 0;
    for (const state of pageStates) {
      if (state.wrapper.offsetTop <= mid) current = state.index;
    }
    pageLabel.textContent = t('ed.page', { n: current + 1, total: doc.numPages });
  }
  scroller.addEventListener('scroll', updatePageLabel, { passive: true });

  async function ensurePage(state: PageState) {
    if (!state.page) state.page = await doc.getPage(state.index + 1);
    return state.page;
  }

  async function renderPage(state: PageState) {
    const page = await ensurePage(state);
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const scale = ZOOM_STEPS[zoomIndex] * dpr;
    const viewport = page.getViewport({ scale });
    state.viewport = viewport;
    state.dpr = dpr;
    state.canvas.width = Math.ceil(viewport.width);
    state.canvas.height = Math.ceil(viewport.height);
    const cssWidth = viewport.width / dpr;
    const cssHeight = viewport.height / dpr;
    state.canvas.style.width = state.wrapper.style.width = state.overlay.style.width = `${cssWidth}px`;
    state.canvas.style.height = state.wrapper.style.height = state.overlay.style.height = `${cssHeight}px`;
    const context = state.canvas.getContext('2d')!;
    await page.render({ canvas: state.canvas, canvasContext: context, viewport }).promise;
    if (!state.rendered) {
      const content = await page.getTextContent();
      const items = (content.items as unknown as TextItemLike[]).filter((item) => typeof item.str === 'string');
      state.runs = groupTextRuns(items);
    }
    state.rendered = true;
    rebuildOverlay(state);
    updatePageLabel();
  }

  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) if (entry.isIntersecting) void renderPage(pageStates[Number((entry.target as HTMLElement).dataset.index)]);
    },
    { root: scroller, rootMargin: '600px 0px' },
  );
  pageStates.forEach((s) => io.observe(s.wrapper));

  function rerenderAll() {
    zoomLabel.textContent = `${Math.round(ZOOM_STEPS[zoomIndex] * 100)}%`;
    for (const state of pageStates) if (state.rendered) void renderPage(state);
  }

  // ---- overlay building ----
  function rebuildOverlay(state: PageState) {
    if (!state.viewport) return;
    state.overlay.replaceChildren();
    state.runs.forEach((run, idx) => {
      const isEditing = editingKey?.page === state.index && editingKey.idx === idx;
      const edited = state.textEdits.get(idx);
      if (mode === 'edit-text' && edited === undefined && !isEditing) {
        appendHitbox(state, idx, run);
      } else if (edited !== undefined || isEditing) {
        appendTextRunBox(state, idx, run, edited ?? run.text, isEditing);
      }
    });
    for (const added of state.added) appendAddedBox(state, added);
    for (const wo of state.whiteouts) appendWhiteoutBox(state, wo);
  }

  function appendHitbox(state: PageState, idx: number, run: TextRun) {
    const geo = runGeometry(run);
    const box = screenRect(state.viewport!, geo.x, geo.y, geo.width, geo.height, state.dpr);
    const hit = document.createElement('div');
    hit.className = 'edit-hitbox';
    hit.style.left = `${box.left}px`;
    hit.style.top = `${box.top}px`;
    hit.style.width = `${box.width}px`;
    hit.style.height = `${box.height}px`;
    hit.tabIndex = 0;
    hit.setAttribute('role', 'button');
    hit.setAttribute('aria-label', t('ed.editRun', { text: run.text }));
    const activate = () => {
      editingKey = { page: state.index, idx };
      rebuildOverlay(state);
    };
    hit.addEventListener('click', activate);
    hit.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        activate();
      }
    });
    state.overlay.append(hit);
  }

  function appendTextRunBox(state: PageState, idx: number, run: TextRun, text: string, editing: boolean) {
    const geo = runGeometry(run);
    const box = screenRect(state.viewport!, geo.x, geo.y, geo.width, geo.height, state.dpr);
    const font = cssFontFor(mapStandardFont(run.fontName));
    const div = document.createElement('div');
    div.className = 'edit-run-box';
    div.style.left = `${box.left}px`;
    div.style.top = `${box.top}px`;
    div.style.minWidth = `${box.width}px`;
    div.style.minHeight = `${box.height}px`;
    div.style.fontSize = `${geo.fontSize * (ZOOM_STEPS[zoomIndex])}px`;
    div.style.lineHeight = `${box.height}px`;
    div.style.fontFamily = font.family;
    div.style.fontWeight = String(font.weight);
    div.style.fontStyle = font.style;
    div.textContent = text;
    if (editing) {
      div.contentEditable = 'true';
      div.classList.add('editing');
      let canceled = false;
      div.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          div.blur();
        } else if (event.key === 'Escape') {
          canceled = true;
          div.blur();
        }
      });
      // Pressing Undo mid-edit blurs (commits) first, then undoes that commit.
      div.addEventListener('input', () => { undoBtn.disabled = false; });
      div.addEventListener('blur', () => {
        editingKey = null;
        if (!canceled) {
          const newText = div.textContent ?? '';
          const previous = state.textEdits.get(idx);
          if (newText !== run.text) {
            state.textEdits.set(idx, newText);
            checkNotice(newText);
          } else {
            state.textEdits.delete(idx);
          }
          if (newText !== (previous ?? run.text)) {
            pushUndo(() => {
              if (previous === undefined) state.textEdits.delete(idx);
              else state.textEdits.set(idx, previous);
              rebuildOverlay(state);
            });
          }
        }
        undoBtn.disabled = undoStack.length === 0;
        rebuildOverlay(state);
      });
      state.overlay.append(div);
      div.focus();
      const range = document.createRange();
      range.selectNodeContents(div);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    } else {
      div.tabIndex = mode === 'edit-text' ? 0 : -1;
      if (mode === 'edit-text') {
        div.setAttribute('role', 'button');
        div.setAttribute('aria-label', t('ed.editRun', { text }));
        const activate = () => {
          editingKey = { page: state.index, idx };
          rebuildOverlay(state);
        };
        div.addEventListener('click', activate);
        div.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            activate();
          }
        });
      }
      state.overlay.append(div);
    }
  }

  function checkNotice(text: string) {
    if (sanitizeWinAnsi(text).changed) showNotice();
  }

  function appendAddedBox(state: PageState, added: AddedText) {
    const [screenX, screenY] = state.viewport!.convertToViewportPoint(added.x, added.y);
    const wrap = document.createElement('div');
    wrap.className = 'edit-added-box';
    wrap.style.left = `${screenX / state.dpr}px`;
    wrap.style.top = `${screenY / state.dpr}px`;
    const font = cssFontFor(added.font);
    const div = document.createElement('div');
    div.className = 'edit-added-text';
    div.contentEditable = 'true';
    div.textContent = added.text;
    div.style.fontSize = `${added.size * ZOOM_STEPS[zoomIndex]}px`;
    div.style.fontFamily = font.family;
    div.style.fontWeight = String(font.weight);
    div.style.fontStyle = font.style;
    div.addEventListener('pointerdown', (event) => event.stopPropagation());
    div.addEventListener('input', () => {
      added.text = div.textContent ?? '';
    });
    div.addEventListener('blur', () => {
      added.text = div.textContent ?? '';
      checkNotice(added.text);
      if (!added.text.trim()) removeAdded(state, added, false);
    });
    div.addEventListener('keydown', (event) => {
      if ((event.key === 'Backspace' || event.key === 'Delete') && !div.textContent) {
        event.preventDefault();
        removeAdded(state, added, true);
      }
    });

    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = 'edit-box-handle';
    handle.setAttribute('aria-label', t('ed.move'));
    handle.textContent = '⠿';
    let dragging: { startX: number; startY: number; origin: [number, number] } | null = null;
    handle.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      handle.setPointerCapture(event.pointerId);
      dragging = { startX: event.clientX, startY: event.clientY, origin: [added.x, added.y] };
    });
    handle.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      const inv = invertMatrix(state.viewport!.transform as unknown as Matrix);
      const dxCanvas = (event.clientX - dragging.startX) * state.dpr;
      const dyCanvas = (event.clientY - dragging.startY) * state.dpr;
      const [ox, oy] = applyMatrix(inv, dxCanvas, dyCanvas);
      const [zx, zy] = applyMatrix(inv, 0, 0);
      added.x = dragging.origin[0] + (ox - zx);
      added.y = dragging.origin[1] + (oy - zy);
      rebuildOverlay(state);
    });
    handle.addEventListener('pointerup', () => { dragging = null; });

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'edit-box-close';
    close.setAttribute('aria-label', t('ed.removeBox'));
    close.textContent = '×';
    close.addEventListener('pointerdown', (event) => event.stopPropagation());
    close.addEventListener('click', () => removeAdded(state, added, true));

    wrap.append(handle, div, close);
    state.overlay.append(wrap);
  }

  function removeAdded(state: PageState, added: AddedText, recordUndo: boolean) {
    const index = state.added.indexOf(added);
    if (index === -1) return;
    state.added.splice(index, 1);
    if (recordUndo) pushUndo(() => { state.added.splice(index, 0, added); rebuildOverlay(state); });
    rebuildOverlay(state);
  }

  function appendWhiteoutBox(state: PageState, wo: Whiteout) {
    const box = screenRect(state.viewport!, wo.x, wo.y, wo.width, wo.height, state.dpr);
    const div = document.createElement('div');
    div.className = 'edit-whiteout';
    div.style.left = `${box.left}px`;
    div.style.top = `${box.top}px`;
    div.style.width = `${box.width}px`;
    div.style.height = `${box.height}px`;
    state.overlay.append(div);
  }

  function toPdfPoint(state: PageState, clientX: number, clientY: number): [number, number] {
    const rect = state.overlay.getBoundingClientRect();
    const cx = (clientX - rect.left) * state.dpr;
    const cy = (clientY - rect.top) * state.dpr;
    return state.viewport!.convertToPdfPoint(cx, cy) as [number, number];
  }

  function wireBackground(state: PageState) {
    state.overlay.addEventListener('pointerdown', (event) => {
      if (event.target !== state.overlay) return;
      if (mode === 'add-text') {
        const [px, py] = toPdfPoint(state, event.clientX, event.clientY);
        const added: AddedText = { id: nextId++, x: px, y: py, size: 12, font: 'Helvetica', text: '' };
        state.added.push(added);
        pushUndo(() => removeAdded(state, added, false));
        rebuildOverlay(state);
        requestAnimationFrame(() => {
          const box = state.overlay.querySelector<HTMLDivElement>('.edit-added-text:last-of-type');
          box?.focus();
        });
      } else if (mode === 'white-out') {
        startWhiteoutDrag(state, event);
      }
    });
  }
  pageStates.forEach(wireBackground);

  function startWhiteoutDrag(state: PageState, downEvent: PointerEvent) {
    const rect = state.overlay.getBoundingClientRect();
    const startX = downEvent.clientX - rect.left;
    const startY = downEvent.clientY - rect.top;
    const ghost = document.createElement('div');
    ghost.className = 'edit-whiteout-ghost';
    state.overlay.append(ghost);
    state.overlay.setPointerCapture(downEvent.pointerId);

    function move(event: PointerEvent) {
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const left = Math.min(startX, x), top = Math.min(startY, y);
      ghost.style.left = `${left}px`;
      ghost.style.top = `${top}px`;
      ghost.style.width = `${Math.abs(x - startX)}px`;
      ghost.style.height = `${Math.abs(y - startY)}px`;
    }
    function up(event: PointerEvent) {
      state.overlay.removeEventListener('pointermove', move);
      state.overlay.removeEventListener('pointerup', up);
      ghost.remove();
      const [x1, y1] = toPdfPoint(state, downEvent.clientX, downEvent.clientY);
      const [x2, y2] = toPdfPoint(state, event.clientX, event.clientY);
      const x = Math.min(x1, x2), y = Math.min(y1, y2);
      const width = Math.abs(x2 - x1), height = Math.abs(y2 - y1);
      if (width > 2 && height > 2) {
        const wo: Whiteout = { id: nextId++, x, y, width, height };
        state.whiteouts.push(wo);
        pushUndo(() => {
          const i = state.whiteouts.indexOf(wo);
          if (i !== -1) state.whiteouts.splice(i, 1);
          rebuildOverlay(state);
        });
        rebuildOverlay(state);
      }
    }
    state.overlay.addEventListener('pointermove', move);
    state.overlay.addEventListener('pointerup', up);
  }

  // ---- toolbar wiring ----
  editBtn.addEventListener('click', () => setMode('edit-text'));
  addBtn.addEventListener('click', () => setMode('add-text'));
  whiteBtn.addEventListener('click', () => setMode('white-out'));
  undoBtn.disabled = true;
  undoBtn.addEventListener('click', () => {
    const undo = undoStack.pop();
    undo?.();
    undoBtn.disabled = undoStack.length === 0;
  });
  zoomOutBtn.addEventListener('click', () => {
    zoomIndex = Math.max(0, zoomIndex - 1);
    rerenderAll();
  });
  zoomInBtn.addEventListener('click', () => {
    zoomIndex = Math.min(ZOOM_STEPS.length - 1, zoomIndex + 1);
    rerenderAll();
  });
  setMode('edit-text');
  zoomLabel.textContent = `${Math.round(ZOOM_STEPS[zoomIndex] * 100)}%`;
  pageLabel.textContent = t('ed.page', { n: 1, total: doc.numPages });

  // ---- save ----
  async function save(): Promise<Output> {
    const [{ PDFDocument, StandardFonts, rgb, degrees }, { editTextInPlace }] = await Promise.all([import('pdf-lib'), import('../engine/pdf-text')]);
    const pdfDoc = await PDFDocument.load(originalBytes);
    const pages = pdfDoc.getPages();
    const fontCache = new Map<StdFont, Awaited<ReturnType<typeof pdfDoc.embedFont>>>();
    const getFont = async (std: StdFont) => {
      let font = fontCache.get(std);
      if (!font) {
        font = await pdfDoc.embedFont(StandardFonts[std]);
        fontCache.set(std, font);
      }
      return font;
    };

    let edits = 0;
    let unsupported = false;
    for (const state of pageStates) {
      const page = pages[state.index];
      if (!page) continue;
      const changes = [...state.textEdits];
      const inPlace = changes.length
        ? editTextInPlace(
            pdfDoc,
            state.index,
            changes.map(([idx, text]) => {
              const run = state.runs[idx];
              const [a, b, c, d, e, f] = run.transform;
              const scale = Math.hypot(a, b) || 1;
              return { x: e, y: f, dir: [a / scale, b / scale] as [number, number], size: Math.hypot(c, d), width: run.width, text: run.text, newText: text };
            }),
          )
        : [];
      for (const [n, [idx, text]] of changes.entries()) {
        if (inPlace[n]) {
          edits++;
          continue;
        }
        const run = state.runs[idx];
        const geo = runGeometry(run);
        const pad = geo.fontSize * 0.12;
        page.drawRectangle({
          x: geo.x - pad, y: geo.y - pad, width: geo.width + pad * 2, height: geo.height + pad * 2,
          rotate: degrees(geo.angleDeg), color: rgb(1, 1, 1),
        });
        const { text: clean, changed } = sanitizeWinAnsi(text);
        if (changed) unsupported = true;
        if (clean) {
          const font = await getFont(mapStandardFont(run.fontName));
          page.drawText(clean, { x: run.transform[4], y: run.transform[5], size: geo.fontSize, font, color: rgb(0, 0, 0), rotate: degrees(geo.angleDeg) });
        }
        edits++;
      }
      for (const wo of state.whiteouts) {
        page.drawRectangle({ x: wo.x, y: wo.y, width: wo.width, height: wo.height, color: rgb(1, 1, 1) });
        edits++;
      }
      for (const added of state.added) {
        if (!added.text.trim()) continue;
        const font = await getFont(added.font);
        const lineHeight = added.size * 1.25;
        added.text.split('\n').forEach((line, i) => {
          const { text: clean, changed } = sanitizeWinAnsi(line);
          if (changed) unsupported = true;
          if (clean) page.drawText(clean, { x: added.x, y: added.y - added.size - i * lineHeight, size: added.size, font, color: rgb(0, 0, 0) });
        });
        edits++;
      }
    }
    if (unsupported) showNotice();
    const saved = await pdfDoc.save();
    return {
      blob: new Blob([saved as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }),
      name: `${baseName}-edited.pdf`,
      summary: `${edits} ${edits === 1 ? 'edit' : 'edits'}`,
    };
  }

  function destroy() {
    io.disconnect();
    scroller.removeEventListener('scroll', updatePageLabel);
    void doc.loadingTask.destroy();
    viewer.replaceChildren();
  }

  return { save, destroy };
}
