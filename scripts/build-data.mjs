// Build data/ingredients.json, data/ingredients.csv and data/build-report.json
// from USDA FoodData Central: SR Legacy (April 2018) first, then FNDDS 2021-2023
// (survey foods) for foods SR does not cover. Both are public domain.
// Deterministic: no timestamps, stable sort order, fixed rounding.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getUnit, toMl } from '../src/units.mjs';
import { mentionsVolume, parseModifier, parseCount } from '../src/usda-modifier.mjs';
import { fitDairyModel, dairyComposition } from '../src/physics/dairy.mjs';
import { density as modelDensity } from '../src/physics/choi-okos.mjs';
import { buildEggSizes } from './egg-sizes.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ZIP_URL = 'https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip';
const DIR_NAME = 'FoodData_Central_sr_legacy_food_csv_2018-04';
const SRC_ROOT = `${ROOT}vendor-src/sr/`;
const SRC = `${SRC_ROOT}${DIR_NAME}/`;
const FNDDS_URL = 'https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_survey_food_csv_2024-10-31.zip';
const FNDDS_ROOT = `${ROOT}vendor-src/fndds/`;
const FNDDS = `${FNDDS_ROOT}FoodData_Central_survey_food_csv_2024-10-31/`;
const DATA = `${ROOT}data/`;

// Weights that a food has when its portions are exactly water-equivalent on the FDA
// household measures: cup 240 g, tbsp 15 g, tsp 5 g, fl oz 30 g. Real for water-like
// liquids; for pastes and solids it usually means USDA used a placeholder.
const WATER_WEIGHTS = { 'us-customary:cup': 240, 'us-customary:tbsp': 15, 'us-customary:tsp': 5, 'us-customary:fl oz': 30 };
const isWaterEquivalent = (portions) => portions.every((p) => {
  const w = WATER_WEIGHTS[p.unit];
  return w !== undefined && Math.abs(p.gramWeight / p.amount - w) < 0.06;
});

// Pick the largest portion; ties broken by this order (cup > fl oz > tbsp > tsp).
const UNIT_RANK = ['cup', 'quart', 'pint', 'L', 'fl oz', 'cubic inch', 'tbsp', 'tsp', 'mL'];

