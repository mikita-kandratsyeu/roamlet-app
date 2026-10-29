import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Label } from './ui/label';
import './Library.css';
import { Skeleton } from './ui/skeleton';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from './ui/dropdown-menu';
import { useTranslation } from 'react-i18next';
import { useEffect, useId, useRef, useState } from 'react';
import {
  Bike,
  Footprints,
  Search,
  Copy,
  Trash2,
  Pencil,
  FolderHeart,
  ArrowDownWideNarrow,
  ChevronDown,
  ArrowUpRight,
  LoaderCircle,
  Save,
  Info,
} from 'lucide-react';

import type { PlannedRoute } from '../domain/types';
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
import { locale, translateMessage } from '../i18n';

type RouteSort = 'updated' | 'name' | 'distance';
const sortLabels: Record<RouteSort, string> = {
  updated: 'Most recently updated',
  name: 'Name (A–Z)',
  distance: 'Distance (shortest first)',
};

export function Library({
  onClose,
  onOpen,
}: {
  onClose: () => void;
  onOpen: (route: PlannedRoute) => void;
}) {
  const { t } = useTranslation();
  const [routes, setRoutes] = useState<PlannedRoute[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
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
  const [importResult, setImportResult] = useState('');
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
  const editTitleId = useId();
  const deleteTitleId = useId();
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<PlannedRoute | null>(null);
  const [deleting, setDeleting] = useState<PlannedRoute | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const searchInput = useRef<HTMLInputElement>(null);
  const editInput = useRef<HTMLInputElement>(null);
  const keepButton = useRef<HTMLButtonElement>(null);
  const actionTrigger = useRef<HTMLButtonElement | null>(null);
  const restoreFocus = useRef(false);
  useEffect(() => {
    if (busy) return;
    if (editing) editInput.current?.focus();
    else if (deleting) keepButton.current?.focus();
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
      return () => {
        active = false;
      };
    }
  }, [editing, deleting, busy]);
  function closeDetails() {
    restoreFocus.current = true;
    setEditing(null);
    setDeleting(null);
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
  async function mutate(operation: () => Promise<unknown>, action: string) {
    if (busy) return;
    restoreFocus.current = true;
    setBusy(true);
    setPendingAction(action);
    setError('');
    try {
      await operation();
      setInvalidCount(0);
      setRoutes(await listRoutes(setInvalidCount));
      setEditing(null);
      setDeleting(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not update your library.');
    } finally {
      setBusy(false);
      setPendingAction(null);
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
    <Dialog
      title={t('Your route library')}
      mobileTitle={t('My routes')}
      description={t('Good routes are worth keeping. Saved on this device, no account needed.')}
      onClose={onClose}
      initialFocusRef={searchInput}
      wide
    >
      <div className="route-library">
        <h3 className="library-mobile-heading">{t('Your route library')}</h3>
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
        <div className="library-backup-actions">
          <Button
            variant="outline"
            disabled={loading || busy || loadFailed || !routes.length}
            onClick={() => {
              setError('');
              try {
                const blob = new Blob([exportBackup(routes)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = 'roamlet-library.json';
                document.body.append(link);
                link.click();
                link.remove();
                setTimeout(() => URL.revokeObjectURL(url), 0);
              } catch (error) {
                setError(error instanceof Error ? error.message : 'Could not export your library.');
              }
            }}
          >
            {t('Export library')}
          </Button>
          <Label className="library-import-label">
            {t('Import library')}
            <input
              type="file"
              accept="application/json,.json"
              aria-label={t('Import library file')}
              disabled={loading || busy || loadFailed}
              onChange={async (event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (!file) return;
                setBusy(true);
                setError('');
                setBackup(null);
                setImportResult('');
                try {
                  setBackup(await readBackupFile(file));
                  setConflictMode('copy');
                } catch (error) {
                  setError(error instanceof Error ? error.message : 'Invalid library backup.');
                } finally {
                  setBusy(false);
                }
              }}
            />
          </Label>
        </div>
        {routes.length > 0 && (
          <fieldset className="library-filters" disabled={busy || loading}>
            <legend>{t('Filter routes')}</legend>
            <Label>
              {t('Activity')}
              <select
                value={activity}
                onChange={(event) =>
                  updateFilters({ activity: event.target.value as typeof activity })
                }
              >
                <option value="all">{t('All activities')}</option>
                <option value="cycling">{t('Cycling')}</option>
                <option value="hiking">{t('Hiking')}</option>
              </select>
            </Label>
            <Label className="library-checkbox">
              <input
                type="checkbox"
                checked={favoriteOnly}
                onChange={(event) => updateFilters({ favoriteOnly: event.target.checked })}
              />
              {t('Favorites only')}
            </Label>
            <Label>
              {t('Filter by tag')}
              <select value={tag} onChange={(event) => updateFilters({ tag: event.target.value })}>
                <option value="">{t('All tags')}</option>
                {[
                  ...new Set([
                    ...routes.flatMap((route) => route.tags ?? []),
                    ...(tag ? [tag] : []),
                  ]),
                ]
                  .sort()
                  .map((tag) => (
                    <option key={tag} value={tag}>
                      {tag}
                    </option>
                  ))}
              </select>
            </Label>
            <Label>
              {t('Minimum length (km)')}
              <Input
                type="number"
                min="0"
                step="any"
                value={minKm}
                onChange={(event) => updateFilters({ minKm: event.target.value })}
              />
            </Label>
            <Label>
              {t('Maximum length (km)')}
              <Input
                type="number"
                min="0"
                step="any"
                value={maxKm}
                onChange={(event) => updateFilters({ maxKm: event.target.value })}
              />
            </Label>
            <Button variant="ghost" onClick={resetFilters}>
              {t('Reset filters')}
            </Button>
          </fieldset>
        )}
        {backup && (
          <section className="library-import-preview" aria-label={t('Library import preview')}>
            <h3>{t('Library import preview')}</h3>
            <p>{t('{{count}} routes to import', { count: backup.routes.length })}</p>
            <p>
              {t('{{count}} conflicting routes', {
                count: backup.routes.filter((route) =>
                  routes.some((existing) => existing.id === route.id),
                ).length,
              })}
            </p>
            <Label>
              {t('Conflicting routes')}
              <select
                disabled={busy}
                value={conflictMode}
                onChange={(event) => setConflictMode(event.target.value as ConflictMode)}
              >
                <option value="copy">{t('Import copies')}</option>
                <option value="skip">{t('Skip existing routes')}</option>
                <option value="replace">{t('Replace existing routes')}</option>
              </select>
            </Label>
            <p>{t('Import changes only your library, not the route in the editor.')}</p>
            <div className="button-row">
              <Button variant="ghost" disabled={busy} onClick={() => setBackup(null)}>
                {t('Cancel import')}
              </Button>
              <Button
                disabled={busy}
                onClick={() =>
                  void mutate(async () => {
                    const result = await importBackup(backup, conflictMode);
                    setImportResult(
                      t('Imported {{count}} routes; skipped {{skipped}}.', {
                        count: result.imported,
                        skipped: result.skipped,
                      }),
                    );
                    setBackup(null);
                  }, 'import')
                }
              >
                {t('Import routes')}
              </Button>
            </div>
          </section>
        )}
        {importResult && <p role="status">{importResult}</p>}
        {invalidCount > 0 && (
          <p role="alert">
            {t('{{count}} invalid saved routes were hidden and retained on this device.', {
              count: invalidCount,
            })}
          </p>
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
        {busy && (
          <p className="library-progress" role="status">
            <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />
            {t('Updating your library…')}
          </p>
        )}
        {error && (
          <p className="error-inline" role="alert">
            {translateMessage(error)}
          </p>
        )}
        {loading ? (
          <div role="status" aria-label={t('Opening your library…')} className="library-loading">
            {[0, 1, 2].map((index) => (
              <Skeleton key={index} className="h-20 w-full rounded-xl" />
            ))}
          </div>
        ) : loadFailed ? (
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
              {t('Clear search')}
            </Button>
          </div>
        ) : (
          <ul className="library-list" aria-label={t('Saved routes')} aria-busy={busy}>
            {filtered.map((route) => (
              <li
                className="library-route"
                key={route.id}
                data-selected={editing?.id === route.id || deleting?.id === route.id || undefined}
              >
                <span className="library-activity-icon">
                  <svg className="library-thumbnail" viewBox="0 0 64 64" aria-hidden="true">
                    {thumbnailPaths(route.segments).map((path, index) => (
                      <path key={index} d={path} />
                    ))}
                  </svg>
                  {route.activity === 'cycling' ? (
                    <Bike size={18} aria-hidden="true" />
                  ) : (
                    <Footprints size={18} aria-hidden="true" />
                  )}
                </span>
                <Button
                  variant="ghost"
                  className="library-open"
                  disabled={busy}
                  onClick={() => onOpen(route)}
                >
                  <strong>{route.name}</strong>
                  <span className="library-route-meta">
                    <span className="library-activity">
                      {route.activity === 'cycling' ? t('Cycling') : t('Hiking')}
                    </span>
                    <span aria-hidden="true"> · </span>
                    <span className="library-distance">{formatDistance(route.stats.distance)}</span>
                    <span className="library-updated">
                      {t('· Updated')} {new Date(route.updatedAt).toLocaleDateString(locale())}
                    </span>
                  </span>
                  {!!route.tags?.length && (
                    <span className="library-route-tags">{route.tags.join(' · ')}</span>
                  )}
                  {route.description && (
                    <span className="route-description">{route.description}</span>
                  )}
                </Button>
                <Button
                  variant="outline"
                  className="library-open-action"
                  disabled={busy}
                  onClick={() => onOpen(route)}
                >
                  <ArrowUpRight size={18} aria-hidden="true" />
                  {t('Open', { defaultValue: locale() === 'ru-RU' ? 'Открыть' : 'Open' })}
                </Button>
                <div className="library-actions">
                  <Button
                    variant="ghost"
                    disabled={busy}
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
                    <span aria-hidden="true">{route.favorite ? '★' : '☆'}</span>
                  </Button>
                  <Button
                    variant="ghost"
                    className="icon-button"
                    disabled={busy}
                    aria-label={t('Edit {{name}}', { name: route.name })}
                    onClick={(event) => {
                      actionTrigger.current = event.currentTarget;
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
                    <span className="library-action-label">{t('Edit route details')}</span>
                  </Button>
                  <Button
                    variant="ghost"
                    className="icon-button"
                    disabled={busy}
                    aria-label={t('Duplicate {{name}}', { name: route.name })}
                    onClick={(event) => {
                      actionTrigger.current = event.currentTarget;
                      void mutate(() => duplicateRoute(route), `duplicate:${route.id}`);
                    }}
                  >
                    {pendingAction === `duplicate:${route.id}` ? (
                      <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />
                    ) : (
                      <Copy size={18} aria-hidden="true" />
                    )}
                    <span className="library-action-label">
                      {t('Duplicate {{name}}', { name: '' }).trim()}
                    </span>
                  </Button>
                  <Button
                    variant="ghost"
                    className="icon-button"
                    disabled={busy}
                    aria-label={t('Delete {{name}}', { name: route.name })}
                    title={t('Delete {{name}}', { name: route.name })}
                    data-destructive="true"
                    onClick={(event) => {
                      actionTrigger.current = event.currentTarget;
                      restoreFocus.current = false;
                      setDeleting(route);
                      setEditing(null);
                    }}
                  >
                    <Trash2 size={18} aria-hidden="true" />
                    <span className="library-action-label">{t('Delete')}</span>
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {editing && (
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
            <p className="library-detail-context">{editing.name}</p>
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
            <Label className="library-checkbox">
              <input
                type="checkbox"
                disabled={busy}
                checked={favorite}
                onChange={(event) => setFavorite(event.target.checked)}
              />
              {t('Favorite')}
            </Label>
            <div className="button-row">
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
                {pendingAction === 'save' ? (
                  <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />
                ) : (
                  <Save size={16} aria-hidden="true" />
                )}
                {t('Save changes')}
              </Button>
            </div>
          </form>
        )}
        {deleting && (
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
            <div className="button-row">
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
                {pendingAction === 'delete' ? (
                  <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />
                ) : (
                  <Trash2 size={16} aria-hidden="true" />
                )}
                {t('Delete route')}
              </Button>
            </div>
          </section>
        )}
        <p className="fine-print library-storage-note">
          <Info size={18} aria-hidden="true" />
          <span>
            {t(
              'Your browser stores these routes in IndexedDB. Export important routes as GPX before clearing browser data.',
            )}
          </span>
        </p>
      </div>
    </Dialog>
  );
}
