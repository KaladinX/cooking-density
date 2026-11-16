import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseModifier, parseCount } from '../src/usda-modifier.mjs';

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


test('count portions: size words, countable parts, yields', () => {
  const label = (m) => parseCount(m).label;
  assert.equal(label('large'), 'large');
  assert.equal(label('extra large'), 'extra large');
  assert.equal(label('extra-large pizza (16-18" diameter)'), 'extra large');
  assert.equal(label('medium (7" to 7-7/8" long)'), 'medium');
  assert.equal(label('clove'), 'clove');
  assert.equal(label('cloves'), 'clove');
  assert.equal(label('slices'), 'slice');
  assert.equal(label('slice, thin'), 'slice');
  assert.equal(label('leaves'), 'leaf');
  assert.equal(label('fruit without refuse'), 'fruit');
  assert.equal(label('lemon yields'), 'lemon');
  assert.equal(label('lime yields'), 'lime');
  for (const m of ['oz', 'lb', 'steak', 'jar', 'cupcake', 'serving', 'package', 'can (12 fl oz)']) {
    assert.equal(parseCount(m).ok, false, m);
  }
});

test('cup (N large eggs) is a plain cup', () => {
  assert.deepEqual(parseModifier('cup (4.86 large eggs)'), ok('cup', 'default'));
});
