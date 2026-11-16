// cooking-density: convert cooking volumes to grams and back.
//
//   findIngredient('plain flour')
//   toGrams({ ingredient: 'all-purpose flour', amount: 1, unit: 'cup' })
//   toVolume({ ingredient: 'granulated sugar', amount: 250, unit: 'g', to: 'cup' })
//   convert({ ingredient: 'water', amount: 1, from: 'cup', to: 'g' })
//
// Densities come from data/ingredients.json (USDA SR Legacy), from the water
// reference value, or from the dairy model. Every result names its source.
import { readFileSync } from 'node:fs';
import { parseUnit, toMl, fromMl, convertUnit } from './units.mjs';
import { density as chociOkosDensity, adjustDensityForTemperature } from './physics/choi-okos.mjs';
import { creamDensity, dairyFatRange } from './physics/dairy.mjs';

export { parseUnit } from './units.mjs';
export { units } from './units.mjs';
export { creamDensity } from './physics/dairy.mjs';
export { density as compositionDensity, componentDensity } from './physics/choi-okos.mjs';

/** Pure water at 20 C, g/mL. Standard reference value (see docs/plans/physics-notes.md). */
export const WATER_DENSITY_20C = 0.9982;

const readJson = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));

let cache;
function data() {
  if (cache) return cache;
  const ingredients = readJson('../data/ingredients.json').ingredients;
  const aliases = readJson('../data/aliases.json').aliases;
  const byFdc = new Map(ingredients.map((i) => [i.fdcId, i]));
  const byName = new Map();
  const add = (name, entry) => {
    const key = normalise(name);
    if (!byName.has(key)) byName.set(key, entry);
  };
  for (const a of aliases) {
    add(a.id, { alias: a });
    for (const n of a.names) add(n, { alias: a });
  }
  for (const i of ingredients) {
    add(i.id, { record: i });
    add(i.description, { record: i });
  }
  cache = { ingredients, aliases, byFdc, byName };
  return cache;
}

function normalise(text) {
  return String(text)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9%]+/g, ' ')
    .trim();
}

function describeRecord(record, extra = {}) {
  const forms = Object.fromEntries(record.forms.map((f) => [f.form, f.densityGPerMl]));
  return {
    id: record.id,
    name: record.description,
    kind: 'usda',
    fdcId: record.fdcId,
    description: record.description,
    form: record.forms.some((f) => f.form === 'default') ? 'default' : record.forms[0].form,
    forms,
    composition: record.composition ?? null,
    liquid: false,
    dairy: false,
    ...extra,
  };
}

function fromAlias(alias) {
  if (alias.model) {
    return {
      id: alias.id,
      name: alias.names[0],
      kind: 'model',
      model: alias.model,
      fatPercent: alias.fatPercent ?? null,
      form: 'default',
      forms: { default: null },
      composition: null,
      liquid: alias.liquid === true,
      dairy: alias.model === 'dairy',
      note: alias.note ?? null,
    };
  }
  const record = data().byFdc.get(alias.fdcId);
  if (!record) throw new Error(`Alias ${alias.id} points at missing fdcId ${alias.fdcId}`);
  return describeRecord(record, {
    id: alias.id,
    name: alias.names[0],
    form: alias.form,
    liquid: alias.liquid === true,
    dairy: alias.dairy === true,
    note: alias.note ?? null,
  });
}

/**
 * Look an ingredient up by alias, canonical id, USDA description or fdcId.
 * Returns an ingredient object, or null. Matching ignores case, accents and punctuation.
 */
export function findIngredient(query) {
  const { byFdc, byName } = data();
  if (query && typeof query === 'object' && 'kind' in query) return query;
  if (typeof query === 'number' || /^\d+$/.test(String(query).trim())) {
    const record = byFdc.get(Number(query));
    return record ? describeRecord(record) : null;
  }
  const hit = byName.get(normalise(query));
  if (!hit) return fatPercentQuery(query);
  return hit.alias ? fromAlias(hit.alias) : describeRecord(hit.record);
}

