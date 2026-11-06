import { z } from 'zod';
import { handle } from '@/lib/route';
import { HttpError, rateLimit, readJsonBody } from '@/lib/security';
import { MAX_PROFILE_CHARS, getProfile, resetProfile, saveProfile } from '@/settings/profile';

const body = z.object({ text: z.string() });
const current = async () => ({ ...(await getProfile()), max: MAX_PROFILE_CHARS });

export const GET = (req: Request) => handle(req, current);

export const PUT = (req: Request) =>
  handle(
    req,
    async () => {
      rateLimit('settings:profile', 20);
      const parsed = body.safeParse(await readJsonBody(req, MAX_PROFILE_CHARS * 4 + 1024)); // up to 4 bytes per character in JSON
      if (!parsed.success) throw new HttpError(400, 'A "text" is required');
      await saveProfile(parsed.data.text);
      return current();
    },
    { write: true },
  );

export const DELETE = (req: Request) =>
  handle(
    req,
    async () => {
      await resetProfile();
      return current();
    },
    { write: true },
  );
