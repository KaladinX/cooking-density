// cooking-density core: the whole helper as one function of its data.
//
//   const { toGrams, toVolume, convert, findIngredient } = createConverter(data);
//
// Nothing in this file or its imports touches the file system or the network,
// so it runs in a browser, a worker or any JavaScript runtime. Two entry
// points bind it to data for you:
//
//   cooking-density        Node: every USDA food, read from data/ on first use
//   cooking-density/lite   anywhere: the curated ingredients only, bundled
//
// Densities come from USDA records (SR Legacy, FNDDS), from the water reference
// value, from the dairy model, or from branded-label medians. Every result
// names its source.
import { createUnits, toMl, fromMl, convertUnit } from './core/units.mjs';
import { createEggs } from './core/eggs.mjs';
import { density as choiOkosDensity, componentDensity, adjustDensityForTemperature } from './physics/choi-okos.mjs';
import { creamDensity as modelCreamDensity, dairyFatRange } from './physics/dairy-model.mjs';

/** Pure water at 20 C, g/mL. Standard reference value (see docs/plans/physics-notes.md). */
export const WATER_DENSITY_20C = 0.9982;

const PACKING_FORMS = ['packed', 'unpacked', 'sifted', 'unsifted', 'loosely-packed', 'unsifted-dipped'];

const GENERIC_COUNT_WORDS = new Set(['each', 'ea', 'whole', 'piece', 'pieces', 'item', 'items', 'unit', 'units', 'count']);

const COUNT_SYNONYMS = new Map([
  ['xl', 'extra large'], ['x large', 'extra large'], ['xlarge', 'extra large'],
  ['lg', 'large'], ['lrg', 'large'],
  ['med', 'medium'], ['md', 'medium'],
  ['sm', 'small'], ['sml', 'small'],
  ['xs', 'extra small'], ['x small', 'extra small'],
]);

const PLURALS = new Map([['leaves', 'leaf'], ['halves', 'half'], ['loaves', 'loaf'], ['berries', 'berry'], ['cherries', 'cherry']]);

function normalise(text) {
  return String(text)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9%]+/g, ' ')
    .trim();
}

/** A word and the singular spellings it could stand for: "cloves" gives cloves, clove. */
function singulars(word) {
  const out = [word];
  if (PLURALS.has(word)) out.push(PLURALS.get(word));
  if (word.endsWith('es')) out.push(word.slice(0, -2));
  if (word.endsWith('s')) out.push(word.slice(0, -1));
  return out;
}

/** Call `source` once if it is a function; otherwise it is the value. */
function lazy(source, name) {
  let value;
  let loaded = false;
  return () => {
    if (!loaded) {
      value = typeof source === 'function' ? source() : source;
      loaded = true;
    }
    if (value === undefined || value === null) throw new Error(`This converter was created without "${name}" data`);
    return value;
  };
}

/** Accept a data file as stored ({ schemaVersion, units: [...] }) or its bare array. */
const listOf = (file, key) => (Array.isArray(file) ? file : file?.[key]);

/**
 * Build the helper from its data. Each entry is the parsed JSON file of the same
 * name in data/ (or its main array), or a function returning it, called on first use:
 *
 *   units         data/units.json            required
 *   aliases       data/aliases.json          required
 *   ingredients   data/ingredients.json      required; any subset of its records works
 *   dairyModel    data/dairy-model.json      for cream and milk by fat percentage
 *   brandedGaps   data/branded-gaps.json     for ghee, kosher salt and the other label medians
 *   eggSizes      data/egg-sizes.json        for classifyEgg and the shell helpers
 *   measurements  data/measurements.json     for measurements()
 *
 * `data/lite.json` holds all seven in one object, trimmed to the curated ingredients.
 */
