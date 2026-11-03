import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Copy, Download, Image, LoaderCircle, Share2, X } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group';
import { useRouteCard } from '../hooks/useRouteCard';
import { getRouteCardDimensions, type RouteCardAccent, type RouteCardFormat, type RouteCardRequest, type RouteCardTemplate, type RouteCardTheme } from '../domain/routeCard';
import { buildSocialCaption, type SocialExportPreferences } from '../domain/socialExport';
import { loadPreferences, savePreferences } from '../domain/preferences';
import { Textarea } from './ui/textarea';
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
  const [initial] = useState(() => loadPreferences().socialExport);
  const [title, setTitle] = useState(route.name);
  const [format, setFormat] = useState<RouteCardFormat>(initial.format);
  const [theme, setTheme] = useState<RouteCardTheme>(initial.theme);
  const [selectedTemplate, setTemplate] = useState<RouteCardTemplate>(initial.template);
  const [accent, setAccent] = useState<RouteCardAccent>(initial.accent);
  const [radius, setRadius] = useState(String(initial.privacyRadius));
  const [distance, setDistance] = useState(initial.distance);
  const [duration, setDuration] = useState(initial.duration);
  const [elevation, setElevation] = useState(initial.elevation);
  const [showSafeZones, setShowSafeZones] = useState(false);
  const [storageFailed, setStorageFailed] = useState(false);
  const lastSaved = useRef(initial);
  const hasProfile = elevationGain !== undefined && Number.isFinite(elevationGain) &&
    route.segments.some((segment) => segment.length > 1) &&
    route.segments.every((segment) => segment.every((point) => Number.isFinite(point[2])));
  const template = selectedTemplate === 'elevation' && !hasProfile ? 'adventure' : selectedTemplate;
  const dimensions = getRouteCardDimensions(format);
  const privacyRadius = radius.trim() === '' ? NaN : Number(radius);
  const validRadius =
    radius.trim() !== '' &&
    Number.isInteger(privacyRadius) &&
    privacyRadius >= 0 &&
    privacyRadius <= 10000;
  const preferences = useMemo<SocialExportPreferences>(() => ({
    format, theme, template: selectedTemplate, accent, privacyRadius, distance, duration, elevation,
  }), [format, theme, selectedTemplate, accent, privacyRadius, distance, duration, elevation]);
  useEffect(() => {
    if (!validRadius || JSON.stringify(preferences) === JSON.stringify(lastSaved.current)) return;
    const saved = savePreferences({ socialExport: preferences });
    setStorageFailed(!saved);
    if (saved) lastSaved.current = preferences;
  }, [preferences, validRadius]);
  const request = useMemo<RouteCardRequest>(
    () => ({
      segments: route.segments,
      title: title.trim() || t('Untitled adventure'),
      format,
      theme,
      template,
      accent,
      elevationProfileLabel: t('Elevation profile'),
      privacyRadius,
      activity: route.activity,
      activityLabel: t(route.activity === 'cycling' ? 'Cycling' : 'Hiking'),
      plannedLabel: t('Planned route'),
      metrics: [
        ...(distance && Number.isFinite(route.stats.distance)
          ? [{ label: t('Distance'), value: formatDistance(route.stats.distance) }]
          : []),
        ...(duration && Number.isFinite(route.stats.duration)
          ? [{ label: t('Original time estimate'), value: formatDuration(route.stats.duration) }]
          : []),
        ...(elevation && elevationGain !== undefined && Number.isFinite(elevationGain)
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
      template,
      accent,
      privacyRadius,
      distance,
      duration,
      elevation,
      elevationGain,
      t,
    ],
  );
  const { preview, generate, cancel } = useRouteCard(request, validRadius);
  const caption = useMemo(() => buildSocialCaption(request), [request]);
  const [copyStatus, setCopyStatus] = useState<{ text: string; state: 'copying' | 'copied' | 'error' } | null>(null);
  const copyGeneration = useRef(0);
  useEffect(() => {
    copyGeneration.current++;
    return () => { copyGeneration.current++; };
  }, [caption]);
  const copyState = copyStatus?.text === caption ? copyStatus.state : null;
  const copyCaption = async () => {
    const token = ++copyGeneration.current;
    setCopyStatus({ text: caption, state: 'copying' });
    try {
      await navigator.clipboard.writeText(caption);
      if (token === copyGeneration.current) setCopyStatus({ text: caption, state: 'copied' });
    } catch {
      if (token === copyGeneration.current) setCopyStatus({ text: caption, state: 'error' });
    }
  };
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
          <p className="muted export-copy">{t('Create a preview once. Design changes then refresh it automatically; format and privacy changes need a new preview.')}</p>
          {storageFailed && <p role="alert">{t('Export settings could not be saved. You can still export this image.')}</p>}
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
            <legend>{t('Image template')}</legend>
            <ToggleGroup type="single" value={template} variant="outline" aria-label={t('Image template')}
              onValueChange={(value) => {
                if (value === 'minimal' || value === 'adventure' || (value === 'elevation' && hasProfile)) setTemplate(value);
              }}>
              {(['minimal', 'adventure', 'elevation'] as const).map((item) => (
                <ToggleGroupItem key={item} value={item} disabled={item === 'elevation' && !hasProfile}>
                  <svg className={`route-card-template-thumb route-card-template-${item}`} viewBox="0 0 80 96" aria-hidden="true">
                    <rect x="1" y="1" width="78" height="94" rx="8" />
                    <path className="thumb-title" d="M12 15H58 M12 21H42" />
                    <path className="thumb-route" d="M20 67L16 46L35 36L58 46L48 66L32 58L20 67" />
                    {item === 'elevation' ? <path className="thumb-detail" d="M12 83L23 77L32 80L43 70L52 77L68 73" /> : <path className="thumb-detail" d="M12 82H30 M42 82H65" />}
                  </svg>
                  {t(item === 'minimal' ? 'Minimalism' : item === 'adventure' ? 'Adventure' : 'Relief')}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            {!hasProfile && <p className="muted export-copy">{t('Relief needs complete, reliable elevations.')}</p>}
          </fieldset>
          <fieldset>
            <legend>{t('Accent color')}</legend>
            <ToggleGroup type="single" value={accent} variant="outline" aria-label={t('Accent color')}
              onValueChange={(value) => { if (value === 'green' || value === 'blue' || value === 'orange') setAccent(value); }}>
              {(['green', 'blue', 'orange'] as const).map((color) => (
                <ToggleGroupItem key={color} value={color}>
                  <span className={`route-card-swatch route-card-swatch-${color}`} aria-hidden="true" />
                  {t(color === 'green' ? 'Forest green' : color === 'blue' ? 'Lake blue' : 'Sunset orange')}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </fieldset>
          <fieldset>
            <legend>{t('Image format')}</legend>
            <ToggleGroup
              type="single"
              value={format}
              variant="outline"
              aria-label={t('Image format')}
              onValueChange={(value) => {
                if (value === 'post' || value === 'story' || value === 'square') setFormat(value);
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
              <ToggleGroupItem value="square">
                {t('Square')}
                <span>1080 × 1080</span>
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
          <ToggleGroup type="single" value={['0', '200', '500', '1000'].includes(radius) ? radius : ''}
            variant="outline" className="route-card-privacy-presets" aria-label={t('Privacy presets')}
            onValueChange={(value) => { if (value) setRadius(value); }}>
            <ToggleGroupItem value="0">{t('Full track')}</ToggleGroupItem>
            {[200, 500, 1000].map((metres) => <ToggleGroupItem key={metres} value={String(metres)}>{formatNumber(metres)} {t('m')}</ToggleGroupItem>)}
          </ToggleGroup>
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
          <span className="route-card-output-size">{dimensions.width} × {dimensions.height}</span>
        </div>
        <aside className="route-card-sharing-note" aria-label={t('Before publishing')}>
          <strong>{t(validRadius && privacyRadius > 0 ? 'Start and finish zones are hidden.' : 'The full track is visible.')}</strong>
          <p className="export-copy">{t('Check the title too: it can reveal a location. Statistics describe the full route. Hiding endpoints does not guarantee anonymity.')}</p>
        </aside>
        {format === 'story' && <label className="route-card-safe-toggle">
          <input type="checkbox" checked={showSafeZones} onChange={(event) => setShowSafeZones(event.target.checked)} />
          {t('Show story safe zones')}
        </label>}
        <div
          className={`route-card-preview route-card-preview-${format}`}
          aria-busy={preview.status === 'generating'}
        >
          <div className="route-card-preview-sheet">
            {preview.status === 'ready' ? (
              <img src={preview.url} alt={t('Generated route image')} width={dimensions.width} height={dimensions.height} />
            ) : (
              <div className="route-card-placeholder" aria-hidden="true">
                {preview.status === 'generating' ? <LoaderCircle size={32} className="spin" /> : <Image size={32} />}
              </div>
            )}
            {format === 'story' && showSafeZones && <div className="route-card-safe-zones" aria-hidden="true"><span /><span /></div>}
          </div>
        </div>
        {preview.status === 'error' && (
          <p className="route-card-error" role="alert">
            {translateMessage(preview.message)}
          </p>
        )}
        <p className={preview.status === 'error' ? 'sr-only' : 'muted export-copy'} role="status">
          {preview.status === 'generating'
            ? t('Generating image…')
            : preview.status === 'ready'
              ? t('Preview ready. Check it before sharing.')
              : preview.status === 'idle'
                ? t('The preview is generated only when you press the button.')
                : ''}
        </p>
        {format === 'story' && <p className="muted export-copy">{t('Keep important content in the middle. Shaded zones are preview guides only; social app overlays vary.')}</p>}
        <p className="route-card-background-note muted export-copy">
          {t(template === 'elevation' ? 'Elevation profile uses available heights of the visible track; gaps stay gaps.' : 'Decorative contours, not a terrain map.')}
        </p>
        <div className="route-card-field route-card-caption">
          <Label htmlFor="route-card-caption">{t('Publication caption')}</Label>
          <Textarea id="route-card-caption" readOnly value={caption} spellCheck={false} aria-describedby="route-card-caption-hint" />
          <p id="route-card-caption-hint" className="muted export-copy">{t('Uses the title and selected statistics, not coordinates. You can select and copy it manually.')}</p>
          <Button variant="outline" onClick={() => void copyCaption()} disabled={copyState === 'copying'}>
            {copyState === 'copying' ? <LoaderCircle className="spin" size={17} aria-hidden="true" /> : <Copy size={17} aria-hidden="true" />}
            {t(copyState === 'copying' ? 'Copying…' : 'Copy caption')}
          </Button>
          {copyState === 'copied' && <p role="status">{t('Caption copied.')}</p>}
          {copyState === 'error' && <p role="alert">{t('Copying failed. Select the preview and copy it manually, or try again.')}</p>}
        </div>
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
