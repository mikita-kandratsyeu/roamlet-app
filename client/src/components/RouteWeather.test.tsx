import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { toast } from 'sonner';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RouteWeather } from './RouteWeather';
import { requestWeather } from '../services/weather';
import {
  readWeatherCache,
  writeWeatherCache,
  validForecast,
  weatherHours,
  weatherLocationKey,
  WEATHER_CACHE_KEY,
  WEATHER_FRESH_MS,
  type WeatherForecast,
} from '../domain/weather';
import i18n from '../i18n';

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

const toastOptions = { dismissible: true, closeButton: true };
const offlineMessage = 'You are offline. Only a previously loaded forecast can be shown.';
const errorMessage =
  'Weather could not be loaded. Try again. Any displayed forecast is a cached copy.';

const coordinate: [number, number] = [11.4, 47.26];
const departureLocal = '2026-11-02T08:30';
const props = { coordinate, departureLocal, contextKey: 'route-a' };
function forecast(): WeatherForecast {
  return {
    timezone: 'Europe/Vienna',
    fetchedAt: Date.now(),
    hours: Array.from({ length: 8 }, (_, index) => ({
      time: `2026-11-02T${String(index + 8).padStart(2, '0')}:00`,
      temperature: 12,
      apparent: 10,
      precipitation: 0.5,
      probability: 30,
      wind: 15,
      direction: 270,
      gusts: 24,
    })),
  };
}
function response(data = forecast()) {
  const mapping = {
    temperature_2m: 'temperature',
    apparent_temperature: 'apparent',
    precipitation: 'precipitation',
    precipitation_probability: 'probability',
    wind_speed_10m: 'wind',
    wind_direction_10m: 'direction',
    wind_gusts_10m: 'gusts',
  } as const;
  return {
    timezone: data.timezone,
    hourly_units: {
      temperature_2m: '°C',
      apparent_temperature: '°C',
      precipitation: 'mm',
      precipitation_probability: '%',
      wind_speed_10m: 'km/h',
      wind_direction_10m: '°',
      wind_gusts_10m: 'km/h',
    },
    hourly: {
      time: data.hours.map((hour) => hour.time),
      ...Object.fromEntries(
        Object.entries(mapping).map(([field, property]) => [
          field,
          data.hours.map((hour) => hour[property]),
        ]),
      ),
    },
  };
}
function mockFetch(data: unknown = response()) {
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => data });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
beforeEach(async () => {
  vi.clearAllMocks();
  localStorage.removeItem(WEATHER_CACHE_KEY);
  await i18n.changeLanguage('en');
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.removeItem(WEATHER_CACHE_KEY);
});

describe('weather data and cache', () => {
  it('selects local provider hours, never the device timezone, and does not invent missing dates', () => {
    expect(weatherHours(forecast(), departureLocal)).toHaveLength(6);
    expect(weatherHours(forecast(), departureLocal)[0].time).toBe('2026-11-02T08:00');
    expect(weatherHours(forecast(), '2026-12-02T08:30')).toEqual([]);
    expect(weatherHours(forecast(), '2026-02-30T08:30')).toEqual([]);
    expect(weatherHours(forecast(), '2026-11-02T15:30')).toHaveLength(1);
  });
  it('accepts missing observations but rejects invalid values, timestamps and timezones', () => {
    const data = forecast();
    data.hours[0].temperature = null;
    expect(validForecast(data)).toBe(true);
    for (const invalid of [
      { ...data, timezone: 'not/a/timezone' },
      { ...data, hours: [{ ...data.hours[0], probability: 101 }] },
      { ...data, hours: [{ ...data.hours[0], wind: -1 }] },
      { ...data, hours: [{ ...data.hours[0], gusts: NaN }] },
      { ...data, hours: [{ ...data.hours[0], time: '2026-02-30T08:00' }] },
      { ...data, hours: [data.hours[0], data.hours[0]] },
      { ...data, hours: [] },
    ])
      expect(validForecast(invalid)).toBe(false);
  });
  it('persists a bounded location cache and rejects expired, future or corrupted entries', () => {
    for (let index = 0; index < 10; index++) writeWeatherCache(String(index), forecast());
    expect(JSON.parse(localStorage.getItem(WEATHER_CACHE_KEY) ?? '[]')).toHaveLength(8);
    expect(readWeatherCache('0')).toBeNull();
    const data = forecast();
    writeWeatherCache('test', data);
    expect(readWeatherCache('test')).toEqual(data);
    expect(readWeatherCache('test', data.fetchedAt - 1)).toBeNull();
    expect(readWeatherCache('test', data.fetchedAt + 24 * 60 * 60 * 1000 + 1)).toBeNull();
    localStorage.setItem(WEATHER_CACHE_KEY, 'invalid');
    expect(readWeatherCache('test')).toBeNull();
    localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify([{ location: 'test', forecast: {} }]));
    expect(readWeatherCache('test')).toBeNull();
  });
  it('survives unavailable local storage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readWeatherCache('test')).toBeNull();
    expect(() => writeWeatherCache('test', forecast())).not.toThrow();
  });
});

