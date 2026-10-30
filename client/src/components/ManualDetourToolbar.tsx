import { useTranslation } from 'react-i18next';
import { Button } from './ui/button';
import { formatNumber } from '../i18n';

export function ManualDetourToolbar({ section, canApply, canAdd, onApply, onCancel }: {
  section: number;
  canApply: boolean;
  canAdd: boolean;
  onApply: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="manual-detour-toolbar" role="group" aria-label={t('Draw a detour')}>
      <div className="manual-detour-copy">
        <strong>{t('Detour for section {{number}}', { number: formatNumber(section) })}</strong>
        <p role="status">{canAdd
          ? t('Click to add detour points. Endpoints stay fixed. Access is unverified.')
          : t('The 50-stop limit is reached. Move or remove a detour point, or finish.')}</p>
      </div>
      <div className="manual-detour-actions">
        <Button variant="outline" onClick={onCancel}>{t('Cancel')}</Button>
        <Button disabled={!canApply} onClick={onApply}>{t('Done')}</Button>
      </div>
    </div>
  );
}
