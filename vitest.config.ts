import { defineConfig } from "vitest/config";

// The React Router Vite plugin is deliberately not loaded here: route modules are
// tested as plain modules, and the plugin's dev-server transforms break under Vitest.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "node",
          environment: "node",
          include: ["**/*.test.ts"],
          exclude: ["node_modules/**", "build/**"],
        },
      },
      {
        test: {
          name: "dom",
          environment: "jsdom",
          include: ["**/*.test.tsx"],
          exclude: ["node_modules/**", "build/**"],
          setupFiles: ["./test/setup-dom.ts"],
        },
      },
    ],
  },
});
