import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().url(),
  SESSION_SECRET: z.string().min(32),
  APP_EMAIL: z.string().email(),
  APP_PASSWORD_HASH: z.string().min(1),
  AI_PROVIDER: z.enum(['groq', 'openai', 'anthropic']).default('groq'),
  GROQ_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  TEXT_MODEL: z.string().optional(),
  VISION_MODEL: z.string().optional(),
  SETTINGS_ENCRYPTION_KEY: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

// Empty strings (from .env.example) count as unset. Errors list variable names only, never values.
export function getEnv(source: Record<string, string | undefined> = process.env): Env {
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== ''));
  const parsed = schema.safeParse(cleaned);
  if (parsed.success) return parsed.data;
  const names = [...new Set(parsed.error.issues.map((i) => i.path.join('.')))];
  throw new Error(`Invalid environment variables: ${names.join(', ')}`);
}
