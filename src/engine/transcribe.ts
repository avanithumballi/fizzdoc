// Audio or video to text and subtitles, on this device. The browser decodes the file's sound track,
// and Whisper (transcribe-worker.ts) turns it into timed text. Loaded only on the Audio to Text page.
import { LocalError, type Output } from './local';
import type { FromTranscriber, ToTranscriber } from './transcribe-worker';

export type CaptionFormat = 'txt' | 'srt' | 'vtt';
export interface Cue {
  start: number;
  end: number;
  text: string;
}

const RATE = 16000; // what Whisper listens at

/** The file's sound as 16 kHz mono samples, decoded by the browser (MP3, M4A, WAV, OGG, MP4, WebM…). */
export async function decodeAudio(file: File): Promise<Float32Array> {
  const context = new OfflineAudioContext(1, 1, RATE);
  let decoded: AudioBuffer;
  try {
    decoded = await context.decodeAudioData(await file.arrayBuffer());
  } catch {
    throw new LocalError('NO_AUDIO_TRACK');
  }
  if (decoded.numberOfChannels === 1) return decoded.getChannelData(0);
  const mono = new Float32Array(decoded.length);
  for (let c = 0; c < decoded.numberOfChannels; c++) {
    const channel = decoded.getChannelData(c);
    for (let i = 0; i < mono.length; i++) mono[i] += channel[i] / decoded.numberOfChannels;
  }
  return mono;
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');
/** 3725.5 → "01:02:05,500" (SRT) or "01:02:05.500" (VTT). */
export function stamp(seconds: number, separator: ',' | '.') {
  const ms = Math.round(Math.max(0, seconds) * 1000);
  return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}${separator}${pad(ms % 1000, 3)}`;
}

/** Subtitles or plain text from timed pieces; empty pieces are skipped. */
export function captions(cues: Cue[], format: CaptionFormat) {
  const kept = cues.map((cue) => ({ ...cue, text: cue.text.trim() })).filter((cue) => cue.text);
  if (format === 'txt') return `${kept.map((cue) => cue.text).join(' ').replace(/\s+/g, ' ').trim()}\n`;
  const separator = format === 'srt' ? ',' : '.';
  const blocks = kept.map(
    (cue, i) => `${format === 'srt' ? `${i + 1}\n` : ''}${stamp(cue.start, separator)} --> ${stamp(cue.end, separator)}\n${cue.text}`,
  );
  return `${format === 'vtt' ? 'WEBVTT\n\n' : ''}${blocks.join('\n\n')}\n`;
}

export interface TranscribeOptions {
  format: CaptionFormat;
  /** Whisper language name such as "english" or "hindi"; null detects it. */
  language: string | null;
  /** First-run download of the speech model: bytes so far and in total. */
  onSetup?: (loaded: number, total: number) => void;
  onProgress?: (fraction: number) => void;
}

export async function transcribe(file: File, options: TranscribeOptions): Promise<Output> {
  const audio = await decodeAudio(file);
  if (audio.length < RATE / 2) throw new LocalError('NO_SPEECH');
  const duration = audio.length / RATE;
  const worker = new Worker(new URL('./transcribe-worker.ts', import.meta.url), { type: 'module' });
  try {
    const result = await new Promise<Extract<FromTranscriber, { type: 'done' }>>((resolve, reject) => {
      worker.onmessage = ({ data }: MessageEvent<FromTranscriber>) => {
        if (data.type === 'setup') options.onSetup?.(data.loaded, data.total);
        else if (data.type === 'progress') options.onProgress?.(data.fraction);
        else if (data.type === 'done') resolve(data);
        else reject(new LocalError(data.code));
      };
      worker.onerror = () => reject(new LocalError('SETUP_FAILED'));
      worker.postMessage({ type: 'run', audio, language: options.language } satisfies ToTranscriber, [audio.buffer]);
    });
    if (!result.text) throw new LocalError('NO_SPEECH');
    const cues = result.chunks.map(({ timestamp: [start, end], text }) => ({ start, end: end ?? duration, text }));
    const text = captions(cues.length ? cues : [{ start: 0, end: duration, text: result.text }], options.format);
    const base = file.name.replace(/\.[^.]+$/, '') || 'transcript';
    const type = { txt: 'text/plain', srt: 'application/x-subrip', vtt: 'text/vtt' }[options.format];
    const words = result.text.split(/\s+/).filter(Boolean).length;
    return {
      blob: new Blob([text], { type: `${type};charset=utf-8` }),
      name: `${base}.${options.format}`,
      summary: `${options.format.toUpperCase()} · ${words} words`,
    };
  } finally {
    worker.terminate();
  }
}
