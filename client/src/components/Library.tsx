import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Label } from './ui/label';
import { Card } from './ui/card';
import { Skeleton } from './ui/skeleton';
import { useTranslation } from 'react-i18next';
import { useEffect, useRef, useState } from 'react';
import { Bike, Footprints, Search, Copy, Trash2, Pencil, FolderHeart } from 'lucide-react';
import type { PlannedRoute } from '../domain/types';
import { listRoutes, saveRoute, deleteRoute, duplicateRoute } from '../domain/storage';
import { formatDistance } from './Statistics';
import { Dialog } from './Dialog';
import { locale, translateMessage } from '../i18n';

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
  const [query, setQuery] = useState('');
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
      if (target?.isConnected && !target.disabled) target.focus();
      else searchInput.current?.focus();
    }
  }, [editing, deleting, busy]);
  function closeDetails() {
    restoreFocus.current = true;
    setEditing(null);
    setDeleting(null);
  }
  useEffect(() => {
    let active = true;
    listRoutes()
      .then((value) => {
        if (active) setRoutes(value);
      })
      .catch((error) => {
        if (active)
          setError(error instanceof Error ? error.message : 'Your library could not be loaded.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  async function mutate(operation: () => Promise<unknown>) {
    restoreFocus.current = true;
    setBusy(true);
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
    }
  }
  const filtered = routes.filter((r) =>
    `${r.name} ${r.description}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <Dialog title={t('Your route library')} onClose={onClose} initialFocusRef={searchInput} wide>
      <p className="muted">
        {t('Good routes are worth keeping. Saved on this device, no account needed.')}
      </p>
      <Label className="library-search">
        <Search size={18} />
        <Input
          ref={searchInput}
          aria-label={t('Search saved routes')}
          placeholder={t('Find a saved route…')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </Label>
      {error && (
        <p className="error-inline" role="alert">
          {translateMessage(error)}
        </p>
      )}
      {loading ? (
        <div role="status" aria-label={t('Opening your library…')} className="library-loading">
          {[0, 1, 2].map((index) => <Skeleton key={index} className="h-20 w-full rounded-xl" />)}
        </div>
      ) : !routes.length ? (
        <div className="library-empty">
          <FolderHeart size={34} />
          <h3>{t('Your next adventure belongs here')}</h3>
          <p>{t('Plan a route or import a GPX, then save it for later.')}</p>
        </div>
      ) : !filtered.length ? (
        <p>{t('No routes match your search.')}</p>
      ) : (
        <div className="library-list">
          {filtered.map((route) => (
            <Card className="library-route" key={route.id}>
              <span className="activity-icon">
                {route.activity === 'cycling' ? <Bike size={22} /> : <Footprints size={22} />}
              </span>
              <Button variant="ghost" className="library-open" disabled={busy} onClick={() => onOpen(route)}>
                <strong>{route.name}</strong>
                <span>
                  {route.activity === 'cycling' ? t('Cycling') : t('Hiking')} ·{' '}
                  {formatDistance(route.stats.distance)} {t('· Updated')}{' '}
                  {new Date(route.updatedAt).toLocaleDateString(locale())}
                </span>
                {route.description && (
                  <span className="route-description">{route.description}</span>
                )}
              </Button>
              <div className="library-actions">
                <Button variant="ghost"
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
                  <Pencil size={16} />
                </Button>
                <Button variant="ghost"
                  className="icon-button"
                  disabled={busy}
                  aria-label={t('Duplicate {{name}}', { name: route.name })}
                  onClick={(event) => {
                    actionTrigger.current = event.currentTarget;
                    void mutate(() => duplicateRoute(route));
                  }}
                >
                  <Copy size={16} />
                </Button>
                <Button variant="ghost"
                  className="icon-button"
                  disabled={busy}
                  aria-label={t('Delete {{name}}', { name: route.name })}
                  onClick={(event) => {
                    actionTrigger.current = event.currentTarget;
                    restoreFocus.current = false;
                    setDeleting(route);
                    setEditing(null);
                  }}
                >
                  <Trash2 size={16} />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
      {editing && (
        <form
          className="library-edit"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim())
              void mutate(() =>
                saveRoute({
                  ...editing,
                  name: name.trim(),
                  description: description.trim(),
                  updatedAt: new Date().toISOString(),
                }),
              );
          }}
        >
          <h3>{t('Edit route details')}</h3>
          <Label>
            {t('Route name')}
            <Input
              ref={editInput}
              required
              maxLength={120}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Label>
          <Label>
            {t('Description')}
            <Textarea
              maxLength={2000}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </Label>
          <div className="button-row">
            <Button variant="ghost" type="button" className="secondary" disabled={busy} onClick={closeDetails}>
              {t('Cancel')}
            </Button>
            <Button type="submit" className="primary" disabled={busy || !name.trim()}>
              {t('Save changes')}
            </Button>
          </div>
        </form>
      )}
      {deleting && (
        <section className="delete-confirm" role="alert">
          <p>
            {t('Delete')} <strong>{deleting.name}</strong>{' '}
            {t('from this device? This cannot be undone.')}
          </p>
          <div className="button-row">
            <Button variant="ghost" ref={keepButton} className="secondary" disabled={busy} onClick={closeDetails}>
              {t('Keep route')}
            </Button>
            <Button variant="destructive"
              className="danger"
              disabled={busy}
              onClick={() => void mutate(() => deleteRoute(deleting.id))}
            >
              {t('Delete route')}
            </Button>
          </div>
        </section>
      )}
      <p className="fine-print">
        {t(
          'Your browser stores these routes in IndexedDB. Export important routes as GPX before clearing browser data.',
        )}
      </p>
    </Dialog>
  );
}
