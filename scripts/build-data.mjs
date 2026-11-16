// Build data/ingredients.json, data/ingredients.csv and data/build-report.json
// from USDA FoodData Central SR Legacy (April 2018, public domain).
// Deterministic: no timestamps, stable sort order, fixed rounding.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getUnit, toMl } from '../src/units.mjs';
import { mentionsVolume, parseModifier } from '../src/usda-modifier.mjs';
import { fitDairyModel, dairyComposition } from '../src/physics/dairy.mjs';
import { density as modelDensity } from '../src/physics/choi-okos.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ZIP_URL = 'https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip';
const DIR_NAME = 'FoodData_Central_sr_legacy_food_csv_2018-04';
const SRC_ROOT = `${ROOT}vendor-src/sr/`;
const SRC = `${SRC_ROOT}${DIR_NAME}/`;
const DATA = `${ROOT}data/`;

// Pick the largest portion; ties broken by this order (cup > fl oz > tbsp > tsp).
const UNIT_RANK = ['cup', 'quart', 'pint', 'L', 'fl oz', 'cubic inch', 'tbsp', 'tsp', 'mL'];

async function ensureSource() {
  if (existsSync(`${SRC}food_portion.csv`)) return;
  mkdirSync(SRC_ROOT, { recursive: true });
  const zipPath = `${SRC_ROOT}sr_legacy.zip`;
  const res = await fetch(ZIP_URL);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));
  execFileSync('unzip', ['-o', '-q', zipPath, '-d', SRC_ROOT]);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows;
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

const readCsv = (name) => parseCsv(readFileSync(`${SRC}${name}`, 'utf8'));
const round = (x, places) => Number(x.toFixed(places));
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function csvField(v) {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function bump(map, key) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function top(map, n) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || cmp(a[0], b[0]))
    .slice(0, n)
    .map(([modifier, count]) => ({ modifier, count }));
}

await ensureSource();

const foods = readCsv('food.csv');
const categories = new Map(readCsv('food_category.csv').map((c) => [c.id, c.description]));
const portions = readCsv('food_portion.csv');

// Nutrient ids in food_nutrient.csv (grams per 100 g of food).
const NUTRIENT_IDS = { '1051': 'water', '1003': 'protein', '1004': 'fat', '1005': 'carbohydrateByDifference', '1079': 'fiber', '1007': 'ash' };
const nutrients = new Map();
for (const n of readCsv('food_nutrient.csv')) {
  const key = NUTRIENT_IDS[n.nutrient_id];
  if (!key || n.amount === '') continue;
  if (!nutrients.has(n.fdc_id)) nutrients.set(n.fdc_id, {});
  nutrients.get(n.fdc_id)[key] = Number(n.amount);
}

/**
 * Mass fractions (g per g) for the Choi-Okos model. SR "carbohydrate, by difference"
 * includes dietary fibre, so the carbohydrate fraction here is that value minus fibre
 * and the fibre fraction is kept separate: nothing is counted twice. Returns null
 * when water, protein, fat or carbohydrate-by-difference is missing; a missing
 * fibre or ash value is left out and listed in `missing`.
 */
function compositionOf(fdcId) {
  const n = nutrients.get(fdcId);
  if (!n) return null;
  for (const k of ['water', 'protein', 'fat', 'carbohydrateByDifference']) if (n[k] === undefined) return null;
  const missing = ['fiber', 'ash'].filter((k) => n[k] === undefined);
  const fiber = n.fiber ?? 0;
  const carbohydrate = Math.max(0, n.carbohydrateByDifference - fiber);
  const c = {
    water: n.water / 100,
    protein: n.protein / 100,
    fat: n.fat / 100,
    carbohydrate: carbohydrate / 100,
    fiber: fiber / 100,
    ash: (n.ash ?? 0) / 100,
  };
  const out = {};
  for (const [k, v] of Object.entries(c)) out[k] = round(v, 6);
  out.sum = round(Object.values(c).reduce((a, b) => a + b, 0), 6);
  out.carbohydrateByDifference = round(n.carbohydrateByDifference / 100, 6);
  if (missing.length) out.missing = missing;
  return out;
}

