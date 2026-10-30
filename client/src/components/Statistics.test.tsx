import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Coordinate, PlannedRoute } from '../domain/types';
import { calculateStats } from '../domain/stats';
import { Statistics } from './Statistics';
import i18n from '../i18n';
import * as timeDomain from '../domain/time';

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

it('does not recalculate personal time when only the elevation selection changes', () => {
  const snapshot = route([[[11, 47, 100], [11.01, 47.01, 150]]]);
  const calculate = vi.spyOn(timeDomain, 'estimatePersonalTime');
  const { rerender } = render(<Statistics route={snapshot} speedKmh={18} elevationOpen={false} />);
  calculate.mockClear();
  rerender(<Statistics route={snapshot} speedKmh={18} elevationOpen={true} />);
  expect(calculate).not.toHaveBeenCalled();
  rerender(<Statistics route={snapshot} speedKmh={12} elevationOpen={true} />);
  expect(calculate).toHaveBeenCalledOnce();
  calculate.mockRestore();
});

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

it.each([false, true])(
  'shows a collapsed terrain preview, including flat routes (flat: %s)',
  async (flat) => {
    const snapshot = route([
      [
        [11, 47, 100],
        [11.01, 47.01, flat ? 100 : 160],
        [11.02, 47.02, 100],
      ],
      [
        [12, 48, 100],
        [12.01, 48.01, flat ? 100 : 130],
      ],
    ]);
    const { container, rerender } = render(<Statistics route={snapshot} elevationOpen={false} />);
    const preview = container.querySelector('.elevation-preview')!;
    expect(preview).toBeInTheDocument();
    expect(preview.closest('summary')).toHaveTextContent('Elevation profile');
    expect(preview).toHaveAttribute('aria-hidden', 'true');
    expect(preview.querySelectorAll('g')).toHaveLength(2);
    for (const path of preview.querySelectorAll('path')) {
      expect(path.getAttribute('d')).not.toMatch(/NaN|Infinity/);
    }
    const lines = preview.querySelectorAll('path[fill="none"]');
    expect(lines[0].getAttribute('d')).toContain(flat ? ',16.00' : ',3.00');
    expect(screen.queryByTestId('elevation-chart')).not.toBeInTheDocument();
    expect(screen.queryByTestId('panel-loader')).not.toBeInTheDocument();
    rerender(<Statistics route={snapshot} elevationOpen />);
    expect(container.querySelector('.elevation-preview')).not.toBeInTheDocument();
    expect(await screen.findByTestId('elevation-chart')).toBeInTheDocument();
    rerender(<Statistics route={snapshot} elevationOpen={false} />);
    expect(screen.queryByTestId('elevation-chart')).not.toBeInTheDocument();
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
  const moving = screen.getByText('Personal moving time').closest('div')!;
  const total = screen.getByText('Total time with stops').closest('div')!;
  expect(moving).toHaveTextContent('42 min – 1 h 30 min');
  expect(total).toHaveTextContent('57 min – 1 h 45 min');
  expect(moving.querySelectorAll('.stat-time-bound')).toHaveLength(2);
  expect(total.querySelectorAll('.stat-time-bound')).toHaveLength(2);
  expect(
    screen.getByText(
      'The range is a rough planning estimate, not a statistical confidence interval or a guarantee.',
    ),
  ).toBeInTheDocument();
  expect(
    screen.getByText(
      i18n.t('Complete GPX heights unavailable: climbing is not included; the range is wider.'),
    ),
  ).toBeInTheDocument();
  expect(snapshot.stats.duration).toBe(1800);
});

