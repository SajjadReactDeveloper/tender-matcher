import { z } from 'zod';
import { listAiCalls, listAuditEvents } from '@/audit/store';
import { handle } from '@/lib/route';
import { HttpError } from '@/lib/security';

const q = z.object({
  kind: z.enum(['events', 'ai']).default('events'),
  category: z.enum(['fetch', 'run', 'settings', 'auth']).optional(),
  status: z.string().max(20).optional(),
  runId: z.coerce.number().int().positive().optional(),
  q: z.string().max(100).optional(),
  from: z.string().max(40).optional(),
  to: z.string().max(40).optional(),
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export function parseFilter(url: string) {
  const parsed = q.safeParse(Object.fromEntries(new URL(url).searchParams));
  if (!parsed.success) throw new HttpError(400, 'Invalid filter');
  const f = parsed.data;
  for (const d of [f.from, f.to]) if (d && Number.isNaN(Date.parse(d))) throw new HttpError(400, 'Invalid date');
  return f;
}

export const GET = (req: Request) =>
  handle(req, async () => {
    const { kind, ...filter } = parseFilter(req.url);
    return kind === 'ai' ? listAiCalls(filter) : listAuditEvents(filter);
  });
