const MAX_BYTES = 40 * 1024 * 1024;
const UA = 'Mozilla/5.0 (compatible; tender-matcher; internal use)';

export interface FetchOptions {
  retries?: number;
  retryDelayMs?: number;
  timeoutMs?: number;
}

class TooLargeError extends Error {}

export async function fetchBuffer(url: string, { retries = 3, retryDelayMs = 1500, timeoutMs = 60000 }: FetchOptions = {}): Promise<Buffer> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw new Error(`${res.status} for ${url}`);
      if (Number(res.headers.get('content-length')) > MAX_BYTES) throw new TooLargeError(`File too large: ${url}`);
      const buf = Buffer.from(await res.arrayBuffer()); // ponytail: chunked responses are only checked after download
      if (buf.length > MAX_BYTES) throw new TooLargeError(`File too large: ${url}`);
      return buf;
    } catch (e) {
      if (e instanceof TooLargeError || attempt >= retries) throw e;
      await new Promise((r) => setTimeout(r, retryDelayMs * (attempt + 1)));
    }
  }
}

export async function fetchText(url: string, opts?: FetchOptions): Promise<string> {
  return (await fetchBuffer(url, opts)).toString('utf8');
}
