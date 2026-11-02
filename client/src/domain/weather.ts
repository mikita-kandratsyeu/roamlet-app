import { validDepartureLocal } from './schedule';
import type { Coordinate } from './types';

export interface WeatherHour {
  time: string;
  temperature: number | null;
  apparent: number | null;
  precipitation: number | null;
  probability: number | null;
  wind: number | null;
  direction: number | null;
  gusts: number | null;
}
export interface WeatherForecast {
  timezone: string;
  hours: WeatherHour[];
  fetchedAt: number;
}
export const WEATHER_CACHE_KEY = 'roamlet:weather:v1';
export const WEATHER_FRESH_MS = 30 * 60 * 1000;
const MAX_CACHE_AGE_MS = 24 * 60 * 60 * 1000;

export function weatherLocationKey(coordinate: Coordinate): string {
  return JSON.stringify(coordinate.slice(0, 2));
}
export function weatherHours(forecast: WeatherForecast, departure: string): WeatherHour[] {
  if (!validDepartureLocal(departure)) return [];
  // Provider timestamps are wall clocks in the start location, never the device timezone.
  const hour = `${departure.slice(0, 13)}:00`;
  const index = forecast.hours.findIndex((entry) => entry.time === hour);
  return index < 0 ? [] : forecast.hours.slice(index, index + 6);
}
export function validForecast(value: unknown): value is WeatherForecast {
  if (
    !value ||
    typeof value !== 'object' ||
    !('timezone' in value) ||
    typeof value.timezone !== 'string' ||
    !('fetchedAt' in value) ||
    typeof value.fetchedAt !== 'number' ||
    !Number.isFinite(value.fetchedAt) ||
    !('hours' in value) ||
    !Array.isArray(value.hours) ||
    value.hours.length < 1 ||
    value.hours.length > 400
  )
    return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value.timezone });
  } catch {
    return false;
  }
  let previous = '';
  for (const hour of value.hours) {
    if (
      !hour ||
      typeof hour !== 'object' ||
      !validDepartureLocal(hour.time) ||
      !hour.time.endsWith(':00') ||
      hour.time <= previous
    )
      return false;
    previous = hour.time;
    const limits = {
      temperature: [-100, 70],
      apparent: [-150, 100],
      precipitation: [0, 1000],
      probability: [0, 100],
      wind: [0, 500],
      direction: [0, 360],
      gusts: [0, 500],
    };
    for (const [field, [minimum, maximum]] of Object.entries(limits)) {
      const number: unknown = hour[field];
      if (
        number !== null &&
        (typeof number !== 'number' ||
          !Number.isFinite(number) ||
          number < minimum ||
          number > maximum)
      )
        return false;
    }
  }
  return true;
}
export function readWeatherCache(location: string, now = Date.now()): WeatherForecast | null {
  try {
    const entries: unknown = JSON.parse(localStorage.getItem(WEATHER_CACHE_KEY) ?? '[]');
    if (!Array.isArray(entries)) return null;
    const entry = entries.find((item) => item?.location === location);
    if (!entry || !validForecast(entry.forecast)) return null;
    const age = now - entry.forecast.fetchedAt;
    return age >= 0 && age <= MAX_CACHE_AGE_MS ? entry.forecast : null;
  } catch {
    return null;
  }
}
export function writeWeatherCache(location: string, forecast: WeatherForecast): void {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(WEATHER_CACHE_KEY) ?? '[]');
    const entries = Array.isArray(stored)
      ? stored.filter(
          (entry) =>
            entry?.location !== location &&
            typeof entry?.location === 'string' &&
            validForecast(entry.forecast) &&
            forecast.fetchedAt >= entry.forecast.fetchedAt &&
            forecast.fetchedAt - entry.forecast.fetchedAt <= MAX_CACHE_AGE_MS,
        )
      : [];
    localStorage.setItem(
      WEATHER_CACHE_KEY,
      JSON.stringify([{ location, forecast }, ...entries].slice(0, 8)),
    );
  } catch {
    /* Weather remains usable when local storage is unavailable. */
  }
}
