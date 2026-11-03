import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { Coordinate } from './domain/types';
import { act, fireEvent, render, screen, waitFor, cleanup, within } from '@testing-library/react';
import App from './App';
import { version as appVersion } from '../../package.json';
import { version as clientVersion } from '../package.json';
import { routeDb } from './domain/storage';
import * as storage from './domain/storage';
import { DISCLAIMER_KEY } from './domain/disclaimer';
import { initialEditor } from './domain/editorSnapshot';
import * as drafts from './domain/drafts';
import { exportGpx, importGpx } from './domain/gpx';
import { checkRoutingConfiguration } from './services/routing';
import { importGpxFile } from './services/gpxImport';
import i18n, { detectLanguage, LANGUAGE_KEY } from './i18n';
vi.mock('./services/connectors/googleDriveSession', () => ({
  getGoogleDriveSession: vi.fn().mockResolvedValue({ available: false, connected: false }),
  logoutGoogleDrive: vi.fn(),
}));
const provider = vi.hoisted(() => ({
  calculateRoute: vi.fn(),
  calculateAlternatives: vi.fn(),
  calculatePointAlternatives: vi.fn(),
}));
vi.mock('./services/routing', () => ({
  checkRoutingConfiguration: vi.fn().mockResolvedValue(true),
  routingProvider: provider,
}));
vi.mock('./services/gpxImport', () => ({ importGpxFile: vi.fn() }));
vi.mock('./components/ExportRouteMap', () => ({
  ExportRouteMap: () => <figure aria-label="Route map preview" />,
}));
vi.mock('./components/RouteMap', () => ({
  RouteMap: ({
    segments,
    manualDrawing,
    onToggleManualDrawing,
    onUndo,
    onRedo,
    canUndo,
    canRedo,
    onMove,
    waypoints,
    selectedWaypointId,
    onSelectWaypoint,
    onReplaceWaypoint,
    routeStale,
    directSegments,
    comparisonLayers,
    comparisonMode,
    highlightSegments,
    editingToolbar,
    onAdd,
    fitToken,
    fitMaxZoom,
    loadingOverlayEnabled,
  }: {
    segments: unknown[];
    manualDrawing?: boolean;
    onToggleManualDrawing?: () => void;
    onUndo?: () => void;
    onRedo?: () => void;
    canUndo?: boolean;
    canRedo?: boolean;
    onMove: (id: string, coordinate: [number, number]) => void;
    waypoints: { id: string }[];
    selectedWaypointId?: string | null;
    onSelectWaypoint?: (id: string) => void;
    onReplaceWaypoint?: (id: string) => void;
    routeStale?: boolean;
    directSegments?: unknown[];
    comparisonLayers?: unknown[];
    comparisonMode?: boolean;
    highlightSegments?: unknown[];
    editingToolbar?: ReactNode;
    onAdd?: (coordinate: [number, number]) => void;
    fitToken: number;
    fitMaxZoom?: number;
    loadingOverlayEnabled?: boolean;
  }) => (
    <div
      data-testid="map"
      data-loading-overlay={loadingOverlayEnabled}
      data-segments={segments.length}
      data-manual={manualDrawing}
      data-geometry={JSON.stringify(segments)}
      data-selected={selectedWaypointId ?? ''}
      data-stale={routeStale}
      data-direct={JSON.stringify(directSegments ?? [])}
      data-comparison={comparisonMode}
      data-comparison-layers={JSON.stringify(comparisonLayers ?? [])}
      data-highlight={JSON.stringify(highlightSegments ?? [])}
      data-fit-token={fitToken}
      data-fit-max-zoom={fitMaxZoom}
    >
      Map
      {editingToolbar}
      <button onClick={() => onAdd?.([11.405, 47.28])}>Add detour map point</button>
      <button aria-pressed={manualDrawing} onClick={onToggleManualDrawing}>
        Manual drawing
      </button>
      <button disabled={!onUndo || canUndo === false} onClick={onUndo}>
        Undo
      </button>
      <button disabled={!onRedo || canRedo === false} onClick={onRedo}>
        Redo
      </button>
      <button disabled={!waypoints.length} onClick={() => onMove(waypoints[0].id, [11.5, 47.3])}>
        Move first map point
      </button>
      <button disabled={!waypoints.length} onClick={() => onSelectWaypoint?.(waypoints[0].id)}>
        Select first map point
      </button>
      <button disabled={!waypoints.length} onClick={() => onReplaceWaypoint?.(waypoints[0].id)}>
        Replace first map point
      </button>
    </div>
  ),
}));
const geometry: [number, number, number][] = [
  [11.4, 47.26, 600],
  [11.405, 47.265, 630],
  [11.41, 47.27, 615],
];
beforeEach(async () => {
  cleanup();
  await routeDb.routes.clear();
  await routeDb.table('drafts').clear();
  const values = new Map<string, string>([[DISCLAIMER_KEY, 'acknowledged']]);
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
  });
  vi.clearAllMocks();
  vi.mocked(checkRoutingConfiguration).mockResolvedValue(true);
  vi.mocked(importGpxFile).mockReset().mockImplementation(async (file) => importGpx(await file.text()));
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
  provider.calculateRoute.mockResolvedValue({
    segments: [geometry],
    stats: { distance: 1342, duration: 480, ascent: 30, descent: 15 },
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe('first-visit disclaimer', () => {
  it('blocks the first visit until confirmation, persists it and skips subsequent openings', async () => {
    localStorage.removeItem(DISCLAIMER_KEY);
    const view = render(<App />);
    const dialog = screen.getByRole('dialog', { name: 'Before you plan' });
    const confirm = within(dialog).getByRole('button', { name: 'Understood' });
    expect(confirm).toHaveFocus();
    expect(within(dialog).getAllByRole('button')).toHaveLength(1);
    expect(localStorage.getItem(DISCLAIMER_KEY)).toBeNull();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    fireEvent.pointerDown(document.body);
    expect(dialog).toBeInTheDocument();
    fireEvent.click(confirm);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(localStorage.getItem(DISCLAIMER_KEY)).toBe('acknowledged');
    view.unmount();
    const reopened = render(<App />);
    expect(screen.queryByRole('dialog', { name: 'Before you plan' })).not.toBeInTheDocument();
    await plan();
    reopened.unmount();
    localStorage.clear();
    render(<App />);
    expect(screen.getByRole('dialog', { name: 'Before you plan' })).toBeInTheDocument();
  });

  it.each(['read', 'write'])('allows this opening and warns when storage %s fails', async (failure) => {
    localStorage.removeItem(DISCLAIMER_KEY);
    if (failure === 'read') vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw new Error('Unavailable'); });
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('Unavailable'); });
    const view = render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Understood' }));
    expect(await screen.findByText('Your acknowledgement could not be saved. You can keep planning now, but this notice will appear again next time.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Before you plan' })).not.toBeInTheDocument();
    await plan();
    view.unmount();
    render(<App />);
    expect(screen.getByRole('dialog', { name: 'Before you plan' })).toBeInTheDocument();
  });

  it('queues the draft after confirmation and restores it normally', async () => {
    localStorage.removeItem(DISCLAIMER_KEY);
    await routeDb.table('drafts').put({
      id: 'current', version: 1, updatedAt: new Date().toISOString(), snapshot: initialEditor(),
    });
    const getDraft = vi.spyOn(drafts, 'loadDraft');
    render(<App />);
    await waitFor(() => expect(getDraft).toHaveResolved());
    expect(screen.getByTestId('map')).toHaveAttribute('data-loading-overlay', 'false');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.queryByRole('dialog', { name: 'Restore your draft?' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Understood' }));
    const restore = await screen.findByRole('button', { name: 'Restore draft' });
    await waitFor(() => expect(restore).toHaveFocus());
    expect(screen.getByTestId('map')).toHaveAttribute('data-loading-overlay', 'false');
    fireEvent.click(restore);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('map')).toHaveAttribute('data-loading-overlay', 'true');
  });

  it('updates an open disclaimer when the language changes without losing confirmation focus', async () => {
    localStorage.removeItem(DISCLAIMER_KEY);
    render(<App />);
    await act(() => i18n.changeLanguage('ru'));
    expect(screen.getByRole('dialog', { name: 'Перед планированием' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Понятно' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Понятно' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

function openMenu() {
  fireEvent.keyDown(screen.getByRole('button', { name: /^(Menu|Меню)$/ }), { key: 'ArrowDown' });
}
function selectLanguage(label: string) {
  openMenu();
  fireEvent.click(screen.getByRole('menuitemradio', { name: label }));
}
function addCoordinates(texts: string[]) {
  const latitude = screen.getByRole('textbox', { name: 'Latitude' });
  const add = screen.getByRole('button', { name: 'Add coordinates' });
  for (const text of texts) {
    fireEvent.change(latitude, { target: { value: text } });
    fireEvent.click(add);
  }
}
function addCoordinate(text: string) {
  addCoordinates([text]);
}
function choosePlannerOption(label: string, option: string) {
  fireEvent.keyDown(screen.getByRole('button', { name: label }), { key: 'ArrowDown' });
  fireEvent.click(screen.getByRole('menuitemradio', { name: option }));
}
async function plan() {
  addCoordinate('47.26, 11.4');
  addCoordinate('47.27, 11.41');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save route' })).toBeEnabled());
}
function setOnline(online: boolean) {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(online);
  act(() => window.dispatchEvent(new Event(online ? 'online' : 'offline')));
}

it('renders planner sections without duplicate React keys before and after planning', async () => {
  const consoleError = vi.spyOn(console, 'error');
  render(<App />);
  await plan();
  expect(screen.getByText('Personal time')).toBeInTheDocument();
  expect(consoleError.mock.calls.filter((args) =>
    args.some((arg) => typeof arg === 'string' && arg.includes('same key')),
  )).toEqual([]);
});

it('draws a local section detour, cancels losslessly and applies it as a single route edit', async () => {
  render(<App />);
  await plan();
  addCoordinate('47.29, 11.42');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save route' })).toBeEnabled());
  const original = screen.getByTestId('map').getAttribute('data-geometry');
  const originalFit = screen.getByTestId('map').getAttribute('data-fit-token');
  const originalCalls = provider.calculateRoute.mock.calls.length;
  const start = () => {
    fireEvent.keyDown(screen.getByRole('button', { name: 'Section 1 mode' }), { key: 'ArrowDown' });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Draw a detour' }));
  };
  start();
  expect(screen.getByTestId('map')).toHaveAttribute('data-fit-token', String(Number(originalFit) + 1));
  expect(screen.getByTestId('map')).toHaveAttribute('data-fit-max-zoom', '18');
  expect(screen.getByRole('button', { name: 'Done' })).toBeDisabled();
  expect(document.querySelector('#route-planner')).toHaveAttribute('inert');
  fireEvent.click(screen.getByRole('button', { name: 'Add detour map point' }));
  expect(screen.getByTestId('map')).toHaveAttribute('data-fit-token', String(Number(originalFit) + 1));
  expect(screen.getByRole('button', { name: 'Done' })).toBeEnabled();
  expect(provider.calculateRoute).toHaveBeenCalledTimes(originalCalls);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.getByTestId('map')).toHaveAttribute('data-geometry', original!);
  expect(provider.calculateRoute).toHaveBeenCalledTimes(originalCalls);
  start();
  fireEvent.click(screen.getByRole('button', { name: 'Add detour map point' }));
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save route' })).toBeEnabled());
  const updated = provider.calculateRoute.mock.calls.at(-1)![0];
  expect(updated.map((point: { legMode?: string }) => point.legMode)).toEqual(['direct', 'direct', undefined, undefined]);
  expect(updated[1].coordinate).toEqual([11.405, 47.28]);
  expect(screen.getByRole('button', { name: 'Section 3 mode' })).toHaveTextContent('Road/path routing');
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
  expect(screen.queryByRole('button', { name: 'Section 3 mode' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Section 1 mode' })).toHaveTextContent('Road/path routing');
  expect(screen.getByTestId('map')).toHaveAttribute('data-geometry', original!);
});

describe('route preparation features', () => {
  it('compares saved routes without losing the current unsaved editor or making routing requests', async () => {
    const now = new Date().toISOString();
    await routeDb.routes.bulkAdd(
      ['Lake', 'Forest'].map((name, index) => ({
        id: `comparison-${index}`,
        name,
        description: '',
        activity: 'hiking' as const,
        segments: [geometry],
        waypoints: [],
        stats: { distance: 1342, duration: 1000 },
        source: 'gpx' as const,
        createdAt: now,
        updatedAt: now,
      })),
    );
    render(<App />);
    await plan();
    const editorMap = screen.getByTestId('map');
    const before = editorMap.getAttribute('data-geometry');
    const requests = provider.calculateRoute.mock.calls.length;
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'My routes' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select Lake for comparison' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Forest for comparison' }));
    const compare = screen.getByRole('button', { name: 'Compare routes' });
    compare.focus();
    fireEvent.click(compare);
    const dialog = screen.getByRole('dialog', { name: 'Compare saved routes' });
    expect(dialog).toHaveClass('comparison-screen');
    fireEvent.click(within(dialog).getByText('Route statistics'));
    expect(
      within(dialog).getByRole('table', { name: 'Saved route comparison' }),
    ).toBeInTheDocument();
    expect(within(dialog).getByTestId('map')).toHaveAttribute('data-comparison', 'true');
    expect(editorMap).toHaveAttribute('data-geometry', before!);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Back to routes' }));
    await waitFor(() => expect(compare).toHaveFocus());
    fireEvent.click(compare);
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Compare saved routes' })).getByRole('button', { name: 'Back to planner' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Menu' })).toHaveFocus());
    expect(screen.queryByRole('dialog', { name: 'Compare saved routes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Saved routes' })).not.toBeInTheDocument();
    expect(screen.getByTestId('map')).toBe(editorMap);
    expect(editorMap).toHaveAttribute('data-geometry', before!);
    expect(screen.getByRole('button', { name: 'Save route' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Export' })).toBeEnabled();
    expect(provider.calculateRoute).toHaveBeenCalledTimes(requests);
  });

  it('highlights imported climbs and clears the highlight when opening another route', async () => {
    render(<App />);
    const xml =
      '<gpx version="1.1"><metadata><name>Climb</name></metadata><trk><trkseg><trkpt lat="47.26" lon="11.4"><ele>100</ele></trkpt><trkpt lat="47.27" lon="11.41"><ele>150</ele></trkpt></trkseg></trk></gpx>';
    const file = Object.assign(new File([xml], 'climb.gpx', { type: 'application/gpx+xml' }), {
      text: async () => xml,
    });
    fireEvent.change(screen.getByLabelText('Import GPX file'), { target: { files: [file] } });
    const heading = await screen.findByRole('heading', { name: 'Climb analysis' });
    fireEvent.click(heading.closest('summary')!);
    const climb = await within(
      await screen.findByRole('region', { name: 'Climb analysis' }),
    ).findByRole('button', { name: /Climb 1/ });
    fireEvent.click(climb);
    expect(screen.getByTestId('map').getAttribute('data-highlight')).not.toBe('[]');
    expect(provider.calculateRoute).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'New route' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(screen.getByTestId('map')).toHaveAttribute('data-highlight', '[]');
  });
});

describe('GPX file selection', () => {
  it('shows cancellable processing and leaves the route untouched after a late worker response', async () => {
    let complete!: (route: ReturnType<typeof importGpx>) => void;
    vi.mocked(importGpxFile).mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    render(<App />);
    const original = screen.getByTestId('map').getAttribute('data-geometry');
    fireEvent.change(screen.getByLabelText('Import GPX file'), { target: { files: [new File(['<gpx/>'], 'large.gpx')] } });
    expect(await screen.findByText('Importing GPX…')).toHaveAttribute('role', 'status');
    const importAction = screen.getByRole('button', { name: 'Import GPX' });
    expect(importAction).toBeDisabled();
    expect(importAction).toHaveAttribute('aria-busy', 'true');
    expect(importAction).toHaveAttribute('title', 'Importing GPX…');
    const signal = vi.mocked(importGpxFile).mock.calls[0][1]!;
    fireEvent.click(screen.getByRole('button', { name: 'Cancel GPX import' }));
    expect(signal.aborted).toBe(true);
    await act(async () => {
      complete(importGpx('<gpx><trk><trkseg><trkpt lat="47" lon="11"/><trkpt lat="47.01" lon="11.01"/></trkseg></trk></gpx>'));
    });
    expect(screen.getByTestId('map')).toHaveAttribute('data-geometry', original!);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(importAction).toHaveAttribute('aria-busy', 'false');
    expect(importAction).toBeEnabled();
    expect(importAction).toHaveAttribute('title', 'Import GPX');
  });
  it('imports dropped GPX through the worker boundary and still confirms replacing unsaved work', async () => {
    render(<App />);
    await plan();
    const original = screen.getByTestId('map').getAttribute('data-geometry');
    const xml = '<gpx><trk><trkseg><trkpt lat="48" lon="12"><ele>100</ele></trkpt><trkpt lat="48.01" lon="12.01"><ele>120</ele></trkpt></trkseg></trk></gpx>';
    const file = Object.assign(new File([xml], 'dropped.gpx'), { text: async () => xml });
    fireEvent.drop(document.querySelector('.app')!, { dataTransfer: { files: [file], types: ['Files'] } });
    expect(await screen.findByRole('button', { name: 'Discard changes' })).toBeVisible();
    expect(importGpxFile).toHaveBeenCalledWith(file, expect.any(AbortSignal));
    expect(screen.getByTestId('map')).toHaveAttribute('data-geometry', original!);
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(screen.getByTestId('map')).toHaveAttribute('data-geometry', JSON.stringify(importGpx(xml).segments));
  });
  it.each([
    ['Новый маршрут.gpx', 'application/gpx+xml'],
    ['Новый маршрут.gpx', ''],
    ['Новый маршрут.gpx 2', 'application/octet-stream'],
  ])('imports exported XML from %s with MIME type %s', async (name, type) => {
    const route = importGpx(
      '<gpx><metadata><name>Новый маршрут</name><desc/></metadata><wpt lat="47.26" lon="11.4"/><wpt lat="47.27" lon="11.41"/><trk><trkseg><trkpt lat="47.26" lon="11.4"><ele>100</ele></trkpt><trkpt lat="47.27" lon="11.41"><ele>150</ele></trkpt></trkseg></trk></gpx>',
    );
    route.source = 'openrouteservice';
    const xml = exportGpx(route);
    const file = Object.assign(new File([xml], name, { type }), { text: async () => xml });
    render(<App />);
    const input = screen.getByLabelText('Import GPX file');
    expect(input).not.toHaveAttribute('accept');
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() =>
      expect(screen.getByTestId('map')).toHaveAttribute(
        'data-geometry',
        JSON.stringify(route.segments),
      ),
    );
    expect(screen.getByRole('button', { name: 'Export' })).toBeEnabled();
    expect(provider.calculateRoute).not.toHaveBeenCalled();
  });

  it('still rejects non-GPX content without replacing the current geometry', async () => {
    render(<App />);
    await plan();
    const geometry = screen.getByTestId('map').getAttribute('data-geometry');
    const file = Object.assign(new File(['<other/>'], 'other.xml', { type: 'text/xml' }), {
      text: async () => '<other/>',
    });
    fireEvent.change(screen.getByLabelText('Import GPX file'), { target: { files: [file] } });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      i18n.t('Invalid GPX: expected a gpx root element.'),
    );
    expect(screen.getByTestId('map')).toHaveAttribute('data-geometry', geometry!);
  });
});

describe('route export', () => {
  it('opens the export dialog before downloading and keeps the original route name', async () => {
    const createObjectURL = vi.fn<(blob: Blob) => string>(() => 'blob:test-export');
    vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL = createObjectURL;
        static revokeObjectURL = vi.fn();
      },
    );
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<App />);
    await plan();
    const geometryBefore = screen.getByTestId('map').getAttribute('data-geometry');
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    const dialog = screen.getByRole('dialog', { name: 'Export route' });
    expect(createObjectURL).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'File name' }), {
      target: { value: 'Weekend/trip.gpx' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Download GPX' }));
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(click.mock.instances[0]).toHaveAttribute('download', 'Weekend-trip.gpx');
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    expect(blob.type).toBe('application/gpx+xml');
    const xml = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(blob);
    });
    expect(xml).toContain('<name>Untitled route</name>');
    expect(importGpx(xml).segments).toEqual(JSON.parse(geometryBefore!));
    expect(xml).not.toContain('Weekend');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('map').getAttribute('data-geometry')).toBe(geometryBefore);
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-export'), {
      timeout: 1500,
    });
  });
});

