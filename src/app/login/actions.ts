'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { recordEvent } from '@/audit/store';
import { attemptLogin, clientIp } from '@/lib/auth/login';
import { SESSION_COOKIE, sessionCookieOptions } from '@/lib/auth/session';

export interface LoginState {
  error?: string;
  email?: string; // handed back so a failed attempt does not wipe what was typed (React resets the form after an action)
}

// Server Actions are POST-only and Next checks Origin against Host, which covers CSRF for this form.
export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get('email') ?? '');
  const h = await headers();
  const result = await attemptLogin({
    email,
    password: String(formData.get('password') ?? ''),
    ip: clientIp(h),
    userAgent: h.get('user-agent')?.slice(0, 200) ?? undefined,
  });
  if (!result.ok) return { error: result.error, email };
  (await cookies()).set(SESSION_COOKIE, result.token, sessionCookieOptions);
  redirect('/');
}

export async function logoutAction(): Promise<void> {
  await recordEvent({ category: 'auth', action: 'logout', status: 'info', details: { ip: clientIp(await headers()) } });
  (await cookies()).delete(SESSION_COOKIE);
  redirect('/login');
}
