// Split Audio: a waveform you can listen to, with draggable split points and typed timestamps.
// "Trim" keeps one part between two handles; "Split" cuts the file into as many parts as you like.
// Every part can be previewed before saving, and saving never re-encodes (engine/audio.ts).
import './audio-split.css';
import { zipSync } from 'fflate';
import { extension, formatTime, framesBetween, parseAudio, parseTime, peaks, write, type Track } from '../engine/audio';
import type { Output } from '../engine/local';
import { t } from '../i18n';

type Mode = 'trim' | 'split';
interface Part {
  start: number;
  end: number;
  keep: boolean;
}

/** Parts between sorted split points; zero-length parts are dropped. */
export function partsOf(points: number[], duration: number, keep: boolean[]): Part[] {
  const edges = [0, ...points, duration];
  return edges
    .slice(1)
    .map((end, i) => ({ start: edges[i], end, keep: keep[i] ?? true }))
    .filter((part) => part.end - part.start > 0.05);
}

/** Split points every `minutes`, or into `count` equal parts. */
export const everyPoints = (duration: number, seconds: number) =>
  seconds > 0 ? Array.from({ length: Math.max(0, Math.ceil(duration / seconds) - 1) }, (_, i) => (i + 1) * seconds) : [];
export const equalPoints = (duration: number, count: number) =>
  count > 1 ? Array.from({ length: Math.floor(count) - 1 }, (_, i) => ((i + 1) * duration) / Math.floor(count)) : [];

export interface Splitter {
  save(): Promise<Output>;
  destroy(): void;
}

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
};
const button = (text: string, className = 'au-btn') => {
  const node = element('button', className, text);
  node.type = 'button';
  return node;
};

