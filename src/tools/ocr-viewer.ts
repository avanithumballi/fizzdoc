// Renders OCR results the way iOS's Live Text does: the image on top, an invisible span over each
// recognized word so the visitor can drag-select and copy it like real text, plus a plain-text
// fallback for anyone (or anything) that can't drag-select an image overlay.
import './ocr-viewer.css';
import type { OcrResult } from '../engine/ocr';

const pct = (value: number, total: number) => `${total > 0 ? (value / total) * 100 : 0}%`;

export function showTextOverlay(container: HTMLElement, image: Blob, result: OcrResult): void {
  container.innerHTML = '';
  container.classList.add('ocr-viewer');

  const frame = document.createElement('div');
  frame.className = 'ocr-frame';
  frame.style.aspectRatio = `${result.width || 1} / ${result.height || 1}`;

  const url = URL.createObjectURL(image);
  const img = document.createElement('img');
  img.src = url;
  img.alt = '';
  // Revoke once the image is decoded, or failed to decode: either way the URL is no longer needed.
  img.addEventListener('load', () => URL.revokeObjectURL(url), { once: true });
  img.addEventListener('error', () => URL.revokeObjectURL(url), { once: true });
  frame.append(img);

  const words: { box: HTMLElement; text: HTMLElement }[] = [];
  for (const word of result.words) {
    const box = document.createElement('span');
    box.className = 'ocr-word';
    box.style.left = pct(word.bbox.x0, result.width);
    box.style.top = pct(word.bbox.y0, result.height);
    box.style.width = pct(word.bbox.x1 - word.bbox.x0, result.width);
    box.style.height = pct(word.bbox.y1 - word.bbox.y0, result.height);

    const text = document.createElement('span');
    text.className = 'ocr-word-text';
    text.textContent = word.text;
    box.append(text);
    frame.append(box);
    // A plain text node between words, in reading order, so dragging a selection across several
    // words (which Selection.toString() walks in DOM order, not visual position) copies them
    // space-separated instead of run together. It sits in normal flow but is empty of any ink.
    frame.append(document.createTextNode(' '));
    words.push({ box, text });
  }
  container.append(frame);

  // Single measurement pass: a word's target width vs. its text's natural width at the font-size
  // cqh already gave it is a fixed ratio — both grow and shrink together on resize, so the
  // horizontal stretch computed here stays correct without ever re-measuring.
  for (const { box, text } of words) {
    const target = box.getBoundingClientRect().width;
    const natural = text.getBoundingClientRect().width;
    if (target > 0 && natural > 0) text.style.transform = `scaleX(${Math.min(20, Math.max(0.05, target / natural))})`;
  }

  const controls = document.createElement('div');
  controls.className = 'ocr-controls';
  const copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.className = 'button';
  copyButton.textContent = 'Copy all text';
  controls.append(copyButton);

  const textarea = document.createElement('textarea');
  textarea.className = 'ocr-text';
  textarea.readOnly = true;
  textarea.value = result.text;
  textarea.setAttribute('aria-label', 'Recognized text');

  copyButton.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(result.text);
    } catch {
      textarea.select();
      document.execCommand('copy');
    }
    const original = copyButton.textContent;
    copyButton.textContent = 'Copied';
    setTimeout(() => (copyButton.textContent = original), 1500);
  });

  container.append(controls, textarea);
}
