// Mermaid code to an SVG or PNG image, drawn by the Mermaid library right in the page. Loaded only on
// the Mermaid page, and nothing is fetched: the diagram, the fonts and the image all stay local.
import mermaid from 'mermaid';
import { LocalError, type Output } from './local';

export type Theme = 'default' | 'neutral' | 'dark' | 'forest';

export interface MermaidOptions {
  format: 'png' | 'svg';
  /** PNG pixels per diagram unit: 2 is sharp on most screens. */
  scale: number;
  theme: Theme;
  transparent: boolean;
}

// Mermaid's dark theme draws light lines and text, so its background has to stay dark.
const BACKGROUND: Record<Theme, string> = { default: '#ffffff', neutral: '#ffffff', forest: '#ffffff', dark: '#333333' };
const MAX_PIXELS = 100_000_000;
let renders = 0;

/** Mermaid's own message, cut to what is wrong and where ("Parse error on line 3: … got 'EOF'"). */
function firstLines(error: unknown) {
  const lines = String(error instanceof Error ? error.message : error)
    .split('\n')
    .map((line) => line.trim())
    // Drop the code excerpt and its ---^ pointer: they only make sense in a monospaced block.
    .filter((line) => line && !/^[-^\s]+$/.test(line) && !line.startsWith('...'));
  const got = /got '([^']*)'/.exec(lines.join(' '))?.[0];
  return [lines[0], got && !lines[0].includes(got) ? got : ''].filter(Boolean).join(' ').slice(0, 240);
}

/** Renders the diagram and returns standalone SVG text with a real width and height. */
export async function renderSvg(code: string, theme: Theme, transparent: boolean) {
  if (!code.trim()) throw new LocalError('NO_DIAGRAM');
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict', // no scripts, no click handlers, sanitized labels
    theme,
    // Plain SVG text instead of HTML labels, so the image can be drawn onto a canvas for PNG.
    htmlLabels: false,
    flowchart: { htmlLabels: false },
    // Gantt charts otherwise take the width of the screen, so a phone would export a cramped chart.
    gantt: { useWidth: 1200 },
  });
  let svg: string;
  try {
    ({ svg } = await mermaid.render(`fizzdoc-diagram-${++renders}`, code));
  } catch (error) {
    throw new LocalError('BAD_DIAGRAM', { detail: firstLines(error) });
  }
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = doc.documentElement;
  const [x, y, width, height] = (root.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
  if (!(width > 0 && height > 0)) throw new LocalError('BAD_DIAGRAM', { detail: 'The diagram has no size.' });
  // Mermaid sizes the SVG to its container; a file needs its own size.
  root.setAttribute('width', String(Math.ceil(width)));
  root.setAttribute('height', String(Math.ceil(height)));
  root.style.removeProperty('max-width');
  if (!root.getAttribute('style')) root.removeAttribute('style');
  if (!transparent) {
    const rect = doc.createElementNS('http://www.w3.org/2000/svg', 'rect');
    for (const [name, value] of Object.entries({ x, y, width, height, fill: BACKGROUND[theme] })) rect.setAttribute(name, String(value));
    root.insertBefore(rect, root.firstChild);
  }
  return { svg: new XMLSerializer().serializeToString(doc), width, height };
}

async function toPng(svg: string, width: number, height: number, scale: number) {
  const w = Math.ceil(width * scale);
  const h = Math.ceil(height * scale);
  if (w * h > MAX_PIXELS) throw new LocalError('TOO_LARGE');
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = Object.assign(document.createElement('canvas'), { width: w, height: h });
    canvas.getContext('2d')!.drawImage(image, 0, 0, w, h);
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!png) throw new LocalError('TOO_LARGE');
    return { png, w, h };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function mermaidToImage(code: string, options: MermaidOptions, name = 'diagram'): Promise<Output> {
  const { svg, width, height } = await renderSvg(code, options.theme, options.transparent);
  const base = name.replace(/\.[^.]+$/, '') || 'diagram';
  if (options.format === 'svg') {
    return { blob: new Blob([svg], { type: 'image/svg+xml' }), name: `${base}.svg`, summary: `SVG · ${Math.ceil(width)} × ${Math.ceil(height)}` };
  }
  // A few diagram types (user journeys) still use HTML labels, which a browser won't let a page turn
  // into PNG pixels. Those are saved as SVG, with a note, rather than failing.
  if (svg.includes('<foreignObject')) {
    return {
      blob: new Blob([svg], { type: 'image/svg+xml' }),
      name: `${base}.svg`,
      summary: `SVG · ${Math.ceil(width)} × ${Math.ceil(height)}`,
      notes: ['mermaid.svgOnly'],
    };
  }
  const { png, w, h } = await toPng(svg, width, height, options.scale);
  return { blob: png, name: `${base}.png`, summary: `PNG · ${w} × ${h} px` };
}
