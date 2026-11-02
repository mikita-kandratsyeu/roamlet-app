import { useTranslation } from 'react-i18next';
import { useWeather } from '../hooks/useWeather';
import { weatherHours, WEATHER_FRESH_MS } from '../domain/weather';
import type { Coordinate } from '../domain/types';
import { formatNumber } from '../i18n';
import { Button } from './ui/button';
import './RouteWeather.css';

export function RouteWeather({
  coordinate,
  departureLocal,
  contextKey,
}: {
  coordinate?: Coordinate;
  departureLocal?: string;
  contextKey: string;
}) {
  const { t, i18n } = useTranslation();
  const weather = useWeather(coordinate, departureLocal, contextKey);
  const forecast = weather.forecast;
  const hours = forecast && departureLocal ? weatherHours(forecast, departureLocal) : [];
  const first = hours[0];
  const language = i18n.resolvedLanguage || 'en';
  const value = (number: number | null, unit: string) =>
    number === null
      ? t('Unavailable')
      : `${formatNumber(number, { maximumFractionDigits: 1 })} ${unit}`;
  function localTime(time: string) {
    return new Intl.DateTimeFormat(language, {
      timeZone: 'UTC',
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(`${time}:00Z`));
  }
  const outdated = forecast && Date.now() - forecast.fetchedAt >= WEATHER_FRESH_MS;
  return (
    <section
      className="route-weather"
      aria-label={t('Weather at start')}
      aria-busy={weather.loading}
    >
      <p className="fine-print">
        {t(
          'Loading sends only the start coordinates to Open-Meteo. Forecasts are cached on this device for up to 24 hours.',
        )}
      </p>
      <p className="fine-print">
        {t(
          'Departure is interpreted as local time at the start, not your device time. The forecast does not change route timing or geometry.',
        )}
      </p>
      {!weather.available && (
        <p>{t('Choose a departure date and time in Route schedule to load weather.')}</p>
      )}
      {weather.stale && (
        <p role="status">
          {t('The start or departure changed. Load a forecast for the new selection.')}
        </p>
      )}
      <Button
        type="button"
        variant="outline"
        disabled={!weather.available || weather.loading}
        onClick={() => void weather.load(Boolean(forecast))}
      >
        {weather.loading
          ? t('Loading weather…')
          : forecast
            ? t('Refresh forecast')
            : t('Load forecast')}
      </Button>
      {weather.error && (
        <p role="status">
          {weather.error === 'offline'
            ? t('You are offline. Only a previously loaded forecast can be shown.')
            : t('Weather could not be loaded. Try again. Any displayed forecast is a cached copy.')}
        </p>
      )}
      {forecast && (
        <>
          <p className="fine-print">
            {t('Timezone at start: {{timezone}}', { timezone: forecast.timezone })}
          </p>
          <p className="fine-print">
            {t('Loaded: {{time}}', {
              time: new Intl.DateTimeFormat(language, {
                dateStyle: 'short',
                timeStyle: 'short',
                timeZone: forecast.timezone,
              }).format(new Date(forecast.fetchedAt)),
            })}
          </p>
          {(weather.cached || outdated) && (
            <p role="status">
              {outdated
                ? t('This cached forecast is over 30 minutes old. Refresh when online.')
                : t('Showing a cached forecast.')}
            </p>
          )}
          {!first ? (
            <p role="status">
              {t(
                'No forecast for this departure. Open-Meteo provides up to 16 days ahead, depending on data availability.',
              )}
            </p>
          ) : (
            <>
              <h3>{t('Forecast near departure')}</h3>
              <p>
                <time dateTime={first.time}>{localTime(first.time)}</time>
              </p>
              <dl className="route-weather-metrics">
                <div>
                  <dt>{t('Temperature')}</dt>
                  <dd>{value(first.temperature, '°C')}</dd>
                </div>
                <div>
                  <dt>{t('Feels like')}</dt>
                  <dd>{value(first.apparent, '°C')}</dd>
                </div>
                <div>
                  <dt>{t('Precipitation probability')}</dt>
                  <dd>{value(first.probability, '%')}</dd>
                </div>
                <div>
                  <dt>{t('Precipitation')}</dt>
                  <dd>{value(first.precipitation, t('mm'))}</dd>
                </div>
                <div>
                  <dt>{t('Wind')}</dt>
                  <dd>{value(first.wind, t('km/h'))}</dd>
                </div>
                <div>
                  <dt>{t('Wind gusts')}</dt>
                  <dd>{value(first.gusts, t('km/h'))}</dd>
                </div>
                <div>
                  <dt>{t('Wind from')}</dt>
                  <dd>{value(first.direction, '°')}</dd>
                </div>
              </dl>
              <h3>{t('Hourly forecast at start')}</h3>
              <ol className="route-weather-hours">
                {hours.map((hour) => (
                  <li key={hour.time}>
                    <time dateTime={hour.time}>{localTime(hour.time)}</time>
                    <span>
                      {t('Temperature')}: {value(hour.temperature, '°C')}
                    </span>
                    <span>
                      {t('Precipitation probability')}: {value(hour.probability, '%')}
                    </span>
                    <span>
                      {t('Wind')}: {value(hour.wind, t('km/h'))}
                    </span>
                  </li>
                ))}
              </ol>
            </>
          )}
        </>
      )}
      <p className="fine-print">
        {t(
          'Hourly values are approximate. Precipitation and gusts refer to the preceding hour. Local-clock forecasts do not resolve ambiguous or missing daylight-saving hours.',
        )}
      </p>
      <p className="fine-print">
        <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">
          Open-Meteo
        </a>
        {' · '}
        <a
          href="https://creativecommons.org/licenses/by/4.0/"
          target="_blank"
          rel="noopener noreferrer"
        >
          CC BY 4.0
        </a>
      </p>
    </section>
  );
}
