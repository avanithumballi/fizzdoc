// Renders every page of the static site from index.html, plus sitemap.xml, robots.txt and llms.txt.
// Runs in Node (inside the Vite build and dev server), never in the browser.
import { HOME, SITE, TOOLS, type Tool } from './site.ts';

export interface Page {
  path: string;
  tool?: Tool;
}

export const PAGES: Page[] = [{ path: '/' }, ...TOOLS.map((tool) => ({ path: `/${tool.slug}/`, tool }))];

// The page may only talk to its own origin: the privacy promise, enforced by the browser.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "connect-src 'self'",
  "img-src 'self' data: blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const esc = (text: string) =>
  text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const faqHtml = (faq: [string, string][]) => `
<section class="section faq" aria-labelledby="faq">
  <h2 id="faq">Frequently asked questions</h2>
  ${faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('\n  ')}
</section>`;

// 24px stroke icons, one per tool; inherit color from the card.
const ICON_PATHS: Record<Tool['op'], string> = {
  merge: '<path d="M8 3v6a4 4 0 0 0 4 4h0a4 4 0 0 1 4 4v4"/><path d="M16 3v6a4 4 0 0 1-4 4"/><path d="m5 18 3 3 3-3"/>',
  split: '<path d="M12 3v7"/><path d="m8 21 4-11 4 11"/><path d="M5 7h3M16 7h3"/>',
  rotate: '<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/>',
  delete: '<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/>',
  unlock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/>',
};

const icon = (op: Tool['op']) =>
  `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[op]}</svg>`;

// Cards can be tossed around with the mouse; app.ts springs them back into place.
const toolCards = (tools: Tool[]) => `
<ul class="tool-grid">
  ${tools
    .map(
      (t) =>
        `<li><a class="tool-card" data-spring href="/${t.slug}/" draggable="false"><span class="tool-icon tone-${t.op}">${icon(t.op)}</span><strong>${esc(t.name)}</strong><span>${esc(t.summary)}</span></a></li>`,
    )
    .join('\n  ')}
</ul>`;

const proofHtml = `
<section class="section proof" aria-labelledby="proof">
  <h2 id="proof">Private by design — and you can check</h2>
  <ul class="proof-grid">
    <li><strong>No upload step exists</strong><span>Files are read and written by a background worker in this tab. There is no server that could receive them.</span></li>
    <li><strong>The browser enforces it</strong><span>This page’s Content Security Policy only allows connections back to this site, which serves nothing but the app itself.</span></li>
    <li><strong>See for yourself</strong><span>Open developer tools, watch the Network tab and run a job: no request carries your document.</span></li>
    <li><strong>Open source</strong><span>Every line is on <a href="${SITE.repo}">GitHub</a>, built on the proven <a href="https://qpdf.readthedocs.io/">qpdf</a> engine.</span></li>
  </ul>
</section>`;

// Decorative paper sheets beside the home hero; draggable, they spring back when released.
const heroArt = `
<div class="hero-art" aria-hidden="true">
  <div class="sheet sheet-pdf" data-spring><b>PDF</b><i></i><i></i><i></i></div>
  <div class="sheet sheet-doc" data-spring><b>DOC</b><i></i><i></i><i></i></div>
  <div class="sheet sheet-img" data-spring><b>IMG</b><i></i><i></i><i></i></div>
</div>`;

function workspaceHtml(tool: Tool) {
  const pagesField =
    tool.op === 'split'
      ? { label: 'Pages to keep', placeholder: 'e.g. 1-3, 8' }
      : tool.op === 'delete'
        ? { label: 'Pages to delete', placeholder: 'e.g. 2, 7-9' }
        : tool.op === 'rotate'
          ? { label: 'Pages to rotate (optional)', placeholder: 'All pages' }
          : null;
  const multiple = tool.op === 'merge';
  return `
<section class="workspace" aria-label="${esc(tool.name)}">
  <label class="drop" id="drop">
    <input id="file-input" type="file" accept="application/pdf,.pdf"${multiple ? ' multiple' : ''}>
    <span class="drop-icon" aria-hidden="true">+</span>
    <strong>Choose ${multiple ? 'PDF files' : 'a PDF file'}</strong>
    <span>or drop ${multiple ? 'them' : 'it'} here · stays on this device</span>
  </label>
  <ol id="file-list" class="file-list" aria-label="Selected files"></ol>
  ${multiple ? '<p class="hint" id="reorder-hint" hidden>Drag files to reorder, or use the arrows.</p>' : ''}
  <div class="options">
    ${
      tool.op === 'rotate'
        ? `<label>Rotation<select id="angle"><option value="90">90° clockwise</option><option value="180">180°</option><option value="270">90° counter-clockwise</option></select></label>`
        : ''
    }
    ${pagesField ? `<label>${pagesField.label}<input id="pages" placeholder="${pagesField.placeholder}" autocomplete="off" spellcheck="false"></label>` : ''}
  </div>
  ${tool.op === 'unlock' ? '<p class="note">Only unlock files you have the right to modify.</p>' : ''}
  <div class="actions">
    <button id="run" class="button primary" type="button" disabled>${esc(tool.action)}</button>
    <button id="cancel" class="button" type="button" hidden>Cancel</button>
  </div>
  <div id="progress" class="progress" hidden><span></span></div>
  <p id="status" class="status" role="status" aria-live="polite"></p>
  <div id="result" class="result" hidden>
    <a id="download" class="button primary" href="#">Download PDF</a>
    <ul id="warnings" class="warnings"></ul>
  </div>
</section>
<dialog id="password-dialog" aria-labelledby="password-title">
  <form method="dialog">
    <h2 id="password-title">This PDF is password-protected</h2>
    <p id="password-hint">Type its password. It stays on this device.</p>
    <input id="password" type="password" autocomplete="off" aria-labelledby="password-title">
    <div class="actions">
      <button class="button primary" value="ok">Unlock</button>
      <button class="button" value="cancel" formnovalidate>Cancel</button>
    </div>
  </form>
</dialog>`;
}

