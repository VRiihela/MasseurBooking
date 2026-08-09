function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * The single browser origin allowed to call this API cross-origin -- the
 * web/ frontend's origin. Never a wildcard: this same app also serves the
 * authenticated admin routes.
 */
export function loadCorsOrigin(): string {
  return requireEnv("CORS_ORIGIN");
}
