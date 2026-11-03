import type {
  RouteCardAccent,
  RouteCardFormat,
  RouteCardRequest,
  RouteCardTemplate,
  RouteCardTheme,
} from './routeCard';

export interface SocialExportPreferences {
  format: RouteCardFormat;
  theme: RouteCardTheme;
  template: RouteCardTemplate;
  accent: RouteCardAccent;
  privacyRadius: number;
  distance: boolean;
  duration: boolean;
  elevation: boolean;
}
export const DEFAULT_SOCIAL_EXPORT: SocialExportPreferences = {
  format: 'post',
  theme: 'light',
  template: 'adventure',
  accent: 'green',
  privacyRadius: 0,
  distance: true,
  duration: false,
  elevation: true,
};
export function validSocialExport(value: unknown): value is SocialExportPreferences {
  if (!value || typeof value !== 'object') return false;
  return (
    'format' in value &&
    typeof value.format === 'string' &&
    ['post', 'story', 'square'].includes(value.format) &&
    'theme' in value &&
    typeof value.theme === 'string' &&
    ['light', 'dark'].includes(value.theme) &&
    'template' in value &&
    typeof value.template === 'string' &&
    ['minimal', 'adventure', 'elevation'].includes(value.template) &&
    'accent' in value &&
    typeof value.accent === 'string' &&
    ['green', 'blue', 'orange'].includes(value.accent) &&
    'privacyRadius' in value &&
    typeof value.privacyRadius === 'number' &&
    Number.isInteger(value.privacyRadius) &&
    value.privacyRadius >= 0 &&
    value.privacyRadius <= 10000 &&
    'distance' in value &&
    typeof value.distance === 'boolean' &&
    'duration' in value &&
    typeof value.duration === 'boolean' &&
    'elevation' in value &&
    typeof value.elevation === 'boolean'
  );
}

export function buildSocialCaption(
  request: Pick<RouteCardRequest, 'title' | 'activityLabel' | 'plannedLabel' | 'metrics'>,
): string {
  return [
    request.title,
    `${request.plannedLabel} · ${request.activityLabel}`,
    ...request.metrics.map(({ label, value }) => `${label}: ${value}`),
  ].join('\n');
}
