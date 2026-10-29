import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MAP_VIEW_KEY, defaultMapView } from '../domain/mapView';
import {
  PREFERENCES_KEY,
  loadPreferences,
  savePreferences,
  resetPreferences,
} from '../domain/preferences';
import { BRIGHT_MAP_STYLE } from '../domain/mapTiles';
import { RouteMap } from './RouteMap';
import i18n from '../i18n';
const mocks = vi.hoisted(() => ({
  options: vi.fn(),
  canvas: null as HTMLCanvasElement | null,
  handlers: new Map<
    string,
    (event?: {
      lngLat: { lng: number; lat: number };
      point?: { x: number; y: number };
      originalEvent?: MouseEvent;
    }) => void
  >(),
  query: vi.fn<() => unknown[]>(() => []),
  layer: vi.fn(),
  sourceInstalled: false,
  accuracyInstalled: false,
  source: vi.fn(),
  accuracyData: vi.fn(),
  jump: vi.fn(),
  markerOptions: vi.fn(),
  markerPosition: vi.fn(),
  zoom: 10,
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
  fly: vi.fn(),
  setStyle: vi.fn(),
  extraData: new Map<string, ReturnType<typeof vi.fn>>(),
  bearing: 20,
  ease: vi.fn(),
  scale: vi.fn(),
  theme: 'light',
}));
vi.mock('../theme', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../theme')>()),
  useTheme: () => ({ resolvedTheme: mocks.theme }),
}));
vi.mock('maplibre-gl', () => ({
  default: {
    Map: class {
      constructor(options: unknown) {
        mocks.options(options);
        mocks.canvas = this.canvas;
      }
      on(event: string, handler: () => void) {
        mocks.handlers.set(event, handler);
      }
      addControl = mocks.control;
      canvas = document.createElement('canvas');
      getCanvas() {
        return this.canvas;
      }
      addSource(id: string, options: unknown) {
        mocks.source(id, options);
        if (id === 'location-accuracy') mocks.accuracyInstalled = true;
        else if (id === 'route') mocks.sourceInstalled = true;
        else mocks.extraData.set(id, vi.fn());
      }
      addLayer = mocks.layer;
      queryRenderedFeatures = mocks.query;
      jumpTo = mocks.jump;
      resize() {}
      getSource(id: string) {
        if (id === 'location-accuracy')
          return mocks.accuracyInstalled ? { setData: mocks.accuracyData } : undefined;
        if (id === 'route') return mocks.sourceInstalled ? { setData: mocks.data } : undefined;
        const setData = mocks.extraData.get(id);
        return setData ? { setData } : undefined;
      }
      getCenter() {
        return { wrap: () => ({ lng: 12, lat: 48 }) };
      }
      getZoom() {
        return mocks.zoom;
      }
      getBearing() {
        return mocks.bearing;
      }
      easeTo = mocks.ease;
      getPitch() {
        return 30;
      }
      fitBounds = mocks.fit;
      flyTo = mocks.fly;
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
      setLngLat(coordinate: unknown) {
        mocks.markerPosition(coordinate);
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
    ScaleControl: class {
      constructor(options: unknown) {
        mocks.scale(options);
      }
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
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
  });
};
beforeEach(() => {
  mockStorage();
  vi.stubEnv('VITE_ORS_API_KEY', 'test-only-not-a-real-ors-key');
  vi.stubEnv('VITE_MAP_STYLE', '');
  vi.clearAllMocks();
  mocks.theme = 'light';
  mocks.query.mockReturnValue([]);
  mocks.sourceInstalled = false;
  mocks.accuracyInstalled = false;
  mocks.zoom = 10;
  mocks.bearing = 20;
  mocks.extraData.clear();
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
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it('shows an offline empty state without loading a map, with working local recovery actions', () => {
  const onLibrary = vi.fn();
  const onCheckConnection = vi.fn();
  render(
    <RouteMap
      {...props}
      online={false}
      onLibrary={onLibrary}
      onCheckConnection={onCheckConnection}
    />,
  );
  expect(mocks.options).not.toHaveBeenCalled();
  expect(screen.queryByTestId('global-map-loader')).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Map unavailable offline' })).toBeVisible();
  expect(screen.queryByRole('group', { name: 'Map controls' })).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Map style')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'My routes' }));
  fireEvent.click(screen.getByRole('button', { name: 'Retry map' }));
  expect(onLibrary).toHaveBeenCalledOnce();
  expect(onCheckConnection).toHaveBeenCalledOnce();
});

it('recreates the map and restores route layers when connectivity returns', () => {
  const segments: [number, number][][] = [
    [
      [11.4, 47.26],
      [11.41, 47.27],
    ],
  ];
  const { rerender } = render(<RouteMap {...props} segments={segments} />);
  act(() => mocks.handlers.get('load')?.());
  rerender(<RouteMap {...props} segments={segments} online={false} />);
  expect(mocks.remove).toHaveBeenCalledOnce();
  expect(screen.queryByTestId('global-map-loader')).not.toBeInTheDocument();
  rerender(<RouteMap {...props} segments={segments} online />);
  expect(mocks.options).toHaveBeenCalledTimes(2);
  act(() => mocks.handlers.get('load')?.());
  expect(
    screen.queryByRole('heading', { name: 'Map unavailable offline' }),
  ).not.toBeInTheDocument();
  expect(mocks.data).toHaveBeenLastCalledWith(
    expect.objectContaining({
      features: [
        expect.objectContaining({ geometry: { type: 'LineString', coordinates: segments[0] } }),
      ],
    }),
  );
  expect(screen.getByRole('button', { name: 'Zoom in' })).toBeEnabled();
});

it('shows a global loader until the map loads, not just until its style loads', () => {
  const { container } = render(<RouteMap {...props} />);
  expect(screen.getByTestId('global-map-loader').parentElement).toBe(document.body);
  expect(screen.getByText('Loading map…')).toBeInTheDocument();
  expect(container.inert).toBe(true);
  act(() => mocks.handlers.get('style.load')?.());
  expect(screen.getByTestId('global-map-loader')).toBeInTheDocument();
  act(() => mocks.handlers.get('load')?.());
  expect(screen.queryByTestId('global-map-loader')).not.toBeInTheDocument();
  expect(container.inert).toBeFalsy();
});
it('unblocks the application on errors and never leaves an endless loader', () => {
  render(<RouteMap {...props} />);
  act(() => mocks.handlers.get('error')?.());
  expect(screen.queryByTestId('global-map-loader')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss map notice' }));
  expect(screen.queryByTestId('global-map-loader')).not.toBeInTheDocument();
});
it('releases the global loader after a map loading timeout', () => {
  vi.useFakeTimers();
  render(<RouteMap {...props} />);
  act(() => vi.advanceTimersByTime(30000));
  expect(screen.queryByTestId('global-map-loader')).not.toBeInTheDocument();
  expect(
    screen.getByText('The map took too long to load. Check your connection and reload the page.'),
  ).toBeInTheDocument();
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
    target: { value: 'https://tiles.openfreemap.org/styles/bright' },
  });
  expect(mocks.setStyle).toHaveBeenCalledWith('https://tiles.openfreemap.org/styles/bright');
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

it('orders navigation before drawing and offers a single ruler tool with contextual undo', () => {
  const toggle = vi.fn(),
    undo = vi.fn();
  render(<RouteMap {...props} manualDrawing onToggleManualDrawing={toggle} onUndo={undo} />);
  act(() => mocks.handlers.get('load')?.());
  const controls = screen.getByRole('group', { name: 'Map controls' });
  expect(
    [...controls.querySelectorAll('button')].map((button) => button.getAttribute('aria-label')),
  ).toEqual([
    'Reset north',
    'Zoom in',
    'Zoom out',
    'Use my location',
    'Fit route',
    'Manual drawing',
    'Undo last point',
  ]);
  expect(screen.getAllByRole('button', { name: 'Manual drawing' })).toHaveLength(1);
  const tool = screen.getByRole('button', { name: 'Manual drawing' });
  expect(tool).toHaveAttribute('aria-pressed', 'true');
  expect(tool.querySelector('svg')).toHaveClass('lucide-ruler');
  fireEvent.click(tool);
  expect(toggle).toHaveBeenCalledTimes(1);
  expect(mocks.canvas?.style.cursor).toBe('crosshair');
  fireEvent.keyDown(mocks.canvas!, { key: 'z', ctrlKey: true });
  expect(undo).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Undo last point' }));
  expect(undo).toHaveBeenCalledTimes(2);
});

it('orders Standard before Light and uses distinct map and sun icons', () => {
  render(<RouteMap {...props} />);
  expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
    'Standard',
    'Light',
  ]);
  expect(screen.getAllByRole('radio').map((item) => item.textContent)).toEqual([
    'Standard',
    'Light',
  ]);
  for (const [label, iconClass] of [
    ['Standard', 'lucide-map'],
    ['Light', 'lucide-sun'],
  ]) {
    const icon = screen.getByRole('radio', { name: label }).querySelector('svg');
    expect(icon).toHaveClass(iconClass);
    expect(icon).toHaveAttribute('aria-hidden', 'true');
    expect(icon).toHaveAttribute('width', '18');
    expect(icon).toHaveAttribute('height', '18');
  }
});

it.each(['standard', 'custom'] as const)(
  'uses the configured provider as Standard for saved %s preferences without a Custom option',
  (style) => {
    vi.stubEnv('VITE_MAP_STYLE', '/custom-style.json');
    savePreferences({ style });
    render(<RouteMap {...props} />);
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Standard',
      'Light',
    ]);
    expect(screen.getAllByRole('radio').map((item) => item.textContent)).toEqual([
      'Standard',
      'Light',
    ]);
    expect(screen.getByRole('combobox', { name: 'Map style' })).toHaveValue('/custom-style.json');
    expect(screen.getByRole('radio', { name: 'Standard' })).toHaveAttribute('data-state', 'on');
    expect(screen.getByRole('radio', { name: 'Standard' }).querySelector('svg')).toHaveClass(
      'lucide-map',
    );
    act(() => mocks.handlers.get('load')?.());
    fireEvent.click(screen.getByRole('radio', { name: 'Light' }));
    expect(mocks.setStyle).toHaveBeenLastCalledWith(BRIGHT_MAP_STYLE);
    fireEvent.click(screen.getByRole('radio', { name: 'Standard' }));
    expect(mocks.setStyle).toHaveBeenLastCalledWith('/custom-style.json');
    expect(loadPreferences().style).toBe('standard');
  },
);

it('keeps both options distinct when the configured provider is Bright', () => {
  vi.stubEnv('VITE_MAP_STYLE', BRIGHT_MAP_STYLE);
  render(<RouteMap {...props} />);
  expect(screen.getAllByRole('option').map((option) => option.getAttribute('value'))).toEqual([
    '/osm-standard.json',
    BRIGHT_MAP_STYLE,
  ]);
  expect(screen.getByRole('radio', { name: 'Light' })).toHaveAttribute('data-state', 'on');
});

it('shows the Standard selection after an invalid saved provider falls back to OSM', () => {
  vi.stubEnv('VITE_MAP_STYLE', 'invalid-style');
  savePreferences({ style: 'custom' });
  render(<RouteMap {...props} />);
  expect(mocks.options).toHaveBeenCalledWith(
    expect.objectContaining({ style: '/osm-standard.json' }),
  );
  expect(screen.getByRole('combobox', { name: 'Map style' })).toHaveValue('/osm-standard.json');
  expect(screen.getByRole('radio', { name: 'Standard' })).toHaveAttribute('data-state', 'on');
  expect(
    screen.getByText('The saved map style is unavailable. The standard map is being used.'),
  ).toBeInTheDocument();
});

it('uses the configured MapLibre style and source attribution without Mapbox credentials', () => {
  vi.stubEnv('VITE_MAP_STYLE', '/test-style.json');
  render(<RouteMap {...props} />);
  expect(mocks.options).toHaveBeenCalledWith(
    expect.objectContaining({ style: '/test-style.json', attributionControl: false }),
  );
  expect(mocks.options.mock.calls[0][0]).not.toHaveProperty('accessToken');
  expect(mocks.options.mock.calls[0][0]).not.toHaveProperty('logoPosition');
  expect(mocks.attribution).toHaveBeenCalledWith({ compact: false });
  expect(mocks.control).toHaveBeenCalledWith(expect.anything(), 'bottom-right');
});

it('shows persistent configuration UI for an unsupported map style', () => {
  vi.stubEnv('VITE_MAP_STYLE', 'mapbox://styles/mapbox/outdoors-v12');
  render(<RouteMap {...props} />);
  expect(mocks.options).not.toHaveBeenCalled();
  expect(screen.getByRole('status')).toHaveTextContent('VITE_MAP_STYLE');
  expect(screen.getByRole('status')).toHaveTextContent('Offline basemaps are not supported');
  expect(screen.getByRole('button', { name: 'Zoom in' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Use my location' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Dismiss map notice' })).not.toBeInTheDocument();
});

it.each(['', 'test-only-not-a-real-ors-key'])(
  'initializes the map independently of routing key %s',
  (key) => {
    vi.stubEnv('VITE_ORS_API_KEY', key);
    render(<RouteMap {...props} />);
    expect(mocks.options).toHaveBeenCalledTimes(1);
    expect(mocks.options.mock.calls[0][0]).not.toHaveProperty('accessToken');
    act(() => mocks.handlers.get('load')?.());
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeEnabled();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  },
);

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
  render(<RouteMap {...routeProps} fitToken={1} />);
  act(() => mocks.handlers.get('load')!());
  expect(mocks.fit).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ maxZoom: 15 }),
  );
});
it('keeps the camera unchanged during point edits and only fits an explicit request once', () => {
  const point = { id: 'start', name: 'Start', coordinate: [11, 47] as [number, number] };
  const { rerender } = render(<RouteMap {...props} waypoints={[point]} />);
  act(() => mocks.handlers.get('load')!());
  expect(mocks.fit).not.toHaveBeenCalled();
  const next = {
    ...props,
    waypoints: [point, { ...point, id: 'finish', coordinate: [12, 48] as [number, number] }],
    segments: [
      [
        [11, 47],
        [12, 48],
      ],
    ] as [number, number][][],
  };
  rerender(<RouteMap {...next} />);
  expect(mocks.fit).not.toHaveBeenCalled();
  rerender(<RouteMap {...next} fitToken={1} />);
  expect(mocks.fit).toHaveBeenCalledOnce();
  rerender(<RouteMap {...next} fitToken={1} waypoints={[point]} segments={[]} />);
  act(() => mocks.handlers.get('style.load')!());
  expect(mocks.fit).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Fit route' }));
  expect(mocks.fit).toHaveBeenCalledTimes(2);
});

