import { useTranslation } from 'react-i18next';
import { ChevronDown, Clock3 } from 'lucide-react';
import { Label } from './ui/label';
import { Input } from './ui/input';
import { useDecimalField } from '../hooks/useDecimalField';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from './ui/dropdown-menu';
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
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="personal-time-choice" aria-label={t(label)}>
            <span>{t(options[value])}</span>
            <ChevronDown size={14} aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="personal-time-menu">
          <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
            {Object.entries(options).map(([key, text]) => (
              <DropdownMenuRadioItem key={key} value={key}>
                {t(text)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
export function PlannerTools({
  speed,
  stops,
  onSpeed,
  onStops,
  contextKey,
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
  activity?: Activity;
  fitness?: Fitness;
  surface?: Surface;
  onFitness?: (value: Fitness) => void;
  onSurface?: (value: Surface) => void;
}) {
  const { t } = useTranslation();
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
          <p
            id="personal-speed-error"
            className="personal-time-error text-xs font-normal leading-[18px] text-destructive"
            role={speedInvalid ? 'alert' : undefined}
            aria-hidden={!speedInvalid}
          >
            {speedInvalid
              ? t(
                  hiking
                    ? 'Enter a pace greater than 0.'
                    : 'Enter a finite speed greater than zero.',
                )
              : '\u00a0'}
          </p>
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
          <p
            id="stops-minutes-error"
            className="personal-time-error text-xs font-normal leading-[18px] text-destructive"
            role={stopsInvalid ? 'alert' : undefined}
            aria-hidden={!stopsInvalid}
          >
            {stopsInvalid ? t('Enter a finite stop duration of zero or more.') : '\u00a0'}
          </p>
        </div>
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
      <p id="personal-pace-help" className="personal-time-help">
        {t(
          'Use your normal flat-ground average. Fitness adjusts climbing and uncertainty, not this measured pace.',
        )}
      </p>
      <p className="personal-time-help">
        {t(
          surface === 'unknown'
            ? 'Surface is unknown: no surface penalty applied; the range is wider.'
            : 'Surface is your choice, not detected from the route.',
        )}
      </p>
    </details>
  );
}
