// Redact PDF: mark areas by dragging on a page or by searching its text. Saving redraws every page
// as an image with the marks burned in (engine/raster.ts), so what was covered is gone from the file.
import './redact-pdf.css';
import type { Output } from '../engine/local';
import { openPdf, rasterize, type Box, type RasterOptions } from '../engine/raster';
import { t } from '../i18n';
import { groupTextRuns, type TextItemLike } from './edit-pdf';

/** Width of `text` in a font like the PDF's, for placing a match inside a line; falls back to character count. */
function measurer(): (text: string, fontName: string) => number {
  const context = typeof OffscreenCanvas === 'undefined' ? null : new OffscreenCanvas(1, 1).getContext('2d');
  if (!context) return (text) => text.length;
  return (text, fontName) => {
    const name = fontName.toLowerCase();
    const family = /courier|mono/.test(name) ? 'monospace' : /times|serif|georgia|garamond|cambria/.test(name) ? 'serif' : 'sans-serif';
    context.font = `${/bold|black|heavy/.test(name) ? 'bold ' : ''}100px ${family}`;
    return context.measureText(text).width;
  };
}

/**
 * Boxes covering every case-insensitive match of `query`. A match inside a line is placed by its
 * measured share of the line, then padded generously, so a mark errs on the side of covering more.
 */
export function findMatches(items: TextItemLike[], query: string, measure = measurer()): Box[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const boxes: Box[] = [];
  for (const run of groupTextRuns(items)) {
    const text = run.text.toLowerCase();
    const [a, b, c, d, e, f] = run.transform;
    const size = Math.hypot(a, b) || 1;
    const [ux, uy] = [a / size, b / size]; // along the baseline
    const up = Math.hypot(c, d) || 1;
    const [vx, vy] = [c / up, d / up]; // up the glyphs
    const height = Math.max(run.height, size);
    const full = measure(run.text, run.fontName) || 1;
    const at = (index: number) => (run.width * measure(run.text.slice(0, index), run.fontName)) / full;
    for (let found = text.indexOf(needle); found >= 0; found = text.indexOf(needle, found + needle.length)) {
      const start = at(found) - size * 0.35;
      const end = at(found + needle.length) + size * 0.35;
      const corners = [
        [start, -height * 0.3],
        [end, -height * 0.3],
        [start, height * 1.05],
        [end, height * 1.05],
      ].map(([along, across]) => [e + ux * along + vx * across, f + uy * along + vy * across]);
      const xs = corners.map((p) => p[0]);
      const ys = corners.map((p) => p[1]);
      boxes.push({ x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) });
    }
  }
  return boxes;
}

type Viewport = { width: number; convertToViewportPoint(x: number, y: number): number[]; convertToPdfPoint(x: number, y: number): number[] };

/** Axis-aligned CSS-pixel rectangle of a PDF-space box. */
function screenBox(viewport: Viewport, box: Box, dpr: number) {
  const [ax, ay] = viewport.convertToViewportPoint(box.x0, box.y0);
  const [bx, by] = viewport.convertToViewportPoint(box.x1, box.y1);
  return { left: Math.min(ax, bx) / dpr, top: Math.min(ay, by) / dpr, width: Math.abs(bx - ax) / dpr, height: Math.abs(by - ay) / dpr };
}

const place = (element: HTMLElement, rect: ReturnType<typeof screenBox>) =>
  Object.assign(element.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });

export interface Redactor {
  save(options: RasterOptions, onProgress?: (fraction: number) => void): Promise<Output>;
  destroy(): void;
}

