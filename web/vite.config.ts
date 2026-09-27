import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFile } from 'node:fs/promises';
export default defineConfig({
  base: './', plugins: [react(), {
    name: 'use-exported-deployment-in-development',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const name = req.url?.split('?')[0].slice(1) ?? '';
        if (name !== 'imd-deployment.json' && !/^abi\/[A-Za-z0-9_]+\.json$/.test(name)) return next();
        try {
          const data = await readFile(new URL(`../dist/${name}`, import.meta.url));
          res.setHeader('Content-Type', 'application/json'); res.end(data);
        } catch { res.statusCode = 503; res.end('Build the static export to generate deployment configuration.'); }
      });
    },
  }],
  build: { outDir: '../dist', emptyOutDir: true, sourcemap: false },
});
