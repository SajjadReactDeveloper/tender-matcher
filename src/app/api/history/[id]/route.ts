import { getRunDetail } from '@/db/history';
import { handle } from '@/lib/route';
import { HttpError } from '@/lib/security';

export const GET = (req: Request, ctx: { params: Promise<{ id: string }> }) =>
  handle(req, async () => {
    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id) || id < 1) throw new HttpError(404, 'Run not found');
    const detail = await getRunDetail(id);
    if (!detail) throw new HttpError(404, 'Run not found');
    return detail;
  });
