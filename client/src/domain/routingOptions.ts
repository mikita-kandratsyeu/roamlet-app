import type { Activity, CyclingProfile, RoutingOptions } from './types';

export const CYCLING_PROFILES: CyclingProfile[] = [
  'cycling-regular',
  'cycling-road',
  'cycling-mountain',
  'cycling-gravel',
];
export const DEFAULT_ROUTING_OPTIONS: Required<RoutingOptions> = {
  cyclingProfile: 'cycling-regular',
  avoidFerries: false,
  avoidSteps: false,
};
export function validRoutingOptions(value: unknown): value is RoutingOptions {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const options = value as RoutingOptions;
  return (
    (options.cyclingProfile === undefined || CYCLING_PROFILES.includes(options.cyclingProfile)) &&
    (options.avoidFerries === undefined || typeof options.avoidFerries === 'boolean') &&
    (options.avoidSteps === undefined || typeof options.avoidSteps === 'boolean')
  );
}
export function normalizeRoutingOptions(options: RoutingOptions = {}): Required<RoutingOptions> {
  if (!validRoutingOptions(options)) throw new Error('Invalid routing options.');
  return {
    cyclingProfile: options.cyclingProfile ?? DEFAULT_ROUTING_OPTIONS.cyclingProfile,
    avoidFerries: options.avoidFerries ?? false,
    avoidSteps: options.avoidSteps ?? false,
  };
}
export function routingProfile(activity: Activity, options: RoutingOptions = {}): string {
  const normalized = normalizeRoutingOptions(options);
  if (activity === 'hiking') return 'foot-hiking';
  if (activity === 'cycling') {
    // ORS has no gravel profile, so this UI choice uses its mountain-biking profile.
    return normalized.cyclingProfile === 'cycling-gravel'
      ? 'cycling-mountain'
      : normalized.cyclingProfile;
  }
  throw new Error('Invalid route activity.');
}
/** These standard ORS avoid_features are supported by both cycling and foot profiles. */
export function orsRoutingOptions(
  options: RoutingOptions = {},
): { avoid_features: string[] } | undefined {
  const normalized = normalizeRoutingOptions(options);
  const avoid_features = [
    ...(normalized.avoidFerries ? ['ferries'] : []),
    ...(normalized.avoidSteps ? ['steps'] : []),
  ];
  return avoid_features.length ? { avoid_features } : undefined;
}
