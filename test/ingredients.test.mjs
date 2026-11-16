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
    assert.ok(['usda-sr-legacy', 'usda-fndds'].includes(ing.source), ing.id);
    for (const f of ing.forms) {
      assert.ok(f.portions.length > 0);
      assert.ok(f.portions.some((p) => p.usdaPortionId === f.basisPortionId));
      for (const p of f.portions) assert.ok(p.densityGPerMl > 0 && typeof p.modifier === 'string');
    }
  }
});

test('SR Legacy records are unchanged by FNDDS: SR ids never carry an FNDDS suffix by accident', () => {
  const sr = data.ingredients.filter((i) => i.source === 'usda-sr-legacy');
  const fndds = data.ingredients.filter((i) => i.source === 'usda-fndds');
  assert.ok(sr.length > 4000 && fndds.length > 3000);
  assert.equal(byFdc.get(168894).id, 'wheat-flour-white-all-purpose-enriched-bleached');
  assert.equal(new Set(data.ingredients.map((i) => i.fdcId)).size, data.ingredients.length);
});

test('FNDDS fills foods SR lacks and never repeats an SR description', () => {
  const srDescriptions = new Set(data.ingredients.filter((i) => i.source === 'usda-sr-legacy').map((i) => i.description.toLowerCase()));
  for (const i of data.ingredients.filter((x) => x.source === 'usda-fndds')) {
    assert.ok(!srDescriptions.has(i.description.toLowerCase()), i.description);
  }
});

test('count portions: egg sizes, garlic clove, banana, onion, lemon yield', () => {
  const egg = byFdc.get(171287);
  const g = (label) => egg.counts.find((c) => c.label === label).gramWeight;
  assert.deepEqual([g('small'), g('medium'), g('large'), g('extra large'), g('jumbo')], [38, 44, 50, 56, 63]);
  assert.equal(egg.counts.find((c) => c.label === 'large').sizeNote, 'large');
  assert.equal(egg.counts.find((c) => c.label === 'large').usdaPortionId, 88374);
  assert.equal(byFdc.get(169230).counts.find((c) => c.label === 'clove').gramsPerUnit, 3);
  const banana = byFdc.get(173944).counts.find((c) => c.label === 'medium');
  assert.equal(banana.sizeNote, 'medium (7" to 7-7/8" long)');
  assert.equal(banana.gramWeight, 118);
  assert.equal(byFdc.get(167747).counts.find((c) => c.label === 'lemon').gramWeight, 48);
  assert.equal(byFdc.get(168156).counts.find((c) => c.label === 'lime').gramWeight, 44);
});

test('counts stay out of the volume maths: the whole raw egg density comes from the cup', () => {
  near(density(171287), 243 / 236.5882365, 0.0001);
  const egg = byFdc.get(171287);
  assert.ok(egg.forms[0].portions.every((p) => /cup/.test(p.modifier)));
  assert.ok(egg.forms[0].portions.some((p) => p.modifier === 'cup (4.86 large eggs)'));
});
