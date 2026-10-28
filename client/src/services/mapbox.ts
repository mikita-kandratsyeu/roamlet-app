export function publicMapboxToken(): string {
  const token = String(import.meta.env.VITE_MAPBOX_ACCESS_TOKEN ?? '').trim();
  if (!token.startsWith('pk.'))
    throw new Error(
      'Configure a public Mapbox token in VITE_MAPBOX_ACCESS_TOKEN. GPX and saved routes remain available.',
    );
  return token;
}

export function mapboxUrl(path: string): URL {
  if (!/^\/directions\/v5\/mapbox\/(?:cycling|walking)\/[0-9eE+.,;-]+(?:\?[^#]*)?$/.test(path))
    throw new Error('Unsupported Mapbox endpoint.');
  const url = new URL(path, 'https://api.mapbox.com');
  url.searchParams.set('access_token', publicMapboxToken());
  return url;
}
