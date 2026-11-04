import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Info } from 'lucide-react';
import { Dialog } from './Dialog';
import { Button } from './ui/button';
import './DisclaimerDialog.css';

export function DisclaimerDialog({ onAcknowledge }: { onAcknowledge: () => void }) {
  const { t } = useTranslation();
  const confirm = useRef<HTMLButtonElement>(null);
  return (
    <Dialog
      title={t('Before you plan')}
      compact
      dismissible={false}
      onClose={() => {}}
      initialFocusRef={confirm}
      footer={
        <div className="button-row dialog-actions">
          <Button ref={confirm} className="primary" onClick={onAcknowledge}>
            {t('Understood')}
          </Button>
        </div>
      }
    >
      <aside className="disclaimer-notice" role="note">
        <Info size={20} aria-hidden="true" />
        <p>
          {t(
            'Routes do not guarantee safety or access. Check restrictions, weather and trail conditions yourself. Travel times and elevations are approximate. Full details are available in Help.',
          )}
        </p>
      </aside>
    </Dialog>
  );
}
