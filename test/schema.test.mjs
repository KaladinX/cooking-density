import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validate } from './helpers/validate-schema.mjs';

const load = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));

for (const [name, dataPath, schemaPath] of [
  ['units.json', '../data/units.json', '../schema/units.schema.json'],
  ['ingredients.json', '../data/ingredients.json', '../schema/ingredients.schema.json'],
  ['aliases.json', '../data/aliases.json', '../schema/aliases.schema.json'],
  ['egg-sizes.json', '../data/egg-sizes.json', '../schema/egg-sizes.schema.json'],
  ['measurements.json', '../data/measurements.json', '../schema/measurements.schema.json'],
  ['branded-gaps.json', '../data/branded-gaps.json', '../schema/branded-gaps.schema.json'],
]) {
  test(`${name} validates against its schema`, () => {
    const errors = validate(load(dataPath), load(schemaPath));
    assert.deepEqual(errors, []);
  });
}

test('the validator rejects bad data', () => {
  const schema = load('../schema/units.schema.json');
  assert.ok(validate({ schemaVersion: 2, units: [] }, schema).length > 0);
  assert.ok(validate({ schemaVersion: 1, units: [{ id: 'x:y', name: 'y', system: 'bogus', kind: 'volume', ml: 1 }] }, schema).length > 0);
  assert.ok(validate({ schemaVersion: 1, units: [{ id: 'metric:cup', name: 'cup', system: 'metric', kind: 'volume', ml: -1 }] }, schema).length > 0);
  const ing = load('../schema/ingredients.schema.json');
  assert.ok(validate({ schemaVersion: 1 }, ing).length > 0);
});

test('every alias points at a real USDA record, form and description', () => {
  const ingredients = load('../data/ingredients.json').ingredients;
  const byFdc = new Map(ingredients.map((i) => [i.fdcId, i]));
  const { aliases } = load('../data/aliases.json');
  assert.ok(aliases.length >= 200, `only ${aliases.length} aliases`);
  for (const a of aliases) {
    if (a.model || a.branded || a.ambiguousBetween) continue;
    const rec = byFdc.get(a.fdcId);
    assert.ok(rec, `${a.id}: fdcId ${a.fdcId} not found`);
    assert.equal(a.usdaDescription, rec.description, a.id);
    if (a.form === undefined) assert.equal(rec.forms.length, 0, `${a.id}: only count-only aliases may omit form`);
    else assert.ok(rec.forms.some((f) => f.form === a.form), `${a.id}: form ${a.form} missing`);
    if (a.defaultUnit) assert.ok(rec.counts?.some((c) => c.label === a.defaultUnit), `${a.id}: defaultUnit ${a.defaultUnit} is not a count of ${a.usdaDescription}`);
  }
});

test('branded aliases and ambiguous aliases point at real gaps', () => {
  const gaps = new Map(load('../data/branded-gaps.json').gaps.map((g) => [g.id, g]));
  const { aliases } = load('../data/aliases.json');
  const ids = new Set(aliases.map((a) => a.id));
  for (const a of aliases.filter((x) => x.branded)) assert.ok(gaps.get(a.branded)?.n > 0, a.id);
  for (const a of aliases.filter((x) => x.ambiguousBetween)) for (const id of a.ambiguousBetween) assert.ok(ids.has(id), `${a.id} -> ${id}`);
});

test('no two aliases share a normalised name or id', () => {
  const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const { aliases } = load('../data/aliases.json');
  const owner = new Map();
  const clashes = [];
  for (const a of aliases) {
    for (const key of new Set([a.id, ...a.names].map(norm))) {
      const prior = owner.get(key);
      if (prior !== undefined && prior !== a.id) clashes.push(`"${key}": ${prior} and ${a.id}`);
      else owner.set(key, a.id);
    }
  }
  assert.deepEqual(clashes, []);
});
