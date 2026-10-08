// Remove Background: the background goes as soon as a picture is chosen, then the person picks
// what goes behind (nothing, a colour, their own photo, or a blur), the size, and touches up any
// spot the model missed. Built for big buttons and few decisions; everything stays on the device.
import './remove-bg.css';
import { compose, removeBackground, render, type Backdrop, type SaveFormat } from '../engine/background';
import type { Output } from '../engine/local';
import { t } from '../i18n';

export interface BackgroundEditor {
  save(options: { format?: string; width?: string }, onProgress?: (fraction: number) => void): Promise<Output>;
  destroy(): void;
}

const SWATCHES: [key: 'white' | 'black' | 'blue' | 'red' | 'green' | 'gray', color: string][] = [
  ['white', '#ffffff'],
  ['black', '#000000'],
  ['blue', '#1e6fd9'],
  ['red', '#d7262e'],
  ['green', '#1d9a5b'],
  ['gray', '#9ca3af'],
];
/** Longest side of the on-screen preview; saving always works from the full-size cut-out. */
const PREVIEW = 1600;
const TILE = 64;

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
};

export async function openBackgroundEditor(file: File, viewer: HTMLElement, preset: Record<string, string> = {}): Promise<BackgroundEditor> {
  let photo: ImageBitmap;
  try {
    photo = await createImageBitmap(file);
  } catch {
    const { LocalError } = await import('../engine/local');
    throw new LocalError('BAD_IMAGE');
  }
  const W = photo.width;
  const H = photo.height;

  // ---- Layout ----
  viewer.classList.add('bg-editor');
  const stage = element('div', 'bg-stage');
  const canvas = element('canvas', 'bg-canvas');
  const scale = Math.min(1, PREVIEW / Math.max(W, H));
  canvas.width = Math.round(W * scale);
  canvas.height = Math.round(H * scale);
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', t('bg.previewLabel'));
  const busy = element('div', 'bg-busy');
  const busyText = element('p', '', t('bg.working', { pct: 0 }));
  busyText.setAttribute('role', 'status');
  const bar = element('div', 'progress');
  bar.append(element('span'));
  busy.append(element('span', 'bg-spinner'), busyText, bar);
  stage.append(canvas, busy);
  const compare = element('button', 'bg-btn bg-compare', t('bg.compare'));
  compare.type = 'button';
  compare.disabled = true;
  const note = element('p', 'bg-note');
  note.setAttribute('aria-live', 'polite');

  const group = (title: string) => {
    const box = element('fieldset', 'bg-group');
    box.append(element('legend', '', title));
    return box;
  };
  const backdrops = group(t('bg.background'));
  const choices = element('div', 'bg-choices');
  backdrops.append(choices);
  const sizeBox = group(t('bg.size'));
  const touch = group(t('bg.touch'));
  viewer.replaceChildren(stage, compare, note, backdrops, sizeBox, touch);

  // Before the cut-out is ready, the photo itself is shown under the progress.
  const preview = canvas.getContext('2d')!;
  preview.drawImage(photo, 0, 0, canvas.width, canvas.height);

  // ---- Remove the background ----
  const setBar = (fraction: number) => {
    const pct = Math.min(100, Math.round(fraction * 100));
    bar.style.setProperty('--pct', `${pct}%`);
    return pct;
  };
  const source = await createImageBitmap(photo);
  const { cutout, model } = await removeBackground(source, {
    onSetup: (loaded, total) => {
      setBar(loaded / total);
      busyText.textContent = t('bg.preparing', { loaded: Math.round(loaded / 1e6), total: Math.round(total / 1e6) });
    },
    onProgress: (fraction) => {
      busyText.textContent = t('bg.working', { pct: setBar(fraction) });
    },
  });
  busy.hidden = true;
  if (model === 'u2netp') note.textContent = t('bg.lite');

  // The full-size cut-out lives on its own canvas; touch-ups change it in place.
  const cut = new OffscreenCanvas(W, H);
  const cutContext = cut.getContext('2d', { willReadFrequently: true })!;
  cutContext.putImageData(cutout, 0, 0);
  const pixels = cutout.data;
  let original: Uint8ClampedArray | undefined; // the photo's pixels, read only when "Restore" is first used

  let backdrop: Backdrop = { kind: 'none' };
  let ownPhoto: ImageBitmap | undefined;
  const draw = () => compose(canvas, cut, photo, backdrop);

  // ---- Backdrop choices ----
  const buttons: HTMLButtonElement[] = [];
  // onPick returns false when nothing was picked yet (a file or colour dialog is still to come).
  const choice = (label: string, onPick: () => void | boolean, swatch?: string) => {
    const button = element('button', 'bg-choice');
    button.type = 'button';
    button.setAttribute('aria-pressed', 'false');
    const chip = element('span', 'bg-chip');
    if (swatch) chip.style.background = swatch;
    button.append(chip, element('span', '', label));
    button.onclick = () => {
      if (onPick() === false) return;
      for (const other of buttons) other.setAttribute('aria-pressed', String(other === button));
      draw();
    };
    buttons.push(button);
    choices.append(button);
    return button;
  };
  const none = choice(t('bg.none'), () => {
    backdrop = { kind: 'none' };
  });
  none.querySelector('.bg-chip')!.classList.add('bg-chip-clear');
  const colors = new Map<string, HTMLButtonElement>();
  for (const [key, color] of SWATCHES)
    colors.set(
      key,
      choice(t(`bg.${key}`), () => {
        backdrop = { kind: 'color', color };
      }, color),
    );
  const picker = element('input');
  picker.type = 'color';
  picker.value = '#ffd166';
  picker.className = 'bg-hidden';
  picker.setAttribute('aria-label', t('bg.custom'));
  const custom = choice(t('bg.custom'), () => {
    picker.click();
    backdrop = { kind: 'color', color: picker.value };
  });
  custom.querySelector('.bg-chip')!.classList.add('bg-chip-rainbow');
  picker.oninput = () => {
    backdrop = { kind: 'color', color: picker.value };
    (custom.querySelector('.bg-chip') as HTMLElement).style.background = picker.value;
    for (const other of buttons) other.setAttribute('aria-pressed', String(other === custom));
    draw();
  };
  choices.append(picker);
  const upload = element('input');
  upload.type = 'file';
  upload.accept = 'image/*';
  upload.className = 'bg-hidden';
  const photoChoice = choice(t('bg.photo'), () => {
    if (!ownPhoto) {
      upload.click();
      return false;
    }
    backdrop = { kind: 'image', image: ownPhoto };
  });
  photoChoice.querySelector('.bg-chip')!.classList.add('bg-chip-photo');
  upload.onchange = async () => {
    const chosen = upload.files?.[0];
    if (!chosen) return;
    try {
      ownPhoto?.close();
      ownPhoto = await createImageBitmap(chosen);
    } catch {
      return;
    }
    backdrop = { kind: 'image', image: ownPhoto };
    for (const other of buttons) other.setAttribute('aria-pressed', String(other === photoChoice));
    draw();
  };
  choices.append(upload);
  const blur = choice(t('bg.blur'), () => {
    backdrop = { kind: 'blur', amount: 0.012 };
  });
  blur.querySelector('.bg-chip')!.classList.add('bg-chip-blur');
  // Pages like "white background" start with that colour picked.
  (colors.get(preset.bg as 'white') ?? none).click();

  // ---- Size ----
  const sizeSelect = element('select');
  sizeSelect.setAttribute('aria-label', t('bg.size'));
  const widths = [2000, 1080, 600].filter((w) => w < W);
  sizeSelect.append(new Option(t('bg.original', { w: W, h: H }), String(W)));
  for (const w of widths) sizeSelect.append(new Option(t('bg.widthOption', { w, h: Math.round((H * w) / W) }), String(w)));
  sizeSelect.append(new Option(t('bg.customSize'), 'custom'));
  const widthInput = element('input');
  widthInput.type = 'number';
  widthInput.min = '16';
  widthInput.max = String(Math.max(W * 4, 8000));
  widthInput.value = String(W);
  widthInput.hidden = true;
  widthInput.setAttribute('aria-label', t('bg.widthLabel'));
  const sizeNote = element('span', 'bg-size-note');
  const updateSize = () => {
    widthInput.hidden = sizeSelect.value !== 'custom';
    const w = outputWidth();
    sizeNote.textContent = widthInput.hidden ? '' : `× ${Math.round((H * w) / W)} px`;
  };
  sizeSelect.onchange = updateSize;
  widthInput.oninput = updateSize;
  sizeBox.append(sizeSelect, widthInput, sizeNote);
  const outputWidth = () => {
    const w = sizeSelect.value === 'custom' ? Math.round(Number(widthInput.value)) : Number(sizeSelect.value);
    return Number.isFinite(w) && w >= 16 ? Math.min(w, Number(widthInput.max)) : W;
  };

  // ---- Touch up ----
  touch.append(element('p', 'bg-hint', t('bg.touchHint')));
  const tools = element('div', 'bg-tools');
  const modes: HTMLButtonElement[] = [];
  let mode: 'erase' | 'restore' | null = null;
  const modeButton = (key: 'erase' | 'restore') => {
    const button = element('button', 'bg-btn', t(`bg.${key}`));
    button.type = 'button';
    button.setAttribute('aria-pressed', 'false');
    button.onclick = () => {
      mode = mode === key ? null : key;
      for (const other of modes) other.setAttribute('aria-pressed', String(other === button && mode === key));
      stage.classList.toggle('painting', mode !== null);
      // The brush works on the picture: bring it into view.
      if (mode) stage.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    };
    modes.push(button);
    return button;
  };
  const brush = element('input');
  brush.type = 'range';
  brush.min = '4';
  brush.max = '80';
  brush.value = '24';
  brush.setAttribute('aria-label', t('bg.brush'));
  const brushLabel = element('label', 'bg-brush', t('bg.brush'));
  brushLabel.append(brush);
  const undo = element('button', 'bg-btn', t('ed.undo'));
  undo.type = 'button';
  undo.disabled = true;
  tools.append(modeButton('erase'), modeButton('restore'), brushLabel, undo);
  touch.append(tools);

  // Each stroke remembers the 64×64 tiles it changed, so Undo restores just those.
  type Snapshot = Map<number, ImageData>;
  const history: Snapshot[] = [];
  let stroke: Snapshot | undefined;
  const tilesX = Math.ceil(W / TILE);
  const remember = (x0: number, y0: number, x1: number, y1: number) => {
    for (let ty = Math.floor(y0 / TILE); ty <= Math.floor(y1 / TILE); ty++)
      for (let tx = Math.floor(x0 / TILE); tx <= Math.floor(x1 / TILE); tx++) {
        const key = ty * tilesX + tx;
        if (stroke!.has(key)) continue;
        const w = Math.min(TILE, W - tx * TILE);
        const h = Math.min(TILE, H - ty * TILE);
        const copy = new ImageData(w, h);
        for (let row = 0; row < h; row++) {
          const from = ((ty * TILE + row) * W + tx * TILE) * 4;
          copy.data.set(pixels.subarray(from, from + w * 4), row * w * 4);
        }
        stroke!.set(key, copy);
      }
  };
  const putTile = (key: number, tile: ImageData) => {
    const tx = key % tilesX;
    const ty = Math.floor(key / tilesX);
    for (let row = 0; row < tile.height; row++) pixels.set(tile.data.subarray(row * tile.width * 4, (row + 1) * tile.width * 4), ((ty * TILE + row) * W + tx * TILE) * 4);
    cutContext.putImageData(tile, tx * TILE, ty * TILE);
  };
  undo.onclick = () => {
    const last = history.pop();
    if (!last) return;
    for (const [key, tile] of last) putTile(key, tile);
    undo.disabled = !history.length;
    draw();
  };

  /** One round dab of the brush at full-size coordinates, soft at its rim. */
  const dab = (cx: number, cy: number, radius: number) => {
    const x0 = Math.max(0, Math.floor(cx - radius));
    const y0 = Math.max(0, Math.floor(cy - radius));
    const x1 = Math.min(W - 1, Math.ceil(cx + radius));
    const y1 = Math.min(H - 1, Math.ceil(cy + radius));
    if (x1 < x0 || y1 < y0) return;
    remember(x0, y0, x1, y1);
    if (mode === 'restore' && !original) {
      const reader = new OffscreenCanvas(W, H).getContext('2d', { willReadFrequently: true })!;
      reader.drawImage(photo, 0, 0);
      original = reader.getImageData(0, 0, W, H).data;
    }
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / radius;
        if (d >= 1) continue;
        const strength = d < 0.6 ? 1 : (1 - d) / 0.4;
        const o = (y * W + x) * 4;
        if (mode === 'erase') pixels[o + 3] = Math.round(pixels[o + 3] * (1 - strength));
        else {
          const a = Math.max(pixels[o + 3], Math.round(255 * strength));
          if (a > pixels[o + 3]) {
            pixels[o] = original![o];
            pixels[o + 1] = original![o + 1];
            pixels[o + 2] = original![o + 2];
            pixels[o + 3] = a;
          }
        }
      }
    cutContext.putImageData(cutout, 0, 0, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
  };
  canvas.addEventListener('pointerdown', (event) => {
    if (!mode || event.button !== 0) return;
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    stroke = new Map();
    let last: [number, number] | undefined;
    const paint = (e: PointerEvent) => {
      const box = canvas.getBoundingClientRect();
      const x = ((e.clientX - box.left) / box.width) * W;
      const y = ((e.clientY - box.top) / box.height) * H;
      // The brush size is set in screen pixels, so it feels the same at any zoom.
      const radius = (Number(brush.value) / 2) * (W / box.width);
      // Fill the gap between pointer events so fast strokes stay continuous.
      const steps = last ? Math.max(1, Math.ceil(Math.hypot(x - last[0], y - last[1]) / (radius / 3))) : 1;
      for (let i = 1; i <= steps; i++) dab(last ? last[0] + ((x - last[0]) * i) / steps : x, last ? last[1] + ((y - last[1]) * i) / steps : y, radius);
      last = [x, y];
      draw();
    };
    paint(event);
    const end = () => {
      canvas.removeEventListener('pointermove', paint);
      if (stroke?.size) history.push(stroke);
      if (history.length > 30) history.shift();
      stroke = undefined;
      undo.disabled = !history.length;
    };
    canvas.addEventListener('pointermove', paint);
    canvas.addEventListener('pointerup', end, { once: true });
    canvas.addEventListener('pointercancel', end, { once: true });
  });

  // ---- Before and after ----
  compare.disabled = false;
  const showOriginal = (on: boolean) => {
    if (on) {
      preview.clearRect(0, 0, canvas.width, canvas.height);
      preview.drawImage(photo, 0, 0, canvas.width, canvas.height);
    } else draw();
    compare.classList.toggle('active', on);
  };
  compare.addEventListener('pointerdown', () => showOriginal(true));
  for (const type of ['pointerup', 'pointerleave', 'pointercancel']) compare.addEventListener(type, () => showOriginal(false));
  compare.addEventListener('keydown', (event) => {
    if (event.key === ' ' || event.key === 'Enter') showOriginal(true);
  });
  compare.addEventListener('keyup', () => showOriginal(false));
  draw();

  const base = file.name.replace(/\.[^.]+$/, '');
  return {
    async save(options, onProgress) {
      onProgress?.(0.2);
      const chosen = (['png', 'jpg', 'webp'] as SaveFormat[]).find((f) => f === options.format) ?? (backdrop.kind === 'none' ? 'png' : 'jpg');
      const w = outputWidth();
      const h = Math.max(1, Math.round((H * w) / W));
      const blob = await render(cut, photo, backdrop, w, h, chosen);
      onProgress?.(1);
      return {
        blob,
        name: `${base}-${backdrop.kind === 'none' ? 'no-bg' : 'new-bg'}.${chosen}`,
        summary: `${w} × ${h} px`,
      };
    },
    destroy() {
      photo.close();
      ownPhoto?.close();
      viewer.classList.remove('bg-editor');
      viewer.replaceChildren();
    },
  };
}