describe('weather transport', () => {
  it('uses a fixed provider, lon/lat order and explicit units without credentials or referrer', async () => {
    const fetch = mockFetch();
    const result = await requestWeather(coordinate, new AbortController().signal);
    expect(result.timezone).toBe('Europe/Vienna');
    const [url, options] = fetch.mock.calls[0];
    expect(url.origin).toBe('https://api.open-meteo.com');
    expect(url.searchParams.get('longitude')).toBe('11.4');
    expect(url.searchParams.get('latitude')).toBe('47.26');
    expect(url.searchParams.get('timezone')).toBe('auto');
    expect(url.searchParams.get('forecast_days')).toBe('16');
    expect(options.credentials).toBe('omit');
    expect(options.referrerPolicy).toBe('no-referrer');
  });
  it('rejects incomplete responses and incorrect units instead of showing invented data', async () => {
    const data = response();
    data.hourly_units.wind_speed_10m = 'm/s';
    mockFetch(data);
    await expect(requestWeather(coordinate, new AbortController().signal)).rejects.toThrow(
      'Invalid weather response',
    );
    mockFetch({ ...response(), hourly: { time: [] } });
    await expect(requestWeather(coordinate, new AbortController().signal)).rejects.toThrow(
      'Invalid weather response',
    );
  });
  it('sanitizes HTTP failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({ reason: 'private' }) }),
    );
    await expect(requestWeather(coordinate, new AbortController().signal)).rejects.toThrow(
      'Weather service unavailable',
    );
  });
  it('propagates cancellation and times out while consuming the response', async () => {
    vi.useFakeTimers();
    let bodySignal: AbortSignal | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (_url, options: RequestInit) => {
        bodySignal = options.signal ?? undefined;
        return {
          ok: true,
          json: () =>
            new Promise((_resolve, reject) => {
              options.signal?.addEventListener('abort', () =>
                reject(new DOMException('aborted', 'AbortError')),
              );
            }),
        };
      }),
    );
    const abort = new AbortController();
    const cancelled = requestWeather(coordinate, abort.signal);
    const cancelledAssertion = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
    await Promise.resolve();
    abort.abort();
    await cancelledAssertion;
    expect(bodySignal?.aborted).toBe(true);
    const timedOut = requestWeather(coordinate, new AbortController().signal);
    const timeoutAssertion = expect(timedOut).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(10_000);
    await timeoutAssertion;
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('weather interaction', () => {
  it('does not request weather on mount, expansion or date edits, and disables loading without a date', async () => {
    const fetch = mockFetch();
    const { rerender } = render(<RouteWeather {...props} departureLocal={undefined} />);
    expect(screen.getByRole('button', { name: 'Load forecast' })).toBeDisabled();
    rerender(<RouteWeather {...props} />);
    expect(screen.getByRole('button', { name: 'Load forecast' })).toBeEnabled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('loads on explicit action, renders units, timezone, attribution and hourly values', async () => {
    const fetch = mockFetch();
    render(<RouteWeather {...props} />);
    await userEvent.click(screen.getByRole('button', { name: 'Load forecast' }));
    expect(await screen.findByText('Timezone at start: Europe/Vienna')).toBeVisible();
    expect(screen.getByText('Feels like').nextElementSibling).toHaveTextContent('10 °C');
    expect(screen.getByText('Wind gusts').nextElementSibling).toHaveTextContent('24 km/h');
    expect(screen.getByRole('link', { name: 'Open-Meteo' })).toHaveAttribute(
      'href',
      'https://open-meteo.com/',
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(6);
    expect(fetch).toHaveBeenCalledOnce();
    expect(readWeatherCache(weatherLocationKey(coordinate))).not.toBeNull();
  });
  it('shows missing observations as unavailable and out-of-range departures without substituting today', async () => {
    const data = forecast();
    data.hours[0].apparent = null;
    mockFetch(response(data));
    const { rerender } = render(<RouteWeather {...props} />);
    await userEvent.click(screen.getByRole('button', { name: 'Load forecast' }));
    await screen.findByText('Forecast near departure');
    expect(screen.getByText('Feels like').nextElementSibling).toHaveTextContent('Unavailable');
    rerender(<RouteWeather {...props} departureLocal="2026-12-02T08:30" />);
    expect(screen.queryByText('Forecast near departure')).not.toBeInTheDocument();
    expect(screen.getByText(/The start or departure changed/)).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Load forecast' }));
    expect(await screen.findByText(/No forecast for this departure/)).toBeVisible();
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });
  it('reuses fresh cache after reopening and refreshes only on explicit action', async () => {
    writeWeatherCache(weatherLocationKey(coordinate), forecast());
    const fetch = mockFetch();
    render(<RouteWeather {...props} />);
    await userEvent.click(screen.getByRole('button', { name: 'Load forecast' }));
    expect(screen.getByText('Showing a cached forecast.')).toBeVisible();
    expect(fetch).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Refresh forecast' }));
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('keeps cached data offline and handles an empty cache without networking', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const fetch = mockFetch();
    const { unmount } = render(<RouteWeather {...props} />);
    await userEvent.click(screen.getByRole('button', { name: 'Load forecast' }));
    expect(toast.error).toHaveBeenCalledExactlyOnceWith(offlineMessage, toastOptions);
    expect(screen.queryByText(offlineMessage)).not.toBeInTheDocument();
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
    unmount();
    writeWeatherCache(weatherLocationKey(coordinate), {
      ...forecast(),
      fetchedAt: Date.now() - WEATHER_FRESH_MS,
    });
    render(<RouteWeather {...props} />);
    await userEvent.click(screen.getByRole('button', { name: 'Load forecast' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(6);
    expect(screen.getByText(/over 30 minutes old/)).toBeVisible();
    expect(toast.error).toHaveBeenCalledTimes(2);
    expect(toast.error).toHaveBeenLastCalledWith(offlineMessage, toastOptions);
    expect(screen.queryByText(offlineMessage)).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('allows retry after a network failure and preserves cached data on a failed refresh', async () => {
    const fetch = mockFetch();
    fetch.mockRejectedValueOnce(new Error('network'));
    render(<RouteWeather {...props} />);
    await userEvent.click(screen.getByRole('button', { name: 'Load forecast' }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledExactlyOnceWith(errorMessage, toastOptions),
    );
    expect(screen.queryByText(errorMessage)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Load forecast' }));
    await screen.findByText('Forecast near departure');
    fetch.mockRejectedValueOnce(new Error('network'));
    await userEvent.click(screen.getByRole('button', { name: 'Refresh forecast' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(2));
    expect(toast.error).toHaveBeenLastCalledWith(errorMessage, toastOptions);
    expect(screen.queryByText(errorMessage)).not.toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(6);
    expect(screen.getByText('Showing a cached forecast.')).toBeVisible();
  });
  it('aborts old requests on context changes and never lets late results overwrite newer data', async () => {
    let resolveOld: ((value: unknown) => void) | undefined;
    const fetch = mockFetch();
    fetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    );
    const { rerender } = render(<RouteWeather {...props} />);
    await userEvent.click(screen.getByRole('button', { name: 'Load forecast' }));
    expect(screen.getByRole('button', { name: 'Loading weather…' })).toBeDisabled();
    const signal = fetch.mock.calls[0][1].signal;
    rerender(<RouteWeather {...props} contextKey="route-b" coordinate={[12, 48]} />);
    expect(signal.aborted).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Load forecast' }));
    await screen.findByText('Forecast near departure');
    const older = forecast();
    older.timezone = 'Asia/Tokyo';
    await act(async () => {
      resolveOld?.({ ok: true, json: async () => response(older) });
    });
    expect(screen.getByText('Timezone at start: Europe/Vienna')).toBeVisible();
    expect(screen.queryByText('Timezone at start: Asia/Tokyo')).not.toBeInTheDocument();
    expect(readWeatherCache(weatherLocationKey(coordinate))).toBeNull();
  });
  it('allows loading again after returning to a selection whose pending request was cancelled', async () => {
    const fetch = mockFetch();
    let resolveOld: ((value: unknown) => void) | undefined;
    fetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    );
    const { rerender } = render(<RouteWeather {...props} />);
    await userEvent.click(screen.getByRole('button', { name: 'Load forecast' }));
    rerender(<RouteWeather {...props} departureLocal="2026-11-02T09:30" />);
    rerender(<RouteWeather {...props} />);
    expect(screen.getByRole('button', { name: 'Load forecast' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Load forecast' }));
    await screen.findByText('Forecast near departure');
    await act(async () => {
      resolveOld?.({ ok: true, json: async () => response() });
    });
    expect(screen.getByRole('button', { name: 'Refresh forecast' })).toBeEnabled();
  });
  it('cancels on unmount without treating it as a user-facing failure', async () => {
    const fetch = mockFetch();
    let resolve: ((value: unknown) => void) | undefined;
    fetch.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const { unmount } = render(<RouteWeather {...props} />);
    await userEvent.click(screen.getByRole('button', { name: 'Load forecast' }));
    const signal = fetch.mock.calls[0][1].signal;
    unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => {
      resolve?.({ ok: true, json: async () => response() });
    });
    expect(readWeatherCache(weatherLocationKey(coordinate))).toBeNull();
  });
  it.each(['context change', 'unmount'])(
    'does not notify about a late failure after %s',
    async (change) => {
      let reject: ((reason: Error) => void) | undefined;
      const fetch = mockFetch();
      fetch.mockImplementationOnce(
        () =>
          new Promise((_resolve, fail) => {
            reject = fail;
          }),
      );
      const { rerender, unmount } = render(<RouteWeather {...props} />);
      await userEvent.click(screen.getByRole('button', { name: 'Load forecast' }));
      if (change === 'unmount') unmount();
      else rerender(<RouteWeather {...props} contextKey="route-b" />);
      await act(async () => {
        reject?.(new Error('late network failure'));
      });
      expect(toast.error).not.toHaveBeenCalled();
    },
  );
  it('localizes failure notifications in Russian without inline duplicates', async () => {
    await i18n.changeLanguage('ru');
    const fetch = mockFetch();
    fetch.mockRejectedValueOnce(new Error('network'));
    render(<RouteWeather {...props} />);
    expect(toast.error).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: i18n.t('Load forecast') }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledExactlyOnceWith(i18n.t(errorMessage), toastOptions),
    );
    expect(screen.queryByText(i18n.t(errorMessage))).not.toBeInTheDocument();
  });
  it('localizes controls and numbers in Russian without losing loaded data', async () => {
    mockFetch();
    render(<RouteWeather {...props} />);
    await userEvent.click(screen.getByRole('button', { name: 'Load forecast' }));
    await screen.findByText('Forecast near departure');
    await act(async () => {
      await i18n.changeLanguage('ru');
    });
    const region = screen.getByRole('region', { name: 'Погода на старте' });
    expect(within(region).getByRole('button', { name: 'Обновить прогноз' })).toBeEnabled();
    expect(within(region).getByText('Осадки').nextElementSibling).toHaveTextContent('0,5 мм');
  });
});
