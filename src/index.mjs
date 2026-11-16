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
export { eggSizes, measurements, edibleGramsFromShell, shellGramsFromEdible, classifyEgg } from './eggs.mjs';
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
    form: record.forms.length === 0 ? null : record.forms.some((f) => f.form === 'default') ? 'default' : record.forms[0].form,
    forms,
    waterEquivalentForms: record.forms.filter((f) => f.waterEquivalent).map((f) => f.form),
    spreadByForm: Object.fromEntries(record.forms.filter((f) => f.portionSpreadPct).map((f) => [f.form, f.portionSpreadPct])),
    composition: record.composition ?? null,
    counts: record.counts ?? [],
    dataSource: record.source,
    liquid: false,
    dairy: false,
    ...extra,
  };
}

let brandedCache;
function brandedGaps() {
  brandedCache ??= readJson('../data/branded-gaps.json');
  return brandedCache;
}

function fromAlias(alias) {
  if (alias.ambiguousBetween) {
    return {
      id: alias.id, name: alias.names[0], kind: 'ambiguous', ambiguousBetween: alias.ambiguousBetween,
      form: null, forms: {}, composition: null, counts: [], dataSource: null, liquid: false, dairy: false,
      defaultUnit: null, note: alias.note ?? null,
    };
  }
  if (alias.branded) {
    const gap = brandedGaps().gaps.find((g) => g.id === alias.branded);
    if (!gap || !gap.n) throw new Error(`Alias ${alias.id} points at branded gap ${alias.branded}, which has no rows`);
    return {
      id: alias.id, name: alias.names[0], kind: 'branded', gap: alias.branded,
      form: 'default', forms: { default: gap.medianDensityGPerMl }, composition: null, counts: [],
      dataSource: 'usda-branded', liquid: false, dairy: false, defaultUnit: null, note: alias.note ?? null,
    };
  }
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
      counts: [],
      dataSource: null,
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
    ...(alias.form ? { form: alias.form } : {}),
    liquid: alias.liquid === true,
    dairy: alias.dairy === true,
    defaultUnit: alias.defaultUnit ?? null,
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
  if (ing.kind === 'ambiguous') throw new Error(`"${ing.name}" is ambiguous. ${ing.note} Choose one of: ${ing.ambiguousBetween.join(', ')}.`);
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

  // Branded-label median (gap ingredients USDA SR Legacy and FNDDS lack).
  if (ing.kind === 'branded') {
    const { gaps, source } = brandedGaps();
    const gap = gaps.find((g) => g.id === ing.gap);
    if (form && form !== 'default') throw new Error(`${ing.id} has only the default form`);
    if (temperatureC !== undefined && temperatureC !== 20) warnings.push(`temperatureC ignored: ${ing.id} has no composition to scale from.`);
    if (fatPercent !== undefined) warnings.push(`fatPercent ignored: ${ing.id} is not a dairy liquid.`);
    warnings.push(...gap.warnings);
    return {
      densityGPerMl: gap.medianDensityGPerMl,
      form: 'default',
      temperatureC: 20,
      source: {
        kind: 'usda-branded',
        gap: gap.id,
        rows: gap.n,
        release: source.release,
        medianUncertaintyPct: gap.medianUncertaintyPct,
        interquartileDensityGPerMl: [gap.q1DensityGPerMl, gap.q3DensityGPerMl],
      },
      warnings,
    };
  }

  // USDA record.
  if (fatPercent !== undefined) warnings.push(`fatPercent ignored: ${ing.id} is not a dairy liquid.`);
  if (Object.keys(ing.forms).length === 0) {
    throw new Error(`${ing.id} has no volume portions in the USDA data, only counts (${[...new Set(ing.counts.map((c) => c.label))].join(', ')}), so it cannot be converted to or from a volume.`);
  }
  const chosen = form ?? ing.form;
  if (!(chosen in ing.forms)) {
    throw new Error(`${ing.id} has no form "${chosen}". Available: ${Object.keys(ing.forms).join(', ')}`);
  }
  const names = Object.keys(ing.forms);
  if (!form && names.some((n) => PACKING_FORMS.includes(n))) {
    const others = names.filter((n) => n !== chosen);
    if (others.length) warnings.push(`Form "${chosen}" used. Packing changes density: also available ${others.join(', ')}.`);
  }
  if ((ing.waterEquivalentForms ?? []).includes(chosen) && !ing.liquid) {
    warnings.push(`Every volume portion of "${chosen}" in the USDA record weighs exactly like water (cup 240 g, tbsp 15 g, tsp 5 g). That fits a water-like liquid; for a paste or solid it usually means USDA used a placeholder, so treat the density as unverified.`);
  }
  if (ing.spreadByForm?.[chosen]) {
    warnings.push(`The USDA portions for "${chosen}" disagree by ${ing.spreadByForm[chosen]}% in density. The figure comes from the largest portion; check the portion rows in data/ingredients.json.`);
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
    source: { kind: ing.dataSource ?? 'usda-sr-legacy', fdcId: ing.fdcId, description: ing.description },
    warnings,
  };
}

