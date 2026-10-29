import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { optionalLazy } from './OptionalPanel';
afterEach(cleanup);
it('keeps the surrounding UI usable and retries an optional loader after failure', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const loader = vi.fn().mockRejectedValueOnce(new Error('Offline')).mockResolvedValue({ default: () => <p>Panel loaded</p> });
  const Panel = optionalLazy(loader);
  const action = vi.fn();
  render(<><button onClick={action}>Editor action</button><Panel /></>);
  expect(await screen.findByRole('alert')).toHaveTextContent('panel could not be loaded');
  fireEvent.click(screen.getByText('Editor action'));
  expect(action).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByText('Retry panel'));
  expect(await screen.findByText('Panel loaded')).toBeInTheDocument();
  expect(loader).toHaveBeenCalledTimes(2);
});
