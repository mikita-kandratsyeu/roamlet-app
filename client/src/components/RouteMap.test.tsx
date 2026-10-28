import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MAP_VIEW_KEY } from '../domain/mapView';
import { RouteMap } from './RouteMap';
import i18n from '../i18n';
const mocks = vi.hoisted(() => ({
  options: vi.fn(),
  handlers: new Map<string, (event?: { lngLat: { lng: number; lat: number } }) => void>(),
  markerOptions: vi.fn(),
  markerDrag: [] as (() => void)[],
  markerRemove: vi.fn(),
  data: vi.fn(),
  control: vi.fn(),
  attribution: vi.fn(),
  fit: vi.fn(),
  remove: vi.fn(),
  paint: vi.fn(),
  zoomIn: vi.fn(),
  zoomOut: vi.fn(),
  setStyle: vi.fn(),
  theme: 'light',
}));
vi.mock('../theme', () => ({ useTheme: () => ({ resolvedTheme: mocks.theme }) }));
vi.mock('mapbox-gl', () => ({
  default: {
    Map: class {
      constructor(options: unknown) {
        mocks.options(options);
      }
      on(event: string, handler: () => void) {
        mocks.handlers.set(event, handler);
      }
      addControl = mocks.control;
      addSource() {}
      addLayer() {}
      resize() {}
      getSource() {
        return { setData: mocks.data };
      }
      getCenter() {
        return { wrap: () => ({ lng: 12, lat: 48 }) };
      }
      getZoom() {
        return 10;
      }
      getBearing() {
        return 20;
      }
      getPitch() {
        return 30;
      }
      fitBounds = mocks.fit;
      remove = mocks.remove;
      setPaintProperty = mocks.paint;
      zoomIn = mocks.zoomIn;
      zoomOut = mocks.zoomOut;
      setStyle = mocks.setStyle;
    },
    Marker: class {
      constructor(options: unknown) {
        mocks.markerOptions(options);
      }
      setLngLat() {
        return this;
      }
      addTo() {
        return this;
      }
      on(event: string, handler: () => void) {
        if (event === 'dragend') mocks.markerDrag.push(handler);
      }
      getLngLat() {
        return { lng: 13, lat: 49 };
      }
      remove = mocks.markerRemove;
    },
    AttributionControl: class {
      constructor(options: unknown) {
        mocks.attribution(options);
      }
    },
    LngLatBounds: class {
      extend() {
        return this;
      }
    },
  },
}));
const props = {
  segments: [],
  waypoints: [],
  editable: true,
  fitToken: 0,
  onAdd: vi.fn(),
  onMove: vi.fn(),
  onError: vi.fn(),
};
const mockStorage = () => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    clear: () => values.clear(),
  });
};
beforeEach(() => {
  mockStorage();
  vi.stubEnv('VITE_MAPBOX_ACCESS_TOKEN', 'pk.test-only-not-a-real-token');
  vi.stubEnv('VITE_MAPBOX_STYLE', '');
  vi.clearAllMocks();
  mocks.theme = 'light';
  mocks.handlers.clear();
  mocks.markerDrag.length = 0;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it('changes supported styles and restores actual geometry without resetting the camera', () => {
  const segments: [number, number][][] = [
    [
      [11, 47],
      [12, 48],
    ],
  ];
  render(<RouteMap {...props} segments={segments} />);
  act(() => mocks.handlers.get('load')?.());
  const fitCalls = mocks.fit.mock.calls.length;
  fireEvent.change(screen.getByRole('combobox', { name: 'Map style' }), {
    target: { value: 'mapbox://styles/mapbox/satellite-streets-v12' },
  });
  expect(mocks.setStyle).toHaveBeenCalledWith('mapbox://styles/mapbox/satellite-streets-v12');
  expect(screen.getByRole('button', { name: 'Zoom in' })).toBeDisabled();
  act(() => mocks.handlers.get('style.load')?.());
  expect(screen.getByRole('button', { name: 'Zoom in' })).toBeEnabled();
  expect(mocks.data).toHaveBeenLastCalledWith(
    expect.objectContaining({
      features: [
        expect.objectContaining({ geometry: { type: 'LineString', coordinates: segments[0] } }),
      ],
    }),
  );
  expect(mocks.fit).toHaveBeenCalledTimes(fitCalls);
  expect(mocks.options).toHaveBeenCalledTimes(1);
});

it('uses the configured Mapbox style, official logo and source attribution control', () => {
  vi.stubEnv('VITE_MAPBOX_STYLE', '/test-style.json');
  render(<RouteMap {...props} />);
  expect(mocks.options).toHaveBeenCalledWith(
    expect.objectContaining({
      accessToken: 'pk.test-only-not-a-real-token',
      style: '/test-style.json',
      logoPosition: 'bottom-left',
      attributionControl: false,
    }),
  );
  expect(mocks.attribution).toHaveBeenCalledWith({ compact: false });
  expect(mocks.control).toHaveBeenCalledWith(expect.anything(), 'bottom-right');
});

it('shows persistent configuration UI without initializing a map when the public token is missing', () => {
  vi.stubEnv('VITE_MAPBOX_ACCESS_TOKEN', '');
  render(<RouteMap {...props} />);
  expect(mocks.options).not.toHaveBeenCalled();
  expect(screen.getByRole('status')).toHaveTextContent('VITE_MAPBOX_ACCESS_TOKEN');
  expect(screen.getByRole('status')).toHaveTextContent('Offline basemaps are not supported');
  expect(screen.getByRole('button', { name: 'Zoom in' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Use my location' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Dismiss map notice' })).not.toBeInTheDocument();
});

it('does not initialize Mapbox with a secret browser token', () => {
  vi.stubEnv('VITE_MAPBOX_ACCESS_TOKEN', 'sk.test-only-not-a-real-token');
  render(<RouteMap {...props} />);
  expect(mocks.options).not.toHaveBeenCalled();
  expect(screen.getByRole('status')).toHaveTextContent('public Mapbox token');
  expect(screen.getByRole('status')).not.toHaveTextContent('sk.test-only-not-a-real-token');
});

it('preserves pointer editing, marker cleanup and read-only view mode', () => {
  const waypoints = [{ id: 'stop', name: 'Stop', coordinate: [11, 47] as [number, number] }];
  const { rerender } = render(<RouteMap {...props} waypoints={waypoints} />);
  act(() => mocks.handlers.get('load')!());
  act(() => mocks.handlers.get('click')!({ lngLat: { lng: 12, lat: 48 } }));
  expect(props.onAdd).toHaveBeenCalledWith([12, 48]);
  expect(mocks.markerOptions).toHaveBeenLastCalledWith(
    expect.objectContaining({ draggable: true }),
  );
  act(() => mocks.markerDrag[0]());
  expect(props.onMove).toHaveBeenCalledWith('stop', [13, 49]);
  const element = mocks.markerOptions.mock.calls[0][0].element as HTMLButtonElement;
  expect(element).toHaveAttribute('aria-label', 'Stop — drag to reposition');
  const bubble = vi.fn();
  document.body.addEventListener('click', bubble);
  document.body.append(element);
  fireEvent.click(element);
  expect(bubble).not.toHaveBeenCalled();
  element.remove();
  document.body.removeEventListener('click', bubble);
  rerender(<RouteMap {...props} waypoints={waypoints} editable={false} />);
  expect(mocks.markerRemove).toHaveBeenCalledOnce();
  expect(mocks.markerOptions).toHaveBeenLastCalledWith(
    expect.objectContaining({ draggable: false }),
  );
  props.onAdd.mockClear();
  act(() => mocks.handlers.get('click')!({ lngLat: { lng: 12, lat: 48 } }));
  expect(props.onAdd).not.toHaveBeenCalled();
  expect(
    screen.queryByText('Click the map to add a stop. Drag pins to refine.'),
  ).not.toBeInTheDocument();
  expect(mocks.options).toHaveBeenCalledOnce();
});

it('keeps separate route segments and ignores isolated points in the map line source', () => {
  render(
    <RouteMap
      {...props}
      segments={[
        [
          [11, 47],
          [12, 48],
        ],
        [[13, 49]],
        [
          [14, 50],
          [15, 51],
        ],
      ]}
    />,
  );
  act(() => mocks.handlers.get('load')!());
  expect(mocks.data).toHaveBeenLastCalledWith({
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: [
            [11, 47],
            [12, 48],
          ],
        },
      },
      {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: [
            [14, 50],
            [15, 51],
          ],
        },
      },
    ],
  });
});

