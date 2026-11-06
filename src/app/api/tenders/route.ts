import { listMatched } from '@/db/tenders';
import { requireSession } from '@/lib/auth/require-session';
import { errorResponse } from '@/lib/security';
import { toView } from '@/lib/tender-view';

export async function GET(req: Request): Promise<Response> {
  try {
    await requireSession(req);
    const source = new URL(req.url).searchParams.get('source') ?? undefined;
    return Response.json((await listMatched(source)).map(toView));
  } catch (e) {
    return errorResponse(e);
  }
}
