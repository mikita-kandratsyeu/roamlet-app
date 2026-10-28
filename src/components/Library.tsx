import { useEffect, useState } from 'react';
import { Bike, Footprints, Search, Copy, Trash2, Pencil, FolderHeart } from 'lucide-react';
import type { PlannedRoute } from '../domain/types';
import { listRoutes, saveRoute, deleteRoute, duplicateRoute } from '../domain/storage';
import { formatDistance } from './Statistics';
import { Dialog } from './Dialog';

export function Library({ onClose, onOpen }: { onClose: () => void; onOpen: (route: PlannedRoute) => void }) {
  const [routes, setRoutes] = useState<PlannedRoute[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<PlannedRoute | null>(null);
  const [deleting, setDeleting] = useState<PlannedRoute | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  useEffect(() => {
    let active = true;
    listRoutes().then(value => { if (active) setRoutes(value); }).catch(error => { if (active) setError(error instanceof Error ? error.message : 'Your library could not be loaded.'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  async function mutate(operation: () => Promise<unknown>) {
    setBusy(true); setError('');
    try { await operation(); setRoutes(await listRoutes()); setEditing(null); setDeleting(null); }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not update your library.'); }
    finally { setBusy(false); }
  }
  const filtered = routes.filter(r => `${r.name} ${r.description}`.toLowerCase().includes(query.toLowerCase()));
  return <Dialog title="Your route library" onClose={onClose} wide>
    <p className="muted">Good routes are worth keeping. Saved on this device, no account needed.</p>
    <label className="library-search"><Search size={18} /><input aria-label="Search saved routes" placeholder="Find a saved route…" value={query} onChange={e => setQuery(e.target.value)} /></label>
    {error && <p className="error-inline" role="alert">{error}</p>}
    {loading ? <p role="status">Opening your library…</p> : !routes.length ? <div className="library-empty"><FolderHeart size={34} /><h3>Your next adventure belongs here</h3><p>Plan a route or import a GPX, then save it for later.</p></div> : !filtered.length ? <p>No routes match your search.</p> : <div className="library-list">{filtered.map(route => <article className="library-route" key={route.id}>
      <span className="activity-icon">{route.activity === 'cycling' ? <Bike size={22} /> : <Footprints size={22} />}</span>
      <button className="library-open" disabled={busy} onClick={() => onOpen(route)}><strong>{route.name}</strong><span>{route.activity === 'cycling' ? 'Cycling' : 'Hiking'} · {formatDistance(route.stats.distance)} · Updated {new Date(route.updatedAt).toLocaleDateString()}</span>{route.description && <span className="route-description">{route.description}</span>}</button>
      <div className="library-actions">
        <button className="icon-button" disabled={busy} aria-label={`Edit ${route.name}`} onClick={() => { setEditing(route); setDeleting(null); setName(route.name); setDescription(route.description); }}><Pencil size={16} /></button>
        <button className="icon-button" disabled={busy} aria-label={`Duplicate ${route.name}`} onClick={() => void mutate(() => duplicateRoute(route))}><Copy size={16} /></button>
        <button className="icon-button" disabled={busy} aria-label={`Delete ${route.name}`} onClick={() => { setDeleting(route); setEditing(null); }}><Trash2 size={16} /></button>
      </div>
    </article>)}</div>}
    {editing && <form className="library-edit" onSubmit={event => { event.preventDefault(); if (name.trim()) void mutate(() => saveRoute({ ...editing, name: name.trim(), description: description.trim(), updatedAt: new Date().toISOString() })); }}><h3>Edit route details</h3><label>Route name<input required maxLength={120} value={name} onChange={event => setName(event.target.value)} /></label><label>Description<textarea maxLength={2000} value={description} onChange={event => setDescription(event.target.value)} /></label><div className="button-row"><button type="button" className="secondary" disabled={busy} onClick={() => setEditing(null)}>Cancel</button><button className="primary" disabled={busy || !name.trim()}>Save changes</button></div></form>}
    {deleting && <section className="delete-confirm" role="alert"><p>Delete <strong>{deleting.name}</strong> from this device? This cannot be undone.</p><div className="button-row"><button className="secondary" disabled={busy} onClick={() => setDeleting(null)}>Keep route</button><button className="danger" disabled={busy} onClick={() => void mutate(() => deleteRoute(deleting.id))}>Delete route</button></div></section>}
    <p className="fine-print">Your browser stores these routes in IndexedDB. Export important routes as GPX before clearing browser data.</p>
  </Dialog>;
}