const portionsByFood = new Map();
for (const p of portions) {
  if (!portionsByFood.has(p.fdc_id)) portionsByFood.set(p.fdc_id, []);
  portionsByFood.get(p.fdc_id).push(p);
}

const skippedNonVolume = new Map();
const skippedUnparsed = new Map();
const skippedReasons = new Map();
let portionsConverted = 0;
let portionsBadNumbers = 0;

const records = [];
for (const food of foods) {
  const byForm = new Map();
  for (const p of portionsByFood.get(food.fdc_id) ?? []) {
    const parsed = parseModifier(p.modifier);
    if (!parsed.ok) {
      bump(skippedReasons, parsed.reason);
      bump(mentionsVolume(p.modifier) ? skippedUnparsed : skippedNonVolume, p.modifier);
      continue;
    }
    const amount = Number(p.amount);
    const grams = Number(p.gram_weight);
    if (!(amount > 0) || !(grams > 0)) {
      portionsBadNumbers++;
      bump(skippedReasons, 'non-positive-amount-or-grams');
      bump(skippedUnparsed, p.modifier);
      continue;
    }
    // mL and L are defined only under "metric"; NLEA rows use the FDA labelling units.
    const resolved = parsed.unit === 'mL' || parsed.unit === 'L'
      ? getUnit('metric', parsed.unit)
      : getUnit(parsed.nlea ? 'us-legal' : 'us-customary', parsed.unit);
    const volumeMl = toMl(amount, resolved);
    portionsConverted++;
    if (!byForm.has(parsed.form)) byForm.set(parsed.form, []);
    byForm.get(parsed.form).push({
      usdaPortionId: Number(p.id),
      amount,
      modifier: p.modifier,
      gramWeight: grams,
      unit: resolved.id,
      volumeMl: round(volumeMl, 6),
      densityGPerMl: round(grams / volumeMl, 6),
    });
  }
  if (byForm.size === 0) continue;

  const forms = [...byForm.entries()]
    .map(([form, list]) => {
      list.sort((a, b) => a.usdaPortionId - b.usdaPortionId);
      // Densest evidence = largest total volume (rounding in gram_weight matters least there).
      const basis = list.reduce((best, p) => {
        if (p.volumeMl !== best.volumeMl) return p.volumeMl > best.volumeMl ? p : best;
        const rank = (x) => UNIT_RANK.indexOf(x.unit.split(':')[1]);
        return rank(p) < rank(best) ? p : best;
      });
      return { form, densityGPerMl: basis.densityGPerMl, basisPortionId: basis.usdaPortionId, portions: list };
    })
    .sort((a, b) => cmp(a.form, b.form));

  records.push({
    fdcId: Number(food.fdc_id),
    description: food.description,
    category: categories.get(food.food_category_id) ?? '',
    source: 'usda-sr-legacy',
    ...(compositionOf(food.fdc_id) ? { composition: compositionOf(food.fdc_id) } : {}),
    forms,
  });
}

// Ids: slug of the description; every food sharing a slug gets its fdcId appended.
const slugCount = new Map();
for (const r of records) bump(slugCount, slug(r.description));
for (const r of records) {
  const s = slug(r.description);
  r.id = slugCount.get(s) > 1 ? `${s}-${r.fdcId}` : s;
}
records.sort((a, b) => cmp(a.id, b.id));
const ordered = records.map(({ id, fdcId, description, category, source, composition, forms }) => ({
  id, fdcId, description, category, source, ...(composition ? { composition } : {}), forms,
}));

