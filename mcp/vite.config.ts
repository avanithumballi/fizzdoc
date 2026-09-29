// Bundles the server and the engines it shares with the website into one Node file.
// Packages stay external and are installed from package.json.
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    ssr: 'src/cli.ts',
    outDir: 'dist',
    emptyOutDir: true,
    target: 'node20',
    minify: false,
    rollupOptions: { output: { entryFileNames: 'server.js', banner: '#!/usr/bin/env node' } },
  },
});
