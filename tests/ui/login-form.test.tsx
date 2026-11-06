// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { LoginForm } from '@/app/login/LoginForm';

const loginAction = vi.fn();
vi.mock('@/app/login/actions', () => ({ loginAction: (...a: unknown[]) => loginAction(...a) }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('LoginForm', () => {
  test('after a failed sign-in the error is shown and the email the person typed is kept (the password is cleared)', async () => {
    loginAction.mockResolvedValue({ error: 'Invalid email or password.', email: 'me@example.com' });
    render(<LoginForm />);
    const email = screen.getByLabelText('Email') as HTMLInputElement;
    const password = screen.getByLabelText('Password') as HTMLInputElement;
    fireEvent.change(email, { target: { value: 'me@example.com' } });
    fireEvent.change(password, { target: { value: 'wrong' } });
    fireEvent.submit(email.closest('form')!);

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password.');
    await waitFor(() => expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('me@example.com'));
    expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe('');
  });
});
