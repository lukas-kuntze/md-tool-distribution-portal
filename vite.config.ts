import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { defineConfig, type Plugin } from 'vite';

const frontend = path.resolve(import.meta.dirname, 'src/frontend');
const pages = path.join(frontend, 'pages');
const partials = path.join(frontend, 'partials');

/** Backend routes; in development the Vite server forwards them, in production IIS does. */
const BACKEND_PATHS = ['/api', '/auth', '/install', '/public'];

const MARKER = /<!-- @([a-z-]+) -->/g;
const MAX_NESTING = 5;

/** Replaces `<!-- @name -->` markers with `partials/name.html`; partials may contain markers themselves. */
export function insertPartials(
  html: string,
  read = (name: string): string => readFileSync(path.join(partials, `${name}.html`), 'utf8'),
): string {
  let result = html;

  for (let depth = 0; depth < MAX_NESTING && result.includes('<!-- @'); depth += 1) {
    result = result.replace(MARKER, (_marker, name: string) => read(name));
  }

  return result;
}

const INLINE_IMAGE = /src="\.\.\/assets\/images\/([a-z0-9-]+\.(webp|png|svg))"/g;
const IMAGE_TYPES: Readonly<Record<string, string>> = { webp: 'image/webp', png: 'image/png', svg: 'image/svg+xml' };

/**
 * Embeds the images of `assets/images` as data URIs. They are small (the logo), and as part of the document they
 * appear with the first paint instead of flickering in after it on every page load.
 */
export function inlineImages(
  html: string,
  read = (name: string): Buffer => readFileSync(path.join(frontend, 'assets', 'images', name)),
): string {
  return html.replace(
    INLINE_IMAGE,
    (_match, name: string, extension: string) =>
      `src="data:${IMAGE_TYPES[extension] ?? ''};base64,${read(name).toString('base64')}"`,
  );
}

function partialsPlugin(): Plugin {
  return {
    name: 'insert-partials',
    transformIndexHtml: { order: 'pre', handler: (html) => inlineImages(insertPartials(html)) },
  };
}

export default defineConfig({
  root: pages,
  publicDir: false,
  plugins: [partialsPlugin()],
  // The pages reference `../scripts/` and `../styles/`; the dev server sees those as `/scripts/...` below its root.
  resolve: {
    alias: Object.fromEntries(['scripts', 'styles'].map((dir) => [`/${dir}/`, `${path.join(frontend, dir)}/`])),
  },
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/frontend'),
    emptyOutDir: true,
    rollupOptions: {
      input: Object.fromEntries(
        readdirSync(pages)
          .filter((file) => file.endsWith('.html'))
          .map((file) => [path.basename(file, '.html'), path.join(pages, file)]),
      ),
    },
  },
  server: {
    // Run the backend with PUBLIC_URL=http://localhost:5173 so that cookies, OAuth callback and CSRF check match.
    port: 5173,
    strictPort: true,
    proxy: Object.fromEntries(BACKEND_PATHS.map((prefix) => [prefix, 'http://127.0.0.1:3000'])),
  },
});
