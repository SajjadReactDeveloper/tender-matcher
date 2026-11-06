import { redact } from '@/lib/security';

// One function, three providers. Switch with AI_PROVIDER=groq|openai|anthropic.
const PROVIDERS = {
  groq: { url: 'https://api.groq.com/openai/v1/chat/completions', key: 'GROQ_API_KEY', text: 'openai/gpt-oss-120b', vision: 'qwen/qwen3.8-27b' },
  openai: { url: 'https://api.openai.com/v1/chat/completions', key: 'OPENAI_API_KEY', text: 'gpt-4.1-mini', vision: 'gpt-4.1-mini' },
  anthropic: { url: 'https://api.anthropic.com/v1/messages', key: 'ANTHROPIC_API_KEY', text: 'claude-haiku-5-5', vision: 'claude-sonnet-5-5' },
} as const;

export class AiError extends Error {
  retryable: boolean;
  status?: number;
  constructor(message: string, opts: { retryable?: boolean; status?: number } = {}) {
    super(redact(message));
    this.name = 'AiError';
    this.retryable = opts.retryable ?? false;
    this.status = opts.status;
  }
}

// The provider asked us to wait; the workflow turns this into a durable sleep instead of holding a function open.
export class RateLimitError extends Error {
  retryAfterSeconds: number;
  constructor(retryAfterSeconds: number, message = 'AI rate limit reached') {
    super(redact(message));
    this.name = 'RateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export interface ChatOptions {
  system: string;
  user: string;
  images?: { b64: string; mime: string }[];
  json?: boolean;
  maxTokens?: number;
}

export function parseJsonReply(text: string): unknown {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (!m) throw new AiError('AI returned no JSON: ' + cleaned.slice(0, 200), { retryable: true });
  try {
    return JSON.parse(m[0]);
  } catch {
    throw new AiError('AI returned invalid JSON: ' + cleaned.slice(0, 200), { retryable: true });
  }
}

interface ProviderReply {
  choices?: { message?: { content?: string } }[];
  content?: { text?: string }[];
}

async function post(url: string, headers: Record<string, string>, body: unknown): Promise<ProviderReply> {
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(180000) });
  } catch (e) {
    throw new AiError(`AI request failed: ${(e as Error).message}`, { retryable: true });
  }
  if (res.ok) return res.json();
  const err = await res.text();
  if (res.status === 429 && !/too large/i.test(err)) throw new RateLimitError(Number(res.headers.get('retry-after')) || 30, `AI API 429: ${err.slice(0, 300)}`);
  throw new AiError(`AI API ${res.status}: ${err.slice(0, 300)}`, { status: res.status, retryable: res.status >= 500 });
}

export async function chat(opts: ChatOptions & { json: true }): Promise<unknown>;
export async function chat(opts: ChatOptions): Promise<string>;
export async function chat({ system, user, images = [], json = false, maxTokens = 4000 }: ChatOptions): Promise<string | unknown> {
  const name = (process.env.AI_PROVIDER || 'groq').toLowerCase() as keyof typeof PROVIDERS;
  const p = PROVIDERS[name];
  if (!p) throw new AiError(`Unknown AI_PROVIDER "${name}"`);
  const key = process.env[p.key];
  if (!key) throw new AiError(`${p.key} is not set`);
  const model = (images.length ? process.env.VISION_MODEL : process.env.TEXT_MODEL) || (images.length ? p.vision : p.text);

  let out: string;
  if (name === 'anthropic') {
    const content = [...images.map((i) => ({ type: 'image', source: { type: 'base64', media_type: i.mime, data: i.b64 } })), { type: 'text', text: user }];
    const r = await post(p.url, { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, { model, max_tokens: maxTokens, system, messages: [{ role: 'user', content }] });
    out = (r.content ?? []).map((c) => c.text || "").join("");
  } else {
    // Text-only requests use plain string content: some Groq models reject the array form.
    const content = images.length ? [{ type: 'text', text: user }, ...images.map((i) => ({ type: 'image_url', image_url: { url: `data:${i.mime};base64,${i.b64}` } }))] : user;
    const body: Record<string, unknown> = { model, temperature: 0.2, max_tokens: maxTokens, messages: [{ role: 'system', content: system }, { role: 'user', content }] };
    if (json && !images.length) body.response_format = { type: 'json_object' };
    if (model.startsWith('openai/gpt-oss')) body.reasoning_effort = 'low';
    const r = await post(p.url, { Authorization: `Bearer ${key}` }, body);
    out = r.choices?.[0]?.message?.content || '';
  }
  out = out.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  return json ? parseJsonReply(out) : out;
}
