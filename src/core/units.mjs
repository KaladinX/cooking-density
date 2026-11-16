// Unit maths and friendly unit names. Nothing here touches the file system:
// the unit table (data/units.json) is passed in, so this runs in any runtime.

/** Volume in millilitres for `amount` of a volume unit. */
export function toMl(amount, unit) {
  if (unit.kind !== 'volume') throw new Error(`${unit.id} is not a volume unit`);
  return amount * unit.ml;
}

/** `ml` expressed in a volume unit. */
export function fromMl(ml, unit) {
  if (unit.kind !== 'volume') throw new Error(`${unit.id} is not a volume unit`);
  return ml / unit.ml;
}

/** Grams for `amount` of a mass unit. */
export function toGramsMass(amount, unit) {
  if (unit.kind !== 'mass') throw new Error(`${unit.id} is not a mass unit`);
  return amount * unit.grams;
}

/** Convert between two volume units, or between two mass units. */
export function convertUnit(amount, from, to) {
  if (from.kind !== to.kind) throw new Error('Cannot convert between volume and mass without a density');
  return from.kind === 'volume'
    ? fromMl(toMl(amount, from), to)
    : (amount * from.grams) / to.grams;
}

// ---- Friendly unit names ---------------------------------------------------

const SYSTEM_WORDS = [
  ['us customary', 'us-customary'],
  ['us-customary', 'us-customary'],
  ['customary', 'us-customary'],
  ['us legal', 'us-legal'],
  ['us-legal', 'us-legal'],
  ['legal', 'us-legal'],
  ['nlea', 'us-legal'],
  ['us', 'us-customary'],
  ['metric', 'metric'],
  ['australian', 'australian'],
  ['australia', 'australian'],
  ['aus', 'australian'],
  ['au', 'australian'],
  ['imperial', 'imperial'],
  ['uk', 'imperial'],
  ['imp', 'imperial'],
];

const BASE_NAMES = new Map([
  ['cup', 'cup'], ['cups', 'cup'], ['c', 'cup'],
  ['tbsp', 'tbsp'], ['tbsps', 'tbsp'], ['tbs', 'tbsp'], ['tb', 'tbsp'], ['tablespoon', 'tbsp'], ['tablespoons', 'tbsp'],
  ['tsp', 'tsp'], ['tsps', 'tsp'], ['teaspoon', 'tsp'], ['teaspoons', 'tsp'],
  ['dessertspoon', 'dessertspoon'], ['dessertspoons', 'dessertspoon'], ['dsp', 'dessertspoon'], ['dstspn', 'dessertspoon'],
  ['fl oz', 'fl oz'], ['floz', 'fl oz'], ['fluid ounce', 'fl oz'], ['fluid ounces', 'fl oz'], ['fluid oz', 'fl oz'],
  ['pint', 'pint'], ['pints', 'pint'], ['pt', 'pint'],
  ['quart', 'quart'], ['quarts', 'quart'], ['qt', 'quart'],
  ['gallon', 'gallon'], ['gallons', 'gallon'], ['gal', 'gallon'],
  ['cubic inch', 'cubic inch'], ['cubic inches', 'cubic inch'], ['in3', 'cubic inch'],
  ['ml', 'mL'], ['milliliter', 'mL'], ['milliliters', 'mL'], ['millilitre', 'mL'], ['millilitres', 'mL'],
  ['l', 'L'], ['liter', 'L'], ['liters', 'L'], ['litre', 'L'], ['litres', 'L'],
  ['dl', 'dL'], ['deciliter', 'dL'], ['deciliters', 'dL'], ['decilitre', 'dL'], ['decilitres', 'dL'],
  ['cl', 'cL'], ['centiliter', 'cL'], ['centiliters', 'cL'], ['centilitre', 'cL'], ['centilitres', 'cL'],
]);

// Names that exist only in the metric system, so a bare one is metric, not US.
const METRIC_ONLY = new Set(['mL', 'L', 'dL', 'cL', 'dessertspoon']);

