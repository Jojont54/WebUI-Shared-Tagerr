import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  ArrowDown, ArrowUp, Check, ChevronDown, ChevronRight, CircleAlert, Clapperboard,
  Clock3, Film, FolderClock, Library, LoaderCircle, LogOut, Menu, Minus, Plus, RefreshCw,
  Search, Settings, ShieldCheck, Tags, Tv, X,
} from 'lucide-react';
import type { AppConfig, BootstrapState, MaintainerrCollection, MediaItem, MediaKind, QualityProfile, SafeConfig, Tag } from '../shared/types';
import { matchesSearch } from '../shared/search';

type Page = { type: 'library'; kind: MediaKind } | { type: 'collection'; kind: MediaKind; id: number; name: string };
type SortKey = 'title' | 'year' | 'added' | 'size' | 'deadline';

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json', ...init.headers } : init?.headers,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Erreur ${response.status}`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function Spinner({ size = 18 }: { size?: number }) {
  return <LoaderCircle size={size} className="spin" />;
}

function PlexCallback() {
  useEffect(() => {
    const timeout = window.setTimeout(() => window.close(), 600);
    return () => window.clearTimeout(timeout);
  }, []);
  return <main className="plex-callback">
    <span className="brand-mark"><Check size={24} /></span>
    <h1>Connexion Plex confirmée</h1>
    <p>Finalisation dans la fenêtre Tagarr…</p>
    <button className="secondary-button" onClick={() => window.close()}>Fermer cette fenêtre</button>
  </main>;
}

function PlexGate({ initialized, onReady }: { initialized: boolean; onReady: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [flowId, setFlowId] = useState('');
  const [servers, setServers] = useState<Array<{ name: string; clientIdentifier: string; uri?: string }>>([]);

  async function startPlex() {
    setBusy(true);
    setError('');
    let plexPopup: Window | null = null;
    try {
      const started = await api<{ flowId: string; authUrl: string }>('/api/auth/plex/start', { method: 'POST' });
      setFlowId(started.flowId);
      plexPopup = window.open(started.authUrl, 'tagarr-plex', 'popup,width=720,height=760');
      for (let attempt = 0; attempt < 300; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
        const response = await fetch(`/api/auth/plex/poll/${started.flowId}`);
        if (response.status === 202) continue;
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || 'Connexion Plex impossible.');
        if (body.needsServer) {
          plexPopup?.close();
          setServers(body.servers);
          setBusy(false);
          return;
        }
        plexPopup?.close();
        onReady();
        return;
      }
      plexPopup?.close();
      throw new Error('La connexion Plex a expiré.');
    } catch (caught) {
      plexPopup?.close();
      setError(caught instanceof Error ? caught.message : 'Connexion Plex impossible.');
      setBusy(false);
    }
  }

  async function selectServer(machineId: string) {
    setBusy(true);
    setError('');
    try {
      await api('/api/setup/plex-server', { method: 'POST', body: JSON.stringify({ flowId, machineId }) });
      onReady();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Configuration impossible.');
      setBusy(false);
    }
  }

  return (
    <main className="gate">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <section className="gate-card">
        <div className="brand brand-large"><span className="brand-mark"><Tags size={25} /></span><span>Tagarr</span></div>
        {!servers.length ? (
          <>
            <div className="eyebrow"><ShieldCheck size={15} /> Accès privé à votre médiathèque</div>
            <h1>{initialized ? 'Ravi de vous revoir.' : 'Vos bibliothèques, enfin bien rangées.'}</h1>
            <p className="lead">
              {initialized
                ? 'Connectez-vous avec Plex pour accéder aux collections et gérer les tags.'
                : 'Connectez le compte propriétaire Plex. Il deviendra le seul administrateur de cette instance.'}
            </p>
            <button className="plex-button" onClick={startPlex} disabled={busy}>
              {busy ? <Spinner /> : (
                <span className="plex-chevron" aria-hidden="true">
                  <svg viewBox="0 0 24 24" focusable="false">
                    <path d="m8.5 4.5 7.5 7.5-7.5 7.5" />
                  </svg>
                </span>
              )}
              {busy ? 'En attente de Plex…' : 'Continuer avec Plex'}
            </button>
            <div className="trust-row"><Check size={15} /> Aucun mot de passe Plex n’est stocké par Tagarr</div>
          </>
        ) : (
          <>
            <div className="eyebrow"><ShieldCheck size={15} /> Première configuration</div>
            <h1>Choisissez votre serveur.</h1>
            <p className="lead">Seuls les serveurs dont vous êtes propriétaire sont proposés.</p>
            <div className="server-list">
              {servers.map((server) => (
                <button key={server.clientIdentifier} className="server-choice" onClick={() => selectServer(server.clientIdentifier)} disabled={busy}>
                  <span className="server-icon"><Library size={21} /></span>
                  <span><strong>{server.name}</strong><small>{server.uri || 'Plex Media Server'}</small></span>
                  <ChevronRight size={20} />
                </button>
              ))}
            </div>
          </>
        )}
        {error && <div className="error-banner"><CircleAlert size={17} /> {error}</div>}
      </section>
      <p className="gate-footer">Tagarr · Gestion sécurisée des tags Radarr & Sonarr</p>
    </main>
  );
}

