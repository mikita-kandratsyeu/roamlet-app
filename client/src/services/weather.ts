import type { Coordinate } from '../domain/types';
import { validForecast, type WeatherForecast } from '../domain/weather';

const fields = {
  temperature: 'temperature_2m',
  apparent: 'apparent_temperature',
  precipitation: 'precipitation',
  probability: 'precipitation_probability',
  wind: 'wind_speed_10m',
  direction: 'wind_direction_10m',
  gusts: 'wind_gusts_10m',
} as const;
export async function requestWeather(
  coordinate: Coordinate,
  signal: AbortSignal,
): Promise<WeatherForecast> {
  if (
    !coordinate.slice(0, 2).every(Number.isFinite) ||
    Math.abs(coordinate[0]) > 180 ||
    Math.abs(coordinate[1]) > 90
  )
    throw new Error('Invalid weather location.');
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (signal.aborted) cancel();
  signal.addEventListener('abort', cancel, { once: true });
  const timeout = setTimeout(cancel, 10_000);
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.search = new URLSearchParams({
    longitude: String(coordinate[0]),
    latitude: String(coordinate[1]),
    hourly: Object.values(fields).join(','),
    timezone: 'auto',
    forecast_days: '16',
    temperature_unit: 'celsius',
    wind_speed_unit: 'kmh',
    precipitation_unit: 'mm',
  }).toString();
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
    });
    if (!response.ok) throw new Error('Weather service unavailable.');
    const data: unknown = await response.json();
    if (controller.signal.aborted) throw new DOMException('Request cancelled', 'AbortError');
    if (
      !data ||
      typeof data !== 'object' ||
      !('timezone' in data) ||
      !('hourly' in data) ||
      !data.hourly ||
      typeof data.hourly !== 'object' ||
      !('hourly_units' in data) ||
      !data.hourly_units ||
      typeof data.hourly_units !== 'object'
    )
      throw new Error('Invalid weather response.');
    const hourly: Record<string, unknown> = { ...data.hourly };
    const units: Record<string, unknown> = { ...data.hourly_units };
    const expectedUnits = {
      temperature: '°C',
      apparent: '°C',
      precipitation: 'mm',
      probability: '%',
      wind: 'km/h',
      direction: '°',
      gusts: 'km/h',
    };
    const times = hourly.time;
    if (!Array.isArray(times) || times.length < 1 || times.length > 400)
      throw new Error('Invalid weather response.');
    for (const [field, remote] of Object.entries(fields)) {
      const values = hourly[remote];
      if (
        !Array.isArray(values) ||
        values.length !== times.length ||
        units[remote] !== expectedUnits[field as keyof typeof fields]
      )
        throw new Error('Invalid weather response.');
    }
    const forecast: unknown = {
      timezone: data.timezone,
      fetchedAt: Date.now(),
      hours: times.map((time, index) => ({
        time,
        ...Object.fromEntries(
          Object.entries(fields).map(([field, remote]) => {
            const values = hourly[remote];
            return [field, Array.isArray(values) ? values[index] : undefined];
          }),
        ),
      })),
    };
    if (!validForecast(forecast)) throw new Error('Invalid weather response.');
    return forecast;
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', cancel);
  }
}