// "30% cream", "30 percent mf cream", "2% milk" with no alias: dairy model at that fat.
function fatPercentQuery(query) {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(?:%|percent)\s*(?:mf\s+|milk\s?fat\s+|fat\s+)?(cream|milk)\s*$/i.exec(String(query));
  if (!m) return null;
  const fatPercent = Number(m[1]);
  if (!(fatPercent >= 0 && fatPercent < 100)) return null;
  return fromAlias({
    id: `${m[2].toLowerCase()}-${fatPercent}pct`,
    names: [String(query).trim()],
    model: 'dairy',
    fatPercent,
    liquid: true,
  });
}

/**
 * Words-in-any-order search over alias names and USDA descriptions.
 * Returns up to `limit` ingredient objects, aliases first.
 */
export function searchIngredients(query, { limit = 10 } = {}) {
  const words = normalise(query).split(' ').filter(Boolean);
  if (!words.length) return [];
  const { aliases, ingredients } = data();
  const results = [];
  const seen = new Set();
  for (const a of aliases) {
    const hay = normalise([a.id, ...a.names].join(' '));
    if (words.every((w) => hay.includes(w))) {
      results.push(fromAlias(a));
      if (a.fdcId) seen.add(a.fdcId);
    }
  }
  for (const i of ingredients) {
    if (results.length >= limit) break;
    if (seen.has(i.fdcId)) continue;
    const hay = normalise(i.description);
    if (words.every((w) => hay.includes(w))) results.push(describeRecord(i));
  }
  return results.slice(0, limit);
}

function resolveIngredient(input) {
  const found = findIngredient(input);
  if (!found) throw new Error(`Unknown ingredient "${typeof input === 'string' ? input : input?.id}"`);
  return found;
}

const PACKING_FORMS = ['packed', 'unpacked', 'sifted', 'unsifted', 'loosely-packed', 'unsifted-dipped'];

/**
 * Density of an ingredient in g/mL, with its source and any warnings.
 * Options: form, temperatureC, fatPercent, calibrated (dairy model, default true).
 */
export function getDensity(ingredientInput, options = {}) {
  const ing = resolveIngredient(ingredientInput);
  const { form, temperatureC, fatPercent, calibrated = true } = options;
  const warnings = [];
  if (ing.note) warnings.push(ing.note);

  if (temperatureC !== undefined && !Number.isFinite(temperatureC)) throw new Error('temperatureC must be a number');
  if (fatPercent !== undefined && !(fatPercent >= 0 && fatPercent < 100)) throw new Error('fatPercent must be in [0, 100)');

  // Water: standard reference value, Choi-Okos ratio for temperature.
  if (ing.kind === 'model' && ing.model === 'water') {
    const t = temperatureC ?? 20;
    if (form && form !== 'default') throw new Error('water has only the default form');
    if (fatPercent !== undefined) warnings.push('fatPercent ignored: water has no fat.');
    if (t < 0 || t > 100) warnings.push(`temperatureC ${t} is outside 0 to 100 C; water is not a liquid across that whole range.`);
    return {
      densityGPerMl: WATER_DENSITY_20C * (chociOkosDensity({ water: 1 }, t) / chociOkosDensity({ water: 1 }, 20)),
      form: 'default',
      temperatureC: t,
      source: { kind: 'reference', name: 'water, 0.9982 g/mL at 20 C, Choi-Okos temperature ratio' },
      warnings,
    };
  }

  // Dairy model: aliases with a fat percentage, or USDA dairy liquids when fatPercent is given.
  const useDairyModel = ing.kind === 'model' ? ing.model === 'dairy' : ing.dairy && fatPercent !== undefined;
  if (useDairyModel) {
    const fat = fatPercent ?? ing.fatPercent;
    if (fat === null || fat === undefined) throw new Error(`${ing.id} needs fatPercent, for example fatPercent: 30`);
    const t = temperatureC ?? 20;
    const [lo, hi] = dairyFatRange();
    if (fat > hi + 1e-9) warnings.push(`fatPercent ${fat} is above ${hi.toFixed(2)}, the richest USDA record the dairy model was fitted to: extrapolated.`);
    if (fat < lo - 1e-9) warnings.push(`fatPercent ${fat} is below ${lo.toFixed(2)}, the leanest USDA record the dairy model was fitted to: extrapolated.`);
    if (form && form !== 'default') throw new Error(`${ing.id} has only the default form`);
    return {
      densityGPerMl: creamDensity({ fatPercent: fat, temperatureC: t, calibrated }),
      form: 'default',
      temperatureC: t,
      fatPercent: fat,
      source: { kind: 'model', name: calibrated ? 'dairy model (Choi-Okos), calibrated to USDA' : 'dairy model (Choi-Okos), uncalibrated', model: 'dairy' },
      warnings,
    };
  }

  // USDA record.
  if (fatPercent !== undefined) warnings.push(`fatPercent ignored: ${ing.id} is not a dairy liquid.`);
  const chosen = form ?? ing.form;
  if (!(chosen in ing.forms)) {
    throw new Error(`${ing.id} has no form "${chosen}". Available: ${Object.keys(ing.forms).join(', ')}`);
  }
  const names = Object.keys(ing.forms);
  if (!form && names.some((n) => PACKING_FORMS.includes(n))) {
    const others = names.filter((n) => n !== chosen);
    if (others.length) warnings.push(`Form "${chosen}" used. Packing changes density: also available ${others.join(', ')}.`);
  }
  let densityGPerMl = ing.forms[chosen];
  let t = 20;
  if (temperatureC !== undefined && temperatureC !== 20) {
    if (!ing.liquid) {
      warnings.push(`temperatureC ignored: ${ing.id} is not treated as a liquid, and a powder or solid's bulk density depends on packing, not temperature.`);
    } else if (!ing.composition || ing.composition.sum < 0.95) {
      warnings.push(`temperatureC ignored: the composition of ${ing.id} is incomplete, so the model cannot scale it.`);
    } else {
      densityGPerMl = adjustDensityForTemperature(densityGPerMl, ing.composition, 20, temperatureC);
      t = temperatureC;
    }
  }
  return {
    densityGPerMl,
    form: chosen,
    temperatureC: t,
    source: { kind: 'usda-sr-legacy', fdcId: ing.fdcId, description: ing.description },
    warnings,
  };
}

