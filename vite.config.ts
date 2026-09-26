/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import { PAGES, fileName, llms, renderPage, robots, sitemap } from './src/seo.ts';

/** Serves each tool page in dev and writes one prerendered HTML file per page at build. */
function pages(): Plugin {
  let build = false;
  return {
    name: 'fizzdoc-pages',
    enforce: 'post',
    configResolved(config) {
      build = config.command === 'build';
    },
    transformIndexHtml(html, ctx) {
      if (build) return html; // rendered per page in generateBundle, once asset tags are injected
      const path = new URL(ctx.originalUrl ?? '/', 'http://localhost').pathname;
      return renderPage(html, PAGES.find((p) => p.path === path) ?? PAGES[0], false);
    },
    generateBundle(_, bundle) {
      const index = bundle['index.html'];
      if (index?.type !== 'asset') throw new Error('index.html missing from bundle');
      const template = String(index.source);
      for (const page of PAGES) {
        const source = renderPage(template, page, true);
        if (page.path === '/') index.source = source;
        else this.emitFile({ type: 'asset', fileName: fileName(page), source });
      }
      const today = new Date().toISOString().slice(0, 10);
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemap(today) });
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: robots() });
      this.emitFile({ type: 'asset', fileName: 'llms.txt', source: llms() });
    },
  };
}

export default defineConfig({
  plugins: [pages()],
  worker: { format: 'es' },
  build: { target: 'es2022' },
  test: { include: ['tests/**/*.test.ts'] },
});
