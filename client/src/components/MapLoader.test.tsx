import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { MapLoader } from './MapLoader';

afterEach(cleanup);
it('locks background interaction and restores focus, inert state and scrolling', () => {
  const background = document.createElement('div');
  const button = document.createElement('button');
  background.append(button);
  document.body.append(background);
  button.focus();
  const previous = document.body.style.overflow;
  const previousInert = background.inert;
  const { unmount } = render(<MapLoader />);
  expect(background.inert).toBe(true);
  expect(document.body.style.overflow).toBe('hidden');
  expect(screen.getByTestId('global-map-loader')).toHaveFocus();
  expect(screen.getByRole('status')).toHaveTextContent('Loading map');
  unmount();
  expect(background.inert).toBe(previousInert);
  expect(document.body.style.overflow).toBe(previous);
  expect(button).toHaveFocus();
  background.remove();
});