function mainHtml(page: Page) {
  const tool = page.tool;
  if (!tool) {
    return `
<section class="hero hero-home">
  <div>
    <p class="eyebrow">0 bytes uploaded · Open source · Free</p>
    <h1>${esc(HOME.h1)}</h1>
    <p class="lede">${esc(HOME.lede)}</p>
    <div class="actions"><a class="button primary" href="/merge-pdf/">Merge PDFs</a><a class="button" href="#tools">All tools</a></div>
  </div>
  ${heroArt}
</section>
<section class="section" id="tools" aria-labelledby="tools-title">
  <h2 id="tools-title">Choose a tool</h2>
  ${toolCards(TOOLS)}
</section>
<section class="section" aria-labelledby="what">
  <h2 id="what">What is ${SITE.name}?</h2>
  <p>${esc(HOME.what)}</p>
</section>
${proofHtml}
${faqHtml(HOME.faq)}`;
  }
  return `
<section class="hero">
  <span class="hero-icon tool-icon tone-${tool.op}" aria-hidden="true">${icon(tool.op)}</span>
  <p class="eyebrow">Runs on your device · 0 bytes uploaded</p>
  <h1>${esc(tool.h1)}</h1>
  <p class="lede">${esc(tool.lede)}</p>
</section>
${workspaceHtml(tool)}
<section class="section" aria-labelledby="how">
  <h2 id="how">How to ${esc(tool.name[0].toLowerCase() + tool.name.slice(1))}</h2>
  <ol class="steps">${tool.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
</section>
${proofHtml}
${faqHtml(tool.faq)}
<section class="section" aria-labelledby="more">
  <h2 id="more">More private PDF tools</h2>
  ${toolCards(TOOLS.filter((t) => t !== tool))}
</section>`;
}

function jsonLd(page: Page) {
  const url = SITE.url + page.path;
  const tool = page.tool;
  const faq = tool ? tool.faq : HOME.faq;
  const app = {
    '@type': 'WebApplication',
    name: tool ? `${SITE.name} ${tool.name}` : SITE.name,
    url,
    description: tool ? tool.description : HOME.description,
    applicationCategory: 'UtilitiesApplication',
    operatingSystem: 'Any',
    browserRequirements: 'Requires JavaScript and WebAssembly',
    isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    ...(tool ? {} : { featureList: TOOLS.map((t) => t.name) }),
  };
  const graph: object[] = [
    tool
      ? {
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: SITE.name, item: `${SITE.url}/` },
            { '@type': 'ListItem', position: 2, name: tool.name, item: url },
          ],
        }
      : { '@type': 'WebSite', name: SITE.name, url },
    app,
    {
      '@type': 'FAQPage',
      mainEntity: faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
    },
  ];
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c');
}

export function renderPage(template: string, page: Page, withCsp: boolean) {
  const title = page.tool?.title ?? HOME.title;
  const description = page.tool?.description ?? HOME.description;
  const url = SITE.url + page.path;
  const head = [
    withCsp ? `<meta http-equiv="Content-Security-Policy" content="${CSP}">` : '',
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(description)}">`,
    `<link rel="canonical" href="${url}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="${SITE.name}">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(description)}">`,
    `<meta property="og:url" content="${url}">`,
    `<meta name="twitter:card" content="summary">`,
    `<script type="application/ld+json">${jsonLd(page)}</script>`,
  ]
    .filter(Boolean)
    .join('\n    ');
  return template
    .replace('<!--head-->', head)
    .replace('<!--main-->', mainHtml(page))
    .replace('data-tool=""', `data-tool="${page.tool?.op ?? ''}"`);
}

export const fileName = (page: Page) => (page.path === '/' ? 'index.html' : `${page.path.slice(1)}index.html`);

export function sitemap(date: string) {
  const urls = PAGES.map((p) => `  <url><loc>${SITE.url}${p.path}</loc><lastmod>${date}</lastmod></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

export const robots = () => `User-agent: *\nAllow: /\n\nSitemap: ${SITE.url}/sitemap.xml\n`;

/** Plain-text summary for AI answer engines (https://llmstxt.org). */
export const llms = () => `# ${SITE.name}

> ${HOME.what}

## Tools

${TOOLS.map((t) => `- [${t.name}](${SITE.url}/${t.slug}/): ${t.description}`).join('\n')}

## Privacy

- Files are processed locally in the browser with qpdf compiled to WebAssembly; there is no upload endpoint.
- The Content Security Policy only permits connections to the site's own origin.
- Anything a tool cannot carry over (for example bookmarks from the second file of a merge) is reported to the user, not dropped silently.

## Source

- [GitHub repository](${SITE.repo}) — MIT license
`;