it('starts from the saved view, persists completed map movement and restores it on remount', () => {
  const saved = { center: [25, 54], zoom: 7, bearing: 2, pitch: 0 };
  localStorage.setItem(MAP_VIEW_KEY, JSON.stringify(saved));
  render(<RouteMap {...props} />);
  expect(mocks.options).toHaveBeenCalledWith(expect.objectContaining(saved));
  act(() => mocks.handlers.get('moveend')!());
  const moved = { center: [12, 48], zoom: 10, bearing: 20, pitch: 30 };
  expect(JSON.parse(localStorage.getItem(MAP_VIEW_KEY)!)).toEqual(moved);
  cleanup();
  render(<RouteMap {...props} />);
  expect(mocks.options).toHaveBeenLastCalledWith(expect.objectContaining(moved));
});
it('fits an opened route instead of leaving the saved area onscreen', () => {
  localStorage.setItem(
    MAP_VIEW_KEY,
    JSON.stringify({ center: [25, 54], zoom: 7, bearing: 0, pitch: 0 }),
  );
  const routeProps = {
    ...props,
    segments: [
      [
        [11, 47],
        [12, 48],
      ],
    ] as [number, number][][],
  };
  render(<RouteMap {...routeProps} />);
  act(() => mocks.handlers.get('load')!());
  expect(mocks.fit).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ maxZoom: 15 }),
  );
});
it('switches map controls and existing warnings without recreating or refitting the map', async () => {
  const routeProps = {
    ...props,
    segments: [
      [
        [11, 47],
        [12, 48],
      ],
    ] as [number, number][][],
  };
  render(<RouteMap {...routeProps} />);
  act(() => mocks.handlers.get('load')!());
  act(() => mocks.handlers.get('error')!());
  const fitCalls = mocks.fit.mock.calls.length;
  await act(async () => {
    await i18n.changeLanguage('ru');
  });
  expect(screen.getByRole('button', { name: 'Моё местоположение' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Показать весь маршрут' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Приблизить' })).toHaveAttribute('title', 'Приблизить');
  expect(screen.getByRole('status')).toHaveTextContent('Часть карты не загрузилась');
  expect(mocks.options).toHaveBeenCalledTimes(1);
  expect(mocks.remove).not.toHaveBeenCalled();
  expect(mocks.fit).toHaveBeenCalledTimes(fitCalls);
});
it('keeps working and shows a nonfatal notice when local storage is blocked', () => {
  vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
    throw new DOMException('Blocked');
  });
  render(<RouteMap {...props} />);
  act(() => mocks.handlers.get('moveend')!());
  expect(screen.getByRole('status')).toHaveTextContent('The map view could not be saved');
});

