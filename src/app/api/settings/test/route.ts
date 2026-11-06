import { chat } from '@/ai/llm';
import { listAiCalls, recordEvent } from '@/audit/store';
import { handle } from '@/lib/route';
import { rateLimit } from '@/lib/security';
import { getAiConfig } from '@/settings/store';

// One tiny real call with the current provider, model and key, so a wrong key or model shows up here instead of in the middle of a run.
export const POST = (req: Request) =>
  handle(
    req,
    async () => {
      rateLimit('settings:test', 5);
      const cfg = await getAiConfig();
      const started = Date.now();
      try {
        await chat({ purpose: 'test', system: 'Reply with the single word OK.', user: 'ping', maxTokens: 16 });
        const [call] = (await listAiCalls({ limit: 1 })).rows;
        await recordEvent({ category: 'settings', action: 'test', status: 'ok', ref: cfg.provider, durationMs: Date.now() - started, details: { provider: cfg.provider, model: cfg.textModel } });
        return { ok: true, provider: cfg.provider, model: cfg.textModel, latencyMs: Date.now() - started, inputTokens: call?.inputTokens ?? null, outputTokens: call?.outputTokens ?? null };
      } catch (e) {
        const error = (e as Error).message;
        await recordEvent({ category: 'settings', action: 'test', status: 'error', ref: cfg.provider, durationMs: Date.now() - started, details: { provider: cfg.provider, model: cfg.textModel, error } });
        return { ok: false, provider: cfg.provider, model: cfg.textModel, latencyMs: Date.now() - started, error };
      }
    },
    { write: true },
  );
