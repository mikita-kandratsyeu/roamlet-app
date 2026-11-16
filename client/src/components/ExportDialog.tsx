import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpen, Download, ExternalLink, FileDown, Image, Sparkles } from 'lucide-react';
import { Dialog } from './Dialog';
import { ExportRouteMap } from './ExportRouteMap';
import { RouteCardExport } from './RouteCardExport';
import { AiRouteExport } from './AiRouteExport';
import { RouteBookExport } from './RouteBookExport';
import type { PersonalTimeOptions } from '../domain/time';
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group';
import { Notification } from './Notification';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { gpxFilename } from '../domain/gpx';
import { formatDistance, formatDuration } from '../domain/format';
import type { PlannedRoute } from '../domain/types';
import { formatNumber, translateMessage } from '../i18n';
import './ExportDialog.css';

export function ExportDialog({
  route,
  personalTime,
  onDownload,
  onClose,
}: {
  route: PlannedRoute;
  personalTime?: PersonalTimeOptions;
  onDownload: (route: PlannedRoute, filename: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'gpx' | 'image' | 'ai' | 'roadbook'>('gpx');
  const [actionsContainer, setActionsContainer] = useState<HTMLDivElement | null>(null);
  const [filename, setFilename] = useState(() => gpxFilename(route.name));
  const [error, setError] = useState<string | null>(null);
  const filenameInput = useRef<HTMLInputElement>(null);
  const exportModes = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (mode !== 'roadbook') return;
    document.body.classList.add('roamlet-roadbook-printing');
    return () => document.body.classList.remove('roamlet-roadbook-printing');
  }, [mode]);
  useLayoutEffect(() => {
    const body = exportModes.current?.closest('.roamlet-dialog')?.querySelector('.dialog-body');
    if (body) body.scrollTop = 0;
  }, [mode, actionsContainer]);
  const trackPoints = useMemo(
    () => route.segments.reduce((sum, segment) => sum + segment.length, 0),
    [route.segments],
  );
  const completeHeights = useMemo(
    () => route.segments.every((segment) => segment.every((point) => Number.isFinite(point[2]))),
    [route.segments],
  );
  const showElevation =
    (route.source === 'gpx' || route.elevationSource === 'openrouteservice') &&
    trackPoints > 1 &&
    completeHeights &&
    Number.isFinite(route.stats.ascent) &&
    Number.isFinite(route.stats.descent);
  const details = [
    [t('Activity'), t(route.activity === 'cycling' ? 'Cycling' : 'Hiking')],
    [t('Distance'), formatDistance(route.stats.distance)],
    [t('Original time estimate'), formatDuration(route.stats.duration)],
    ...(showElevation
      ? [
          [t('Elevation gain'), `${formatNumber(Math.round(route.stats.ascent!))} ${t('m')}`],
          [t('Elevation loss'), `${formatNumber(Math.round(route.stats.descent!))} ${t('m')}`],
        ]
      : []),
    [t('Track points'), formatNumber(trackPoints)],
    [t('GPX segments'), formatNumber(route.segments.length)],
    [t('Waypoints'), formatNumber(route.waypoints.length)],
  ];

  return (
    <Dialog
      title={t('Export route')}
      initialFocusRef={filenameInput}
      onClose={onClose}
      wide={mode === 'image' || mode === 'roadbook'}
      navigation={
        <div className="export-mode-nav">
          <ToggleGroup
            ref={exportModes}
            type="single"
            value={mode}
            variant="outline"
            spacing={0}
            className="export-mode"
            aria-label={t('Export format')}
            aria-describedby="export-mode-hint"
            onValueChange={(value) => {
              if (value === 'gpx' || value === 'image' || value === 'ai' || value === 'roadbook') {
                setMode(value);
              }
            }}
          >
            <ToggleGroupItem value="gpx" className="export-mode-item" aria-label="GPX">
              <FileDown aria-hidden="true" />
              <span className="export-mode-label">GPX</span>
            </ToggleGroupItem>
            <ToggleGroupItem value="roadbook" className="export-mode-item" aria-label={t('Roadbook')}>
              <BookOpen aria-hidden="true" />
              <span className="export-mode-label export-mode-label--full">{t('Roadbook')}</span>
              <span className="export-mode-label export-mode-label--short">{t('Roadbook, short')}</span>
            </ToggleGroupItem>
            <ToggleGroupItem
              value="image"
              className="export-mode-item"
              aria-label={t('For social media')}
            >
              <Image aria-hidden="true" />
              <span className="export-mode-label export-mode-label--full">{t('For social media')}</span>
              <span className="export-mode-label export-mode-label--short">{t('For social media, short')}</span>
            </ToggleGroupItem>
            <ToggleGroupItem value="ai" className="export-mode-item" aria-label={t('For AI')}>
              <Sparkles aria-hidden="true" />
              <span className="export-mode-label export-mode-label--full">{t('For AI')}</span>
              <span className="export-mode-label export-mode-label--short">{t('For AI, short')}</span>
            </ToggleGroupItem>
          </ToggleGroup>
          <p id="export-mode-hint" className="export-mode-hint">
            {mode === 'gpx'
              ? t('A GPX file for a GPS device or another app. Roamlet does not upload the route.')
              : mode === 'roadbook'
                ? t('An A4 sheet with the map, profile, stops and times. Nothing is uploaded.')
                : mode === 'image'
                  ? t('A picture for a post, story or square, made on this device.')
                  : t('A summary you copy and paste into an AI chat yourself.')}
          </p>
        </div>
      }
      footer={mode === 'image' ? <div ref={setActionsContainer} /> : undefined}
    >
      {mode === 'ai' ? (
        <AiRouteExport route={route} personalTime={personalTime} />
      ) : mode === 'image' ? (
        <RouteCardExport
          route={route}
          elevationGain={showElevation ? route.stats.ascent : undefined}
          actionsContainer={actionsContainer}
        />
      ) : mode === 'roadbook' ? (
        <RouteBookExport
          route={route}
          personalTime={personalTime}
          onPrint={() => window.print()}
        />
      ) : (
        <>
          <section className="export-route-overview" aria-label={t('Route details')}>
            <ExportRouteMap segments={route.segments} />
            <div className="export-route-heading">
              <p className="export-route-kicker">
                {t(route.activity === 'cycling' ? 'Cycling' : 'Hiking')}
              </p>
              <h3>{route.name || t('Untitled adventure')}</h3>
            </div>
            <dl className="export-route-details">
              {details.map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </section>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!filename.trim()) return;
              setError(null);
              try {
                onDownload(route, gpxFilename(filename));
              } catch (error) {
                setError(
                  error instanceof Error
                    ? error.message
                    : 'Something went wrong. Please try again.',
                );
              }
            }}
          >
            <div className="export-file">
              <Label htmlFor="export-filename">{t('File name')}</Label>
              <div className="export-file-actions">
                <Input
                  id="export-filename"
                  ref={filenameInput}
                  required
                  maxLength={120}
                  value={filename}
                  aria-describedby="export-filename-hint"
                  onChange={(event) => setFilename(event.target.value)}
                />
                <Button type="submit" className="primary export-download" disabled={!filename.trim()}>
                  <Download size={17} aria-hidden="true" />
                  {t('Download GPX')}
                </Button>
              </div>
              <p id="export-filename-hint" className="muted export-copy">
                {t('Saved as {{filename}}', { filename: gpxFilename(filename) })}
              </p>
            </div>
            {error && (
              <Notification
                title={t('Notification')}
                variant="error"
                message={translateMessage(error)}
                onDismiss={() => setError(null)}
              />
            )}
          </form>
          <details className="export-guide">
            <summary>{t('How to import into Komoot')}</summary>
            <p className="muted export-copy">
              {t('Import the downloaded file yourself. Roamlet does not send routes to Komoot.')}
            </p>
            <ol>
              <li>{t('Download the GPX file above.')}</li>
              <li>{t('In Komoot, open Profile → Saved routes → Import a GPS file.')}</li>
              <li>{t('Choose the downloaded file, import it as a planned route, and save.')}</li>
            </ol>
            <a
              href="https://support.komoot.com/hc/en-us/articles/10115477099674-Export-and-import-Routes-and-Activities"
              target="_blank"
              rel="noopener noreferrer"
            >
              {t('Komoot import instructions')}
              <ExternalLink size={14} aria-hidden="true" />
            </a>
          </details>
          <details className="export-guide">
            <summary>{t('How to import into Strava')}</summary>
            <p className="muted export-copy">
              {t('Import the downloaded file yourself. Roamlet does not send routes to Strava.')}
            </p>
            <ol>
              <li>{t('Download the GPX file above.')}</li>
              <li>{t('On the Strava website, open Dashboard → My Routes → Create New Route.')}</li>
              <li>
                {t('Use the upload button to choose the GPX file, review the route, and save.')}
              </li>
            </ol>
            <p className="muted export-copy">
              {t(
                'These steps create a route, not a recorded activity. Strava may require a subscription for route creation.',
              )}
            </p>
            <a
              href="https://support.strava.com/en-us/articles/15402061-how-do-i-create-a-route-from-a-gpx-file"
              target="_blank"
              rel="noopener noreferrer"
            >
              {t('Strava import instructions')}
              <ExternalLink size={14} aria-hidden="true" />
            </a>
          </details>
        </>
      )}
    </Dialog>
  );
}
