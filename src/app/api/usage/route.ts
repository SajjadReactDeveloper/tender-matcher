import { usageSummary } from '@/audit/store';
import { handle } from '@/lib/route';
import { HttpError } from '@/lib/security';

export const GET = (req: Request) =>
  handle(req, async () => {
    const hours = Number(new URL(req.url).searchParams.get('hours') ?? 24);
    if (![24, 168, 720].includes(hours)) throw new HttpError(400, '"hours" must be 24, 168 or 720');
    return usageSummary(hours);
  });