function OidcGate() {
  const authError = new URLSearchParams(window.location.search).get('authError');
  return <main className="gate">
    <div className="ambient ambient-one" />
    <div className="ambient ambient-two" />
    <section className="gate-card">
      <div className="brand brand-large"><span className="brand-mark"><Tags size={25} /></span><span>Tagarr</span></div>
      <div className="eyebrow"><ShieldCheck size={15} /> Authentification centralisée</div>
      <h1>Ravi de vous revoir.</h1>
      <p className="lead">Connectez-vous avec votre compte Authentik pour accéder aux collections et gérer les tags.</p>
      <a className="plex-button oidc-button" href="/api/auth/oidc/login">
        Continuer avec Authentik
      </a>
      <div className="trust-row"><Check size={15} /> Tagarr ne stocke pas votre mot de passe</div>
      {authError && <div className="error-banner"><CircleAlert size={17} /> {authError}</div>}
    </section>
    <p className="gate-footer">Tagarr · Gestion sécurisée des tags Radarr & Sonarr</p>
  </main>;
}

function NavGroup({ label, icon, kind, collections, page, onNavigate }: {
  label: string; icon: ReactNode; kind: MediaKind; collections: MaintainerrCollection[]; page: Page; onNavigate: (page: Page) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="nav-group">
      <button className="nav-heading" onClick={() => setOpen(!open)}>
        <span>{icon}{label}</span>{open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
      </button>
      {open && <div className="nav-children">
        {collections.map((collection) => (
          <button
            key={collection.id}
            className={page.type === 'collection' && page.id === collection.id ? 'nav-item active' : 'nav-item'}
            onClick={() => onNavigate({ type: 'collection', kind, id: collection.id, name: collection.name })}
            title={collection.name}
          >
            <FolderClock size={16} /><span>{collection.name}</span><em>{collection.itemCount}</em>
          </button>
        ))}
        <button
          className={page.type === 'library' && page.kind === kind ? 'nav-item active' : 'nav-item'}
          onClick={() => onNavigate({ type: 'library', kind })}
        >
          <Library size={16} /><span>Bibliothèque complète</span>
        </button>
      </div>}
    </div>
  );
}

function Sidebar({ state, page, onNavigate, onConfig, onLogout, mobileOpen, closeMobile }: {
  state: BootstrapState; page: Page; onNavigate: (page: Page) => void; onConfig: () => void; onLogout: () => void; mobileOpen: boolean; closeMobile: () => void;
}) {
  const byKind = (kind: MediaKind) => state.collections.filter((collection) => collection.kind === kind);
  return <>
    {mobileOpen && <button className="sidebar-scrim" aria-label="Fermer" onClick={closeMobile} />}
    <aside className={`sidebar ${mobileOpen ? 'mobile-open' : ''}`}>
      <div className="brand"><span className="brand-mark"><Tags size={21} /></span><span>Tagarr</span><button className="mobile-close" onClick={closeMobile}><X size={20} /></button></div>
      <div className="workspace-label">MÉDIATHÈQUE</div>
      <nav>
        <NavGroup label="Films" icon={<Film size={18} />} kind="movie" collections={byKind('movie')} page={page} onNavigate={onNavigate} />
        <NavGroup label="Séries" icon={<Tv size={18} />} kind="series" collections={byKind('series')} page={page} onNavigate={onNavigate} />
        <NavGroup label="Animes" icon={<Clapperboard size={18} />} kind="anime" collections={byKind('anime')} page={page} onNavigate={onNavigate} />
      </nav>
      <div className="sidebar-bottom">
        {state.user?.isAdmin && <button className="utility-link" onClick={onConfig}><Settings size={18} /> Configuration</button>}
        <div className="user-card">
          {state.user?.avatar ? <img src={state.user.avatar} alt="" /> : <span className="avatar">{state.user?.username.slice(0, 1).toUpperCase()}</span>}
          <span><strong>{state.user?.username}</strong><small>{state.user?.isAdmin ? 'Administrateur' : 'Utilisateur Plex'}</small></span>
          <button title="Déconnexion" onClick={onLogout}><LogOut size={17} /></button>
        </div>
      </div>
    </aside>
  </>;
}

function formatBytes(bytes?: number) {
  if (bytes === undefined) return '—';
  if (bytes === 0) return '0 o';
  const units = ['o', 'Ko', 'Mo', 'Go', 'To'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} ${units[index]}`;
}

function formatDate(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('fr-FR');
}

function deadlineLabel(days?: number) {
  if (days === undefined) return { text: 'Aucune action', tone: 'muted' };
  if (days < 0) return { text: `En retard de ${Math.abs(days)} j`, tone: 'danger' };
  if (days === 0) return { text: "Aujourd’hui", tone: 'danger' };
  if (days === 1) return { text: 'Demain', tone: 'warning' };
  return { text: `Dans ${days} j`, tone: days <= 7 ? 'warning' : 'normal' };
}

function SortButton({ column, active, direction, onClick, children }: { column: SortKey; active: SortKey; direction: 'asc' | 'desc'; onClick: (key: SortKey) => void; children: ReactNode }) {
  return <button className="sort-button" onClick={() => onClick(column)}>{children}{active === column && (direction === 'asc' ? <ArrowUp size={13} /> : <ArrowDown size={13} />)}</button>;
}

function MediaTable({ items, loading, isCollection, selected, setSelected, sort, direction, onSort }: {
  items: MediaItem[]; loading: boolean; isCollection: boolean; selected: Set<number>; setSelected: (value: Set<number>) => void; sort: SortKey; direction: 'asc' | 'desc'; onSort: (key: SortKey) => void;
}) {
  const allSelected = items.length > 0 && items.every((item) => selected.has(item.id));
  const showSeasons = isCollection && items.some((item) => item.kind !== 'movie');
  function toggleAll() { setSelected(allSelected ? new Set() : new Set(items.map((item) => item.id))); }
  if (loading) return <div className="table-state"><Spinner size={28} /><p>Chargement de la médiathèque…</p></div>;
  if (!items.length) return <div className="table-state"><Library size={32} /><h3>Aucun contenu</h3><p>Cette vue ne contient encore aucun média.</p></div>;
  return (
    <div className="table-wrap">
      <table>
        <thead><tr>
          <th className="check-cell"><input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Tout sélectionner" /></th>
          <th><SortButton column="title" active={sort} direction={direction} onClick={onSort}>Titre</SortButton></th>
          <th><SortButton column="year" active={sort} direction={direction} onClick={onSort}>Année</SortButton></th>
          <th><SortButton column="added" active={sort} direction={direction} onClick={onSort}>Date d’ajout</SortButton></th>
          <th>Statut</th>
          <th><SortButton column="size" active={sort} direction={direction} onClick={onSort}>Taille</SortButton></th>
          {showSeasons && <th>Saison(s)</th>}
          {isCollection && <th><SortButton column="deadline" active={sort} direction={direction} onClick={onSort}>Suppression</SortButton></th>}
          <th>Tags</th>
        </tr></thead>
        <tbody>{items.map((item) => {
          const deadline = deadlineLabel(item.daysRemaining);
          return <tr key={item.rowKey || item.id} className={selected.has(item.id) ? 'selected-row' : ''}>
            <td className="check-cell"><input type="checkbox" checked={selected.has(item.id)} onChange={() => {
              const next = new Set(selected); next.has(item.id) ? next.delete(item.id) : next.add(item.id); setSelected(next);
            }} /></td>
            <td><div className="media-title">
              <div className="poster">{item.posterUrl ? <img src={item.posterUrl} alt="" loading="lazy" /> : item.kind === 'movie' ? <Film size={20} /> : <Tv size={20} />}</div>
              <span><strong>{item.title}</strong><small>{item.overview || (item.kind === 'movie' ? 'Film Radarr' : 'Série Sonarr')}</small></span>
            </div></td>
            <td>{item.year || '—'}</td>
            <td><span className="added-date">{formatDate(item.addedAt)}</span></td>
            <td><span className={`status-dot ${item.monitored ? 'monitored' : ''}`} />{item.monitored ? 'Suivi' : 'Non suivi'}</td>
            <td>{formatBytes(item.sizeOnDisk)}</td>
            {showSeasons && <td><span className="season-info">{item.kind === 'movie' ? '—' : item.seasons?.length
              ? item.seasons.map((season) => season === 0 ? 'Spéciaux' : `S${String(season).padStart(2, '0')}`).join(', ')
              : item.seasonScoped ? 'Saison inconnue' : 'Série entière'}</span></td>}
            {isCollection && <td><div className={`deadline ${deadline.tone}`}><Clock3 size={15} /><span>{deadline.text}<small>{item.deletionAt ? new Date(item.deletionAt).toLocaleDateString('fr-FR') : ''}</small></span></div></td>}
            <td><div className="tag-list">{item.tags.length ? item.tags.map((tag) => <span className="tag" key={tag.id}>{tag.label}</span>) : <span className="no-tag">Aucun tag</span>}</div></td>
          </tr>;
        })}</tbody>
      </table>
    </div>
  );
}

function ConfigPanel({ initial, onClose, onSaved }: { initial: SafeConfig; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<AppConfig>({
    radarrUrl: initial.radarrUrl, radarrApiKey: '', sonarrUrl: initial.sonarrUrl, sonarrApiKey: '',
    maintainerrUrl: initial.maintainerrUrl, maintainerrApiKey: '', animeQualityProfileId: initial.animeQualityProfileId,
  });
  const [qualityProfiles, setQualityProfiles] = useState<QualityProfile[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  function set<K extends keyof AppConfig>(key: K, value: AppConfig[K]) { setForm((current) => ({ ...current, [key]: value })); }
  useEffect(() => {
    api<QualityProfile[]>('/api/quality-profiles')
      .then(setQualityProfiles)
      .catch(() => setQualityProfiles([]))
      .finally(() => setProfilesLoading(false));
  }, []);
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      await api('/api/config', { method: 'PUT', body: JSON.stringify(form) });
      setMessage('Configuration enregistrée.'); onSaved();
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : 'Erreur.'); }
    finally { setBusy(false); }
  }
  async function test(service: 'radarr' | 'sonarr' | 'maintainerr') {
    setMessage(`Test de ${service}…`);
    try {
      const url = form[`${service}Url` as keyof AppConfig];
      const apiKey = form[`${service}ApiKey` as keyof AppConfig];
      await api('/api/config/test', { method: 'POST', body: JSON.stringify({ service, url, apiKey }) });
      if (service === 'sonarr') {
        setProfilesLoading(true);
        const profiles = await api<QualityProfile[]>('/api/quality-profiles/preview', {
          method: 'POST', body: JSON.stringify({ url, apiKey }),
        });
        setQualityProfiles(profiles);
        setProfilesLoading(false);
      }
      setMessage(`Connexion ${service} réussie.`);
    } catch (caught) { setProfilesLoading(false); setMessage(caught instanceof Error ? caught.message : 'Connexion impossible.'); }
  }
  return <div className="modal-backdrop"><section className="config-panel">
    <header><div><span className="eyebrow">ADMINISTRATION</span><h2>Configuration</h2></div><button className="icon-button" onClick={onClose}><X size={20} /></button></header>
    <form onSubmit={save}>
      {(['radarr', 'sonarr', 'maintainerr'] as const).map((service) => {
        const urlKey = `${service}Url` as keyof AppConfig; const keyKey = `${service}ApiKey` as keyof AppConfig;
        const keySet = initial[`${service}ApiKeySet` as keyof SafeConfig];
        return <fieldset key={service}><legend>{service[0].toUpperCase() + service.slice(1)}</legend>
          <label>URL<input type="url" value={String(form[urlKey] || '')} onChange={(event) => set(urlKey, event.target.value)} placeholder={`http://${service}:0000`} /></label>
          <label>Clé API {keySet && <small>· déjà enregistrée</small>}<input type="password" value={String(form[keyKey] || '')} onChange={(event) => set(keyKey, event.target.value)} placeholder={keySet ? 'Laisser vide pour conserver' : service === 'maintainerr' ? 'Facultative selon la version' : 'Requise'} /></label>
          <button type="button" className="test-button" disabled={!form[urlKey]} onClick={() => test(service)}>Tester la connexion</button>
        </fieldset>;
      })}
      <fieldset><legend>Classification des animes</legend>
        <label>Profil de qualité Sonarr<select value={form.animeQualityProfileId} onChange={(event) => set('animeQualityProfileId', Number(event.target.value))} disabled={profilesLoading}>
          <option value={0}>{profilesLoading ? 'Chargement des profils…' : 'Aucun profil sélectionné'}</option>
          {qualityProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
        </select></label>
        <p className="field-help">Toutes les séries utilisant ce profil apparaîtront dans la section Animes.</p>
      </fieldset>
      {message && <div className="form-message">{message}</div>}
      <footer><button type="button" className="secondary-button" onClick={onClose}>Annuler</button><button className="primary-button" disabled={busy}>{busy && <Spinner />}Enregistrer</button></footer>
    </form>
  </section></div>;
}

