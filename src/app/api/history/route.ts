import { listRuns } from '@/db/history';
import { handle } from '@/lib/route';

export const GET = (req: Request) => handle(req, async () => ({ runs: await listRuns() }));
