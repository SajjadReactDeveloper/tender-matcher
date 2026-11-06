import { estimateCostUsd } from '@/audit/pricing';
import { getAudit } from '@/audit/context';
import { recordAiCall, type NewAiCall } from '@/audit/store';
import { redact } from '@/lib/security';
import { PROVIDERS } from '@/settings/models';
import { getAiConfig } from '@/settings/store';

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
  purpose: NewAiCall['purpose'];
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
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; input_tokens?: number; output_tokens?: number };
}

interface Posted {
  reply: ProviderReply;
  httpStatus: number;
}

async function post(url: string, headers: Record<string, string>, body: unknown): Promise<Posted> {
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(180000) });
  } catch (e) {
    throw new AiError(`AI request failed: ${(e as Error).message}`, { retryable: true });
  }
  if (res.ok) return { reply: await res.json(), httpStatus: res.status };
  const err = await res.text();
  if (res.status === 429 && !/too large/i.test(err)) throw new RateLimitError(Number(res.headers.get('retry-after')) || 30, `AI API 429: ${err.slice(0, 300)}`);
  throw new AiError(`AI API ${res.status}: ${err.slice(0, 300)}`, { status: res.status, retryable: res.status >= 500 });
}

const num = (n: unknown): number | null => (typeof n === 'number' && Number.isFinite(n) ? n : null);

export async function chat(opts: ChatOptions & { json: true }): Promise<unknown>;
export async function chat(opts: ChatOptions): Promise<string>;
export async function chat({ system, user, images = [], json = false, maxTokens = 4000, purpose }: ChatOptions): Promise<string | unknown> {
  const cfg = await getAiConfig();
  const p = PROVIDERS[cfg.provider];
  if (!cfg.apiKey) throw new AiError(`No API key for ${p.label}: add one in Settings or set ${p.envKey}`);
  const model = images.length ? cfg.visionModel : cfg.textModel;
  const ctx = getAudit();
  const started = Date.now();
  const base = { runId: ctx.runId, tenderExternalId: ctx.tender, purpose, provider: cfg.provider, model, attempt: 1, images: images.length, promptChars: system.length + user.length, promptPreview: `${system}\n\n${user}${images.length ? `\n\n[${images.length} page image(s) not stored]` : ''}` };
  const audit = (extra: Partial<NewAiCall> & Pick<NewAiCall, 'status'>) => recordAiCall({ ...base, latencyMs: Date.now() - started, replyChars: 0, ...extra });

  let out: string;
  let usage: ProviderReply['usage'];
  let httpStatus: number;
  try {
    if (cfg.provider === 'anthropic') {
      const content = [...images.map((i) => ({ type: 'image', source: { type: 'base64', media_type: i.mime, data: i.b64 } })), { type: 'text', text: user }];
      const r = await post(p.url, { 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01' }, { model, max_tokens: maxTokens, system, messages: [{ role: 'user', content }] });
      out = (r.reply.content ?? []).map((c) => c.text || '').join('');
      usage = r.reply.usage;
      httpStatus = r.httpStatus;
    } else {
      // Text-only requests use plain string content: some Groq models reject the array form.
      const content = images.length ? [{ type: 'text', text: user }, ...images.map((i) => ({ type: 'image_url', image_url: { url: `data:${i.mime};base64,${i.b64}` } }))] : user;
      const body: Record<string, unknown> = { model, temperature: 0.2, max_tokens: maxTokens, messages: [{ role: 'system', content: system }, { role: 'user', content }] };
      if (json && !images.length) body.response_format = { type: 'json_object' };
      if (model.startsWith('openai/gpt-oss')) body.reasoning_effort = 'low';
      const r = await post(p.url, { Authorization: `Bearer ${cfg.apiKey}` }, body);
      out = r.reply.choices?.[0]?.message?.content || '';
      usage = r.reply.usage;
      httpStatus = r.httpStatus;
    }
  } catch (e) {
    if (e instanceof RateLimitError) await audit({ status: 'rate_limited', httpStatus: 429, retryAfterS: e.retryAfterSeconds, error: e.message });
    else await audit({ status: 'error', httpStatus: (e as AiError).status ?? null, error: (e as Error).message });
    throw e;
  }
  out = out.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  const input = num(usage?.prompt_tokens) ?? num(usage?.input_tokens);
  const output = num(usage?.completion_tokens) ?? num(usage?.output_tokens);
  const cost = estimateCostUsd(cfg.provider, model, input, output);
  await audit({ status: 'ok', httpStatus, inputTokens: input, outputTokens: output, totalTokens: num(usage?.total_tokens) ?? (input != null && output != null ? input + output : null), replyChars: out.length, replyPreview: out, estCostUsd: cost == null ? null : cost.toFixed(6) });
  return json ? parseJsonReply(out) : out;
}
