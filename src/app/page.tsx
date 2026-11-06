import { Dashboard } from '@/components/Dashboard';
import { logoutAction } from './login/actions';

export default function Home() {
  return (
    <Dashboard
      signOut={
        <form action={logoutAction}>
          <button type="submit" className="btn">
            Sign out
          </button>
        </form>
      }
    />
  );
}
