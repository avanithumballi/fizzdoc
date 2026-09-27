import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AudioError, formatTime, framesBetween, parseAudio, parseTime, write } from '../src/engine/audio';

const load = (name: string) => parseAudio(new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url))));
const reparse = async (blob: Blob) => parseAudio(new Uint8Array(await blob.arrayBuffer()));

describe('parseAudio', () => {
  it('reads MP3 and M4A durations and formats', () => {
    const mp3 = load('tone.mp3');
    expect(mp3).toMatchObject({ kind: 'mp3', sampleRate: 44100, channels: 1 });
    expect(mp3.duration).toBeCloseTo(6, 0);
    const m4a = load('tone.m4a');
    expect(m4a).toMatchObject({ kind: 'm4a', sampleRate: 44100, channels: 1 });
    expect(m4a.duration).toBeCloseTo(6, 0);
  });

  it('rejects files that are not MP3 or M4A', () => {
    expect(() => parseAudio(new TextEncoder().encode('just some text, not audio at all'))).toThrow(AudioError);
    expect(() => parseAudio(new Uint8Array(readFileSync(new URL('./fixtures/photo.jpg', import.meta.url))))).toThrow(AudioError);
  });
});

describe('cutting and joining', () => {
  for (const name of ['tone.mp3', 'tone.m4a']) {
    it(`cuts ${name} into pieces that add back up, without re-encoding`, async () => {
      const track = load(name);
      const first = await reparse(write([{ track, frames: framesBetween(track, 0, 2.5) }]));
      const rest = await reparse(write([{ track, frames: framesBetween(track, 2.5, track.duration) }]));
      expect(first.kind).toBe(track.kind);
      expect(first.duration).toBeCloseTo(2.5, 1);
      expect(first.duration + rest.duration).toBeCloseTo(track.duration, 2);
      // The first piece is byte-for-byte the original frames.
      const original = track.frames[0];
      expect(first.bytes.subarray(first.frames[0].offset, first.frames[0].offset + original.size)).toEqual(
        track.bytes.subarray(original.offset, original.offset + original.size),
      );
    });

    it(`joins ${name} files end to end`, async () => {
      const track = load(name);
      const joined = await reparse(write([{ track, frames: track.frames }, { track, frames: track.frames }]));
      expect(joined.duration).toBeCloseTo(track.duration * 2, 2);
    });
  }

  it('explains why some files cannot be joined', () => {
    const mp3 = load('tone.mp3');
    expect(() => write([{ track: mp3, frames: mp3.frames }, { track: load('tone.m4a'), frames: [] }])).toThrow('AUDIO_MIXED');
    expect(() => write([{ track: mp3, frames: mp3.frames }, { track: load('tone-48k.mp3'), frames: [] }])).toThrow('AUDIO_MISMATCH');
    expect(() => write([{ track: mp3, frames: [] }])).toThrow('AUDIO_EMPTY');
  });
});

describe('times', () => {
  it('formats and reads timestamps the way people type them', () => {
    expect(formatTime(0)).toBe('0:00.0');
    expect(formatTime(247.5)).toBe('4:07.5');
    expect(formatTime(3903.2)).toBe('1:05:03.2');
    expect(parseTime('4:07.5')).toBe(247.5);
    expect(parseTime('1:05:03')).toBe(3903);
    expect(parseTime('90')).toBe(90);
    expect(parseTime('1,5')).toBe(1.5);
    expect(parseTime('abc')).toBeNaN();
    expect(parseTime('1:2:3:4')).toBeNaN();
  });
});