describe('offline planner', () => {
  it('checks server routing availability only after an offline start reconnects', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    render(<App />);
    expect(checkRoutingConfiguration).not.toHaveBeenCalled();
    setOnline(true);
    await waitFor(() => expect(checkRoutingConfiguration).toHaveBeenCalledOnce());
    expect(provider.calculateRoute).not.toHaveBeenCalled();
  });

  it('preserves calculated geometry and export, blocks online editing, and does not recalculate on reconnect', async () => {
    await i18n.changeLanguage('en');
    render(<App />);
    await plan();
    const original = screen.getByTestId('map').getAttribute('data-geometry');
    provider.calculateRoute.mockClear();
    setOnline(false);
    expect(screen.getByText('No internet connection')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Update route' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Latitude' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Cycling' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Export' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Save route' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Move first map point' }));
    expect(screen.getByTestId('map').getAttribute('data-geometry')).toBe(original);
    setOnline(true);
    expect(screen.getByRole('button', { name: 'Update route' })).toBeEnabled();
    expect(screen.queryByText('No internet connection')).not.toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(provider.calculateRoute).not.toHaveBeenCalled();
    expect(screen.getByTestId('map').getAttribute('data-geometry')).toBe(original);
  });

  it('cancels pending automatic routing when the connection is lost', async () => {
    await i18n.changeLanguage('en');
    provider.calculateRoute.mockImplementation(() => new Promise(() => {}));
    render(<App />);
    addCoordinate('47.26, 11.4');
    addCoordinate('47.27, 11.41');
    await waitFor(() => expect(provider.calculateRoute).toHaveBeenCalledOnce());
    const signal = provider.calculateRoute.mock.calls[0][2] as AbortSignal;
    setOnline(false);
    expect(signal.aborted).toBe(true);
    await waitFor(() => expect(screen.queryByText('Calculating route…')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Calculate route' })).toBeDisabled();
  });

  it('allows coordinate-based manual routes offline and hides online setup errors', async () => {
    await i18n.changeLanguage('en');
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    vi.mocked(checkRoutingConfiguration).mockResolvedValue(false);
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Use manual drawing' }));
    addCoordinate('47.26, 11.4');
    addCoordinate('47.27, 11.41');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Export' })).toBeEnabled());
    expect(screen.getByRole('textbox', { name: 'Latitude' })).toBeEnabled();
    expect(
      screen.getByText(/Enter coordinates to draw straight lines without an online map\./),
    ).toBeVisible();
    expect(document.querySelector('.configuration-note')).toBeNull();
    expect(provider.calculateRoute).not.toHaveBeenCalled();
  });
});