it('updates route colors without touching the vector basemap or recreating or refitting the map', () => {
  const { rerender } = render(<RouteMap {...props} />);
  act(() => mocks.handlers.get('load')!());
  expect(mocks.paint).toHaveBeenCalledWith('route-line', 'line-color', '#173b30');
  const fitCalls = mocks.fit.mock.calls.length;
  mocks.theme = 'dark';
  rerender(<RouteMap {...props} />);
  expect(mocks.paint.mock.calls.every(([layer]) => layer.startsWith('route-'))).toBe(true);
  expect(mocks.paint).toHaveBeenCalledWith('route-line', 'line-color', '#bdd3a5');
  expect(mocks.options).toHaveBeenCalledTimes(1);
  expect(mocks.fit).toHaveBeenCalledTimes(fitCalls);
  expect(mocks.remove).not.toHaveBeenCalled();
});

it('uses accessible shadcn buttons for zooming after the map loads', () => {
  render(<RouteMap {...props} />);
  expect(screen.getByRole('button', { name: 'Zoom in' })).toBeDisabled();
  act(() => mocks.handlers.get('load')!());
  fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
  fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
  expect(mocks.zoomIn).toHaveBeenCalledOnce();
  expect(mocks.zoomOut).toHaveBeenCalledOnce();
});

it('disables map camera animation when reduced motion is requested', () => {
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }));
  render(
    <RouteMap
      {...props}
      segments={[
        [
          [11, 47],
          [12, 48],
        ],
      ]}
    />,
  );
  act(() => mocks.handlers.get('load')!());
  expect(mocks.fit).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ duration: 0 }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
  expect(mocks.zoomIn).toHaveBeenCalledWith({ duration: 0 });
  fireEvent.click(screen.getByRole('button', { name: 'Fit route' }));
  expect(mocks.fit).toHaveBeenLastCalledWith(
    expect.anything(),
    expect.objectContaining({ duration: 0 }),
  );
});
