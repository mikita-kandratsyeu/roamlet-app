import { useId, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import {
  coordinateError,
  coordinatePair,
  coordinateValue,
  type CoordinateField,
} from '../domain/coordinates';
import type { Coordinate } from '../domain/types';

export interface CoordinateInputHandle {
  focus: () => void;
  clear: () => void;
  setCoordinate: (coordinate: Coordinate) => void;
}

interface Props {
  ref?: Ref<CoordinateInputHandle>;
  replacing: boolean;
  onAdd: (coordinate: Coordinate) => void;
}

export function CoordinateInput({ ref, replacing, onAdd }: Props) {
  const { t } = useTranslation();
  const id = useId();
  const latitudeInput = useRef<HTMLInputElement>(null);
  const longitudeInput = useRef<HTMLInputElement>(null);
  const [values, setValues] = useState({ latitude: '', longitude: '' });
  const [errors, setErrors] = useState<Record<CoordinateField, string | null>>({
    latitude: null,
    longitude: null,
  });
  useImperativeHandle(
    ref,
    () => ({
      focus: () => latitudeInput.current?.focus(),
      setCoordinate: (coordinate) => {
        setValues({ latitude: String(coordinate[1]), longitude: String(coordinate[0]) });
        setErrors({ latitude: null, longitude: null });
      },
      clear: () => {
        setValues({ latitude: '', longitude: '' });
        setErrors({ latitude: null, longitude: null });
      },
    }),
    [],
  );

  function change(field: CoordinateField, value: string) {
    const pair = coordinatePair(value);
    if (pair) {
      setValues({ latitude: pair[0], longitude: pair[1] });
      setErrors({ latitude: null, longitude: null });
    } else {
      setValues((current) => ({ ...current, [field]: value }));
      setErrors((current) => ({ ...current, [field]: null }));
    }
  }

  return (
    <form
      className="coordinate-entry"
      aria-label={t(replacing ? 'Replace stop coordinates' : 'Enter coordinates')}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const next = {
          latitude: coordinateError(values.latitude, 'latitude'),
          longitude: coordinateError(values.longitude, 'longitude'),
        };
        setErrors(next);
        if (next.latitude || next.longitude) {
          (next.latitude ? latitudeInput : longitudeInput).current?.focus();
          return;
        }
        onAdd([coordinateValue(values.longitude)!, coordinateValue(values.latitude)!]);
        latitudeInput.current?.focus();
      }}
    >
      {replacing && <p className="coordinate-replacing">{t('Replace stop coordinates')}</p>}
      {(['latitude', 'longitude'] as const).map((field) => (
        <div className="coordinate-field" key={field}>
          <Label htmlFor={`${id}-${field}`}>
            {t(field === 'latitude' ? 'Latitude' : 'Longitude')}
          </Label>
          <Input
            ref={field === 'latitude' ? latitudeInput : longitudeInput}
            id={`${id}-${field}`}
            type="text"
            inputMode="text"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            dir="ltr"
            placeholder={field === 'latitude' ? '47.26000' : '11.40000'}
            value={values[field]}
            maxLength={200}
            aria-invalid={Boolean(errors[field])}
            aria-describedby={`${id}-help${errors[field] ? ` ${id}-${field}-error` : ''}`}
            onChange={(event) => change(field, event.target.value)}
            onBlur={() => {
              if (values[field].trim()) {
                setErrors((current) => ({
                  ...current,
                  [field]: coordinateError(values[field], field),
                }));
              }
            }}
            onPaste={(event) => {
              const pair = coordinatePair(event.clipboardData.getData('text'));
              if (!pair) return;
              event.preventDefault();
              setValues({ latitude: pair[0], longitude: pair[1] });
              setErrors({ latitude: null, longitude: null });
            }}
          />
          {errors[field] && (
            <p id={`${id}-${field}-error`} className="coordinate-error" role="alert">
              {t(errors[field])}
            </p>
          )}
        </div>
      ))}
      <Button
        className="coordinate-add"
        type="submit"
        variant="outline"
        aria-label={t(replacing ? 'Replace stop coordinates' : 'Add coordinates')}
        disabled={!values.latitude.trim() && !values.longitude.trim()}
      >
        <Plus size={16} aria-hidden="true" />
        {t(replacing ? 'Replace' : 'Add')}
      </Button>
      <p id={`${id}-help`} className="coordinate-help">
        {t('Paste a coordinate pair into either field. Add with Enter.')}
      </p>
    </form>
  );
}
