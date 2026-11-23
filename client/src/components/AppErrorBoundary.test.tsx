import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { lazy, Suspense, type ComponentType } from 'react';
import { AppErrorBoundary } from './AppErrorBoundary';

let allowRender = false;

const GatedPanel = lazy(async () => ({
  default: function GatedPanel() {
    if (!allowRender) throw new Error('Render failed');
    return <p>Planner ready</p>;
  } as ComponentType,
}));

const BrokenPanel = lazy(async () => ({
  default: function BrokenPanel() {
    throw new Error('Render failed');
  } as ComponentType,
}));

afterEach(() => {
  allowRender = false;
  vi.restoreAllMocks();
});

it('shows a recovery screen after a render failure and remounts on retry', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  render(
    <AppErrorBoundary>
      <Suspense fallback={null}>
        <GatedPanel />
      </Suspense>
    </AppErrorBoundary>,
  );
  expect(await screen.findByRole('alert')).toHaveTextContent('saved routes remain');
  allowRender = true;
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('Planner ready')).toBeInTheDocument();
});

it('reloads the page from the recovery screen', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const reload = vi.fn();
  vi.stubGlobal('location', { ...window.location, reload });
  render(
    <AppErrorBoundary>
      <Suspense fallback={null}>
        <BrokenPanel />
      </Suspense>
    </AppErrorBoundary>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Reload app' }));
  expect(reload).toHaveBeenCalledOnce();
  vi.unstubAllGlobals();
});

it('enters the failed state when a child throws', () => {
  expect(AppErrorBoundary.getDerivedStateFromError()).toEqual({ failed: true });
});