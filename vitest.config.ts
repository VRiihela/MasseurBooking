import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    hookTimeout: 20_000,
    testTimeout: 20_000,
    // Integration tests share one real Postgres DB and reset fixtures with
    // DELETE/INSERT in beforeEach — running test files in parallel races
    // those fixture resets against each other. Keep file execution serial.
    fileParallelism: false,
  },
});
