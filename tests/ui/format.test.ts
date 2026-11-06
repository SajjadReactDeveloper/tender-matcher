import { describe, expect, test } from 'vitest';
import { colorClass, daysLeft, safeHref, verdictOf, whyOf } from '@/components/format';

const iso = (offsetDays: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

describe('format helpers', () => {
  test('daysLeft counts calendar days from today: 0 today, 1 tomorrow, negative when closed', () => {
    expect(daysLeft(iso(0))).toBe(0);
    expect(daysLeft(iso(1))).toBe(1);
    expect(daysLeft(iso(-3))).toBe(-3);
  });

  test('verdictOf reads Bid, Consider or Skip from the start of the recommendation, otherwise empty', () => {
    expect(verdictOf({ recommendation: 'Bid – fits us' })).toBe('Bid');
    expect(verdictOf({ recommendation: '  skip. not core' })).toBe('Skip');
    expect(verdictOf({ recommendation: 'Maybe later' })).toBe('');
    expect(verdictOf({ recommendation: '' })).toBe('');
  });

  test('whyOf drops the verdict word and capitalises the reason', () => {
    expect(whyOf({ recommendation: 'Consider - we must verify the partnership' })).toBe('We must verify the partnership');
  });

  test('colorClass only ever returns High, Medium or Low (it ends up in a class name)', () => {
    expect(colorClass('High')).toBe('High');
    expect(colorClass('Medium')).toBe('Medium');
    expect(colorClass('"><script>')).toBe('Low');
  });

  test('safeHref allows only http and https links', () => {
    expect(safeHref('https://epms.ppra.gov.pk/x')).toBe('https://epms.ppra.gov.pk/x');
    expect(safeHref('javascript:alert(1)')).toBeUndefined();
    expect(safeHref('//evil.com')).toBeUndefined();
    expect(safeHref('')).toBeUndefined();
  });
});
