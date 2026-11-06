// Kept in its own module so tests can replace it (jsdom cannot navigate).
// A full page load on purpose: the session just expired, so we want a clean slate rather than a client-side transition.
export const redirectToLogin = (): void => {
  window.location.href = '/login';
};