const MASS_NAMES = new Map([
  ['g', 'g'], ['gram', 'g'], ['grams', 'g'], ['gramme', 'g'], ['grammes', 'g'],
  ['mg', 'mg'], ['milligram', 'mg'], ['milligrams', 'mg'],
  ['kg', 'kg'], ['kilo', 'kg'], ['kilos', 'kg'], ['kilogram', 'kg'], ['kilograms', 'kg'],
  ['oz', 'oz'], ['ounce', 'oz'], ['ounces', 'oz'],
  ['lb', 'lb'], ['lbs', 'lb'], ['pound', 'lb'], ['pounds', 'lb'],
]);

// The imperial system has no spoon here on purpose: the old imperial tablespoon
// (17.8 mL) is not what a modern UK recipe means. Say what to write instead.
const MISSING_HINT = {
  'imperial:tbsp': ' Modern UK recipes use the metric spoon: write "metric tbsp" (15 mL).',
  'imperial:tsp': ' Modern UK recipes use the metric spoon: write "metric tsp" (5 mL).',
  'imperial:dessertspoon': ' Write "dessertspoon" (10 mL, metric).',
};

// An error for text that is a unit name, only not a usable one. The converter
// reports these as they are instead of trying the text as a count ("large", "clove").
const recognised = (message) => Object.assign(new Error(message), { unitRecognised: true });

/**
 * Bind the unit helpers to a unit table: the parsed data/units.json, or its
 * `units` array.
 */
export function createUnits(table) {
  const units = Array.isArray(table) ? table : table?.units;
  if (!Array.isArray(units)) throw new Error('createUnits needs the unit table from data/units.json');
  const byId = new Map(units.map((u) => [u.id, u]));

  function getUnit(system, name) {
    const unit = byId.get(`${system}:${name}`);
    if (!unit) throw new Error(`Unknown unit ${system}:${name}`);
    return unit;
  }

  /**
   * Resolve a unit given as a unit object, an id ("us-legal:cup") or a friendly string
   * ("cup", "Tbsp", "us cup", "metric cup", "au tbsp", "imperial pint", "ml", "fl oz").
   * Bare "cup", "tbsp", "tsp", "fl oz", "pint", "quart" and "gallon" mean US customary.
   * Legal (NLEA) units must be named: "us-legal cup" or "legal tbsp".
   * A lone capital "T" is a tablespoon and a lone small "t" a teaspoon; every
   * other name ignores case.
   */
  function parseUnit(input) {
    if (input && typeof input === 'object' && typeof input.id === 'string') return input;
    if (typeof input !== 'string') throw new Error('Unit must be a string or a unit object');
    const direct = byId.get(input.trim());
    if (direct) return direct;

    let text = input.trim().toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ');
    let system = null;
    for (const [word, id] of SYSTEM_WORDS) {
      if (text === word) break; // a bare system word is not a unit
      if (text.startsWith(`${word} `)) {
        system = id;
        text = text.slice(word.length + 1).trim();
        break;
      }
    }
    if (MASS_NAMES.has(text)) {
      if (system) throw recognised(`Mass unit "${input}" takes no system prefix`);
      return getUnit('mass', MASS_NAMES.get(text));
    }
    // Old US recipes write T for tablespoon and t for teaspoon.
    const name = text === 't'
      ? (/T\.?$/.test(input.trim()) ? 'tbsp' : 'tsp')
      : BASE_NAMES.get(text);
    if (!name) throw new Error(`Unknown unit "${input}"`);
    if (!system) system = METRIC_ONLY.has(name) ? 'metric' : 'us-customary';
    const unit = byId.get(`${system}:${name}`);
    if (!unit) throw recognised(`No "${name}" in the ${system} system.${MISSING_HINT[`${system}:${name}`] ?? ''}`);
    return unit;
  }

  return { units, getUnit, parseUnit };
}
