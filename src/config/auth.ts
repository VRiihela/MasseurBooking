function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * The masseur admin is a v1 singleton identified by a config value, not a
 * DB row -- there is no admins table to look this up against.
 */
export function loadAdminEmail(): string {
  return requireEnv("ADMIN_EMAIL");
}

/**
 * Used to build the absolute magic-link URL sent by email. Trailing
 * slash(es) stripped so callers can join paths with a single leading slash
 * without producing a doubled "//".
 */
export function loadAppBaseUrl(): string {
  return requireEnv("APP_BASE_URL").replace(/\/+$/, "");
}
