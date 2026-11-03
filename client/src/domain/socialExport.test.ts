import { expect, it } from 'vitest';
import { buildSocialCaption, DEFAULT_SOCIAL_EXPORT, validSocialExport } from './socialExport';
import { getRouteCardDimensions } from './routeCardLayout';

it('provides matching editor dimensions for all social formats', () => {
  expect(getRouteCardDimensions('post')).toEqual({ width: 1080, height: 1350 });
  expect(getRouteCardDimensions('story')).toEqual({ width: 1080, height: 1920 });
  expect(getRouteCardDimensions('square')).toEqual({ width: 1080, height: 1080 });
});

it('builds a planned-route caption with only selected metrics', () => {
  expect(
    buildSocialCaption({
      title: 'Forest walk',
      plannedLabel: 'Planned route',
      activityLabel: 'Hiking',
      metrics: [
        { label: 'Distance', value: '12.4 km' },
        { label: 'Original time estimate', value: '10 min' },
      ],
    }),
  ).toBe('Forest walk\nPlanned route · Hiking\nDistance: 12.4 km\nOriginal time estimate: 10 min');
  expect(
    buildSocialCaption({
      title: 'Поход',
      plannedLabel: 'План маршрута',
      activityLabel: 'Пеший поход',
      metrics: [],
    }),
  ).toBe('Поход\nПлан маршрута · Пеший поход');
});
it.each([
  null,
  {},
  { ...DEFAULT_SOCIAL_EXPORT, template: 'unknown' },
  { ...DEFAULT_SOCIAL_EXPORT, privacyRadius: NaN },
  { ...DEFAULT_SOCIAL_EXPORT, privacyRadius: 10001 },
  { ...DEFAULT_SOCIAL_EXPORT, privacyRadius: 0.5 },
  { ...DEFAULT_SOCIAL_EXPORT, duration: 'true' },
  { ...DEFAULT_SOCIAL_EXPORT, format: ['square'] },
])('rejects invalid persisted social settings: %j', (value) => {
  expect(validSocialExport(value)).toBe(false);
});
it('accepts all formats, templates and colors', () => {
  for (const format of ['post', 'story', 'square'])
    for (const template of ['minimal', 'adventure', 'elevation'])
      for (const accent of ['green', 'blue', 'orange'])
        expect(validSocialExport({ ...DEFAULT_SOCIAL_EXPORT, format, template, accent })).toBe(
          true,
        );
});
