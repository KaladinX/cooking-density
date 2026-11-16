import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { componentDensity, density, adjustDensityForTemperature } from '../src/physics/choi-okos.mjs';
import { creamDensity, dairyComposition } from '../src/physics/dairy.mjs';

const data = JSON.parse(readFileSync(new URL('../data/ingredients.json', import.meta.url), 'utf8'));
const byFdc = new Map(data.ingredients.map((i) => [i.fdcId, i]));
const measured = (fdcId) => byFdc.get(fdcId).forms.find((f) => f.form === 'default').densityGPerMl;

test('component densities at 20 C match the published polynomials', () => {
  assert.ok(Math.abs(componentDensity('water', 20) - (997.18 + 3.1439e-3 * 20 - 3.7574e-3 * 400)) < 1e-9);
  assert.ok(Math.abs(componentDensity('fat', 20) - (925.59 - 0.41757 * 20)) < 1e-9);
  assert.ok(Math.abs(componentDensity('ash', 0) - 2423.8) < 1e-9);
});

test('mixing rule: pure components and an equal-mass blend', () => {
  assert.ok(Math.abs(density({ fat: 1 }, 20) * 1000 - componentDensity('fat', 20)) < 1e-9);
  const half = density({ water: 0.5, fat: 0.5 }, 20) * 1000;
  const expected = 1 / (0.5 / componentDensity('water', 20) + 0.5 / componentDensity('fat', 20));
  assert.ok(Math.abs(half - expected) < 1e-9);
  // Fractions that do not sum to one are normalised.
  assert.ok(Math.abs(density({ water: 2, fat: 2 }, 20) - density({ water: 0.5, fat: 0.5 }, 20)) < 1e-12);
});

test('composition never counts fibre twice', () => {
  const honey = byFdc.get(169640).composition;
  assert.ok(Math.abs(honey.carbohydrate + honey.fiber - honey.carbohydrateByDifference) < 1e-9);
  for (const ing of data.ingredients) {
    const c = ing.composition;
    assert.ok(c, ing.id);
    // Below 1 happens only where unmodelled mass exists (alcohol, caffeine); never above ~1.
    assert.ok(c.sum > 0.3 && c.sum < 1.03, `${ing.id} sum ${c.sum}`);
  }
});

// Model vs USDA household-measure density, all within 3 percent at 20 C.
const CHECKS = [
  ['water (bottled, generic)', 174158],
  ['skim milk', 173432],
  ['whole milk', 172217],
  ['half and half', 171255],
  ['light whipping cream', 170858],
  ['heavy whipping cream', 170859],
  ['olive oil', 171413],
  ['honey', 169640],
];
for (const [name, id] of CHECKS) {
  test(`Choi-Okos within 3% of USDA: ${name}`, () => {
    const model = density(byFdc.get(id).composition, 20);
    const error = Math.abs(model / measured(id) - 1);
    assert.ok(error < 0.03, `${name}: model ${model.toFixed(4)} vs USDA ${measured(id).toFixed(4)} (${(error * 100).toFixed(2)}%)`);
  });
}

test('the model is lower than USDA for every dairy liquid (documented bias)', () => {
  for (const id of [173432, 172217, 171255, 170858, 170859]) {
    assert.ok(density(byFdc.get(id).composition, 20) < measured(id));
  }
});

test('30% MF cream, uncalibrated model: fixed values at 20 C and 4 C', () => {
  const at20 = creamDensity({ fatPercent: 30, temperatureC: 20, calibrated: false });
  const at4 = creamDensity({ fatPercent: 30, temperatureC: 4, calibrated: false });
  assert.ok(Math.abs(at20 - 0.99128) < 0.0005, String(at20));
  assert.ok(Math.abs(at4 - 0.99468) < 0.0005, String(at4));
  assert.ok(at4 > at20);
});

test('calibrated is the default and lands between light cream and light whipping cream', () => {
  const at20 = creamDensity({ fatPercent: 30 });
  assert.equal(at20, creamDensity({ fatPercent: 30, calibrated: true }));
  assert.ok(at20 > creamDensity({ fatPercent: 30, calibrated: false }));
  // Measured USDA values: light cream (19.1% fat) 1.0144, light whipping (30.91%) 1.0102.
  assert.ok(at20 < measured(170857) && at20 > measured(170858) - 0.0005, String(at20));
  assert.ok(Math.abs(at20 - 1.0105) < 0.0015, String(at20));
  assert.ok(creamDensity({ fatPercent: 30, temperatureC: 4 }) > at20);
});

test('calibrated density equals USDA measured at every anchor fat percentage (within 0.2%)', () => {
  for (const id of [173432, 172217, 171255, 170857, 170858, 170859]) {
    const fat = byFdc.get(id).composition.fat * 100;
    const value = creamDensity({ fatPercent: fat });
    assert.ok(Math.abs(value / measured(id) - 1) < 0.002, `${id}: ${value} vs ${measured(id)}`);
  }
});

test('calibration is held constant beyond the anchors', () => {
  const ratio = (f) => creamDensity({ fatPercent: f }) / creamDensity({ fatPercent: f, calibrated: false });
  assert.ok(Math.abs(ratio(40) - ratio(60)) < 1e-12);
  assert.ok(Math.abs(ratio(0) - ratio(0.1)) < 1e-12);
});

test('cream density falls as fat rises, and compositions sum to 1', () => {
  for (const calibrated of [true, false]) {
    let last = Infinity;
    for (const fat of [0, 3.25, 11.5, 19, 30, 36, 40]) {
      const d = creamDensity({ fatPercent: fat, calibrated });
      assert.ok(d < last, `fat ${fat}`);
      last = d;
      const c = dairyComposition(fat);
      assert.ok(Math.abs(Object.values(c).reduce((a, b) => a + b, 0) - 1) < 1e-9);
    }
  }
  assert.throws(() => creamDensity({ fatPercent: 100 }));
});

test('uncalibrated parametric model matches the direct model on its own USDA records within 0.5%', () => {
  for (const id of [173432, 172217, 171255, 170857, 170858, 170859]) {
    const c = byFdc.get(id).composition;
    const parametric = creamDensity({ fatPercent: c.fat * 100, calibrated: false });
    const direct = density(c, 20);
    assert.ok(Math.abs(parametric / direct - 1) < 0.005, `${id}`);
  }
});

test('temperature adjustment keeps the measured offset', () => {
  const comp = byFdc.get(171413).composition;
  const at4 = adjustDensityForTemperature(0.913, comp, 20, 4);
  assert.ok(at4 > 0.913 && at4 < 0.913 * 1.01);
  assert.ok(Math.abs(adjustDensityForTemperature(0.913, comp, 20, 20) - 0.913) < 1e-12);
});
