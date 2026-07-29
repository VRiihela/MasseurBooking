export interface DbConfig {
  connectionString: string;
  ssl: boolean;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function loadDbConfig(): DbConfig {
  return {
    connectionString: requireEnv("DATABASE_URL"),
    ssl: process.env.DATABASE_SSL === "true",
  };
}
