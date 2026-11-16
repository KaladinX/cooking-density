import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  findIngredient, searchIngredients, toGrams, toVolume, convert, getDensity, parseUnit, WATER_DENSITY_20C,
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
    const r = toGrams({ ingredient: a.names[0], amount: 1, unit: 'cup' });
    assert.ok(r.value > 10 && r.value < 500, `${a.id}: ${r.value}`);
  }
});

import { readFileSync } from 'node:fs';
function readFileSyncAliases() {
  return readFileSync(new URL('../data/aliases.json', import.meta.url), 'utf8');
}
