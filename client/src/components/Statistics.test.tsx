import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Coordinate, PlannedRoute } from '../domain/types';
import { calculateStats } from '../domain/stats';
import { Statistics } from './Statistics';

vi.mock('./ui/chart', () => ({
  ChartContainer: () => <div data-testid="elevation-chart" />,
  ChartTooltip: () => null,
  ChartTooltipContent: () => null,
}));

afterEach(() => {
  cleanup();
  document.getElementById('map-elevation-root')?.remove();
  vi.unstubAllGlobals();
});

function route(segments: Coordinate[][]): PlannedRoute {
  return {
    id: 'test-route',
    name: 'Test route',
    description: '',
    activity: 'cycling',
    waypoints: [],
    segments,
    stats: calculateStats(segments, 'cycling'),
    createdAt: '2026-10-28T00:00:00Z',
    updatedAt: '2026-10-28T00:00:00Z',
    source: 'gpx',
  };
}

it.each(['openrouteservice', 'mapbox'] as const)(
  'hides elevation metrics for %s snapshots even when old data contains heights',
  (source) => {
    const snapshot = route([
      [
        [31, 52, 100],
        [31.01, 52.01, 125],
      ],
    ]);
    render(<Statistics route={{ ...snapshot, source }} />);
    expect(screen.getByText('Distance')).toBeInTheDocument();
    expect(screen.queryByText('Elevation gain')).not.toBeInTheDocument();
    expect(screen.queryByText('Elevation loss')).not.toBeInTheDocument();
    expect(screen.queryByText('Elevation profile')).not.toBeInTheDocument();
    expect(screen.queryByText('Unavailable')).not.toBeInTheDocument();
    expect(
      screen.getByText(source === 'mapbox' ? 'Mapbox' : 'OpenRouteService'),
    ).toBeInTheDocument();
  },
);

it('shows personal movement and total while retaining the original duration estimate', () => {
  const snapshot = route([
    [
      [11, 47],
      [11.01, 47.01],
    ],
  ]);
  snapshot.stats = { distance: 18000, duration: 1800 };
  render(<Statistics route={snapshot} speedKmh={18} stopsMinutes={15} />);
  expect(screen.getByText('Original time estimate')).toBeInTheDocument();
  expect(screen.getByText('30 min')).toBeInTheDocument();
  expect(screen.getByText('1 h 0 min')).toBeInTheDocument();
  expect(screen.getByText('1 h 15 min')).toBeInTheDocument();
  expect(snapshot.stats.duration).toBe(1800);
});

for (const desktop of [false, true]) {
  it(`hides unavailable profiles and removes them after changing routes (desktop: ${desktop})`, () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(min-width: 1025px)' ? desktop : !desktop,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    const portal = document.createElement('div');
    portal.id = 'map-elevation-root';
    document.body.append(portal);
    const complete: Coordinate[][] = [
      [
        [11, 47, 0],
        [11.01, 47.01, 0],
      ],
    ];
    const { rerender } = render(<Statistics route={route(complete)} />);
    expect(screen.getByText('Elevation profile')).toBeInTheDocument();
    expect(screen.getByTestId('elevation-chart')).toBeInTheDocument();
    expect(portal.querySelector('.elevation-box') !== null).toBe(desktop);
    for (const segments of [
      [
        [
          [11, 47],
          [11.01, 47.01],
        ],
      ],
      [
        [
          [11, 47, 10],
          [11.01, 47.01],
        ],
      ],
      [[[11, 47, 10]]],
      [],
    ] as Coordinate[][][]) {
      rerender(<Statistics route={route(segments)} />);
      expect(screen.queryByText('Elevation gain')).not.toBeInTheDocument();
      expect(screen.queryByText('Elevation loss')).not.toBeInTheDocument();
      expect(screen.queryByText('Elevation profile')).not.toBeInTheDocument();
      expect(screen.queryByTestId('elevation-chart')).not.toBeInTheDocument();
      expect(portal).toBeEmptyDOMElement();
      expect(screen.getByText('Distance')).toBeInTheDocument();
    }
    rerender(<Statistics route={route(complete)} />);
    expect(screen.getByText('Elevation profile')).toBeInTheDocument();
    rerender(<Statistics route={null} />);
    expect(portal).toBeEmptyDOMElement();
  });
}
