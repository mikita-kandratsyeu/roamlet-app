import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Info } from 'lucide-react';
import { Button } from './ui/button';
import { Dialog } from './Dialog';

export function RouteDescription({ description, name }: { description: string; name: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const previewId = useId();
  if (!description.trim()) return null;

  return (
    <>
      <Button
        variant="ghost"
        className="planner-route-description"
        aria-label={t('Read route description')}
        aria-describedby={previewId}
        title={t('Read route description')}
        onClick={() => setOpen(true)}
      >
        <span id={previewId} className="planner-route-description-preview">{description}</span>
        <Info size={18} aria-hidden="true" />
      </Button>
      {open && (
        <Dialog
          title={t('Route description')}
          description={name || undefined}
          compact
          onClose={() => setOpen(false)}
        >
          <p className="route-description-full">{description}</p>
        </Dialog>
      )}
    </>
  );
}
