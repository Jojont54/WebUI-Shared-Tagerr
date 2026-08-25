import crypto from 'node:crypto';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { z } from 'zod';
import type { AuthMode, SafeConfig, SessionUser, TagMutation } from '../shared/types.js';
import {
  claimPlexPin,
  createPlexPin,
  getAvailableTags,
  getCollectionMedia,
  getLibrary,
  getMaintainerrCollections,
  getPlexAccount,
  getPlexServers,
  getQualityProfiles,
  mutateTags,
  testService,
} from './clients.js';
import { getConfig, getSetting, isInitialized as isPlexInitialized, saveConfig, setSetting } from './database.js';
import { OidcAuthenticator, readOidcSettings, resolveAuthMode } from './oidc.js';
import { signSession, verifySession } from './security.js';

const app = express();
const port = Number(process.env.PORT || 3131);
const appUrl = process.env.APP_URL || `http://localhost:${port}`;
const authMode = resolveAuthMode();
const oidcAuthenticator = authMode === 'oidc' ? new OidcAuthenticator(readOidcSettings(appUrl)) : undefined;
const plexClientId = getSetting('plexClientId') || crypto.randomUUID();
setSetting('plexClientId', plexClientId);

interface FlowState {
  pinId: number;
  token?: string;
  account?: Awaited<ReturnType<typeof getPlexAccount>>;
  servers?: Awaited<ReturnType<typeof getPlexServers>>;
  createdAt: number;
}

interface AuthRequest extends Request {
  user?: SessionUser;
}

const flows = new Map<string, FlowState>();
const sessionCookie = 'tagarr_session';

app.use(helmet({
  contentSecurityPolicy: process.env.NODE_ENV === 'production' ? {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
    },
  } : false,
}));
app.use(express.json({ limit: '256kb' }));
app.use(cookieParser());

app.use((req: AuthRequest, _res, next) => {
  const user = verifySession<SessionUser>(req.cookies?.[sessionCookie]);
  const sessionMatchesMode = user?.authProvider === authMode || (authMode === 'plex' && !user?.authProvider);
  req.user = sessionMatchesMode ? user : undefined;
  next();
});

function requireAuth(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Authentification requise.' });
    return;
  }
  next();
}

function requireAdmin(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!req.user?.isAdmin) {
    res.status(403).json({ error: "Cette action est réservée à l'administrateur Tagarr." });
    return;
  }
  next();
}

function appInitialized(): boolean {
  return authMode === 'oidc' || isPlexInitialized();
}

function requireAuthMode(expected: AuthMode, res: Response): boolean {
  if (authMode === expected) return true;
  res.status(404).json({ error: `Le mode d'authentification ${expected} n'est pas actif.` });
  return false;
}

