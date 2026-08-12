export interface EmailConfig {
  resendApiKey: string;
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
    resendApiKey: requireEnv("RESEND_API_KEY"),
    fromAddress: requireEnv("EMAIL_FROM_ADDRESS"),
  };
}
