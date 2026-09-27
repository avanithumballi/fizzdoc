// Lossless cutting and joining for MP3 and M4A. MP3 is cut at frame boundaries; M4A (AAC or ALAC in
// an MP4 box structure) is re-packaged sample by sample. Nothing is re-encoded, so quality is untouched
// and it works the same in every browser. Tags (title, artist, cover art) are not carried over.

export class AudioError extends Error {
  constructor(
    readonly code: 'AUDIO_UNSUPPORTED' | 'AUDIO_MIXED' | 'AUDIO_MISMATCH' | 'AUDIO_EMPTY',
    readonly detail = '',
  ) {
    super(code);
  }
}

export interface Frame {
  offset: number;
  size: number;
  /** Start time in seconds. */
  time: number;
  duration: number;
  /** M4A only: duration in the track's timescale, as written back to the file. */
  units?: number;
}

export interface Track {
  kind: 'mp3' | 'm4a';
  bytes: Uint8Array;
  frames: Frame[];
  duration: number;
  sampleRate: number;
  channels: number;
  /** M4A only: the sample description box, its timescale and a codec fingerprint for joining. */
  m4a?: { stsd: Uint8Array; timescale: number; codec: string };
}

// ---------------------------------------------------------------------------------------------
// MP3
// ---------------------------------------------------------------------------------------------

