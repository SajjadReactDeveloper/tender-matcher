import { vi } from 'vitest';

// Stubs global fetch with a Groq/OpenAI-shaped chat completion carrying `content`.
export function stubAiReply(content: string | object) {
  const body = { choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }] };
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

export function stubAiStatus(status: number, body = '{}', headers: Record<string, string> = {}) {
  const fn = vi.fn(async () => new Response(body, { status, headers }));
  vi.stubGlobal('fetch', fn);
  return fn;
}
