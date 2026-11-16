// Build data/branded-gaps.json from the FDC Branded Foods CSV (about 450 MB zipped,
// 3 GB unpacked). The zip is streamed, never unpacked. For each gap in
// branded-gaps.mjs, collect every brand row whose household serving is a volume
// and whose serving weight is given in grams, compute a density per row, and
// store the median plus every row.
//
// Run: npm run build:branded   (downloads the zip into vendor-src/branded/ if absent)
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { streamZipCsv } from './lib/csv-stream.mjs';
import { GAPS, CONTROLS } from './branded-gaps.mjs';
import { getUnit, toMl } from '../src/units.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const RELEASE = '2026-10-29';
const URL_ZIP = `https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_branded_food_csv_${RELEASE}.zip`;
const ZIP = `${ROOT}vendor-src/branded/branded.zip`;
const PREFIX = `FoodData_Central_branded_food_csv_${RELEASE}/`;
const OUT = `${ROOT}data/branded-gaps.json`;

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const round = (x, p) => Number(x.toFixed(p));

if (!existsSync(ZIP)) {
  mkdirSync(`${ROOT}vendor-src/branded/`, { recursive: true });
  console.log(`Downloading ${URL_ZIP} ...`);
  execFileSync('curl', ['-sL', '--fail', '-o', ZIP, URL_ZIP], { stdio: 'inherit' });
}

// ---- pass 1: descriptions -------------------------------------------------
const ALL = [...GAPS, ...CONTROLS];
const candidates = new Map(); // fdc_id -> {description, gaps:[gap]}
let header = null;
await streamZipCsv(ZIP, `${PREFIX}food.csv`, (row) => {
  if (!header) { header = Object.fromEntries(row.map((h, i) => [h, i])); return; }
  const description = row[header.description];
  for (const gap of ALL) {
    if (!gap.description.test(description.toLowerCase())) continue;
    if (gap.excludeDescription && gap.excludeDescription.test(description.toLowerCase())) continue;
    const id = row[header.fdc_id];
    if (!candidates.has(id)) candidates.set(id, { description, gaps: [] });
    candidates.get(id).gaps.push(gap);
  }
});

// ---- household serving text -----------------------------------------------
const HOUSEHOLD = /^\s*(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?|\.\d+)\s*(-\s*\d+(?:\/\d+)?\s*)?(tsp|teaspoons?|tbsp|tbs|tablespoons?|cups?|fl\.? ?oz|ml|milliliters?)\b\.?/i;
const UNIT_OF = (word) => {
  const w = word.toLowerCase().replace(/[. ]/g, '');
  if (w.startsWith('tsp') || w.startsWith('teaspoon')) return getUnit('us-legal', 'tsp');
  if (w.startsWith('tbs') || w.startsWith('tablespoon')) return getUnit('us-legal', 'tbsp');
  if (w.startsWith('cup')) return getUnit('us-legal', 'cup');
  if (w === 'floz') return getUnit('us-legal', 'fl oz');
  return getUnit('metric', 'mL');
};

function parseAmount(text) {
  let total = 0;
  for (const part of text.trim().split(/\s+/)) {
    const frac = /^(\d+)\/(\d+)$/.exec(part);
    total += frac ? Number(frac[1]) / Number(frac[2]) : Number(part);
  }
  return total;
}

/** Weights stored as 32-bit floats print as "1.2000000476837158"; keep 7 significant digits. */
const cleanNumber = (text) => String(Number(Number(text).toPrecision(7)));

/** Decimal places in the printed number, ignoring trailing zeros ("15.0" has 0, "1.25" has 2). */
function decimalsOf(text) {
  const m = /\.(\d+)/.exec(text);
  return m ? m[1].replace(/0+$/, '').length : 0;
}

// ---- pass 2: branded rows --------------------------------------------------
const rowsByGap = new Map(ALL.map((g) => [g.id, []]));
const stats = new Map(ALL.map((g) => [g.id, { candidates: 0, brand: 0, ingredients: 0, volumeServing: 0, withGrams: 0, plausible: 0, duplicatesDropped: 0 }]));
for (const { gaps } of candidates.values()) for (const g of gaps) stats.get(g.id).candidates++;

