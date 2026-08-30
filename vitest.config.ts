import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["e2e/**", "dist/**", "node_modules/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      reportsDirectory: "coverage",
      thresholds: {
        statements: 70,
        branches: 55,
        functions: 70,
        lines: 75,
      },
    },
  },
});
