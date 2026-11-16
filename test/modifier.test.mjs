import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseModifier } from '../src/usda-modifier.mjs';

const ok = (unit, form, nlea = false) => ({ ok: true, unit, nlea, form });

test('plain units', () => {
  assert.deepEqual(parseModifier('cup'), ok('cup', 'default'));
  assert.deepEqual(parseModifier('tbsp'), ok('tbsp', 'default'));
  assert.deepEqual(parseModifier('Tbsp'), ok('tbsp', 'default'));
  assert.deepEqual(parseModifier('tsp'), ok('tsp', 'default'));
  assert.deepEqual(parseModifier('fl oz'), ok('fl oz', 'default'));
  assert.deepEqual(parseModifier('tablespoon'), ok('tbsp', 'default'));
  assert.deepEqual(parseModifier('cubic inch'), ok('cubic inch', 'default'));
});

test('packing state becomes the form', () => {
  assert.deepEqual(parseModifier('cup packed'), ok('cup', 'packed'));
  assert.deepEqual(parseModifier('tsp unpacked'), ok('tsp', 'unpacked'));
  assert.deepEqual(parseModifier('cup, packed'), ok('cup', 'packed'));
  assert.deepEqual(parseModifier('cup, firmly packed'), ok('cup', 'packed'));
  assert.deepEqual(parseModifier('cup (not packed)'), ok('cup', 'unpacked'));
  assert.deepEqual(parseModifier('cup elbows not packed not packed'), ok('cup', 'elbows-unpacked'));
});

test('comma qualifiers and parenthetical notes', () => {
  assert.deepEqual(parseModifier('cup, whipped'), ok('cup', 'whipped'));
  assert.deepEqual(parseModifier('cup, fluid (yields 2 cups whipped)'), ok('cup', 'default'));
  assert.deepEqual(parseModifier('cup, liquid'), ok('cup', 'default'));
  assert.deepEqual(parseModifier('cup, chopped or diced'), ok('cup', 'chopped-or-diced'));
});

test('NLEA labelling portions are flagged', () => {
  assert.deepEqual(parseModifier('cup (1 NLEA serving)'), ok('cup', 'default', true));
  assert.deepEqual(parseModifier('tbsp (1 NLEA serving)'), ok('tbsp', 'default', true));
});

test('cup (8 fl oz) is a plain cup', () => {
  assert.deepEqual(parseModifier('cup (8 fl oz)'), ok('cup', 'default'));
});

test('unparseable text is rejected with a reason', () => {
  for (const m of ['oz', 'serving', 'cupcake', 'serving 1 cup', 'can (12 fl oz)', 'cup (4 fl oz)', 'cup, with pits, yields']) {
    assert.equal(parseModifier(m).ok, false, m);
  }
});