it.each([true, false])('location recenters without adding a stop (editable: %s)', (editable) => {
  vi.stubGlobal('navigator', {
    geolocation: {
      getCurrentPosition: (success: PositionCallback) =>
        success({ coords: { longitude: 13, latitude: 49 } } as GeolocationPosition),
    },
  });
  render(<RouteMap {...props} editable={editable} />);
  act(() => mocks.handlers.get('load')!());
  fireEvent.click(screen.getByRole('button', { name: 'Use my location' }));
  expect(mocks.fly).toHaveBeenCalledWith(expect.objectContaining({ center: [13, 49] }));
  expect(mocks.fly.mock.lastCall![0]).not.toHaveProperty('zoom');
  expect(mocks.markerOptions).toHaveBeenCalledWith({
    element: expect.objectContaining({ className: 'user-location-marker' }),
  });
  expect(mocks.markerPosition).toHaveBeenLastCalledWith([13, 49]);
  expect(props.onAdd).not.toHaveBeenCalled();
});

it('updates a single location dot, preserves closer zoom and removes the dot on unmount', () => {
  let success: PositionCallback = () => {};
  vi.stubGlobal('navigator', {
    geolocation: {
      getCurrentPosition: (callback: PositionCallback) => {
        success = callback;
      },
    },
  });
  mocks.zoom = 16;
  const { unmount } = render(<RouteMap {...props} />);
  act(() => mocks.handlers.get('load')!());
  const button = screen.getByRole('button', { name: 'Use my location' });
  fireEvent.click(button);
  expect(button).toBeDisabled();
  act(() => success({ coords: { longitude: 13, latitude: 49 } } as GeolocationPosition));
  fireEvent.click(button);
  act(() => success({ coords: { longitude: 14, latitude: 50 } } as GeolocationPosition));
  expect(mocks.markerOptions).toHaveBeenCalledOnce();
  expect(mocks.markerPosition).toHaveBeenLastCalledWith([14, 50]);
  expect(mocks.fly).toHaveBeenLastCalledWith(expect.objectContaining({ center: [14, 50] }));
  expect(props.onAdd).not.toHaveBeenCalled();
  expect(props.onMove).not.toHaveBeenCalled();
  unmount();
  expect(mocks.markerRemove).toHaveBeenCalledOnce();
});

