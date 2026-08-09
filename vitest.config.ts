import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // web/ is a separate package with its own vite.config.ts (jsdom
    // environment, its own Vitest run) -- without this, Vitest's default
    // glob picks up web/test/*.test.tsx from here too and runs it under
    // the wrong (node) environment.
    exclude: ["**/node_modules/**", "web/**"],
    hookTimeout: 20_000,
    testTimeout: 20_000,
    // Integration tests share one real Postgres DB and reset fixtures with
    // DELETE/INSERT in beforeEach — running test files in parallel races
    // those fixture resets against each other. Keep file execution serial.
    fileParallelism: false,
    // createApp() reads CORS_ORIGIN eagerly (it configures the cors()
    // middleware at app-construction time), so every test file that calls
    // createApp() needs it set before that call runs -- set it once here
    // instead of in each of the ~13 files that construct the app.
    env: {
      CORS_ORIGIN: "http://localhost:5173",
    },
  },
});
