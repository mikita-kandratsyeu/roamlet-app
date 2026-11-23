import { render } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { Look } from '../theme';
import { NewYearSnow } from './NewYearSnow';

const useTheme = vi.fn(() => ({ look: 'default' as Look }));

vi.mock('../theme', () => ({
  useTheme: () => useTheme(),
}));

it('renders snow only when the new year look is active', () => {
  const { rerender } = render(<NewYearSnow />);
  expect(document.querySelector('.newyear-snow')).not.toBeInTheDocument();

  useTheme.mockReturnValue({ look: 'newyear' as Look });
  rerender(<NewYearSnow />);
  expect(document.querySelector('.newyear-snow')).toBeInTheDocument();
  expect(document.querySelectorAll('.newyear-snowflake').length).toBeGreaterThan(10);
});