it('updates the accuracy circle and restores it after changing map style', () => {
  let accuracy = 250;
  vi.stubGlobal('navigator', {
    geolocation: {
      getCurrentPosition: (success: PositionCallback) =>
        success({ coords: { longitude: 13, latitude: 49, accuracy } } as GeolocationPosition),
    },
  });
  render(<RouteMap {...props} />);
  act(() => mocks.handlers.get('load')!());
  expect(mocks.layer).toHaveBeenCalledWith({
    id: 'location-accuracy-fill',
    type: 'fill',
    source: 'location-accuracy',
    paint: { 'fill-color': '#2684ff', 'fill-opacity': 0.16 },
  });
  const button = screen.getByRole('button', { name: 'Use my location' });
  fireEvent.click(button);
  const first = mocks.accuracyData.mock.lastCall![0];
  expect(first.features[0].geometry.coordinates[0]).toHaveLength(65);
  accuracy = 100;
  fireEvent.click(button);
  const updated = mocks.accuracyData.mock.lastCall![0];
  expect(updated).not.toEqual(first);
  mocks.sourceInstalled = false;
  mocks.accuracyInstalled = false;
  act(() => mocks.handlers.get('style.load')!());
  expect(mocks.source).toHaveBeenCalledWith('location-accuracy', {
    type: 'geojson',
    data: updated,
  });
  accuracy = NaN;
  fireEvent.click(button);
  expect(mocks.accuracyData).toHaveBeenLastCalledWith({
    type: 'FeatureCollection',
    features: [],
  });
  expect(mocks.markerOptions).toHaveBeenCalledOnce();
  expect(props.onAdd).not.toHaveBeenCalled();
});