/**
 * Convert an amount between any two units. Volume to mass and back use the
 * ingredient's density; volume to volume and mass to mass need none.
 * Options: ingredient, amount, from, to, form, temperatureC, fatPercent, calibrated.
 */
export function convert({ ingredient, amount, from, to, ...options }) {
  if (!Number.isFinite(amount)) throw new Error('amount must be a number');
  const fromUnit = parseUnit(from);
  const toUnit = parseUnit(to);
  if (fromUnit.kind === toUnit.kind) {
    const warnings = [];
    if (ingredient !== undefined && (options.temperatureC !== undefined || options.fatPercent !== undefined)) {
      warnings.push('Same-kind conversion needs no density; temperatureC and fatPercent were not used.');
    }
    return {
      value: convertUnit(amount, fromUnit, toUnit),
      unit: toUnit.id,
      amount,
      from: fromUnit.id,
      densityGPerMl: null,
      source: null,
      form: null,
      warnings,
    };
  }
  if (ingredient === undefined) throw new Error('A volume-to-mass conversion needs an ingredient');
  const d = getDensity(ingredient, options);
  let value;
  let volumeMl;
  if (fromUnit.kind === 'volume') {
    volumeMl = toMl(amount, fromUnit);
    value = convertUnit(volumeMl * d.densityGPerMl, parseUnit('g'), toUnit);
  } else {
    const grams = convertUnit(amount, fromUnit, parseUnit('g'));
    volumeMl = grams / d.densityGPerMl;
    value = fromMl(volumeMl, toUnit);
  }
  return {
    value,
    unit: toUnit.id,
    amount,
    from: fromUnit.id,
    volumeMl,
    densityGPerMl: d.densityGPerMl,
    form: d.form,
    temperatureC: d.temperatureC,
    ...(d.fatPercent !== undefined ? { fatPercent: d.fatPercent } : {}),
    source: d.source,
    warnings: d.warnings,
  };
}

/** Grams for `amount` of a volume (or any) unit. Defaults to grams. */
export function toGrams({ ingredient, amount, unit, to = 'g', ...options }) {
  return convert({ ingredient, amount, from: unit, to, ...options });
}

/** Volume for `amount` of a mass unit (default grams). `to` is the volume unit, default US cup. */
export function toVolume({ ingredient, amount, unit = 'g', to = 'cup', ...options }) {
  return convert({ ingredient, amount, from: unit, to, ...options });
}
