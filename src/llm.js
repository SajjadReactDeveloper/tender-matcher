// One function, three providers. Switch with AI_PROVIDER=groq|openai|anthropic in .env.
const P = {
  groq: { url: 'https://api.groq.com/openai/v1/chat/completions', key: 'GROQ_API_KEY', text: 'openai/gpt-oss-120b', vision: 'qwen/qwen3.8-27b' },
  openai: { url: 'https://api.openai.com/v1/chat/completions', key: 'OPENAI_API_KEY', text: 'gpt-4.1-mini', vision: 'gpt-4.1-mini' },
  anthropic: { url: 'https://api.anthropic.com/v1/messages', key: 'ANTHROPIC_API_KEY', text: 'claude-haiku-5-5', vision: 'claude-sonnet-5-5' },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(url, headers, body) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(180000) });
    if (res.ok) return res.json();
    const err = await res.text();
    const retryable = (res.status === 429 && !/too large/i.test(err)) || res.status >= 500;
    if (!retryable || attempt >= 6) throw new Error(`AI API ${res.status}: ${err.slice(0, 300)}`);
    const wait = Number(res.headers.get('retry-after')) * 1000 || Math.min(2000 * 2 ** attempt, 60000);
    if (wait > 120000) throw new Error(`AI rate limit reached, try again in ${Math.ceil(wait / 60000)} min`);
    console.log(`  AI busy (${res.status}), waiting ${Math.round(wait / 1000)}s`);
    await sleep(wait + 500);
  }
}

// chat({ system, user, images: [{ b64, mime }], json }) -> string (or parsed object when json: true)
export async function chat({ system, user, images = [], json = false, maxTokens = 4000 }) {
  const name = (process.env.AI_PROVIDER || 'groq').toLowerCase();
  const p = P[name];
  if (!p) throw new Error(`Unknown AI_PROVIDER "${name}"`);
  const key = process.env[p.key];
  if (!key) throw new Error(`${p.key} is missing in .env`);
  const model = (images.length ? process.env.VISION_MODEL : process.env.TEXT_MODEL) || (images.length ? p.vision : p.text);

  let out;
  if (name === 'anthropic') {
    const content = [...images.map((i) => ({ type: 'image', source: { type: 'base64', media_type: i.mime, data: i.b64 } })), { type: 'text', text: user }];
    const r = await post(p.url, { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, { model, max_tokens: maxTokens, system, messages: [{ role: 'user', content }] });
    out = r.content.map((c) => c.text || '').join('');
  } else {
    // Text-only requests use plain string content: some Groq models reject the array form.
    const content = images.length ? [{ type: 'text', text: user }, ...images.map((i) => ({ type: 'image_url', image_url: { url: `data:${i.mime};base64,${i.b64}` } }))] : user;
    const body = { model, temperature: 0.2, max_tokens: maxTokens, messages: [{ role: 'system', content: system }, { role: 'user', content }] };
    if (json && !images.length) body.response_format = { type: 'json_object' };
    if (model.startsWith('openai/gpt-oss')) body.reasoning_effort = 'low';
    const r = await post(p.url, { Authorization: `Bearer ${key}` }, body);
    out = r.choices[0].message.content || '';
  }
  out = out.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  if (!json) return out;
  const m = out.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('AI returned no JSON: ' + out.slice(0, 200));
  return JSON.parse(m[0]);
}