header = null;
await streamZipCsv(ZIP, `${PREFIX}branded_food.csv`, (row) => {
  if (!header) { header = Object.fromEntries(row.map((h, i) => [h, i])); return; }
  const cand = candidates.get(row[header.fdc_id]);
  if (!cand) return;
  const owner = row[header.brand_owner];
  const brandName = row[header.brand_name];
  const ingredients = row[header.ingredients].replace(/^ingredients:\s*/i, '').trim();
  const household = row[header.household_serving_fulltext];
  for (const gap of cand.gaps) {
    const st = stats.get(gap.id);
    if (gap.brand && !gap.brand.test(`${owner} ${brandName}`.toLowerCase())) continue;
    st.brand++;
    if (gap.ingredients && !gap.ingredients.test(ingredients.toLowerCase())) continue;
    if (gap.excludeIngredients && gap.excludeIngredients.test(ingredients.toLowerCase())) continue;
    st.ingredients++;
    const m = HOUSEHOLD.exec(household);
    if (!m || m[2]) continue;
    const amount = parseAmount(m[1]);
    if (!(amount > 0)) continue;
    const unit = UNIT_OF(m[3]);
    st.volumeServing++;
    // Grams: the serving size when it is in grams, else a "(NNg)" in the household text.
    let gramsText = null;
    let gramsFrom = null;
    const sizeUnit = row[header.serving_size_unit].toLowerCase();
    if (['g', 'grm', 'gram', 'grams'].includes(sizeUnit) && row[header.serving_size] !== '') {
      gramsText = cleanNumber(row[header.serving_size]);
      gramsFrom = 'serving_size';
    } else {
      const g = /\(\s*(?:about |approx\.? )?(\d+(?:\.\d+)?)\s?g\b/i.exec(household);
      if (g) { gramsText = cleanNumber(g[1]); gramsFrom = 'household text'; }
    }
    if (gramsText === null) continue;
    const grams = Number(gramsText);
    if (!(grams > 0)) continue;
    st.withGrams++;
    const volumeMl = toMl(amount, unit);
    const density = grams / volumeMl;
    if (!(density > 0.05 && density < 3)) continue;
    st.plausible++;
    // Half a unit of the last printed digit, as a share of the weight.
    const uncertaintyPct = (0.5 * 10 ** -decimalsOf(gramsText)) / grams * 100;
    rowsByGap.get(gap.id).push({
      fdcId: Number(row[header.fdc_id]),
      brandOwner: owner,
      brandName,
      description: cand.description,
      household,
      servingGrams: grams,
      gramsFrom,
      volumeMl: round(volumeMl, 6),
      densityGPerMl: round(density, 6),
      uncertaintyPct: round(uncertaintyPct, 2),
    });
  }
});

function quantile(sorted, q) {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

const summarise = (gap) => {
  // The same product listed more than once (same brand, text and weight) counts once.
  const seen = new Set();
  const rows = [];
  for (const r of rowsByGap.get(gap.id).sort((a, b) => a.fdcId - b.fdcId)) {
    const key = [r.brandOwner, r.brandName, r.description, r.household, r.servingGrams].join('|');
    if (seen.has(key)) { stats.get(gap.id).duplicatesDropped++; continue; }
    seen.add(key);
    rows.push(r);
  }
  const base = { id: gap.id, label: gap.label, names: gap.names, n: rows.length, funnel: stats.get(gap.id) };
  if (!rows.length) return { ...base, rows };
  const densities = rows.map((r) => r.densityGPerMl).sort((a, b) => a - b);
  const uncert = rows.map((r) => r.uncertaintyPct).sort((a, b) => a - b);
  const medianDensity = quantile(densities, 0.5);
  const medianUncertainty = quantile(uncert, 0.5);
  const over5 = rows.filter((r) => r.uncertaintyPct > 5).length;
  const warnings = [];
  if (medianUncertainty > 5) warnings.push(`Median label rounding uncertainty is ${round(medianUncertainty, 1)}%, above 5%.`);
  if (over5 / rows.length > 0.5 && medianUncertainty <= 5) warnings.push(`${over5} of ${rows.length} rows have rounding uncertainty above 5%.`);
  if (rows.length < 3) warnings.push(`Only ${rows.length} brand row${rows.length === 1 ? '' : 's'}; the median is not a reliable summary.`);
  const spread = (quantile(densities, 0.75) - quantile(densities, 0.25)) / medianDensity;
  if (spread > 0.15) warnings.push(`Brands disagree: the middle half of rows spans ${round(spread * 100, 0)}% of the median.`);
  return {
    ...base,
    medianDensityGPerMl: round(medianDensity, 6),
    q1DensityGPerMl: round(quantile(densities, 0.25), 6),
    q3DensityGPerMl: round(quantile(densities, 0.75), 6),
    minDensityGPerMl: densities[0],
    maxDensityGPerMl: densities[densities.length - 1],
    medianUncertaintyPct: round(medianUncertainty, 2),
    rowsAbove5PctUncertainty: over5,
    warnings,
    rows,
  };
};
const gaps = GAPS.map(summarise);
// Controls: the same method on foods SR Legacy already measures, to show how label
// densities compare with USDA household weights.
const controls = CONTROLS.map((c) => {
  const out = summarise(c);
  return { ...out, compareTo: c.compareTo, differencePct: out.medianDensityGPerMl === undefined ? null : round((out.medianDensityGPerMl / c.compareTo.densityGPerMl - 1) * 100, 1), rows: undefined, rowsOmitted: out.rows.length };
});

mkdirSync(`${ROOT}data/`, { recursive: true });
writeFileSync(OUT, `${JSON.stringify(
  {
    schemaVersion: 1,
    source: {
      name: 'USDA FoodData Central, Branded Foods',
      release: RELEASE,
      url: URL_ZIP,
      license: 'Public domain (CC0 1.0)',
    },
    method: {
      volumeUnits: 'Household serving text read with the FDA labelling units (us-legal: tsp 5 mL, tbsp 15 mL, cup 240 mL, fl oz 30 mL); mL as written.',
      grams: 'serving_size when serving_size_unit is grams; otherwise a "(NNg)" in the household text. Rows with neither are dropped.',
      uncertaintyPct: 'Half a unit of the last printed digit of the gram weight, as a percent of the weight ("15.0" is read as a whole gram: 0.5/15; "1.2" as 0.05/1.2). Label grams are rounded by the manufacturer; this estimates only how coarse the printed number is.',
      median: 'Median of the per-row densities after dropping rows that repeat the same brand, description, household text and weight. All rows are kept in `rows`.',
      labelVolumes: 'Household measures on labels are rounded (to 1/4 or 1/3 cup, to a container size) and are nominal; rows for foods sold by container weight can be several percent low. `controls` runs the same method on foods SR Legacy already measures.',
      plausibleRange: 'Rows outside 0.05 to 3 g/mL are dropped as data errors.',
    },
    gaps,
    controls,
  },
  null,
  2,
)}\n`);
for (const g of [...gaps, ...controls]) console.log(g.id.padEnd(30), String(g.n).padStart(4), g.medianDensityGPerMl ?? '-', g.warnings?.length ? `(${g.warnings.length} warning)` : '', JSON.stringify(g.funnel));