export function createConverter(sources) {
  if (!sources || typeof sources !== 'object') throw new Error('createConverter needs the data: see data/lite.json');
  const { units, getUnit, parseUnit } = createUnits(typeof sources.units === 'function' ? sources.units() : sources.units);
  const loadAliases = lazy(sources.aliases, 'aliases');
  const loadIngredients = lazy(sources.ingredients, 'ingredients');
  const dairyModel = lazy(sources.dairyModel, 'dairyModel');
  const brandedGaps = lazy(sources.brandedGaps, 'brandedGaps');
  const loadEggSizes = lazy(sources.eggSizes, 'eggSizes');
  const loadMeasurements = lazy(sources.measurements, 'measurements');
  const eggs = createEggs(loadEggSizes, () => listOf(loadMeasurements(), 'measurements'));

  let cache;
  function data() {
    if (cache) return cache;
    const ingredients = listOf(loadIngredients(), 'ingredients');
    const aliases = listOf(loadAliases(), 'aliases');
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
    cache = { ingredients, aliases, byFdc, byName, searchIndex: null };
    return cache;
  }

  function describeRecord(record, extra = {}) {
    const forms = Object.fromEntries(record.forms.map((f) => [f.form, f.densityGPerMl]));
    return {
      id: record.id,
      name: record.description,
      names: [record.description],
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

  function fromAlias(alias) {
    if (alias.ambiguousBetween) {
      return {
        id: alias.id, name: alias.names[0], names: alias.names, kind: 'ambiguous', ambiguousBetween: alias.ambiguousBetween,
        form: null, forms: {}, composition: null, counts: [], dataSource: null, liquid: false, dairy: false,
        defaultUnit: null, note: alias.note ?? null,
      };
    }
    if (alias.branded) {
      const gap = brandedGaps().gaps.find((g) => g.id === alias.branded);
      if (!gap || !gap.n) throw new Error(`Alias ${alias.id} points at branded gap ${alias.branded}, which has no rows`);
      return {
        id: alias.id, name: alias.names[0], names: alias.names, kind: 'branded', gap: alias.branded,
        form: 'default', forms: { default: gap.medianDensityGPerMl }, composition: null, counts: [],
        dataSource: 'usda-branded', liquid: false, dairy: false, defaultUnit: null, note: alias.note ?? null,
      };
    }
    if (alias.model) {
      return {
        id: alias.id,
        name: alias.names[0],
        names: alias.names,
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
      names: alias.names,
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
  function findIngredient(query) {
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

  // "30% cream", "30 percent M.F. cream", "2% milk", "cream 18%", "cream (35% fat)"
  // with no alias of their own: the dairy model at that fat.
  function fatPercentQuery(query) {
    const text = String(query).toLowerCase().replace(/\bm\.\s*f\.?/g, 'mf').replace(/\bb\.\s*f\.?/g, 'bf').trim();
    const number = '(\\d+(?:\\.\\d+)?)\\s*(?:%|percent)';
    const fatWord = '(?:mf|bf|milk\\s?fat|butterfat|fat)';
    const m = new RegExp(`^${number}\\s*(?:${fatWord}\\s+)?(cream|milk)$`).exec(text)
      ?? new RegExp(`^(cream|milk)[\\s,(]+${number}\\s*${fatWord}?\\s*\\)?$`).exec(text);
    if (!m) return null;
    const [kind, percent] = /\d/.test(m[1]) ? [m[2], m[1]] : [m[1], m[2]];
    const fatPercent = Number(percent);
    if (!(fatPercent >= 0 && fatPercent < 100)) return null;
    return fromAlias({
      id: `${kind}-${fatPercent}pct`,
      names: [String(query).trim()],
      model: 'dairy',
      fatPercent,
      liquid: true,
    });
  }

  /**
   * Words-in-any-order search over alias names and USDA descriptions.
   * Returns up to `limit` ingredient objects. Aliases come first, an exact name
   * before a partial one. USDA records follow, best match first: whole-word
   * matches, then SR Legacy before FNDDS, raw foods before prepared ones, short
   * descriptions before long.
   */
  function searchIngredients(query, { limit = 10 } = {}) {
    const text = normalise(query);
    const words = text.split(' ').filter(Boolean);
    if (!words.length) return [];
    const d = data();
    d.searchIndex ??= {
      aliases: d.aliases.map((a) => ({ alias: a, names: [a.id, ...a.names].map(normalise) })),
      records: d.ingredients.map((record, order) => ({ record, order, hay: normalise(record.description) })),
    };
    const wordStarts = (hay) => words.filter((w) => hay.startsWith(w) || hay.includes(` ${w}`)).length;

    const results = [];
    const seen = new Set();
    const aliasHits = [];
    for (const { alias, names } of d.searchIndex.aliases) {
      const hay = names.join(' ');
      if (!words.every((w) => hay.includes(w))) continue;
      aliasHits.push({ alias, exact: names.includes(text) ? 0 : 1, starts: -wordStarts(hay), order: aliasHits.length });
    }
    aliasHits.sort((a, b) => a.exact - b.exact || a.starts - b.starts || a.order - b.order);
    for (const { alias } of aliasHits) {
      results.push(fromAlias(alias));
      if (alias.fdcId) seen.add(alias.fdcId);
    }
    if (results.length >= limit) return results.slice(0, limit);

    const recordHits = [];
    for (const entry of d.searchIndex.records) {
      if (seen.has(entry.record.fdcId)) continue;
      if (!words.every((w) => entry.hay.includes(w))) continue;
      recordHits.push({
        entry,
        starts: -wordStarts(entry.hay),
        survey: entry.record.source === 'usda-sr-legacy' ? 0 : 1,
        prepared: /\braw\b/.test(entry.hay) ? 0 : 1,
        length: entry.hay.length,
      });
    }
    recordHits.sort((a, b) => a.starts - b.starts || a.survey - b.survey || a.prepared - b.prepared
      || a.length - b.length || a.entry.order - b.entry.order);
    for (const { entry } of recordHits.slice(0, limit - results.length)) results.push(describeRecord(entry.record));
    return results;
  }

  function resolveIngredient(input) {
    const found = findIngredient(input);
    if (!found) throw new Error(`Unknown ingredient "${typeof input === 'string' ? input : input?.id ?? input}"`);
    return found;
  }

  /**
   * Density in g/mL of cream or milk at `fatPercent` % fat by mass and `temperatureC`.
   * `calibrated` (default true) scales the model to USDA's measured values.
   */
  function creamDensity(options) {
    return modelCreamDensity(options, dairyModel());
  }

  /**
   * Density of an ingredient in g/mL, with its source and any warnings.
   * Options: form, temperatureC, fatPercent, calibrated (dairy model, default true).
   */
  function getDensity(ingredientInput, options = {}) {
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
        densityGPerMl: WATER_DENSITY_20C * (choiOkosDensity({ water: 1 }, t) / choiOkosDensity({ water: 1 }, 20)),
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
      const [lo, hi] = dairyFatRange(dairyModel());
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

  /** True when `word` is the ingredient itself: "eggs" for egg, "bananas" for "Bananas, raw". */
  function isOwnName(ing, word) {
    const own = new Set();
    const names = [...(ing.names ?? []), ing.name, ...(ing.description ? [ing.description.split(',')[0]] : [])];
    for (const n of names) for (const s of singulars(normalise(n))) own.add(s);
    return singulars(word).some((s) => own.has(s));
  }

  /**
   * Find the count portion an ingredient has for `text` ("large", "clove", "slice, thin",
   * "cloves", "XL"). Returns {entry, others, assumed} or null. When several USDA rows
   * share a label (onion "slice"), the first is used and the rest are listed in `others`.
   * `size` narrows by a substring of the USDA size note.
   *
   * A word that names no size ("each", "whole", or the ingredient's own name, as in
   * "2 eggs") takes the ingredient's default count. With no default it takes "medium",
   * or the only count the food has, and sets `assumed` so the caller can warn.
   */
  function findCount(ing, text, size) {
    const counts = ing.counts ?? [];
    if (!counts.length) return null;
    let word = normalise(text);
    word = COUNT_SYNONYMS.get(word) ?? word;
    let candidates = singulars(word);
    let assumed = false;
    const isLabel = candidates.some((c) => counts.some((k) => k.label === c));
    if (!isLabel && (GENERIC_COUNT_WORDS.has(word) || isOwnName(ing, word))) {
      const labels = [...new Set(counts.map((c) => c.label))];
      if (ing.defaultUnit) candidates = [normalise(ing.defaultUnit)];
      else if (labels.includes('medium')) { candidates = ['medium']; assumed = true; }
      else if (labels.length === 1) { candidates = labels; assumed = true; }
      else return null;
    }
    let hits = [];
    for (const c of candidates) {
      hits = counts.filter((k) => normalise(k.sizeNote) === c);
      if (!hits.length) hits = counts.filter((k) => k.label === c);
      if (hits.length) break;
    }
    if (size) hits = hits.filter((c) => c.sizeNote.toLowerCase().includes(String(size).toLowerCase()));
    if (!hits.length) return null;
    return { entry: hits[0], others: hits.slice(1), assumed };
  }

  function countSource(ing, entry) {
    return { kind: ing.dataSource ?? 'usda-sr-legacy', fdcId: ing.fdcId, description: ing.description, portionId: entry.usdaPortionId, modifier: entry.sizeNote };
  }

  function resolveEndpoint(input, ing, size) {
    if (input === undefined || input === null) {
      throw new Error(`No unit given${ing ? ` for ${ing.id}` : ''}. Pass one, such as "cup", "tbsp" or "g".`);
    }
    try {
      return { unit: parseUnit(input) };
    } catch (err) {
      if (typeof input !== 'string' || !ing || err.unitRecognised) throw err;
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
  function convert({ ingredient, amount, from, to, size, ...options } = {}) {
    if (!Number.isFinite(amount)) {
      throw new Error(`amount must be a number; got ${typeof amount === 'string' ? `the string "${amount}"` : String(amount)}`);
    }
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

    const gram = getUnit('mass', 'g');
    const warnings = [];
    const needsDensity = (fromUnit?.kind === 'volume') || (toUnit?.kind === 'volume');
    const d = needsDensity ? getDensity(ing, options) : null;
    if (d) warnings.push(...d.warnings);
    else if (ing.note) warnings.push(ing.note);
    let countInfo = null;
    const note = (found, role) => {
      const e = found.entry;
      countInfo = { label: e.label, sizeNote: e.sizeNote, gramsPerUnit: e.gramsPerUnit, usdaPortionId: e.usdaPortionId };
      if (found.assumed) {
        warnings.push(`No size given for ${ing.id}: used "${e.sizeNote}" at ${e.gramsPerUnit} g each.`);
      }
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
  function toGrams({ ingredient, amount, unit, to = 'g', ...options } = {}) {
    return convert({ ingredient, amount, from: unit, to, ...options });
  }

  /** Volume for `amount` of a mass or count unit (default grams). `to` is the volume unit, default US cup. */
  function toVolume({ ingredient, amount, unit = 'g', to = 'cup', ...options } = {}) {
    return convert({ ingredient, amount, from: unit, to, ...options });
  }

  /** A count ("large", "clove", "medium") from grams: how many of them make up `amount` of a mass unit. */
  function fromGrams({ ingredient, amount, unit = 'g', to, ...options } = {}) {
    const ing = resolveIngredient(ingredient);
    return convert({ ingredient: ing, amount, from: unit, to: to ?? ing.defaultUnit, ...options });
  }

  return {
    units,
    parseUnit,
    WATER_DENSITY_20C,
    findIngredient,
    searchIngredients,
    getDensity,
    convert,
    toGrams,
    toVolume,
    fromGrams,
    creamDensity,
    compositionDensity: choiOkosDensity,
    componentDensity,
    ...eggs,
  };
}
