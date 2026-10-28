import { describe, expect, it } from 'vitest';
import { DEFAULT_MAPBOX_STYLE, mapTiles } from './mapTiles';

const accessToken = 'pk.test-only-not-a-real-token';

describe('Mapbox map configuration', () => {
  it('uses the outdoors style by default with a public token', () => {
    expect(mapTiles({ VITE_MAPBOX_ACCESS_TOKEN: accessToken })).toEqual({
      accessToken,
      style: DEFAULT_MAPBOX_STYLE,
    });
    expect(DEFAULT_MAPBOX_STYLE).toBe('mapbox://styles/mapbox/outdoors-v12');
  });
  it('trims configured values and preserves the selected style', () => {
    expect(
      mapTiles({
        VITE_MAPBOX_ACCESS_TOKEN: ` ${accessToken} `,
        VITE_MAPBOX_STYLE: ' mapbox://styles/example/custom-style ',
      }),
    ).toEqual({ accessToken, style: 'mapbox://styles/example/custom-style' });
    expect(mapTiles({ VITE_MAPBOX_ACCESS_TOKEN: accessToken, VITE_MAPBOX_STYLE: ' ' }).style).toBe(
      DEFAULT_MAPBOX_STYLE,
    );
  });
  it('requires a token even for a configured local style', () => {
    expect(() => mapTiles({})).toThrow('VITE_MAPBOX_ACCESS_TOKEN');
    expect(() =>
      mapTiles({ VITE_MAPBOX_ACCESS_TOKEN: ' ', VITE_MAPBOX_STYLE: '/style.json' }),
    ).toThrow('Saved routes and GPX import/export remain available');
  });
  it('rejects secret tokens without including the token in the error', () => {
    const token = 'sk.test-only-not-a-real-token';
    expect(() => mapTiles({ VITE_MAPBOX_ACCESS_TOKEN: token })).toThrow('public Mapbox token');
    try {
      mapTiles({ VITE_MAPBOX_ACCESS_TOKEN: token });
    } catch (error) {
      expect(String(error)).not.toContain(token);
    }
  });
});