// ---- Count units ("large", "clove", "slice") --------------------------------

const GENERIC_COUNT_WORDS = new Set(['each', 'ea', 'whole', 'piece', 'pieces', 'item', 'items', 'unit', 'units', 'count']);

function countWord(text) {
  return normalise(text).replace(/\bextra large\b/, 'extra large');
}

const PLURALS = new Map([['cloves', 'clove'], ['slices', 'slice'], ['leaves', 'leaf'], ['pods', 'pod'], ['sprigs', 'sprig'], ['stalks', 'stalk'], ['ears', 'ear'], ['spears', 'spear'], ['sticks', 'stick'], ['wedges', 'wedge'], ['cubes', 'cube'], ['lemons', 'lemon'], ['limes', 'lime'], ['oranges', 'orange']]);

/**
 * Find the count portion an ingredient has for `text` ("large", "clove", "slice, thin",
 * "cloves"). Returns {entry, others} or null. When several USDA rows share a label
 * (onion "slice"), the first is used and the rest are listed in `others`.
 * `size` narrows by a substring of the USDA size note.
 */
function findCount(ing, text, size) {
  const counts = ing.counts ?? [];
  if (!counts.length) return null;
  let word = countWord(text);
  if (GENERIC_COUNT_WORDS.has(word)) {
    if (counts.some((c) => c.label === word)) { /* a real label: use it */ } else if (ing.defaultUnit) word = countWord(ing.defaultUnit);
    else return null;
  }
  word = PLURALS.get(word) ?? word;
  let hits = counts.filter((c) => normalise(c.sizeNote) === word);
  if (!hits.length) hits = counts.filter((c) => c.label === word);
  if (size) hits = hits.filter((c) => c.sizeNote.toLowerCase().includes(String(size).toLowerCase()));
  if (!hits.length) return null;
  return { entry: hits[0], others: hits.slice(1) };
}

function countSource(ing, entry) {
  return { kind: ing.dataSource ?? 'usda-sr-legacy', fdcId: ing.fdcId, description: ing.description, portionId: entry.usdaPortionId, modifier: entry.sizeNote };
}

function resolveEndpoint(input, ing, size) {
  try {
    return { unit: parseUnit(input) };
  } catch (err) {
    if (typeof input !== 'string' || !ing || typeof ing === 'string') throw err;
    const found = findCount(ing, input, size);
    if (!found) {
      const labels = [...new Set((ing.counts ?? []).map((c) => c.label))];
      throw new Error(`${err.message} for ${ing.id}.${labels.length ? ` Counts available: ${labels.join(', ')}.` : ' It has no count portions.'}`);
    }
    return { count: found };
  }
}

/**
 * Convert an amount between any two units. Volume to mass and back use the
 * ingredient's density; volume to volume and mass to mass need none. A unit can
 * also be a count the ingredient has USDA portions for ("large", "clove", "slice"):
 * counts convert through grams, and through density when the other side is a volume.
 * Options: ingredient, amount, from, to, form, temperatureC, fatPercent, calibrated, size.
 */
