import { useTranslation } from 'react-i18next';
import { ChevronDown, Clock3 } from 'lucide-react';
import { Label } from './ui/label';
import { Input } from './ui/input';
import { useDecimalField } from '../hooks/useDecimalField';
export function PlannerTools({
  speed,
  stops,
  onSpeed,
  onStops,
  contextKey,
}: {
  speed: number;
  stops: number;
  onSpeed: (value: number) => void;
  onStops: (value: number) => void;
  contextKey?: string;
}) {
  const { t } = useTranslation();
  const { invalid: speedInvalid, ...speedField } = useDecimalField(speed, onSpeed, false, contextKey);
  const { invalid: stopsInvalid, ...stopsField } = useDecimalField(stops, onStops, true, contextKey);
  return (
    <details className="personal-time-section" open>
      <summary className="section-heading personal-time-heading">
        <span>
          <Clock3 size={16} aria-hidden="true" />
          {t('Personal time')}
        </span>
        <ChevronDown className="personal-time-toggle" size={16} aria-hidden="true" />
      </summary>
      <div className="personal-time-fields">
        <div className="personal-time-field">
          <Label htmlFor="personal-speed">{t('Personal speed (km/h)')}</Label>
          <Input
            id="personal-speed"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            aria-invalid={speedInvalid || undefined}
            aria-describedby={speedInvalid ? 'personal-speed-error' : undefined}
            {...speedField}
          />
          {speedInvalid && <p id="personal-speed-error" className="personal-time-error" role="alert">{t('Enter a finite speed greater than zero.')}</p>}
        </div>
        <div className="personal-time-field">
          <Label htmlFor="stops-minutes">{t('Stops (minutes)')}</Label>
          <Input
            id="stops-minutes"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            aria-invalid={stopsInvalid || undefined}
            aria-describedby={stopsInvalid ? 'stops-minutes-error' : undefined}
            {...stopsField}
          />
          {stopsInvalid && <p id="stops-minutes-error" className="personal-time-error" role="alert">{t('Enter a finite stop duration of zero or more.')}</p>}
        </div>
      </div>
    </details>
  );
}
