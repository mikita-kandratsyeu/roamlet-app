import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Download, Image, LoaderCircle, Share2, X } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group';
import { useRouteCard } from '../hooks/useRouteCard';
import type { RouteCardFormat, RouteCardRequest, RouteCardTheme } from '../domain/routeCard';
import type { PlannedRoute } from '../domain/types';
import { formatDistance, formatDuration } from '../domain/format';
import { formatNumber, translateMessage } from '../i18n';
import './RouteCardExport.css';

export function RouteCardExport({
  route,
  elevationGain,
  actionsContainer,
}: {
  route: PlannedRoute;
  elevationGain?: number;
  actionsContainer?: HTMLElement | null;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(route.name);
  const [format, setFormat] = useState<RouteCardFormat>('post');
  const [theme, setTheme] = useState<RouteCardTheme>('light');
  const [radius, setRadius] = useState('0');
  const [distance, setDistance] = useState(true);
  const [duration, setDuration] = useState(false);
  const [elevation, setElevation] = useState(true);
  const privacyRadius = radius.trim() === '' ? NaN : Number(radius);
  const validRadius =
    radius.trim() !== '' &&
    Number.isInteger(privacyRadius) &&
    privacyRadius >= 0 &&
    privacyRadius <= 10000;
  const request = useMemo<RouteCardRequest>(
    () => ({
      segments: route.segments,
      title: title.trim() || t('Untitled adventure'),
      format,
      theme,
      privacyRadius,
      activity: route.activity,
      activityLabel: t(route.activity === 'cycling' ? 'Cycling' : 'Hiking'),
      plannedLabel: t('Planned route'),
      metrics: [
        ...(distance
          ? [{ label: t('Distance'), value: formatDistance(route.stats.distance) }]
          : []),
        ...(duration
          ? [{ label: t('Original time estimate'), value: formatDuration(route.stats.duration) }]
          : []),
        ...(elevation && elevationGain !== undefined
          ? [
              {
                label: t('Elevation gain'),
                value: `${formatNumber(Math.round(elevationGain))} ${t('m')}`,
              },
            ]
          : []),
      ],
    }),
    [
      route.segments,
      route.activity,
      route.stats.distance,
      route.stats.duration,
      title,
      format,
      theme,
      privacyRadius,
      distance,
      duration,
      elevation,
      elevationGain,
      t,
    ],
  );
  const { preview, generate, cancel } = useRouteCard(request);
  const [sharing, setSharing] = useState<RouteCardRequest | null>(null);
  const [notice, setNotice] = useState<{
    request: RouteCardRequest;
    message: string;
    error: boolean;
  } | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const filename = `roamlet-route-${format}.png`;
  const file = useMemo(
    () =>
      preview.status === 'ready' ? new File([preview.blob], filename, { type: 'image/png' }) : null,
    [preview, filename],
  );
  let canShare = false;
  try {
    canShare =
      file !== null &&
      typeof navigator.share === 'function' &&
      typeof navigator.canShare === 'function' &&
      navigator.canShare({ files: [file] });
  } catch {
    /* Sharing capabilities vary by browser. */
  }

  const share = async () => {
    if (!file || !canShare) return;
    setSharing(request);
    setNotice(null);
    try {
      await navigator.share({ files: [file] });
    } catch (error) {
      const cancelled =
        typeof error === 'object' &&
        error !== null &&
        'name' in error &&
        error.name === 'AbortError';
      if (mounted.current && !cancelled) {
        setNotice({
          request,
          message: 'Could not share the image. Download it instead.',
          error: true,
        });
      }
    } finally {
      if (mounted.current) setSharing(null);
    }
  };
  const download = () => {
    if (preview.status !== 'ready') return;
    const link = document.createElement('a');
    try {
      link.href = preview.url;
      link.download = filename;
      document.body.append(link);
      link.click();
      setNotice({ request, message: 'Image download started.', error: false });
    } catch {
      setNotice({
        request,
        message: 'Could not download the image. Please try again.',
        error: true,
      });
    } finally {
      link.remove();
    }
  };

  const placeActions = (actions: ReactNode) =>
    actionsContainer === undefined
      ? actions
      : actionsContainer
        ? createPortal(actions, actionsContainer)
        : null;

  return (
    <section className="route-card-export" aria-label={t('Image for social media')}>
      <div className="route-card-settings">
        <div className="route-card-section-heading">
          <h3>{t('Design your image')}</h3>
          <p className="muted export-copy">{t('Choose the look, then generate a preview.')}</p>
        </div>
        <div className="route-card-field">
          <Label htmlFor="route-card-title">{t('Image title')}</Label>
          <Input
            id="route-card-title"
            value={title}
            maxLength={80}
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>
        <div className="route-card-options">
          <fieldset>
            <legend>{t('Image format')}</legend>
            <ToggleGroup
              type="single"
              value={format}
              variant="outline"
              aria-label={t('Image format')}
              onValueChange={(value) => {
                if (value === 'post' || value === 'story') setFormat(value);
              }}
            >
              <ToggleGroupItem value="post">
                {t('Post')}
                <span>1080 × 1350</span>
              </ToggleGroupItem>
              <ToggleGroupItem value="story">
                {t('Story')}
                <span>1080 × 1920</span>
              </ToggleGroupItem>
            </ToggleGroup>
          </fieldset>
          <fieldset>
            <legend>{t('Image theme')}</legend>
            <ToggleGroup
              type="single"
              value={theme}
              variant="outline"
              aria-label={t('Image theme')}
              onValueChange={(value) => {
                if (value === 'light' || value === 'dark') setTheme(value);
              }}
            >
              <ToggleGroupItem value="light">{t('Light')}</ToggleGroupItem>
              <ToggleGroupItem value="dark">{t('Dark')}</ToggleGroupItem>
            </ToggleGroup>
          </fieldset>
        </div>
        <fieldset className="route-card-metrics">
          <legend>{t('Show on image')}</legend>
          <label>
            <input
              type="checkbox"
              checked={distance}
              onChange={(event) => setDistance(event.target.checked)}
            />
            {t('Distance')}
          </label>
          <label>
            <input
              type="checkbox"
              checked={duration}
              onChange={(event) => setDuration(event.target.checked)}
            />
            {t('Original time estimate')}
          </label>
          {elevationGain !== undefined && (
            <label>
              <input
                type="checkbox"
                checked={elevation}
                onChange={(event) => setElevation(event.target.checked)}
              />
              {t('Elevation gain')}
            </label>
          )}
        </fieldset>
        <div className="route-card-field">
          <Label htmlFor="route-card-privacy">{t('Hide around start and finish (metres)')}</Label>
          <Input
            id="route-card-privacy"
            type="number"
            inputMode="numeric"
            min={0}
            max={10000}
            step={1}
            value={radius}
            aria-invalid={!validRadius}
            aria-describedby="route-card-privacy-hint"
            onChange={(event) => setRadius(event.target.value)}
          />
          <p id="route-card-privacy-hint" className="muted export-copy">
            {t('0 shows the whole route. Only the image is changed.')}
          </p>
          <details className="route-card-privacy-details">
            <summary>{t('Privacy details')}</summary>
            <p className="muted export-copy">
              {t(
                'Hides all route portions within this radius, including revisits. 0 shows the entire route. The saved route and GPX stay unchanged. Check the title and image before publishing; this does not guarantee anonymity.',
              )}
            </p>
          </details>
          {!validRadius && <p role="alert">{t('Enter whole metres from 0 to 10000.')}</p>}
        </div>
      </div>
      <div className="route-card-stage">
        <div className="route-card-stage-heading">
          <h3>{t('Image preview')}</h3>
          <span className="route-card-output-size">
            1080 × {format === 'post' ? '1350' : '1920'}
          </span>
        </div>
        <div
          className={`route-card-preview route-card-preview-${format}`}
          aria-busy={preview.status === 'generating'}
        >
          {preview.status === 'ready' ? (
            <img
              src={preview.url}
              alt={t('Generated route image')}
              width={1080}
              height={format === 'post' ? 1350 : 1920}
            />
          ) : (
            <div className="route-card-placeholder">
              <Image size={32} aria-hidden="true" />
              <p>{t('The preview is generated only when you press the button.')}</p>
            </div>
          )}
        </div>
        <p className="route-card-background-note muted export-copy">
          {t('Decorative contours, not a terrain map.')}
        </p>
        {preview.status === 'error' && (
          <p className="route-card-error" role="alert">
            {translateMessage(preview.message)}
          </p>
        )}
        <p className="muted export-copy" role="status">
          {preview.status === 'generating'
            ? t('Generating image…')
            : preview.status === 'ready'
              ? t('Preview ready. Check it before sharing.')
              : ''}
        </p>
        {notice?.request === request && (
          <p role={notice.error ? 'alert' : 'status'}>{translateMessage(notice.message)}</p>
        )}
      </div>
      {placeActions(
        <div className="route-card-actions">
          {preview.status === 'generating' ? (
            <Button variant="outline" onClick={cancel}>
              <X size={17} aria-hidden="true" />
              {t('Cancel generation')}
            </Button>
          ) : (
            <Button
              variant={preview.status === 'ready' ? 'outline' : 'default'}
              onClick={() => {
                setNotice(null);
                void generate();
              }}
              disabled={!validRadius}
            >
              <Image size={17} aria-hidden="true" />
              {t(preview.status === 'ready' ? 'Regenerate preview' : 'Create preview')}
            </Button>
          )}
          {preview.status === 'ready' && (
            <>
              <Button onClick={download}>
                <Download size={17} aria-hidden="true" />
                {t('Download PNG')}
              </Button>
              {canShare && (
                <Button variant="outline" onClick={() => void share()} disabled={sharing !== null}>
                  {sharing !== null ? (
                    <LoaderCircle size={17} className="spin" aria-hidden="true" />
                  ) : (
                    <Share2 size={17} aria-hidden="true" />
                  )}
                  {t('Share image')}
                </Button>
              )}
            </>
          )}
        </div>,
      )}
    </section>
  );
}
