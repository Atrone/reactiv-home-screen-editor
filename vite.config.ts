import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss(), reactRouter()],
  // Pre-bundle zod at startup. Otherwise Vite discovers it on the first page load and forces a
  // full reload, logging a "Failed to fetch dynamically imported module" error on a fresh clone.
  optimizeDeps: { include: ["zod"] },
});
