import { requireSession } from '@/lib/auth/require-session';
import { assertSameOrigin, errorResponse } from '@/lib/security';

// Every API route: sign-in required, and for changes also a same-origin check. Errors become safe JSON responses.
export async function handle(req: Request, fn: () => Promise<Response | unknown>, opts: { write?: boolean } = {}): Promise<Response> {
  try {
    await requireSession(req);
    if (opts.write) assertSameOrigin(req);
    const out = await fn();
    return out instanceof Response ? out : Response.json(out);
  } catch (e) {
    return errorResponse(e);
  }
}