it('ignores a location response after the map is unmounted', () => {
  let success: PositionCallback = () => {};
  vi.stubGlobal('navigator', {
    geolocation: {
      getCurrentPosition: (callback: PositionCallback) => {
        success = callback;
      },
    },
  });
  const { unmount } = render(<RouteMap {...props} />);
  act(() => mocks.handlers.get('load')!());
  fireEvent.click(screen.getByRole('button', { name: 'Use my location' }));
  unmount();
  act(() => success({ coords: { longitude: 13, latitude: 49 } } as GeolocationPosition));
  expect(mocks.markerOptions).not.toHaveBeenCalled();
  expect(mocks.fly).not.toHaveBeenCalled();
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
  expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
    'Стандартная',
    'Светлая',
  ]);
  expect(screen.getAllByRole('radio').map((item) => item.textContent)).toEqual([
    'Стандартная',
    'Светлая',
  ]);
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
  expect(mocks.paint).toHaveBeenCalledWith('route-line', 'line-color', '#286046');
  const fitCalls = mocks.fit.mock.calls.length;
  mocks.theme = 'dark';
  rerender(<RouteMap {...props} />);
  expect(mocks.paint.mock.calls.every(([layer]) => layer.startsWith('route-'))).toBe(true);
  expect(mocks.paint).toHaveBeenCalledWith('route-line', 'line-color', '#9bc5a7');
  expect(mocks.options).toHaveBeenCalledTimes(1);
  expect(mocks.fit).toHaveBeenCalledTimes(fitCalls);
  expect(mocks.remove).not.toHaveBeenCalled();
});

