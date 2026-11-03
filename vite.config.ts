import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
export default defineConfig({
  plugins: [
    react(),
    {
      name: "pdf-assets",
      configureServer(server) {
        server.middlewares.use("/pdf-assets", (req, res, next) => {
          const root = path.resolve("node_modules/pdfjs-dist");
          const url = (req.url || "").split("?")[0];
          if (!/^\/(cmaps|standard_fonts|wasm)\/[\w.-]+$/.test(url))
            return next();
          const file = path.resolve(root, "." + url);
          if (!file.startsWith(root + path.sep) || !fs.existsSync(file))
            return next();
          res.setHeader(
            "Content-Type",
            file.endsWith(".wasm")
              ? "application/wasm"
              : "application/octet-stream",
          );
          fs.createReadStream(file).pipe(res);
        });
      },
      closeBundle() {
        for (const name of ["cmaps", "standard_fonts", "wasm", "LICENSE"]) {
          const dest = path.resolve("dist/pdf-assets", name);
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.cpSync(path.resolve("node_modules/pdfjs-dist", name), dest, {
            recursive: true,
          });
        }
      },
    },
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
