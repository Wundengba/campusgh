import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

function getPackageName(id) {
  const parts = id.split("node_modules/");
  if (parts.length < 2) return null;

  const packagePath = parts.at(-1);
  if (!packagePath) return null;

  const segments = packagePath.split("/");
  if (segments[0]?.startsWith("@")) {
    return `${segments[0]}/${segments[1]}`;
  }

  return segments[0];
}

function manualChunks(id) {
  if (!id.includes("node_modules")) return;

  const packageName = getPackageName(id);
  if (!packageName) return;

  const pdfCorePackages = new Set([
    "jspdf",
    "@babel/runtime",
    "fast-png",
    "fflate",
    "iobuffer",
    "pako",
    "rgbcolor",
    "stackblur-canvas",
    "svg-pathdata",
    "tslib",
  ]);

  const pdfRenderPackages = new Set([
    "canvg",
    "core-js",
    "dompurify",
    "html2canvas",
    "iceberg-js",
    "performance-now",
    "raf",
  ]);

  if (["react", "react-dom", "scheduler"].includes(packageName)) {
    return "react-vendor";
  }

  if (packageName === "react-icons") {
    return "icons";
  }

  if (packageName.startsWith("@supabase")) {
    return "supabase";
  }

  if (pdfCorePackages.has(packageName)) {
    return "pdf";
  }

  if (pdfRenderPackages.has(packageName)) {
    return "pdf-render";
  }

  return `vendor-${packageName.replace("@", "").replace("/", "-")}`;
}

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks,
      },
    },
  },
  resolve: {
    alias: {
      react: fileURLToPath(new URL("./node_modules/react", import.meta.url)),
      "react-dom": fileURLToPath(
        new URL("./node_modules/react-dom", import.meta.url),
      ),
    },
  },
  server: {
    port: 3000,
    strictPort: true,
  },
});