mkdirSync(DATA, { recursive: true });
writeFileSync(`${DATA}ingredients.json`, `${JSON.stringify(
  {
    schemaVersion: 1,
    source: {
      name: 'USDA FoodData Central, SR Legacy',
      release: '2018-04',
      url: ZIP_URL,
      license: 'Public domain (CC0 1.0)',
    },
    densityUnit: 'g/mL',
    compositionUnit: 'g per g of food (USDA per-100-g values divided by 100); carbohydrate excludes fiber',
    ingredients: ordered,
  },
  null,
  2,
)}\n`);

// Dairy model for creamDensity(): fit to plain, unfortified USDA dairy records.
const DAIRY_FDC_IDS = [173432, 172217, 171255, 170857, 170858, 170859];
const dairyRecords = DAIRY_FDC_IDS.map((id) => {
  const r = ordered.find((x) => x.fdcId === id);
  if (!r?.composition) throw new Error(`Dairy record ${id} missing or has no composition`);
  return { fdcId: id, description: r.description, composition: r.composition };
});
const dairyModel = fitDairyModel(dairyRecords);
for (const c of Object.values(dairyModel.components)) {
  c.intercept = round(c.intercept, 8);
  c.slope = round(c.slope, 8);
}
// Calibration anchors: how far the uncalibrated model sits from USDA's measured
// density at each anchor record's own fat content (model evaluated at 20 C).
dairyModel.calibration = dairyRecords.map((r) => {
  const usda = ordered.find((x) => x.fdcId === r.fdcId).forms.find((f) => f.form === 'default').densityGPerMl;
  const fat = r.composition.fat;
  const model = modelDensity(dairyComposition(fat * 100, dairyModel), 20);
  return { fdcId: r.fdcId, fat, usdaDensityGPerMl: usda, modelDensityGPerMl: round(model, 6), ratio: round(usda / model, 8) };
}).sort((a, b) => a.fat - b.fat);
writeFileSync(`${DATA}dairy-model.json`, `${JSON.stringify({ schemaVersion: 1, ...dairyModel }, null, 2)}\n`);

const csvLines = ['id,fdc_id,description,category,form,density_g_per_ml,basis_modifier,basis_amount,basis_grams,portions'];
for (const r of ordered) {
  for (const f of r.forms) {
    const b = f.portions.find((p) => p.usdaPortionId === f.basisPortionId);
    csvLines.push([r.id, r.fdcId, r.description, r.category, f.form, f.densityGPerMl, b.modifier, b.amount, b.gramWeight, f.portions.length].map(csvField).join(','));
  }
}
writeFileSync(`${DATA}ingredients.csv`, `${csvLines.join('\n')}\n`);

const nonVolumeTotal = [...skippedNonVolume.values()].reduce((a, b) => a + b, 0);
const unparsedTotal = [...skippedUnparsed.values()].reduce((a, b) => a + b, 0);
const combined = new Map(skippedNonVolume);
for (const [k, v] of skippedUnparsed) combined.set(k, (combined.get(k) ?? 0) + v);
writeFileSync(`${DATA}build-report.json`, `${JSON.stringify(
  {
    foodsInSource: foods.length,
    foodsWithDensity: ordered.length,
    forms: ordered.reduce((n, r) => n + r.forms.length, 0),
    portionsInSource: portions.length,
    portionsConverted,
    portionsSkipped: nonVolumeTotal + unparsedTotal,
    skippedNonVolume: nonVolumeTotal,
    skippedVolumeUnparsed: unparsedTotal,
    skippedBadNumbers: portionsBadNumbers,
    skipReasons: Object.fromEntries([...skippedReasons.entries()].sort((a, b) => cmp(a[0], b[0]))),
    topSkippedModifiers: top(combined, 15),
    topSkippedVolumeModifiers: top(skippedUnparsed, 25),
  },
  null,
  2,
)}\n`);
console.log(`Wrote ${ordered.length} foods, ${ordered.reduce((n, r) => n + r.forms.length, 0)} forms.`);
