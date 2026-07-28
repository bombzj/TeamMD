import react from '@vitejs/plugin-react';
import { cp, mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

const projectDirectory = dirname(fileURLToPath(import.meta.url));
const vditorDist = resolve(projectDirectory, 'node_modules/vditor/dist');

function localVditorAssets(): Plugin {
  return {
    name: 'local-vditor-assets',
    configureServer(server) {
      server.middlewares.use('/vditor/dist', (request, response, next) => {
        void serveVditorAsset(request.url, response, next);
      });
    },
    async writeBundle(options) {
      const outputDirectory = options.dir ?? resolve(projectDirectory, 'dist');
      const destination = resolve(outputDirectory, 'vditor', 'dist');
      await rm(destination, { recursive: true, force: true });
      await mkdir(destination, { recursive: true });
      await cp(vditorDist, destination, { recursive: true });
    },
  };
}

async function serveVditorAsset(
  requestUrl: string | undefined,
  response: {
    setHeader: (name: string, value: string) => void;
    end: (body: Buffer) => void;
  },
  next: () => void,
): Promise<void> {
  try {
    const relativePath = decodeURIComponent(
      (requestUrl ?? '/').split('?', 1)[0] ?? '/',
    ).replace(/^\/+/, '');
    const assetPath = resolve(vditorDist, relativePath);
    if (!assetPath.startsWith(vditorDist)) return next();
    const body = await readFile(assetPath);
    response.setHeader('Content-Type', assetContentType(assetPath));
    response.end(body);
  } catch {
    next();
  }
}

function assetContentType(path: string): string {
  if (path.endsWith('.css')) return 'text/css; charset=utf-8';
  if (path.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (path.endsWith('.json')) return 'application/json; charset=utf-8';
  if (path.endsWith('.svg')) return 'image/svg+xml';
  if (path.endsWith('.png')) return 'image/png';
  if (path.endsWith('.gif')) return 'image/gif';
  if (path.endsWith('.woff2')) return 'font/woff2';
  if (path.endsWith('.woff')) return 'font/woff';
  return 'application/octet-stream';
}

export default defineConfig({
  plugins: [react(), localVditorAssets()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: false,
      },
    },
  },
  test: {
    environment: 'jsdom',
  },
});