it('keeps GPX import accessible from the shared map toolbar', () => {
  const onImport = vi.fn();
  render(<RouteMap {...props} onImport={onImport} />);
  fireEvent.click(screen.getByRole('button', { name: 'Import GPX on map' }));
  expect(onImport).toHaveBeenCalledOnce();
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
      fitToken={1}
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

it('initializes saved symbolic style and camera before constructing the map', () => {
  const camera = { center: [8, 46] as [number, number], zoom: 7, bearing: 12, pitch: 20 };
  savePreferences({ style: 'bright', camera });
  render(<RouteMap {...props} />);
  expect(mocks.options).toHaveBeenCalledWith(
    expect.objectContaining({ ...camera, style: 'https://tiles.openfreemap.org/styles/bright' }),
  );
  expect(localStorage.getItem(PREFERENCES_KEY)).not.toContain('https://');
});
it('falls back once for an unavailable saved style, warns and retains manual retry', () => {
  savePreferences({ style: 'bright' });
  render(<RouteMap {...props} />);
  act(() => mocks.handlers.get('error')?.());
  expect(mocks.setStyle).toHaveBeenCalledTimes(1);
  expect(mocks.setStyle).toHaveBeenLastCalledWith('/osm-standard.json');
  expect(screen.getByRole('status')).toHaveTextContent(
    'The saved map style is unavailable. The standard map is being used.',
  );
  act(() => mocks.handlers.get('style.load')?.());
  expect(screen.getByRole('status')).toBeInTheDocument();
  act(() => mocks.handlers.get('error')?.());
  expect(mocks.setStyle).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Retry map' }));
  expect(mocks.setStyle).toHaveBeenCalledTimes(2);
});
it('uses standard with a warning when the saved custom style is no longer configured', () => {
  savePreferences({ style: 'custom' });
  render(<RouteMap {...props} />);
  expect(mocks.options).toHaveBeenCalledWith(
    expect.objectContaining({ style: '/osm-standard.json' }),
  );
  expect(
    screen.getByText('The saved map style is unavailable. The standard map is being used.'),
  ).toBeInTheDocument();
});
it('resets the current camera and style without mutating route geometry', () => {
  savePreferences({ style: 'bright', camera: { center: [8, 46], zoom: 7, bearing: 0, pitch: 0 } });
  render(<RouteMap {...props} />);
  act(() => mocks.handlers.get('load')?.());
  act(() => {
    expect(resetPreferences()).toBe(true);
  });
  expect(mocks.setStyle).toHaveBeenLastCalledWith('/osm-standard.json');
  expect(mocks.jump).toHaveBeenLastCalledWith(defaultMapView());
  expect(props.onAdd).not.toHaveBeenCalled();
  expect(props.onMove).not.toHaveBeenCalled();
});
it('supports history undo/redo in all editable modes, including disabled history and canvas shortcuts', () => {
  const undo = vi.fn(),
    redo = vi.fn();
  const view = render(<RouteMap {...props} onUndo={undo} onRedo={redo} canUndo canRedo />);
  act(() => mocks.handlers.get('load')?.());
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
  fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
  fireEvent.keyDown(mocks.canvas!, { key: 'z', ctrlKey: true });
  fireEvent.keyDown(mocks.canvas!, { key: 'z', metaKey: true, shiftKey: true });
  expect(undo).toHaveBeenCalledTimes(2);
  expect(redo).toHaveBeenCalledTimes(2);
  view.rerender(
    <RouteMap {...props} onUndo={undo} onRedo={redo} canUndo={false} canRedo={false} />,
  );
  expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Redo' })).toBeDisabled();
  fireEvent.keyDown(mocks.canvas!, { key: 'z', ctrlKey: true });
  expect(undo).toHaveBeenCalledTimes(2);
});
it('uses a wide transparent line hit target and inserts between the correct route stops', () => {
  const onInsert = vi.fn();
  const segments: [number, number][][] = [
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0.1],
    ],
  ];
  const waypoints = [
    [0, 0],
    [1, 1],
    [0, 0.1],
  ].map((coordinate, index) => ({
    id: String(index),
    name: String(index),
    coordinate: coordinate as [number, number],
  }));
  render(<RouteMap {...props} segments={segments} waypoints={waypoints} onInsert={onInsert} />);
  act(() => mocks.handlers.get('load')?.());
  expect(mocks.layer).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'route-hit', paint: { 'line-width': 28, 'line-opacity': 0 } }),
  );
  mocks.query.mockReturnValue([{}]);
  act(() =>
    mocks.handlers.get('click')?.({ lngLat: { lng: 0, lat: 0.5 }, point: { x: 10, y: 10 } }),
  );
  expect(onInsert).toHaveBeenCalledWith([0, 0.5], 2);
  expect(props.onAdd).not.toHaveBeenCalled();
});
it('ignores line insertion after map pan, marker drag and for read-only GPX snapshots', () => {
  const onInsert = vi.fn();
  const segments: [number, number][][] = [
    [
      [0, 0],
      [1, 0],
    ],
  ];
  const waypoints = [
    { id: 'start', name: 'Start', coordinate: [0, 0] as [number, number] },
    { id: 'end', name: 'End', coordinate: [1, 0] as [number, number] },
  ];
  const view = render(
    <RouteMap {...props} segments={segments} waypoints={waypoints} onInsert={onInsert} />,
  );
  act(() => mocks.handlers.get('load')?.());
  mocks.query.mockReturnValue([{}]);
  const click = () =>
    mocks.handlers.get('click')?.({ lngLat: { lng: 0.5, lat: 0 }, point: { x: 10, y: 10 } });
  act(() => {
    mocks.handlers.get('dragstart')?.();
    click();
    mocks.handlers.get('dragend')?.();
    click();
  });
  act(() => {
    mocks.markerDrag[0]();
    click();
  });
  expect(onInsert).not.toHaveBeenCalled();
  expect(props.onAdd).not.toHaveBeenCalled();
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 1000);
  view.rerender(
    <RouteMap
      {...props}
      segments={segments}
      waypoints={waypoints}
      onInsert={onInsert}
      editable={false}
    />,
  );
  act(click);
  expect(onInsert).not.toHaveBeenCalled();
});

