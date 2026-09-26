// Serves tesseract.js's worker script, wasm core and English traineddata from our own origin,
// unhashed and side by side under /ocr/. This matters because tesseract.js-core's emscripten glue
// resolves its .wasm sibling relative to the *worker script's own URL* (self.location.href inside
// a dedicated worker) rather than the core .js file's URL, so the worker and its core files must
// live in the same directory with stable names for that lookup to succeed.
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Plugin } from 'vite';

const require = createRequire(import.meta.url);

// [published name, package.json to resolve the package root from, path within that package]
const FILES: [name: string, pkg: string, path: string][] = [
  ['worker.min.js', 'tesseract.js', 'dist/worker.min.js'],
  ['tesseract-core-simd-lstm.js', 'tesseract.js-core', 'tesseract-core-simd-lstm.js'],
  ['tesseract-core-simd-lstm.wasm', 'tesseract.js-core', 'tesseract-core-simd-lstm.wasm'],
  ['eng.traineddata.gz', '@tesseract.js-data/eng', '4.0.0_best_int/eng.traineddata.gz'],
];

const TYPES: Record<string, string> = {
  '.js': 'text/javascript',
  '.wasm': 'application/wasm',
  '.gz': 'application/octet-stream',
};

function resolveAll(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, pkg, path] of FILES) {
    const root = dirname(require.resolve(`${pkg}/package.json`));
    const full = join(root, path);
    if (!existsSync(full)) throw new Error(`ocr-assets: missing ${full} (from ${pkg})`);
    out[name] = full;
  }
  return out;
}

/** Add to vite.config.ts: `import { ocrAssets } from './vite-plugins/ocr-assets';` and include
 * `ocrAssets()` in the `plugins` array. */
export function ocrAssets(): Plugin {
  const files = resolveAll();
  return {
    name: 'fizzdoc-ocr-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0] ?? '';
        const match = /^\/ocr\/([^/]+)$/.exec(url);
        const path = match && files[match[1]];
        if (!path) return next();
        const ext = match[1].slice(match[1].lastIndexOf('.'));
        res.setHeader('Content-Type', TYPES[ext] ?? 'application/octet-stream');
        res.end(readFileSync(path));
      });
    },
    generateBundle() {
      for (const [name, path] of Object.entries(files)) {
        this.emitFile({ type: 'asset', fileName: `ocr/${name}`, source: readFileSync(path) });
      }
    },
  };
}
