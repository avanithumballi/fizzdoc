// Fetches the Whisper speech model used by Audio to Text and stores it under public/whisper/, split
// into parts small enough for static hosts (Cloudflare Pages serves files up to 25 MiB). The page
// joins the parts on first use and keeps the model in the browser's cache, so it downloads once.
//
// Run: node scripts/whisper-model.mjs   (only needed when changing the model or its revision)
import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

// onnx-community/whisper-tiny: OpenAI's Whisper tiny (Apache-2.0) converted to ONNX for Transformers.js.
const REPO = 'onnx-community/whisper-tiny';
const REVISION = 'ff4177021cc41f7db950912b73ea4fdf7d01d8e7';
const FILES = [
  'config.json',
  'generation_config.json',
  'preprocessor_config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'onnx/encoder_model_quantized.onnx',
  'onnx/decoder_model_merged_quantized.onnx',
];
const PART = 20 * 1024 * 1024;
const OUT = join(import.meta.dirname, '..', 'public', 'whisper', 'whisper-tiny');

rmSync(OUT, { recursive: true, force: true });
const manifest = { source: `https://huggingface.co/${REPO}/tree/${REVISION}`, license: 'Apache-2.0', files: [] };
for (const file of FILES) {
  const response = await fetch(`https://huggingface.co/${REPO}/resolve/${REVISION}/${file}`);
  if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const parts = [];
  for (let at = 0; at < bytes.length; at += PART) {
    const name = bytes.length > PART ? `${file}.part${parts.length}` : file;
    mkdirSync(dirname(join(OUT, name)), { recursive: true });
    writeFileSync(join(OUT, name), bytes.subarray(at, at + PART));
    parts.push(name);
  }
  manifest.files.push({ path: file, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), parts });
  console.log(`${file}: ${(bytes.length / 1e6).toFixed(1)} MB in ${parts.length} part(s)`);
}
writeFileSync(join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