it('preserves the configured style during unrelated planner/theme changes', () => {
  vi.stubEnv('VITE_MAP_STYLE', '/custom-style.json');
  render(<RouteMap {...props} />);
  act(() => {
    savePreferences({ targetKm: 30, theme: 'dark' });
  });
  expect(mocks.setStyle).not.toHaveBeenCalled();
  expect(screen.getByRole('combobox', { name: 'Map style' })).toHaveValue('/custom-style.json');
});
it('allows explicit retry after map construction fails without reviving an endless loader', () => {
  mocks.options.mockImplementationOnce(() => {
    throw new Error('WebGL unavailable');
  });
  render(<RouteMap {...props} />);
  expect(screen.queryByTestId('global-map-loader')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry map' }));
  expect(mocks.options).toHaveBeenCalledTimes(2);
  act(() => mocks.handlers.get('load')?.());
  expect(screen.getByRole('button', { name: 'Zoom in' })).toBeEnabled();
  expect(screen.queryByTestId('global-map-loader')).not.toBeInTheDocument();
});

const annotationWaypoints = [
  { id: 'a', name: 'Start', coordinate: [0, 0] as [number, number] },
  { id: 'b', name: 'Finish', coordinate: [0.02, 0] as [number, number] },
];
const annotationSegments: [number, number][][] = [
  [
    [0, 0],
    [0.02, 0],
  ],
];

it('selects accessible waypoint buttons, exposes actions and focuses only on explicit request', () => {
  const onSelectWaypoint = vi.fn(),
    onRemoveWaypoint = vi.fn(),
    onReplaceWaypoint = vi.fn(),
    onStartWaypoint = vi.fn();
  const options = {
    ...props,
    waypoints: annotationWaypoints,
    selectedWaypointId: 'a',
    focusWaypointToken: 0,
    onSelectWaypoint,
    onRemoveWaypoint,
    onReplaceWaypoint,
    onStartWaypoint,
  };
  const { rerender } = render(<RouteMap {...options} />);
  act(() => mocks.handlers.get('load')?.());
  const marker = mocks.markerOptions.mock.calls[0][0].element as HTMLButtonElement;
  expect(marker).toHaveAttribute('aria-pressed', 'true');
  expect(marker).toHaveClass('waypoint-marker-selected');
  expect(marker).toHaveAttribute('aria-label', expect.stringContaining('Start'));
  fireEvent.click(marker);
  expect(onSelectWaypoint).toHaveBeenCalledWith('a');
  fireEvent.click(screen.getByRole('button', { name: 'Replace waypoint' }));
  fireEvent.click(screen.getByRole('button', { name: 'Start route here' }));
  expect(onReplaceWaypoint).toHaveBeenCalledWith('a');
  expect(onStartWaypoint).toHaveBeenCalledWith('a');
  expect(mocks.fly).not.toHaveBeenCalled();
  rerender(<RouteMap {...options} focusWaypointToken={1} />);
  expect(mocks.fly).toHaveBeenCalledWith(expect.objectContaining({ center: [0, 0] }));
  fireEvent.click(screen.getByRole('button', { name: 'Remove waypoint' }));
  expect(onRemoveWaypoint).toHaveBeenCalledWith('a');
  expect(screen.queryByRole('group', { name: 'Waypoint actions' })).not.toBeInTheDocument();
});

it('highlights the hit area and projected insertion point, clearing on leave and read-only changes', () => {
  const options = {
    ...props,
    segments: annotationSegments,
    waypoints: annotationWaypoints,
    onInsert: vi.fn(),
  };
  const { rerender } = render(<RouteMap {...options} />);
  act(() => mocks.handlers.get('load')?.());
  mocks.query.mockReturnValue([{}]);
  act(() =>
    mocks.handlers.get('mousemove')?.({ lngLat: { lng: 0.01, lat: 0.001 }, point: { x: 1, y: 1 } }),
  );
  expect(mocks.paint).toHaveBeenCalledWith('route-hover', 'line-opacity', 0.25);
  expect(mocks.extraData.get('route-insertion')).toHaveBeenLastCalledWith(
    expect.objectContaining({
      features: [expect.objectContaining({ geometry: { type: 'Point', coordinates: [0.01, 0] } })],
    }),
  );
  fireEvent.mouseLeave(mocks.canvas!);
  expect(mocks.extraData.get('route-insertion')).toHaveBeenLastCalledWith({
    type: 'FeatureCollection',
    features: [],
  });
  act(() =>
    mocks.handlers.get('mousemove')?.({ lngLat: { lng: 0.01, lat: 0 }, point: { x: 1, y: 1 } }),
  );
  rerender(<RouteMap {...options} editable={false} />);
  expect(mocks.extraData.get('route-insertion')).toHaveBeenLastCalledWith({
    type: 'FeatureCollection',
    features: [],
  });
  expect(mocks.paint).toHaveBeenLastCalledWith('route-hover', 'line-opacity', 0);
});

it('requires an explicit mobile add-points toggle and disables edits when toggled off', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  render(<RouteMap {...props} />);
  act(() => mocks.handlers.get('load')?.());
  const click = () => mocks.handlers.get('click')?.({ lngLat: { lng: 1, lat: 2 } });
  act(click);
  expect(props.onAdd).not.toHaveBeenCalled();
  const toggle = screen.getByRole('button', { name: 'Add points on map' });
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute('aria-pressed', 'true');
  act(click);
  expect(props.onAdd).toHaveBeenCalledOnce();
  fireEvent.click(toggle);
  act(click);
  expect(props.onAdd).toHaveBeenCalledOnce();
});

