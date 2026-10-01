// Serves ONNX Runtime's WebAssembly build from our own origin under /whisper/ort/, for Audio to Text.
// Only the plain CPU build is used: the WebGPU build is over 25 MiB, too big for static hosts, and
// the page's CSP would block loading it from a CDN anyway. The speech model itself is in
// public/whisper/ (see scripts/whisper-model.mjs).
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Plugin } from 'vite';

const require = createRequire(import.meta.url);
const NAMES = ['ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.mjs'];
const TYPES: Record<string, string> = { '.wasm': 'application/wasm', '.mjs': 'text/javascript' };

function resolveAll(): Record<string, string> {
  // onnxruntime-web's exports map hides package.json, so find the package from its main entry.
  const dist = dirname(require.resolve('onnxruntime-web'));
  const files: Record<string, string> = {};
  for (const name of NAMES) {
    const path = join(dist, name);
    if (!existsSync(path)) throw new Error(`whisper-assets: missing ${path}`);
    files[name] = path;
  }
  return files;
}

export function whisperAssets(): Plugin {
  const files = resolveAll();
  return {
    name: 'fizzdoc-whisper-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const match = /^\/whisper\/ort\/([^/?]+)/.exec(req.url ?? '');
        const path = match && files[match[1]];
        if (!path) return next();
        res.setHeader('Content-Type', TYPES[match[1].slice(match[1].lastIndexOf('.'))]);
        res.end(readFileSync(path));
      });
    },
    generateBundle() {
      for (const [name, path] of Object.entries(files)) {
        this.emitFile({ type: 'asset', fileName: `whisper/ort/${name}`, source: readFileSync(path) });
      }
    },
  };
}
