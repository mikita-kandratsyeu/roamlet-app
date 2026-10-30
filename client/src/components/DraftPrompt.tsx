import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from './Dialog';
import { Button } from './ui/button';
export function DraftPrompt({
  onDelete,
  onRestore,
  onDismiss,
}: {
  onDelete: () => void;
  onRestore: () => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const restore = useRef<HTMLButtonElement>(null);
  return (
    <Dialog
      title={t('Restore your draft?')}
      description={t('An unfinished route was found on this device.')}
      compact
      initialFocusRef={restore}
      onClose={onDismiss}
    >
      <div className="button-row dialog-actions">
        <Button className="secondary" variant="outline" onClick={onDelete}>
          {t('Delete draft')}
        </Button>
        <Button ref={restore} className="primary" onClick={onRestore}>
          {t('Restore draft')}
        </Button>
      </div>
    </Dialog>
  );
}
