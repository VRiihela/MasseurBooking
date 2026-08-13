import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { defineConfig } from "vitest/config";

// Resolved relative to this file, not process.cwd() -- so `npm test` works
// the same regardless of which directory it's invoked from.
const dir = dirname(fileURLToPath(import.meta.url));
const envTestPath = join(dir, ".env.test");

/**
 * Integration tests must never inherit whatever DATABASE_URL a calling
 * shell happens to have exported -- that's exactly how every `npm test` run
 * ended up silently wiping the real dev database (see
 * test/helpers/fixtures.ts's assertTestDatabase for the second, independent
 * layer of defense). The test database's connection string comes only from
 * this file, read directly at config-load time. Missing/malformed
 * .env.test fails the whole run immediately, rather than falling through to
 * an ambient value.
 */
function loadTestDatabaseUrl(): { DATABASE_URL: string; DATABASE_SSL: string } {
  let raw: string;
  try {
    raw = readFileSync(envTestPath, "utf-8");
  } catch {
    throw new Error(
      `backend/.env.test not found. Copy backend/.env.test.example to backend/.env.test ` +
        `(pointing at a dedicated test database) before running tests.`,
    );
  }

  const parsed = parseEnv(raw);
  if (!parsed.DATABASE_URL) {
    throw new Error(
      `backend/.env.test is missing DATABASE_URL. See backend/.env.test.example.`,
    );
  }

  return {
    DATABASE_URL: parsed.DATABASE_URL,
    DATABASE_SSL: parsed.DATABASE_SSL ?? "false",
  };
}

const testDatabaseEnv = loadTestDatabaseUrl();

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
    // DATABASE_URL/DATABASE_SSL come from .env.test above -- Vitest's env
    // block always overwrites process.env, so this also overrides any
    // DATABASE_URL a calling shell had already exported.
    env: {
      CORS_ORIGIN: "http://localhost:5173",
      ...testDatabaseEnv,
    },
  },
});
