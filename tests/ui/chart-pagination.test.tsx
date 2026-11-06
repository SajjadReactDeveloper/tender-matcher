// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ClosingChart, bucketByDay } from '@/components/ClosingChart';
import { Dashboard } from '@/components/Dashboard';
import { Pagination, pageList } from '@/components/Pagination';
import { DAY, midnight } from '@/components/format';
import type { TenderView } from '@/domain/types';

vi.mock('@/components/session', () => ({ redirectToLogin: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const inDays = (n: number) => new Date(midnight().getTime() + n * DAY).toLocaleDateString('en-CA');
let nextId = 1;
const tender = (over: Partial<TenderView> = {}): TenderView => ({
  id: nextId++, source: 'ppra', externalId: `T${nextId}`, refNo: 'R1', url: 'https://epms.ppra.gov.pk/t1', postingDate: '2026-11-01', lastDate: inDays(5), closingTime: '10:00',
  department: 'Ministry of IT', office: '', location: '', name: `Tender number ${nextId}`, category: '', sector: '', nature: '', type: '', relevance: 'High', score: 80,
  recommendation: 'Bid - fits', challenges: '', scope: 'scope', contact: '', bidSecurity: '', bidValidity: '', procedure: '',
  docs: { advertisement: '', tender: '', pagesRead: 2 }, ...over,
});

describe('pageList', () => {
  test('keeps the first and last page and the neighbours of the current one, with gaps between', () => {
    expect(pageList(1, 3)).toEqual([1, 2, 3]);
    expect(pageList(1, 10)).toEqual([1, 2, 'gap', 10]);
    expect(pageList(5, 10)).toEqual([1, 'gap', 4, 5, 6, 'gap', 10]);
    expect(pageList(10, 10)).toEqual([1, 'gap', 9, 10]);
  });
});

describe('Pagination', () => {
  const setup = (over = {}) => {
    const p = { total: 25, page: 1, pageSize: 10, onPage: vi.fn(), onPageSize: vi.fn(), noun: 'tenders', ...over };
    render(<Pagination {...p} />);
    return p;
  };

  test('shows the range and total, disables Prev on the first page and goes to the clicked page', () => {
    const p = setup();
    expect(screen.getByText('Showing 1-10 of 25 tenders')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Page 3' }));
    expect(p.onPage).toHaveBeenCalledWith(3);
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(p.onPage).toHaveBeenCalledWith(2);
  });

  test('the last page shows a short range and disables Next; the page size can be changed', () => {
    const p = setup({ page: 3 });
    expect(screen.getByText('Showing 21-25 of 25 tenders')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Rows per page'), { target: { value: '50' } });
    expect(p.onPageSize).toHaveBeenCalledWith(50);
  });

  test('renders nothing when there is nothing to page', () => {
    const { container } = render(<Pagination total={0} page={1} pageSize={10} onPage={vi.fn()} onPageSize={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('bucketByDay', () => {
  test('groups open tenders by closing day and relevance, counts later ones, and ignores closed or undated ones', () => {
    const { days, later } = bucketByDay([
      tender({ lastDate: inDays(0), relevance: 'High' }),
      tender({ lastDate: inDays(0), relevance: 'Low' }),
      tender({ lastDate: inDays(3), relevance: 'Medium' }),
      tender({ lastDate: inDays(45) }),
      tender({ lastDate: inDays(-2) }),
      tender({ lastDate: '' }),
    ]);
    expect(days).toHaveLength(30);
    expect(days[0]).toMatchObject({ High: 1, Low: 1, Medium: 0 });
    expect(days[3]).toMatchObject({ Medium: 1 });
    expect(later).toBe(1);
    expect(days.reduce((a, d) => a + d.items.length, 0)).toBe(3);
  });
});

describe('ClosingChart', () => {
  test('each day with tenders is a button that picks that day, and clicking it again clears the pick', () => {
    const onPick = vi.fn();
    const ts = [tender({ lastDate: inDays(4) }), tender({ lastDate: inDays(4), relevance: 'Low' })];
    const { rerender } = render(<ClosingChart tenders={ts} loading={false} selected="" onPick={onPick} />);
    const bar = screen.getByRole('button', { name: /2 tenders closing$/ });
    fireEvent.click(bar);
    expect(onPick).toHaveBeenCalledWith(inDays(4));
    rerender(<ClosingChart tenders={ts} loading={false} selected={inDays(4)} onPick={onPick} />);
    fireEvent.click(screen.getByRole('button', { name: /closing, selected$/ }));
    expect(onPick).toHaveBeenLastCalledWith('');
  });

  test('the keyboard works too, and hovering a day shows its tenders', () => {
    const onPick = vi.fn();
    render(<ClosingChart tenders={[tender({ lastDate: inDays(2), name: 'Cloud migration' })]} loading={false} selected="" onPick={onPick} />);
    const bar = screen.getByRole('button', { name: /1 tender closing/ });
    fireEvent.keyDown(bar, { key: 'Enter' });
    expect(onPick).toHaveBeenCalledWith(inDays(2));
    fireEvent.mouseEnter(bar);
    expect(within(screen.getByRole('tooltip')).getByText('Cloud migration')).toBeInTheDocument();
  });

  test('renders nothing when no open tender closes at all', () => {
    const { container } = render(<ClosingChart tenders={[tender({ lastDate: inDays(-1) })]} loading={false} selected="" onPick={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
function serve(tenders: TenderView[]) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/tenders') return json(tenders);
    if (url === '/api/runs') return json({ run: null, logs: [] });
    throw new Error(`unexpected ${url}`);
  }));
}

describe('Dashboard pagination and day filter', () => {
  beforeEach(() => {
    nextId = 1;
  });

  test('shows 10 tenders per page, moves through pages, and goes back to page 1 when a filter changes', async () => {
    serve(Array.from({ length: 25 }, (_, i) => tender({ name: `Tender ${String(i + 1).padStart(2, '0')}`, lastDate: inDays(1 + i % 20), score: 90 - i })));
    const { container } = render(<Dashboard />);
    await screen.findByText('Showing 1-10 of 25 tenders');
    expect(container.querySelectorAll('article.item')).toHaveLength(10);
    fireEvent.click(screen.getByRole('button', { name: 'Page 3' }));
    expect(screen.getByText('Showing 21-25 of 25 tenders')).toBeInTheDocument();
    expect(container.querySelectorAll('article.item')).toHaveLength(5);
    fireEvent.change(screen.getByLabelText('Search tenders'), { target: { value: 'Tender 0' } });
    expect(await screen.findByText(/Showing 1-9 of 9 tenders/)).toBeInTheDocument();
  });

  test('clicking a chart column filters the list to that day, shows a chip, and the chip clears it', async () => {
    serve([tender({ name: 'Closes in two days', lastDate: inDays(2) }), tender({ name: 'Closes in ten days', lastDate: inDays(10) })]);
    render(<Dashboard />);
    await screen.findByText('Closes in ten days');
    fireEvent.click(screen.getAllByRole('button', { name: /1 tender closing$/ })[0]); // the earlier day: in two days
    expect(screen.queryByText('Closes in ten days')).not.toBeInTheDocument();
    expect(screen.getByText('Closes in two days')).toBeInTheDocument();
    expect(screen.getByText(/^Closing on /)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear the date filter' }));
    expect(await screen.findByText('Closes in ten days')).toBeInTheDocument();
  });
});
