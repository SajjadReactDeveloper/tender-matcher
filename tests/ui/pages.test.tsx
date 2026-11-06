// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { AuditView } from '@/components/audit/AuditView';
import { RunsView } from '@/components/runs/RunsView';
import { RunDetail } from '@/components/runs/RunDetail';
import { SettingsView } from '@/components/settings/SettingsView';
import { Shell } from '@/components/shell/Shell';
import { ToastProvider } from '@/components/Toasts';

vi.mock('@/components/session', () => ({ redirectToLogin: vi.fn() }));
let pathname = '/';
const push = vi.fn();
vi.mock('next/navigation', () => ({ usePathname: () => pathname, useRouter: () => ({ push }) }));
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
let fetchMock: ReturnType<typeof vi.fn>;
function routes(map: Record<string, (init?: RequestInit) => Response | Promise<Response>>) {
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${url}`;
    const hit = Object.keys(map).find((k) => key === k || (k.endsWith('*') && key.startsWith(k.slice(0, -1))));
    if (hit) return map[hit](init);
    throw new Error(`unexpected request ${key}`);
  });
  vi.stubGlobal('fetch', fetchMock);
}
const wrap = (ui: React.ReactElement) => render(<ToastProvider>{ui}</ToastProvider>);

beforeEach(() => {
  pathname = '/';
  push.mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Shell', () => {
  test('lists the four pages and marks the current one', () => {
    routes({ 'GET /api/runs': () => json({ run: null, logs: [] }) });
    pathname = '/audit';
    render(<Shell>content</Shell>);
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getAllByRole('link').map((a) => a.textContent)).toEqual(['Tenders', 'Runs', 'Audit log', 'Settings']);
    expect(within(nav).getByRole('link', { name: 'Audit log' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: 'Tenders' })).not.toHaveAttribute('aria-current');
  });

  test('a run in progress shows in the sidebar on every page', async () => {
    routes({ 'GET /api/runs': () => json({ run: { id: 9, status: 'running', screened: 0, matched: 0, error: null }, logs: [] }) });
    pathname = '/settings';
    render(<Shell>x</Shell>);
    expect(await screen.findByText('Fetching (run 9)')).toBeInTheDocument();
  });

  test('the mobile menu button opens and closes the sidebar', () => {
    routes({ 'GET /api/runs': () => json({ run: null, logs: [] }) });
    const { container } = render(<Shell>x</Shell>);
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    expect(container.querySelector('aside')).toHaveClass('open');
    fireEvent.click(container.querySelector('.scrim')!);
    expect(container.querySelector('aside')).not.toHaveClass('open');
  });
});

const settings = (over = {}) => ({
  provider: 'groq',
  textModel: 'openai/gpt-oss-120b',
  visionModel: 'qwen/qwen3.8-27b',
  encryptionConfigured: true,
  providers: [
    { id: 'groq', label: 'Groq', defaultText: 'openai/gpt-oss-120b', defaultVision: 'qwen/qwen3.8-27b', textModels: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b'], visionModels: ['qwen/qwen3.8-27b'] },
    { id: 'openai', label: 'OpenAI', defaultText: 'gpt-4.1-mini', defaultVision: 'gpt-4.1-mini', textModels: ['gpt-4.1-mini', 'gpt-4.1'], visionModels: ['gpt-4.1-mini'] },
  ],
  keys: [
    { provider: 'groq', configured: true, last4: '1234', source: 'dashboard' },
    { provider: 'openai', configured: false, last4: null, source: 'none' },
  ],
  ...over,
});
const usage = { calls: 3, inputTokens: 1500, outputTokens: 200, rateLimited: 1, errors: 0, estCostUsd: 0.0123, byModel: [{ provider: 'groq', model: 'openai/gpt-oss-120b', calls: 3, inputTokens: 1500, outputTokens: 200, estCostUsd: 0.0123 }] };

describe('Settings', () => {
  test('never shows an existing key, only where it came from and its last 4 characters', async () => {
    routes({ 'GET /api/settings': () => json(settings()), 'GET /api/usage*': () => json(usage) });
    wrap(<SettingsView />);
    expect(await screen.findByText('Saved here, ends in 1234')).toBeInTheDocument();
    expect(screen.getByLabelText('Groq API key')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });

  test('switching provider fills that provider\'s default models, and Save sends the choice', async () => {
    routes({
      'GET /api/settings': () => json(settings()),
      'GET /api/usage*': () => json(usage),
      'PUT /api/settings': () => json(settings({ provider: 'openai' })),
    });
    wrap(<SettingsView />);
    await screen.findByText('Provider and model');
    fireEvent.click(screen.getByRole('button', { name: /OpenAI/ }));
    expect(screen.getByLabelText(/Text model/)).toHaveValue('gpt-4.1-mini');
    fireEvent.click(screen.getByRole('button', { name: 'Save model settings' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, i]) => (i as RequestInit | undefined)?.method === 'PUT')).toBe(true));
    const put = fetchMock.mock.calls.find(([u, i]) => u === '/api/settings' && (i as RequestInit | undefined)?.method === 'PUT')!;
    expect(JSON.parse((put[1] as RequestInit).body as string)).toEqual({ provider: 'openai', textModel: 'gpt-4.1-mini', visionModel: 'gpt-4.1-mini' });
    expect(await screen.findByText(/AI settings saved/)).toBeInTheDocument();
  });

  test('a typed key is sent once, cleared from the field, and never echoed', async () => {
    routes({
      'GET /api/settings': () => json(settings()),
      'GET /api/usage*': () => json(usage),
      'PUT /api/settings/keys/openai': () => json({ ok: true, last4: 'wxyz' }),
    });
    wrap(<SettingsView />);
    const field = await screen.findByLabelText('OpenAI API key');
    fireEvent.change(field, { target: { value: 'sk-secret-key-abcdefwxyz' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Save key' })[0]);
    await screen.findByText('OpenAI key saved.');
    expect(screen.getByLabelText('OpenAI API key')).toHaveValue('');
    expect(document.body.innerHTML).not.toContain('sk-secret-key');
  });

  test('saving a key keeps an unsaved provider choice on the page', async () => {
    routes({
      'GET /api/settings': () => json(settings()),
      'GET /api/usage*': () => json(usage),
      'PUT /api/settings/keys/openai': () => json({ ok: true, last4: 'wxyz' }),
    });
    wrap(<SettingsView />);
    await screen.findByText('Provider and model');
    fireEvent.click(screen.getByRole('button', { name: /OpenAI/ }));
    fireEvent.change(screen.getByLabelText('OpenAI API key'), { target: { value: 'sk-secret-key-abcdefwxyz' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Save key' })[0]);
    await screen.findByText('OpenAI key saved.');
    expect(screen.getByRole('button', { name: /OpenAI/ })).toHaveAttribute('aria-pressed', 'true');
  });

  test('an unreadable saved key is explained and can be removed', async () => {
    const keys = [{ provider: 'groq', configured: false, last4: null, source: 'none', unreadable: true }, { provider: 'openai', configured: false, last4: null, source: 'none' }];
    routes({ 'GET /api/settings': () => json(settings({ keys })), 'GET /api/usage*': () => json(usage) });
    wrap(<SettingsView />);
    expect(await screen.findByText(/can no longer be read/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });

  test('key fields are disabled with an explanation when encryption is not configured', async () => {
    routes({ 'GET /api/settings': () => json(settings({ encryptionConfigured: false })), 'GET /api/usage*': () => json(usage) });
    wrap(<SettingsView />);
    expect(await screen.findByText(/SETTINGS_ENCRYPTION_KEY/)).toBeInTheDocument();
    expect(screen.getByLabelText('Groq API key')).toBeDisabled();
  });

  test('Test connection shows latency and tokens on success and the error on failure', async () => {
    let ok = true;
    routes({
      'GET /api/settings': () => json(settings()),
      'GET /api/usage*': () => json(usage),
      'POST /api/settings/test': () => json(ok ? { ok: true, model: 'openai/gpt-oss-120b', latencyMs: 840, inputTokens: 9, outputTokens: 1 } : { ok: false, model: 'x', latencyMs: 5, error: 'AI API 401: bad key' }),
    });
    wrap(<SettingsView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Test connection' }));
    expect(await screen.findByText(/Connected to openai\/gpt-oss-120b in 840 ms. Tokens used: 9 in, 1 out/)).toBeInTheDocument();
    ok = false;
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(await screen.findByText('Could not connect: AI API 401: bad key')).toBeInTheDocument();
  });

  test('the usage panel shows totals and a per-model row, and switches windows', async () => {
    routes({ 'GET /api/settings': () => json(settings()), 'GET /api/usage*': () => json(usage) });
    wrap(<SettingsView />);
    expect((await screen.findAllByText('1,500')).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('tab', { name: '7 days' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => u === '/api/usage?hours=168')).toBe(true));
  });
});

const ai = (id: number, over = {}) => ({ id, at: '2026-11-06T10:00:00Z', runId: 3, tenderExternalId: 'TS1E', purpose: 'analyse', provider: 'groq', model: 'openai/gpt-oss-120b', status: 'ok', httpStatus: 200, inputTokens: 1200, outputTokens: 300, totalTokens: 1500, images: 0, latencyMs: 900, retryAfterS: null, estCostUsd: '0.000405', error: null, promptPreview: 'PROMPT TEXT', replyPreview: 'REPLY TEXT', ...over });

describe('Audit log', () => {
  test('AI calls show tokens in and out, and a row expands to the prompt and reply', async () => {
    routes({ 'GET /api/audit*': () => json({ rows: [ai(2), ai(1, { status: 'rate_limited', inputTokens: null, outputTokens: null })], next: null }) });
    render(<AuditView />);
    expect(await screen.findByText('1,200')).toBeInTheDocument();
    expect(screen.getByText('300')).toBeInTheDocument();
    expect(screen.getByText('rate limited')).toBeInTheDocument();
    fireEvent.click(screen.getAllByText('analyse')[0]);
    expect(screen.getByText('PROMPT TEXT')).toBeInTheDocument();
    expect(screen.getByText('REPLY TEXT')).toBeInTheDocument();
  });

  test('filters change the request, Load more passes the cursor, and Export carries the active filters', async () => {
    routes({ 'GET /api/audit*': () => json({ rows: [ai(5)], next: 5 }) });
    render(<AuditView />);
    await screen.findByText('1,200');
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'error' } });
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).includes('status=error'))).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).includes('before=5'))).toBe(true));
    expect(screen.getByRole('link', { name: 'Export CSV' })).toHaveAttribute('href', expect.stringContaining('status=error'));
  });

  test('the Events tab offers a category filter and shows an empty state and an error state', async () => {
    routes({ 'GET /api/audit*': () => json({ rows: [], next: null }) });
    render(<AuditView />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Events' }));
    expect(await screen.findByLabelText('Category')).toBeInTheDocument();
    expect(await screen.findByText('Nothing matches')).toBeInTheDocument();
    routes({ 'GET /api/audit*': () => json({ error: 'Internal server error' }, 500) });
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'ok' } });
    expect(await screen.findByText('Could not load the audit log')).toBeInTheDocument();
  });
});

const runRow = (id: number, over = {}) => ({ id, status: 'completed', limit: 50, startedAt: '2026-11-06T10:00:00Z', finishedAt: '2026-11-06T10:03:05Z', error: null, screened: 40, matched: 3, aiCalls: 5, inputTokens: 8000, outputTokens: 900, estCostUsd: 0, durationSec: 185, ...over });

describe('Runs', () => {
  test('the table shows duration, counts and tokens, with n/a when no cost is known, and a row opens the run', async () => {
    routes({ 'GET /api/history': () => json({ runs: [runRow(7)] }) });
    wrap(<RunsView />);
    expect(await screen.findByText('3m 5s')).toBeInTheDocument();
    expect(screen.getByText('8,000')).toBeInTheDocument();
    expect(screen.getByText('n/a')).toBeInTheDocument();
    fireEvent.click(screen.getByText('completed'));
    expect(push).toHaveBeenCalledWith('/runs/7');
  });

  test('shows an empty state when there are no runs', async () => {
    routes({ 'GET /api/history': () => json({ runs: [] }) });
    wrap(<RunsView />);
    expect(await screen.findByText('No runs yet')).toBeInTheDocument();
  });

  test('a run detail merges log lines, AI calls with tokens and site requests into one timeline', async () => {
    routes({
      'GET /api/history/7': () =>
        json({
          run: { id: 7, status: 'completed', limit: 50, startedAt: '2026-11-06T10:00:00Z', finishedAt: '2026-11-06T10:03:00Z', error: null, screened: 40, matched: 3 },
          logs: [{ at: '2026-11-06T10:00:01Z', message: 'Scanning PPRA' }],
          aiCalls: [ai(1, { at: '2026-11-06T10:00:05Z' })],
          events: [{ id: 1, at: '2026-11-06T10:00:03Z', category: 'fetch', action: 'request', status: 'ok', ref: null, durationMs: 120, details: { url: 'https://epms.ppra.gov.pk/x', status: 200, bytes: 2048 } }],
        }),
    });
    render(<RunDetail id="7" />);
    expect(await screen.findByText('Scanning PPRA')).toBeInTheDocument();
    expect(screen.getByText(/1,200 in, 300 out/, { selector: 'li span:last-child' })).toBeInTheDocument();
    expect(screen.getByText(/epms.ppra.gov.pk\/x 200 2,048 bytes/)).toBeInTheDocument();
    const kinds = screen.getAllByText(/^(Log|AI call|Request)$/).map((e) => e.textContent);
    expect(kinds).toEqual(['Log', 'Request', 'AI call']);
  });

  test('an unknown run shows a clear message', async () => {
    routes({ 'GET /api/history/99': () => json({ error: 'Run not found' }, 404) });
    render(<RunDetail id="99" />);
    expect(await screen.findByText('That run does not exist')).toBeInTheDocument();
  });
});
