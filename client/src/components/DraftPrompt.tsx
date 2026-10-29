import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from './Dialog';
import { Button } from './ui/button';
export function DraftPrompt({ onDelete, onRestore }: { onDelete: () => void; onRestore: () => void }) {
  const { t } = useTranslation();
  const restore = useRef<HTMLButtonElement>(null);
  return <Dialog title={t('Restore your draft?')} initialFocusRef={restore} onClose={() => {}}>
    <p>{t('An unfinished route was found on this device.')}</p>
    <div className="button-row"><Button variant="outline" onClick={onDelete}>{t('Delete draft')}</Button><Button ref={restore} onClick={onRestore}>{t('Restore draft')}</Button></div>
  </Dialog>;
}
