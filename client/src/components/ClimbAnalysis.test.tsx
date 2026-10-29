import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import i18n from '../i18n';
import { analyzeClimbs } from '../domain/climbs';
import type { Coordinate, PlannedRoute } from '../domain/types';
import { ClimbAnalysis } from './ClimbAnalysis';

const unavailable = 'Climb analysis unavailable: complete GPX or marked ORS heights required.';
function route(
  segments: Coordinate[][] = [
    [
      [0, 0, 0],
      [0.001, 0, 10],
      [0.002, 0, 20],
      [0.003, 0, 30],
    ],
    [
      [1, 0, 50],
      [1.001, 0, 60],
      [1.002, 0, 70],
      [1.003, 0, 80],
    ],
  ],
): PlannedRoute {
  return {
    id: 'climbs',
    name: '',
    description: '',
    activity: 'hiking',
    waypoints: [],
    segments,
    source: 'gpx',
    stats: { distance: 1, duration: 1 },
    createdAt: '',
    updatedAt: '',
  };
}

afterEach(() => {
  cleanup();
  i18n.removeResourceBundle('ru', 'climb-test');
  void i18n.changeLanguage('en');
});

it('renders calculated metrics, thresholds and distinctly labels net grade', () => {
  render(<ClimbAnalysis route={route()} />);
  expect(screen.getByRole('region', { name: 'Climb analysis' })).toBeInTheDocument();
  expect(screen.getAllByRole('button')).toHaveLength(2);
  expect(screen.getAllByText('Filtered ascent (net gain): 30 m')).toHaveLength(2);
  expect(screen.getAllByText('Average grade (net gain / length): 9%')).toHaveLength(2);
  expect(screen.getByText('≥300 m · ≥20 m gain')).toHaveAttribute('data-slot', 'badge');
  expect(screen.getByRole('region', { name: 'Climb analysis' })).toHaveAccessibleDescription(
    '≥300 m · ≥20 m gain',
  );
  expect(screen.getByText('Route interval: 0 m–334 m')).toBeInTheDocument();
  expect(screen.getByText('Route interval: 334 m–667 m')).toBeInTheDocument();
});

it('puts results before collapsed detection help, including the ORS disclaimer', async () => {
  const user = userEvent.setup();
  const { container } = render(
    <ClimbAnalysis route={{ ...route(), source: 'mixed', elevationSource: 'openrouteservice' }} />,
  );
  const summary = screen.getByText('How climbs are detected');
  const details = summary.closest('details')!;
  expect(summary.closest('summary')).toHaveClass('section-heading');
  expect(details).toHaveClass('planner-disclosure');
  const icon = details.querySelector('.disclosure-toggle')!;
  expect(icon).toHaveAttribute('aria-hidden', 'true');
  expect(icon.querySelector('svg')).toHaveAttribute('width', '18');
  const explanation = screen.getByText(/Drops over 3 m split climbs/);
  const disclaimer = screen.getByText(
    'ORS terrain heights are estimates, not measured trail elevations.',
  );
  expect(details).not.toHaveAttribute('open');
  expect(explanation).not.toBeVisible();
  expect(disclaimer).not.toBeVisible();
  expect(container.querySelector('.climb-analysis__list')?.nextElementSibling).toBe(details);
  await user.click(summary);
  expect(details).toHaveAttribute('open');
  expect(explanation).toBeVisible();
  expect(disclaimer).toBeVisible();
  await user.click(summary);
  expect(explanation).not.toBeVisible();
});

it('supports keyboard selection, switching and toggling off with exact geometry', async () => {
  const user = userEvent.setup();
  const snapshot = route();
  const highlight = vi.fn();
  render(<ClimbAnalysis route={snapshot} onHighlight={highlight} />);
  expect(highlight).toHaveBeenLastCalledWith([]);
  const [first, second] = screen.getAllByRole('button');
  await user.tab();
  expect(first).toHaveFocus();
  await user.keyboard('{Enter}');
  expect(first).toHaveAttribute('aria-pressed', 'true');
  expect(highlight).toHaveBeenLastCalledWith(analyzeClimbs(snapshot).climbs[0].geometry);
  await user.tab();
  await user.keyboard(' ');
  expect(first).toHaveAttribute('aria-pressed', 'false');
  expect(second).toHaveAttribute('aria-pressed', 'true');
  expect(highlight).toHaveBeenLastCalledWith(analyzeClimbs(snapshot).climbs[1].geometry);
  await user.keyboard('{Enter}');
  expect(second).toHaveAttribute('aria-pressed', 'false');
  expect(highlight).toHaveBeenLastCalledWith([]);
});

