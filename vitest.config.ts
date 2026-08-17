import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Pure Node unit tests (crypto, string helpers) — no DOM needed.
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    // Mirror the "@/*" -> "src/*" path alias from tsconfig so tests import the
    // same way app code does.
    alias: { "@": new URL("./src", import.meta.url).pathname },
  },
});
