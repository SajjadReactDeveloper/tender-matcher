import type { ReactNode } from 'react';
import { Shell } from '@/components/shell/Shell';
import { logoutAction } from '../login/actions';

// The signed-in part of the app: sidebar shell around Tenders, Runs, Audit log and Settings. proxy.ts already blocks signed-out visitors.
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <Shell
      signOut={
        <form action={logoutAction}>
          <button type="submit" className="btn">
            Sign out
          </button>
        </form>
      }
    >
      {children}
    </Shell>
  );
}