export function convert({ ingredient, amount, from, to, size, ...options }) {
  if (!Number.isFinite(amount)) throw new Error('amount must be a number');
  const ing = ingredient === undefined ? undefined : resolveIngredient(ingredient);
  const fromEnd = resolveEndpoint(from ?? ing?.defaultUnit, ing, size);
  const toEnd = resolveEndpoint(to, ing, size);
  const fromUnit = fromEnd.unit;
  const toUnit = toEnd.unit;
  const usesCount = Boolean(fromEnd.count || toEnd.count);

  if (!usesCount && fromUnit.kind === toUnit.kind) {
    const warnings = [];
    if (ing && (options.temperatureC !== undefined || options.fatPercent !== undefined)) {
      warnings.push('Same-kind conversion needs no density; temperatureC and fatPercent were not used.');
    }
    return { value: convertUnit(amount, fromUnit, toUnit), unit: toUnit.id, amount, from: fromUnit.id, densityGPerMl: null, source: null, form: null, warnings };
  }
  if (!ing) throw new Error('This conversion needs an ingredient');

  const gram = parseUnit('g');
  const warnings = [];
  const needsDensity = (fromUnit?.kind === 'volume') || (toUnit?.kind === 'volume');
  const d = needsDensity ? getDensity(ing, options) : null;
  if (d) warnings.push(...d.warnings);
  else if (ing.note) warnings.push(ing.note);
  let countInfo = null;
  const note = (found, role) => {
    const e = found.entry;
    countInfo = { label: e.label, sizeNote: e.sizeNote, gramsPerUnit: e.gramsPerUnit, usdaPortionId: e.usdaPortionId };
    if (found.others.length) {
      warnings.push(`${found.others.length + 1} USDA portions match "${e.label}" (${role}); used "${e.sizeNote}" at ${e.gramsPerUnit} g. Others: ${found.others.map((o) => `"${o.sizeNote}" ${o.gramsPerUnit} g`).join(', ')}. Pass size to choose.`);
    }
    return e;
  };

  // Everything passes through grams.
  let grams;
  let volumeMl;
  if (fromEnd.count) grams = amount * note(fromEnd.count, 'from').gramsPerUnit;
  else if (fromUnit.kind === 'mass') grams = convertUnit(amount, fromUnit, gram);
  else { volumeMl = toMl(amount, fromUnit); grams = volumeMl * d.densityGPerMl; }

  let value;
  if (toEnd.count) value = grams / note(toEnd.count, 'to').gramsPerUnit;
  else if (toUnit.kind === 'mass') value = convertUnit(grams, gram, toUnit);
  else { volumeMl ??= grams / d.densityGPerMl; value = fromMl(grams / d.densityGPerMl, toUnit); }

  const countEnd = fromEnd.count ?? toEnd.count;
  return {
    value,
    unit: toEnd.count ? `count:${toEnd.count.entry.label}` : toUnit.id,
    amount,
    from: fromEnd.count ? `count:${fromEnd.count.entry.label}` : fromUnit.id,
    ...(volumeMl !== undefined ? { volumeMl } : {}),
    densityGPerMl: d ? d.densityGPerMl : null,
    form: d ? d.form : null,
    ...(d ? { temperatureC: d.temperatureC } : {}),
    ...(d && d.fatPercent !== undefined ? { fatPercent: d.fatPercent } : {}),
    ...(countInfo ? { count: countInfo } : {}),
    source: d ? d.source : countSource(ing, countEnd.entry),
    warnings,
  };
}

/** Grams for `amount` of a volume, count or mass unit. `to` defaults to grams. Without `unit`, the ingredient's default count (egg: large) is used. */
export function toGrams({ ingredient, amount, unit, to = 'g', ...options }) {
  return convert({ ingredient, amount, from: unit, to, ...options });
}

/** Volume for `amount` of a mass or count unit (default grams). `to` is the volume unit, default US cup. */
export function toVolume({ ingredient, amount, unit = 'g', to = 'cup', ...options }) {
  return convert({ ingredient, amount, from: unit, to, ...options });
}

/** A count ("large", "clove", "medium") from grams: how many of them make up `amount` of a mass unit. */
export function fromGrams({ ingredient, amount, unit = 'g', to, ...options }) {
  const ing = resolveIngredient(ingredient);
  return convert({ ingredient: ing, amount, from: unit, to: to ?? ing.defaultUnit, ...options });
}