it('renders isolated direct, inactive alternative and elevation geometry without camera jumps', () => {
  const alternatives = [
    annotationSegments,
    [
      [
        [10, 0],
        [10.02, 0],
      ],
    ] as [number, number][][],
  ];
  const options = {
    ...props,
    segments: annotationSegments,
    directSegments: annotationSegments,
    alternativeSegments: alternatives,
    selectedAlternativeIndex: 0,
    elevationCoordinate: [0.01, 0] as [number, number],
    routeStale: true,
  };
  const { rerender } = render(<RouteMap {...options} />);
  act(() => mocks.handlers.get('load')?.());
  expect(mocks.extraData.get('route-direct')).toHaveBeenLastCalledWith(
    expect.objectContaining({
      features: [
        expect.objectContaining({
          geometry: { type: 'LineString', coordinates: annotationSegments[0] },
        }),
      ],
    }),
  );
  expect(mocks.extraData.get('route-alternatives')).toHaveBeenLastCalledWith(
    expect.objectContaining({
      features: [
        expect.objectContaining({
          geometry: { type: 'LineString', coordinates: alternatives[1][0] },
        }),
      ],
    }),
  );
  expect(mocks.extraData.get('route-elevation')).toHaveBeenLastCalledWith(
    expect.objectContaining({
      features: [expect.objectContaining({ geometry: { type: 'Point', coordinates: [0.01, 0] } })],
    }),
  );
  expect(mocks.paint).toHaveBeenCalledWith('route-line', 'line-opacity', 0.4);
  mocks.query.mockImplementation((...args: unknown[]) => {
    const options = args[1] as { layers: string[] };
    return options.layers[0] === 'route-alternatives-line' ? [{}] : [];
  });
  act(() =>
    mocks.handlers.get('click')?.({ lngLat: { lng: 10.01, lat: 0 }, point: { x: 1, y: 1 } }),
  );
  expect(props.onAdd).not.toHaveBeenCalled();
  rerender(<RouteMap {...options} routeStale={false} />);
  expect(screen.queryByText('Elevation location')).not.toBeInTheDocument();
  expect(document.querySelector('.map-annotation-status')).not.toBeInTheDocument();
  expect(mocks.extraData.get('route-elevation')).toHaveBeenLastCalledWith(
    expect.objectContaining({
      features: [expect.objectContaining({ geometry: { type: 'Point', coordinates: [0.01, 0] } })],
    }),
  );
  rerender(<RouteMap {...options} elevationCoordinate={null} routeStale={false} />);
  expect(mocks.extraData.get('route-elevation')).toHaveBeenLastCalledWith({
    type: 'FeatureCollection',
    features: [],
  });
  expect(mocks.paint).toHaveBeenCalledWith('route-line', 'line-opacity', 1);
  expect(mocks.fly).not.toHaveBeenCalled();
  expect(mocks.fit).not.toHaveBeenCalled();
});

