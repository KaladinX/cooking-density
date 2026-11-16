import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eggSizes, measurements, edibleGramsFromShell, shellGramsFromEdible, classifyEgg, toGrams } from '../src/index.mjs';

const OUNCE = 28.349523125;

test('US classes are the AMS 56 table in grams', () => {
  const us = eggSizes().standards.find((s) => s.id === 'us');
  const by = (n) => us.classes.find((c) => c.name === n);
  assert.deepEqual(us.classes.map((c) => c.minOuncesPerDozen), [30, 27, 24, 21, 18, 15]);
  assert.deepEqual(us.classes.map((c) => c.minIndividualOuncesPerDozenRate), [29, 26, 23, 20, 17, null]);
  assert.ok(Math.abs(by('Large').minGramsPerEgg - (24 / 12) * OUNCE) < 0.01);
  assert.ok(Math.abs(by('Large').minIndividualGramsPerEgg - (23 / 12) * OUNCE) < 0.01);
  assert.equal(by('Large').maxGramsPerEggExclusive, by('Extra large').minGramsPerEgg);
  assert.ok(us.citation.url.startsWith('https://www.ams.usda.gov/'));
});

test('Canada and EU classes', () => {
  const ca = eggSizes().standards.find((s) => s.id === 'ca');
  assert.deepEqual(ca.classes.map((c) => c.minGramsPerEgg), [70, 63, 56, 49, 42, null]);
  const eu = eggSizes().standards.find((s) => s.id === 'eu');
  assert.deepEqual(eu.classes.map((c) => [c.name, c.minGramsPerEgg, c.maxGramsPerEggExclusive]), [['XL', 73, null], ['L', 63, 73], ['M', 53, 63], ['S', null, 53]]);
  for (const s of eggSizes().standards) assert.ok(s.citation.url.startsWith('https://') && s.citation.title.length > 10);
  assert.ok(eggSizes().notAvailable.some((n) => n.id === 'au'));
});

test('shell fraction: USDA SR 12 percent', () => {
  const shell = eggSizes().shell;
  assert.equal(shell.refusePercent, 12);
  assert.ok(Math.abs(shell.edibleFraction - 0.88) < 1e-12);
  assert.equal(shell.appliesTo.fdcId, 171287);
  assert.ok(Math.abs(edibleGramsFromShell(100) - 88) < 1e-9);
  assert.ok(Math.abs(shellGramsFromEdible(88) - 100) < 1e-9);
});

test('USDA large (50 g edible) is the US class minimum less the shell', () => {
  const large = eggSizes().standards.find((s) => s.id === 'us').classes.find((c) => c.name === 'Large');
  assert.ok(Math.abs(edibleGramsFromShell(large.minGramsPerEgg) - 50) < 0.5);
});

test('first community measurement: a fridge-cold US large egg, 60.5 g in the shell', () => {
  const [m] = measurements();
  assert.equal(m.contributor, 'KieranVR');
  assert.equal(m.instrument, 'coffee scale');
  assert.equal(m.value, 60.5);
  assert.deepEqual(m.dimensions, { height: { value: 2, unit: 'in' }, width: { value: 1.75, unit: 'in' } });
  assert.match(m.conditions, /fridge-cold/);

  // Inside the US Large class, on the per-dozen average range and above the individual minimum.
  const cls = classifyEgg(m.value, 'us');
  assert.equal(cls.name, 'Large');
  assert.ok(m.value >= cls.minIndividualGramsPerEgg && m.value < cls.maxGramsPerEggExclusive);
  assert.equal(classifyEgg(m.value, 'ca').name, 'Large');
  assert.equal(classifyEgg(m.value, 'eu').name, 'M');

  // Edible estimate against USDA's 50 g large egg.
  const edible = edibleGramsFromShell(m.value);
  const usda = toGrams({ ingredient: 'egg', amount: 1, unit: 'large' }).value;
  assert.equal(usda, 50);
  const diffPct = (edible / usda - 1) * 100;
  console.log(`egg: ${m.value} g in shell -> ${edible.toFixed(2)} g edible; USDA large ${usda} g; difference ${diffPct.toFixed(1)}%`);
  assert.ok(Math.abs(edible - 53.24) < 0.01);
  assert.ok(diffPct > 0 && diffPct < 10, `${diffPct}`);
});

test('classifyEgg: unknown standard and below-range weights', () => {
  assert.throws(() => classifyEgg(60, 'au'), /Unknown egg standard/);
  assert.equal(classifyEgg(10, 'us'), null);
  assert.equal(classifyEgg(75, 'eu').name, 'XL');
  assert.equal(classifyEgg(50, 'eu').name, 'S');
});
