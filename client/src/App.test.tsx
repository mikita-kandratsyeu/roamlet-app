import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, cleanup, within } from '@testing-library/react';
import App from './App';
import { routeDb } from './domain/storage';
import { checkRoutingConfiguration } from './services/routing';
import { detectLanguage, LANGUAGE_KEY } from './i18n';
const provider = vi.hoisted(() => ({ calculateRoute: vi.fn(), calculateAlternatives: vi.fn() }));
vi.mock('./services/routing', () => ({ checkRoutingConfiguration: vi.fn().mockResolvedValue(true), routingProvider: provider, searchPlaces: vi.fn().mockResolvedValue([]) }));
vi.mock('./components/RouteMap', () => ({ RouteMap: ({ segments }: { segments: unknown[] }) => <div data-testid="map" data-segments={segments.length}>Map</div> }));
const geometry = [[11.4, 47.26, 600], [11.405, 47.265, 630], [11.41, 47.27, 615]];
beforeEach(async () => {
  cleanup(); await routeDb.routes.clear(); vi.clearAllMocks();
  vi.mocked(checkRoutingConfiguration).mockResolvedValue(true);
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  provider.calculateRoute.mockResolvedValue({ segments: [geometry], stats: { distance: 1342, duration: 480, ascent: 30, descent: 15 } });
});
function addCoordinate(text: string) {
  fireEvent.change(screen.getByRole('textbox', { name: 'Search places or coordinates' }), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
}
async function plan() { addCoordinate('47.26, 11.4'); addCoordinate('47.27, 11.41'); await waitFor(() => expect(screen.getByRole('button', { name: 'Save route' })).toBeEnabled()); }
describe('route planner interactions', () => {
  it('switches to Russian persistently without recalculating routes or changing user names', async () => {
    render(<App />); await plan();
    fireEvent.click(screen.getByRole('button', { name: 'Save route' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Route name' }), { target: { value: 'River escape' } });
    fireEvent.change(screen.getByRole('textbox', { name: /Description/ }), { target: { value: 'My own note' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Language' }), { target: { value: 'ru' } });
    expect(document.documentElement.lang).toBe('ru');
    expect(localStorage.getItem(LANGUAGE_KEY)).toBe('ru');
    expect(detectLanguage()).toBe('ru');
    expect(screen.getByRole('textbox', { name: 'Название маршрута' })).toHaveValue('River escape');
    expect(screen.getByRole('textbox', { name: /Описание/ })).toHaveValue('My own note');
    expect(screen.getAllByText('1,3 км').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить в библиотеку' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('status')).toHaveTextContent('Маршрут сохранён');
    expect(provider.calculateRoute).toHaveBeenCalledTimes(1);
    cleanup(); render(<App />);
    expect(screen.getByRole('combobox', { name: 'Язык' })).toHaveValue('ru');
    fireEvent.click(screen.getByRole('button', { name: 'Мои маршруты' }));
    expect(await screen.findByRole('button', { name: /River escape Велосипед/ })).toBeInTheDocument();
    const saved = await routeDb.routes.toArray();
    expect(saved[0].name).toBe('River escape');
    expect(saved[0].description).toBe('My own note');
  });
  it('updates an already displayed error and confirmation when the language changes', async () => {
    render(<App />); addCoordinate('999, 20');
    expect(screen.getByRole('alert')).toHaveTextContent('latitude');
    fireEvent.change(screen.getByRole('combobox', { name: 'Language' }), { target: { value: 'ru' } });
    expect(screen.getByRole('alert')).toHaveTextContent('широту');
    fireEvent.change(screen.getByRole('combobox', { name: 'Язык' }), { target: { value: 'en' } });
    await plan();
    fireEvent.click(screen.getByRole('button', { name: 'New route' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Language' }), { target: { value: 'ru' } });
    expect(screen.getByRole('dialog', { name: 'Покинуть этот маршрут?' })).toHaveTextContent('Несохранённые изменения');
    expect(screen.getByRole('button', { name: 'Отбросить изменения' })).toBeInTheDocument();
  });
  it('starts with honest empty statistics and disabled save/export', () => {
    render(<App />); expect(screen.getByRole('button', { name: 'Save route' })).toBeDisabled(); expect(screen.getByRole('button', { name: 'Export GPX' })).toBeDisabled();
    expect(screen.getByText('A good route starts somewhere')).toBeInTheDocument();
  });
  it('plans, saves, opens its library and reopens a persistent route', async () => {
    render(<App />); await plan(); expect(screen.getAllByText('1.3 km').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Save route' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Route name' }), { target: { value: 'River escape' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save to library' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    cleanup(); render(<App />); fireEvent.click(screen.getByRole('button', { name: 'My routes' }));
    const open = await screen.findByRole('button', { name: /River escape Cycling/ }); fireEvent.click(open);
    expect(screen.getByRole('heading', { name: 'River escape' })).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Export GPX' })).toBeEnabled();
  });
  it('recalculates reversed/removed waypoints and uses the hiking profile', async () => {
    render(<App />); await plan(); fireEvent.click(screen.getByRole('button', { name: 'Reverse' }));
    await waitFor(() => expect(provider.calculateRoute).toHaveBeenCalledTimes(2));
    expect(provider.calculateRoute.mock.calls[1][0][0].coordinate).toEqual([11.41, 47.27]);
    fireEvent.click(screen.getByRole('button', { name: 'Hiking' }));
    await waitFor(() => expect(provider.calculateRoute).toHaveBeenCalledTimes(3)); expect(provider.calculateRoute.mock.calls[2][1]).toBe('hiking');
    fireEvent.click(screen.getByRole('button', { name: 'Remove stop 2' })); expect(screen.getByRole('button', { name: 'Export GPX' })).toBeDisabled();
  });
  it('never leaves stale geometry exportable on failed recalculation', async () => {
    render(<App />); await plan(); provider.calculateRoute.mockRejectedValueOnce(new Error('Routing quota reached.'));
    addCoordinate('47.28, 11.42'); await screen.findByRole('alert'); expect(screen.getByRole('button', { name: 'Export GPX' })).toBeDisabled(); expect(screen.getByTestId('map')).toHaveAttribute('data-segments', '0');
  });
  it('validates coordinate bounds without calling a service', () => {
    render(<App />); addCoordinate('999, 20'); expect(screen.getByRole('alert')).toHaveTextContent('latitude'); expect(provider.calculateRoute).not.toHaveBeenCalled();
  });
  it('requires confirmation before discarding an unsaved route', async () => {
    render(<App />); await plan(); fireEvent.click(screen.getByRole('button', { name: 'New route' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('unsaved changes'); fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); expect(screen.getByRole('button', { name: 'Export GPX' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'New route' })); fireEvent.click(screen.getByRole('button', { name: 'Discard changes' })); expect(screen.getByRole('button', { name: 'Export GPX' })).toBeDisabled();
  });
  it('edits, duplicates and confirms deletion in the local library', async () => {
    render(<App />); await plan(); fireEvent.click(screen.getByRole('button', { name: 'Save route' })); fireEvent.change(screen.getByRole('textbox', { name: 'Route name' }), { target: { value: 'Sunday' } }); fireEvent.click(screen.getByRole('button', { name: 'Save to library' })); await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'My routes' })); fireEvent.click(await screen.findByRole('button', { name: 'Edit Sunday' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Route name' }), { target: { value: 'Monday' } }); fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Duplicate Monday' })); await waitFor(async () => expect(await routeDb.routes.count()).toBe(2));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Delete Monday' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Delete Monday' })); const dialog = screen.getByRole('dialog'); expect(within(dialog).getByText(/cannot be undone/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete route' })); await waitFor(async () => expect(await routeDb.routes.count()).toBe(1));
  });
});
