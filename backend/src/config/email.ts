export interface EmailConfig {
  postmarkApiToken: string;
  fromAddress: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function loadEmailConfig(): EmailConfig {
  return {
    postmarkApiToken: requireEnv("POSTMARK_API_TOKEN"),
    fromAddress: requireEnv("EMAIL_FROM_ADDRESS"),
  };
}
