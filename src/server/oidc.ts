import * as oidc from 'openid-client';
import type { AuthMode, SessionUser } from '../shared/types.js';

const flowLifetimeMs = 10 * 60 * 1000;

export interface OidcSettings {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  adminGroup: string;
  scopes: string;
}

interface OidcFlow {
  state: string;
  nonce: string;
  codeVerifier: string;
  createdAt: number;
}

export function resolveAuthMode(env: NodeJS.ProcessEnv = process.env): AuthMode {
  const value = (env.AUTH_MODE || env.AUTH_MOD || 'plex').trim().toLowerCase();
  if (value !== 'plex' && value !== 'oidc') {
    throw new Error(`AUTH_MODE doit valoir "plex" ou "oidc" (valeur reçue : ${value || 'vide'}).`);
  }
  return value;
}

export function readOidcSettings(appUrl: string, env: NodeJS.ProcessEnv = process.env): OidcSettings {
  const issuer = env.OIDC_ISSUER?.trim();
  const clientId = env.OIDC_CLIENT_ID?.trim();
  const clientSecret = env.OIDC_CLIENT_SECRET?.trim();
  if (!issuer || !clientId || !clientSecret) {
    throw new Error('OIDC_ISSUER, OIDC_CLIENT_ID et OIDC_CLIENT_SECRET sont requis quand AUTH_MODE=oidc.');
  }
  try { new URL(issuer); } catch { throw new Error('OIDC_ISSUER doit être une URL valide.'); }

  const normalizedAppUrl = appUrl.replace(/\/$/, '');
  const requestedScopes = (env.OIDC_SCOPES || 'openid profile email').trim().split(/\s+/).filter(Boolean);
  const scopes = ['openid', ...requestedScopes.filter((scope) => scope !== 'openid')].join(' ');
  return {
    issuer,
    clientId,
    clientSecret,
    redirectUri: `${normalizedAppUrl}/api/auth/oidc/callback`,
    adminGroup: env.OIDC_ADMIN_GROUP?.trim() || 'tagarr-admin',
    scopes,
  };
}

function claimString(claims: Record<string, unknown>, names: string[]): string | undefined {
  for (const name of names) {
    const value = claims[name];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function claimGroups(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === 'string');
  if (typeof value === 'string') return value.split(/[|,]/).map((entry) => entry.trim()).filter(Boolean);
  return [];
}

export function oidcClaimsToUser(claims: Record<string, unknown>, adminGroup: string): SessionUser {
  const id = claimString(claims, ['sub']);
  if (!id) throw new Error('Le token OIDC ne contient pas de claim sub valide.');
  const username = claimString(claims, ['preferred_username', 'name', 'email']) || id;
  const groups = claimGroups(claims.groups);
  return {
    id,
    username,
    email: claimString(claims, ['email']),
    avatar: claimString(claims, ['picture']),
    isAdmin: groups.includes(adminGroup),
    authProvider: 'oidc',
  };
}

export class OidcAuthenticator {
  private readonly flows = new Map<string, OidcFlow>();
  private configuration?: Promise<oidc.Configuration>;

  constructor(readonly settings: OidcSettings) {}

  private getConfiguration(): Promise<oidc.Configuration> {
    this.configuration ||= oidc.discovery(
      new URL(this.settings.issuer),
      this.settings.clientId,
      { client_secret: this.settings.clientSecret },
      oidc.ClientSecretBasic(),
    );
    return this.configuration;
  }

  async createLoginUrl(): Promise<URL> {
    const now = Date.now();
    for (const [state, flow] of this.flows) {
      if (now - flow.createdAt > flowLifetimeMs) this.flows.delete(state);
    }

    const configuration = await this.getConfiguration();
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    const codeVerifier = oidc.randomPKCECodeVerifier();
    const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
    this.flows.set(state, { state, nonce, codeVerifier, createdAt: now });
    return oidc.buildAuthorizationUrl(configuration, {
      redirect_uri: this.settings.redirectUri,
      scope: this.settings.scopes,
      response_type: 'code',
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });
  }

  async authenticate(callbackUrl: URL): Promise<SessionUser> {
    const state = callbackUrl.searchParams.get('state');
    const flow = state ? this.flows.get(state) : undefined;
    if (!flow || Date.now() - flow.createdAt > flowLifetimeMs) {
      if (state) this.flows.delete(state);
      throw new Error('La tentative de connexion OIDC est invalide ou a expiré.');
    }
    this.flows.delete(flow.state);

    const configuration = await this.getConfiguration();
    const tokens = await oidc.authorizationCodeGrant(configuration, callbackUrl, {
      pkceCodeVerifier: flow.codeVerifier,
      expectedState: flow.state,
      expectedNonce: flow.nonce,
      idTokenExpected: true,
    });
    const claims = tokens.claims();
    if (!claims) throw new Error("Authentik n'a pas retourné d'ID Token OIDC.");
    return oidcClaimsToUser(claims as Record<string, unknown>, this.settings.adminGroup);
  }
}
