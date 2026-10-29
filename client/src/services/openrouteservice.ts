export function openRouteServiceApiKey(): string {
  const key = String(import.meta.env.VITE_ORS_API_KEY ?? '').trim();
  if (!key)
    throw new Error(
      'Configure an OpenRouteService API key in VITE_ORS_API_KEY. GPX and saved routes remain available.',
    );
  return key;
}

export function openRouteServiceUrl(path: string): URL {
  if (
    !/^\/openrouteservice\/v2\/directions\/(?:cycling-regular|cycling-road|cycling-mountain|foot-hiking)\/geojson$/.test(
      path,
    )
  )
    throw new Error('Unsupported OpenRouteService endpoint.');
  return new URL(path, 'https://api.heigit.org');
}