function Dashboard({ state, refresh }: { state: BootstrapState; refresh: () => void }) {
  const [page, setPage] = useState<Page>({ type: 'library', kind: 'movie' });
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [sort, setSort] = useState<SortKey>('title');
  const [direction, setDirection] = useState<'asc' | 'desc'>('asc');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [selectedTag, setSelectedTag] = useState('');
  const [availableTags, setAvailableTags] = useState<Tag[]>([]);
  const [tagBusy, setTagBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [configOpen, setConfigOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  async function load() {
    setLoading(true); setError(''); setSelected(new Set());
    try {
      const url = page.type === 'library' ? `/api/library/${page.kind}` : `/api/collections/${page.id}/media`;
      const source = page.kind === 'movie' ? 'radarr' : 'sonarr';
      const [loadedItems, loadedTags] = await Promise.all([api<MediaItem[]>(url), api<Tag[]>(`/api/tags/${source}`)]);
      setItems(loadedItems); setAvailableTags(loadedTags);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Chargement impossible.'); setItems([]); setAvailableTags([]); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    setSort(page.type === 'collection' ? 'deadline' : 'title'); setDirection('asc'); setQuery(''); setTagFilter(''); setSelectedTag('');
    void load();
  }, [page.type, page.type === 'collection' ? page.id : page.kind]);

  const tagOptions = useMemo(() => availableTags.map((tag) => tag.label), [availableTags]);
  const visibleItems = useMemo(() => {
    const filtered = items.filter((item) => (!query.trim() || matchesSearch(item.title, query)) && (!tagFilter || item.tags.some((tag) => tag.label === tagFilter)));
    const multiplier = direction === 'asc' ? 1 : -1;
    return filtered.sort((a, b) => {
      if (sort === 'title') return a.sortTitle.localeCompare(b.sortTitle, 'fr') * multiplier;
      if (sort === 'year') return ((a.year || 0) - (b.year || 0)) * multiplier;
      if (sort === 'added') return ((Date.parse(a.addedAt || '') || 0) - (Date.parse(b.addedAt || '') || 0)) * multiplier;
      if (sort === 'size') return ((a.sizeOnDisk || 0) - (b.sizeOnDisk || 0)) * multiplier;
      return ((a.daysRemaining ?? Number.MAX_SAFE_INTEGER) - (b.daysRemaining ?? Number.MAX_SAFE_INTEGER)) * multiplier;
    });
  }, [items, query, tagFilter, sort, direction]);
  function changeSort(key: SortKey) { if (sort === key) setDirection((value) => value === 'asc' ? 'desc' : 'asc'); else { setSort(key); setDirection('asc'); } }
  async function mutateTag(action: 'add' | 'remove') {
    if (!selectedTag || !selected.size) return;
    setTagBusy(true); setNotice('');
    try {
      const source = page.kind === 'movie' ? 'radarr' : 'sonarr';
      const tag = availableTags.find((candidate) => candidate.label === selectedTag);
      if (!tag) throw new Error('Le tag sélectionné est introuvable.');
      const result = await api<{ updated: number; failed: number }>('/api/tags/bulk', {
        method: 'POST',
        body: JSON.stringify({
          source,
          mediaIds: [...selected],
          add: action === 'add' ? [selectedTag] : [],
          remove: action === 'remove' ? [tag.id] : [],
        }),
      });
      const verb = action === 'add' ? 'ajouté' : 'retiré';
      setNotice(`Tag « ${selectedTag} » ${verb} sur ${result.updated} contenu${result.updated > 1 ? 's' : ''}${result.failed ? `, ${result.failed} échec(s)` : ''}.`);
      setSelectedTag(''); await load();
    } catch (caught) { setNotice(caught instanceof Error ? caught.message : 'Modification impossible.'); }
    finally { setTagBusy(false); }
  }
  async function addTag(event: FormEvent) { event.preventDefault(); await mutateTag('add'); }
  async function logout() { await api('/api/auth/logout', { method: 'POST' }); refresh(); }
  const title = page.type === 'library' ? page.kind === 'movie' ? 'Films' : page.kind === 'series' ? 'Séries' : 'Animes' : page.name;
  const subtitle = page.type === 'collection' ? 'Collection Maintainerr' : 'Bibliothèque complète';
  return <div className="app-shell">
    <Sidebar state={state} page={page} onNavigate={(next) => { setPage(next); setMobileOpen(false); }} onConfig={() => setConfigOpen(true)} onLogout={logout} mobileOpen={mobileOpen} closeMobile={() => setMobileOpen(false)} />
    <main className="content">
      <header className="topbar"><button className="menu-button" onClick={() => setMobileOpen(true)}><Menu size={21} /></button><div className="server-pill"><span />{state.config?.plexServerName || (state.authMode === 'oidc' ? 'Authentik OIDC' : 'Plex connecté')}</div><button className="icon-button" onClick={load} title="Actualiser"><RefreshCw size={18} /></button></header>
      <section className="page-header"><div><div className="eyebrow">{page.kind.toUpperCase()}</div><h1>{title}</h1><p>{subtitle}</p></div><div className="metric"><strong>{visibleItems.length}</strong><span>contenus affichés</span></div></section>
      <section className="toolbar">
        <div className="search-box"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher un titre…" /></div>
        <select className="filter-select" value={tagFilter} onChange={(event) => setTagFilter(event.target.value)}><option value="">Tous les tags</option>{tagOptions.map((tag) => <option key={tag}>{tag}</option>)}</select>
        <div className="toolbar-spacer" />
        <span className="selection-count">{selected.size ? `${selected.size} sélectionné${selected.size > 1 ? 's' : ''}` : 'Sélectionnez des contenus'}</span>
        <form className="tag-form" onSubmit={addTag}><select value={selectedTag} onChange={(event) => setSelectedTag(event.target.value)} disabled={!selected.size || !availableTags.length} aria-label="Tag à modifier"><option value="">{availableTags.length ? 'Choisir un tag…' : 'Aucun tag disponible'}</option>{availableTags.map((tag) => <option key={tag.id} value={tag.label}>{tag.label}</option>)}</select><button className="primary-button" disabled={!selected.size || !selectedTag || tagBusy}>{tagBusy ? <Spinner /> : <Plus size={17} />}Ajouter</button><button type="button" className="remove-tag-button" disabled={!selected.size || !selectedTag || tagBusy} onClick={() => void mutateTag('remove')}><Minus size={17} />Retirer</button></form>
      </section>
      {notice && <div className="notice"><Check size={17} />{notice}<button onClick={() => setNotice('')}><X size={15} /></button></div>}
      {error && <div className="error-banner content-error"><CircleAlert size={17} /><span>{error}</span><button onClick={load}>Réessayer</button></div>}
      <MediaTable items={visibleItems} loading={loading} isCollection={page.type === 'collection'} selected={selected} setSelected={setSelected} sort={sort} direction={direction} onSort={changeSort} />
    </main>
    {configOpen && state.config && <ConfigPanel initial={state.config} onClose={() => setConfigOpen(false)} onSaved={refresh} />}
  </div>;
}

export default function App() {
  const [state, setState] = useState<BootstrapState | null>(null);
  const [error, setError] = useState('');
  async function refresh() {
    setError('');
    try { setState(await api<BootstrapState>('/api/bootstrap')); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Tagarr est indisponible.'); }
  }
  useEffect(() => { void refresh(); }, []);
  const isPlexCallback = window.location.pathname === '/auth/plex'
    && (new URLSearchParams(window.location.search).get('popup') === '1'
      || window.name === 'tagarr-plex'
      || Boolean(window.opener));
  if (isPlexCallback) return <PlexCallback />;
  if (error) return <div className="fatal"><CircleAlert size={32} /><h2>Connexion au serveur impossible</h2><p>{error}</p><button className="primary-button" onClick={refresh}>Réessayer</button></div>;
  if (!state) return <div className="splash"><span className="brand-mark"><Tags size={26} /></span><Spinner size={24} /></div>;
  if (!state.authenticated) return state.authMode === 'oidc'
    ? <OidcGate />
    : <PlexGate initialized={state.initialized} onReady={refresh} />;
  return <Dashboard state={state} refresh={refresh} />;
}
