// Kept in its own module so tests can replace it (jsdom cannot navigate).
export const redirectToLogin = (): void => window.location.assign('/login');