const KBPS: Record<string, number[]> = {
  v1l1: [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  v1l2: [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  v1l3: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  v2l1: [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  v2l23: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const RATES = [[11025, 12000, 8000], [], [22050, 24000, 16000], [44100, 48000, 32000]];

/** Decodes the MPEG audio frame header at `i`, or null when there isn't one. */
export function mp3Header(b: Uint8Array, i: number) {
  if (i + 4 > b.length || b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) return null;
  const version = (b[i + 1] >> 3) & 3; // 0: MPEG 2.5, 2: MPEG 2, 3: MPEG 1
  const layer = (b[i + 1] >> 1) & 3; // 1: III, 2: II, 3: I
  const index = b[i + 2] >> 4;
  const rateIndex = (b[i + 2] >> 2) & 3;
  if (version === 1 || layer === 0 || index === 0 || index === 15 || rateIndex === 3) return null;
  const v1 = version === 3;
  const table = v1 ? ['', 'v1l3', 'v1l2', 'v1l1'][layer] : layer === 3 ? 'v2l1' : 'v2l23';
  const bitrate = KBPS[table][index] * 1000;
  const sampleRate = RATES[version][rateIndex];
  const samples = layer === 3 ? 384 : layer === 2 || v1 ? 1152 : 576;
  const padding = (b[i + 2] >> 1) & 1;
  const size = layer === 3 ? (Math.floor((12 * bitrate) / sampleRate) + padding) * 4 : Math.floor((samples / 8) * bitrate / sampleRate) + padding;
  return { size, samples, sampleRate, channels: b[i + 3] >> 6 === 3 ? 1 : 2 };
}

const ascii = (b: Uint8Array, at: number, length: number) => String.fromCharCode(...b.subarray(at, at + length));

function parseMp3(bytes: Uint8Array): Track | null {
  let start = 0;
  // ID3v2 tags (possibly several) sit in front of the audio.
  while (ascii(bytes, start, 3) === 'ID3' && start + 10 <= bytes.length) {
    const size = ((bytes[start + 6] & 0x7f) << 21) | ((bytes[start + 7] & 0x7f) << 14) | ((bytes[start + 8] & 0x7f) << 7) | (bytes[start + 9] & 0x7f);
    start += 10 + size + (bytes[start + 5] & 0x10 ? 10 : 0);
  }
  const end = bytes.length >= 128 && ascii(bytes, bytes.length - 128, 3) === 'TAG' ? bytes.length - 128 : bytes.length;
  const frames: Frame[] = [];
  let time = 0;
  let sampleRate = 0;
  let channels = 0;
  for (let i = start; i < end; ) {
    const h = mp3Header(bytes, i);
    // A real frame is followed by another one (or the end), which rules out stray 0xFF bytes.
    if (!h || h.size < 5 || i + h.size > end || (i + h.size < end - 4 && !mp3Header(bytes, i + h.size))) {
      i++;
      continue;
    }
    // The first frame may be a Xing/Info/VBRI header describing the old file: drop it.
    const info = !frames.length && (/Xing|Info/.test(ascii(bytes, i + 4, 40)) || ascii(bytes, i + 36, 4) === 'VBRI');
    if (!info && (!sampleRate || h.sampleRate === sampleRate)) {
      sampleRate ||= h.sampleRate;
      channels ||= h.channels;
      frames.push({ offset: i, size: h.size, time, duration: h.samples / h.sampleRate });
      time += h.samples / h.sampleRate;
    }
    i += h.size;
  }
  return frames.length > 3 ? { kind: 'mp3', bytes, frames, duration: time, sampleRate, channels } : null;
}

// ---------------------------------------------------------------------------------------------
// M4A (MP4 box structure)
// ---------------------------------------------------------------------------------------------

interface Box {
  type: string;
  /** First byte after the header. */
  start: number;
  end: number;
  /** First byte of the header, for copying whole boxes. */
  at: number;
}

function children(b: Uint8Array, start: number, end: number): Box[] {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const list: Box[] = [];
  for (let at = start; at + 8 <= end; ) {
    let size = view.getUint32(at);
    let header = 8;
    if (size === 1) {
      size = Number(view.getBigUint64(at + 8));
      header = 16;
    } else if (size === 0) size = end - at;
    if (size < header || at + size > end) break;
    list.push({ type: ascii(b, at + 4, 4), start: at + header, end: at + size, at });
    at += size;
  }
  return list;
}

const child = (b: Uint8Array, box: Box | undefined, type: string) => (box ? children(b, box.start, box.end).find((c) => c.type === type) : undefined);

/** Walks a path of box types, e.g. ['mdia', 'minf', 'stbl']. */
const path = (b: Uint8Array, box: Box | undefined, types: string[]) => types.reduce<Box | undefined>((at, type) => child(b, at, type), box);

/** The AudioSpecificConfig inside an esds box (the bytes that must match for two files to be joined). */
function codecOf(b: Uint8Array, stsd: Box): string {
  const entry = children(b, stsd.start + 8, stsd.end)[0];
  if (!entry) return '';
  const fourcc = entry.type;
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const channels = view.getUint16(entry.start + 16);
  const rate = view.getUint32(entry.start + 24) >>> 16;
  let config = '';
  const esds = children(b, entry.start + 28, entry.end).find((c) => c.type === 'esds');
  if (esds) {
    // ES_Descriptor (3) > DecoderConfigDescriptor (4) > DecoderSpecificInfo (5); lengths are 7-bit varints.
    for (let i = esds.start + 4; i < esds.end - 1; ) {
      const tag = b[i++];
      let length = 0;
      for (let n = 0; n < 4; n++) {
        const byte = b[i++];
        length = (length << 7) | (byte & 0x7f);
        if (!(byte & 0x80)) break;
      }
      if (tag === 3) i += 3; // ES_ID + flags
      else if (tag === 4) i += 13; // objectType, streamType, buffer size, bitrates
      else if (tag === 5) {
        config = [...b.subarray(i, i + length)].map((x) => x.toString(16).padStart(2, '0')).join('');
        break;
      } else i += length;
    }
  }
  return `${fourcc}/${channels}/${rate}/${config}`;
}

function parseM4a(bytes: Uint8Array): Track | null {
  const top = children(bytes, 0, bytes.length);
  if (top[0]?.type !== 'ftyp') return null;
  const moov = top.find((box) => box.type === 'moov');
  if (!moov) throw new AudioError('AUDIO_UNSUPPORTED');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const trak = children(bytes, moov.start, moov.end)
    .filter((box) => box.type === 'trak')
    .find((box) => {
      const hdlr = path(bytes, box, ['mdia', 'hdlr']);
      return hdlr && ascii(bytes, hdlr.start + 8, 4) === 'soun';
    });
  const mdhd = path(bytes, trak, ['mdia', 'mdhd']);
  const stbl = path(bytes, trak, ['mdia', 'minf', 'stbl']);
  const box = (type: string) => child(bytes, stbl, type);
  const [stsd, stts, stsc, stsz] = ['stsd', 'stts', 'stsc', 'stsz'].map(box);
  const stco = box('stco') ?? box('co64');
  // Fragmented files (some recorders write these) keep their samples elsewhere.
  if (!mdhd || !stsd || !stts || !stsc || !stsz || !stco) throw new AudioError('AUDIO_UNSUPPORTED');
  const timescale = view.getUint32(mdhd.start + (bytes[mdhd.start] === 1 ? 20 : 12));

  const durations: number[] = [];
  for (let i = 0, n = view.getUint32(stts.start + 4); i < n; i++) {
    const count = view.getUint32(stts.start + 8 + i * 8);
    const delta = view.getUint32(stts.start + 12 + i * 8);
    for (let k = 0; k < count; k++) durations.push(delta);
  }
  const fixedSize = view.getUint32(stsz.start + 4);
  const count = view.getUint32(stsz.start + 8);
  const sizes = Array.from({ length: count }, (_, i) => fixedSize || view.getUint32(stsz.start + 12 + i * 4));
  const wide = stco.type === 'co64';
  const offsets = Array.from({ length: view.getUint32(stco.start + 4) }, (_, i) =>
    wide ? Number(view.getBigUint64(stco.start + 8 + i * 8)) : view.getUint32(stco.start + 8 + i * 4),
  );
  const runs = Array.from({ length: view.getUint32(stsc.start + 4) }, (_, i) => ({
    first: view.getUint32(stsc.start + 8 + i * 12) - 1,
    perChunk: view.getUint32(stsc.start + 12 + i * 12),
  }));
  if (!count || !offsets.length || !runs.length) throw new AudioError('AUDIO_UNSUPPORTED');

  const frames: Frame[] = [];
  let sample = 0;
  let time = 0;
  for (let chunk = 0; chunk < offsets.length && sample < count; chunk++) {
    const run = runs.findLast((r) => r.first <= chunk) ?? runs[0];
    let offset = offsets[chunk];
    for (let k = 0; k < run.perChunk && sample < count; k++, sample++) {
      const units = durations[sample] ?? durations[durations.length - 1];
      if (offset + sizes[sample] > bytes.length) throw new AudioError('AUDIO_UNSUPPORTED');
      frames.push({ offset, size: sizes[sample], time, duration: units / timescale, units });
      offset += sizes[sample];
      time += units / timescale;
    }
  }
  const codec = codecOf(bytes, stsd);
  const [, channels, rate] = codec.split('/');
  return {
    kind: 'm4a',
    bytes,
    frames,
    duration: time,
    sampleRate: Number(rate) || timescale,
    channels: Number(channels) || 2,
    m4a: { stsd: bytes.slice(stsd.at, stsd.end), timescale, codec },
  };
}

// ---- writing ----

const u32 = (n: number) => new Uint8Array([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
const u16 = (n: number) => new Uint8Array([n >>> 8, n & 255]);
const text = (s: string) => new TextEncoder().encode(s);
const zeros = (n: number) => new Uint8Array(n);

function concat(parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

const box = (type: string, ...parts: Uint8Array[]) => {
  const body = concat(parts);
  return concat([u32(body.length + 8), text(type), body]);
};
const full = (type: string, flags: number, ...parts: Uint8Array[]) => box(type, u32(flags), ...parts);
const MATRIX = concat([u32(0x10000), u32(0), u32(0), u32(0), u32(0x10000), u32(0), u32(0), u32(0), u32(0x40000000)]);

/** A plain (non-fragmented) M4A with every sample in one chunk and the index up front. */
function writeM4a(stsd: Uint8Array, timescale: number, samples: { data: Uint8Array; duration: number }[]) {
  const total = samples.reduce((sum, s) => sum + s.duration, 0);
  const stts: Uint8Array[] = [];
  let runs = 0;
  for (let i = 0; i < samples.length; ) {
    let j = i;
    while (j < samples.length && samples[j].duration === samples[i].duration) j++;
    stts.push(u32(j - i), u32(samples[i].duration));
    runs++;
    i = j;
  }
  const moov = (offset: number) =>
    box(
      'moov',
      full('mvhd', 0, u32(0), u32(0), u32(timescale), u32(total), u32(0x10000), u16(0x100), zeros(10), MATRIX, zeros(24), u32(2)),
      box(
        'trak',
        full('tkhd', 3, u32(0), u32(0), u32(1), u32(0), u32(total), zeros(8), u16(0), u16(0), u16(0x100), u16(0), MATRIX, u32(0), u32(0)),
        box(
          'mdia',
          full('mdhd', 0, u32(0), u32(0), u32(timescale), u32(total), u16(0x55c4), u16(0)),
          full('hdlr', 0, u32(0), text('soun'), zeros(12), text('SoundHandler\0')),
          box(
            'minf',
            full('smhd', 0, u16(0), u16(0)),
            box('dinf', full('dref', 0, u32(1), full('url ', 1))),
            box(
              'stbl',
              stsd,
              full('stts', 0, u32(runs), ...stts),
              full('stsc', 0, u32(1), u32(1), u32(samples.length), u32(1)),
              full('stsz', 0, u32(0), u32(samples.length), ...samples.map((s) => u32(s.data.length))),
              full('stco', 0, u32(1), u32(offset)),
            ),
          ),
        ),
      ),
    );
  const ftyp = box('ftyp', text('M4A '), u32(0), text('M4A '), text('mp42'), text('isom'));
  const size = moov(0).length;
  const mdat = samples.map((s) => s.data);
  const mdatSize = mdat.reduce((sum, d) => sum + d.length, 0) + 8;
  return concat([ftyp, moov(ftyp.length + size + 8), u32(mdatSize), text('mdat'), ...mdat]);
}

// ---------------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------------

export function parseAudio(bytes: Uint8Array): Track {
  const track = parseM4a(bytes) ?? parseMp3(bytes);
  if (!track) throw new AudioError('AUDIO_UNSUPPORTED');
  return track;
}

/** The frames of several tracks (or parts of them), written as one file of the tracks' kind. */
export function write(parts: { track: Track; frames: Frame[] }[]): Blob {
  const first = parts[0]?.track;
  if (!first || !parts.some((p) => p.frames.length)) throw new AudioError('AUDIO_EMPTY');
  if (parts.some((p) => p.track.kind !== first.kind)) throw new AudioError('AUDIO_MIXED');
  const key = (t: Track) => (t.m4a ? t.m4a.codec : `${t.sampleRate}`);
  const odd = parts.find((p) => key(p.track) !== key(first));
  if (odd) throw new AudioError('AUDIO_MISMATCH', `${first.sampleRate / 1000} kHz / ${odd.track.sampleRate / 1000} kHz`);
  const samples = parts.flatMap(({ track, frames }) =>
    frames.map((f) => ({ data: track.bytes.subarray(f.offset, f.offset + f.size), duration: f.units ?? 0 })),
  );
  if (first.kind === 'mp3') return new Blob(samples.map((s) => s.data as Uint8Array<ArrayBuffer>), { type: 'audio/mpeg' });
  const { stsd, timescale } = first.m4a!;
  return new Blob([writeM4a(stsd, timescale, samples) as Uint8Array<ArrayBuffer>], { type: 'audio/mp4' });
}

/** Frames that start inside [start, end) seconds. */
export const framesBetween = (track: Track, start: number, end: number) =>
  track.frames.filter((f) => f.time + f.duration / 2 > start && f.time + f.duration / 2 <= end);

export const extension = (track: Track) => (track.kind === 'mp3' ? 'mp3' : 'm4a');

/** "1:05:03.2", "4:07.5" — how durations and cut points are shown and typed. */
export function formatTime(seconds: number, tenths = true) {
  const s = Math.max(0, seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const secText = tenths ? sec.toFixed(1).padStart(4, '0') : String(Math.floor(sec)).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${secText}` : `${m}:${secText}`;
}

/** Reads "1:05:03.2", "4:07", "90" or "90.5" as seconds; NaN when it isn't a time. */
export function parseTime(value: string) {
  const parts = value.trim().replace(',', '.').split(':');
  if (parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return NaN;
  return parts.reduce((sum, p) => sum * 60 + Number(p), 0);
}

/** Loudness peaks (0..1) at `perSecond` resolution, decoded ~15 s at a time so long files stay light. */
export async function peaks(track: Track, perSecond = 20, onProgress?: (fraction: number) => void): Promise<Float32Array> {
  const out = new Float32Array(Math.ceil(track.duration * perSecond) + 1);
  const context = new OfflineAudioContext(1, 1, 44100);
  for (let start = 0; start < track.duration; start += 15) {
    const frames = framesBetween(track, start, start + 15);
    if (!frames.length) continue;
    try {
      const buffer = await context.decodeAudioData(await write([{ track, frames }]).arrayBuffer());
      const data = buffer.getChannelData(0);
      const step = buffer.sampleRate / perSecond;
      const base = Math.round(frames[0].time * perSecond);
      for (let bin = 0; bin * step < data.length && base + bin < out.length; bin++) {
        let max = 0;
        for (let i = Math.floor(bin * step), stop = Math.min(data.length, (bin + 1) * step); i < stop; i++) max = Math.max(max, Math.abs(data[i]));
        out[base + bin] = max;
      }
    } catch {
      // A chunk the browser can't decode just shows as flat; cutting still works.
    }
    onProgress?.(Math.min(1, (start + 15) / track.duration));
  }
  return out;
}
