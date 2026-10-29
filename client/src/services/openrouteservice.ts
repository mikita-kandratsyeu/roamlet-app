export function openRouteServiceProfile(path: string): string {
  const match =
    /^\/openrouteservice\/v2\/directions\/(cycling-regular|cycling-road|cycling-mountain|foot-hiking)\/geojson$/.exec(
      path,
    );
  if (!match) throw new Error('Unsupported OpenRouteService endpoint.');
  return match[1];
}
