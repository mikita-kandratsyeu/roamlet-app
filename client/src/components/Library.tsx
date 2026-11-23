import { toast } from 'sonner';
import { Button } from './ui/button';
import { Notification } from './Notification';
import { Badge } from './ui/badge';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Label } from './ui/label';
import './Library.css';
import { LibrarySkeleton } from './LibrarySkeleton';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from './ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { useTranslation } from 'react-i18next';
import { useEffect, useId, useRef, useState } from 'react';
import {
  Search,
  Copy,
  Trash2,
  Pencil,
  FolderHeart,
  ArrowDownWideNarrow,
  ChevronDown,
  MoreHorizontal,
  ArrowUpRight,
  Upload,
  Download,
  Star,
  SlidersHorizontal,
  ArrowLeft,
  ArrowLeftRight,
  X,
} from 'lucide-react';

import type { PlannedRoute } from '../domain/types';
import { isValidComparisonSelection, MAX_COMPARISON_ROUTES } from '../domain/comparison';
import { listRoutes, saveRoute, deleteRoute, duplicateRoute } from '../domain/storage';
import { formatDistance } from '../domain/format';
import { loadPreferences, savePreferences } from '../domain/preferences';
import {
  exportBackup,
  importBackup,
  readBackupFile,
  type RouteBackup,
  type ConflictMode,
} from '../domain/backup';
import { thumbnailPaths } from './routeThumbnail';
import { Dialog } from './Dialog';
import { ROUTE_COMPARISON_COLORS } from './RouteComparison';
import { locale, translateMessage } from '../i18n';

const MAX_VISIBLE_ROUTE_TAGS = 3;

function RouteThumbnail({ route }: { route: PlannedRoute }) {
  return (
    <span className="library-activity-icon">
      <svg className="library-thumbnail" viewBox="0 0 64 64" aria-hidden="true">
        {thumbnailPaths(route.segments).map((path, index) => (
          <path key={index} d={path} />
        ))}
      </svg>
    </span>
  );
}

function RouteCardDetails({ route }: { route: PlannedRoute }) {
  const { t } = useTranslation();
  const tags = route.tags ?? [];
  const updated = new Date(route.updatedAt);
  const description = route.description.trim();
  return (
    <>
      <strong className="library-route-title" title={route.name}>
        {route.name}
      </strong>
      <span className="library-route-facts">
        <span className="library-route-meta">
          <span className="library-activity">
            {route.activity === 'cycling' ? t('Cycling') : t('Hiking')}
          </span>
          <span className="library-distance">{formatDistance(route.stats.distance)}</span>
        </span>
        <time
          className="library-updated"
          dateTime={route.updatedAt}
          title={t('Updated {{date}}', {
            date: updated.toLocaleDateString(locale()),
          })}
        >
          {updated.toLocaleDateString(locale(), { day: 'numeric', month: 'short' })}
        </time>
      </span>
      {tags.length > 0 && (
        <span className="library-route-tags" title={tags.join(' · ')}>
          <span className="library-route-tags-accessible">{tags.join(', ')}</span>
          {tags.slice(0, MAX_VISIBLE_ROUTE_TAGS).map((tag, index) => (
            <Badge
              key={`${index}:${tag}`}
              variant="secondary"
              className="library-route-tag"
              title={tag}
              aria-hidden="true"
            >
              <span className="library-route-tag-label">{tag}</span>
            </Badge>
          ))}
          {tags.length > MAX_VISIBLE_ROUTE_TAGS && (
            <Badge
              variant="secondary"
              className="library-route-tag library-route-tag-overflow"
              title={tags.slice(MAX_VISIBLE_ROUTE_TAGS).join(', ')}
              aria-hidden="true"
            >
              +{tags.length - MAX_VISIBLE_ROUTE_TAGS}
            </Badge>
          )}
        </span>
      )}
      {description && (
        <span className="route-description" title={route.description}>
          {route.description}
        </span>
      )}
    </>
  );
}

type RouteSort = 'updated' | 'name' | 'distance';
const sortLabels: Record<RouteSort, string> = {
  updated: 'Most recently updated',
  name: 'Name (A–Z)',
  distance: 'Distance (shortest first)',
};

