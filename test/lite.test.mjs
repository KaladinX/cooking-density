import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as full from '../src/index.mjs';
import * as lite from '../src/lite.mjs';
import { createConverter } from '../src/core.mjs';
import liteData from '../data/lite.mjs';
import { buildLite, readSources, serialise, serialiseModule } from '../scripts/build-lite.mjs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const outcome = (fn) => { try { return { ok: fn() }; } catch (err) { return { error: err.message }; } };

test('data/lite.json and data/lite.mjs are current (else run npm run build:lite)', () => {
  const built = buildLite(readSources());
  assert.equal(read('../data/lite.json'), serialise(built), 'data/lite.json is stale');
  assert.equal(read('../data/lite.mjs'), serialiseModule(built), 'data/lite.mjs is stale');
  assert.deepEqual(liteData, JSON.parse(read('../data/lite.json')));
});

test('lite is small: under 250 KB, no raw portion rows, no brand rows', () => {
  assert.ok(read('../data/lite.json').length < 250_000);
  assert.ok(liteData.ingredients.every((i) => i.forms.every((f) => !('portions' in f))));
  assert.ok(liteData.brandedGaps.gaps.every((g) => !('rows' in g)));
});

test('lite and the full helper export the same names', () => {
  assert.deepEqual(Object.keys(lite).sort(), Object.keys(full).sort());
});

test('lite gives the same density as the full data for every alias', () => {
  const { aliases } = JSON.parse(read('../data/aliases.json'));
  for (const a of aliases) {
    assert.deepEqual(outcome(() => lite.findIngredient(a.id)), outcome(() => full.findIngredient(a.id)), a.id);
    assert.deepEqual(outcome(() => lite.getDensity(a.id)), outcome(() => full.getDensity(a.id)), a.id);
    for (const name of a.names) assert.equal(lite.findIngredient(name)?.id, a.id, name);
  }
});

test('lite converts volumes, counts, models and label medians like the full helper', () => {
  for (const args of [
    { ingredient: 'plain flour', amount: 2, unit: 'metric cup' },
    { ingredient: 'brown sugar', amount: 1, unit: 'cup', form: 'unpacked' },
    { ingredient: '30% cream', amount: 3, unit: 'cups' },
    { ingredient: 'cream', amount: 1, unit: 'cup', fatPercent: 42, calibrated: false },
    { ingredient: 'olive oil', amount: 1, unit: 'tbsp', temperatureC: 4 },
    { ingredient: 'egg', amount: 2, unit: 'extra large' },
    { ingredient: 'onion', amount: 1, unit: 'slice', size: 'thin' },
    { ingredient: 'ghee', amount: 1, unit: 'tbsp' },
    { ingredient: 'courgette', amount: 1 },
  ]) {
    assert.deepEqual(lite.toGrams(args), full.toGrams(args), JSON.stringify(args));
  }
  assert.deepEqual(lite.toVolume({ ingredient: 'caster sugar', amount: 250 }), full.toVolume({ ingredient: 'caster sugar', amount: 250 }));
  assert.equal(lite.classifyEgg(60.5, 'eu').name, 'M');
  assert.equal(lite.measurements().length, full.measurements().length);
  assert.throws(() => lite.getDensity('kosher salt'), /ambiguous/);
});

test('lite knows the curated ingredients only', () => {
  assert.equal(lite.findIngredient('Kale, raw'), null);
  assert.ok(full.findIngredient('Kale, raw'));
  assert.equal(lite.findIngredient(168894).description, 'Wheat flour, white, all-purpose, enriched, bleached');
  assert.equal(lite.searchIngredients('courgette')[0].id, 'zucchini');
});

test('the lite entry imports nothing from Node: only src/ and data/lite.mjs', () => {
  const seen = new Set();
  const walk = (url) => {
    if (seen.has(url.href)) return;
    seen.add(url.href);
    const source = readFileSync(url, 'utf8');
    if (url.href.endsWith('/data/lite.mjs')) {
      assert.ok(!/^\s*import\s/m.test(source), 'data/lite.mjs must not import');
      return;
    }
    for (const m of source.matchAll(/^\s*(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]/gm)) {
      assert.ok(m[1].startsWith('.'), `${fileURLToPath(url)} imports "${m[1]}"`);
      walk(new URL(m[1], url));
    }
    assert.ok(!/\bimport\s*\(/.test(source), `${fileURLToPath(url)} uses a dynamic import`);
    assert.ok(!/\b(process|require|Buffer|__dirname)\b/.test(source.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')), `${fileURLToPath(url)} uses a Node global`);
  };
  walk(new URL('../src/lite.mjs', import.meta.url));
  assert.ok(seen.size >= 6, [...seen].join('\n'));
});

test('createConverter: bring your own data, files as stored or bare arrays', () => {
  const sources = readSources();
  const fromFiles = createConverter(sources);
  assert.equal(fromFiles.toGrams({ ingredient: 'honey', amount: 1, unit: 'tbsp' }).value, full.toGrams({ ingredient: 'honey', amount: 1, unit: 'tbsp' }).value);
  const calls = [];
  const lazy = createConverter({
    units: sources.units.units,
    aliases: sources.aliases.aliases,
    ingredients: () => { calls.push('ingredients'); return sources.ingredients.ingredients; },
  });
  assert.equal(lazy.parseUnit('cup').id, 'us-customary:cup');
  assert.deepEqual(calls, [], 'ingredients load on first use, not before');
  assert.ok(Math.abs(lazy.toGrams({ ingredient: 'flour', amount: 1, unit: 'cup' }).value - 125) < 0.01);
  lazy.findIngredient('sugar');
  assert.deepEqual(calls, ['ingredients'], 'and load once');
  assert.throws(() => lazy.toGrams({ ingredient: '30% cream', amount: 1, unit: 'cup' }), /without "dairyModel" data/);
  assert.throws(() => lazy.classifyEgg(60), /without "eggSizes" data/);
  assert.throws(() => createConverter(), /needs the data/);
  assert.throws(() => createConverter({}), /unit table/);
});
