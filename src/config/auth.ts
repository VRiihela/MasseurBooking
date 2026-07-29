function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * Placeholder admin credential until real masseur login (email/password or
 * magic link, per context_template.md) exists. A single static token shared
 * by whoever holds it -- not per-admin, not revocable individually.
 */
export function loadMasseurAdminToken(): string {
  return requireEnv("MASSEUR_ADMIN_TOKEN");
}
