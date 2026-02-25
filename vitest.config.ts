import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/backend/**/*.test.ts"],
    reporters: "default",
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
