import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { captions, stamp } from '../src/engine/transcribe';
import { SPEECH_MODEL_MB } from '../src/seo';

const cues = [
  { start: 0, end: 2.5, text: ' Hello there. ' },
  { start: 2.5, end: 3725.5, text: 'A long pause.' },
  { start: 3725.5, end: 3726, text: '   ' },
];

describe('captions', () => {
  it('formats SRT and VTT timestamps', () => {
    expect(stamp(3725.5, ',')).toBe('01:02:05,500');
    expect(stamp(0.0004, '.')).toBe('00:00:00.000');
    expect(stamp(-1, ',')).toBe('00:00:00,000');
  });

  it('writes numbered SRT cues and skips empty ones', () => {
    expect(captions(cues, 'srt')).toBe('1\n00:00:00,000 --> 00:00:02,500\nHello there.\n\n2\n00:00:02,500 --> 01:02:05,500\nA long pause.\n');
  });

  it('writes WebVTT with its header and no numbers', () => {
    expect(captions(cues, 'vtt')).toBe('WEBVTT\n\n00:00:00.000 --> 00:00:02.500\nHello there.\n\n00:00:02.500 --> 01:02:05.500\nA long pause.\n');
  });

  it('joins plain text into one paragraph', () => {
    expect(captions(cues, 'txt')).toBe('Hello there. A long pause.\n');
  });
});

describe('speech model files', () => {
  const dir = new URL('../public/whisper/whisper-tiny/', import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', dir), 'utf8')) as { files: { path: string; size: number; parts: string[] }[] };

  it('keeps every part under the 25 MiB static hosting limit, and the parts add up', () => {
    for (const file of manifest.files) {
      const sizes = file.parts.map((part) => readFileSync(new URL(part, dir)).length);
      for (const size of sizes) expect(size, file.path).toBeLessThan(25 * 1024 * 1024);
      expect(sizes.reduce((a, b) => a + b, 0), file.path).toBe(file.size);
    }
  });

  it('states the one-time download size truthfully', () => {
    // Model files plus ONNX Runtime's 14.3 MB WebAssembly build.
    const total = manifest.files.reduce((sum, file) => sum + file.size, 0) + 14_264_838;
    expect(Math.round(total / 1e6)).toBe(SPEECH_MODEL_MB);
  });
});
