import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Bike,
  ChevronDown,
  Download,
  ExternalLink,
  Footprints,
  Printer,
} from 'lucide-react';
import { Dialog } from './Dialog';
import { PlannerChoice } from './PlannerChoice';
import { ExportRouteMap } from './ExportRouteMap';
import { RouteCardExport } from './RouteCardExport';
import { AiRouteExport } from './AiRouteExport';
import { RouteBookExport } from './RouteBookExport';
import type { PersonalTimeOptions } from '../domain/time';
import { Notification } from './Notification';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { gpxFilename } from '../domain/gpx';
import { measureElevation } from '../domain/stats';
import { formatDistance, formatDuration } from '../domain/format';
import type { PlannedRoute } from '../domain/types';
import { formatNumber, translateMessage } from '../i18n';
import './ExportDialog.css';

type ExportMode = 'gpx' | 'image' | 'ai' | 'roadbook';

function useRouteExportFacts(route: PlannedRoute) {
  const { t } = useTranslation();
  const trackPoints = useMemo(
    () => route.segments.reduce((sum, segment) => sum + segment.length, 0),
    [route.segments],
  );
  const measuredElevation = useMemo(() => {
    if (route.source !== 'gpx' && route.elevationSource !== 'openrouteservice') return null;
    return measureElevation(route.segments);
  }, [route.elevationSource, route.segments, route.source]);
  const showElevation = measuredElevation !== null;
  const heroDetails = useMemo(
    () => [
      [t('Distance'), formatDistance(route.stats.distance)],
      [t('Original time estimate'), formatDuration(route.stats.duration)],
      ...(measuredElevation
        ? [
            [t('Elevation gain'), `${formatNumber(Math.round(measuredElevation.ascent))} ${t('m')}`],
            [t('Elevation loss'), `${formatNumber(Math.round(measuredElevation.descent))} ${t('m')}`],
          ]
        : []),
    ],
    [measuredElevation, route.stats.distance, route.stats.duration, t],
  );
  const technicalDetails = useMemo(
    () => [
      [t('Track points'), formatNumber(trackPoints)],
      [t('GPX segments'), formatNumber(route.segments.length)],
      [t('Waypoints'), formatNumber(route.waypoints.length)],
    ],
    [route.segments.length, route.waypoints.length, trackPoints, t],
  );
  return {
    showElevation,
    heroDetails,
    technicalDetails,
    trackPoints,
    elevationGain: measuredElevation?.ascent,
  };
}

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
  const [mode, setMode] = useState<ExportMode>('gpx');
  const [actionsContainer, setActionsContainer] = useState<HTMLDivElement | null>(null);
  const [filename, setFilename] = useState(() => gpxFilename(route.name));
  const [error, setError] = useState<string | null>(null);
  const filenameInput = useRef<HTMLInputElement>(null);
  const shell = useRef<HTMLDivElement>(null);
  const { showElevation, heroDetails, technicalDetails, elevationGain } = useRouteExportFacts(route);

  useEffect(() => {
    if (mode !== 'roadbook') return;
    document.body.classList.add('roamlet-roadbook-printing');
    return () => document.body.classList.remove('roamlet-roadbook-printing');
  }, [mode]);

  useLayoutEffect(() => {
    const body = shell.current?.closest('.roamlet-dialog')?.querySelector('.dialog-body');
    if (body) body.scrollTop = 0;
  }, [mode, actionsContainer]);

  const modes = useMemo(
    () =>
      [
        { value: 'gpx' as const, label: 'GPX' },
        { value: 'roadbook' as const, label: 'Roadbook' },
        { value: 'image' as const, label: 'For social media' },
        { value: 'ai' as const, label: 'For AI' },
      ],
    [],
  );

  const printRoadbook = () => window.print();

  return (
    <Dialog
      title={t('Export route')}
      initialFocusRef={mode === 'gpx' ? filenameInput : undefined}
      onClose={onClose}
      wide
      navigation={
        <div className="export-format-nav" aria-label={t('Route summary')}>
          <div className="export-route-bar__icon" aria-hidden="true">
            {route.activity === 'cycling' ? <Bike size={18} /> : <Footprints size={18} />}
          </div>
          <div className="export-route-bar__copy">
            <p className="export-route-bar__kicker">
              {t(route.activity === 'cycling' ? 'Cycling' : 'Hiking')}
            </p>
            <h3 className="export-route-bar__title">{route.name || t('Untitled adventure')}</h3>
          </div>
          <PlannerChoice
            label={t('Export format')}
            value={mode}
            options={modes}
            onChange={setMode}
          />
        </div>
      }
      footer={
        <div className="export-dialog-footer">
          <div className="export-dialog-footer__actions" ref={setActionsContainer}>
            {mode === 'gpx' ? (
              <Button
                type="submit"
                form="export-gpx-form"
                className="primary export-download"
                disabled={!filename.trim()}
              >
                <Download size={16} aria-hidden="true" />
                {t('Download GPX')}
              </Button>
            ) : mode === 'roadbook' ? (
              <Button type="button" className="primary" onClick={printRoadbook}>
                <Printer size={16} aria-hidden="true" />
                {t('Print roadbook')}
              </Button>
            ) : null}
          </div>
        </div>
      }
    >
      <div ref={shell} className={`export-shell export-shell--${mode}`}>
        <div className="export-panel">
          {mode === 'ai' ? (
            <AiRouteExport
              route={route}
              personalTime={personalTime}
              actionsContainer={actionsContainer}
            />
          ) : mode === 'image' ? (
            <RouteCardExport
              route={route}
              personalTime={personalTime}
              elevationGain={showElevation ? elevationGain : undefined}
              actionsContainer={actionsContainer}
            />
          ) : mode === 'roadbook' ? (
            <RouteBookExport
              route={route}
              personalTime={personalTime}
              showToolbar={false}
              onPrint={printRoadbook}
            />
          ) : (
            <>
              <div className="export-gpx-layout">
                <section className="export-gpx-preview" aria-label={t('Route preview')}>
                  <ExportRouteMap segments={route.segments} />
                  <dl className="export-gpx-hero-stats">
                    {heroDetails.map(([label, value]) => (
                      <div key={label}>
                        <dt>{label}</dt>
                        <dd>{value}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
                <div className="export-gpx-actions">
                  <form
                    id="export-gpx-form"
                    className="export-gpx-form"
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
                      <Input
                        id="export-filename"
                        ref={filenameInput}
                        required
                        maxLength={120}
                        value={filename}
                        aria-describedby="export-filename-hint"
                        onChange={(event) => setFilename(event.target.value)}
                      />
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
                  <dl className="export-gpx-technical" aria-label={t('Route details')}>
                    {technicalDetails.map(([label, value]) => (
                      <div key={label}>
                        <dt>{label}</dt>
                        <dd>{value}</dd>
                      </div>
                    ))}
                  </dl>
                  <div className="export-guide-stack">
                    <details className="export-guide">
                      <summary>
                        <span>{t('How to import into Komoot')}</span>
                        <ChevronDown size={18} aria-hidden="true" />
                      </summary>
                      <p className="muted export-copy">
                        {t('Import the downloaded file yourself. Roamlet does not send routes to Komoot.')}
                      </p>
                      <ol>
                        <li>{t('Download the GPX file above.')}</li>
                        <li>{t('In Komoot, open Profile → Saved routes → Import a GPS file.')}</li>
                        <li>
                          {t('Choose the downloaded file, import it as a planned route, and save.')}
                        </li>
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
                      <summary>
                        <span>{t('How to import into Strava')}</span>
                        <ChevronDown size={18} aria-hidden="true" />
                      </summary>
                      <p className="muted export-copy">
                        {t('Import the downloaded file yourself. Roamlet does not send routes to Strava.')}
                      </p>
                      <ol>
                        <li>{t('Download the GPX file above.')}</li>
                        <li>
                          {t('On the Strava website, open Dashboard → My Routes → Create New Route.')}
                        </li>
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
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}