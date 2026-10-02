// Draws the social preview cards from the built home pages, so they always match the site:
// public/og.png and public/og/<lang>.png (1200×630) plus docs/assets/social-preview.png (1280×640,
// the image GitHub shows for the repo). Run after `npm run build`: node scripts/og-images.mjs
import { chromium } from '@playwright/test';
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = new URL('../', import.meta.url);
const dist = new URL('dist/', root);
const icon = readFileSync(new URL('public/icon.svg', root), 'utf8');
const font = new URL('node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2', root).href;
const COLORS = { pdf: '#e5322d', word: '#2f6fdb', excel: '#1d9a5b', powerpoint: '#e0632a', image: '#8b5cf6', audio: '#db2777' };
const CHIPS = [['PDF', 'pdf'], ['DOC', 'word'], ['XLS', 'excel'], ['PPT', 'powerpoint'], ['IMG', 'image'], ['MP3', 'audio'], ['{ }', 'excel'], ['MMD', 'image']];
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"');

function read(lang) {
  const html = readFileSync(new URL(`${lang ? `${lang}/` : ''}index.html`, dist), 'utf8');
  const h1 = decode(/<h1>([^<]*)<\/h1>/.exec(html)[1]);
  const eyebrow = decode(/class="eyebrow"><span[^>]*><\/span>([^<]*)</.exec(html)[1]);
  // English cards lead with the tool count; other languages keep their own eyebrow wording.
  const tools = lang ? undefined : /Browse all (\d+) tools/.exec(html)?.[1];
  return { h1, eyebrow, tools };
}

function card({ h1, eyebrow, tools }, width, height, extra) {
  return `<!doctype html><meta charset="utf-8"><style>
  @font-face { font-family: Inter; src: url(${font}) format('woff2'); font-weight: 100 900; }
  * { margin: 0; box-sizing: border-box; }
  body { width: ${width}px; height: ${height}px; overflow: hidden; font-family: Inter, 'Noto Sans', 'Noto Sans Devanagari', 'Noto Sans Bengali', 'Noto Sans Tamil', 'Noto Sans Telugu', system-ui, sans-serif;
    color: #fff; background: radial-gradient(900px 500px at 85% -10%, #3b1114 0%, transparent 60%), radial-gradient(700px 420px at -5% 110%, #0c1e3a 0%, transparent 60%), #0a0a0d;
    padding: 0 ${width * 0.075}px; display: flex; flex-direction: column; justify-content: center; }
  .brand { display: flex; align-items: center; gap: 18px; font-size: 34px; font-weight: 700; }
  .brand svg { width: 58px; height: 58px; }
  h1 { margin: 34px 0 30px; font-size: ${extra ? 64 : 60}px; line-height: 1.12; font-weight: 800; letter-spacing: -0.02em; max-width: ${width * 0.85}px; }
  .sub { font-size: 28px; color: #a1a1aa; margin: -10px 0 30px; }
  .row { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
  .chip { font-size: 22px; font-weight: 700; padding: 9px 15px; border-radius: 10px; }
  .meta { margin-top: 26px; font-size: 24px; color: #a1a1aa; }
  .meta b { color: #e4e4e7; font-weight: 600; }
  </style><body>
  <div class="brand">${icon}<span>Fizzdoc</span></div>
  <h1>${esc(h1)}</h1>
  ${extra ? `<p class="sub">${esc(extra)}</p>` : ''}
  <div class="row">${CHIPS.map(([text, fmt]) => `<span class="chip" style="background:${COLORS[fmt]}">${esc(text)}</span>`).join('')}</div>
  <p class="meta">${tools ? `<b>${tools} tools</b> · ` : ''}${esc(eyebrow)}</p>
  </body>`;
}

const langs = ['', ...readdirSync(dist, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(new URL(`${d.name}/index.html`, dist)) && /^[a-z]{2}$/.test(d.name)).map((d) => d.name)];
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
async function shoot(html, width, height, out) {
  // A real file page, so the card can load the Inter font from node_modules.
  const file = join(tmpdir(), `fizzdoc-og-${process.pid}.html`);
  writeFileSync(file, html);
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto(pathToFileURL(file).href, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: new URL(out, root).pathname });
  await page.close();
}
for (const lang of langs) await shoot(card(read(lang), 1200, 630), 1200, 630, lang ? `public/og/${lang}.png` : 'public/og.png');
await shoot(card(read(''), 1280, 640, 'Edit, convert, redact, OCR and transcribe — 100% in your browser'), 1280, 640, 'docs/assets/social-preview.png');
await browser.close();
console.log(`Drew ${langs.length + 1} cards.`);
