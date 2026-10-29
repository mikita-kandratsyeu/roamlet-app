import { useTranslation } from 'react-i18next';
import { ChevronDown, Clock3 } from 'lucide-react';
import { Label } from './ui/label';
import { Input } from './ui/input';
export function PlannerTools({
  speed,
  stops,
  onSpeed,
  onStops,
}: {
  speed: number;
  stops: number;
  onSpeed: (value: number) => void;
  onStops: (value: number) => void;
}) {
  const { t } = useTranslation();
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
            type="number"
            min="0.1"
            step="0.1"
            value={speed}
            onChange={(event) => {
              const n = Number(event.target.value);
              if (event.target.value && Number.isFinite(n) && n > 0) onSpeed(n);
            }}
          />
        </div>
        <div className="personal-time-field">
          <Label htmlFor="stops-minutes">{t('Stops (minutes)')}</Label>
          <Input
            id="stops-minutes"
            type="number"
            min="0"
            step="1"
            value={stops}
            onChange={(event) => {
              const n = Number(event.target.value);
              if (event.target.value && Number.isFinite(n) && n >= 0) onStops(n);
            }}
          />
        </div>
      </div>
    </details>
  );
}
