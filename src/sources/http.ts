const MAX_BYTES = 40 * 1024 * 1024;
const UA = 'Mozilla/5.0 (compatible; tender-matcher; internal use)';

export interface FetchOptions {
  retries?: number;
  retryDelayMs?: number;
  timeoutMs?: number;
}

class TooLargeError extends Error {}

// Reads the body chunk by chunk and aborts as soon as it passes the cap, so a huge or endless response (no Content-Length)
// can never be buffered whole.
async function readCapped(res: Response, url: string): Promise<Buffer> {
  if (!res.body) return Buffer.from(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel();
      throw new TooLargeError(`File too large: ${url}`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export async function fetchBuffer(url: string, { retries = 3, retryDelayMs = 1500, timeoutMs = 60000 }: FetchOptions = {}): Promise<Buffer> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw new Error(`${res.status} for ${url}`);
      if (Number(res.headers.get('content-length')) > MAX_BYTES) throw new TooLargeError(`File too large: ${url}`);
      return await readCapped(res, url);
    } catch (e) {
      if (e instanceof TooLargeError || attempt >= retries) throw e;
      await new Promise((r) => setTimeout(r, retryDelayMs * (attempt + 1)));
    }
  }
}

export async function fetchText(url: string, opts?: FetchOptions): Promise<string> {
  return (await fetchBuffer(url, opts)).toString('utf8');
}