describe('route planner interactions', () => {
  it.each([
    ['en', 'Roamlet home', 'Version'],
    ['ru', 'Главная Roamlet', 'Версия'],
  ])('shows the current version on the beta marker (%s)', async (language, home, label) => {
    await i18n.changeLanguage(language);
    render(<App />);
    const brand = screen.getByRole('link', { name: home });
    expect(within(brand).getByText('Roamlet')).toBeVisible();
    const beta = within(brand).getByText('beta');
    expect(beta).toBeVisible();
    expect(beta).toHaveAttribute('title', `${label} ${appVersion}`);
    expect(clientVersion).toBe(appVersion);
  });

  it('offers manual drawing in the empty planner and an explicit return without routing requests', async () => {
    await i18n.changeLanguage('en');
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Draw a route manually' }));
    expect(screen.getByRole('region', { name: 'Manual drawing' })).toBeVisible();
    expect(screen.queryByRole('radiogroup', { name: 'Route style' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Return to automatic routing' }));
    expect(screen.getByRole('radiogroup', { name: 'Route style' })).toBeVisible();
    expect(provider.calculateRoute).not.toHaveBeenCalled();
  });

  it('returns OAuth callbacks to connections and removes callback flags from the URL', async () => {
    window.history.replaceState(null, '', '/?connectors=github&github=error');
    render(<App />);
    expect(screen.getByRole('region', { name: 'Connections' })).toBeVisible();
    const message = await screen.findByText('GitHub authorization was cancelled or failed. Open connection settings to try again.');
    expect(message.closest('[data-sonner-toast]')).toHaveAttribute('data-type', 'error');
    expect(message).toBeVisible();
    expect(window.location.search).toBe('');
  });

  it('returns Google OAuth callbacks to the catalog and removes provider flags', async () => {
    window.history.replaceState(null, '', '/?connectors=google-drive&google=error');
    render(<App />);
    expect(screen.getByRole('region', { name: 'Connections' })).toBeVisible();
    const message = await screen.findByText('Google authorization was cancelled or failed. Open connection settings to try again.');
    expect(message.closest('[data-sonner-toast]')).toHaveAttribute('data-type', 'error');
    expect(window.location.search).toBe('');
  });

  it('opens connectors as a separate screen and restores planner navigation on return', async () => {
    render(<App />);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Connections' }));
    expect(screen.getByRole('region', { name: 'Connections' })).toBeVisible();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.querySelector('.app-header')?.closest('[inert]')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Back to map' }));
    expect(screen.queryByRole('region', { name: 'Connections' })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Menu' })).toHaveFocus());
  });

  it('explains offline limits and JSON backups before the connection is lost', async () => {
    await i18n.changeLanguage('en');
    render(<App />);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Help and data sources' }));
    const help = screen.getByRole('dialog', { name: 'Help and data sources' });
    expect(within(help).getByText('Without an internet connection')).toBeVisible();
    expect(within(help).getByText(/Visit the app online first/)).toBeVisible();
    expect(within(help).getByText(/Optional encrypted cloud backups are available in Connections/)).toBeVisible();
    expect(within(help).getByText(/Internet required: loading the map/)).toBeVisible();
  });

  it('explains why returning to automatic routing is disabled offline', async () => {
    await i18n.changeLanguage('en');
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Draw a route manually' }));
    setOnline(false);
    const button = screen.getByRole('button', { name: 'Return to automatic routing' });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription('Connect to the internet to calculate routes.');
    expect(document.querySelector('.offline-planner-notice')).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Latitude' })).toBeEnabled();
  });
  it.each(['en', 'ru'])(
    'shows product help and accurate data credits without deployment instructions (%s)',
    async (language) => {
      await i18n.changeLanguage(language);
      vi.mocked(checkRoutingConfiguration).mockResolvedValue(false);
      render(<App />);
      expect(
        await screen.findByText(
          i18n.t('Configure ORS_API_KEY on the server. GPX and saved routes remain available.'),
        ),
      ).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: i18n.t('Setup') }));
      const help = screen.getByRole('dialog');
      expect(within(help).getByRole('link', { name: 'OpenRouteService' })).toHaveAttribute(
        'href',
        'https://openrouteservice.org/',
      );
      expect(within(help).getByRole('link', { name: 'OpenFreeMap' })).toHaveAttribute(
        'href',
        'https://openfreemap.org/',
      );
      expect(within(help).getByRole('link', { name: 'OpenMapTiles' })).toHaveAttribute(
        'href',
        'https://openmaptiles.org/',
      );
      expect(within(help).getByRole('link', { name: 'ODbL' })).toHaveAttribute(
        'href',
        'https://opendatacommons.org/licenses/odbl/1-0/',
      );
      expect(help).not.toHaveTextContent(
        /ORS_API_KEY|Vercel|Firewall|cycling-regular|foot-hiking|18 km\/h|18 км\/ч/,
      );
      expect(within(help).queryByRole('link', { name: /signup/i })).not.toBeInTheDocument();
      expect(help).toHaveTextContent(i18n.t('Standard map: OpenStreetMap. Light map:'));
      expect(help).toHaveTextContent(i18n.t('Online requests and your data'));
      expect(help).toHaveTextContent(i18n.t('Planning routes'));
    },
  );
  it.each(
    [
      [
        'The routing request was rejected. Check the OpenRouteService API key and account permissions.',
        'Не удалось выполнить автоматический расчёт. Попробуйте позже или нарисуйте маршрут вручную.',
      ],
      [
        'The routing request exceeds the service limits. Try fewer points or a shorter route.',
        'Запрос маршрута превышает ограничения сервиса. Попробуйте меньше точек или более короткий маршрут.',
      ],
    ].flatMap(([message, russian]) =>
      ['en', 'ru'].map((language) => ({ message, russian, language })),
    ),
  )(
    'localizes actionable ORS toast in $language: $message',
    async ({ message, russian, language }) => {
      await act(async () => {
        await i18n.changeLanguage(language);
      });
      provider.calculateRoute.mockRejectedValueOnce(new Error(message));
      render(<App />);
      for (const coordinate of ['47.26, 11.4', '47.27, 11.41']) {
        fireEvent.change(screen.getByRole('textbox', { name: i18n.t('Latitude') }), {
          target: { value: coordinate },
        });
        fireEvent.click(screen.getByRole('button', { name: i18n.t('Add coordinates') }));
      }
      const expected = language === 'ru' ? russian : i18n.t(message);
      const error = await screen.findByText(expected);
      const notification = error.closest<HTMLElement>('[data-sonner-toast]')!;
      expect(notification).toHaveAttribute('data-type', 'error');
      expect(
        within(notification).getByRole('button', { name: i18n.t('Retry routing') }),
      ).toBeEnabled();
      expect(screen.getAllByText(expected)).toHaveLength(1);
      expect(document.querySelector('.planner-route-status')).not.toHaveTextContent(expected);
      expect(screen.getByRole('button', { name: i18n.t('Export') })).toBeDisabled();
      await act(async () => {
        await i18n.changeLanguage('en');
      });
    },
  );
  it('draws, moves, reverses and undoes manual segments without Directions or a token', async () => {
    vi.mocked(checkRoutingConfiguration).mockResolvedValue(false);
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Manual drawing' }));
    expect(screen.getByRole('button', { name: 'Manual drawing' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    addCoordinate('47.26, 11.4');
    addCoordinate('47.27, 11.41');
    expect(screen.getByTestId('map')).toHaveAttribute(
      'data-geometry',
      JSON.stringify([
        [
          [11.4, 47.26],
          [11.41, 47.27],
        ],
      ]),
    );
    expect(screen.getByRole('button', { name: 'Save route' })).toBeEnabled();
    expect(screen.queryByText('ORS_API_KEY')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Move first map point' }));
    expect(screen.getByTestId('map')).toHaveAttribute(
      'data-geometry',
      JSON.stringify([
        [
          [11.5, 47.3],
          [11.41, 47.27],
        ],
      ]),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reverse' }));
    expect(screen.getByTestId('map')).toHaveAttribute(
      'data-geometry',
      JSON.stringify([
        [
          [11.41, 47.27],
          [11.5, 47.3],
        ],
      ]),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByTestId('map')).toHaveAttribute(
      'data-geometry',
      JSON.stringify([
        [
          [11.5, 47.3],
          [11.41, 47.27],
        ],
      ]),
    );
    expect(screen.getByRole('button', { name: 'Export' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
    expect(screen.getByTestId('map')).toHaveAttribute(
      'data-geometry',
      JSON.stringify([
        [
          [11.41, 47.27],
          [11.5, 47.3],
        ],
      ]),
    );
    addCoordinate('47.28, 11.42');
    fireEvent.click(screen.getByRole('radio', { name: 'Hiking' }));
    expect(provider.calculateRoute).not.toHaveBeenCalled();
    expect(provider.calculateAlternatives).not.toHaveBeenCalled();
  });

  it('prefills each replacement target and clears editing values on cancellation', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Manual drawing' }));
    addCoordinate('52.45097123, 31.02042123');
    addCoordinate('52.45134, 31.0323');
    const latitude = screen.getByRole('textbox', { name: 'Latitude' });
    const longitude = screen.getByRole('textbox', { name: 'Longitude' });
    fireEvent.click(screen.getByRole('button', { name: 'Replace stop 1' }));
    expect(latitude).toHaveValue('52.45097123');
    expect(longitude).toHaveValue('31.02042123');
    fireEvent.change(latitude, { target: { value: '91' } });
    fireEvent.click(screen.getByRole('button', { name: 'Replace stop coordinates' }));
    expect(latitude).toHaveAttribute('aria-invalid', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Replace stop 2' }));
    expect(latitude).toHaveValue('52.45134');
    expect(longitude).toHaveValue('31.0323');
    expect(latitude).toHaveAttribute('aria-invalid', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel replacing stop' }));
    expect(latitude).toHaveValue('');
    expect(longitude).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Add coordinates' })).toBeDisabled();
    expect(screen.getByTestId('map')).toHaveAttribute('data-geometry', JSON.stringify([
      [[31.02042123, 52.45097123], [31.0323, 52.45134]],
    ]));
  });

  it('replaces a stop through separate coordinate fields and clears them only after a valid change', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Manual drawing' }));
    addCoordinate('47.26, 11.4');
    addCoordinate('47.27, 11.41');
    fireEvent.click(screen.getByRole('button', { name: 'Replace stop 1' }));
    const latitude = screen.getByRole('textbox', { name: 'Latitude' });
    const longitude = screen.getByRole('textbox', { name: 'Longitude' });
    expect(latitude).toHaveFocus();
    expect(latitude).toHaveValue('47.26');
    expect(longitude).toHaveValue('11.4');
    fireEvent.change(latitude, { target: { value: '91' } });
    fireEvent.change(longitude, { target: { value: '11.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Replace stop coordinates' }));
    expect(latitude).toHaveValue('91');
    expect(screen.getByTestId('map')).toHaveAttribute(
      'data-geometry',
      JSON.stringify([
        [
          [11.4, 47.26],
          [11.41, 47.27],
        ],
      ]),
    );
    fireEvent.change(latitude, { target: { value: '47.3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Replace stop coordinates' }));
    expect(screen.getByTestId('map')).toHaveAttribute(
      'data-geometry',
      JSON.stringify([
        [
          [11.5, 47.3],
          [11.41, 47.27],
        ],
      ]),
    );
    expect(latitude).toHaveValue('');
    expect(longitude).toHaveValue('');
    expect(latitude).toHaveFocus();
    expect(
      screen.queryByRole('button', { name: 'Replace stop coordinates' }),
    ).not.toBeInTheDocument();
    expect(provider.calculateRoute).not.toHaveBeenCalled();
  });

  it('saves and reopens manual routes for editing without converting them to provider routes', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Manual drawing' }));
    addCoordinate('47.26, 11.4');
    addCoordinate('47.27, 11.41');
    fireEvent.click(screen.getByRole('button', { name: 'Save route' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Route name' }), {
      target: { value: 'Hand drawn' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save to library' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect((await routeDb.routes.toArray())[0].source).toBe('manual');
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'My routes' }));
    fireEvent.click(await screen.findByRole('button', { name: /Hand drawn Cycling/ }));
    fireEvent.click(screen.getByRole('radio', { name: 'Hiking' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit waypoints' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Manual drawing' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    addCoordinate('47.28, 11.42');
    expect(JSON.parse(screen.getByTestId('map').getAttribute('data-geometry')!)[0]).toHaveLength(3);
    expect(provider.calculateRoute).not.toHaveBeenCalled();
  });

  it('requires confirmation before replacing manual geometry with automatic routing', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Manual drawing' }));
    addCoordinate('47.26, 11.4');
    addCoordinate('47.27, 11.41');
    fireEvent.click(screen.getByRole('button', { name: 'Manual drawing' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Switch to automatic routing?');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(provider.calculateRoute).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Manual drawing' }));
    fireEvent.click(screen.getByRole('button', { name: 'Switch mode' }));
    await waitFor(() => expect(provider.calculateRoute).toHaveBeenCalledTimes(1));
    expect(provider.calculateRoute.mock.calls[0][0]).toHaveLength(2);
  });

  it('ignores a late Directions response after switching to manual drawing', async () => {
    let resolve!: (value: {
      segments: number[][][];
      stats: { distance: number; duration: number };
    }) => void;
    provider.calculateRoute.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    render(<App />);
    addCoordinate('47.26, 11.4');
    addCoordinate('47.27, 11.41');
    await waitFor(() => expect(provider.calculateRoute).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Manual drawing' }));
    fireEvent.click(screen.getByRole('button', { name: 'Switch mode' }));
    await act(async () =>
      resolve({ segments: [geometry], stats: { distance: 999, duration: 100 } }),
    );
    expect(screen.getByTestId('map')).toHaveAttribute(
      'data-geometry',
      JSON.stringify([
        [
          [11.4, 47.26],
          [11.41, 47.27],
        ],
      ]),
    );
    expect(screen.getByRole('button', { name: 'Save route' })).toBeEnabled();
    expect(provider.calculateRoute).toHaveBeenCalledTimes(1);
  });

  it('confirms loop conversion, keeps its stops and restores the previous automatic mode', async () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    provider.calculateAlternatives.mockResolvedValueOnce([
      {
        segments: [
          [
            [11.4, 47.26],
            [11.41, 47.27],
            [11.42, 47.28],
            [11.43, 47.27],
            [11.4, 47.26],
          ],
        ],
        stats: { distance: 5000, duration: 1000 },
      },
    ]);
    render(<App />);
    fireEvent.click(screen.getByRole('radio', { name: 'Round trip' }));
    addCoordinate('47.26, 11.4');
    fireEvent.click(screen.getByRole('button', { name: 'Find round trips' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save route' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Manual drawing' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Switch to manual drawing?');
    fireEvent.click(screen.getByRole('button', { name: 'Switch mode' }));
    expect(JSON.parse(screen.getByTestId('map').getAttribute('data-geometry')!)[0]).toHaveLength(5);
    fireEvent.click(screen.getByRole('button', { name: 'Manual drawing' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Only your starting point will be kept');
    fireEvent.click(screen.getByRole('button', { name: 'Switch to round trip' }));
    expect(screen.getByRole('radio', { name: 'Round trip' })).toHaveAttribute('data-state', 'on');
    expect(screen.getByRole('button', { name: 'Manual drawing' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(provider.calculateRoute).not.toHaveBeenCalled();
    expect(provider.calculateAlternatives).toHaveBeenCalledTimes(1);
  });

  it.each(['en', 'ru'])('shows actual loop distances and signed deviations in %s', async (language) => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    const segments: Coordinate[][] = [
      [
        [11.4, 47.26],
        [11.42, 47.28],
        [11.4, 47.26],
      ],
    ];
    provider.calculateAlternatives.mockResolvedValueOnce([
      { segments, stats: { distance: 19000, duration: 1000 } },
      { segments, stats: { distance: 22000, duration: 1200 } },
    ]);
    render(<App />);
    fireEvent.click(screen.getByRole('radio', { name: i18n.t('Round trip') }));
    addCoordinate('47.26, 11.4');
    fireEvent.click(screen.getByRole('button', { name: i18n.t('Discover round trips') }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save route' })).toBeEnabled());
    await act(async () => {
      await i18n.changeLanguage(language);
    });
    const actual = await screen.findByText(
      i18n.t('Actual distance: {{distance}}', {
        distance: language === 'en' ? '19.0 km' : '19,0 км',
      }),
    );
    expect(actual.closest('button')).toHaveAttribute('aria-pressed', 'true');
    const deviations = document.querySelectorAll('.route-distance-delta');
    expect(deviations).toHaveLength(2);
    expect(deviations[0]).toHaveTextContent('-5');
    expect(deviations[1]).toHaveTextContent('+10');
    expect(
      screen.getByText(
        i18n.t(
          'Up to two distinct routes, closest to your target first. Search takes up to 45 seconds; actual distance depends on roads and trails.',
        ),
      ),
    ).toBeInTheDocument();
    await act(async () => {
      await i18n.changeLanguage('en');
    });
  });

  it('labels one or two stop actions and preserves the three-action layout', () => {
    render(<App />);
    const group = screen.getByRole('group', { name: 'Route stop actions' });
    const actions = within(group);
    expect(group).toHaveAttribute('data-action-count', '1');
    expect(actions.getByRole('button', { name: 'Add a stop' })).toHaveTextContent('Add a stop');

    addCoordinate('47.26, 11.4');
    expect(group).toHaveAttribute('data-action-count', '2');
    expect(actions.getByRole('button', { name: 'Clear stops' })).toHaveTextContent('Clear stops');
    expect(actions.getByRole('button', { name: 'Clear stops' })).toHaveAttribute('data-size', 'default');

    addCoordinate('47.27, 11.41');
    expect(group).toHaveAttribute('data-action-count', '3');
    for (const label of ['Reverse', 'Clear stops']) {
      const button = actions.getByRole('button', { name: label });
      expect(button.querySelector('span')).toBeNull();
      expect(button).toHaveAttribute('data-size', 'icon');
    }
  });

  it('labels the single clear action in round-trip mode and keeps its confirmation', () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    render(<App />);
    fireEvent.click(screen.getByRole('radio', { name: 'Round trip' }));
    const group = screen.getByRole('group', { name: 'Route stop actions' });
    expect(within(group).queryAllByRole('button')).toHaveLength(0);
    addCoordinate('47.26, 11.4');
    expect(group).toHaveAttribute('data-action-count', '1');
    const clear = within(group).getByRole('button', { name: 'Clear stops' });
    expect(clear).toHaveTextContent('Clear stops');
    fireEvent.click(clear);
    expect(screen.getByRole('dialog', { name: 'Clear all stops?' })).toBeInTheDocument();
  });

  it('allows 50 automatic stops, rejects the 51st and labels both remaining actions', async () => {
    render(<App />);
    addCoordinates(Array.from({ length: 26 }, (_, index) => `47.${2600 + index}, 11.4`));
    expect(screen.getByRole('button', { name: 'Add a stop' })).toBeInTheDocument();
    addCoordinates(Array.from({ length: 24 }, (_, index) => `47.${2626 + index}, 11.4`));
    addCoordinate('47.2651, 11.4');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      i18n.t('A route supports up to 50 stops. Remove a stop before adding another.'),
    );
    expect(
      within(screen.getByRole('list', { name: 'Route stops' })).getAllByRole('listitem'),
    ).toHaveLength(50);
    const actions = within(screen.getByRole('group', { name: 'Route stop actions' }));
    expect(actions.queryByRole('button', { name: 'Add a stop' })).not.toBeInTheDocument();
    expect(actions.getAllByRole('button')).toHaveLength(2);
    for (const label of ['Reverse', 'Clear stops']) {
      const button = actions.getByRole('button', { name: label });
      expect(button).toHaveAttribute('data-variant', 'outline');
      expect(button).toHaveTextContent(label);
      expect(button).toHaveAttribute('title', label);
      expect(button).toHaveAttribute('data-size', 'default');
    }
  }, 15_000);

  it('supports more than 50 manual points without silently dropping them in automatic mode', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Manual drawing' }));
    addCoordinates(Array.from({ length: 51 }, (_, index) => `47.${2600 + index}, 11.4`));
    fireEvent.click(screen.getByRole('button', { name: 'Manual drawing' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Automatic routing supports up to 50',
    );
    expect(screen.getByRole('button', { name: 'Manual drawing' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(JSON.parse(screen.getByTestId('map').getAttribute('data-geometry')!)[0]).toHaveLength(
      51,
    );
    expect(provider.calculateRoute).not.toHaveBeenCalled();
  }, 30_000);
  it('focuses form fields and safe actions, and restores focus after editing or deleting a route', async () => {
    render(<App />);
    await plan();
    const save = screen.getByRole('button', { name: 'Save route' });
    save.focus();
    fireEvent.click(save);
    expect(screen.getByRole('textbox', { name: 'Route name' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(save).toHaveFocus());
    fireEvent.click(save);
    fireEvent.change(screen.getByRole('textbox', { name: 'Route name' }), {
      target: { value: 'Focus trip' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save to library' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'My routes' }));
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Search saved routes' })).toHaveFocus(),
    );
    const edit = await screen.findByRole('button', { name: 'Edit Focus trip' });
    fireEvent.click(edit);
    expect(screen.getByRole('textbox', { name: 'Route name' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(edit).toHaveFocus();
    const remove = screen.getByRole('button', { name: 'Delete Focus trip' });
    fireEvent.click(remove);
    expect(screen.getByRole('button', { name: 'Keep route' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Keep route' }));
    expect(remove).toHaveFocus();
    fireEvent.click(remove);
    fireEvent.click(screen.getByRole('button', { name: 'Delete route' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Delete Focus trip' })).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Search saved routes' })).toHaveFocus(),
    );
  });
  it('switches to Russian persistently without recalculating routes or changing user names', async () => {
    const values = new Map<string, string>([[DISCLAIMER_KEY, 'acknowledged']]);
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    });
    render(<App />);
    await plan();
    fireEvent.click(screen.getByRole('button', { name: 'Save route' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Route name' }), {
      target: { value: 'River escape' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /Description/ }), {
      target: { value: 'My own note' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    selectLanguage('Русский');
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить маршрут' }));
    expect(document.documentElement.lang).toBe('ru');
    expect(localStorage.getItem(LANGUAGE_KEY)).toBe('ru');
    expect(detectLanguage()).toBe('ru');
    expect(screen.getByRole('textbox', { name: 'Название маршрута' })).toHaveValue('River escape');
    expect(screen.getByRole('textbox', { name: /Описание/ })).toHaveValue('My own note');
    expect(screen.getAllByText('1,3 км').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить в библиотеку' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByText(/Маршрут сохранён/)).toBeInTheDocument();
    expect(provider.calculateRoute).toHaveBeenCalledTimes(1);
    cleanup();
    render(<App />);
    openMenu();
    expect(screen.getByRole('menuitemradio', { name: 'Русский' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Мои маршруты' }));
    expect(
      await screen.findByRole('button', { name: /River escape Велосипед/ }),
    ).toBeInTheDocument();
    const saved = await routeDb.routes.toArray();
    expect(saved[0].name).toBe('River escape');
    expect(saved[0].description).toBe('My own note');
  });
  it('updates an already displayed error and confirmation when the language changes', async () => {
    render(<App />);
    addCoordinate('999, 20');
    expect(screen.getByRole('alert')).toHaveTextContent('Latitude must be between −90 and 90.');
    selectLanguage('Русский');
    expect(screen.getByRole('alert')).toHaveTextContent('Широта должна быть от −90 до 90.');
    selectLanguage('English');
    await plan();
    fireEvent.click(screen.getByRole('button', { name: 'New route' }));
    await act(async () => {
      await i18n.changeLanguage('ru');
    });
    expect(screen.getByRole('dialog', { name: 'Закрыть этот маршрут?' })).toHaveTextContent(
      'Несохранённые изменения',
    );
    expect(screen.getByRole('button', { name: 'Сбросить изменения' })).toBeInTheDocument();
  });
  it('translates an open clear-stops confirmation and its destructive action', async () => {
    render(<App />);
    await plan();
    fireEvent.click(screen.getByRole('button', { name: 'Clear stops' }));
    expect(screen.getByRole('dialog', { name: 'Clear all stops?' })).toBeInTheDocument();
    await act(async () => {
      await i18n.changeLanguage('ru');
    });
    const dialog = screen.getByRole('dialog', { name: 'Удалить все точки?' });
    expect(dialog).toHaveTextContent(
      'Все точки и рассчитанный маршрут будут удалены. Сохранённые маршруты не затрагиваются.',
    );
    expect(within(dialog).getByRole('button', { name: 'Удалить все точки' })).toBeInTheDocument();
  });

  it('accepts only coordinates and never offers address search', () => {
    render(<App />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Latitude' }), {
      target: { value: 'Minsk' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add coordinates' }));
    expect(screen.getByText('Enter a number, for example 47.26.')).toHaveAttribute('role', 'alert');
    expect(screen.getByText('Enter longitude.')).toHaveAttribute('role', 'alert');
    expect(screen.getByRole('textbox', { name: 'Latitude' })).toHaveFocus();
    expect(provider.calculateRoute).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /^Search$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Search results' })).not.toBeInTheDocument();
  });
  it('starts with an actionable empty overview instead of unavailable metrics', () => {
    render(<App />);
    expect(screen.getByRole('button', { name: 'Save route' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Calculate route' })).toBeDisabled();
    expect(screen.getByText('Where shall we go?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add a stop' })).toBeEnabled();
    expect(screen.getByText('Add two stops to see distance and time.')).toBeInTheDocument();
    expect(screen.queryByText('Unavailable')).not.toBeInTheDocument();
  });
  it('retries a failed calculation without duplicate requests or stale export', async () => {
    provider.calculateRoute.mockRejectedValueOnce(new Error('Connection failed'));
    render(<App />);
    addCoordinate('47.26, 11.4');
    addCoordinate('47.27, 11.41');
    await screen.findByText('Connection failed');
    fireEvent.click(screen.getByRole('button', { name: 'Calculate route' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Calculating route…' })).toBeDisabled(),
    );
    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save route' })).toBeEnabled());
    expect(provider.calculateRoute).toHaveBeenCalledTimes(2);
  });
  it('reorders stops with labeled buttons and retains undo/redo without drag grips', async () => {
    render(<App />);
    await plan();
    const stops = () =>
      within(screen.getByRole('list', { name: 'Route stops' })).getAllByRole('listitem');
    const items = stops();
    const originalOrder = items.map((item) => item.getAttribute('data-stop-id'));
    expect(items.every((item) => !item.querySelector('[draggable]'))).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Move stop 1 down' }));
    await waitFor(() => expect(provider.calculateRoute).toHaveBeenCalledTimes(2));
    expect(provider.calculateRoute.mock.calls[1][0][0].coordinate).toEqual([11.41, 47.27]);
    expect(screen.getByRole('button', { name: 'Move stop 1 down' })).toBeEnabled();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save route' })).toBeEnabled());
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(stops().map((item) => item.getAttribute('data-stop-id'))).toEqual(originalOrder);
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(stops()).toHaveLength(1);
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: true });
    expect(stops().map((item) => item.getAttribute('data-stop-id'))).toEqual(originalOrder);
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: true });
    expect(stops().map((item) => item.getAttribute('data-stop-id'))).toEqual(
      [...originalOrder].reverse(),
    );
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(provider.calculateRoute).toHaveBeenCalledTimes(2);
  });
  it('confirms destructive routing mode changes and preserves stops on cancel', async () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    render(<App />);
    await plan();
    fireEvent.click(screen.getByRole('radio', { name: 'Round trip' }));
    expect(screen.getByRole('dialog', { name: 'Switch to a round trip?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(
      within(screen.getByRole('list', { name: 'Route stops' })).getAllByRole('listitem'),
    ).toHaveLength(2);
    expect(screen.getByRole('radio', { name: 'Point to point' })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: 'Round trip' }));
    fireEvent.click(screen.getByRole('button', { name: 'Switch to round trip' }));
    expect(
      within(screen.getByRole('list', { name: 'Route stops' })).getAllByRole('listitem'),
    ).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled();
  });
  it('plans, saves, opens its library and reopens a persistent route', async () => {
    render(<App />);
    expect(screen.queryByRole('button', { name: 'View all route tags' })).not.toBeInTheDocument();
    await plan();
    expect((await screen.findAllByText('1.3 km')).length).toBeGreaterThan(0);
    expect(await screen.findByText('OpenRouteService')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save route' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Route name' }), {
      target: { value: 'River escape' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save to library' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const saved = (await routeDb.routes.toArray())[0];
    expect(saved.source).toBe('openrouteservice');
    expect(saved.segments).toEqual([geometry]);
    await routeDb.routes.update(saved.id, {
      tags: ['Scenic', 'Weekend', 'Forest', 'Water', 'Quiet'],
    });
    cleanup();
    render(<App />);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'My routes' }));
    const open = await screen.findByRole('button', { name: /River escape Cycling/ });
    fireEvent.click(open);
    expect(screen.getByRole('heading', { name: 'River escape' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export' })).toBeEnabled();
    const tags = screen.getByRole('button', { name: 'View all route tags' });
    expect(tags).toHaveTextContent('ScenicWeekendForest+2');
    fireEvent.click(tags);
    const details = screen.getByRole('dialog', { name: 'Route details' });
    expect(within(details).getByRole('list')).toHaveTextContent('ScenicWeekendForestWaterQuiet');
  });
  it('recalculates reversed/removed waypoints and uses the hiking profile', async () => {
    render(<App />);
    await plan();
    fireEvent.click(screen.getByRole('button', { name: 'Reverse' }));
    await waitFor(() => expect(provider.calculateRoute).toHaveBeenCalledTimes(2));
    expect(provider.calculateRoute.mock.calls[1][0][0].coordinate).toEqual([11.41, 47.27]);
    fireEvent.click(screen.getByRole('radio', { name: 'Hiking' }));
    await waitFor(() => expect(provider.calculateRoute).toHaveBeenCalledTimes(3));
    expect(provider.calculateRoute.mock.calls[2][1]).toBe('hiking');
    fireEvent.click(screen.getByRole('button', { name: 'Remove stop 2' }));
    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled();
  });
  it.each([
    ['en', 'Not saved', 'Unsaved changes'],
    ['ru', 'Не сохранено', 'Несохранённые изменения'],
  ])('shows a non-interactive unsaved badge until saving (%s)', async (language, label, tooltip) => {
    await i18n.changeLanguage('en');
    render(<App />);
    expect(screen.queryByText('Not saved')).not.toBeInTheDocument();
    await plan();
    await act(async () => { await i18n.changeLanguage(language); });
    const badge = screen.getByText(label);
    expect(badge).toHaveAttribute('data-slot', 'badge');
    expect(badge).toHaveAttribute('title', tooltip);
    expect(badge.closest('[role="status"]')).toHaveAttribute('aria-atomic', 'true');
    expect(badge).not.toHaveAttribute('tabindex');
    expect(badge.closest('button')).toBeNull();
    expect(badge.querySelector('.planner-unsaved-dot')).toHaveAttribute('aria-hidden', 'true');
    await act(async () => { await i18n.changeLanguage('en'); });
    fireEvent.click(screen.getByRole('button', { name: 'Save route' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Route name' }), {
      target: { value: 'Saved badge route' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save to library' }));
    await screen.findByText('Saved route');
    expect(screen.queryByText('Not saved')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Stops (minutes)'), { target: { value: '10' } });
    fireEvent.blur(screen.getByLabelText('Stops (minutes)'));
    expect(await screen.findByText('Not saved')).toBeInTheDocument();
  });
  it('never leaves stale geometry exportable on failed recalculation', async () => {
    render(<App />);
    await plan();
    provider.calculateRoute.mockRejectedValueOnce(new Error('Routing quota reached.'));
    addCoordinate('47.28, 11.42');
    const error = await screen.findByText(i18n.t('Routing quota reached.'));
    const toast = error.closest<HTMLElement>('[data-sonner-toast]')!;
    expect(toast).toHaveAttribute('data-type', 'error');
    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled();
    expect(screen.getByTestId('map')).toHaveAttribute('data-segments', '1');
    const status = document.querySelector('.planner-route-status')!;
    expect(status).toHaveAttribute('role', 'status');
    expect(status).not.toHaveTextContent('Routing quota reached.');
    expect(status.querySelector('[data-slot="badge"]')).toBeNull();
    expect(status.querySelector('button')).toBeNull();
    expect(screen.getAllByText(i18n.t('Routing quota reached.'))).toHaveLength(1);
    fireEvent.click(within(toast).getByRole('button', { name: 'Dismiss notification' }));
    expect(
      screen.getByText(
        'Previous route shown. Recalculate successfully before saving or exporting.',
      ),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled();
  });
  it('validates coordinate bounds without calling a service', () => {
    render(<App />);
    addCoordinate('999, 20');
    expect(screen.getByRole('alert')).toHaveTextContent('Latitude must be between −90 and 90.');
    expect(provider.calculateRoute).not.toHaveBeenCalled();
  });
  it('requires confirmation before discarding an unsaved route', async () => {
    render(<App />);
    await plan();
    fireEvent.click(screen.getByRole('button', { name: 'New route' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Unsaved changes');
    expect(screen.getByRole('dialog')).toHaveClass('compact');
    expect(screen.getByRole('button', { name: 'Discard changes' })).toHaveClass('danger');
    expect(screen.getByRole('button', { name: 'Discard changes' })).not.toHaveClass('primary');
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Export' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'New route' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled();
  });
  it('edits, duplicates and confirms deletion in the local library', async () => {
    render(<App />);
    await plan();
    fireEvent.click(screen.getByRole('button', { name: 'Save route' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Route name' }), {
      target: { value: 'Sunday' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save to library' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'My routes' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Sunday' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Route name' }), {
      target: { value: 'Monday' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Duplicate Monday' }));
    await waitFor(async () => expect(await routeDb.routes.count()).toBe(2));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Delete Monday' })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Delete Monday' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/cannot be undone/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete route' }));
    await waitFor(async () => expect(await routeDb.routes.count()).toBe(1));
  });
  it('keeps the editor mounted and inert behind the library screen, restores focus, and isolates history shortcuts', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Manual drawing' }));
    addCoordinate('47.26, 11.4');
    addCoordinate('47.27, 11.41');
    const map = screen.getByTestId('map'),
      geometryBefore = map.getAttribute('data-geometry');
    const navigation = screen.getByRole('navigation', { name: 'Main navigation' });
    expect(within(navigation).queryByRole('button', { name: 'My routes' })).not.toBeInTheDocument();
    const menuButton = within(navigation).getByRole('button', { name: 'Menu' });
    menuButton.focus();
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'My routes' }));
    await waitFor(() => expect(document.querySelector('.library-screen')).toBeInTheDocument());
    await waitFor(() => expect(screen.queryByTestId('global-map-loader')).not.toBeInTheDocument());
    expect(screen.getByRole('region', { name: 'Saved routes' })).toBeInTheDocument();
    expect(document.querySelector('.editor-screen')).toHaveAttribute('inert');
    expect(document.querySelector('.editor-screen')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByTestId('map')).toBe(map);
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(map).toHaveAttribute('data-geometry', geometryBefore!);
    fireEvent.click(await screen.findByRole('button', { name: 'Back to map' }));
    await waitFor(() => expect(menuButton).toHaveFocus());
    expect(document.querySelector('.editor-screen')).not.toHaveAttribute('inert');
    fireEvent.click(screen.getByRole('button', { name: 'Save route' }));
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(map).toHaveAttribute('data-geometry', geometryBefore!);
  });
  it('undoes and redoes ready geometry without issuing a third request and ignores native text undo', async () => {
    render(<App />);
    await plan();
    const original = screen.getByTestId('map').getAttribute('data-geometry');
    provider.calculateRoute.mockResolvedValueOnce({
      segments: [
        [
          [11.4, 47.26],
          [11.42, 47.28],
        ],
      ],
      stats: { distance: 2000, duration: 500 },
    });
    addCoordinate('47.28, 11.42');
    await waitFor(() => expect(provider.calculateRoute).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save route' })).toBeEnabled());
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(screen.getByTestId('map')).toHaveAttribute('data-geometry', original!);
    fireEvent.keyDown(window, { key: 'z', metaKey: true, shiftKey: true });
    expect(screen.getByTestId('map')).toHaveAttribute(
      'data-geometry',
      JSON.stringify([
        [
          [11.4, 47.26],
          [11.42, 47.28],
        ],
      ]),
    );
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Latitude' }), {
      key: 'z',
      ctrlKey: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(provider.calculateRoute).toHaveBeenCalledTimes(2);
  });
  it('stores and restores the unfinished editor and time parameters without routing', async () => {
    const { unmount } = render(<App />);
    await plan();
    fireEvent.change(screen.getByLabelText('Personal speed (km/h)'), { target: { value: '12' } });
    fireEvent.blur(screen.getByLabelText('Personal speed (km/h)'));
    fireEvent.change(screen.getByLabelText('Stops (minutes)'), { target: { value: '20' } });
    fireEvent.keyDown(screen.getByLabelText('Stops (minutes)'), { key: 'Enter' });
    await waitFor(async () => {
      const stored = await routeDb.table('drafts').get('current');
      expect(stored?.snapshot.speeds.cycling).toBe(12);
      expect(stored?.snapshot.stopsMinutes).toBe(20);
    });
    unmount();
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Restore draft' }));
    expect(screen.getByRole('button', { name: 'Save route' })).toBeEnabled();
    expect(screen.getByLabelText('Personal speed (km/h)')).toHaveValue('12');
    expect(screen.getByLabelText('Stops (minutes)')).toHaveValue('20');
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(provider.calculateRoute).toHaveBeenCalledTimes(1);
  });
  it('warns about corrupt drafts without blocking the planner and deletes only drafts', async () => {
    await routeDb.table('drafts').put({ id: 'current', version: 999 });
    render(<App />);
    expect(await screen.findByRole('alert')).toHaveTextContent('draft could not');
    expect(screen.getByRole('textbox', { name: 'Latitude' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete draft' }));
    await waitFor(async () => expect(await routeDb.table('drafts').count()).toBe(0));
    expect(await routeDb.routes.count()).toBe(0);
  });
  it('does not delete new edits made while a library save is awaiting completion', async () => {
    let finish!: () => void;
    const save = vi.spyOn(storage, 'saveRoute').mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    render(<App />);
    await plan();
    fireEvent.click(screen.getByRole('button', { name: 'Save route' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Route name' }), {
      target: { value: 'Saving' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save to library' }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    fireEvent.change(screen.getByLabelText('Latitude'), {
      target: { value: '47.28, 11.42' },
    });
    fireEvent.click(screen.getByLabelText('Add coordinates'));
    await act(async () => finish());
    expect(await screen.findByText('Not saved')).toHaveAttribute('title', 'Unsaved changes');
    await waitFor(async () =>
      expect((await routeDb.table('drafts').get('current'))?.snapshot.waypoints).toHaveLength(3),
    );
    expect(save.mock.calls[0][0].waypoints).toHaveLength(2);
  });
  it('keeps personal time changes separate from provider statistics and routing', async () => {
    render(<App />);
    await plan();
    const speed = screen.getByLabelText('Personal speed (km/h)');
    fireEvent.focus(speed);
    fireEvent.change(speed, { target: { value: '' } });
    fireEvent.keyDown(speed, { key: 'Enter' });
    expect(speed).toHaveValue('');
    expect(speed).toHaveAttribute('aria-invalid', 'true');
    await waitFor(async () =>
      expect((await routeDb.table('drafts').get('current'))?.snapshot.speeds.cycling).toBe(18),
    );
    fireEvent.change(speed, { target: { value: '6' } });
    fireEvent.blur(speed);
    fireEvent.change(screen.getByLabelText('Stops (minutes)'), { target: { value: '10' } });
    fireEvent.blur(screen.getByLabelText('Stops (minutes)'));
    expect(await screen.findByText('Total time with stops')).toBeInTheDocument();
    expect(screen.getByText('Provider estimate')).toBeInTheDocument();
    expect(provider.calculateRoute).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Save route' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Route name' }), {
      target: { value: 'Timed' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save to library' }));
    await waitFor(async () => expect(await routeDb.routes.count()).toBe(1));
    expect((await routeDb.routes.toArray())[0].stats.duration).toBe(480);
    await waitFor(async () => expect(await routeDb.table('drafts').count()).toBe(0));
  });
});

describe('map and routing improvements', () => {
  it('remembers a closed elevation profile across recalculation and history', async () => {
    await i18n.changeLanguage('en');
    provider.calculateRoute.mockResolvedValue({
      segments: [geometry],
      stats: { distance: 1342, duration: 480, ascent: 30, descent: 15 },
      elevationSource: 'openrouteservice',
    });
    render(<App />);
    await plan();
    fireEvent.click(screen.getByText('Elevation profile').closest('summary')!);
    expect(screen.getByText('Elevation profile').closest('details')).not.toHaveAttribute('open');
    expect(provider.calculateRoute).toHaveBeenCalledOnce();
    addCoordinate('47.28, 11.42');
    await waitFor(() => expect(provider.calculateRoute).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save route' })).toBeEnabled());
    expect(screen.getByText('Elevation profile').closest('details')).not.toHaveAttribute('open');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByText('Elevation profile').closest('details')).not.toHaveAttribute('open');
  });
  it('links map selection to the stop card without entering replacement mode', async () => {
    await i18n.changeLanguage('en');
    render(<App />);
    await plan();
    fireEvent.click(screen.getByRole('button', { name: 'Select first map point' }));
    const start = screen.getByRole('button', { name: /^Start 47/ });
    expect(start).toHaveAttribute('aria-pressed', 'true');
    expect(start.closest('li')).toHaveClass('selected-stop');
    expect(
      screen.queryByRole('button', { name: 'Replace stop coordinates' }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Finish 47/ }));
    expect(screen.getByRole('button', { name: /^Finish 47/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Replace first map point' }));
    expect(screen.getByRole('textbox', { name: 'Latitude' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Replace stop coordinates' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Latitude' })).toHaveValue('47.26');
    expect(screen.getByRole('textbox', { name: 'Longitude' })).toHaveValue('11.4');
  });

  it('keeps previous geometry visible but unusable until the newest calculation succeeds', async () => {
    await i18n.changeLanguage('en');
    render(<App />);
    await plan();
    const previous = screen.getByTestId('map').getAttribute('data-geometry');
    let resolve!: (value: {
      segments: number[][][];
      stats: { distance: number; duration: number };
    }) => void;
    provider.calculateRoute.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    addCoordinate('47.28, 11.42');
    expect(screen.getByTestId('map')).toHaveAttribute('data-geometry', previous);
    expect(screen.getByTestId('map')).toHaveAttribute('data-stale', 'true');
    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled();
    await waitFor(() => expect(provider.calculateRoute).toHaveBeenCalledTimes(2));
    await act(async () =>
      resolve({ segments: [geometry], stats: { distance: 1500, duration: 500 } }),
    );
    expect(screen.getByTestId('map')).toHaveAttribute('data-stale', 'false');
    expect(screen.getByRole('button', { name: 'Save route' })).toBeEnabled();
  });

  it('requests cycling preferences and offers point alternatives only for two automatic stops', async () => {
    await i18n.changeLanguage('en');
    render(<App />);
    await plan();
    choosePlannerOption('Cycling route profile', 'Road cycling');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Avoid ferries' }));
    await waitFor(() => expect(provider.calculateRoute).toHaveBeenCalledTimes(2));
    expect(provider.calculateRoute.mock.calls[1][3]).toMatchObject({
      cyclingProfile: 'cycling-road',
      avoidFerries: true,
    });
    provider.calculatePointAlternatives.mockResolvedValueOnce([
      { segments: [geometry], stats: { distance: 1000, duration: 300 } },
      {
        segments: [
          [
            [11.4, 47.26],
            [11.42, 47.27],
            [11.41, 47.27],
          ],
        ],
        stats: { distance: 1300, duration: 400 },
      },
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Find alternatives' }));
    await waitFor(() => expect(provider.calculatePointAlternatives).toHaveBeenCalledOnce());
    expect(screen.getByRole('button', { name: /Option 1/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: /Option 2/ }));
    expect(screen.getByRole('button', { name: /Option 2/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getAllByRole('button', { name: /^(Start|Finish) 47/ })).toHaveLength(2);
    addCoordinate('47.28, 11.42');
    expect(screen.getByRole('button', { name: 'Find alternatives' })).toBeDisabled();
  });

  it('preserves direct section meaning when reversing stops and undoing', async () => {
    await i18n.changeLanguage('en');
    render(<App />);
    await plan();
    addCoordinate('47.28, 11.42');
    await waitFor(() => expect(provider.calculateRoute).toHaveBeenCalledTimes(2));
    choosePlannerOption('Section 2 mode', 'Direct line — unverified');
    await waitFor(() => expect(provider.calculateRoute).toHaveBeenCalledTimes(3));
    fireEvent.click(screen.getByRole('button', { name: 'Reverse' }));
    expect(screen.getByRole('button', { name: 'Section 1 mode' })).toHaveTextContent(
      'Direct line — unverified',
    );
    expect(screen.getByRole('button', { name: 'Section 2 mode' })).toHaveTextContent(
      'Road/path routing',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByRole('button', { name: 'Section 2 mode' })).toHaveTextContent(
      'Direct line — unverified',
    );
  });
});