async function ensureSource(dir, root, url, zipName) {
  if (existsSync(`${dir}food_portion.csv`)) return;
  mkdirSync(root, { recursive: true });
  const zipPath = `${root}${zipName}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));
  execFileSync('unzip', ['-o', '-q', zipPath, '-d', root]);
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

const readCsv = (dir, name) => parseCsv(readFileSync(`${dir}${name}`, 'utf8'));
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

await ensureSource(SRC, SRC_ROOT, ZIP_URL, 'sr_legacy.zip');
await ensureSource(FNDDS, FNDDS_ROOT, FNDDS_URL, 'survey.zip');

// food_nutrient.csv holds grams per 100 g of food. SR Legacy refers to nutrients by
// FDC nutrient id (1051 = water); the FNDDS file uses the older nutrient number
// (255 = water). nutrient.csv lists both for every nutrient.
const NUTRIENT_IDS = {
  id: { '1051': 'water', '1003': 'protein', '1004': 'fat', '1005': 'carbohydrateByDifference', '1079': 'fiber', '1007': 'ash' },
  number: { '255': 'water', '203': 'protein', '204': 'fat', '205': 'carbohydrateByDifference', '291': 'fiber', '207': 'ash' },
};

function loadNutrients(dir, keyBy) {
  const nutrients = new Map();
  for (const n of readCsv(dir, 'food_nutrient.csv')) {
    const key = NUTRIENT_IDS[keyBy][n.nutrient_id];
    if (!key || n.amount === '') continue;
    if (!nutrients.has(n.fdc_id)) nutrients.set(n.fdc_id, {});
    nutrients.get(n.fdc_id)[key] = Number(n.amount);
  }
  return nutrients;
}

/**
 * Mass fractions (g per g) for the Choi-Okos model. USDA "carbohydrate, by difference"
 * includes dietary fibre, so the carbohydrate fraction here is that value minus fibre
 * and the fibre fraction is kept separate: nothing is counted twice. Returns null
 * when water, protein, fat or carbohydrate-by-difference is missing; a missing
 * fibre or ash value is left out and listed in `missing`.
 */
function compositionOf(nutrients, fdcId) {
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

// FNDDS writes the amount inside portion_description ("1 cup", "1/2 cup", "1 large").
function fnddsPortion(p) {
  const m = /^(\d+(?:\.\d+)?(?: \d+\/\d+)?|\d+\/\d+)\s+(.+)$/.exec(p.portion_description);
  if (!m) return null;
  const parts = m[1].split(' ');
  let amount = 0;
  for (const part of parts) {
    const frac = /^(\d+)\/(\d+)$/.exec(part);
    amount += frac ? Number(frac[1]) / Number(frac[2]) : Number(part);
  }
  return { amount, modifier: m[2] };
}
const srPortion = (p) => ({ amount: Number(p.amount), modifier: p.modifier });

/**
 * Turn one source's CSV tables into records. `portionOf(row)` returns
 * {amount, modifier} or null (a row with no readable amount is skipped).
 */
function buildRecords({ source, foods, portions, portionOf, nutrients, categoryOf, skipFood = () => false, stats }) {
  const portionsByFood = new Map();
  for (const p of portions) {
    if (!portionsByFood.has(p.fdc_id)) portionsByFood.set(p.fdc_id, []);
    portionsByFood.get(p.fdc_id).push(p);
  }
  const records = [];
  for (const food of foods) {
    if (skipFood(food)) { stats.foodsSkippedOverlap++; continue; }
    const byForm = new Map();
    const counts = [];
    for (const p of portionsByFood.get(food.fdc_id) ?? []) {
      stats.portionsInSource++;
      const read = portionOf(p);
      const grams = Number(p.gram_weight);
      if (!read) { bump(stats.skippedReasons, 'no-readable-amount'); bump(stats.skippedNonVolume, p.portion_description || p.modifier); continue; }
      const { amount, modifier } = read;
      const parsed = parseModifier(modifier);
      if (!parsed.ok) {
        const count = parseCount(modifier);
        if (count.ok && amount > 0 && grams > 0) {
          stats.countPortions++;
          counts.push({
            label: count.label,
            sizeNote: modifier,
            amount,
            gramWeight: grams,
            gramsPerUnit: round(grams / amount, 4),
            usdaPortionId: Number(p.id),
          });
          continue;
        }
        bump(stats.skippedReasons, parsed.reason);
        bump(mentionsVolume(modifier) ? stats.skippedUnparsed : stats.skippedNonVolume, modifier);
        continue;
      }
      if (!(amount > 0) || !(grams > 0)) {
        stats.portionsBadNumbers++;
        bump(stats.skippedReasons, 'non-positive-amount-or-grams');
        bump(stats.skippedUnparsed, modifier);
        continue;
      }
      // mL and L are defined only under "metric"; NLEA rows use the FDA labelling units.
      const resolved = parsed.unit === 'mL' || parsed.unit === 'L'
        ? getUnit('metric', parsed.unit)
        : getUnit(parsed.nlea ? 'us-legal' : 'us-customary', parsed.unit);
      const volumeMl = toMl(amount, resolved);
      stats.portionsConverted++;
      if (!byForm.has(parsed.form)) byForm.set(parsed.form, []);
      byForm.get(parsed.form).push({
        usdaPortionId: Number(p.id),
        amount,
        modifier,
        gramWeight: grams,
        unit: resolved.id,
        volumeMl: round(volumeMl, 6),
        densityGPerMl: round(grams / volumeMl, 6),
      });
    }
    if (byForm.size === 0 && counts.length === 0) continue;

    const forms = [...byForm.entries()]
      .map(([form, list]) => {
        list.sort((a, b) => a.usdaPortionId - b.usdaPortionId);
        // Densest evidence = largest total volume (rounding in gram_weight matters least there).
        const basis = list.reduce((best, p) => {
          if (p.volumeMl !== best.volumeMl) return p.volumeMl > best.volumeMl ? p : best;
          const rank = (x) => UNIT_RANK.indexOf(x.unit.split(':')[1]);
          return rank(p) < rank(best) ? p : best;
        });
        const ds = list.map((x) => x.densityGPerMl);
        const spreadPct = (Math.max(...ds) / Math.min(...ds) - 1) * 100;
        return {
          form,
          densityGPerMl: basis.densityGPerMl,
          ...(spreadPct > 5 ? { portionSpreadPct: round(spreadPct, 1) } : {}),
          basisPortionId: basis.usdaPortionId,
          ...(isWaterEquivalent(list) ? { waterEquivalent: true } : {}),
          portions: list,
        };
      })
      .sort((a, b) => cmp(a.form, b.form));
    counts.sort((a, b) => a.usdaPortionId - b.usdaPortionId);

    const composition = compositionOf(nutrients, food.fdc_id);
    records.push({
      fdcId: Number(food.fdc_id),
      description: food.description,
      category: categoryOf(food),
      source,
      ...(composition ? { composition } : {}),
      forms,
      ...(counts.length ? { counts } : {}),
    });
  }
  return records;
}

const newStats = () => ({
  portionsInSource: 0,
  portionsConverted: 0,
  countPortions: 0,
  portionsBadNumbers: 0,
  foodsSkippedOverlap: 0,
  skippedNonVolume: new Map(),
  skippedUnparsed: new Map(),
  skippedReasons: new Map(),
});

// ---- SR Legacy ------------------------------------------------------------
const srFoods = readCsv(SRC, 'food.csv');
const srCategories = new Map(readCsv(SRC, 'food_category.csv').map((c) => [c.id, c.description]));
const srStats = newStats();
const srRecords = buildRecords({
  source: 'usda-sr-legacy',
  foods: srFoods,
  portions: readCsv(SRC, 'food_portion.csv'),
  portionOf: srPortion,
  nutrients: loadNutrients(SRC, 'id'),
  categoryOf: (f) => srCategories.get(f.food_category_id) ?? '',
  stats: srStats,
});

// ---- FNDDS (survey foods), only for foods SR does not have ----------------
// SR "has" a food when the FNDDS description is the same as, or the leading comma
// segments of, an SR description ("Milk, whole" is covered by "Milk, whole, 3.25% ...").
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const srPrefixes = new Set();
for (const f of srFoods) {
  const segments = f.description.split(',').map(norm);
  for (let k = 1; k <= segments.length; k++) srPrefixes.add(segments.slice(0, k).join(' | '));
}
const fnddsFoods = readCsv(FNDDS, 'food.csv');
const fnddsWweia = new Map(readCsv(FNDDS, 'survey_fndds_food.csv').map((r) => [r.fdc_id, r.wweia_category_number]));
const wweiaNames = new Map(readCsv(FNDDS, 'wweia_food_category.csv').map((r) => [r.wweia_food_category, r.wweia_food_category_description]));
const fnddsStats = newStats();
const fnddsRecords = buildRecords({
  source: 'usda-fndds',
  foods: fnddsFoods,
  portions: readCsv(FNDDS, 'food_portion.csv'),
  portionOf: fnddsPortion,
  nutrients: loadNutrients(FNDDS, 'number'),
  categoryOf: (f) => wweiaNames.get(fnddsWweia.get(f.fdc_id)) ?? '',
  skipFood: (f) => srPrefixes.has(f.description.split(',').map(norm).join(' | ')),
  stats: fnddsStats,
});

// Ids: slug of the description. Among SR records, every food sharing a slug gets its
// fdcId appended. FNDDS records get a plain slug unless it collides with any SR id or
// another FNDDS slug, in which case they get the fdcId suffix too. SR ids never
// change because FNDDS exists.
const slugCount = new Map();
for (const r of srRecords) bump(slugCount, slug(r.description));
for (const r of srRecords) {
  const s = slug(r.description);
  r.id = slugCount.get(s) > 1 ? `${s}-${r.fdcId}` : s;
}
const taken = new Set(srRecords.map((r) => r.id));
const fnddsSlugCount = new Map();
for (const r of fnddsRecords) bump(fnddsSlugCount, slug(r.description));
for (const r of fnddsRecords) {
  const s = slug(r.description);
  r.id = taken.has(s) || fnddsSlugCount.get(s) > 1 ? `${s}-${r.fdcId}` : s;
}
const records = [...srRecords, ...fnddsRecords];
records.sort((a, b) => cmp(a.id, b.id));
const ordered = records.map(({ id, fdcId, description, category, source, composition, forms, counts }) => ({
  id, fdcId, description, category, source, ...(composition ? { composition } : {}), forms, ...(counts ? { counts } : {}),
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
    sources: [
      { id: 'usda-sr-legacy', name: 'USDA FoodData Central, SR Legacy', release: '2018-04', url: ZIP_URL, license: 'Public domain (CC0 1.0)' },
      { id: 'usda-fndds', name: 'USDA FoodData Central, Survey (FNDDS 2021-2023)', release: '2024-10-31', url: FNDDS_URL, license: 'Public domain (CC0 1.0)' },
    ],
    densityUnit: 'g/mL',
    compositionUnit: 'g per g of food (USDA per-100-g values divided by 100); carbohydrate excludes fiber',
    ingredients: ordered,
  },
  null,
  2,
)}\n`);

