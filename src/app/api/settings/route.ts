import { z } from 'zod';
import { handle } from '@/lib/route';
import { HttpError, rateLimit, readJsonBody } from '@/lib/security';
import { PROVIDER_IDS } from '@/settings/models';
import { publicSettings, saveSettings } from '@/settings/store';

const model = z.string().trim().regex(/^[\w./:\-]{1,100}$/, 'Model ids use letters, numbers and . / : _ - only').nullish();
const body = z.object({ provider: z.enum(PROVIDER_IDS), textModel: model, visionModel: model });

export const GET = (req: Request) => handle(req, publicSettings);

export const PUT = (req: Request) =>
  handle(
    req,
    async () => {
      rateLimit('settings:save', 30);
      const parsed = body.safeParse(await readJsonBody(req));
      if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? 'Invalid settings');
      await saveSettings(parsed.data);
      return publicSettings();
    },
    { write: true },
  );
