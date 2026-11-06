'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { attemptLogin, clientIp } from '@/lib/auth/login';
import { SESSION_COOKIE, sessionCookieOptions } from '@/lib/auth/session';

export interface LoginState {
  error?: string;
}

// Server Actions are POST-only and Next checks Origin against Host, which covers CSRF for this form.
export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const result = await attemptLogin({
    email: String(formData.get('email') ?? ''),
    password: String(formData.get('password') ?? ''),
    ip: clientIp(await headers()),
  });
  if (!result.ok) return { error: result.error };
  (await cookies()).set(SESSION_COOKIE, result.token, sessionCookieOptions);
  redirect('/');
}

export async function logoutAction(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
  redirect('/login');
}
