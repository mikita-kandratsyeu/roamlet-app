import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import type { PlannedRoute } from '../domain/types';
import { RouteComparison, ROUTE_COMPARISON_COLORS } from './RouteComparison';

function route(id: string, patch: Partial<PlannedRoute> = {}): PlannedRoute {
  return {
    id,
    name: `Route ${id}`,
    description: '',
    activity: 'hiking',
    segments: [
      [
        [10, 20, 100],
        [10.1, 20.1, 120],
      ],
    ],
    waypoints: [],
    stats: { distance: 2500, duration: 3600, ascent: 20, descent: 0 },
    source: 'gpx',
    createdAt: '2026-01-01T12:00:00Z',
    updatedAt: '2026-01-01T12:00:00Z',
    ...patch,
  };
}
afterEach(cleanup);
const cells = (name: string) =>
  within(screen.getByRole('rowheader', { name }).closest('tr')!).getAllByRole('cell');

it('renders a pure, labelled statistics table and numbered palette legend in route order', () => {
  const routes = [
    route('a'),
    route('b', {
      activity: 'cycling',
      source: 'openrouteservice',
      elevationSource: 'openrouteservice',
    }),
    route('c', { source: 'mapbox' }),
  ];
  const original = JSON.stringify(routes);
  render(<RouteComparison routes={routes} />);
  const table = screen.getByRole('table', { name: 'Saved route comparison' });
  expect(within(table).getAllByRole('row')).toHaveLength(4);
  expect(
    within(table)
      .getAllByRole('columnheader')
      .map((cell) => cell.textContent),
  ).toEqual(['Route', 'Activity', 'Distance', 'Ascent', 'Descent', 'Source', 'Original duration']);
  const values = cells('1. Route a');
  expect(values[0]).toHaveTextContent('Hiking');
  expect(values[1]).toHaveTextContent('2.5 km');
  expect(values[2]).toHaveTextContent('20 m');
  expect(values[3]).toHaveTextContent('0 m');
  expect(values[4]).toHaveTextContent('GPX import');
  expect(values[5]).toHaveTextContent('1 h 0 min');
  expect(cells('2. Route b')[4]).toHaveTextContent('OpenRouteService');
  expect(cells('3. Route c')[4]).toHaveTextContent('Mapbox');
  const legend = within(screen.getByRole('list', { name: 'Route colors' })).getAllByRole(
    'listitem',
  );
  legend.forEach((item, index) => {
    expect(item).toHaveTextContent(`${index + 1}. ${routes[index].name}`);
    expect(item.querySelector('.route-comparison-color')).toHaveStyle({
      backgroundColor: ROUTE_COMPARISON_COLORS[index],
    });
  });
  expect(
    screen.getByText('Mixed activities: durations are not directly comparable.'),
  ).toBeVisible();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  expect(JSON.stringify(routes)).toBe(original);
});

it('hides untrusted, incomplete and missing elevations without estimating from coordinates', () => {
  render(
    <RouteComparison
      routes={[
        route('manual', { source: 'manual' }),
        route('partial', {
          segments: [
            [
              [10, 20, 100],
              [10.1, 20.1],
            ],
          ],
        }),
        route('missing', { stats: { distance: 1000, duration: 0 } }),
      ]}
    />,
  );
  for (const name of ['1. Route manual', '2. Route partial', '3. Route missing']) {
    expect(cells(name)[2]).toHaveTextContent('Not available');
    expect(cells(name)[3]).toHaveTextContent('Not available');
  }
  expect(cells('3. Route missing')[5]).toHaveTextContent('Not available');
  expect(
    screen.getByText(
      'Saved duration, not a personal estimate. Missing or incomplete elevation is not estimated.',
    ),
  ).toBeVisible();
});

it('accepts explicitly attributed provider elevations and reports each missing statistic independently', () => {
  render(
    <RouteComparison
      routes={[
        route('provider', {
          source: 'mixed',
          elevationSource: 'openrouteservice',
          stats: { distance: 0, duration: 90, ascent: 0 },
        }),
        route('invalid', {
          stats: { distance: NaN, duration: Infinity, ascent: -5, descent: Infinity },
        }),
      ]}
    />,
  );
  const values = cells('1. Route provider');
  expect(values[1]).toHaveTextContent('0.0 km');
  expect(values[2]).toHaveTextContent('0 m');
  expect(values[3]).toHaveTextContent('Not available');
  expect(values[4]).toHaveTextContent('Mixed sources');
  expect(values[5]).toHaveTextContent('2 min');
  for (const column of [1, 2, 3, 5])
    expect(cells('2. Route invalid')[column]).toHaveTextContent('Not available');
  expect(
    screen.queryByText('Mixed activities: durations are not directly comparable.'),
  ).not.toBeInTheDocument();
});

it('does not claim an empty or singleton profile has eligible elevation', () => {
  render(
    <RouteComparison
      routes={[route('empty', { segments: [] }), route('single', { segments: [[[10, 20, 0]]] })]}
    />,
  );
  expect(cells('1. Route empty')[2]).toHaveTextContent('Not available');
  expect(cells('2. Route single')[2]).toHaveTextContent('Not available');
});

it('renders all five routes with distinct numbered colors without truncation', () => {
  render(<RouteComparison routes={['a', 'b', 'c', 'd', 'e'].map((id) => route(id))} />);
  expect(within(screen.getByRole('table')).getAllByRole('rowheader')).toHaveLength(5);
  const legend = within(screen.getByRole('list', { name: 'Route colors' })).getAllByRole(
    'listitem',
  );
  expect(legend).toHaveLength(5);
  expect(new Set(ROUTE_COMPARISON_COLORS).size).toBe(5);
  legend.forEach((item, index) =>
    expect(item.querySelector('.route-comparison-color')).toHaveStyle({
      backgroundColor: ROUTE_COMPARISON_COLORS[index],
    }),
  );
});

it('requires 2–5 distinct routes rather than silently truncating or inventing entries', () => {
  const { rerender } = render(<RouteComparison routes={[]} />);
  for (const routes of [
    [],
    [route('a')],
    [route('a'), route('a')],
    ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => route(id)),
  ]) {
    rerender(<RouteComparison routes={routes} />);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByText('Select 2–5 different saved routes to compare.')).toBeVisible();
  }
});
