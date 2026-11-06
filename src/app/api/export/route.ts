import { listMatched } from '@/db/tenders';
import { assertSameOrigin, errorResponse, rateLimit } from '@/lib/security';
import { toView } from '@/lib/tender-view';
import { buildXlsx } from '@/lib/xlsx';

export async function GET(req: Request): Promise<Response> {
  try {
    assertSameOrigin(req);
    rateLimit('export', 10);
    const buf = await buildXlsx((await listMatched()).map(toView));
    return new Response(buf, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="tenders.xlsx"',
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