for (const desktop of [false, true]) {
  it(`hides unavailable profiles and removes them after changing routes (desktop: ${desktop})`, async () => {
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
    const { container, rerender } = render(<Statistics route={route(complete)} elevationOpen />);
    expect(screen.getByText('Elevation profile')).toBeInTheDocument();
    expect(await screen.findByTestId('elevation-chart')).toBeInTheDocument();
    expect(container.querySelector('.statistics .elevation-box')).toBeInTheDocument();
    expect(portal).toBeEmptyDOMElement();
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

it.each(['openrouteservice', 'mapbox'] as const)(
  'shows %s provider duration independently while personal settings change',
  (source) => {
    const snapshot = {
      ...route([
        [
          [0, 0, 0],
          [0.01, 0, 600],
        ],
      ]),
      source,
      stats: { distance: 18000, duration: 1800, ascent: 600 },
    };
    const original = structuredClone(snapshot);
    const { rerender } = render(
      <Statistics
        route={snapshot}
        speedKmh={18}
        stopsMinutes={15}
        fitness="regular"
        surface="paved"
      />,
    );
    expect(screen.getByText('Provider estimate')).toBeInTheDocument();
    expect(screen.getByText('30 min')).toBeInTheDocument();
    const moving = screen.getByText('Personal moving time').closest('div')!;
    expect(moving).toHaveTextContent('48 min – 1 h 24 min');
    rerender(
      <Statistics
        route={snapshot}
        speedKmh={12}
        stopsMinutes={20}
        fitness="beginner"
        surface="rough"
      />,
    );
    expect(screen.getByText('30 min')).toBeInTheDocument();
    expect(moving).not.toHaveTextContent('48 min – 1 h 24 min');
    expect(snapshot).toEqual(original);
  },
);
it('states manual straight-distance and missing-height limitations without changing original data', () => {
  const snapshot = {
    ...route([
      [
        [0, 0],
        [0.01, 0],
      ],
    ]),
    source: 'manual' as const,
  };
  const original = structuredClone(snapshot);
  render(<Statistics route={snapshot} speedKmh={18} />);
  expect(
    screen.getByText('Manual straight-line distance may underestimate the actual path.'),
  ).toBeInTheDocument();
  expect(
    screen.getByText(
      i18n.t('Complete GPX heights unavailable: climbing is not included; the range is wider.'),
    ),
  ).toBeInTheDocument();
  expect(snapshot).toEqual(original);
});
it('shows finite-estimate fallback instead of infinity when inputs overflow', () => {
  render(
    <Statistics
      route={route([
        [
          [0, 0],
          [0.01, 0],
        ],
      ])}
      speedKmh={Number.MIN_VALUE}
    />,
  );
  expect(screen.getByRole('status')).toHaveTextContent(
    'Personal estimate unavailable for these inputs.',
  );
  expect(screen.queryByText('Personal moving time')).not.toBeInTheDocument();
});

it('uses the larger provider estimate as an explicit planning reference even for fast personal pace', () => {
  const snapshot = {
    ...route([
      [
        [0, 0],
        [0.01, 0],
      ],
    ]),
    source: 'openrouteservice' as const,
    stats: { distance: 1344, duration: 3600 },
  };
  render(<Statistics route={snapshot} speedKmh={18} stopsMinutes={15} />);
  expect(screen.getByText('Provider estimate')).toBeInTheDocument();
  expect(screen.getByText('1 h 0 min')).toBeInTheDocument();
  expect(screen.getByText('Planning reference')).toBeInTheDocument();
  expect(screen.getByText('1 h 15 min')).toBeInTheDocument();
  expect(
    screen.getByText(
      'Planning reference takes the longer moving estimate (provider or personal), then adds stops once.',
    ),
  ).toBeInTheDocument();
  expect(snapshot.stats.duration).toBe(3600);
});

it('keeps the elevation profile collapsed while its geometry changes', () => {
  const onOpen = vi.fn();
  const onHover = vi.fn();
  const first = route([
    [
      [11, 47, 100],
      [11.01, 47.01, 120],
    ],
  ]);
  const { rerender } = render(
    <Statistics route={first} onElevationOpenChange={onOpen} onElevationHover={onHover} />,
  );
  const summary = screen.getByText('Elevation profile').closest('summary')!;
  fireEvent.click(summary);
  expect(summary.closest('details')).not.toHaveAttribute('open');
  expect(onOpen).toHaveBeenCalledWith(false);
  expect(onHover).toHaveBeenLastCalledWith(null);
  rerender(
    <Statistics
      route={route([
        [
          [11, 47, 100],
          [11.02, 47.02, 140],
        ],
      ])}
      onElevationOpenChange={onOpen}
    />,
  );
  expect(screen.getByText('Elevation profile').closest('details')).not.toHaveAttribute('open');
});