function setSession(res: Response, user: SessionUser): void {
  res.cookie(sessionCookie, signSession(user), {
    httpOnly: true,
    sameSite: 'lax',
    secure: appUrl.startsWith('https://'),
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

function safeConfig(): SafeConfig {
  const config = getConfig();
  return {
    plexServerName: config.plexServerName,
    plexMachineId: config.plexMachineId,
    radarrUrl: config.radarrUrl,
    sonarrUrl: config.sonarrUrl,
    maintainerrUrl: config.maintainerrUrl,
    animeQualityProfileId: config.animeQualityProfileId,
    radarrApiKeySet: Boolean(config.radarrApiKey),
    sonarrApiKeySet: Boolean(config.sonarrApiKey),
    maintainerrApiKeySet: Boolean(config.maintainerrApiKey),
  };
}

app.get('/api/health', (_req, res) => res.json({ status: 'ok', initialized: appInitialized(), authMode }));

app.get('/api/bootstrap', async (req: AuthRequest, res, next) => {
  try {
    let collections: Awaited<ReturnType<typeof getMaintainerrCollections>> = [];
    if (req.user && getConfig().maintainerrUrl) {
      try { collections = await getMaintainerrCollections(getConfig()); } catch { /* surfaced on collection page */ }
    }
    res.json({
      authMode,
      initialized: appInitialized(),
      authenticated: Boolean(req.user),
      user: req.user,
      config: req.user?.isAdmin ? safeConfig() : undefined,
      collections,
    });
  } catch (error) { next(error); }
});

app.get('/api/auth/oidc/login', async (_req, res, next) => {
  if (!requireAuthMode('oidc', res)) return;
  try {
    res.redirect((await oidcAuthenticator!.createLoginUrl()).href);
  } catch (error) { next(error); }
});

app.get('/api/auth/oidc/callback', async (req, res) => {
  if (!requireAuthMode('oidc', res)) return;
  try {
    const callbackUrl = new URL(oidcAuthenticator!.settings.redirectUri);
    callbackUrl.search = new URL(req.originalUrl, appUrl).search;
    const user = await oidcAuthenticator!.authenticate(callbackUrl);
    setSession(res, user);
    res.redirect('/');
  } catch (error) {
    console.error(error);
    res.redirect(`/?authError=${encodeURIComponent('La connexion OIDC a échoué. Vérifiez la configuration Authentik.')}`);
  }
});

app.post('/api/auth/plex/start', async (_req, res, next) => {
  if (!requireAuthMode('plex', res)) return;
  try {
    const flowId = crypto.randomUUID();
    const normalizedAppUrl = appUrl.replace(/\/$/, '');
    const pin = await createPlexPin(plexClientId, `${normalizedAppUrl}/auth/plex?popup=1`);
    flows.set(flowId, { pinId: pin.id, createdAt: Date.now() });
    res.json({ flowId, authUrl: pin.authUrl, expiresIn: 300 });
  } catch (error) { next(error); }
});

app.get('/api/auth/plex/poll/:flowId', async (req, res, next) => {
  if (!requireAuthMode('plex', res)) return;
  try {
    const flow = flows.get(req.params.flowId);
    if (!flow || Date.now() - flow.createdAt > 10 * 60 * 1000) {
      res.status(410).json({ error: 'La tentative de connexion Plex a expiré.' });
      return;
    }
    const token = flow.token || await claimPlexPin(plexClientId, flow.pinId);
    if (!token) {
      res.status(202).json({ pending: true });
      return;
    }
    flow.token = token;
    flow.account ||= await getPlexAccount(plexClientId, token);
    flow.servers ||= await getPlexServers(plexClientId, token);

    if (!isPlexInitialized()) {
      const ownedServers = flow.servers.filter((server) => server.owned);
      if (!ownedServers.length) {
        res.status(403).json({ error: "Ce compte Plex n'est propriétaire d'aucun serveur." });
        return;
      }
      res.json({ needsServer: true, servers: ownedServers.map(({ accessToken: _token, ...server }) => server) });
      return;
    }

    const machineId = getSetting('plexMachineId');
    if (!flow.servers.some((server) => server.clientIdentifier === machineId)) {
      res.status(403).json({ error: "Ce compte Plex n'a pas accès au serveur configuré." });
      return;
    }
    const user: SessionUser = {
      ...flow.account,
      isAdmin: flow.account.id === getSetting('plexOwnerId'),
      authProvider: 'plex',
    };
    setSession(res, user);
    flows.delete(req.params.flowId);
    res.json({ authenticated: true, user });
  } catch (error) { next(error); }
});

app.post('/api/setup/plex-server', async (req, res, next) => {
  if (!requireAuthMode('plex', res)) return;
  try {
    if (isPlexInitialized()) {
      res.status(409).json({ error: "L'application est déjà initialisée." });
      return;
    }
    const input = z.object({ flowId: z.string().uuid(), machineId: z.string().min(1) }).parse(req.body);
    const flow = flows.get(input.flowId);
    const server = flow?.servers?.find((item) => item.clientIdentifier === input.machineId && item.owned);
    if (!flow?.account || !flow.token || !server) {
      res.status(403).json({ error: 'Session de configuration Plex invalide.' });
      return;
    }
    setSetting('plexOwnerId', flow.account.id);
    setSetting('plexMachineId', server.clientIdentifier);
    setSetting('plexServerName', server.name);
    setSetting('plexAdminToken', server.accessToken || flow.token);
    const user: SessionUser = { ...flow.account, isAdmin: true, authProvider: 'plex' };
    setSession(res, user);
    flows.delete(input.flowId);
    res.json({ authenticated: true, user });
  } catch (error) { next(error); }
});

app.post('/api/auth/logout', (_req, res) => {
  res.clearCookie(sessionCookie, { path: '/' });
  res.status(204).end();
});

const configSchema = z.object({
  radarrUrl: z.string().url().or(z.literal('')),
  radarrApiKey: z.string().optional(),
  sonarrUrl: z.string().url().or(z.literal('')),
  sonarrApiKey: z.string().optional(),
  maintainerrUrl: z.string().url().or(z.literal('')),
  maintainerrApiKey: z.string().optional(),
  animeQualityProfileId: z.number().int().nonnegative(),
});

app.put('/api/config', requireAdmin, (req, res, next) => {
  try {
    const input = configSchema.parse(req.body);
    const existing = getConfig();
    saveConfig({
      ...input,
      radarrApiKey: input.radarrApiKey || existing.radarrApiKey,
      sonarrApiKey: input.sonarrApiKey || existing.sonarrApiKey,
      maintainerrApiKey: input.maintainerrApiKey || existing.maintainerrApiKey,
    });
    res.json(safeConfig());
  } catch (error) { next(error); }
});

app.post('/api/config/test', requireAdmin, async (req, res, next) => {
  try {
    const input = z.object({ service: z.enum(['radarr', 'sonarr', 'maintainerr']), url: z.string().url(), apiKey: z.string().optional() }).parse(req.body);
    const current = getConfig();
    const storedKey = input.service === 'radarr' ? current.radarrApiKey : input.service === 'sonarr' ? current.sonarrApiKey : current.maintainerrApiKey;
    await testService(input.service, input.url, input.apiKey || storedKey);
    res.json({ ok: true });
  } catch (error) { next(error); }
});

app.get('/api/library/:kind', requireAuth, async (req, res, next) => {
  try {
    const kind = z.enum(['movie', 'series', 'anime']).parse(req.params.kind);
    const items = kind === 'movie' ? await getLibrary(getConfig(), 'radarr') : await getLibrary(getConfig(), 'sonarr');
    res.json(items.filter((item) => item.kind === kind));
  } catch (error) { next(error); }
});

app.get('/api/collections', requireAuth, async (_req, res, next) => {
  try { res.json(await getMaintainerrCollections(getConfig())); } catch (error) { next(error); }
});

app.get('/api/collections/:id/media', requireAuth, async (req, res, next) => {
  try {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    res.json(await getCollectionMedia(getConfig(), id));
  } catch (error) { next(error); }
});

app.get('/api/quality-profiles', requireAdmin, async (_req, res, next) => {
  try { res.json(await getQualityProfiles(getConfig())); } catch (error) { next(error); }
});

app.post('/api/quality-profiles/preview', requireAdmin, async (req, res, next) => {
  try {
    const input = z.object({ url: z.string().url(), apiKey: z.string().optional() }).parse(req.body);
    const config = getConfig();
    res.json(await getQualityProfiles({
      ...config,
      sonarrUrl: input.url,
      sonarrApiKey: input.apiKey || config.sonarrApiKey,
    }));
  } catch (error) { next(error); }
});

app.get('/api/tags/:source', requireAuth, async (req, res, next) => {
  try {
    const source = z.enum(['radarr', 'sonarr']).parse(req.params.source);
    res.json(await getAvailableTags(getConfig(), source));
  } catch (error) { next(error); }
});

app.post('/api/tags/bulk', requireAuth, async (req, res, next) => {
  try {
    const mutation = z.object({
      source: z.enum(['radarr', 'sonarr']),
      mediaIds: z.array(z.number().int().positive()).min(1).max(500),
      add: z.array(z.string().min(1).max(80)).max(20),
      remove: z.array(z.number().int().positive()).max(50),
    }).parse(req.body) satisfies TagMutation;
    res.json(await mutateTags(getConfig(), mutation));
  } catch (error) { next(error); }
});

if (process.env.NODE_ENV === 'production') {
  const dist = path.resolve('dist');
  app.use(express.static(dist));
  app.get('/{*splat}', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const message = error instanceof z.ZodError
    ? error.issues.map((issue) => issue.message).join(', ')
    : error instanceof Error ? error.message : 'Erreur interne.';
  console.error(error);
  res.status(error instanceof z.ZodError ? 400 : 502).json({ error: message });
});

app.listen(port, () => {
  console.log(`Tagarr écoute sur ${appUrl} (authentification : ${authMode})`);
});