writeFileSync(`${DATA}egg-sizes.json`, `${JSON.stringify(buildEggSizes(), null, 2)}\n`);

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

const csvLines = ['id,fdc_id,description,category,form,density_g_per_ml,basis_modifier,basis_amount,basis_grams,portions,source'];
for (const r of ordered) {
  for (const f of r.forms) {
    const b = f.portions.find((p) => p.usdaPortionId === f.basisPortionId);
    csvLines.push([r.id, r.fdcId, r.description, r.category, f.form, f.densityGPerMl, b.modifier, b.amount, b.gramWeight, f.portions.length, r.source].map(csvField).join(','));
  }
}
writeFileSync(`${DATA}ingredients.csv`, `${csvLines.join('\n')}\n`);

const total = (map) => [...map.values()].reduce((a, b) => a + b, 0);
const sourceReport = (stats, foodsInSource, recs) => ({
  foodsInSource,
  foodsSkippedOverlap: stats.foodsSkippedOverlap,
  foodsKept: recs.length,
  foodsWithDensity: recs.filter((r) => r.forms.length).length,
  foodsCountOnly: recs.filter((r) => !r.forms.length).length,
  forms: recs.reduce((n, r) => n + r.forms.length, 0),
  portionsInSource: stats.portionsInSource,
  portionsConverted: stats.portionsConverted,
  countPortions: stats.countPortions,
  portionsSkipped: total(stats.skippedNonVolume) + total(stats.skippedUnparsed),
  skippedNonVolume: total(stats.skippedNonVolume),
  skippedVolumeUnparsed: total(stats.skippedUnparsed),
  skippedBadNumbers: stats.portionsBadNumbers,
  skipReasons: Object.fromEntries([...stats.skippedReasons.entries()].sort((a, b) => cmp(a[0], b[0]))),
});
const combined = new Map(srStats.skippedNonVolume);
for (const [k, v] of srStats.skippedUnparsed) combined.set(k, (combined.get(k) ?? 0) + v);
const fnddsCombined = new Map(fnddsStats.skippedNonVolume);
for (const [k, v] of fnddsStats.skippedUnparsed) fnddsCombined.set(k, (fnddsCombined.get(k) ?? 0) + v);
writeFileSync(`${DATA}build-report.json`, `${JSON.stringify(
  {
    totals: {
      foods: ordered.length,
      forms: ordered.reduce((n, r) => n + r.forms.length, 0),
      countPortions: ordered.reduce((n, r) => n + (r.counts?.length ?? 0), 0),
    },
    sources: {
      'usda-sr-legacy': {
        ...sourceReport(srStats, srFoods.length, srRecords),
        topSkippedModifiers: top(combined, 15),
        topSkippedVolumeModifiers: top(srStats.skippedUnparsed, 25),
      },
      'usda-fndds': {
        ...sourceReport(fnddsStats, fnddsFoods.length, fnddsRecords),
        topSkippedModifiers: top(fnddsCombined, 15),
        topSkippedVolumeModifiers: top(fnddsStats.skippedUnparsed, 25),
      },
    },
  },
  null,
  2,
)}\n`);
console.log(`Wrote ${ordered.length} foods (${srRecords.length} SR, ${fnddsRecords.length} FNDDS), ${ordered.reduce((n, r) => n + r.forms.length, 0)} forms.`);
