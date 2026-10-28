import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { approximateMapView, initialMapView, MAP_VIEW_KEY, saveMapView, validMapView, type MapView } from './mapView';
const stored: MapView = { center: [11.4041, 47.2692], zoom: 13.5, bearing: 15, pitch: 30 };
const mockStorage = () => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    clear: () => values.clear(),
  });
};
beforeEach(() => mockStorage());
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('approximate initial region', () => {
  it('prefers a recognized timezone over unrelated browser language', () => {
    expect(approximateMapView('Europe/Minsk', ['en-US']).center).toEqual([28, 53.5]);
    expect(approximateMapView('Asia/Tokyo', ['de-DE']).center).toEqual([138, 37]);
  });
  it('uses a broad continent rather than pretending to locate an unknown city', () => {
    expect(approximateMapView('Europe/Prague', ['en-US']).zoom).toBe(3);
    expect(approximateMapView('Asia/Unknown', ['en-US']).center).toEqual([90, 30]);
  });
  it('uses locale region when timezone provides no geographic signal', () => {
    expect(approximateMapView('UTC', ['en-GB']).center).toEqual([-3, 54]);
    expect(approximateMapView('Etc/GMT+5', ['en-AU']).center).toEqual([134, -26]);
  });
  it('accepts a narrow language fallback but does not infer US from generic English', () => {
    expect(approximateMapView('', ['be']).center).toEqual([28, 53.5]);
    expect(approximateMapView('UTC', ['en']).center).toEqual([10, 20]);
  });
  it('handles malformed locales and unknown zones without throwing', () => {
    expect(approximateMapView('__proto__', ['!broken!', 'en-GB']).center).toEqual([-3, 54]);
    expect(validMapView(approximateMapView('', []))).toBe(true);
  });
});
describe('last local view', () => {
  it('restores exact center, zoom, bearing and pitch before browser heuristics', () => {
    expect(saveMapView(stored)).toBe(true);
    expect(initialMapView()).toEqual(stored);
  });
  it.each(['broken json', '{"center":[999,0],"zoom":3,"bearing":0,"pitch":0}', '{"center":[0,0],"zoom":99,"bearing":0,"pitch":0}', 'null'])('ignores corrupt stored view %s', data => {
    localStorage.setItem(MAP_VIEW_KEY, data);
    expect(validMapView(initialMapView())).toBe(true);
  });
  it('survives blocked storage reading and writing', () => {
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw new DOMException('Blocked'); });
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new DOMException('Quota exceeded'); });
    expect(validMapView(initialMapView())).toBe(true);
    expect(saveMapView(stored)).toBe(false);
  });
  it('rejects incomplete views, invalid bounds and nonnumeric coordinates', () => {
    expect(validMapView({ center: ['11', 47], zoom: 4, bearing: 0, pitch: 0 })).toBe(false);
    expect(validMapView({ ...stored, center: [0, 90] })).toBe(false);
    expect(validMapView({ ...stored, pitch: -1 })).toBe(false);
    expect(validMapView({ ...stored, bearing: Infinity })).toBe(false);
    expect(validMapView({ center: [0, 0], zoom: 3 })).toBe(false);
    expect(saveMapView({ ...stored, zoom: NaN })).toBe(false);
  });
});
