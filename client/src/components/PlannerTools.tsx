import { useTranslation } from 'react-i18next';
import { Button } from './ui/button';
import { Label } from './ui/label';
import { Input } from './ui/input';
export function PlannerTools({ canUndo, canRedo, onUndo, onRedo, speed, stops, onSpeed, onStops }: {
  canUndo: boolean; canRedo: boolean; onUndo: () => void; onRedo: () => void;
  speed: number; stops: number; onSpeed: (value: number) => void; onStops: (value: number) => void;
}) {
  const { t } = useTranslation();
  return <>
    <div className="button-row"><Button variant="outline" disabled={!canUndo} onClick={onUndo}>{t('Undo')}</Button><Button variant="outline" disabled={!canRedo} onClick={onRedo}>{t('Redo')}</Button></div>
    <div className="time-settings">
      <Label htmlFor="personal-speed">{t('Personal speed (km/h)')}</Label>
      <Input id="personal-speed" type="number" min="0.1" step="0.1" value={speed} onChange={event => {
        const n = Number(event.target.value); if (event.target.value && Number.isFinite(n) && n > 0) onSpeed(n);
      }} />
      <Label htmlFor="stops-minutes">{t('Stops (minutes)')}</Label>
      <Input id="stops-minutes" type="number" min="0" step="1" value={stops} onChange={event => {
        const n = Number(event.target.value); if (event.target.value && Number.isFinite(n) && n >= 0) onStops(n);
      }} />
    </div>
  </>;
}
