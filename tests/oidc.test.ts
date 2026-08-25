import assert from 'node:assert/strict';
import test from 'node:test';
import { oidcClaimsToUser, readOidcSettings, resolveAuthMode } from '../src/server/oidc.js';

test('utilise Plex par défaut et accepte AUTH_MOD comme alias', () => {
  assert.equal(resolveAuthMode({}), 'plex');
  assert.equal(resolveAuthMode({ AUTH_MOD: 'OIDC' }), 'oidc');
  assert.equal(resolveAuthMode({ AUTH_MODE: 'plex', AUTH_MOD: 'oidc' }), 'plex');
  assert.throws(() => resolveAuthMode({ AUTH_MODE: 'basic' }), /plex.*oidc/);
});

test('construit une configuration OIDC sans refresh token implicite', () => {
  const settings = readOidcSettings('https://tagarr.example.com/', {
    OIDC_ISSUER: 'https://auth.example.com/application/o/tagarr/',
    OIDC_CLIENT_ID: 'tagarr',
    OIDC_CLIENT_SECRET: 'secret',
    OIDC_SCOPES: 'profile email',
  });
  assert.equal(settings.redirectUri, 'https://tagarr.example.com/api/auth/oidc/callback');
  assert.equal(settings.scopes, 'openid profile email');
  assert.equal(settings.adminGroup, 'tagarr-admin');
  assert.equal(settings.scopes.includes('offline_access'), false);
});

test('ignore email_verified et attribue le rôle depuis le groupe OIDC', () => {
  const user = oidcClaimsToUser({
    sub: 'authentik-user-id',
    preferred_username: 'test-user',
    email: 'user@example.com',
    email_verified: false,
    groups: ['users', 'tagarr-admin'],
  }, 'tagarr-admin');
  assert.equal(user.id, 'authentik-user-id');
  assert.equal(user.email, 'user@example.com');
  assert.equal(user.isAdmin, true);
  assert.equal(user.authProvider, 'oidc');
});

test('refuse un token OIDC sans identifiant sub', () => {
  assert.throws(() => oidcClaimsToUser({ email: 'user@example.com' }, 'tagarr-admin'), /claim sub/);
});
