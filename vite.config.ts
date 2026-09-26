/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import { PAGES, fileName, llms, llmsFull, renderPage, robots, sitemap } from './src/seo.ts';
import { SITE } from './src/site.ts';
import { ocrAssets } from './vite-plugins/ocr-assets.ts';

/** The repo's star count, baked into the pages at build time so visitors' browsers never call GitHub. */
async function fetchStars(): Promise<number | undefined> {
  try {
    const response = await fetch(`https://api.github.com/repos/${new URL(SITE.repo).pathname.slice(1)}`, {
      headers: process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {},
      signal: AbortSignal.timeout(5000),
    });
    return response.ok ? ((await response.json()) as { stargazers_count: number }).stargazers_count : undefined;
  } catch {
    return undefined; // offline build: the buttons simply show no count
  }
}

/** Serves each tool page in dev and writes one prerendered HTML file per page at build. */
function pages(): Plugin {
  let build = false;
  let stars: number | undefined;
  return {
    name: 'fizzdoc-pages',
    enforce: 'post',
    async configResolved(config) {
      build = config.command === 'build';
      stars = await fetchStars();
    },
    transformIndexHtml(html, ctx) {
      if (build) return html; // rendered per page in generateBundle, once asset tags are injected
      const path = new URL(ctx.originalUrl ?? '/', 'http://localhost').pathname;
      return renderPage(html, PAGES.find((p) => p.path === path) ?? PAGES[0], false, stars);
    },
    generateBundle(_, bundle) {
      const index = bundle['index.html'];
      if (index?.type !== 'asset') throw new Error('index.html missing from bundle');
      const template = String(index.source);
      for (const page of PAGES) {
        const source = renderPage(template, page, true, stars);
        if (page.path === '/') index.source = source;
        else this.emitFile({ type: 'asset', fileName: fileName(page), source });
      }
      const today = new Date().toISOString().slice(0, 10);
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemap(today) });
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: robots() });
      this.emitFile({ type: 'asset', fileName: 'llms.txt', source: llms() });
      this.emitFile({ type: 'asset', fileName: 'llms-full.txt', source: llmsFull() });
    },
  };
}

export default defineConfig({
  plugins: [pages(), ocrAssets()],
  worker: { format: 'es' },
  build: { target: 'es2022' },
  test: { include: ['tests/**/*.test.ts'] },
});
