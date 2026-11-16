import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  findIngredient, searchIngredients, toGrams, toVolume, convert, getDensity, parseUnit, fromGrams, WATER_DENSITY_20C,
} from '../src/index.mjs';

const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} not within ${tol} of ${b}`);

test('unit names: bare units are US customary, legal must be explicit', () => {
  assert.equal(parseUnit('cup').id, 'us-customary:cup');
  assert.equal(parseUnit('us cup').id, 'us-customary:cup');
  assert.equal(parseUnit('Tbsp').id, 'us-customary:tbsp');
  assert.equal(parseUnit('tablespoon').id, 'us-customary:tbsp');
  assert.equal(parseUnit('metric cup').id, 'metric:cup');
  assert.equal(parseUnit('au tbsp').id, 'australian:tbsp');
  assert.equal(parseUnit('ml').id, 'metric:mL');
  assert.equal(parseUnit('fl oz').id, 'us-customary:fl oz');
  assert.equal(parseUnit('us-legal cup').id, 'us-legal:cup');
  assert.equal(parseUnit('us-legal:tbsp').id, 'us-legal:tbsp');
  assert.equal(parseUnit('g').id, 'mass:g');
  assert.throws(() => parseUnit('metric fl oz'));
  assert.throws(() => parseUnit('spoonful'));
});

test('findIngredient: aliases, regional names, ids, descriptions, fdcId', () => {
  for (const q of ['plain flour', 'all-purpose flour', 'AP flour', 'All Purpose Flour']) {
    assert.equal(findIngredient(q).id, 'all-purpose-flour', q);
  }
  assert.equal(findIngredient('caster sugar').fdcId, 169655);
  assert.equal(findIngredient('icing sugar').id, 'powdered-sugar');
  assert.equal(findIngredient('bicarb soda').id, 'baking-soda');
  assert.equal(findIngredient('Honey').fdcId, 169640);
  assert.equal(findIngredient(168894).description, 'Wheat flour, white, all-purpose, enriched, bleached');
  assert.equal(findIngredient('Cream, fluid, heavy whipping').fdcId, 170859);
  assert.equal(findIngredient('no such ingredient'), null);
  assert.ok(searchIngredients('whole wheat flour').length > 0);
});

test('1 US cup all-purpose flour', () => {
  const r = toGrams({ ingredient: 'all-purpose flour', amount: 1, unit: 'cup' });
  near(r.value, 125, 0.01);
  assert.equal(r.unit, 'mass:g');
  assert.equal(r.source.fdcId, 168894);
  assert.equal(r.form, 'default');
});

test('1 US tbsp baking soda', () => {
  near(toGrams({ ingredient: 'baking soda', amount: 1, unit: 'tbsp' }).value, 13.8, 0.01);
});

test('1 US cup water, and water by temperature', () => {
  near(toGrams({ ingredient: 'water', amount: 1, unit: 'cup' }).value, 236.16, 0.01);
  near(getDensity('water').densityGPerMl, WATER_DENSITY_20C, 1e-12);
  const cold = getDensity('water', { temperatureC: 4 }).densityGPerMl;
  const hot = getDensity('water', { temperatureC: 80 }).densityGPerMl;
  assert.ok(cold > WATER_DENSITY_20C && hot < WATER_DENSITY_20C);
});

test('3 US cups of 30% MF cream, calibrated and uncalibrated', () => {
  const r = toGrams({ ingredient: '30% cream', amount: 3, unit: 'cups' });
  near(r.value, 3 * 236.5882365 * 1.0105, 1.5);
  assert.equal(r.fatPercent, 30);
  assert.equal(r.source.kind, 'model');
  const raw = toGrams({ ingredient: 'cream', amount: 3, unit: 'cups', fatPercent: 30, calibrated: false });
  near(raw.value, 3 * 236.5882365 * 0.99128, 1);
  assert.ok(raw.value < r.value);
  assert.throws(() => toGrams({ ingredient: 'cream', amount: 1, unit: 'cup' }), /fatPercent/);
});

test('250 g granulated sugar to US cups', () => {
  const r = toVolume({ ingredient: 'granulated sugar', amount: 250, unit: 'g', to: 'cup' });
  near(r.value, 1.25, 0.001);
  assert.equal(r.unit, 'us-customary:cup');
});

test('1 cup brown sugar packed vs unpacked', () => {
  const packed = toGrams({ ingredient: 'brown sugar', amount: 1, unit: 'cup' });
  const loose = toGrams({ ingredient: 'brown sugar', amount: 1, unit: 'cup', form: 'unpacked' });
  near(packed.value, 220, 0.05);
  near(loose.value, 145, 0.05);
  assert.equal(packed.form, 'packed');
  assert.ok(packed.warnings.some((w) => /packed/i.test(w)));
  assert.throws(() => toGrams({ ingredient: 'brown sugar', amount: 1, unit: 'cup', form: 'melted' }), /Available/);
});

test('different cup sizes change the answer', () => {
  const us = toGrams({ ingredient: 'water', amount: 1, unit: 'cup' }).value;
  near(toGrams({ ingredient: 'water', amount: 1, unit: 'metric cup' }).value / us, 250 / 236.5882365, 1e-9);
  near(toGrams({ ingredient: 'water', amount: 1, unit: 'us-legal cup' }).value / us, 240 / 236.5882365, 1e-9);
  near(toGrams({ ingredient: 'water', amount: 1, unit: 'au tbsp' }).value / toGrams({ ingredient: 'water', amount: 1, unit: 'tbsp' }).value, 20 / 14.78676478125, 1e-9);
});

test('unit-to-unit conversions need no ingredient', () => {
  near(convert({ amount: 1, from: 'cup', to: 'tbsp' }).value, 16, 1e-6);
  near(convert({ amount: 1, from: 'lb', to: 'oz' }).value, 16, 1e-9);
  assert.throws(() => convert({ amount: 1, from: 'cup', to: 'g' }), /ingredient/);
});

test('warnings: temperature on a powder, fat on a powder, extrapolated fat', () => {
  const flour = toGrams({ ingredient: 'flour', amount: 1, unit: 'cup', temperatureC: 5, fatPercent: 30 });
  assert.ok(flour.warnings.some((w) => /temperatureC ignored/.test(w)));
  assert.ok(flour.warnings.some((w) => /fatPercent ignored/.test(w)));
  near(flour.value, 125, 0.01);
  const dc = toGrams({ ingredient: 'double cream', amount: 1, unit: 'cup' });
  assert.ok(dc.warnings.some((w) => /extrapolated/.test(w)));
  const inRange = toGrams({ ingredient: 'cream', amount: 1, unit: 'cup', fatPercent: 30 });
  assert.ok(inRange.warnings.every((w) => !/extrapolated/.test(w)));
  const lean = toGrams({ ingredient: 'cream', amount: 1, unit: 'cup', fatPercent: 0 });
  assert.ok(lean.warnings.some((w) => /extrapolated/.test(w)));
});

test('temperature moves liquids by under 1 percent between 4 and 20 C', () => {
  for (const name of ['olive oil', 'whole milk', 'honey']) {
    const cold = getDensity(name, { temperatureC: 4 }).densityGPerMl;
    const room = getDensity(name).densityGPerMl;
    assert.ok(cold > room, name);
    assert.ok(cold / room - 1 < 0.01, name);
  }
});

test('USDA dairy liquid switches to the dairy model when fatPercent is given', () => {
  const usda = getDensity('heavy cream');
  assert.equal(usda.source.kind, 'usda-sr-legacy');
  near(usda.densityGPerMl, 238 / 236.5882365, 1e-4);
  const model = getDensity('heavy cream', { fatPercent: 36.08 });
  assert.equal(model.source.kind, 'model');
  near(model.densityGPerMl, usda.densityGPerMl, 0.002);
});

test('every alias resolves and converts', () => {
  const aliases = JSON.parse(readFileSyncAliases());
  for (const a of aliases.aliases) {
    const ing = findIngredient(a.names[0]);
    assert.ok(ing, a.id);
    assert.equal(ing.id, a.id, a.names[0]);
    if (a.model === 'dairy' && a.fatPercent === undefined) continue;
    if (a.ambiguousBetween) { assert.throws(() => getDensity(a.names[0]), /ambiguous/); continue; }
    if (ing.counts.length && !Object.keys(ing.forms).length) {
      const c = toGrams({ ingredient: a.names[0], amount: 1 });
      assert.ok(c.value > 5 && c.value < 500, `${a.id}: ${c.value}`);
      continue;
    }
    const r = toGrams({ ingredient: a.names[0], amount: 1, unit: 'cup' });
    assert.ok(r.value > 10 && r.value < 500, `${a.id}: ${r.value}`);
  }
});

import { readFileSync } from 'node:fs';
function readFileSyncAliases() {
  return readFileSync(new URL('../data/aliases.json', import.meta.url), 'utf8');
}

test('count units: 2 large eggs, 3 garlic cloves, medium banana', () => {
  const eggs = toGrams({ ingredient: 'egg', amount: 2, unit: 'large' });
  near(eggs.value, 100, 1e-9);
  assert.equal(eggs.unit, 'mass:g');
  assert.deepEqual([eggs.count.label, eggs.count.sizeNote, eggs.count.gramsPerUnit, eggs.count.usdaPortionId], ['large', 'large', 50, 88374]);
  assert.equal(eggs.source.fdcId, 171287);
  assert.equal(eggs.densityGPerMl, null);
  near(toGrams({ ingredient: 'egg', amount: 2, unit: 'extra large' }).value, 112, 1e-9);
  near(toGrams({ ingredient: 'garlic', amount: 3, unit: 'cloves' }).value, 9, 1e-9);
  near(toGrams({ ingredient: 'garlic clove', amount: 3 }).value, 9, 1e-9);
  const banana = toGrams({ ingredient: 'banana', amount: 2, unit: 'medium' });
  near(banana.value, 236, 1e-9);
  assert.equal(banana.count.sizeNote, 'medium (7" to 7-7/8" long)');
  near(toGrams({ ingredient: 'egg', amount: 3 }).value, 150, 1e-9); // default unit: large
  near(toGrams({ ingredient: 'lemon juice', amount: 2, unit: 'lemon' }).value, 96, 1e-9);
  near(toGrams({ ingredient: 'lime', amount: 1 }).value, 67, 1e-9);
});

test('count units: grams to count, count to volume, the other direction', () => {
  near(fromGrams({ ingredient: 'egg', amount: 150, to: 'large' }).value, 3, 1e-9);
  near(fromGrams({ ingredient: 'egg', amount: 100 }).value, 2, 1e-9);
  const cups = convert({ ingredient: 'egg', amount: 5, from: 'large', to: 'cup' });
  near(cups.value, 250 / 1.027101 / 236.5882365, 1e-3);
  assert.ok(cups.count && cups.densityGPerMl);
  const eggs = convert({ ingredient: 'egg', amount: 1, from: 'cup', to: 'large' });
  near(eggs.value, 243 / 50, 1e-3);
  near(convert({ ingredient: 'egg', amount: 1, from: 'large', to: 'small' }).value, 50 / 38, 1e-9);
});

test('count units: several USDA rows for one label warn and can be chosen', () => {
  const first = toGrams({ ingredient: 'onion', amount: 1, unit: 'slice' });
  assert.ok(first.warnings.some((w) => /3 USDA portions match "slice"/.test(w)));
  const thin = toGrams({ ingredient: 'onion', amount: 1, unit: 'slice', size: 'thin' });
  near(thin.value, 9, 1e-9);
  assert.equal(thin.count.sizeNote, 'slice, thin');
  near(toGrams({ ingredient: 'onion', amount: 1 }).value, 110, 1e-9); // default medium
});

test('count units: unknown count and count-only foods fail clearly', () => {
  assert.throws(() => toGrams({ ingredient: 'egg', amount: 1, unit: 'bushel' }), /Counts available/);
  assert.throws(() => toGrams({ ingredient: 'flour', amount: 1, unit: 'large' }), /no count portions/);
  assert.throws(() => convert({ ingredient: 'lime', amount: 1, from: 'fruit', to: 'cup' }), /no volume portions/);
});

test('branded gap fills: ghee, kosher salt by brand, ambiguity, warnings', () => {
  const ghee = getDensity('ghee');
  assert.equal(ghee.source.kind, 'usda-branded');
  near(ghee.densityGPerMl, 0.9333, 0.001);
  const dc = toGrams({ ingredient: 'diamond crystal kosher salt', amount: 1, unit: 'tsp' });
  const morton = toGrams({ ingredient: 'morton kosher salt', amount: 1, unit: 'tsp' });
  assert.ok(morton.value / dc.value > 1.5 && morton.value / dc.value < 2, `${morton.value / dc.value}`);
  assert.ok(dc.warnings.some((w) => /above 5%/.test(w)));
  assert.throws(() => getDensity('kosher salt'), /ambiguous/);
  const sumac = getDensity('sumac');
  assert.ok(sumac.warnings.some((w) => /above 5%/.test(w)) && sumac.source.rows === 3);
  assert.ok(findIngredient('crème fraîche'));
});

test('same-kind conversions still need no ingredient with counts present', () => {
  near(convert({ amount: 1, from: 'cup', to: 'tbsp' }).value, 16, 1e-6);
  assert.throws(() => convert({ amount: 1, from: 'large', to: 'g' }));
});

test('unit names: T and t, centilitres, dessertspoons, milligrams', () => {
  assert.equal(parseUnit('T').id, 'us-customary:tbsp');
  assert.equal(parseUnit('t').id, 'us-customary:tsp');
  assert.equal(parseUnit('T.').id, 'us-customary:tbsp');
  assert.equal(parseUnit('metric T').id, 'metric:tbsp');
  assert.equal(parseUnit('Tb').id, 'us-customary:tbsp');
  assert.equal(parseUnit('C').id, 'us-customary:cup');
  assert.equal(parseUnit('cl').id, 'metric:cL');
  assert.equal(parseUnit('centilitres').ml, 10);
  assert.equal(parseUnit('dessertspoon').id, 'metric:dessertspoon');
  assert.equal(parseUnit('dsp').ml, 10);
  assert.equal(parseUnit('mg').grams, 0.001);
  assert.equal(parseUnit('kilo').id, 'mass:kg');
  near(convert({ amount: 25, from: 'cl', to: 'ml' }).value, 250, 1e-9);
  near(toGrams({ ingredient: 'water', amount: 10, unit: 'cl' }).value, 99.82, 1e-9);
});

test('unit names: an imperial spoon is refused with the unit to write instead', () => {
  assert.throws(() => parseUnit('uk tbsp'), /metric tbsp/);
  assert.throws(() => parseUnit('imperial tsp'), /metric tsp/);
  // A known unit in the wrong system is not retried as a count.
  assert.throws(() => toGrams({ ingredient: 'butter', amount: 1, unit: 'uk tbsp' }), /^Error: No "tbsp" in the imperial system\. Modern UK recipes use the metric spoon: write "metric tbsp" \(15 mL\)\.$/);
});

test('count units: the ingredient named as its own unit, and size shorthand', () => {
  near(toGrams({ ingredient: 'egg', amount: 2, unit: 'eggs' }).value, 100, 1e-9);
  near(toGrams({ ingredient: 'banana', amount: 2, unit: 'bananas' }).value, 236, 1e-9);
  near(toGrams({ ingredient: 'courgette', amount: 2, unit: 'courgettes' }).value, 392, 1e-9);
  near(toGrams({ ingredient: 'egg', amount: 2, unit: 'XL' }).value, 112, 1e-9);
  near(toGrams({ ingredient: 'egg', amount: 1, unit: 'med' }).value, 44, 1e-9);
  near(toGrams({ ingredient: 'spinach', amount: 2, unit: 'leaves' }).value, 20, 1e-9);
});

test('count units: a guessed size is named in a warning', () => {
  // No alias, so no default unit: "medium" is assumed and said so.
  const guessed = toGrams({ ingredient: 'Bananas, raw', amount: 2, unit: 'bananas' });
  near(guessed.value, 236, 1e-9);
  assert.ok(guessed.warnings.some((w) => /No size given for bananas-raw: used "medium/.test(w)), guessed.warnings.join('|'));
  // The alias has a default unit, so nothing is guessed.
  assert.ok(!toGrams({ ingredient: 'banana', amount: 2, unit: 'bananas' }).warnings.some((w) => /No size given/.test(w)));
  // Two counts and no medium: refuse rather than pick one.
  assert.throws(() => toGrams({ ingredient: 'butter', amount: 1, unit: 'piece' }), /Counts available: pat, stick/);
});

test('fat percentage in the name, in any of the usual spellings', () => {
  for (const [q, id] of [
    ['35 % M.F. cream', 'cream-35pct'], ['cream 18%', 'cream-18pct'], ['Cream (40% fat)', 'cream-40pct'],
    ['milk, 2 percent', 'milk-2pct'], ['10.5% BF cream', 'cream-10.5pct'], ['48 percent milk fat cream', 'cream-48pct'],
  ]) {
    assert.equal(findIngredient(q)?.id, id, q);
  }
  assert.equal(findIngredient('ice cream 10%'), null);
  near(toGrams({ ingredient: 'cream 18%', amount: 1, unit: 'cup' }).value, toGrams({ ingredient: 'single cream', amount: 1, unit: 'cup' }).value, 1e-9);
});

test('missing arguments fail with a sentence, not a stack of internals', () => {
  assert.throws(() => toGrams(), /amount must be a number; got undefined/);
  assert.throws(() => toGrams({ ingredient: 'flour', amount: '2', unit: 'cup' }), /got the string "2"/);
  assert.throws(() => toGrams({ ingredient: 'flour', amount: 2 }), /No unit given for all-purpose-flour/);
  assert.throws(() => fromGrams({ ingredient: 'flour', amount: 100 }), /No unit given/);
  assert.throws(() => convert({ amount: 1, to: 'g' }), /No unit given\./);
});

test('search: exact alias names first, then raw SR Legacy foods before prepared dishes', () => {
  assert.equal(searchIngredients('rice')[0].id, 'white-rice');
  assert.equal(searchIngredients('courgette')[0].id, 'zucchini');
  assert.equal(searchIngredients('kale')[0].description, 'Kale, raw');
  assert.equal(searchIngredients('kale', { limit: 3 }).length, 3);
  assert.deepEqual(searchIngredients('   '), []);
  assert.ok(findIngredient('egg').names.includes('eggs'));
});
