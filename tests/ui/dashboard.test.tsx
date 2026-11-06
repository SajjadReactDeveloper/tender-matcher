// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Dashboard } from '@/components/Dashboard';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const noRun = { run: null, logs: [] };

let fetchMock: ReturnType<typeof vi.fn>;
function routes(over: Record<string, () => Response | Promise<Response>> = {}) {
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${url}`;
    if (over[key]) return over[key]();
    if (key === 'GET /api/runs') return json(noRun);
    if (key === 'GET /api/tenders') return json([]);
    throw new Error(`unexpected request ${key}`);
  });
  vi.stubGlobal('fetch', fetchMock);
}
const posts = () => fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST');

beforeEach(() => routes());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Dashboard', () => {
  test('shows skeletons first, then the empty state once the data has loaded', async () => {
    const { container } = render(<Dashboard />);
    expect(container.querySelectorAll('.sk-row').length).toBeGreaterThan(0);
    expect(await screen.findByText('No matched tenders yet')).toBeInTheDocument();
    expect(container.querySelectorAll('.sk-row')).toHaveLength(0);
  });

  test('shows a retry state when the tenders cannot be loaded, and recovers on Try again', async () => {
    routes({ 'GET /api/tenders': () => json({ error: 'Internal server error' }, 500) });
    render(<Dashboard />);
    expect(await screen.findByText('Could not load tenders')).toBeInTheDocument();
    routes();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No matched tenders yet')).toBeInTheDocument();
  });

  test('Fetch with a limit of 0 shows an error toast and sends no request', async () => {
    render(<Dashboard />);
    await screen.findByText('No matched tenders yet');
    fireEvent.change(screen.getByLabelText(/Scan up to/), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Fetch latest tenders' }));
    expect(await screen.findByText('Enter a whole number from 1 to 3000.')).toBeInTheDocument();
    expect(posts()).toHaveLength(0);
  });

  test('a 409 from the API is shown as an error toast with the server message', async () => {
    routes({ 'POST /api/runs': () => json({ error: 'A run is already in progress' }, 409) });
    render(<Dashboard />);
    await screen.findByText('No matched tenders yet');
    fireEvent.click(screen.getByRole('button', { name: 'Fetch latest tenders' }));
    const toast = await screen.findByText('A run is already in progress');
    expect(toast.closest('[role="alert"]')).not.toBeNull();
  });

  test('a successful start posts the limit as JSON and shows a success toast', async () => {
    routes({ 'POST /api/runs': () => json({ runId: 7 }) });
    render(<Dashboard />);
    await screen.findByText('No matched tenders yet');
    fireEvent.change(screen.getByLabelText(/Scan up to/), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Fetch latest tenders' }));
    expect(await screen.findByText('Run started. Scanning up to 25 new tenders.')).toBeInTheDocument();
    const [, init] = posts()[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ limit: 25 });
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  test('while a run is active the Fetch button is disabled and shows the latest log line and a Stop control', async () => {
    routes({
      'GET /api/runs': () => json({ run: { id: 3, status: 'running', matched: 1, screened: 40, error: null }, logs: [{ at: '2026-11-06T10:00:00Z', message: 'Reading T9 Some tender' }] }),
    });
    render(<Dashboard />);
    expect(await screen.findByText('Reading T9 Some tender')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Running...' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Stop run' })).toBeInTheDocument();
  });

  test('a failed run shows its error message', async () => {
    routes({ 'GET /api/runs': () => json({ run: { id: 3, status: 'failed', matched: 0, screened: 0, error: 'source returned no tenders' }, logs: [] }) });
    render(<Dashboard />);
    expect(await screen.findByText('source returned no tenders')).toBeInTheDocument();
  });

  test('the Excel button downloads through fetch and reports a failure as a toast', async () => {
    routes({ 'GET /api/export': () => json({ error: 'Too many requests. Wait a minute and try again.' }, 429) });
    render(<Dashboard />);
    await screen.findByText('No matched tenders yet');
    fireEvent.click(screen.getByRole('button', { name: 'Download Excel' }));
    await waitFor(() => expect(screen.getByText(/Download failed: Too many requests/)).toBeInTheDocument());
  });
});
