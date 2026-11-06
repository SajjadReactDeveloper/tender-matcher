import { z } from 'zod';
import { handle } from '@/lib/route';
import { HttpError, rateLimit, readJsonBody } from '@/lib/security';
import { isProvider } from '@/settings/models';
import { removeKey, saveKey } from '@/settings/store';

type Ctx = { params: Promise<{ provider: string }> };
const body = z.object({ key: z.string().min(1).max(500) });

async function providerOf(ctx: Ctx) {
  const { provider } = await ctx.params;
  if (!isProvider(provider)) throw new HttpError(404, 'Unknown provider');
  return provider;
}

// The key travels in the request body only, is never echoed back, and is stored encrypted (see src/settings/store.ts).
export const PUT = (req: Request, ctx: Ctx) =>
  handle(
    req,
    async () => {
      const provider = await providerOf(ctx);
      rateLimit('settings:key', 10);
      const parsed = body.safeParse(await readJsonBody(req, 2048));
      if (!parsed.success) throw new HttpError(400, 'A "key" is required');
      return { ok: true, ...(await saveKey(provider, parsed.data.key)) };
    },
    { write: true },
  );

export const DELETE = (req: Request, ctx: Ctx) =>
  handle(
    req,
    async () => {
      await removeKey(await providerOf(ctx));
      return { ok: true };
    },
    { write: true },
  );
