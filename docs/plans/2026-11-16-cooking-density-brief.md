# cooking-density: build brief

Read this whole file before touching code. It is the ground truth for every batch.

## Goal

An open-source **data library** that converts cooking volumes to grams and back
(US cups/spoons <-> metric). Primary product: versioned JSON data that any website or
app can consume. Secondary: a tiny zero-dependency ESM helper that applies the data.

Physics: mass = density x volume. Gravity plays no part (grams are mass). Every
density must come from a cited source or a cited model. **Never invent a number.**
If you cannot source a value, leave it out and note it.

Target use cases (must work end to end by the last batch):
- 1 US cup all-purpose flour -> g
- 1 US tbsp baking soda -> g
- 1 US cup water -> g
- 3 US cups 30% MF (milk fat) cream -> g
- 250 g granulated sugar -> US cups
- 1 cup brown sugar packed vs unpacked

## Verified ground truth (checked by the parent on 2026-11-16)

Source dataset: USDA FoodData Central **SR Legacy** CSV (April 2018 release), public
domain (CC0). Download URL:
`https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip`
Already extracted at `vendor-src/sr/FoodData_Central_sr_legacy_food_csv_2018-04/`
(gitignored; the generator must download it itself if absent).

- `food.csv`: fdc_id, description, food_category_id. 7,793 foods.
- `food_portion.csv`: fdc_id, amount, measure_unit_id, portion_description, modifier,
  gram_weight. ~14,450 rows. **measure_unit_id is almost always 9999 "undetermined";
  the real unit is in the free-text `modifier`**, e.g. `cup`, `tbsp`, `tsp`, `fl oz`,
  `cup packed`, `tsp unpacked`, `cup, whipped`, `cup, fluid (yields 2 cups whipped)`,
  `cup (1 NLEA serving)`, `cup (8 fl oz)`, `tablespoon`, `cubic inch`.
  `amount` may be fractional (0.5 tsp, 1.33 cup).
- ~3,230 foods have at least one volume portion.
- Sample rows (gram_weight per 1 unit): AP flour bleached (168894) cup 125;
  heavy whipping cream (170859) cup fluid 238, tbsp 15, fl oz 29.8; half and half cup 242;
  olive oil cup 216; honey cup 339; butter salted cup 227, tbsp 14.2, stick 113;
  table salt cup 292, tsp 6; baking soda tsp 4.6; granulated sugar cup 200;
  brown sugar cup packed 220, cup unpacked 145.
- Gram weights are rounded. Derive density from the **largest volume** portion available
  (cup > fl oz > tbsp > tsp); keep all portions as evidence.
- NLEA-labelled portions use FDA labelling units (21 CFR 101.9(b)(5)(viii)):
  cup = 240 mL, tbsp = 15 mL, tsp = 5 mL, fl oz = 30 mL. Plain household
  portions use US customary units (below). Verify the CFR values by web search before relying on them.
- `food_nutrient.csv` + `nutrient.csv` hold composition per 100 g (water, protein,
  total lipid, carbohydrate by difference, fiber, ash) for the Choi-Okos model.

## Exact unit definitions (mL)

US customary: tsp 4.92892159375, tbsp 14.78676478125, fl oz 29.5735295625,
cup 236.5882365, pint 473.176473, quart 946.352946, gallon 3785.411784.
US legal/nutrition (NLEA): cup 240, tbsp 15, tsp 5, fl oz 30.
Metric: tsp 5, tbsp 15, cup 250, mL 1, L 1000, dL 100.
Australian: tbsp 20 (tsp 5, cup 250).
Imperial (UK): fl oz 28.4130625, cup 284.130625 (= 10 imp fl oz), pint 568.26125,
quart 1136.5225, gallon 4546.09.
Mass: g 1, kg 1000, oz 28.349523125, lb 453.59237.
Butter stick (US) = 1/4 lb = 113.3980925 g = 8 US tbsp.