it('clears selection on changed routes, eligibility loss, no route and unmount', async () => {
  const user = userEvent.setup();
  const highlight = vi.fn();
  const initial = route();
  const { rerender, unmount } = render(<ClimbAnalysis route={initial} onHighlight={highlight} />);
  await user.click(screen.getAllByRole('button')[0]);
  rerender(<ClimbAnalysis route={{ ...initial, id: 'other' }} onHighlight={highlight} />);
  expect(screen.getAllByRole('button')[0]).toHaveAttribute('aria-pressed', 'false');
  expect(highlight).toHaveBeenLastCalledWith([]);
  await user.click(screen.getAllByRole('button')[0]);
  rerender(<ClimbAnalysis route={{ ...initial, source: 'mapbox' }} onHighlight={highlight} />);
  expect(screen.getByText(unavailable)).toBeInTheDocument();
  expect(highlight).toHaveBeenLastCalledWith([]);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  rerender(<ClimbAnalysis route={initial} onHighlight={highlight} />);
  expect(screen.getAllByRole('button')[0]).toHaveAttribute('aria-pressed', 'false');
  rerender(<ClimbAnalysis route={null} onHighlight={highlight} />);
  expect(highlight).toHaveBeenLastCalledWith([]);
  rerender(<ClimbAnalysis route={initial} onHighlight={highlight} />);
  await user.click(screen.getAllByRole('button')[0]);
  unmount();
  expect(highlight).toHaveBeenLastCalledWith([]);
});

it('keeps a selection on ordinary rerenders, and uses the latest cleanup callback', async () => {
  const user = userEvent.setup();
  const snapshot = route();
  const firstCallback = vi.fn();
  const secondCallback = vi.fn();
  const { rerender, unmount } = render(
    <ClimbAnalysis route={snapshot} onHighlight={firstCallback} />,
  );
  await user.click(screen.getAllByRole('button')[0]);
  rerender(<ClimbAnalysis route={snapshot} onHighlight={secondCallback} />);
  expect(screen.getAllByRole('button')[0]).toHaveAttribute('aria-pressed', 'true');
  expect(secondCallback).not.toHaveBeenCalled();
  unmount();
  expect(secondCallback).toHaveBeenLastCalledWith([]);
});

it('clears highlights when geometry changes under the same route ID', async () => {
  const user = userEvent.setup();
  const snapshot = route();
  const highlight = vi.fn();
  const { rerender } = render(<ClimbAnalysis route={snapshot} onHighlight={highlight} />);
  await user.click(screen.getAllByRole('button')[0]);
  rerender(
    <ClimbAnalysis
      route={{
        ...snapshot,
        segments: [
          [
            [0, 0, 0],
            [0.01, 0],
          ],
        ],
      }}
      onHighlight={highlight}
    />,
  );
  expect(screen.getByText(unavailable)).toBeInTheDocument();
  expect(highlight).toHaveBeenLastCalledWith([]);
});

it('distinguishes no climbs from unavailable heights, and only disclaims marked ORS terrain', () => {
  const snapshot = route([
    [
      [0, 0, 100],
      [0.01, 0, 100],
    ],
  ]);
  const { rerender } = render(<ClimbAnalysis route={snapshot} />);
  expect(screen.getByText('No sustained climbs found.')).toHaveClass('fine-print');
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Climb analysis' })).toHaveAccessibleDescription();
  expect(screen.queryByText(/ORS terrain/)).not.toBeInTheDocument();
  rerender(<ClimbAnalysis route={{ ...snapshot, source: 'openrouteservice' }} />);
  expect(screen.getByText(unavailable)).toHaveClass('fine-print');
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Climb analysis' })).toHaveAccessibleDescription();
  rerender(
    <ClimbAnalysis route={{ ...snapshot, source: 'mixed', elevationSource: 'openrouteservice' }} />,
  );
  expect(
    screen.getByText('ORS terrain heights are estimates, not measured trail elevations.'),
  ).toBeInTheDocument();
  expect(screen.getByText('No sustained climbs found.')).toBeInTheDocument();
});

it('uses translation keys and locale-aware numbers without locale file edits', async () => {
  i18n.addResourceBundle('ru', 'climb-test', {
    'Climb analysis': 'Анализ подъёмов',
    'Climb {{number}}': 'Подъём {{number}}',
    'Average grade (net gain / length)': 'Средний уклон (набор / длина)',
  });
  const oldDefault = i18n.options.defaultNS;
  i18n.setDefaultNamespace('climb-test');
  try {
    await i18n.changeLanguage('ru');
    render(
      <ClimbAnalysis
        route={route([
          [
            [0, 0, 0],
            [0.003, 0, 25],
          ],
        ])}
      />,
    );
    expect(screen.getByRole('region', { name: 'Анализ подъёмов' })).toBeInTheDocument();
    expect(screen.getByRole('button')).toHaveTextContent('Подъём 1');
    expect(screen.getByRole('button')).toHaveTextContent('Средний уклон (набор / длина): 7,5%');
  } finally {
    i18n.setDefaultNamespace(oldDefault || 'translation');
  }
});
