import assert from 'node:assert/strict';
import test from 'node:test';
import { matchesSearch, normalizeSearchText } from '../src/shared/search.js';

test('normalise la casse et les accents français', () => {
  assert.equal(normalizeSearchText('  GÉRALD  '), 'gerald');
  assert.equal(matchesSearch('Gérald, le film', 'gerald'), true);
  assert.equal(matchesSearch('Gérald, le film', 'GÉRALD'), true);
});

test('conserve le comportement de recherche partielle', () => {
  assert.equal(matchesSearch('Les aventures de Gérald', 'aventures'), true);
  assert.equal(matchesSearch('Les aventures de Gérald', 'bernard'), false);
});
