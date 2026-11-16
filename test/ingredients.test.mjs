import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const data = JSON.parse(readFileSync(new URL('../data/ingredients.json', import.meta.url), 'utf8'));
const byFdc = new Map(data.ingredients.map((i) => [i.fdcId, i]));
const density = (fdcId, form = 'default') => byFdc.get(fdcId).forms.find((f) => f.form === form).densityGPerMl;
const near = (actual, expected, tol = 0.002) =>
  assert.ok(Math.abs(actual - expected) < tol, `${actual} not within ${tol} of ${expected}`);

test('output is sorted by id with unique ids', () => {
  const ids = data.ingredients.map((i) => i.id);
  assert.deepEqual(ids, [...ids].sort());
  assert.equal(new Set(ids).size, ids.length);
});

test('all-purpose flour, bleached: 125 g per US cup', () => {
  assert.equal(byFdc.get(168894).description, 'Wheat flour, white, all-purpose, enriched, bleached');
  near(density(168894), 125 / 236.5882365);
  near(density(168894), 0.528);
});

test('olive oil is about 0.913 g/mL', () => {
  const oil = data.ingredients.find((i) => i.description.startsWith('Oil, olive, salad or cooking'));
  assert.ok(oil);
  near(oil.forms.find((f) => f.form === 'default').densityGPerMl, 0.913, 0.003);
});

test('brown sugar keeps packed and unpacked apart', () => {
  const sugar = byFdc.get(168833);
  assert.equal(sugar.description, 'Sugars, brown');
  near(density(168833, 'packed'), 220 / 236.5882365);
  near(density(168833, 'packed'), 0.93);
  near(density(168833, 'unpacked'), 145 / 236.5882365);
  assert.ok(density(168833, 'packed') > density(168833, 'unpacked'));
});

test('heavy whipping cream: default form is the 238 g fluid cup, whipped kept apart', () => {
  const cream = byFdc.get(170859);
  assert.equal(cream.description, 'Cream, fluid, heavy whipping');
  near(density(170859), 238 / 236.5882365, 0.0001);
  assert.ok(density(170859, 'whipped') < 0.6);
  assert.equal(cream.forms.find((f) => f.form === 'default').portions.some((p) => p.modifier === 'cup, fluid (yields 2 cups whipped)'), true);
});

test('every form cites its raw portion rows', () => {
  for (const ing of data.ingredients) {
    assert.equal(ing.source, 'usda-sr-legacy');
    for (const f of ing.forms) {
      assert.ok(f.portions.length > 0);
      assert.ok(f.portions.some((p) => p.usdaPortionId === f.basisPortionId));
      for (const p of f.portions) assert.ok(p.densityGPerMl > 0 && typeof p.modifier === 'string');
    }
  }
});
