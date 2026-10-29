export type CoordinateField = 'latitude' | 'longitude';

const decimal = /^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/;
const normalize = (value: string) => value.trim().replace(/−/g, '-');

export function coordinateValue(value: string): number | null {
  const text = normalize(value);
  if (!decimal.test(text)) return null;
  const number = Number(text.replace(',', '.'));
  return Number.isFinite(number) ? number : null;
}

export function coordinateError(value: string, field: CoordinateField): string | null {
  if (!value.trim()) return field === 'latitude' ? 'Enter latitude.' : 'Enter longitude.';
  const number = coordinateValue(value);
  if (number === null) return 'Enter a number, for example 47.26.';
  if (Math.abs(number) > (field === 'latitude' ? 90 : 180)) {
    return field === 'latitude'
      ? 'Latitude must be between −90 and 90.'
      : 'Longitude must be between −180 and 180.';
  }
  return null;
}

export function coordinatePair(value: string): [string, string] | null {
  const text = normalize(value);
  // A lone decimal-comma number belongs to one field, not two integer coordinates.
  if (decimal.test(text)) return null;
  const number = '[+-]?(?:\\d+(?:[.,]\\d+)?|[.,]\\d+)';
  const match = text.match(new RegExp(`^(${number})(?:\\s*;\\s*|\\s+|\\s*,\\s*)(${number})$`));
  return match ? [match[1], match[2]] : null;
}
