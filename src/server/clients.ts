import type { AppConfig, MaintainerrCollection, MediaItem, MediaKind, QualityProfile, Tag, TagMutation } from '../shared/types.js';
import { computeDeletionDate, daysUntil } from './dates.js';

type JsonObject = Record<string, unknown>;

function cleanUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

async function requestJson<T>(url: string, init: RequestInit = {}, timeoutMs = 12_000): Promise<T> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`${response.status} ${response.statusText}${detail ? ` — ${detail.slice(0, 180)}` : ''}`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function arrHeaders(apiKey: string): HeadersInit {
  return { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Api-Key': apiKey };
}

function asRecord(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}

function firstValue(obj: JsonObject, keys: string[]): unknown {
  for (const key of keys) if (obj[key] !== undefined && obj[key] !== null) return obj[key];
  return undefined;
}

function firstString(obj: JsonObject, keys: string[]): string | undefined {
  const value = firstValue(obj, keys);
  return typeof value === 'string' && value ? value : undefined;
}

function firstNumber(obj: JsonObject, keys: string[]): number | undefined {
  const value = firstValue(obj, keys);
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function extractArray(value: unknown, keys: string[]): unknown[] {
  if (Array.isArray(value)) return value;
  const obj = asRecord(value);
  for (const key of keys) if (Array.isArray(obj[key])) return obj[key] as unknown[];
  return [];
}

export interface PlexPin {
  id: number;
  code: string;
  authUrl: string;
}

export interface PlexAccount {
  id: string;
  username: string;
  email?: string;
  avatar?: string;
}

export interface PlexServer {
  name: string;
  clientIdentifier: string;
  owned: boolean;
  accessToken?: string;
  uri?: string;
}

const plexHeaders = (clientId: string): HeadersInit => ({
  Accept: 'application/json',
  'X-Plex-Product': 'Tagarr',
  'X-Plex-Version': '0.1.0',
  'X-Plex-Client-Identifier': clientId,
});

export async function createPlexPin(clientId: string, forwardUrl: string): Promise<PlexPin> {
  const pin = await requestJson<{ id: number; code: string }>('https://plex.tv/api/v2/pins?strong=true', {
    method: 'POST',
    headers: plexHeaders(clientId),
  });
  const params = new URLSearchParams({
    clientID: clientId,
    code: pin.code,
    forwardUrl,
    'context[device][product]': 'Tagarr',
  });
  return { ...pin, authUrl: `https://app.plex.tv/auth#?${params.toString()}` };
}

export async function claimPlexPin(clientId: string, pinId: number): Promise<string | undefined> {
  const pin = await requestJson<{ authToken?: string | null }>(`https://plex.tv/api/v2/pins/${pinId}`, {
    headers: plexHeaders(clientId),
  });
  return pin.authToken || undefined;
}

export async function getPlexAccount(clientId: string, token: string): Promise<PlexAccount> {
  const data = await requestJson<JsonObject>('https://plex.tv/api/v2/user', {
    headers: { ...plexHeaders(clientId), 'X-Plex-Token': token },
  });
  return {
    id: String(firstValue(data, ['id', 'uuid']) || ''),
    username: firstString(data, ['username', 'title']) || 'Utilisateur Plex',
    email: firstString(data, ['email']),
    avatar: firstString(data, ['thumb', 'avatar']),
  };
}

export async function getPlexServers(clientId: string, token: string): Promise<PlexServer[]> {
  const data = await requestJson<unknown>('https://plex.tv/api/v2/resources?includeHttps=1&includeRelay=1', {
    headers: { ...plexHeaders(clientId), 'X-Plex-Token': token },
  });
  return extractArray(data, ['resources']).filter((entry) => {
    const obj = asRecord(entry);
    return String(obj.provides || '').split(',').includes('server');
  }).map((entry) => {
    const obj = asRecord(entry);
    const connections = extractArray(obj.connections, []);
    const preferred = connections.map(asRecord).find((connection) => connection.local === true && connection.protocol === 'https')
      || connections.map(asRecord).find((connection) => connection.local === true)
      || connections.map(asRecord)[0];
    return {
      name: firstString(obj, ['name']) || 'Plex Media Server',
      clientIdentifier: firstString(obj, ['clientIdentifier']) || '',
      owned: obj.owned === true,
      accessToken: firstString(obj, ['accessToken']),
      uri: preferred ? firstString(preferred, ['uri']) : undefined,
    };
  }).filter((server) => server.clientIdentifier);
}

interface RawArrMedia extends JsonObject {
  id: number;
  title: string;
  tags?: number[];
}

function mapArrMedia(raw: RawArrMedia, kind: MediaKind, tags: Map<number, Tag>): MediaItem {
  const images = extractArray(raw.images, []).map(asRecord);
  const poster = images.find((image) => image.coverType === 'poster');
  const statistics = asRecord(raw.statistics);
  return {
    id: Number(raw.id),
    kind,
    title: String(raw.title || 'Sans titre'),
    sortTitle: String(raw.sortTitle || raw.title || ''),
    year: firstNumber(raw, ['year']),
    status: firstString(raw, ['status']),
    overview: firstString(raw, ['overview']),
    addedAt: firstString(raw, ['added']),
    monitored: raw.monitored !== false,
    sizeOnDisk: firstNumber(statistics, ['sizeOnDisk']),
    posterUrl: poster ? firstString(poster, ['remoteUrl', 'url']) : undefined,
    tags: (Array.isArray(raw.tags) ? raw.tags : []).map((id) => tags.get(Number(id))).filter((tag): tag is Tag => Boolean(tag)),
    tmdbId: firstNumber(raw, ['tmdbId']),
    tvdbId: firstNumber(raw, ['tvdbId']),
  };
}

async function getArrTags(baseUrl: string, apiKey: string): Promise<Tag[]> {
  return requestJson<Tag[]>(`${cleanUrl(baseUrl)}/api/v3/tag`, { headers: arrHeaders(apiKey) });
}

export async function getAvailableTags(config: AppConfig, source: 'radarr' | 'sonarr'): Promise<Tag[]> {
  const baseUrl = source === 'radarr' ? config.radarrUrl : config.sonarrUrl;
  const apiKey = source === 'radarr' ? config.radarrApiKey : config.sonarrApiKey;
  if (!baseUrl || !apiKey) return [];
  return (await getArrTags(baseUrl, apiKey)).sort((a, b) => a.label.localeCompare(b.label, 'fr'));
}

export async function getQualityProfiles(config: AppConfig): Promise<QualityProfile[]> {
  if (!config.sonarrUrl || !config.sonarrApiKey) return [];
  const profiles = await requestJson<QualityProfile[]>(`${cleanUrl(config.sonarrUrl)}/api/v3/qualityprofile`, {
    headers: arrHeaders(config.sonarrApiKey),
  });
  return profiles.map(({ id, name }) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

export async function getLibrary(config: AppConfig, source: 'radarr' | 'sonarr'): Promise<MediaItem[]> {
  const baseUrl = source === 'radarr' ? config.radarrUrl : config.sonarrUrl;
  const apiKey = source === 'radarr' ? config.radarrApiKey : config.sonarrApiKey;
  if (!baseUrl || !apiKey) return [];
  const [rawItems, allTags] = await Promise.all([
    requestJson<RawArrMedia[]>(`${cleanUrl(baseUrl)}/api/v3/${source === 'radarr' ? 'movie' : 'series'}`, { headers: arrHeaders(apiKey) }),
    getArrTags(baseUrl, apiKey),
  ]);
  const tagMap = new Map(allTags.map((tag) => [tag.id, tag]));
  return rawItems.map((item) => {
    let kind: MediaKind = source === 'radarr' ? 'movie' : 'series';
    if (source === 'sonarr') {
      const qualityProfileId = firstNumber(item, ['qualityProfileId']);
      if (config.animeQualityProfileId > 0 && qualityProfileId === config.animeQualityProfileId) kind = 'anime';
    }
    return mapArrMedia(item, kind, tagMap);
  });
}

async function ensureTags(baseUrl: string, apiKey: string, labels: string[]): Promise<Tag[]> {
  const current = await getArrTags(baseUrl, apiKey);
  const byLabel = new Map(current.map((tag) => [tag.label.toLowerCase(), tag]));
  for (const rawLabel of labels) {
    const label = rawLabel.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '');
    if (!label || byLabel.has(label)) continue;
    const created = await requestJson<Tag>(`${cleanUrl(baseUrl)}/api/v3/tag`, {
      method: 'POST', headers: arrHeaders(apiKey), body: JSON.stringify({ label }),
    });
    byLabel.set(created.label.toLowerCase(), created);
  }
  return labels.map((label) => byLabel.get(label.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, ''))).filter((tag): tag is Tag => Boolean(tag));
}

export async function mutateTags(config: AppConfig, mutation: TagMutation): Promise<{ updated: number; failed: number }> {
  const baseUrl = mutation.source === 'radarr' ? config.radarrUrl : config.sonarrUrl;
  const apiKey = mutation.source === 'radarr' ? config.radarrApiKey : config.sonarrApiKey;
  if (!baseUrl || !apiKey) throw new Error(`${mutation.source} n'est pas configuré.`);
  const entity = mutation.source === 'radarr' ? 'movie' : 'series';
  const newTags = await ensureTags(baseUrl, apiKey, mutation.add);
  const addIds = newTags.map((tag) => tag.id);
  const removeIds = new Set(mutation.remove);
  const results = await Promise.allSettled(mutation.mediaIds.map(async (id) => {
    const item = await requestJson<RawArrMedia>(`${cleanUrl(baseUrl)}/api/v3/${entity}/${id}`, { headers: arrHeaders(apiKey) });
    const tags = [...new Set([...(item.tags || []).filter((tagId) => !removeIds.has(tagId)), ...addIds])];
    await requestJson(`${cleanUrl(baseUrl)}/api/v3/${entity}/${id}`, {
      method: 'PUT', headers: arrHeaders(apiKey), body: JSON.stringify({ ...item, tags }),
    });
  }));
  return {
    updated: results.filter((result) => result.status === 'fulfilled').length,
    failed: results.filter((result) => result.status === 'rejected').length,
  };
}

function maintainerrHeaders(apiKey?: string): HeadersInit {
  return apiKey ? { Accept: 'application/json', Authorization: `Bearer ${apiKey}`, 'X-Api-Key': apiKey } : { Accept: 'application/json' };
}

const seasonMetadataCache = new Map<string, { season?: number; expiresAt: number }>();

async function getMaintainerrSeasonNumbers(config: AppConfig, rawItems: unknown[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  const base = cleanUrl(config.maintainerrUrl);
  const mediaIds = [...new Set(rawItems.map((item) => firstString(asRecord(item), ['mediaServerId'])).filter((id): id is string => Boolean(id)))];
  for (let offset = 0; offset < mediaIds.length; offset += 12) {
    const batch = mediaIds.slice(offset, offset + 12);
    await Promise.all(batch.map(async (mediaId) => {
      const cacheKey = `${base}:${mediaId}`;
      const cached = seasonMetadataCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        if (cached.season !== undefined) result.set(mediaId, cached.season);
        return;
      }
      try {
        const metadata = await requestJson<JsonObject>(`${base}/api/media-server/meta/${encodeURIComponent(mediaId)}`, {
          headers: maintainerrHeaders(config.maintainerrApiKey),
        });
        const season = String(metadata.type || '').toLowerCase() === 'season' ? firstNumber(metadata, ['index', 'seasonNumber']) : undefined;
        seasonMetadataCache.set(cacheKey, { season, expiresAt: Date.now() + 15 * 60 * 1000 });
        if (season !== undefined) result.set(mediaId, season);
      } catch {
        seasonMetadataCache.set(cacheKey, { expiresAt: Date.now() + 60 * 1000 });
      }
    }));
  }
  return result;
}

function collectionKind(raw: JsonObject): MediaKind {
  const library = asRecord(raw.library);
  const value = String(firstValue(raw, ['type', 'mediaType', 'kind']) || firstValue(library, ['type', 'mediaType']) || '').toLowerCase();
  return value.includes('movie') || value === '1' ? 'movie' : 'series';
}

function getCollectionItems(raw: JsonObject): unknown[] {
  for (const key of ['media', 'items', 'collectionMedia', 'children']) {
    if (Array.isArray(raw[key])) return raw[key] as unknown[];
  }
  return [];
}

function normalizeCollection(rawValue: unknown): { summary: MaintainerrCollection; raw: JsonObject } {
  const raw = asRecord(rawValue);
  const rule = asRecord(firstValue(raw, ['ruleGroup', 'rule', 'rules']));
  const name = firstString(raw, ['name', 'title']) || firstString(rule, ['name', 'title']) || 'Collection Maintainerr';
  const actionAfterDays = firstNumber(raw, ['actionAfterDays', 'deleteAfterDays', 'days', 'amount'])
    ?? firstNumber(rule, ['actionAfterDays', 'deleteAfterDays', 'days', 'amount']);
  const action = String(firstValue(raw, ['action', 'radarrAction', 'sonarrAction']) || firstValue(rule, ['action', 'radarrAction', 'sonarrAction']) || '').toLowerCase();
  const items = getCollectionItems(raw);
  return {
    raw,
    summary: {
      id: firstNumber(raw, ['id']) || 0,
      name,
      kind: collectionKind(raw),
      itemCount: firstNumber(raw, ['itemCount', 'mediaCount', 'count']) ?? items.length,
      actionAfterDays,
      actionEnabled: action ? !action.includes('nothing') && !action.includes('none') : actionAfterDays !== undefined,
    },
  };
}

async function getMaintainerrRaw(config: AppConfig): Promise<Array<{ summary: MaintainerrCollection; raw: JsonObject }>> {
  if (!config.maintainerrUrl) return [];
  const base = cleanUrl(config.maintainerrUrl);
  let data: unknown;
  try {
    data = await requestJson(`${base}/api/collections/overlay-data`, { headers: maintainerrHeaders(config.maintainerrApiKey) });
  } catch {
    data = await requestJson(`${base}/api/collections`, { headers: maintainerrHeaders(config.maintainerrApiKey) });
  }
  return extractArray(data, ['collections', 'results', 'data']).map(normalizeCollection).filter((entry) => entry.summary.id > 0);
}

export async function getMaintainerrCollections(config: AppConfig): Promise<MaintainerrCollection[]> {
  const collections = await getMaintainerrRaw(config);
  if (!collections.some((entry) => entry.summary.kind === 'series') || config.animeQualityProfileId <= 0) {
    return collections.map((entry) => entry.summary);
  }
  try {
    const animeSeries = (await getLibrary(config, 'sonarr')).filter((item) => item.kind === 'anime');
    const animeTmdbIds = new Set(animeSeries.map((item) => item.tmdbId).filter((id): id is number => id !== undefined));
    const animeTvdbIds = new Set(animeSeries.map((item) => item.tvdbId).filter((id): id is number => id !== undefined));
    return collections.map((entry) => {
      if (entry.summary.kind !== 'series') return entry.summary;
      const containsAnime = getCollectionItems(entry.raw).some((rawItem) => {
        const identity = mediaIdentity(asRecord(rawItem));
        return (identity.tmdbId !== undefined && animeTmdbIds.has(identity.tmdbId))
          || (identity.tvdbId !== undefined && animeTvdbIds.has(identity.tvdbId));
      });
      return containsAnime ? { ...entry.summary, kind: 'anime' as const } : entry.summary;
    });
  } catch {
    return collections.map((entry) => entry.summary);
  }
}

function mediaIdentity(raw: JsonObject): { tmdbId?: number; tvdbId?: number; plexId?: string } {
  const nested = asRecord(firstValue(raw, ['media', 'metadata', 'plexData', 'jellyfinData']));
  const parent = asRecord(firstValue(nested, ['parent', 'series', 'show']));
  return {
    tmdbId: firstNumber(raw, ['tmdbId', 'tmdb_id']) ?? firstNumber(nested, ['tmdbId', 'tmdb_id']) ?? firstNumber(parent, ['tmdbId', 'tmdb_id']),
    tvdbId: firstNumber(raw, ['tvdbId', 'tvdb_id']) ?? firstNumber(nested, ['tvdbId', 'tvdb_id']) ?? firstNumber(parent, ['tvdbId', 'tvdb_id']),
    plexId: firstString(raw, ['plexId', 'ratingKey', 'mediaServerId']) ?? firstString(nested, ['plexId', 'ratingKey', 'mediaServerId']) ?? firstString(parent, ['plexId', 'ratingKey', 'mediaServerId']),
  };
}

function mediaSeasons(raw: JsonObject): number[] {
  const nested = asRecord(firstValue(raw, ['media', 'metadata', 'plexData', 'jellyfinData']));
  const values: unknown[] = [
    firstValue(raw, ['seasonNumber', 'season_number', 'season']),
    firstValue(nested, ['seasonNumber', 'season_number', 'season']),
  ];
  for (const owner of [raw, nested]) {
    const seasons = firstValue(owner, ['seasons', 'seasonNumbers']);
    if (Array.isArray(seasons)) values.push(...seasons.map((season) => {
      const entry = asRecord(season);
      return firstValue(entry, ['seasonNumber', 'season_number', 'number']) ?? season;
    }));
  }
  return [...new Set(values.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value >= 0))].sort((a, b) => a - b);
}

export async function getCollectionMedia(config: AppConfig, collectionId: number): Promise<MediaItem[]> {
  const collections = await getMaintainerrRaw(config);
  const collection = collections.find((entry) => entry.summary.id === collectionId);
  if (!collection) return [];
  let rawItems = getCollectionItems(collection.raw);
  if (!rawItems.length) {
    const base = cleanUrl(config.maintainerrUrl);
    const detail = await requestJson<unknown>(`${base}/api/collections/collection/${collectionId}`, { headers: maintainerrHeaders(config.maintainerrApiKey) });
    rawItems = getCollectionItems(asRecord(detail));
  }
  const seasonScoped = String(collection.raw.type || '').toLowerCase() === 'season';
  const resolvedSeasons = seasonScoped ? await getMaintainerrSeasonNumbers(config, rawItems) : new Map<string, number>();
  const [movies, series] = await Promise.all([getLibrary(config, 'radarr'), getLibrary(config, 'sonarr')]);
  const library = [...movies, ...series];
  return rawItems.map((rawValue) => {
    const raw = asRecord(rawValue);
    const identity = mediaIdentity(raw);
    const mediaServerId = firstString(raw, ['mediaServerId']);
    const collectionMediaId = firstNumber(raw, ['id']);
    const match = library.find((item) =>
      (identity.tmdbId && item.tmdbId === identity.tmdbId)
      || (identity.tvdbId && item.tvdbId === identity.tvdbId)
      || (identity.plexId && item.plexId === identity.plexId));
    const addedAt = firstString(raw, ['addedAt', 'addDate', 'createdAt', 'collectionAddedAt', 'insertedAt']);
    const maintainerrDays = collection.summary.actionEnabled
      ? firstNumber(raw, ['daysUntilAction', 'daysUntilDeletion', 'daysLeft'])
      : undefined;
    const computedDeletionAt = computeDeletionDate(addedAt, collection.summary.actionEnabled ? collection.summary.actionAfterDays : undefined);
    const deletionAt = maintainerrDays === undefined
      ? computedDeletionAt
      : new Date(Date.now() + maintainerrDays * 86_400_000).toISOString();
    return {
      ...(match || {
        id: firstNumber(raw, ['radarrId', 'sonarrId', 'id']) || 0,
        kind: collection.summary.kind,
        title: firstString(raw, ['title', 'name']) || 'Média inconnu',
        sortTitle: firstString(raw, ['title', 'name']) || '',
        monitored: true,
        tags: [],
      }),
      ...identity,
      rowKey: `${collectionId}:${collectionMediaId ?? mediaServerId ?? firstString(raw, ['addDate']) ?? firstNumber(raw, ['tmdbId', 'tvdbId']) ?? 'unknown'}`,
      collectionId,
      collectionName: collection.summary.name,
      addedToCollectionAt: addedAt,
      deletionAt,
      daysRemaining: maintainerrDays ?? daysUntil(deletionAt),
      seasons: seasonScoped && mediaServerId && resolvedSeasons.has(mediaServerId)
        ? [resolvedSeasons.get(mediaServerId)!]
        : mediaSeasons(raw),
      seasonScoped,
    } satisfies MediaItem;
  });
}

export async function testService(service: 'radarr' | 'sonarr' | 'maintainerr', url: string, apiKey?: string): Promise<void> {
  const base = cleanUrl(url);
  if (service === 'maintainerr') {
    await requestJson(`${base}/api/health`, { headers: maintainerrHeaders(apiKey) });
    return;
  }
  await requestJson(`${base}/api/v3/system/status`, { headers: arrHeaders(apiKey || '') });
}