function LibraryChoice({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="library-filter-field">
      <span className="library-field-label">{label}</span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            className="library-choice"
            disabled={disabled}
            aria-label={label}
          >
            <span>{options.find((option) => option.value === value)?.label ?? value}</span>
            <ChevronDown size={14} aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="library-sort-menu">
          <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
            {options.map((option) => (
              <DropdownMenuRadioItem key={option.value} value={option.value}>
                {option.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function Library({
  onClose,
  onOpen,
  onCompare,
}: {
  onClose: () => void;
  onOpen: (route: PlannedRoute) => void;
  onCompare?: (routes: PlannedRoute[]) => void;
}) {
  const { t } = useTranslation();
  const [routes, setRoutes] = useState<PlannedRoute[]>([]);
  const [comparisonIds, setComparisonIds] = useState<string[]>([]);
  const comparisonHelpId = useId();
  // Resolve from the full library, not filtered cards, so edits and hidden selections stay current.
  const comparisonRoutes = comparisonIds.flatMap((id) => {
    const route = routes.find((route) => route.id === id);
    return route ? [route] : [];
  });
  useEffect(() => {
    setComparisonIds((ids) => ids.filter((id) => routes.some((route) => route.id === id)));
  }, [routes]);
  function toggleComparison(id: string) {
    setComparisonIds((ids) =>
      ids.includes(id)
        ? ids.filter((selected) => selected !== id)
        : ids.length < MAX_COMPARISON_ROUTES
          ? [...ids, id]
          : ids,
    );
  }
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const actionLocked = useRef(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loadFailed, setLoadFailed] = useState(false);
  const [filters, setFilters] = useState(() => loadPreferences().library);
  const { sort, query, activity, favoriteOnly, tag, minKm, maxKm } = filters;
  function updateFilters(patch: Partial<typeof filters>) {
    setFilters((current) => ({ ...current, ...patch }));
  }
  const setSort = (sort: RouteSort) => updateFilters({ sort });
  const setQuery = (query: string) => updateFilters({ query });
  function resetFilters() {
    setFilters({
      sort: 'updated',
      query: '',
      activity: 'all',
      favoriteOnly: false,
      tag: '',
      minKm: '',
      maxKm: '',
    });
  }
  useEffect(() => {
    savePreferences({ library: filters });
  }, [filters]);
  const [invalidCount, setInvalidCount] = useState(0);
  const [backup, setBackup] = useState<RouteBackup | null>(null);
  const [conflictMode, setConflictMode] = useState<ConflictMode>('copy');
  const [tags, setTags] = useState('');
  const [favorite, setFavorite] = useState(false);
  const hasFilters = !!(
    query.trim() ||
    activity !== 'all' ||
    favoriteOnly ||
    tag ||
    minKm ||
    maxKm
  );
  const advancedFilterCount = [activity !== 'all', !!tag, !!minKm, !!maxKm].filter(Boolean).length;
  const editTitleId = useId();
  const deleteTitleId = useId();
  const screenDescriptionId = useId();
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<PlannedRoute | null>(null);
  const [deleting, setDeleting] = useState<PlannedRoute | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const searchInput = useRef<HTMLInputElement>(null);
  const backButton = useRef<HTMLButtonElement>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const importCancel = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );
  const editInput = useRef<HTMLInputElement>(null);
  const keepButton = useRef<HTMLButtonElement>(null);
  const actionTrigger = useRef<HTMLButtonElement | null>(null);
  const restoreFocus = useRef(false);
  const suppressMenuFocus = useRef(false);
  useEffect(() => {
    const previous = previousFocus.current;
    return () => {
      queueMicrotask(() => {
        const target = previous;
        if (
          target?.isConnected &&
          !target.matches(':disabled') &&
          !target.closest('[inert], [hidden], [aria-hidden="true"]')
        )
          target.focus({ preventScroll: true });
        else
          document
            .querySelector<HTMLElement>('.header-menu-trigger, .brand')
            ?.focus({ preventScroll: true });
      });
    };
  }, []);
  useEffect(() => {
    if (loading) backButton.current?.focus();
    else searchInput.current?.focus();
  }, [loading]);
  useEffect(() => {
    if (busy) return;
    if (editing) editInput.current?.focus();
    else if (deleting) keepButton.current?.focus();
    else if (backup) importCancel.current?.focus();
    else if (restoreFocus.current) {
      restoreFocus.current = false;
      const target = actionTrigger.current;
      const focus = () => {
        if (target?.isConnected && !target.disabled) target.focus({ preventScroll: true });
        else searchInput.current?.focus({ preventScroll: true });
      };
      focus();
      // Radix may refocus the container when the details field is removed.
      let active = true;
      queueMicrotask(() => {
        if (active) focus();
      });
      const timer = setTimeout(() => {
        if (active) focus();
      }, 0);
      return () => {
        active = false;
        clearTimeout(timer);
      };
    }
  }, [editing, deleting, backup, busy]);
  function closeDetails() {
    restoreFocus.current = true;
    setEditing(null);
    setDeleting(null);
    setError('');
  }
  function closeImport() {
    restoreFocus.current = true;
    setBackup(null);
    setError('');
  }
  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadFailed(false);
    setInvalidCount(0);
    setError('');
    listRoutes((count) => {
      if (active) setInvalidCount(count);
    })
      .then((value) => {
        if (active) setRoutes(value);
      })
      .catch((error) => {
        if (active) {
          setLoadFailed(true);
          setError(error instanceof Error ? error.message : 'Your library could not be loaded.');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [loadAttempt]);
  async function mutate<T>(
    operation: () => Promise<T>,
    action: string,
    success?: (result: T) => string,
  ) {
    if (actionLocked.current) return;
    actionLocked.current = true;
    restoreFocus.current = action !== 'export';
    setBusy(true);
    setError('');
    const fallback =
      action === 'export' ? 'Could not export your library.' : 'Could not update your library.';
    const promise = (async () => {
      const result = await operation();
      if (action !== 'export') {
        setInvalidCount(0);
        setRoutes(await listRoutes(setInvalidCount));
        setEditing(null);
        setDeleting(null);
        if (action === 'import') setBackup(null);
      }
      return result;
    })();
    if (!action.startsWith('favorite:')) {
      toast.promise(promise, {
        loading: t(action === 'export' ? 'Preparing library backup…' : 'Updating your library…'),
        success:
          success ??
          (() =>
            t(
              action === 'save'
                ? 'Route saved on this device. Your next adventure is ready.'
                : action === 'delete'
                  ? 'Route deleted.'
                  : action === 'export'
                    ? 'Library backup download started.'
                    : 'Route duplicated.',
            )),
        error: (error: unknown) =>
          translateMessage(error instanceof Error ? error.message : fallback),
      });
    }
    try {
      await promise;
    } catch (error) {
      if (action.startsWith('favorite:'))
        setError(error instanceof Error ? error.message : fallback);
    } finally {
      actionLocked.current = false;
      setBusy(false);
    }
  }
  const filtered = routes
    .filter((route) =>
      `${route.name} ${route.description} ${(route.tags ?? []).join(' ')}`
        .toLocaleLowerCase(locale())
        .includes(query.trim().toLocaleLowerCase(locale())),
    )
    .filter(
      (route) =>
        (activity === 'all' || route.activity === activity) &&
        (!favoriteOnly || route.favorite) &&
        (!tag || (route.tags ?? []).includes(tag)) &&
        (!minKm || route.stats.distance >= Number(minKm) * 1000) &&
        (!maxKm || route.stats.distance <= Number(maxKm) * 1000),
    )
    .sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name, locale());
      const difference =
        sort === 'distance'
          ? a.stats.distance - b.stats.distance
          : Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
      return difference || a.name.localeCompare(b.name, locale());
    });
  return (
    <section
      className="library-screen"
      role="region"
      aria-label={t('Saved routes')}
      aria-describedby={screenDescriptionId}
      onKeyDown={(event) => {
        if (
          event.key === 'Escape' &&
          !event.defaultPrevented &&
          !editing &&
          !deleting &&
          !backup &&
          !busy &&
          !document.querySelector('[role="menu"]')
        ) {
          event.preventDefault();
          if (onCompare && comparisonIds.length) setComparisonIds([]);
          else onClose();
        }
      }}
    >
      <header className="library-screen-header">
        <div className="library-screen-heading">
          <FolderHeart size={22} aria-hidden="true" />
          <h1>{t('Your route library')}</h1>
        </div>
        <Button
          ref={backButton}
          variant="ghost"
          className="back-to-map-button"
          disabled={busy}
          onClick={onClose}
        >
          <ArrowLeft size={18} aria-hidden="true" />
          {t('Back to map')}
        </Button>
      </header>
      <div className="library-screen-scroll">
        <div className="route-library">
          <p className="library-screen-description" id={screenDescriptionId}>
            {t('Good routes are worth keeping. Saved on this device, no account needed.')}
          </p>
          {loading && <LibrarySkeleton />}
          <div className="library-toolbar">
            <Label className="library-search">
              <Search size={18} aria-hidden="true" />
              <Input
                ref={searchInput}
                aria-label={t('Search saved routes')}
                placeholder={t('Find a saved route…')}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </Label>
            {routes.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    className="library-sort"
                    disabled={loading || !routes.length || busy}
                    aria-label={t('Sort routes: {{sort}}', { sort: t(sortLabels[sort]) })}
                  >
                    <ArrowDownWideNarrow size={18} aria-hidden="true" />
                    {t(sortLabels[sort])}
                    <ChevronDown size={14} aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="library-sort-menu">
                  <DropdownMenuRadioGroup
                    value={sort}
                    onValueChange={(value) => setSort(value as RouteSort)}
                  >
                    {(Object.keys(sortLabels) as RouteSort[]).map((value) => (
                      <DropdownMenuRadioItem key={value} value={value}>
                        {t(sortLabels[value])}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
          <div className="library-tools">
            {routes.length > 0 && (
              <>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className="library-filter-trigger"
                      aria-label={t('Filter routes')}
                      disabled={busy || loading}
                    >
                      <SlidersHorizontal size={16} aria-hidden="true" />
                      {t('Filter routes')}
                      {advancedFilterCount > 0 && (
                        <Badge variant="secondary" aria-hidden="true">
                          {advancedFilterCount}
                        </Badge>
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="start"
                    sideOffset={8}
                    collisionPadding={16}
                    className="route-library library-filter-popover"
                    onInteractOutside={(event) => {
                      const target = event.target;
                      if (
                        target instanceof Element &&
                        target.closest('[role="menu"], [data-slot="dropdown-menu-content"]')
                      ) {
                        event.preventDefault();
                      }
                    }}
                  >
                    <section className="library-filters" aria-label={t('Filter routes')}>
                      <div className="library-filter-grid">
                        <LibraryChoice
                          label={t('Activity')}
                          value={activity}
                          disabled={busy || loading}
                          onChange={(value) =>
                            updateFilters({ activity: value as typeof activity })
                          }
                          options={[
                            { value: 'all', label: t('All activities') },
                            { value: 'cycling', label: t('Cycling') },
                            { value: 'hiking', label: t('Hiking') },
                          ]}
                        />
                        <LibraryChoice
                          label={t('Filter by tag')}
                          value={tag}
                          disabled={busy || loading}
                          onChange={(tag) => updateFilters({ tag })}
                          options={[
                            { value: '', label: t('All tags') },
                            ...[
                              ...new Set([
                                ...routes.flatMap((route) => route.tags ?? []),
                                ...(tag ? [tag] : []),
                              ]),
                            ]
                              .sort()
                              .map((tag) => ({ value: tag, label: tag })),
                          ]}
                        />
                        <div
                          className="library-filter-field library-length-field"
                          role="group"
                          aria-label={t('Route length (km)')}
                        >
                          <span className="library-field-label">{t('Route length (km)')}</span>
                          <div className="library-length-range">
                            <Input
                              type="number"
                              min="0"
                              step="any"
                              placeholder={t('Min')}
                              aria-label={t('Minimum length (km)')}
                              disabled={busy || loading}
                              value={minKm}
                              onChange={(event) => updateFilters({ minKm: event.target.value })}
                            />
                            <span aria-hidden="true">–</span>
                            <Input
                              type="number"
                              min="0"
                              step="any"
                              placeholder={t('Max')}
                              aria-label={t('Maximum length (km)')}
                              disabled={busy || loading}
                              value={maxKm}
                              onChange={(event) => updateFilters({ maxKm: event.target.value })}
                            />
                          </div>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        className="library-filter-reset"
                        disabled={busy || loading || (!hasFilters && sort === 'updated')}
                        onClick={resetFilters}
                      >
                        {t('Reset filters')}
                      </Button>
                    </section>
                  </PopoverContent>
                </Popover>
                <Button
                  variant="outline"
                  className="library-favorite-filter"
                  disabled={busy || loading}
                  aria-pressed={favoriteOnly}
                  onClick={() => updateFilters({ favoriteOnly: !favoriteOnly })}
                >
                  <Star size={16} aria-hidden="true" />
                  {t('Favorites only')}
                </Button>
              </>
            )}
            <div
              className="library-backup-tools library-backup-actions"
              role="group"
              aria-label={t('Library backup')}
            >
              <Button
                variant="outline"
                disabled={loading || busy || loadFailed || !routes.length}
                onClick={() =>
                  void mutate(async () => {
                    const blob = new Blob([exportBackup(routes)], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement('a');
                    try {
                      link.href = url;
                      link.download = 'roamlet-library.json';
                      document.body.append(link);
                      link.click();
                    } finally {
                      link.remove();
                      setTimeout(() => URL.revokeObjectURL(url), 0);
                    }
                  }, 'export')
                }
              >
                <Download size={16} aria-hidden="true" />
                <span className="library-backup-label">{t('Download backup')}</span>
              </Button>
              <Button
                variant="outline"
                disabled={loading || busy || loadFailed}
                onClick={(event) => {
                  actionTrigger.current = event.currentTarget;
                  restoreFocus.current = false;
                  importInput.current?.click();
                }}
              >
                <Upload size={16} aria-hidden="true" />
                <span className="library-backup-label">{t('Restore from backup')}</span>
              </Button>
              <input
                ref={importInput}
                hidden
                type="file"
                accept="application/json,.json"
                aria-label={t('Import library file')}
                disabled={loading || busy || loadFailed}
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (!file || actionLocked.current) return;
                  actionLocked.current = true;
                  setBusy(true);
                  setError('');
                  setBackup(null);
                  try {
                    setBackup(await readBackupFile(file));
                    setConflictMode('copy');
                  } catch (error) {
                    setError(error instanceof Error ? error.message : 'Invalid library backup.');
                  } finally {
                    actionLocked.current = false;
                    setBusy(false);
                  }
                }}
              />
            </div>
          </div>
          {backup && (
            <Dialog
              title={t('Library import preview')}
              onClose={() => {
                if (!busy) closeImport();
              }}
              initialFocusRef={importCancel}
            >
              <div className="route-library library-dialog-content">
                <section
                  className="library-import-preview"
                  aria-label={t('Library import preview')}
                >
                  <p>{t('{{count}} routes to import', { count: backup.routes.length })}</p>
                  <p>
                    {t('{{count}} conflicting routes', {
                      count: backup.routes.filter((route) =>
                        routes.some((existing) => existing.id === route.id),
                      ).length,
                    })}
                  </p>
                  <LibraryChoice
                    label={t('Conflicting routes')}
                    value={conflictMode}
                    disabled={busy}
                    onChange={(value) => setConflictMode(value as ConflictMode)}
                    options={[
                      { value: 'copy', label: t('Import copies') },
                      { value: 'skip', label: t('Skip existing routes') },
                      { value: 'replace', label: t('Replace existing routes') },
                    ]}
                  />
                  <p>{t('Import changes only your library, not the route in the editor.')}</p>
                  <div className="button-row dialog-actions">
                    <Button
                      variant="ghost"
                      disabled={busy}
                      ref={importCancel}
                      onClick={closeImport}
                    >
                      {t('Cancel import')}
                    </Button>
                    <Button
                      disabled={busy}
                      onClick={() =>
                        void mutate(
                          () => importBackup(backup, conflictMode),
                          'import',
                          (result) =>
                            t('Imported {{count}} routes; skipped {{skipped}}.', {
                              count: result.imported,
                              skipped: result.skipped,
                            }),
                        )
                      }
                    >
                      {t('Import routes')}
                    </Button>
                  </div>
                </section>
              </div>
            </Dialog>
          )}
          {invalidCount > 0 && (
            <Notification
              title={t('Notification')}
              variant="warning"
              message={t(
                '{{count}} invalid saved routes were hidden and retained on this device.',
                {
                  count: invalidCount,
                },
              )}
            />
          )}
          {error && (
            <Notification
              title={t('Notification')}
              variant="error"
              message={translateMessage(error)}
              onDismiss={() => setError('')}
            />
          )}
          {onCompare && !loading && !loadFailed && comparisonRoutes.length > 0 && (
            <section
              className="library-comparison"
              aria-label={t('Compare saved routes')}
              data-ready={comparisonRoutes.length >= 2}
            >
              <div className="library-comparison-summary">
                <div className="library-comparison-heading">
                  <ArrowLeftRight size={20} aria-hidden="true" />
                  <h2>{t('Route comparison')}</h2>
                  <Badge variant="secondary" aria-hidden="true">
                    {comparisonRoutes.length} / {MAX_COMPARISON_ROUTES}
                  </Badge>
                </div>
                <p id={comparisonHelpId} aria-live="polite" aria-atomic="true">
                  {t(
                    comparisonRoutes.length === 0
                      ? 'Choose 2–{{max}} routes to compare on the map.'
                      : comparisonRoutes.length === 1
                        ? '1 route selected. Choose one more to compare.'
                        : comparisonRoutes.length < MAX_COMPARISON_ROUTES
                          ? 'Ready to compare. You can select up to {{max}} routes.'
                          : 'Selection limit reached: {{max}} routes. Ready to compare.',
                    { max: MAX_COMPARISON_ROUTES },
                  )}
                  {comparisonRoutes.some(
                    (route) => !filtered.some((visible) => visible.id === route.id),
                  ) && (
                    <span className="library-comparison-filter-note">
                      {t('Some selected routes are hidden by filters.')}
                    </span>
                  )}
                </p>
              </div>
              {comparisonRoutes.length > 0 && (
                <ul className="library-comparison-selection" aria-label={t('Selected routes')}>
                  {comparisonRoutes.map((route, index) => (
                    <li key={route.id}>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy || !!editing || !!deleting || !!backup}
                        aria-label={t('Remove {{name}} from comparison', { name: route.name })}
                        onClick={() => toggleComparison(route.id)}
                      >
                        <span
                          className="library-comparison-route-number"
                          style={{ backgroundColor: ROUTE_COMPARISON_COLORS[index] }}
                          aria-hidden="true"
                        >
                          {index + 1}
                        </span>
                        <span className="library-comparison-route-name">{route.name}</span>
                        <X className="size-5" aria-hidden="true" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="library-comparison-actions">
                <Button
                  disabled={
                    busy ||
                    !!editing ||
                    !!deleting ||
                    !!backup ||
                    !isValidComparisonSelection(comparisonRoutes)
                  }
                  aria-describedby={comparisonHelpId}
                  onClick={() => onCompare(comparisonRoutes)}
                >
                  <ArrowLeftRight size={18} aria-hidden="true" />
                  {t('Compare routes')}
                </Button>
                <Button
                  variant="ghost"
                  className="library-comparison-clear"
                  aria-label={t('Clear selection')}
                  title={t('Clear selection')}
                  disabled={busy || !!editing || !!deleting || !!backup || !comparisonRoutes.length}
                  onClick={() => setComparisonIds([])}
                >
                  <X size={18} aria-hidden="true" />
                  <span>{t('Clear selection')}</span>
                </Button>
              </div>
            </section>
          )}
          {!loading && !loadFailed && (
            <div className="library-summary" role="status">
              <span className="library-collection-label">
                <FolderHeart size={16} aria-hidden="true" />
                <span className="library-count-label">{t('Your route library')}</span>{' '}
                <strong>{routes.length}</strong>
                <span className="library-mobile-description">
                  {' · '}
                  {t('Good routes are worth keeping. Saved on this device, no account needed.')}
                </span>
              </span>
              {hasFilters && (
                <span>{t('{{count}} matching routes', { count: filtered.length })}</span>
              )}
            </div>
          )}
          {loading ? null : loadFailed ? (
            <div className="library-empty library-load-error">
              <FolderHeart size={34} aria-hidden="true" />
              <h3>{t('Your library could not be loaded.')}</h3>
              <Button variant="outline" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>
                {t('Try again')}
              </Button>
            </div>
          ) : !routes.length ? (
            <div className="library-empty">
              <FolderHeart size={34} aria-hidden="true" />
              <h3>{t('Your next adventure belongs here')}</h3>
              <p>{t('Plan a route or import a GPX, then save it for later.')}</p>
            </div>
          ) : !filtered.length ? (
            <div className="library-empty library-no-match">
              <Search size={30} aria-hidden="true" />
              <h3>{t('No routes match your search.')}</h3>
              <p>{t('Try another name or a word from the description.')}</p>
              <Button
                variant="outline"
                onClick={() => {
                  resetFilters();
                  searchInput.current?.focus();
                }}
              >
                {t('Reset search and filters')}
              </Button>
            </div>
          ) : (
            <ul className="library-list" aria-label={t('Saved routes')} aria-busy={busy}>
              {filtered.map((route) => (
                <li
                  className="library-route"
                  key={route.id}
                  data-selected={editing?.id === route.id || deleting?.id === route.id || undefined}
                  data-comparable={!!onCompare || undefined}
                  data-comparison-selected={comparisonIds.includes(route.id) || undefined}
                >
                  {onCompare ? (
                    <label className="library-comparison-checkbox">
                      <input
                        type="checkbox"
                        className="library-comparison-input"
                        checked={comparisonIds.includes(route.id)}
                        disabled={
                          busy ||
                          (!comparisonIds.includes(route.id) &&
                            comparisonRoutes.length >= MAX_COMPARISON_ROUTES)
                        }
                        aria-label={t('Select {{name}} for comparison', { name: route.name })}
                        aria-describedby={comparisonHelpId}
                        onChange={() => toggleComparison(route.id)}
                      />
                      <RouteThumbnail route={route} />
                      <span className="library-route-body">
                        <RouteCardDetails route={route} />
                      </span>
                    </label>
                  ) : (
                    <>
                      <RouteThumbnail route={route} />
                      <Button
                        variant="ghost"
                        className="library-open library-route-body"
                        title={route.name}
                        disabled={busy}
                        onClick={() => onOpen(route)}
                      >
                        <RouteCardDetails route={route} />
                      </Button>
                    </>
                  )}
                  <div
                    className="library-actions"
                    role="group"
                    aria-label={t('Actions for {{name}}', { name: route.name })}
                  >
                    <Button
                      variant="ghost"
                      disabled={busy}
                      className="icon-button library-favorite-action"
                      title={t(route.favorite ? 'Remove from favorites' : 'Add to favorites')}
                      aria-label={t(route.favorite ? 'Remove from favorites' : 'Add to favorites')}
                      aria-pressed={route.favorite ?? false}
                      onClick={(event) => {
                        actionTrigger.current = event.currentTarget;
                        void mutate(
                          () => saveRoute({ ...route, favorite: !route.favorite }),
                          'favorite:' + route.id,
                        );
                      }}
                    >
                      <Star size={18} aria-hidden="true" />
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          className="icon-button library-more-action"
                          disabled={busy}
                          aria-label={t('More actions for {{name}}', { name: route.name })}
                          onClick={(event) => {
                            actionTrigger.current = event.currentTarget;
                          }}
                          onKeyDown={(event) => {
                            if (
                              event.key === 'Enter' ||
                              event.key === ' ' ||
                              event.key === 'ArrowDown' ||
                              event.key === 'ArrowUp'
                            )
                              actionTrigger.current = event.currentTarget;
                          }}
                        >
                          <MoreHorizontal size={18} aria-hidden="true" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="end"
                        className="library-route-menu"
                        collisionPadding={12}
                        onCloseAutoFocus={(event) => {
                          if (!suppressMenuFocus.current) return;
                          suppressMenuFocus.current = false;
                          event.preventDefault();
                        }}
                      >
                        <DropdownMenuItem
                          disabled={busy}
                          aria-label={t('Edit {{name}}', { name: route.name })}
                          onSelect={() => {
                            suppressMenuFocus.current = true;
                            restoreFocus.current = false;
                            setEditing(route);
                            setDeleting(null);
                            setName(route.name);
                            setDescription(route.description);
                            setTags((route.tags ?? []).join(', '));
                            setFavorite(route.favorite ?? false);
                          }}
                        >
                          <Pencil size={18} aria-hidden="true" />
                          {t('Edit')}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={busy}
                          aria-label={t('Duplicate {{name}}', { name: route.name })}
                          onSelect={() => {
                            void mutate(() => duplicateRoute(route), `duplicate:${route.id}`);
                          }}
                        >
                          <Copy size={18} aria-hidden="true" />
                          {t('Copy')}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={busy}
                          variant="destructive"
                          className="library-delete-action"
                          aria-label={t('Delete {{name}}', { name: route.name })}
                          onSelect={() => {
                            suppressMenuFocus.current = true;
                            restoreFocus.current = false;
                            setDeleting(route);
                            setEditing(null);
                          }}
                        >
                          <Trash2 size={18} aria-hidden="true" />
                          {t('Delete')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <Button
                      variant="outline"
                      className="library-open-action"
                      aria-label={t('Open {{name}}', { name: route.name })}
                      disabled={busy}
                      onClick={() => onOpen(route)}
                    >
                      <ArrowUpRight size={18} aria-hidden="true" />
                      <span className="library-open-label">{t('Open')}</span>
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {editing && (
            <Dialog
              title={t('Edit route details')}
              description={editing.name}
              onClose={() => {
                if (!busy) closeDetails();
              }}
              initialFocusRef={editInput}
            >
              <div className="route-library library-dialog-content">
                <form
                  className="library-edit"
                  aria-labelledby={editTitleId}
                  aria-busy={busy}
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (name.trim())
                      void mutate(
                        () =>
                          saveRoute({
                            ...editing,
                            name: name.trim(),
                            description: description.trim(),
                            favorite,
                            tags: [
                              ...new Set(
                                tags
                                  .split(',')
                                  .map((tag) => tag.trim())
                                  .filter(Boolean),
                              ),
                            ],
                            updatedAt: new Date().toISOString(),
                          }),
                        'save',
                      );
                  }}
                >
                  <div className="library-detail-heading">
                    <Pencil size={18} aria-hidden="true" />
                    <h3 id={editTitleId}>{t('Edit route details')}</h3>
                  </div>
                  <Label>
                    {t('Route name')}
                    <Input
                      ref={editInput}
                      disabled={busy}
                      required
                      maxLength={120}
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                    />
                  </Label>
                  <Label>
                    {t('Description')}
                    <Textarea
                      disabled={busy}
                      maxLength={2000}
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                    />
                  </Label>
                  <Label>
                    {t('Tags')}
                    <Input
                      disabled={busy}
                      value={tags}
                      onChange={(event) => setTags(event.target.value)}
                      placeholder={t('Comma-separated tags')}
                      maxLength={2000}
                    />
                  </Label>
                  <Button
                    variant="outline"
                    type="button"
                    className="library-favorite-filter library-edit-favorite"
                    disabled={busy}
                    aria-pressed={favorite}
                    onClick={() => setFavorite(!favorite)}
                  >
                    <Star size={16} aria-hidden="true" />
                    {t('Favorite')}
                  </Button>
                  <div className="button-row dialog-actions">
                    <Button
                      variant="ghost"
                      type="button"
                      className="secondary"
                      disabled={busy}
                      onClick={closeDetails}
                    >
                      {t('Cancel')}
                    </Button>
                    <Button type="submit" className="primary" disabled={busy || !name.trim()}>
                      {t('Save changes')}
                    </Button>
                  </div>
                </form>
              </div>
            </Dialog>
          )}
          {deleting && (
            <Dialog
              title={t('Delete route')}
              onClose={() => {
                if (!busy) closeDetails();
              }}
              initialFocusRef={keepButton}
            >
              <div className="route-library library-dialog-content">
                <section
                  className="delete-confirm"
                  role="alert"
                  aria-labelledby={deleteTitleId}
                  aria-busy={busy}
                >
                  <div className="library-detail-heading">
                    <Trash2 size={18} aria-hidden="true" />
                    <h3 id={deleteTitleId}>{t('Delete route')}</h3>
                  </div>
                  <p>
                    {t('Delete')} <strong>{deleting.name}</strong>{' '}
                    {t('from this device? This cannot be undone.')}
                  </p>
                  <div className="button-row dialog-actions">
                    <Button
                      variant="ghost"
                      ref={keepButton}
                      className="secondary"
                      disabled={busy}
                      onClick={closeDetails}
                    >
                      {t('Keep route')}
                    </Button>
                    <Button
                      variant="destructive"
                      className="danger"
                      disabled={busy}
                      onClick={() => void mutate(() => deleteRoute(deleting.id), 'delete')}
                    >
                      <Trash2 size={16} aria-hidden="true" />
                      {t('Delete route')}
                    </Button>
                  </div>
                </section>
              </div>
            </Dialog>
          )}
        </div>
      </div>
    </section>
  );
}
