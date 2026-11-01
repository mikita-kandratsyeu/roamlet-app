import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ChevronDown, Scan, X } from 'lucide-react';
import type { PlannedRoute } from '../domain/types';
import { formatDistance } from '../domain/format';
import { translateMessage } from '../i18n';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
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
        <header className="comparison-screen-header">
          <Button
            ref={back}
            variant="ghost"
            onClick={onClose}
            aria-label={t('Back to routes')}
            title={t('Back to routes')}
          >
            <ArrowLeft size={20} aria-hidden="true" />
            <span className="comparison-screen-back-label">{t('Back to routes')}</span>
          </Button>
          <DialogTitle aria-label={t('Compare saved routes')}>
            <span className="comparison-screen-desktop-title">{t('Compare saved routes')}</span>
            <span className="comparison-screen-mobile-title">{t('Compare routes')}</span>
          </DialogTitle>
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
              <Button
                variant="ghost"
                aria-expanded={expanded}
                aria-controls="comparison-screen-details"
                onClick={() => setExpanded((value) => !value)}
              >
                {t(expanded ? 'Hide comparison panel' : 'Show comparison panel')}
                <ChevronDown size={18} aria-hidden="true" />
              </Button>
              <Button variant="outline" onClick={showAll}>
                <Scan size={18} aria-hidden="true" />
                {t('Show all routes')}
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
              <ul className="comparison-screen-routes" aria-label={t('Route colors')}>
                {routes.map((route, index) => {
                  const visible = !hiddenIds.includes(route.id);
                  return (
                    <li key={route.id}>
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
                          className="route-comparison-color"
                          style={{ backgroundColor: ROUTE_COMPARISON_COLORS[index] }}
                          aria-hidden="true"
                        />
                        <span>
                          <strong>
                            {index + 1}. {route.name}
                          </strong>
                          <small>
                            {Number.isFinite(route.stats.distance) && route.stats.distance >= 0
                              ? formatDistance(route.stats.distance)
                              : t('Not available')}
                          </small>
                        </span>
                      </Button>
                      <label className="comparison-screen-visibility">
                        <input
                          type="checkbox"
                          checked={visible}
                          disabled={visible && visibleRoutes.length === 1}
                          aria-label={t('Show route {{name}} on map', { name: route.name })}
                          onChange={() => {
                            setHiddenIds((ids) =>
                              visible ? [...ids, route.id] : ids.filter((id) => id !== route.id),
                            );
                            if (focusedId === route.id) {
                              setFocusedId(null);
                              setFitToken((token) => token + 1);
                            }
                          }}
                        />
                      </label>
                    </li>
                  );
                })}
              </ul>
              <details className="comparison-screen-statistics">
                <summary>{t('Route statistics')}</summary>
                <RouteComparison routes={routes} />
              </details>
            </div>
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  );
}
