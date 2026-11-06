import { requestStop } from '@/db/queries';
import { HttpError, assertSameOrigin, errorResponse } from '@/lib/security';

export async function POST(req: Request): Promise<Response> {
  try {
    assertSameOrigin(req);
    if (!(await requestStop())) throw new HttpError(409, 'No run is in progress');
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
