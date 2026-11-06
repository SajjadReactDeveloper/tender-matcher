import { requestStop } from '@/db/queries';
import { requireSession } from '@/lib/auth/require-session';
import { HttpError, assertSameOrigin, errorResponse } from '@/lib/security';

// First Stop asks the workflow to stop; a second Stop on a run that is still active closes it directly
// (the workflow is lost), so a dead run can never block Fetch forever.
export async function POST(req: Request): Promise<Response> {
  try {
    await requireSession(req);
    assertSameOrigin(req);
    const result = await requestStop();
    if (!result) throw new HttpError(409, 'No run is in progress');
    return Response.json({ ok: true, forced: result.forced });
  } catch (e) {
    return errorResponse(e);
  }
}
