import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [
    react(),
    {
      name: "dev-csp",
      apply: "serve",
      transformIndexHtml: (html) =>
        html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'"),
    },
  ],
  base: "./",
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
  build: {
    // Electron supports ES2021. Older targets trigger an esbuild lowering bug
    // in xterm 6's DECRQM handler, permanently stalling terminal rendering.
    // https://github.com/xtermjs/xterm.js/issues/5800
    target: "es2021",
    chunkSizeWarningLimit: 1800,
    reportCompressedSize: false,
  },
});
