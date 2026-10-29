import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
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

it('uses the same animated library portal with configurable messages and cancellation', () => {
  const cancel = vi.fn();
  const { container } = render(
    <MapLoader
      purpose="library"
      ariaLabel="Opening your library…"
      title="Opening your library…"
      description="Loading locally saved routes."
      onCancel={cancel}
    />,
  );
  const panel = screen.getByTestId('panel-loader');
  expect(panel.parentElement).toBe(document.body);
  expect(panel).toContainElement(screen.getByTestId('global-map-loader'));
  expect(container).toBeEmptyDOMElement();
  expect(screen.getByRole('status', { name: 'Opening your library…' })).toHaveTextContent(
    'Loading locally saved routes.',
  );
  expect(panel.querySelector('.global-map-loader__orbit')).toBeInTheDocument();
  expect(panel.querySelector('.global-map-loader__track')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Back to map' }));
  expect(cancel).toHaveBeenCalledOnce();
});
it('shows one portal for concurrent map and library requests and unlocks only after both finish', () => {
  const background = document.createElement('div');
  const button = document.createElement('button');
  background.append(button);
  document.body.append(background);
  button.focus();
  const overflow = document.body.style.overflow;
  const previousInert = background.inert;
  function Loaders({ map, library }: { map: boolean; library: boolean }) {
    return (
      <>
        {map && <MapLoader />}
        {library && <MapLoader purpose="library" />}
      </>
    );
  }
  const view = render(<Loaders map library />);
  expect(screen.getAllByTestId('global-map-loader')).toHaveLength(1);
  expect(screen.getByTestId('global-map-loader')).toHaveAttribute('data-purpose', 'library');
  expect(background.inert).toBe(true);
  view.rerender(<Loaders map library={false} />);
  expect(screen.getAllByTestId('global-map-loader')).toHaveLength(1);
  expect(screen.getByTestId('global-map-loader')).toHaveAttribute('data-purpose', 'map');
  expect(screen.getByTestId('global-map-loader')).toHaveFocus();
  expect(background.inert).toBe(true);
  expect(document.body.style.overflow).toBe('hidden');
  view.rerender(<Loaders map={false} library={false} />);
  expect(screen.queryByTestId('global-map-loader')).not.toBeInTheDocument();
  expect(background.inert).toBe(previousInert);
  expect(document.body.style.overflow).toBe(overflow);
  expect(button).toHaveFocus();
  background.remove();
});
it('keeps the library portal mounted when the earlier map request finishes first', () => {
  const map = render(<MapLoader />);
  const library = render(<MapLoader purpose="library" />);
  expect(screen.getAllByTestId('global-map-loader')).toHaveLength(1);
  map.unmount();
  expect(screen.getByTestId('panel-loader')).toBeInTheDocument();
  expect(screen.getByTestId('global-map-loader')).toHaveFocus();
  expect(document.body.style.overflow).toBe('hidden');
  library.unmount();
  expect(screen.queryByTestId('global-map-loader')).not.toBeInTheDocument();
});
it('protects new background roots while active and preserves their previous inert state', async () => {
  const view = render(<MapLoader />);
  const background = document.createElement('div');
  background.inert = false;
  document.body.append(background);
  await waitFor(() => expect(background.inert).toBe(true));
  view.unmount();
  expect(background.inert).toBe(false);
  background.remove();
});
it('cleans up the shared portal and background lock under StrictMode', () => {
  const overflow = document.body.style.overflow;
  const view = render(
    <StrictMode>
      <MapLoader />
      <MapLoader purpose="library" />
    </StrictMode>,
  );
  expect(screen.getAllByTestId('global-map-loader')).toHaveLength(1);
  view.unmount();
  expect(screen.queryByTestId('global-map-loader')).not.toBeInTheDocument();
  expect(document.body.style.overflow).toBe(overflow);
});
