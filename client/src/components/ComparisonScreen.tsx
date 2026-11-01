import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  Bike,
  ChevronDown,
  Eye,
  EyeOff,
  Footprints,
  PanelRightClose,
  PanelRightOpen,
  Route as RouteIcon,
  Scan,
  Table2,
  X,
} from 'lucide-react';
import type { PlannedRoute } from '../domain/types';
import { formatDistance, formatDuration } from '../domain/format';
import { translateMessage } from '../i18n';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import './Library.css';
import { RouteMap } from './RouteMap';
import { RouteComparison, ROUTE_COMPARISON_COLORS } from './RouteComparison';
import './ComparisonMap.css';
import './ComparisonScreen.css';

export function ComparisonScreen({
  routes,
  online,
  onClose,
}: {
  routes: PlannedRoute[];
  online: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const previous = useRef<HTMLElement | null>(null);
  const back = useRef<HTMLButtonElement>(null);
  const [hiddenIds, setHiddenIds] = useState<string[]>([]);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [fitToken, setFitToken] = useState(1);
  const [expanded, setExpanded] = useState(true);
  const [error, setError] = useState('');
  const visibleRoutes = routes.filter((route) => !hiddenIds.includes(route.id));
  const segments = useMemo(
    () =>
      routes.filter((route) => !hiddenIds.includes(route.id)).flatMap((route) => route.segments),
    [routes, hiddenIds],
  );
  const layers = useMemo(
    () =>
      routes
        .map((route, index) => ({ route, index }))
        .sort((a, b) => Number(a.route.id === focusedId) - Number(b.route.id === focusedId))
        .flatMap(({ route, index }) => {
          if (hiddenIds.includes(route.id)) return [];
          const direct = route.source === 'manual' ? route.segments : (route.directSegments ?? []);
          const directKeys = new Set(direct.map((segment) => JSON.stringify(segment)));
          return [
            {
              segments: route.segments.filter(
                (segment) => !directKeys.has(JSON.stringify(segment)),
              ),
              color: ROUTE_COMPARISON_COLORS[index],
            },
            { segments: direct, color: ROUTE_COMPARISON_COLORS[index], dashed: true },
          ];
        }),
    [routes, hiddenIds, focusedId],
  );
  const fitSegments = focusedId
    ? routes.find((route) => route.id === focusedId)?.segments
    : visibleRoutes.flatMap((route) => route.segments);

  function showAll() {
    setHiddenIds([]);
    setFocusedId(null);
    setFitToken((token) => token + 1);
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="comparison-screen"
        showCloseButton={false}
        aria-describedby={undefined}
        onOpenAutoFocus={(event) => {
          previous.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
          event.preventDefault();
          back.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (previous.current?.isConnected) previous.current.focus({ preventScroll: true });
        }}
      >
        <header className="library-screen-header comparison-screen-header">
          <div className="library-screen-heading">
            <RouteIcon size={22} aria-hidden="true" />
            <DialogTitle asChild aria-label={t('Compare saved routes')}>
              <h1>
                <span className="comparison-screen-desktop-title">{t('Compare saved routes')}</span>
                <span className="comparison-screen-mobile-title">{t('Compare routes')}</span>
              </h1>
            </DialogTitle>
          </div>
          <Button
            ref={back}
            variant="ghost"
            className="back-to-map-button"
            onClick={onClose}
            aria-label={t('Back to routes')}
            title={t('Back to routes')}
          >
            <ArrowLeft size={18} aria-hidden="true" />
            <span className="comparison-screen-back-label">{t('Back to routes')}</span>
          </Button>
        </header>
        <div className={`comparison-screen-workspace${expanded ? '' : ' panel-collapsed'}`}>
          <div className="comparison-map">
            <RouteMap
              online={online}
              segments={segments}
              comparisonLayers={layers}
              fitSegments={fitSegments}
              comparisonMode
              waypoints={[]}
              editable={false}
              plannerHidden
              fitToken={fitToken}
              onAdd={() => {}}
              onMove={() => {}}
              onError={setError}
            />
          </div>
          <aside className="comparison-screen-panel" aria-label={t('Comparison controls')}>
            <div className="comparison-screen-panel-header">
              <div className="comparison-screen-panel-title">
                <h2>{t('Routes to compare')}</h2>
                <Badge variant="secondary">{routes.length}</Badge>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="comparison-screen-collapse"
                aria-label={t(expanded ? 'Hide comparison panel' : 'Show comparison panel')}
                title={t(expanded ? 'Hide comparison panel' : 'Show comparison panel')}
                aria-expanded={expanded}
                aria-controls="comparison-screen-details"
                onClick={() => setExpanded((value) => !value)}
              >
                {expanded ? (
                  <PanelRightClose
                    className="comparison-screen-desktop-toggle"
                    size={18}
                    aria-hidden="true"
                  />
                ) : (
                  <PanelRightOpen
                    className="comparison-screen-desktop-toggle"
                    size={18}
                    aria-hidden="true"
                  />
                )}
                <ChevronDown
                  className="comparison-screen-mobile-toggle"
                  size={18}
                  aria-hidden="true"
                />
              </Button>
            </div>
            <div className="comparison-screen-panel-actions">
              <Button
                variant="outline"
                className="comparison-screen-overview"
                onClick={showAll}
                aria-label={t('Show all routes')}
                title={t('Show all routes')}
              >
                <Scan size={18} aria-hidden="true" />
                <span className="comparison-screen-overview-label">{t('Show all routes')}</span>
              </Button>
            </div>
            {error && (
              <div role="alert" className="comparison-screen-error">
                <span>{translateMessage(error)}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t('Dismiss map notice')}
                  onClick={() => setError('')}
                >
                  <X size={18} aria-hidden="true" />
                </Button>
              </div>
            )}
            <div
              id="comparison-screen-details"
              className="comparison-screen-details"
              hidden={!expanded}
            >
              <p className="comparison-screen-hint">
                {t('Select a route to focus it. Use the eye to show or hide it on the map.')}
              </p>
              <ul className="comparison-screen-routes" aria-label={t('Routes to compare')}>
                {routes.map((route, index) => {
                  const visible = !hiddenIds.includes(route.id);
                  const ActivityIcon = route.activity === 'cycling' ? Bike : Footprints;
                  return (
                    <li
                      key={route.id}
                      className="comparison-screen-card"
                      data-focused={focusedId === route.id}
                      data-visible={visible}
                      style={{ borderInlineStartColor: ROUTE_COMPARISON_COLORS[index] }}
                    >
                      <div className="comparison-screen-card-header">
                        <Button
                          variant="ghost"
                          className="comparison-screen-route"
                          aria-pressed={focusedId === route.id}
                          aria-label={t('Focus route {{name}}', { name: route.name })}
                          onClick={() => {
                            setHiddenIds((ids) => ids.filter((id) => id !== route.id));
                            setFocusedId(route.id);
                            setFitToken((token) => token + 1);
                          }}
                        >
                          <span
                            className="comparison-screen-route-number"
                            style={{ backgroundColor: ROUTE_COMPARISON_COLORS[index] }}
                            aria-hidden="true"
                          >
                            {index + 1}
                          </span>
                          <span className="comparison-screen-route-name">
                            <strong>{route.name}</strong>
                            <small>
                              <ActivityIcon size={14} aria-hidden="true" />
                              {t(route.activity === 'cycling' ? 'Cycling' : 'Hiking')}
                            </small>
                          </span>
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          role="checkbox"
                          aria-checked={visible}
                          className="comparison-screen-visibility"
                          disabled={visible && visibleRoutes.length === 1}
                          aria-label={t('Show route {{name}} on map', { name: route.name })}
                          title={
                            visible && visibleRoutes.length === 1
                              ? t('Keep at least one route visible.')
                              : t(
                                  visible
                                    ? 'Hide route {{name}} on map'
                                    : 'Show route {{name}} on map',
                                  { name: route.name },
                                )
                          }
                          onClick={() => {
                            setHiddenIds((ids) =>
                              visible ? [...ids, route.id] : ids.filter((id) => id !== route.id),
                            );
                            if (focusedId === route.id) {
                              setFocusedId(null);
                              setFitToken((token) => token + 1);
                            }
                          }}
                        >
                          {visible ? (
                            <Eye size={18} aria-hidden="true" />
                          ) : (
                            <EyeOff size={18} aria-hidden="true" />
                          )}
                        </Button>
                      </div>
                      <dl className="comparison-screen-card-metrics">
                        <div>
                          <dt>{t('Distance')}</dt>
                          <dd>
                            {Number.isFinite(route.stats.distance) && route.stats.distance >= 0
                              ? formatDistance(route.stats.distance)
                              : t('Not available')}
                          </dd>
                        </div>
                        <div>
                          <dt>{t('Original duration')}</dt>
                          <dd>
                            {Number.isFinite(route.stats.duration) && route.stats.duration > 0
                              ? formatDuration(route.stats.duration)
                              : t('Not available')}
                          </dd>
                        </div>
                      </dl>
                    </li>
                  );
                })}
              </ul>
              <details className="comparison-screen-statistics">
                <summary>
                  <Table2 size={18} aria-hidden="true" />
                  <span>{t('Route statistics')}</span>
                  <ChevronDown size={18} aria-hidden="true" />
                </summary>
                <RouteComparison routes={routes} />
              </details>
            </div>
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  );
}
