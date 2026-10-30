import { useTranslation } from 'react-i18next';
import { Skeleton } from './ui/skeleton';

export function LibrarySkeleton() {
  const { t } = useTranslation();
  return (
    <div
      className="library-loading"
      role="status"
      aria-label={t('Opening your library…')}
      data-testid="library-skeleton"
    >
      <p className="library-loading-title">{t('Opening your library…')}</p>
      <p className="library-loading-description">{t('Reading routes saved in this browser.')}</p>
      <div className="library-list library-skeleton-list" aria-hidden="true">
        {Array.from({ length: 4 }, (_, index) => (
          <div className="library-route library-skeleton-card" key={index}>
            <Skeleton className="library-skeleton-icon" />
            <div className="library-skeleton-text">
              <Skeleton className="library-skeleton-title" />
              <Skeleton className="library-skeleton-meta" />
              <Skeleton className="library-skeleton-description" />
              <Skeleton className="library-skeleton-tag" />
            </div>
            <Skeleton className="library-skeleton-open" />
            <div className="library-skeleton-actions">
              <Skeleton />
              <Skeleton />
              <Skeleton />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
