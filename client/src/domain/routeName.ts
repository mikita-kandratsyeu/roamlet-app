const ROUTE_NAME_SUGGESTIONS = [
  'Beyond the familiar',
  'Where the trail leads',
  'A little farther',
  'Chasing the horizon',
  'Through quiet places',
  'The scenic way around',
  'Under open skies',
  'A road of our own',
  'Past the next hill',
  'The long way home',
  'Into the green',
  'A day outside',
] as const;

export function routeNameSuggestionKey(
  randomValue = Math.random(),
): (typeof ROUTE_NAME_SUGGESTIONS)[number] {
  const index = Number.isFinite(randomValue)
    ? Math.max(
        0,
        Math.min(
          ROUTE_NAME_SUGGESTIONS.length - 1,
          Math.floor(randomValue * ROUTE_NAME_SUGGESTIONS.length),
        ),
      )
    : 0;
  return ROUTE_NAME_SUGGESTIONS[index];
}
