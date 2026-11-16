// Parse the free-text `modifier` field of USDA SR Legacy food_portion.csv.
//
// In SR Legacy, measure_unit_id is 9999 ("undetermined") for nearly every row;
// the real unit is the leading word of the modifier ("cup", "tbsp, chopped",
// "cup (1 NLEA serving)"). A modifier is accepted only when it starts with a
// known volume unit and everything after it is a form qualifier we can name.
// Anything else returns { ok: false, reason } so the caller can count it.

// Leading unit words, longest first so "fl oz" wins over "fl".
const UNIT_WORDS = [
  ['tablespoons', 'tbsp'],
  ['tablespoon', 'tbsp'],
  ['teaspoons', 'tsp'],
  ['teaspoon', 'tsp'],
  ['cubic inch', 'cubic inch'],
  ['milliliter', 'mL'],
  ['fl oz', 'fl oz'],
  ['gallon', 'gallon'],
  ['quart', 'quart'],
  ['pint', 'pint'],
  ['liter', 'L'],
  ['tbsp', 'tbsp'],
  ['cup', 'cup'],
  ['tsp', 'tsp'],
  ['ml', 'mL'],
];

const VOLUME_HINT = /\b(cup|cups|tbsp|tablespoon|tablespoons|tsp|teaspoon|fl oz|fluid oz|pint|quart|gallon|liter|ml|milliliter|cubic inch)\b/i;

/** True if the text mentions a volume unit anywhere (used to sort skipped rows). */
export function mentionsVolume(modifier) {
  return VOLUME_HINT.test(modifier);
}

function slug(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * @param {string} modifier raw USDA modifier text
 * @returns {{ok:true, unit:string, nlea:boolean, form:string} | {ok:false, reason:string}}
 */
export function parseModifier(modifier) {
  const raw = modifier.trim();
  const lower = raw.toLowerCase();

  let unit = null;
  let rest = '';
  for (const [word, canonical] of UNIT_WORDS) {
    if (!lower.startsWith(word)) continue;
    const next = lower.charAt(word.length);
    if (next !== '' && !/[\s,(]/.test(next)) continue; // "cupcake", "tbsps"
    unit = canonical;
    rest = lower.slice(word.length);
    break;
  }
  if (unit === null) return { ok: false, reason: 'no-leading-volume-unit' };

  let nlea = false;
  const extra = [];
  // Parentheticals: keep a few meanings, drop harmless ones, reject the rest.
  const stripped = rest.replace(/\(([^)]*)\)/g, (_m, inner) => {
    const text = inner.trim();
    if (/nlea/.test(text)) {
      nlea = true;
      return ' ';
    }
    if (/^yields\b/.test(text)) return ' ';
    // "cup (4.86 large eggs)": how many eggs fill the cup. Informational, not a form.
    if (/^\d+(\.\d+)? (?:(?:extra )?(?:large|medium|small)|jumbo) eggs?$/.test(text)) return ' ';
    if (/^1 serving$/.test(text)) return ' ';
    if (unit === 'cup' && text === '8 fl oz') return ' ';
    if (text === 'not packed') {
      extra.push('unpacked');
      return ' ';
    }
    extra.push(`\u0000${text}`); // marker: unrecognised parenthetical
    return ' ';
  });
  if (extra.some((e) => e.startsWith('\u0000'))) return { ok: false, reason: 'unrecognised-parenthetical' };

  let qualifier = `${stripped} ${extra.join(' ')}`
    .replace(/,/g, ' ')
    .replace(/\bnot packed\b/g, 'unpacked')
    .replace(/\bfirmly packed\b/g, 'packed')
    .replace(/\s+/g, ' ')
    .trim();
  // Collapse immediate word repeats ("unpacked unpacked").
  qualifier = qualifier.split(' ').filter((w, i, a) => i === 0 || w !== a[i - 1]).join(' ');

  if (/\d/.test(qualifier)) return { ok: false, reason: 'qualifier-has-number' };
  if (/\byields?\b|\bfrom\b/.test(qualifier)) return { ok: false, reason: 'yield-or-reference' };
  if (/^(cup|cups|tbsp|tsp|fl oz|pint|quart)\b/.test(qualifier)) return { ok: false, reason: 'repeated-unit' };
  if (qualifier === 'or' || /^or\b/.test(qualifier)) return { ok: false, reason: 'alternative-unit' };

  // "cup, fluid" and "cup, liquid" name the pourable state, which is the default form
  // (heavy cream's 238 g fluid cup is its ordinary cup, not a variant).
  const form = qualifier === 'fluid' || qualifier === 'liquid' ? 'default' : slug(qualifier) || 'default';
  return { ok: true, unit, nlea, form };
}

// ---- Count and size portions ----------------------------------------------
//
// SR Legacy and FNDDS also list portions counted in things, not volume:
// "large", "medium", "clove", "slice", "stick". They go in a separate `counts`
// array and never enter the volume density maths. Only a fixed list of generic
// count words is accepted; cuts and packages ("steak", "jar", "can") are not.

const COUNT_WORDS = new Map([
  ['jumbo', 'jumbo'],
  ['large', 'large'],
  ['medium', 'medium'],
  ['small', 'small'],
  ['clove', 'clove'], ['cloves', 'clove'],
  ['each', 'each'],
  ['whole', 'whole'],
  ['stick', 'stick'], ['sticks', 'stick'],
  ['slice', 'slice'], ['slices', 'slice'],
  ['sprig', 'sprig'], ['sprigs', 'sprig'],
  ['leaf', 'leaf'], ['leaves', 'leaf'],
  ['pod', 'pod'], ['pods', 'pod'],
  ['piece', 'piece'], ['pieces', 'piece'],
  ['fruit', 'fruit'],
  ['head', 'head'],
  ['bunch', 'bunch'],
  ['stalk', 'stalk'], ['stalks', 'stalk'],
  ['ear', 'ear'], ['ears', 'ear'],
  ['spear', 'spear'], ['spears', 'spear'],
  ['wedge', 'wedge'], ['wedges', 'wedge'],
  ['pat', 'pat'],
  ['cube', 'cube'], ['cubes', 'cube'],
  ['bulb', 'bulb'],
  ['unit', 'unit'],
  ['item', 'item'],
]);

/**
 * @param {string} modifier raw USDA modifier text
 * @returns {{ok:true, label:string} | {ok:false}}
 */
export function parseCount(modifier) {
  const lower = modifier.trim().toLowerCase();
  // "lemon yields" (juice from one lemon): counted in fruit.
  const yields = /^(lemon|lime|orange) yields$/.exec(lower);
  if (yields) return { ok: true, label: yields[1] };
  const m = /^(extra[ -](?:large|small)|[a-z]+)(?=$|[\s,(])/.exec(lower);
  if (!m) return { ok: false };
  const word = m[1].replace('-', ' ');
  if (word === 'extra large' || word === 'extra small') return { ok: true, label: word };
  const label = COUNT_WORDS.get(word);
  return label ? { ok: true, label } : { ok: false };
}
