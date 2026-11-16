import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getUnit, toMl, fromMl, convertUnit } from '../src/units.mjs';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('US customary definitions are consistent', () => {
  const cup = getUnit('us-customary', 'cup');
  close(toMl(1, cup), 236.5882365);
  close(convertUnit(1, cup, getUnit('us-customary', 'tbsp')), 16, 1e-6);
  close(convertUnit(1, cup, getUnit('us-customary', 'tsp')), 48, 1e-6);
  close(convertUnit(1, cup, getUnit('us-customary', 'fl oz')), 8, 1e-6);
  close(convertUnit(1, getUnit('us-customary', 'gallon'), cup), 16, 1e-6);
  close(convertUnit(1, getUnit('us-customary', 'quart'), cup), 4, 1e-6);
  close(convertUnit(1, getUnit('us-customary', 'pint'), cup), 2, 1e-6);
});

test('legal (NLEA) and metric cups differ from the US customary cup', () => {
  assert.equal(toMl(1, getUnit('us-legal', 'cup')), 240);
  assert.equal(toMl(1, getUnit('us-legal', 'fl oz')), 30);
  assert.equal(toMl(1, getUnit('metric', 'cup')), 250);
  assert.equal(toMl(1, getUnit('australian', 'tbsp')), 20);
  close(toMl(1, getUnit('imperial', 'cup')), 10 * 28.4130625);
});

test('round trip through mL', () => {
  const tbsp = getUnit('us-customary', 'tbsp');
  close(fromMl(toMl(3.5, tbsp), tbsp), 3.5);
});

test('mass units and the butter stick', () => {
  const lb = getUnit('mass', 'lb');
  close(convertUnit(1, lb, getUnit('mass', 'oz')), 16, 1e-9);
  close(getUnit('us-customary', 'stick-butter').grams, 113.3980925);
});

test('mixing volume and mass is refused', () => {
  assert.throws(() => convertUnit(1, getUnit('mass', 'g'), getUnit('metric', 'mL')));
});
