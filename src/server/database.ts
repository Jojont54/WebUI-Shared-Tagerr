import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { AppConfig } from '../shared/types.js';
import { decrypt, encrypt } from './security.js';

const dataDir = path.resolve(process.env.DATA_DIR || './data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, 'tagarr.sqlite'));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    secret INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

const secretKeys = new Set(['radarrApiKey', 'sonarrApiKey', 'maintainerrApiKey', 'plexAdminToken']);

export function getSetting(key: string): string | undefined {
  const row = db.prepare('SELECT value, secret FROM settings WHERE key = ?').get(key) as { value: string; secret: number } | undefined;
  if (!row) return undefined;
  return row.secret ? decrypt(row.value) : row.value;
}

export function setSetting(key: string, value: string): void {
  const secret = secretKeys.has(key);
  const stored = secret ? encrypt(value) : value;
  db.prepare(`
    INSERT INTO settings (key, value, secret, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, secret = excluded.secret, updated_at = CURRENT_TIMESTAMP
  `).run(key, stored, secret ? 1 : 0);
}

export function isInitialized(): boolean {
  return Boolean(getSetting('plexOwnerId') && getSetting('plexMachineId'));
}

export function getConfig(): AppConfig {
  return {
    plexServerName: getSetting('plexServerName'),
    plexMachineId: getSetting('plexMachineId'),
    radarrUrl: getSetting('radarrUrl') || '',
    radarrApiKey: getSetting('radarrApiKey') || '',
    sonarrUrl: getSetting('sonarrUrl') || '',
    sonarrApiKey: getSetting('sonarrApiKey') || '',
    maintainerrUrl: getSetting('maintainerrUrl') || '',
    maintainerrApiKey: getSetting('maintainerrApiKey') || '',
    animeQualityProfileId: Number(getSetting('animeQualityProfileId') || 0),
  };
}

export function saveConfig(config: Partial<AppConfig>): void {
  for (const [key, value] of Object.entries(config)) {
    if (value !== undefined) setSetting(key, String(value).trim());
  }
}
