import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validate } from './helpers/validate-schema.mjs';

const load = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));

for (const [name, dataPath, schemaPath] of [
  ['units.json', '../data/units.json', '../schema/units.schema.json'],
  ['ingredients.json', '../data/ingredients.json', '../schema/ingredients.schema.json'],
  ['aliases.json', '../data/aliases.json', '../schema/aliases.schema.json'],
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
  assert.ok(aliases.length >= 150, `only ${aliases.length} aliases`);
  for (const a of aliases) {
    if (a.model) continue;
    const rec = byFdc.get(a.fdcId);
    assert.ok(rec, `${a.id}: fdcId ${a.fdcId} not found`);
    assert.equal(a.usdaDescription, rec.description, a.id);
    assert.ok(rec.forms.some((f) => f.form === a.form), `${a.id}: form ${a.form} missing`);
  }
});
