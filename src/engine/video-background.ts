// Video background removal: every frame goes through the same model as photos, gets its new
// backdrop, and is encoded again by the browser (WebCodecs, through Mediabunny, MPL-2.0). The
// sound is carried over. Loaded only on the Remove Background pages, and only for videos.
import { ALL_FORMATS, BlobSource, BufferTarget, CanvasSink, Conversion, Input, Mp4OutputFormat, Output, QUALITY_HIGH, WebMOutputFormat, canEncodeVideo } from 'mediabunny';
import { compose, removeBackground, type Backdrop } from './background';
import { LocalError } from './local';

export interface VideoInfo {
  width: number;
  height: number;
  duration: number;
  /** The first frame, upright, at full size. */
  first: ImageBitmap;
}

const open = (file: File) => new Input({ source: new BlobSource(file), formats: ALL_FORMATS });

export async function videoInfo(file: File): Promise<VideoInfo> {
  const input = open(file);
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) throw new LocalError('BAD_VIDEO');
    const sink = new CanvasSink(track);
    const start = await track.getFirstTimestamp();
    const frame = await sink.getCanvas(start);
    if (!frame) throw new LocalError('BAD_VIDEO');
    return { width: frame.canvas.width, height: frame.canvas.height, duration: await input.computeDuration(), first: await createImageBitmap(frame.canvas) };
  } catch (error) {
    throw error instanceof LocalError ? error : new LocalError('BAD_VIDEO');
  } finally {
    input.dispose();
  }
}

/** Video sizes must be even for most encoders. */
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

export interface VideoJob {
  backdrop: Backdrop;
  width: number;
  height: number;
  onProgress?: (fraction: number) => void;
  onSetup?: (loaded: number, total: number) => void;
}

/** Green-screen green: what "no background" means for a video, ready to key out in any editor. */
export const GREEN_SCREEN = '#00b140';

/**
 * The video with its background replaced. "None" gives a green screen: see-through video needs the
 * encoder library to start helper workers from blob: URLs, which the page's CSP rightly refuses,
 * and most players can't show it anyway.
 */
export async function replaceVideoBackground(file: File, job: VideoJob): Promise<{ blob: Blob; extension: 'mp4' | 'webm' }> {
  const width = even(job.width);
  const height = even(job.height);
  const backdrop: Backdrop = job.backdrop.kind === 'none' ? { kind: 'color', color: GREEN_SCREEN } : job.backdrop;
  // MP4 (H.264) plays everywhere; WebM (VP9) where the browser can't make MP4.
  const mp4 = await canEncodeVideo('avc', { width, height });
  if (!mp4 && !(await canEncodeVideo('vp9', { width, height }))) throw new LocalError('NO_VIDEO_ENCODER');
  const input = open(file);
  const target = new BufferTarget();
  const output = new Output({ format: mp4 ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(), target });
  const canvas = new OffscreenCanvas(width, height);
  const frame = new OffscreenCanvas(1, 1);
  const frameContext = frame.getContext('2d')!;
  try {
    const conversion = await Conversion.init({
      input,
      output,
      video: {
        codec: mp4 ? 'avc' : 'vp9',
        quality: QUALITY_HIGH,
        // Frames arrive upright, so a backdrop photo lines up with what people see.
        allowTransformationMetadata: false,
        forceTranscode: true,
        processedWidth: width,
        processedHeight: height,
        process: async (sample) => {
          frame.width = sample.displayWidth;
          frame.height = sample.displayHeight;
          sample.draw(frameContext, 0, 0);
          const photo = await createImageBitmap(frame);
          const { cutout } = await removeBackground(await createImageBitmap(photo), { fast: true, onSetup: job.onSetup });
          const cut = await createImageBitmap(cutout);
          compose(canvas, cut, photo, backdrop);
          cut.close();
          photo.close();
          return canvas;
        },
      },
    });
    if (!conversion.isValid) throw new LocalError('BAD_VIDEO');
    conversion.onProgress = (progress) => job.onProgress?.(progress);
    await conversion.execute();
    return { blob: new Blob([target.buffer!], { type: mp4 ? 'video/mp4' : 'video/webm' }), extension: mp4 ? 'mp4' : 'webm' };
  } finally {
    input.dispose();
  }
}
