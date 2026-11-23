import { CloudRain, Droplets, Navigation, Wind } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useWeather } from '../hooks/useWeather';
import { weatherHours, WEATHER_FRESH_MS } from '../domain/weather';
import type { Coordinate } from '../domain/types';
import { formatNumber } from '../i18n';
import { Button } from './ui/button';
import './RouteWeather.css';

function temperatureTone(temperature: number | null) {
  if (temperature === null) return 'unknown';
  if (temperature <= 0) return 'cold';
  if (temperature < 10) return 'cool';
  if (temperature < 22) return 'mild';
  return 'warm';
}
function Meter({ value }: { value: number | null }) {
  if (value === null) return null;
  const width = `${Math.min(100, Math.max(0, value))}%`;
  return (
    <span className="route-weather-meter" aria-hidden="true">
      <span style={{ width }} />
    </span>
  );
}
function WindCompass({ direction }: { direction: number | null }) {
  if (direction === null) return null;
  return (
    <span className="route-weather-compass" aria-hidden="true">
      <Navigation size={14} style={{ transform: `rotate(${direction}deg)` }} />
    </span>
  );
}
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
  function localTime(time: string, clock = false) {
    const options: Intl.DateTimeFormatOptions = clock
      ? { timeZone: 'UTC', hour: '2-digit', minute: '2-digit' }
      : { timeZone: 'UTC', dateStyle: 'short', timeStyle: 'short' };
    return new Intl.DateTimeFormat(language, options).format(new Date(`${time}:00Z`));
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
      {forecast && (
        <>
          <div className="route-weather-meta">
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
          </div>
          {!first ? (
            <p role="status">
              {t(
                'No forecast for this departure. Open-Meteo provides up to 16 days ahead, depending on data availability.',
              )}
            </p>
          ) : (
            <>
              <h3>{t('Forecast near departure')}</h3>
              <div className="route-weather-board">
                <div className="route-weather-hero">
                  <time dateTime={first.time}>{localTime(first.time)}</time>
                  <dl className="route-weather-highlight">
                    <div>
                      <dt>{t('Temperature')}</dt>
                      <dd>{value(first.temperature, '°C')}</dd>
                    </div>
                    <div>
                      <dt>{t('Feels like')}</dt>
                      <dd>{value(first.apparent, '°C')}</dd>
                    </div>
                  </dl>
                </div>
                <dl className="route-weather-metrics">
                  <div>
                    <dt>
                      <Droplets size={14} aria-hidden="true" />
                      {t('Precipitation probability')}
                    </dt>
                    <dd>
                      {value(first.probability, '%')}
                      <Meter value={first.probability} />
                    </dd>
                  </div>
                  <div>
                    <dt>
                      <CloudRain size={14} aria-hidden="true" />
                      {t('Precipitation')}
                    </dt>
                    <dd>{value(first.precipitation, t('mm'))}</dd>
                  </div>
                  <div>
                    <dt>
                      <Wind size={14} aria-hidden="true" />
                      {t('Wind')}
                    </dt>
                    <dd>{value(first.wind, t('km/h'))}</dd>
                  </div>
                  <div>
                    <dt>
                      <Wind size={14} aria-hidden="true" />
                      {t('Wind gusts')}
                    </dt>
                    <dd>{value(first.gusts, t('km/h'))}</dd>
                  </div>
                  <div className="route-weather-direction">
                    <dt>{t('Wind from')}</dt>
                    <dd>
                      <span>{value(first.direction, '°')}</span>
                      <WindCompass direction={first.direction} />
                    </dd>
                  </div>
                </dl>
              </div>
              <h3>{t('Hourly forecast at start')}</h3>
              <ol className="route-weather-hours">
                {hours.map((hour) => (
                  <li key={hour.time} data-tone={temperatureTone(hour.temperature)}>
                    <time dateTime={hour.time}>{localTime(hour.time, true)}</time>
                    <dl>
                      <div>
                        <dt className="sr-only">{t('Temperature')}</dt>
                        <dd>{value(hour.temperature, '°C')}</dd>
                      </div>
                      <div>
                        <dt className="sr-only">{t('Precipitation probability')}</dt>
                        <dd>
                          {value(hour.probability, '%')}
                          <Meter value={hour.probability} />
                        </dd>
                      </div>
                      <div>
                        <dt className="sr-only">{t('Wind')}</dt>
                        <dd>{value(hour.wind, t('km/h'))}</dd>
                      </div>
                    </dl>
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