it('installs a metric scale and updates the north indicator on rotation', () => {
  render(<RouteMap {...props} />);
  act(() => mocks.handlers.get('load')?.());
  expect(mocks.scale).toHaveBeenCalledWith({ unit: 'metric' });
  const button = screen.getByRole('button', { name: 'Reset north' });
  mocks.bearing = 65;
  act(() => mocks.handlers.get('rotate')?.());
  expect(button.querySelector('span')).toHaveStyle({ transform: 'rotate(-65deg)' });
  fireEvent.click(button);
  expect(mocks.ease).toHaveBeenCalledWith(expect.objectContaining({ bearing: 0 }));
});

it.each([
  [1, 'Location permission was denied. Enable location access in your browser settings.'],
  [2, 'Your position is unavailable. Enter coordinates or click the map instead.'],
  [3, 'Location request timed out. Try again.'],
])(
  'reports distinct geolocation failure %s without requesting it automatically',
  (code, message) => {
    const getCurrentPosition = vi.fn((_success: PositionCallback, failure: PositionErrorCallback) =>
      failure({ code } as GeolocationPositionError),
    );
    vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } });
    render(<RouteMap {...props} />);
    act(() => mocks.handlers.get('load')?.());
    expect(getCurrentPosition).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Use my location' }));
    expect(props.onError).toHaveBeenCalledWith(message);
    expect(screen.getByRole('button', { name: 'Use my location' })).toBeEnabled();
  },
);

it('fits reported accuracy bounds and reports precision rather than forcing zoom 14', () => {
  vi.stubGlobal('navigator', {
    geolocation: {
      getCurrentPosition: (success: PositionCallback) =>
        success({ coords: { longitude: 13, latitude: 49, accuracy: 2000 } } as GeolocationPosition),
    },
  });
  render(<RouteMap {...props} />);
  act(() => mocks.handlers.get('load')?.());
  fireEvent.click(screen.getByRole('button', { name: 'Use my location' }));
  expect(mocks.fit).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ maxZoom: 16 }),
  );
  expect(screen.getByText('Location accuracy: ±2,000 m')).toHaveClass('sr-only');
  expect(screen.getByRole('button', { name: 'Use my location' })).toHaveAccessibleDescription(
    'Location accuracy: ±2,000 m',
  );
  expect(document.querySelector('.map-annotation-status')).not.toBeInTheDocument();
  expect(mocks.fly).not.toHaveBeenCalled();
});

it('recomputes distance annotations on zoom without joining disconnected geometry', () => {
  const segments: [number, number][][] = [
    [
      [0, 0],
      [0.2, 0],
    ],
    [
      [10, 0],
      [10.2, 0],
    ],
  ];
  render(<RouteMap {...props} segments={segments} />);
  act(() => mocks.handlers.get('load')?.());
  const source = mocks.extraData.get('route-annotations')!;
  const initialCount = source.mock.lastCall![0].features.length;
  mocks.zoom = 14;
  act(() => mocks.handlers.get('zoomend')?.());
  expect(source.mock.lastCall![0].features.length).toBeGreaterThan(initialCount);
  expect(mocks.data.mock.lastCall![0].features).toHaveLength(2);
  expect(mocks.layer).toHaveBeenCalledWith(
    expect.objectContaining({
      id: 'route-direct-line',
      paint: expect.objectContaining({ 'line-dasharray': [2, 2] }),
    }),
  );
  expect(mocks.fit).not.toHaveBeenCalled();
});

it('allows read-only waypoint selection but never offers mutating actions', () => {
  const onSelectWaypoint = vi.fn(),
    onRemoveWaypoint = vi.fn();
  render(
    <RouteMap
      {...props}
      waypoints={annotationWaypoints}
      editable={false}
      onSelectWaypoint={onSelectWaypoint}
      onRemoveWaypoint={onRemoveWaypoint}
    />,
  );
  act(() => mocks.handlers.get('load')?.());
  fireEvent.click(mocks.markerOptions.mock.calls[0][0].element);
  expect(onSelectWaypoint).toHaveBeenCalledWith('a');
  expect(screen.queryByRole('button', { name: 'Remove waypoint' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Close waypoint actions' })).toBeInTheDocument();
});

it('restores keyboard focus when selected marker styling changes', () => {
  const { rerender } = render(
    <RouteMap {...props} waypoints={annotationWaypoints} selectedWaypointId="a" />,
  );
  act(() => mocks.handlers.get('load')?.());
  const element = mocks.markerOptions.mock.calls[0][0].element as HTMLButtonElement;
  document.body.append(element);
  element.focus();
  const focus = vi.spyOn(HTMLElement.prototype, 'focus');
  rerender(<RouteMap {...props} waypoints={annotationWaypoints} selectedWaypointId="b" />);
  expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  element.remove();
});
