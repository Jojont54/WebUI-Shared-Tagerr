import assert from 'node:assert/strict';
import test from 'node:test';
import { computeDeletionDate, daysUntil } from '../src/server/dates.js';

test('calcule la date de suppression depuis la date d’entrée Maintainerr', () => {
  assert.equal(computeDeletionDate('2026-08-01T12:00:00.000Z', 30), '2026-08-31T12:00:00.000Z');
});

test('calcule les jours calendaires restants', () => {
  assert.equal(daysUntil('2026-08-24T23:00:00.000Z', new Date('2026-08-23T01:00:00.000Z')), 1);
  assert.equal(daysUntil('2026-08-23T23:00:00.000Z', new Date('2026-08-23T01:00:00.000Z')), 0);
  assert.equal(daysUntil('2026-08-20T23:00:00.000Z', new Date('2026-08-23T01:00:00.000Z')), -3);
});

test('ignore les dates invalides et les collections sans délai', () => {
  assert.equal(computeDeletionDate('invalide', 30), undefined);
  assert.equal(computeDeletionDate('2026-08-01T00:00:00Z', undefined), undefined);
  assert.equal(daysUntil(undefined), undefined);
});
