import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    target: "es2022",
    outDir: "dist",
    emptyOutDir: true,
    assetsInlineLimit: 0, // fontes e imagens saem como arquivos (CSP não aceita data: em fonte)
    modulePreload: { polyfill: false },
    cssCodeSplit: false,
  },
  test: {
    environment: "jsdom",
    maxWorkers: 2, // jsdom + React Aria em muitos workers esgota a memória e aborta (código 134)
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
