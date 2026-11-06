import { listMatched } from '@/db/tenders';
import { errorResponse } from '@/lib/security';
import { toView } from '@/lib/tender-view';

export async function GET(req: Request): Promise<Response> {
  try {
    const source = new URL(req.url).searchParams.get('source') ?? undefined;
    return Response.json((await listMatched(source)).map(toView));
  } catch (e) {
    return errorResponse(e);
  }
}
