// Animated GIFs, read into whole frames and written back. gifuct-js (MIT) decodes, gifenc (MIT)
// encodes; both are small, pure JavaScript, and run on the device like everything else.
import { decompressFrames, parseGIF } from 'gifuct-js';
import { GIFEncoder, applyPalette, quantize } from 'gifenc';

export interface GifFrame {
  /** The whole picture at this point of the animation (frames in GIFs are often just patches). */
  image: ImageData;
  /** How long it stays on screen, in milliseconds. */
  delay: number;
}

/** Every frame of a GIF, composed the way a browser shows them. */
export function decodeGif(bytes: ArrayBuffer): { width: number; height: number; frames: GifFrame[] } {
  const gif = parseGIF(bytes);
  const width = gif.lsd.width;
  const height = gif.lsd.height;
  const canvas = new Uint8ClampedArray(width * height * 4);
  const frames: GifFrame[] = [];
  for (const frame of decompressFrames(gif, true)) {
    const { top, left, width: w, height: h } = frame.dims;
    // Disposal 3 restores the picture as it was before this frame once the frame is over.
    const before = frame.disposalType === 3 ? canvas.slice() : undefined;
    for (let y = 0; y < h; y++) {
      const cy = top + y;
      if (cy < 0 || cy >= height) continue;
      for (let x = 0; x < w; x++) {
        const cx = left + x;
        if (cx < 0 || cx >= width) continue;
        const from = (y * w + x) * 4;
        if (frame.patch[from + 3] === 0) continue; // transparent pixels show what was there
        canvas.set(frame.patch.subarray(from, from + 4), (cy * width + cx) * 4);
      }
    }
    frames.push({ image: new ImageData(canvas.slice(), width, height), delay: frame.delay || 100 });
    if (frame.disposalType === 2) {
      // Disposal 2 clears the frame's area to the background (transparent, as browsers do).
      for (let y = Math.max(0, top); y < Math.min(height, top + h); y++) canvas.fill(0, (y * width + Math.max(0, left)) * 4, (y * width + Math.min(width, left + w)) * 4);
    } else if (before) canvas.set(before);
  }
  return { width, height, frames };
}

/** A looping GIF from finished frames. With `transparent`, pixels under half opacity become see-through. */
export function encodeGif(frames: { data: Uint8ClampedArray; delay: number }[], width: number, height: number, transparent: boolean): Uint8Array {
  const gif = GIFEncoder();
  frames.forEach(({ data, delay }, i) => {
    if (transparent) {
      // GIF transparency is all or nothing: one palette entry stands for "see-through".
      const palette = quantize(data, 256, { format: 'rgba4444', oneBitAlpha: true, clearAlpha: true, clearAlphaThreshold: 128 });
      const index = applyPalette(data, palette, 'rgba4444');
      const transparentIndex = palette.findIndex((color) => color[3] === 0);
      gif.writeFrame(index, width, height, { palette, delay, repeat: i === 0 ? 0 : undefined, transparent: transparentIndex >= 0, transparentIndex: Math.max(0, transparentIndex), dispose: 2 });
    } else {
      const palette = quantize(data, 256);
      gif.writeFrame(applyPalette(data, palette), width, height, { palette, delay, repeat: i === 0 ? 0 : undefined });
    }
  });
  gif.finish();
  return gif.bytes();
}
