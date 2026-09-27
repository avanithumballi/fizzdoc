/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import { PAGES, SITE_LANGS, fileName, llms, llmsFor, llmsFull, notFoundPage, renderPage, robots, sitemap } from './src/seo.ts';
import { SITE } from './src/site.ts';
import { ocrAssets } from './vite-plugins/ocr-assets.ts';

/**
 * The repo's star count, baked into the pages at build time so visitors' browsers never call GitHub.
 * GitHub's API rate-limits shared build machines (Cloudflare Pages), so two public mirrors back it up.
 */
async function fetchStars(): Promise<number | undefined> {
  const repo = new URL(SITE.repo).pathname.slice(1);
  const sources: [string, (json: any) => unknown, Record<string, string>?][] = [
    [`https://api.github.com/repos/${repo}`, (j) => j.stargazers_count, process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}],
    [`https://ungh.cc/repos/${repo}`, (j) => j.repo?.stars],
    [`https://img.shields.io/github/stars/${repo}.json`, (j) => Number(j.value)],
  ];
  for (const [url, pick, headers] of sources) {
    try {
      const response = await fetch(url, { headers: { 'user-agent': 'fizzdoc-build', ...headers }, signal: AbortSignal.timeout(5000) });
      const stars = response.ok ? pick(await response.json()) : undefined;
      if (typeof stars === 'number' && Number.isInteger(stars) && stars >= 0) return stars;
      console.warn(`star count: ${url} answered ${response.status}`);
    } catch {
      console.warn(`star count: ${url} unreachable`);
    }
  }
  return undefined; // offline build: the buttons simply show no count
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
      // Cloudflare Pages answers unknown paths with this page and a real 404 status.
      this.emitFile({ type: 'asset', fileName: '404.html', source: notFoundPage(template, stars) });
      const today = new Date().toISOString().slice(0, 10);
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemap(today) });
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: robots() });
      this.emitFile({ type: 'asset', fileName: 'llms.txt', source: llms() });
      this.emitFile({ type: 'asset', fileName: 'llms-full.txt', source: llmsFull() });
      for (const lang of SITE_LANGS.filter((l) => l !== 'en')) this.emitFile({ type: 'asset', fileName: `${lang}/llms.txt`, source: llmsFor(lang) });
    },
  };
}

export default defineConfig({
  plugins: [pages(), ocrAssets()],
  worker: { format: 'es' },
  build: { target: 'es2022' },
  test: { include: ['tests/**/*.test.ts'] },
});
