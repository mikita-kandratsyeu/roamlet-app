import { useEffect, useRef, useState } from 'react';
import type { Coordinate } from '../domain/types';
import { validDepartureLocal } from '../domain/schedule';
import {
  readWeatherCache,
  writeWeatherCache,
  weatherLocationKey,
  WEATHER_FRESH_MS,
  type WeatherForecast,
} from '../domain/weather';
import { requestWeather } from '../services/weather';

type WeatherState = {
  key: string;
  status: 'idle' | 'loading' | 'success' | 'error';
  forecast: WeatherForecast | null;
  error: 'offline' | 'request' | null;
  cached: boolean;
  signal?: AbortSignal;
};
export function useWeather(
  coordinate: Coordinate | undefined,
  departure: string | undefined,
  contextKey: string,
) {
  const location = coordinate ? weatherLocationKey(coordinate) : '';
  const key = JSON.stringify([contextKey, location, departure]);
  const available = Boolean(coordinate && validDepartureLocal(departure));
  const [state, setState] = useState<WeatherState>({
    key,
    status: 'idle',
    forecast: null,
    error: null,
    cached: false,
  });
  const controller = useRef<AbortController | null>(null);
  const revision = useRef(0);
  useEffect(
    () => () => {
      revision.current += 1;
      controller.current?.abort();
    },
    [key],
  );

  async function load(refresh = false) {
    if (!coordinate || !available) return;
    controller.current?.abort();
    const current = ++revision.current;
    const abort = new AbortController();
    controller.current = abort;
    const cached = readWeatherCache(location);
    const forecast = state.key === key ? (state.forecast ?? cached) : cached;
    if (navigator.onLine === false) {
      setState({
        key,
        status: forecast ? 'success' : 'error',
        forecast,
        error: 'offline',
        cached: Boolean(forecast),
      });
      return;
    }
    if (!refresh && cached && Date.now() - cached.fetchedAt < WEATHER_FRESH_MS) {
      setState({ key, status: 'success', forecast: cached, error: null, cached: true });
      return;
    }
    setState({
      key,
      status: 'loading',
      forecast,
      error: null,
      cached: Boolean(forecast),
      signal: abort.signal,
    });
    try {
      const result = await requestWeather(coordinate, abort.signal);
      if (current !== revision.current || abort.signal.aborted) return;
      writeWeatherCache(location, result);
      setState({ key, status: 'success', forecast: result, error: null, cached: false });
    } catch {
      if (current !== revision.current || abort.signal.aborted) return;
      setState({ key, status: 'error', forecast, error: 'request', cached: Boolean(forecast) });
    }
  }
  const sameRequest = state.key === key;
  return {
    available,
    load,
    forecast: sameRequest ? state.forecast : null,
    loading: sameRequest && state.status === 'loading' && !state.signal?.aborted,
    error: sameRequest ? state.error : null,
    cached: sameRequest && state.cached,
    stale: !sameRequest && state.forecast !== null,
  };
}
