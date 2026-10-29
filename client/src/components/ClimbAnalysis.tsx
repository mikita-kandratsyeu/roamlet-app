import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';
import { Badge } from './ui/badge';
import { analyzeClimbs, CLIMB_THRESHOLDS } from '../domain/climbs';
import type { Coordinate, PlannedRoute } from '../domain/types';
import './ClimbAnalysis.css';
import './disclosures.css';

export interface ClimbAnalysisProps {
  route: PlannedRoute | null;
  /** Parent owns map rendering; an empty array clears the highlight. */
  onHighlight?: (geometry: Coordinate[][]) => void;
}

export function ClimbAnalysis({ route, onHighlight }: ClimbAnalysisProps) {
  const { t, i18n } = useTranslation();
  const headingId = useId();
  const explanationId = useId();
  const analysis = useMemo(() => analyzeClimbs(route), [route]);
  const [selection, setSelection] = useState<{ analysis: typeof analysis; index: number } | null>(
    null,
  );
  const selectedIndex = selection?.analysis === analysis ? selection.index : null;
  const highlightRef = useRef(onHighlight);
  useEffect(() => {
    highlightRef.current = onHighlight;
  }, [onHighlight]);
  useEffect(() => {
    highlightRef.current?.([]);
    return () => highlightRef.current?.([]);
  }, [analysis]);
  const number = (value: number, digits = 0) =>
    new Intl.NumberFormat(i18n.resolvedLanguage || i18n.language, {
      maximumFractionDigits: digits,
    }).format(value);
  const metres = (value: number) => t('{{value}} m', { value: number(value) });

  return (
    <section
      className="climb-analysis"
      aria-labelledby={headingId}
      aria-describedby={explanationId}
    >
      <header className="section-heading climb-analysis__header">
        <h2 id={headingId}>{t('Climb analysis')}</h2>
        <Badge id={explanationId} variant="secondary">
          {t('≥{{length}} m · ≥{{ascent}} m gain', {
            length: number(CLIMB_THRESHOLDS.minimumLengthMeters),
            ascent: number(CLIMB_THRESHOLDS.minimumAscentMeters),
          })}
        </Badge>
      </header>
      {!analysis.available ? (
        <p className="fine-print">
          {t('Climb analysis unavailable: complete GPX or marked ORS heights required.')}
        </p>
      ) : (
        <>
          {analysis.climbs.length === 0 ? (
            <p className="fine-print">{t('No sustained climbs found.')}</p>
          ) : (
            <ol className="climb-analysis__list">
              {analysis.climbs.map((climb, index) => (
                <li key={`${climb.segmentIndex}-${climb.startDistanceMeters}`}>
                  <button
                    type="button"
                    className="climb-analysis__item"
                    aria-pressed={selectedIndex === index}
                    onClick={() => {
                      const deselect = selectedIndex === index;
                      setSelection(deselect ? null : { analysis, index });
                      onHighlight?.(deselect ? [] : climb.geometry);
                    }}
                  >
                    <strong>{t('Climb {{number}}', { number: number(index + 1) })}</strong>
                    <span>
                      {t('Route interval')}: {metres(climb.startDistanceMeters)}–
                      {metres(climb.endDistanceMeters)}
                    </span>
                    <span>
                      {t('Length')}: {metres(climb.lengthMeters)}
                    </span>
                    <span>
                      {t('Filtered ascent (net gain)')}: {metres(climb.ascentMeters)}
                    </span>
                    <span>
                      {t('Average grade (net gain / length)')}:{' '}
                      {number(climb.averageGradePercent, 1)}%
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
      <details className="planner-disclosure climb-analysis__help">
        <summary className="section-heading">
          <span>{t('How climbs are detected')}</span>
          <span className="disclosure-toggle" aria-hidden="true">
            <ChevronDown size={18} />
          </span>
        </summary>
        <p className="fine-print">
          {t(
            'Drops over {{tolerance}} m split climbs; smaller drops are ignored. Internal flats count, edge flats do not. Segment gaps and stationary points split climbs.',
            { tolerance: number(CLIMB_THRESHOLDS.descentToleranceMeters) },
          )}
        </p>
        {analysis.available && analysis.elevationSource === 'openrouteservice' && (
          <p className="fine-print">
            {t('ORS terrain heights are estimates, not measured trail elevations.')}
          </p>
        )}
      </details>
    </section>
  );
}
