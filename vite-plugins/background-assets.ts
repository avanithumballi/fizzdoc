// Serves ONNX Runtime's WebGPU build from our own origin under /bg/ort/, for Remove Background.
// Its WebAssembly file is over 25 MiB, too big for static hosts, so it goes out in parts with a
// manifest, the same way the models do (see scripts/background-model.py); the page joins them and
// keeps the result in the browser's cache. Devices without WebGPU use the smaller CPU build that
// Audio to Text already serves under /whisper/ort/.
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Plugin } from 'vite';

const require = createRequire(import.meta.url);
const NAME = 'ort-wasm-simd-threaded.asyncify.wasm';
const GLUE = 'ort-wasm-simd-threaded.asyncify.mjs';
const PART = 20 * 1024 * 1024;

/**
 * The WebGPU build's own module, for `import('ort-webgpu')` (the package alias points elsewhere). The
 * "extern wasm" variant, so Vite doesn't copy the 27 MB binary into the build (static hosts cap files
 * at 25 MiB); it loads its small loader from /bg/ort/ and is handed the binary joined from parts.
 */
export const ORT_WEBGPU = join(dirname(require.resolve('onnxruntime-web')), 'ort.webgpu.min.mjs');

function files() {
  const bytes = readFileSync(join(dirname(require.resolve('onnxruntime-web')), NAME));
  const parts = new Map<string, Uint8Array>();
  for (let at = 0; at < bytes.length; at += PART) parts.set(`${NAME}.part${parts.size}`, bytes.subarray(at, at + PART));
  const manifest = {
    files: [{ path: NAME, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), parts: [...parts.keys()] }],
  };
  parts.set('manifest.json', new TextEncoder().encode(`${JSON.stringify(manifest)}\n`));
  // The runtime's small loader script, which it imports from the same folder.
  parts.set(GLUE, readFileSync(join(dirname(require.resolve('onnxruntime-web')), GLUE)));
  return parts;
}

export function backgroundAssets(): Plugin {
  const served = files();
  return {
    name: 'fizzdoc-background-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const match = /^\/bg\/ort\/([^/?]+)/.exec(req.url ?? '');
        const body = match && served.get(match[1]);
        if (!body) return next();
        res.setHeader('Content-Type', match[1].endsWith('.json') ? 'application/json' : match[1].endsWith('.mjs') ? 'text/javascript' : 'application/octet-stream');
        res.end(body);
      });
    },
    generateBundle() {
      for (const [name, source] of served) this.emitFile({ type: 'asset', fileName: `bg/ort/${name}`, source });
    },
  };
}
