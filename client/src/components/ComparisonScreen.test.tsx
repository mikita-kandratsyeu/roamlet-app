import { useState, type ComponentProps } from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import type { PlannedRoute } from '../domain/types';
import { ComparisonScreen } from './ComparisonScreen';
import type { RouteMap } from './RouteMap';
import { ROUTE_COMPARISON_COLORS } from './RouteComparison';

const mapProps = vi.hoisted(() => ({ current: null as ComponentProps<typeof RouteMap> | null }));
vi.mock('./RouteMap', () => ({
  RouteMap: (props: ComponentProps<typeof RouteMap>) => {
    mapProps.current = props;
    return (
      <div data-testid="comparison-map">
        <button onClick={() => props.onError('Map unavailable')}>Simulate map error</button>
      </div>
    );
  },
}));

const routes: PlannedRoute[] = ['Lake', 'Forest', 'Ridge'].map((name, index) => ({
  id: name,
  name,
  description: '',
  activity: 'hiking',
  segments: [
    [
      [10 + index, 20],
      [10.1 + index, 20.1],
    ],
    [
      [12 + index, 21],
      [12.1 + index, 21.1],
    ],
  ],
  waypoints: [],
  stats: { distance: 2000, duration: 3600 },
  source: index === 0 ? 'manual' : 'gpx',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}));

function Harness({ online = true }: { online?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Compare routes</button>
      {open && <ComparisonScreen routes={routes} online={online} onClose={() => setOpen(false)} />}
    </>
  );
}
async function open(online = true) {
  const user = userEvent.setup();
  render(<Harness online={online} />);
  await user.click(screen.getByRole('button', { name: 'Compare routes' }));
  return user;
}
afterEach(cleanup);

it('opens a full-screen workspace and restores focus after Back or Escape', async () => {
  const user = await open();
  const trigger = screen.getByRole('button', { name: 'Compare routes', hidden: true });
  expect(screen.getByRole('dialog', { name: 'Compare saved routes' })).toHaveClass(
    'comparison-screen',
  );
  expect(screen.getByRole('button', { name: 'Back to routes' })).toHaveFocus();
  await user.click(screen.getByRole('button', { name: 'Back to routes' }));
  expect(trigger).toHaveFocus();
  await user.click(trigger);
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});

it('shows activity and saved metrics on route cards, with selection on the whole card', async () => {
  const user = await open();
  const card = within(screen.getByRole('list', { name: 'Routes to compare' })).getAllByRole(
    'listitem',
  )[0];
  expect(within(card).getByText('Hiking')).toBeVisible();
  expect(within(card).getByText('2.0 km')).toBeVisible();
  expect(within(card).getByText('1 h 0 min')).toBeVisible();
  await user.click(within(card).getByRole('button', { name: 'Focus route Lake' }));
  expect(card).toHaveAttribute('data-focused', 'true');
  await user.click(within(card).getByRole('checkbox'));
  expect(card).toHaveAttribute('data-focused', 'false');
  expect(card).toHaveAttribute('data-visible', 'false');
});

it('does not invent quick metrics for missing or invalid saved statistics', () => {
  render(
    <ComparisonScreen
      routes={[{ ...routes[0], stats: { distance: NaN, duration: 0 } }, routes[1]]}
      online={false}
      onClose={() => {}}
    />,
  );
  const card = within(screen.getByRole('list', { name: 'Routes to compare' })).getAllByRole(
    'listitem',
  )[0];
  expect(within(card).getAllByText('Not available')).toHaveLength(2);
});

it('hides geometry without changing route colors, segments or snapshots and retains one visible route', async () => {
  const original = JSON.stringify(routes);
  const user = await open();
  expect(mapProps.current?.comparisonMode).toBe(true);
  expect(mapProps.current?.editable).toBe(false);
  expect(mapProps.current?.comparisonLayers?.[1]).toEqual({
    segments: routes[0].segments,
    color: ROUTE_COMPARISON_COLORS[0],
    dashed: true,
  });
  await user.click(screen.getByRole('checkbox', { name: 'Show route Lake on map' }));
  expect(mapProps.current?.segments).toEqual(routes.slice(1).flatMap((route) => route.segments));
  expect(mapProps.current?.comparisonLayers?.map((layer) => layer.color)).toEqual([
    ROUTE_COMPARISON_COLORS[1],
    ROUTE_COMPARISON_COLORS[1],
    ROUTE_COMPARISON_COLORS[2],
    ROUTE_COMPARISON_COLORS[2],
  ]);
  await user.click(screen.getByRole('checkbox', { name: 'Show route Forest on map' }));
  expect(screen.getByRole('checkbox', { name: 'Show route Ridge on map' })).toBeDisabled();
  expect(JSON.stringify(routes)).toBe(original);
});

it('focuses even a hidden route and restores the combined view with Show all routes', async () => {
  const user = await open();
  await user.click(screen.getByRole('checkbox', { name: 'Show route Lake on map' }));
  const token = mapProps.current!.fitToken;
  await user.click(screen.getByRole('button', { name: 'Focus route Lake' }));
  expect(screen.getByRole('checkbox', { name: 'Show route Lake on map' })).toBeChecked();
  expect(screen.getByRole('button', { name: 'Focus route Lake' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(mapProps.current?.fitSegments).toEqual(routes[0].segments);
  expect(mapProps.current?.comparisonLayers?.at(-1)?.color).toBe(ROUTE_COMPARISON_COLORS[0]);
  expect(mapProps.current!.fitToken).toBeGreaterThan(token);
  const focusedToken = mapProps.current!.fitToken;
  await user.click(screen.getByRole('checkbox', { name: 'Show route Lake on map' }));
  expect(mapProps.current?.fitSegments).toEqual(routes.slice(1).flatMap((route) => route.segments));
  expect(mapProps.current!.fitToken).toBeGreaterThan(focusedToken);
  await user.click(screen.getByRole('checkbox', { name: 'Show route Forest on map' }));
  await user.click(screen.getByRole('button', { name: 'Show all routes' }));
  expect(mapProps.current?.fitSegments).toEqual(routes.flatMap((route) => route.segments));
  expect(screen.getByRole('checkbox', { name: 'Show route Forest on map' })).toBeChecked();
  expect(screen.getByRole('button', { name: 'Focus route Lake' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
});

it('collapses controls without remounting the map and preserves statistics disclosure', async () => {
  const user = await open();
  const map = screen.getByTestId('comparison-map');
  expect(screen.getByRole('table')).not.toBeVisible();
  await user.click(screen.getByText('Route statistics'));
  expect(screen.getByRole('table', { name: 'Saved route comparison' })).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Hide comparison panel' }));
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Show comparison panel' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  expect(screen.getByTestId('comparison-map')).toBe(map);
  await user.click(screen.getByRole('button', { name: 'Show comparison panel' }));
  expect(screen.getByRole('table')).toBeVisible();
  expect(screen.getByTestId('comparison-map')).toBe(map);
});

it('keeps local statistics available offline and map errors readable with the panel collapsed', async () => {
  const user = await open(false);
  expect(mapProps.current?.online).toBe(false);
  await user.click(screen.getByText('Route statistics'));
  expect(within(screen.getByRole('table')).getAllByRole('rowheader')).toHaveLength(3);
  await user.click(screen.getByRole('button', { name: 'Hide comparison panel' }));
  await user.click(screen.getByRole('button', { name: 'Simulate map error' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Map unavailable');
  await user.click(screen.getByRole('button', { name: 'Dismiss map notice' }));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
