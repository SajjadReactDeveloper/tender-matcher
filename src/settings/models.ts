export const PROVIDER_IDS = ['groq', 'openai', 'anthropic'] as const;
export type Provider = (typeof PROVIDER_IDS)[number];

export interface ProviderInfo {
  label: string;
  url: string;
  envKey: string;
  defaultText: string;
  defaultVision: string;
  textModels: string[];
  visionModels: string[];
}

// Defaults match what the app used before settings existed. The suggestion lists only fill the dropdowns: any model id can be typed.
export const PROVIDERS: Record<Provider, ProviderInfo> = {
  groq: {
    label: 'Groq',
    url: 'https://api.groq.com/openai/v1/chat/completions',
    envKey: 'GROQ_API_KEY',
    defaultText: 'openai/gpt-oss-120b',
    defaultVision: 'qwen/qwen3.8-27b',
    textModels: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'llama-3.3-70b-versatile'],
    visionModels: ['qwen/qwen3.8-27b', 'meta-llama/llama-4-scout-17b-16e-instruct'],
  },
  openai: {
    label: 'OpenAI',
    url: 'https://api.openai.com/v1/chat/completions',
    envKey: 'OPENAI_API_KEY',
    defaultText: 'gpt-4.1-mini',
    defaultVision: 'gpt-4.1-mini',
    textModels: ['gpt-4.1-mini', 'gpt-4.1', 'gpt-4o-mini', 'gpt-4o'],
    visionModels: ['gpt-4.1-mini', 'gpt-4.1', 'gpt-4o-mini', 'gpt-4o'],
  },
  anthropic: {
    label: 'Anthropic',
    url: 'https://api.anthropic.com/v1/messages',
    envKey: 'ANTHROPIC_API_KEY',
    defaultText: 'claude-haiku-5-5',
    defaultVision: 'claude-sonnet-5-5',
    textModels: ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'],
    visionModels: ['claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-5-5'],
  },
};

export const isProvider = (v: unknown): v is Provider => typeof v === 'string' && (PROVIDER_IDS as readonly string[]).includes(v);
