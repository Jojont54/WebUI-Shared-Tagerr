export type MediaKind = 'movie' | 'series' | 'anime';
export type AuthMode = 'plex' | 'oidc';

export interface Tag {
  id: number;
  label: string;
}

export interface MediaItem {
  id: number;
  rowKey?: string;
  kind: MediaKind;
  title: string;
  sortTitle: string;
  year?: number;
  status?: string;
  overview?: string;
  monitored: boolean;
  sizeOnDisk?: number;
  posterUrl?: string;
  tags: Tag[];
  tmdbId?: number;
  tvdbId?: number;
  plexId?: string;
  collectionId?: number;
  collectionName?: string;
  addedAt?: string;
  addedToCollectionAt?: string;
  deletionAt?: string;
  daysRemaining?: number;
  seasons?: number[];
  seasonScoped?: boolean;
}

export interface MaintainerrCollection {
  id: number;
  name: string;
  kind: MediaKind;
  itemCount: number;
  actionAfterDays?: number;
  actionEnabled: boolean;
}

export interface AppConfig {
  plexServerName?: string;
  plexMachineId?: string;
  radarrUrl: string;
  radarrApiKey: string;
  sonarrUrl: string;
  sonarrApiKey: string;
  maintainerrUrl: string;
  maintainerrApiKey?: string;
  animeQualityProfileId: number;
}

export interface SafeConfig extends Omit<AppConfig, 'radarrApiKey' | 'sonarrApiKey' | 'maintainerrApiKey'> {
  radarrApiKeySet: boolean;
  sonarrApiKeySet: boolean;
  maintainerrApiKeySet: boolean;
}

export interface SessionUser {
  id: string;
  username: string;
  email?: string;
  avatar?: string;
  isAdmin: boolean;
  authProvider?: AuthMode;
}

export interface BootstrapState {
  authMode: AuthMode;
  initialized: boolean;
  authenticated: boolean;
  user?: SessionUser;
  config?: SafeConfig;
  collections: MaintainerrCollection[];
}

export interface TagMutation {
  source: 'radarr' | 'sonarr';
  mediaIds: number[];
  add: string[];
  remove: number[];
}

export interface QualityProfile {
  id: number;
  name: string;
}
