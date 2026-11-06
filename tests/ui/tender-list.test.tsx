// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { TenderList } from '@/components/TenderList';
import type { TenderView } from '@/domain/types';

afterEach(cleanup);

const tender = (over: Partial<TenderView> = {}): TenderView => ({
  id: 1, source: 'ppra', externalId: 'T1', refNo: 'R1', url: 'https://epms.ppra.gov.pk/t1', postingDate: '2026-11-01', lastDate: '2099-01-01', closingTime: '10:00',
  department: 'Ministry of IT', office: '', location: '', name: 'Build a portal', category: '', sector: '', nature: '', type: '', relevance: 'High', score: 81,
  recommendation: 'Bid - fits', challenges: 'Need certificate', scope: 'Portal scope', contact: '', bidSecurity: '', bidValidity: '', procedure: '',
  docs: { advertisement: '', tender: 'https://epms.ppra.gov.pk/pdf?file=x', pagesRead: 2 }, ...over,
});
const props = { tenders: [] as TenderView[], hasAny: false, loading: false, error: '', openId: null as number | null, onToggle: vi.fn(), onRetry: vi.fn() };

describe('TenderList', () => {
  test('shows the empty state when nothing has matched yet', () => {
    render(<TenderList {...props} />);
    expect(screen.getByText('No matched tenders yet')).toBeInTheDocument();
  });

  test('shows "nothing matches" when tenders exist but the filters hide them all', () => {
    render(<TenderList {...props} hasAny />);
    expect(screen.getByText('Nothing matches these filters')).toBeInTheDocument();
  });

  test('shows skeleton rows while loading, and no empty-state text', () => {
    const { container } = render(<TenderList {...props} loading />);
    expect(container.querySelectorAll('.sk-row').length).toBeGreaterThan(0);
    expect(screen.queryByText('No matched tenders yet')).not.toBeInTheDocument();
  });

  test('shows the error with a Try again button that calls onRetry', () => {
    const onRetry = vi.fn();
    render(<TenderList {...props} error="Cannot reach the app." onRetry={onRetry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Cannot reach the app.');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  test('renders a tender with its score and verdict, and toggles its detail on click', () => {
    const onToggle = vi.fn();
    render(<TenderList {...props} tenders={[tender()]} hasAny onToggle={onToggle} />);
    expect(screen.getByText('Build a portal')).toBeInTheDocument();
    expect(screen.getByText('81')).toBeInTheDocument();
    expect(screen.getByText('Bid')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Build a portal/ }));
    expect(onToggle).toHaveBeenCalledWith(1);
  });

  test('an open tender shows scope and challenges, and links only to safe URLs', () => {
    render(<TenderList {...props} tenders={[tender({ url: 'javascript:alert(1)' })]} hasAny openId={1} />);
    expect(screen.getByText('Portal scope')).toBeInTheDocument();
    expect(screen.getByText('Need certificate')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'PPRA page' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Tender document' })).toHaveAttribute('href', 'https://epms.ppra.gov.pk/pdf?file=x');
  });

  test('a tender with no closing date says so instead of showing Invalid Date', () => {
    render(<TenderList {...props} tenders={[tender({ lastDate: '' })]} hasAny />);
    expect(screen.getByText('No closing date')).toBeInTheDocument();
    expect(screen.queryByText(/Invalid Date/)).not.toBeInTheDocument();
  });

  test('tender text is rendered as text, never as HTML', () => {
    const { container } = render(<TenderList {...props} tenders={[tender({ name: '<img src=x onerror=alert(1)>' })]} hasAny />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
  });
});
