import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Info } from 'lucide-react';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Dialog } from './Dialog';

export function RouteDescription({ description, name, tags = [] }: {
  description: string;
  name: string;
  tags?: string[];
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const previewId = useId();
  const hasDescription = !!description.trim();
  if (!hasDescription && !tags.length) return null;

  return (
    <>
      {hasDescription && <Button
        variant="ghost"
        className="planner-route-description"
        aria-label={t('Read route description')}
        aria-describedby={previewId}
        title={t('Read route description')}
        onClick={() => setOpen(true)}
      >
        <span id={previewId} className="planner-route-description-preview">{description}</span>
        <Info size={18} aria-hidden="true" />
      </Button>}
      {!!tags.length && (
        <Button
          variant="ghost"
          className="planner-route-tags"
          aria-label={t('View all route tags')}
          title={t('View all route tags')}
          onClick={() => setOpen(true)}
        >
          {tags.slice(0, 3).map((tag, index) => (
            <Badge key={`${index}:${tag}`} variant="secondary" className="planner-route-tag" title={tag} aria-hidden="true">
              <span className="planner-route-tag-label">{tag}</span>
            </Badge>
          ))}
          {tags.length > 3 && (
            <Badge variant="secondary" className="planner-route-tag planner-route-tag-overflow" aria-hidden="true">
              +{tags.length - 3}
            </Badge>
          )}
        </Button>
      )}
      {open && (
        <Dialog
          title={t(hasDescription ? 'Route description' : 'Route details')}
          description={name || undefined}
          compact
          onClose={() => setOpen(false)}
        >
          {hasDescription && <p className="route-description-full">{description}</p>}
          {!!tags.length && (
            <section className="route-full-tags-section" aria-label={t('Tags')}>
              <h3>{t('Tags')}</h3>
              <ul className="route-full-tags">
                {tags.map((tag, index) => (
                  <li key={`${index}:${tag}`}><Badge variant="secondary">{tag}</Badge></li>
                ))}
              </ul>
            </section>
          )}
        </Dialog>
      )}
    </>
  );
}
