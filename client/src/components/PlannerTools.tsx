import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';
import { Label } from './ui/label';
import { Input } from './ui/input';
import { useDecimalField } from '../hooks/useDecimalField';
import { PlannerChoice } from './PlannerChoice';
import {
  isFitness,
  isSurface,
  paceToSpeed,
  speedToPace,
  type Fitness,
  type Surface,
} from '../domain/time';
import type { Activity } from '../domain/types';

const fitnessLabels = { beginner: 'Beginner', regular: 'Regular', trained: 'Trained' };
const surfaceLabels = {
  unknown: 'Unknown surface',
  paved: 'Paved',
  mixed: 'Mixed surface',
  rough: 'Rough surface',
};
function TimeChoice({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Record<string, string>;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="personal-time-field">
      <span className="personal-time-label">{t(label)}</span>
      <PlannerChoice
        label={t(label)}
        value={value}
        selectedLabel={value === 'unknown' ? 'Unknown' : undefined}
        options={Object.entries(options).map(([key, text]) => ({ value: key, label: text }))}
        onChange={onChange}
        className="personal-time-choice"
        menuClassName="personal-time-menu"
      />
    </div>
  );
}
export function PlannerTools({
  speed,
  stops,
  onSpeed,
  onStops,
  contextKey,
  initiallyOpen = true,
  activity = 'cycling',
  fitness = 'regular',
  surface = 'unknown',
  onFitness = () => {},
  onSurface = () => {},
}: {
  speed: number;
  stops: number;
  onSpeed: (value: number) => void;
  onStops: (value: number) => void;
  contextKey?: string;
  initiallyOpen?: boolean;
  activity?: Activity;
  fitness?: Fitness;
  surface?: Surface;
  onFitness?: (value: Fitness) => void;
  onSurface?: (value: Surface) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(initiallyOpen);
  const hiking = activity === 'hiking';
  const { invalid: speedInvalid, ...speedField } = useDecimalField(
    hiking ? (speedToPace(speed) ?? speed) : speed,
    (value) => onSpeed(hiking ? paceToSpeed(value)! : value),
    false,
    contextKey,
    (value) => !hiking || paceToSpeed(value) !== null,
  );
  const { invalid: stopsInvalid, ...stopsField } = useDecimalField(
    stops,
    onStops,
    true,
    contextKey,
  );
  return (
    <details
      className="personal-time-section planner-disclosure"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="section-heading personal-time-heading">
        <span>{t('Personal time')}</span>
        <span className="disclosure-toggle" aria-hidden="true">
          <ChevronDown size={18} />
        </span>
      </summary>
      <div className="personal-time-fields">
        <div className="personal-time-row" data-errors={speedInvalid || stopsInvalid || undefined}>
          <div className="personal-time-field">
            <Label htmlFor="personal-speed">
              {t(hiking ? 'Walking pace (min/km)' : 'Personal speed (km/h)')}
            </Label>
            <Input
              id="personal-speed"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              aria-invalid={speedInvalid || undefined}
              aria-describedby={speedInvalid ? 'personal-speed-error' : 'personal-pace-help'}
              {...speedField}
            />
            {speedInvalid && (
              <p
                id="personal-speed-error"
                className="personal-time-error text-xs font-normal leading-[18px] text-destructive"
                role="alert"
              >
                {t(
                  hiking
                    ? 'Enter a pace greater than 0.'
                    : 'Enter a finite speed greater than zero.',
                )}
              </p>
            )}
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
            {stopsInvalid && (
              <p
                id="stops-minutes-error"
                className="personal-time-error text-xs font-normal leading-[18px] text-destructive"
                role="alert"
              >
                {t('Enter a finite stop duration of zero or more.')}
              </p>
            )}
          </div>
        </div>
        <div className="personal-time-row">
          <TimeChoice
            label="Fitness level"
            value={fitness}
            options={fitnessLabels}
            onChange={(value) => {
              if (isFitness(value)) onFitness(value);
            }}
          />
          <TimeChoice
            label="Surface"
            value={surface}
            options={surfaceLabels}
            onChange={(value) => {
              if (isSurface(value)) onSurface(value);
            }}
          />
        </div>
      </div>
      <p id="personal-pace-help" className="personal-time-help">
        {t('Use your measured flat-ground average; fitness affects climbing and range.')}
      </p>
      <p className="personal-time-help">
        {t(
          surface === 'unknown'
            ? 'Unknown surface widens the range and is saved with this route. Terrain is not detected.'
            : 'This surface is saved with the route. It is your choice, not detected from the map.',
        )}
      </p>
    </details>
  );
}