export async function openRedactor(file: File, viewer: HTMLElement): Promise<Redactor> {
  const doc = await openPdf(file);

  const button = (label: string, className = 'redact-btn') => {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = className;
    element.textContent = label;
    return element;
  };
  const search = document.createElement('input');
  search.type = 'search';
  search.placeholder = t('rd.find');
  search.setAttribute('aria-label', t('rd.find'));
  const markAll = button(t('rd.markAll'));
  markAll.type = 'submit';
  const find = document.createElement('form');
  find.className = 'redact-find';
  find.append(search, markAll);
  const undo = button(t('ed.undo'));
  const clear = button(t('rd.clear'));
  const count = document.createElement('span');
  count.className = 'redact-count';
  count.setAttribute('aria-live', 'polite');
  const toolbar = document.createElement('div');
  toolbar.className = 'redact-toolbar';
  toolbar.append(find, undo, clear, count);
  const hint = document.createElement('p');
  hint.className = 'redact-hint';
  hint.textContent = t('rd.hint');
  const scroller = document.createElement('div');
  scroller.className = 'redact-scroll';
  viewer.classList.add('redact-pdf');
  viewer.replaceChildren(toolbar, hint, scroller);

  interface PageView {
    wrapper: HTMLDivElement;
    canvas: HTMLCanvasElement;
    overlay: HTMLDivElement;
    viewport?: Viewport;
    dpr: number;
    items?: TextItemLike[];
  }
  const views: PageView[] = [];
  let marks: Box[][] = Array.from({ length: doc.numPages }, () => []);
  const history: Box[][][] = [];
  const change = (next: Box[][]) => {
    history.push(marks);
    marks = next;
    refresh();
  };

  function refresh() {
    const total = marks.reduce((sum, page) => sum + page.length, 0);
    count.textContent = t('rd.count', { n: total });
    undo.disabled = !history.length;
    clear.disabled = !total;
    views.forEach(drawMarks);
  }

  function drawMarks(view: PageView, index: number) {
    const viewport = view.viewport;
    if (!viewport) return;
    view.overlay.replaceChildren(
      ...marks[index].map((box) => {
        const mark = document.createElement('div');
        mark.className = 'redact-box';
        place(mark, screenBox(viewport, box, view.dpr));
        const remove = button('×', 'redact-remove');
        remove.setAttribute('aria-label', t('rd.remove'));
        remove.addEventListener('pointerdown', (event) => event.stopPropagation());
        remove.onclick = () => change(marks.map((page, i) => (i === index ? page.filter((other) => other !== box) : page)));
        mark.append(remove);
        return mark;
      }),
    );
  }

  const fitWidth = (pageWidth: number) => Math.min(Math.max(scroller.clientWidth - 32, 240), pageWidth * 1.5);

  async function render(index: number) {
    const view = views[index];
    const page = await doc.getPage(index + 1);
    const natural = page.getViewport({ scale: 1 });
    view.dpr = Math.min(devicePixelRatio || 1, 2);
    const viewport = page.getViewport({ scale: (fitWidth(natural.width) / natural.width) * view.dpr });
    view.viewport = viewport;
    view.canvas.width = Math.ceil(viewport.width);
    view.canvas.height = Math.ceil(viewport.height);
    for (const element of [view.wrapper, view.canvas, view.overlay]) {
      element.style.width = `${viewport.width / view.dpr}px`;
      element.style.height = `${viewport.height / view.dpr}px`;
    }
    await page.render({ canvas: view.canvas, canvasContext: view.canvas.getContext('2d')!, viewport }).promise;
    drawMarks(view, index);
  }

  // Drag on a page to draw a mark (mouse, pen or finger).
  function enableDrawing(view: PageView, index: number) {
    view.overlay.addEventListener('pointerdown', (event) => {
      const viewport = view.viewport;
      if (!viewport || event.button !== 0) return;
      event.preventDefault();
      view.overlay.setPointerCapture(event.pointerId);
      const bounds = view.overlay.getBoundingClientRect();
      const toPdf = (x: number, y: number) => viewport.convertToPdfPoint((x - bounds.left) * view.dpr, (y - bounds.top) * view.dpr);
      const [sx, sy] = toPdf(event.clientX, event.clientY);
      const draft = document.createElement('div');
      draft.className = 'redact-box draft';
      view.overlay.append(draft);
      let box: Box | undefined;
      const move = (next: PointerEvent) => {
        const [ex, ey] = toPdf(next.clientX, next.clientY);
        box = { x0: Math.min(sx, ex), y0: Math.min(sy, ey), x1: Math.max(sx, ex), y1: Math.max(sy, ey) };
        place(draft, screenBox(viewport, box, view.dpr));
      };
      const up = () => {
        view.overlay.removeEventListener('pointermove', move);
        draft.remove();
        const rect = box && screenBox(viewport, box, view.dpr);
        if (box && rect && rect.width > 4 && rect.height > 4) change(marks.map((page, i) => (i === index ? [...page, box!] : page)));
      };
      view.overlay.addEventListener('pointermove', move);
      view.overlay.addEventListener('pointerup', up, { once: true });
      view.overlay.addEventListener('pointercancel', up, { once: true });
    });
  }

  const first = (await doc.getPage(1)).getViewport({ scale: 1 });
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.unobserve(entry.target);
        void render(Number((entry.target as HTMLElement).dataset.index));
      }
    },
    { root: scroller, rootMargin: '800px 0px' },
  );
  for (let index = 0; index < doc.numPages; index++) {
    const wrapper = document.createElement('div');
    wrapper.className = 'redact-page';
    wrapper.dataset.index = String(index);
    // Placeholder size until the page renders, so the scrollbar is about right from the start.
    const width = fitWidth(first.width);
    Object.assign(wrapper.style, { width: `${width}px`, height: `${(width * first.height) / first.width}px` });
    const canvas = document.createElement('canvas');
    const overlay = document.createElement('div');
    overlay.className = 'redact-overlay';
    wrapper.append(canvas, overlay);
    scroller.append(wrapper);
    const view: PageView = { wrapper, canvas, overlay, dpr: 1 };
    views.push(view);
    enableDrawing(view, index);
    observer.observe(wrapper);
  }

  find.onsubmit = async (event) => {
    event.preventDefault();
    const query = search.value.trim();
    if (!query) return;
    markAll.disabled = true;
    const found: Box[][] = [];
    for (let index = 0; index < doc.numPages; index++) {
      const view = views[index];
      view.items ??= ((await (await doc.getPage(index + 1)).getTextContent()).items as unknown as TextItemLike[]).filter(
        (item) => typeof item.str === 'string',
      );
      found.push(findMatches(view.items, query));
    }
    markAll.disabled = false;
    const total = found.reduce((sum, page) => sum + page.length, 0);
    if (total) change(marks.map((page, i) => [...page, ...found[i]]));
    count.textContent = total ? t('rd.found', { n: total }) : t('rd.none', { text: query });
  };
  undo.onclick = () => {
    marks = history.pop() ?? marks;
    refresh();
  };
  clear.onclick = () => change(marks.map(() => []));
  refresh();

  return {
    save: (options, onProgress) =>
      rasterize(doc, file.name.replace(/\.pdf$/i, ''), { ...options, marks: (index) => marks[index] }, onProgress),
    destroy() {
      observer.disconnect();
      void doc.loadingTask.destroy();
      viewer.classList.remove('redact-pdf');
      viewer.replaceChildren();
    },
  };
}