## Physics models

1. **Measured density** (default): g per mL from USDA portions at kitchen conditions.
   Powders and solids (flour, sugar, chopped vegetables) are bulk densities and depend
   on packing state; keep each state as a separate `form` (packed, unpacked, sifted,
   whipped, chopped, melted...).
2. **Choi-Okos composition model** (Choi & Okos 1986, "Effects of temperature and
   composition on the thermal properties of foods"): 1/rho = sum(x_i / rho_i(T)),
   x_i = mass fraction. Coefficients (kg/m^3, T in deg C), *recalled from memory, must be
   verified against a citable source before use*:
   water 997.18 + 3.1439e-3 T - 3.7574e-3 T^2; protein 1329.9 - 0.5184 T;
   fat 925.59 - 0.41757 T; carbohydrate 1599.1 - 0.31046 T; fiber 1311.5 - 0.36589 T;
   ash 2423.8 - 0.28063 T.
   Valid for **liquids and pastes with no entrained air**. Not for powders or whipped foods.
   Uses: (a) temperature correction for liquids/fats (default 20 deg C), (b) parametric
   dairy: cream/milk at an arbitrary fat % (e.g. 30% MF), (c) sanity cross-check of
   USDA liquid densities.
3. **Sugar solutions** (syrups, Brix): only if a citable formula or table is found
   (e.g. ICUMSA). Otherwise use Choi-Okos with water + carbohydrate.

## Constraints

- Node 22, ESM, **zero runtime dependencies**, zero dev dependencies if possible
  (use `node:test`, `node --test`). Hand-written `index.d.ts` for types.
- Code license MIT (holder: "KieranVR"). Data: USDA public domain, cite it.
- Every ingredient record carries provenance: `source` ("usda-sr-legacy" with fdc_id
  and the raw portion rows, or "model:choi-okos" with inputs, or a cited reference).
- Stable, kebab-case ids (`wheat-flour-all-purpose`), plus human aliases
  ("all-purpose flour", "AP flour", "plain flour").
- Quoted strings from USDA (descriptions, modifiers) are reproduced byte-for-byte.
- Prose (README, comments): plain, concrete, no hype words, no em-dash padding.
- Do NOT git commit. Do NOT push. Do not touch files outside this repo.
- If a tool or permission blocks you, STOP and report; do not work around it.

## Gate commands

`npm test` (node --test) and `npm run build:data` must both pass and the build must be
deterministic (running it twice yields byte-identical output).

## Batches

1. **Units + USDA generator.** `package.json`, `data/units.json` (all units above, with
   system + kind), `scripts/build-data.mjs` that downloads/reads SR Legacy, parses the
   modifier text into (unit, form), converts to density g/mL per form, and writes
   `data/ingredients.json` (sorted, stable) + `data/ingredients.csv`. Unparseable portions
   are skipped and counted in a report `data/build-report.json`. Tests: unit math,
   modifier parser on the sample strings above, densities for the sample foods
   (e.g. AP flour ~0.528 g/mL, olive oil ~0.913, brown sugar packed ~0.93).
2. **Physics.** `src/physics/choi-okos.mjs` (verify coefficients first, cite them in a
   comment), composition pulled into ingredient records for liquids, temperature
   correction, parametric dairy by fat %. Test: model vs USDA for water, milk, half and
   half, heavy cream, olive oil within 3%; 30% MF cream at 20 deg C.
3. **Helper API + curation + docs.** `src/index.mjs`: `findIngredient(query)`,
   `toGrams({ingredient, amount, unit, form?, temperatureC?, fatPercent?})`,
   `toVolume(...)`, `convert(...)`. Curated alias file `data/aliases.json` for the ~150
   most common baking/cooking ingredients pointing at the best USDA record. README with
   the six target use cases as runnable examples, data schema, sources, accuracy notes
   (packing matters ~20%, temperature ~1%), license. JSON Schema in `schema/`.
