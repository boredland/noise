import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    outDir: "dist",
    commonjsOptions: {
      include: [/lamejs/],
    },
  },
  optimizeDeps: {
    include: ["lamejs"],
  },
});
