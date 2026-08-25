import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const rootDirectory = import.meta.dirname;
const manifestSource = readFileSync(resolve(rootDirectory, 'manifest.json'), 'utf8');

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    target: 'chrome109',
    rollupOptions: {
      input: {
        background: resolve(rootDirectory, 'src/background.ts'),
        content: resolve(rootDirectory, 'src/content/index.ts'),
        popup: resolve(rootDirectory, 'src/popup/popup.html'),
        viewer: resolve(rootDirectory, 'src/viewer/viewer.html'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
        banner: (chunk) => chunk.name === 'content' ? '(() => {' : '',
        footer: (chunk) => chunk.name === 'content' ? '})();' : '',
      },
    },
  },
  plugins: [
    {
      name: 'copy-extension-manifest',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'manifest.json', source: manifestSource });
      },
    },
  ],
});