export async function openSplitter(file: File, viewer: HTMLElement): Promise<Splitter> {
  const track: Track = parseAudio(new Uint8Array(await file.arrayBuffer()));
  const duration = track.duration;
  const base = file.name.replace(/\.[^.]+$/, '');
  const url = URL.createObjectURL(file);
  const audio = new Audio(url);
  audio.preload = 'auto';

  let mode: Mode = 'trim';
  // Trim: two handles, keep the middle. Split: any number of points, keep what's ticked.
  let trim = [0, duration];
  let points: number[] = [];
  let keep: boolean[] = [];
  let stopAt = Infinity;
  let wave: Float32Array | undefined;
  let outputs: string[] = [];

  // ---- chrome ----
  const tabs = element('div', 'au-tabs');
  tabs.setAttribute('role', 'tablist');
  const trimTab = button(t('au.trim'), 'au-tab');
  const splitTab = button(t('au.split'), 'au-tab');
  for (const tab of [trimTab, splitTab]) tab.setAttribute('role', 'tab');
  tabs.append(trimTab, splitTab);

  const play = button(t('au.play'), 'au-btn au-play');
  const clock = element('span', 'au-clock');
  const bar = element('div', 'au-bar');
  bar.append(play, clock);

  const stage = element('div', 'au-stage');
  const canvas = element('canvas', 'au-wave');
  const marks = element('div', 'au-marks');
  const playhead = element('div', 'au-playhead');
  stage.append(canvas, marks, playhead);
  stage.setAttribute('aria-label', t('au.hint'));
  const ruler = element('div', 'au-ruler');
  const hint = element('p', 'au-hint', t('au.hint'));

  const trimPanel = element('div', 'au-panel');
  const splitPanel = element('div', 'au-panel');
  const partsList = element('ol', 'au-parts');
  const results = element('div', 'au-results');
  viewer.classList.add('audio-split');
  viewer.replaceChildren(tabs, bar, stage, ruler, hint, trimPanel, splitPanel, partsList, results);

  // ---- time fields ----
  function timeField(label: string, get: () => number, set: (value: number) => void) {
    const wrap = element('label', 'au-time');
    wrap.append(label);
    const input = element('input');
    input.inputMode = 'decimal';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.value = formatTime(get());
    const commit = () => {
      const value = parseTime(input.value);
      if (Number.isNaN(value)) {
        input.setCustomValidity(t('au.badTime'));
        input.reportValidity();
        return;
      }
      input.setCustomValidity('');
      set(Math.min(Math.max(value, 0), duration));
      update();
    };
    input.addEventListener('change', commit);
    input.addEventListener('keydown', (event) => event.key === 'Enter' && commit());
    wrap.append(input);
    return { wrap, input, sync: () => document.activeElement !== input && (input.value = formatTime(get())) };
  }

  const startField = timeField(t('au.start'), () => trim[0], (v) => (trim = [Math.min(v, trim[1] - 0.1), trim[1]]));
  const endField = timeField(t('au.end'), () => trim[1], (v) => (trim = [trim[0], Math.max(v, trim[0] + 0.1)]));
  const setStart = button(t('au.setStart'));
  const setEnd = button(t('au.setEnd'));
  const playTrim = button(t('au.playSelection'));
  setStart.onclick = () => {
    trim = [Math.min(audio.currentTime, trim[1] - 0.1), trim[1]];
    update();
  };
  setEnd.onclick = () => {
    trim = [trim[0], Math.max(audio.currentTime, trim[0] + 0.1)];
    update();
  };
  playTrim.onclick = () => playRange(trim[0], trim[1]);
  const trimRow = element('div', 'au-row');
  trimRow.append(startField.wrap, setStart, endField.wrap, setEnd, playTrim);
  trimPanel.append(trimRow);

  const addPoint = button(t('au.addSplit'));
  addPoint.onclick = () => {
    const at = audio.currentTime;
    if (at > 0.1 && at < duration - 0.1 && !points.some((p) => Math.abs(p - at) < 0.1)) setPoints([...points, at]);
  };
  const number = (value: string, min: string) => {
    const input = element('input');
    Object.assign(input, { type: 'number', min, value, inputMode: 'decimal' });
    return input;
  };
  const everyInput = number('5', '0.1');
  const every = button(t('au.apply'));
  every.onclick = () => setPoints(everyPoints(duration, Number(everyInput.value) * 60));
  const equalInput = number('2', '2');
  const equal = button(t('au.apply'));
  equal.onclick = () => setPoints(equalPoints(duration, Number(equalInput.value)));
  const clear = button(t('au.clear'));
  clear.onclick = () => setPoints([]);
  const everyLabel = element('label', 'au-inline');
  everyLabel.append(t('au.every'), everyInput, t('au.minutes'));
  const equalLabel = element('label', 'au-inline');
  equalLabel.append(t('au.equal'), equalInput);
  const splitRow = element('div', 'au-row');
  const everyGroup = element('span', 'au-group');
  everyGroup.append(everyLabel, every);
  const equalGroup = element('span', 'au-group');
  equalGroup.append(equalLabel, equal);
  splitRow.append(addPoint, everyGroup, equalGroup, clear);
  splitPanel.append(splitRow);

  function setPoints(next: number[]) {
    const sorted = [...new Set(next.map((p) => Math.round(p * 10) / 10))].filter((p) => p > 0 && p < duration).sort((a, b) => a - b);
    // Parts keep their tick when points are only moved; new parts start ticked.
    keep = partsOf(sorted, duration, []).map((_, i) => (sorted.length === points.length ? keep[i] ?? true : true));
    points = sorted;
    update();
  }

  // ---- playback ----
  function playRange(start: number, end: number) {
    audio.currentTime = start;
    stopAt = end;
    void audio.play();
  }
  play.onclick = () => {
    stopAt = Infinity;
    if (audio.paused) void audio.play();
    else audio.pause();
  };
  audio.addEventListener('play', () => (play.textContent = t('au.pause')));
  audio.addEventListener('pause', () => (play.textContent = t('au.play')));
  let frame = 0;
  const tick = () => {
    if (audio.currentTime >= stopAt) {
      audio.pause();
      stopAt = Infinity;
    }
    drawPlayhead();
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);

  // ---- waveform ----
  const x = (seconds: number) => `${(seconds / duration) * 100}%`;
  function drawPlayhead() {
    playhead.style.left = x(audio.currentTime);
    clock.textContent = `${formatTime(audio.currentTime)} / ${formatTime(duration)}`;
  }
  function drawWave() {
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const context = canvas.getContext('2d')!;
    context.scale(dpr, dpr);
    const color = getComputedStyle(stage).getPropertyValue('--wave').trim() || '#888';
    context.fillStyle = color;
    if (!wave) {
      context.fillRect(0, height / 2 - 1, width, 2);
      return;
    }
    const per = wave.length / width;
    for (let px = 0; px < width; px++) {
      let max = 0;
      for (let i = Math.floor(px * per), stop = Math.floor((px + 1) * per); i <= stop && i < wave.length; i++) max = Math.max(max, wave[i]);
      const h = Math.max(1.5, max * height * 0.92);
      context.fillRect(px, (height - h) / 2, 1, h);
    }
  }
  function drawRuler() {
    const steps = [1, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
    const step = steps.find((s) => duration / s <= 8) ?? 3600;
    ruler.replaceChildren(
      ...Array.from({ length: Math.floor(duration / step) + 1 }, (_, i) => {
        const tickLabel = element('span', '', formatTime(i * step, false));
        tickLabel.style.left = x(i * step);
        return tickLabel;
      }),
    );
  }

  // Handles are focusable sliders: drag them, or use the arrow keys (Shift = 1 s steps).
  function handle(at: number, label: string, move: (seconds: number) => void, className = '') {
    const node = element('div', `au-handle ${className}`);
    node.style.left = x(at);
    node.tabIndex = 0;
    node.setAttribute('role', 'slider');
    node.setAttribute('aria-label', label);
    node.setAttribute('aria-valuemin', '0');
    node.setAttribute('aria-valuemax', String(Math.round(duration)));
    node.setAttribute('aria-valuenow', String(Math.round(at)));
    node.setAttribute('aria-valuetext', formatTime(at));
    node.append(element('span', 'au-handle-time', formatTime(at)));
    node.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      node.setPointerCapture(event.pointerId);
      const bounds = stage.getBoundingClientRect();
      const toTime = (clientX: number) => Math.min(Math.max(((clientX - bounds.left) / bounds.width) * duration, 0), duration);
      const drag = (next: PointerEvent) => {
        const value = toTime(next.clientX);
        node.style.left = x(value);
        node.querySelector('.au-handle-time')!.textContent = formatTime(value);
      };
      node.addEventListener('pointermove', drag);
      node.addEventListener(
        'pointerup',
        (up) => {
          node.removeEventListener('pointermove', drag);
          move(toTime(up.clientX));
          update();
        },
        { once: true },
      );
    });
    node.addEventListener('keydown', (event) => {
      const step = event.shiftKey ? 1 : 0.1;
      const delta = event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -step : event.key === 'ArrowRight' || event.key === 'ArrowUp' ? step : 0;
      if (!delta) return;
      event.preventDefault();
      move(Math.min(Math.max(at + delta, 0), duration));
      update();
      (marks.querySelector(`[aria-label="${CSS.escape(label)}"]`) as HTMLElement | null)?.focus();
    });
    return node;
  }

  function drawMarks() {
    const shades: HTMLElement[] = [];
    if (mode === 'trim') {
      for (const [from, to] of [[0, trim[0]], [trim[1], duration]]) {
        const shade = element('div', 'au-shade');
        Object.assign(shade.style, { left: x(from), width: x(to - from) });
        shades.push(shade);
      }
      marks.replaceChildren(
        ...shades,
        handle(trim[0], t('au.startHandle'), (v) => (trim = [Math.min(v, trim[1] - 0.1), trim[1]]), 'start'),
        handle(trim[1], t('au.endHandle'), (v) => (trim = [trim[0], Math.max(v, trim[0] + 0.1)]), 'end'),
      );
      return;
    }
    partsOf(points, duration, keep).forEach((part, i) => {
      if (part.keep) return;
      const shade = element('div', 'au-shade');
      Object.assign(shade.style, { left: x(part.start), width: x(part.end - part.start) });
      shade.dataset.part = String(i + 1);
      shades.push(shade);
    });
    marks.replaceChildren(
      ...shades,
      ...points.map((p, i) =>
        handle(p, t('au.marker', { n: i + 1 }), (v) => setPoints(points.map((q, k) => (k === i ? v : q)))),
      ),
    );
  }

  function drawParts() {
    const parts = partsOf(points, duration, keep);
    partsList.replaceChildren(
      ...parts.map((part, i) => {
        const row = element('li', 'au-part');
        const tick = element('input');
        tick.type = 'checkbox';
        tick.checked = part.keep;
        tick.setAttribute('aria-label', `${t('au.keep')}: ${t('au.part', { n: i + 1 })}`);
        tick.onchange = () => {
          keep[i] = tick.checked;
          update();
        };
        const name = element('strong', '', t('au.part', { n: i + 1 }));
        const span = element('span', 'au-span', `${formatTime(part.start)} – ${formatTime(part.end)}`);
        const length = element('span', 'au-length', formatTime(part.end - part.start, false));
        const listen = button(t('au.preview'));
        listen.onclick = () => playRange(part.start, part.end);
        const keepLabel = element('label', 'au-keep');
        keepLabel.append(tick, t('au.keep'));
        row.append(keepLabel, name, span, length, listen);
        return row;
      }),
    );
  }

  function update() {
    trimTab.setAttribute('aria-selected', String(mode === 'trim'));
    splitTab.setAttribute('aria-selected', String(mode === 'split'));
    trimPanel.hidden = mode !== 'trim';
    splitPanel.hidden = partsList.hidden = mode !== 'split';
    startField.sync();
    endField.sync();
    drawMarks();
    if (mode === 'split') drawParts();
    clearResults();
  }
  function clearResults() {
    outputs.forEach(URL.revokeObjectURL);
    outputs = [];
    results.replaceChildren();
  }
  trimTab.onclick = () => {
    mode = 'trim';
    update();
  };
  splitTab.onclick = () => {
    mode = 'split';
    if (!points.length) setPoints(equalPoints(duration, 2));
    else update();
  };

  // Clicking the waveform moves the playhead there.
  stage.addEventListener('pointerdown', (event) => {
    const bounds = stage.getBoundingClientRect();
    audio.currentTime = ((event.clientX - bounds.left) / bounds.width) * duration;
    stopAt = Infinity;
  });

  const resize = new ResizeObserver(() => drawWave());
  resize.observe(stage);
  drawRuler();
  update();
  drawPlayhead();
  void peaks(track, 20).then((values) => {
    // Normalise so quiet recordings still show a readable shape.
    const loudest = values.reduce((max, v) => Math.max(max, v), 0) || 1;
    wave = values.map((v) => v / loudest);
    drawWave();
  });

  return {
    async save() {
      audio.pause();
      const ext = extension(track);
      const kept = mode === 'trim' ? [{ start: trim[0], end: trim[1], keep: true }] : partsOf(points, duration, keep).filter((p) => p.keep);
      const pieces = kept.map((part) => write([{ track, frames: framesBetween(track, part.start, part.end) }]));
      const names = kept.map((_, i) => (mode === 'trim' ? `${base}-trimmed.${ext}` : `${base}-part-${String(i + 1).padStart(2, '0')}.${ext}`));
      // Every part gets its own player and download link, so you can check each one first.
      clearResults();
      if (pieces.length > 1) {
        results.append(element('h3', '', t('au.results')));
        pieces.forEach((blob, i) => {
          const href = URL.createObjectURL(blob);
          outputs.push(href);
          const row = element('div', 'au-result');
          const player = element('audio');
          player.controls = true;
          player.src = href;
          const link = element('a', 'au-btn', t('au.download'));
          Object.assign(link, { href, download: names[i] });
          row.append(element('strong', '', names[i]), player, link);
          results.append(row);
        });
      }
      const total = kept.reduce((sum, part) => sum + part.end - part.start, 0);
      const summary = `${kept.length} ${kept.length === 1 ? 'file' : 'files'} · ${formatTime(total, false)}`;
      if (pieces.length === 1) return { blob: pieces[0], name: names[0], summary };
      const zip: Record<string, Uint8Array> = {};
      for (const [i, blob] of pieces.entries()) zip[names[i]] = new Uint8Array(await blob.arrayBuffer());
      return { blob: new Blob([zipSync(zip, { level: 0 }) as Uint8Array<ArrayBuffer>], { type: 'application/zip' }), name: `${base}-parts.zip`, summary };
    },
    destroy() {
      cancelAnimationFrame(frame);
      resize.disconnect();
      audio.pause();
      audio.removeAttribute('src');
      URL.revokeObjectURL(url);
      clearResults();
      viewer.classList.remove('audio-split');
      viewer.replaceChildren();
    },
  };
}
