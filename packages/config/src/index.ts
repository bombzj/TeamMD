import { z } from 'zod';

const serverEnvironmentSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  WEB_ORIGIN: z.string().url(),
  DATABASE_URL: z.string().startsWith('mysql://'),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
});

export type ServerConfig = {
  nodeEnv: 'development' | 'test' | 'production';
  host: string;
  port: number;
  webOrigin: string;
  databaseUrl: string;
  sessionTtlDays: number;
  secureCookies: boolean;
};

export function parseServerConfig(
  environment: Record<string, string | undefined>,
): ServerConfig {
  const parsed = serverEnvironmentSchema.parse(environment);

  return {
    nodeEnv: parsed.NODE_ENV,
    host: parsed.HOST,
    port: parsed.PORT,
    webOrigin: new URL(parsed.WEB_ORIGIN).origin,
    databaseUrl: parsed.DATABASE_URL,
    sessionTtlDays: parsed.SESSION_TTL_DAYS,
    secureCookies: parsed.NODE_ENV === 'production',
  };
}
