import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { viteStaticCopy } from "vite-plugin-static-copy";
import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    alias: {
      // Foliate'in PDF dalı bu uygulamada hiç çalışmaz (yalnızca EPUB).
      // Paketleyicinin bare import'u çözebilmesi için boş saplama.
      "@pdfjs/pdf.min.mjs": fileURLToPath(new URL("./src/foliate/pdf-stub.js", import.meta.url))
    }
  },
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        {
          src: "node_modules/piper-tts-web/dist/onnx/*",
          dest: "onnx",
          rename: { stripBase: true }
        },
        {
          src: "node_modules/piper-tts-web/dist/piper/*",
          dest: "piper",
          rename: { stripBase: true }
        }
      ]
    })
  ]
});
