import type { Metadata } from 'next';
import { LoginForm } from './LoginForm';
import styles from './login.module.css';

export const metadata: Metadata = { title: 'Sign in | Tender Matcher' };

export default function LoginPage() {
  return (
    <main className={styles.wrap}>
      <div className={styles.card}>
        <h1>Tender Matcher</h1>
        <p className={styles.tag}>Sign in to see matched tenders.</p>
        <LoginForm />
      </div>
    </main>
  );
}
