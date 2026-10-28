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
  ArrowUpDown,
  ChevronDown,
  ChevronRight,
  LoaderCircle,
  Save,
  HardDrive,
} from 'lucide-react';

import type { PlannedRoute } from '../domain/types';
import { listRoutes, saveRoute, deleteRoute, duplicateRoute } from '../domain/storage';
import { formatDistance } from './Statistics';
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
  const [sort, setSort] = useState<RouteSort>('updated');
  const [query, setQuery] = useState('');
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
    setError('');
    listRoutes()
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
      setRoutes(await listRoutes());
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
      `${route.name} ${route.description}`
        .toLocaleLowerCase(locale())
        .includes(query.trim().toLocaleLowerCase(locale())),
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
      description={t('Good routes are worth keeping. Saved on this device, no account needed.')}
      onClose={onClose}
      initialFocusRef={searchInput}
      wide
    >
      <div className="route-library">
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
                  <ArrowUpDown size={16} aria-hidden="true" />
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
        {!loading && !loadFailed && (
          <div className="library-summary" role="status">
            <span className="library-collection-label">
              <FolderHeart size={16} aria-hidden="true" />
              {t('Saved routes')} <strong>{routes.length}</strong>
            </span>
            {query.trim() && (
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
                setQuery('');
                searchInput.current?.focus();
              }}
            >
              {t('Clear search')}
            </Button>
          </div>
        ) : (
          <ul className="library-list" aria-label={t('Saved routes')} aria-busy={busy}>
            {filtered.map((route) => (
              <li className="library-route" key={route.id}>
                <span className="library-activity-icon">
                  {route.activity === 'cycling' ? (
                    <Bike size={22} aria-hidden="true" />
                  ) : (
                    <Footprints size={22} aria-hidden="true" />
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
                  </span>
                  <span className="library-updated">
                    {t('· Updated')} {new Date(route.updatedAt).toLocaleDateString(locale())}
                  </span>
                  {route.description && (
                    <span className="route-description">{route.description}</span>
                  )}
                  <ChevronRight size={16} className="library-open-chevron" aria-hidden="true" />
                </Button>
                <div className="library-actions">
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
                    }}
                  >
                    <Pencil size={16} aria-hidden="true" />
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
                      <Copy size={16} aria-hidden="true" />
                    )}
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
                    <Trash2 size={16} aria-hidden="true" />
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
          <HardDrive size={15} aria-hidden="true" />
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
