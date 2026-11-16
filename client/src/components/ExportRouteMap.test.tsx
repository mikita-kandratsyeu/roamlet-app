import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ExportRouteMap } from './ExportRouteMap';

const mocks = vi.hoisted(() => ({
  options: vi.fn(), source: vi.fn(), layer: vi.fn(), fit: vi.fn(), remove: vi.fn(),
  control: vi.fn(), fail: false,
  handlers: new Map<string, () => void>(),
}));
vi.mock('maplibre-gl', () => ({
  Map: class {
    constructor(options: unknown) {
      mocks.options(options);
      if (mocks.fail) throw new Error('WebGL unavailable');
    }
    getCanvas() { return document.createElement('canvas'); }
    addControl = mocks.control;
    fitBounds = mocks.fit;
    addSource = mocks.source;
    addLayer = mocks.layer;
    remove = mocks.remove;
    on(event: string, handler: () => void) { mocks.handlers.set(event, handler); }
  },
  AttributionControl: class {},
  LngLatBounds: class {
    points: number[][] = [];
    extend(point: number[]) { this.points.push(point); return this; }
  },
}));

beforeEach(() => { vi.clearAllMocks(); mocks.handlers.clear(); mocks.fail = false; });
afterEach(cleanup);

it('renders an outline fallback while the Light basemap is loading', () => {
  const { container } = render(<ExportRouteMap segments={[[[11, 47], [12, 48]]]} />);
  expect(screen.getByRole('img', { name: 'Route outline' })).toBeVisible();
  expect(container.querySelector('.export-route-map--outline')).toBeFalsy();
  expect(mocks.options).toHaveBeenCalled();
});

it('fits the complete exported track and preserves gaps between segments', () => {
  const segments = [[[11, 47], [12, 48]], [], [[13, 49], [14, 50]]] as [number, number][][];
  const { container, unmount } = render(<ExportRouteMap segments={segments} />);
  expect(screen.getByRole('figure', { name: 'Route map preview' })).toBeVisible();
  expect(container.querySelectorAll('polyline')).toHaveLength(3);
  expect(mocks.options).toHaveBeenCalledWith(
    expect.objectContaining({
      interactive: false,
      style: 'https://tiles.openfreemap.org/styles/bright',
    }),
  );
  expect(mocks.fit).toHaveBeenCalledWith(expect.objectContaining({ points: segments.flat() }), { padding: 32, maxZoom: 15, duration: 0 });
  act(() => mocks.handlers.get('load')!());
  const data = mocks.source.mock.calls.find(([id]) => id === 'export-route')![1].data;
  expect(data.features.map((feature: { geometry: { coordinates: unknown } }) => feature.geometry.coordinates))
    .toEqual([segments[0], segments[2]]);
  expect(mocks.control).not.toHaveBeenCalled();
  act(() => mocks.handlers.get('idle')!());
  expect(container.querySelector('.export-route-map-canvas')).toHaveClass('is-ready');
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  unmount();
  expect(mocks.remove).toHaveBeenCalledOnce();
});

it('keeps an outline when WebGL or the basemap is unavailable', () => {
  mocks.fail = true;
  const { container } = render(
    <ExportRouteMap segments={[[[11, 47], [12, 48]]]} variant="basemap" />,
  );
  expect(screen.getByRole('img', { name: 'Route outline' })).toBeVisible();
  expect(container.querySelector('.export-route-map-canvas')).not.toHaveClass('is-ready');
});

it('returns to the outline after a map error and releases the map only once', () => {
  const { unmount } = render(
    <ExportRouteMap segments={[[[11, 47], [12, 48]]]} variant="basemap" />,
  );
  act(() => { mocks.handlers.get('load')!(); mocks.handlers.get('idle')!(); });
  act(() => mocks.handlers.get('error')!());
  expect(screen.getByRole('img', { name: 'Route outline' })).toBeVisible();
  act(() => mocks.handlers.get('idle')!());
  expect(screen.getByRole('img')).toBeVisible();
  unmount();
  expect(mocks.remove).toHaveBeenCalledOnce();
});

it('shows a single-point route without invalid SVG coordinates', () => {
  const { container } = render(<ExportRouteMap segments={[[], [[11, 47]]]} />);
  expect(container.querySelector('circle')).toHaveAttribute('cx', '300');
  expect(container.querySelector('circle')).toHaveAttribute('cy', '100');
  expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
});

it('uses the short arc for routes across the date line', () => {
  render(<ExportRouteMap segments={[[[179.9, 47], [-179.9, 47]]]} variant="basemap" />);
  act(() => mocks.handlers.get('load')!());
  const data = mocks.source.mock.calls.find(([id]) => id === 'export-route')![1].data;
  expect(data.features[0].geometry.coordinates).toEqual([[179.9, 47], [180.1, 47]]);
});

it('omits the preview for an empty track', () => {
  const { container } = render(<ExportRouteMap segments={[[]]} />);
  expect(container).toBeEmptyDOMElement();
  expect(mocks.options).not.toHaveBeenCalled();
});
