# cooking-density

Convert cooking volumes to grams, and grams back to volumes, using measured ingredient densities.

The main product is data: JSON files that any website or app can load. A small helper with no dependencies applies the data for you, in Node and in the browser.

It converts volumes (cups, tablespoons), masses (grams, ounces) and counts (2 large eggs, 3 garlic cloves, 1 medium banana) in any direction. It also holds egg size standards for the US, Canada and the EU.

Mass is density times volume. A cup of flour and a cup of honey are the same volume and very different masses, so a volume alone never gives a weight. Every number here comes from a cited source or a cited model. Where no source exists, the ingredient is left out.

## The six examples

Run `node examples/basic.mjs`. This is its output as of version 0.3.0:

```
1 US cup all-purpose flour    -> 125.0 g
1 US tbsp baking soda         -> 13.8 g
1 US cup water                -> 236.2 g
3 US cups 30% MF cream        -> 717.2 g
250 g granulated sugar        -> 1.25 US cups
1 cup brown sugar, packed     -> 220.0 g
1 cup brown sugar, unpacked   -> 145.0 g

2 large eggs                  -> 100.0 g
3 garlic cloves               -> 9.0 g
150 g egg                     -> 3 large eggs
60.5 g egg in the shell       -> 53.24 g edible

2 metric cups plain flour: 264.2 g
  density 0.528344 g/mL from {
  kind: 'usda-sr-legacy',
  fdcId: 168894,
  description: 'Wheat flour, white, all-purpose, enriched, bleached'
}
  warnings [
  'Plain flour (UK, AU) is close to US all-purpose flour; no separate USDA record exists.'
]
```

The code behind them:

```js
import { toGrams, toVolume } from 'cooking-density';

toGrams({ ingredient: 'all-purpose flour', amount: 1, unit: 'cup' }).value;   // 125.0
toGrams({ ingredient: 'baking soda', amount: 1, unit: 'tbsp' }).value;        // 13.8
toGrams({ ingredient: 'water', amount: 1, unit: 'cup' }).value;               // 236.2
toGrams({ ingredient: '30% cream', amount: 3, unit: 'cups' }).value;          // 717.2
toVolume({ ingredient: 'granulated sugar', amount: 250, unit: 'g', to: 'cup' }).value; // 1.25
toGrams({ ingredient: 'brown sugar', amount: 1, unit: 'cup', form: 'packed' }).value;   // 220.0
toGrams({ ingredient: 'brown sugar', amount: 1, unit: 'cup', form: 'unpacked' }).value; // 145.0
```

A result carries more than the number:

```json
{
  "value": 717.2276109062046,
  "unit": "mass:g",
  "amount": 3,
  "from": "us-customary:cup",
  "volumeMl": 709.7647095,
  "densityGPerMl": 1.0105146132321259,
  "form": "default",
  "temperatureC": 20,
  "fatPercent": 30,
  "source": {
    "kind": "model",
    "name": "dairy model (Choi-Okos), calibrated to USDA",
    "model": "dairy"
  },
  "warnings": []
}
```

`source` names the USDA record (`kind: "usda-sr-legacy"`, with `fdcId` and `description`), the water reference, or the dairy model. `warnings` lists anything you should know: a form was chosen for you, a temperature was ignored because the ingredient is a powder, a fat percentage was extrapolated, or the alias is an approximation.

## Use it as data

Everything is in `data/`. Load the JSON in any language, or serve it from a static host.

```js
import ingredients from 'cooking-density/data/ingredients.json' with { type: 'json' };
```

| File | Contents |
|---|---|
| `data/ingredients.json` | 8,617 USDA foods (4,166 from SR Legacy, 4,451 from FNDDS): 7,038 have a volume density in 7,516 forms, and 5,990 count portions ("large", "clove", "slice") sit in a separate `counts` array. Raw portion rows and composition are kept. |
| `data/ingredients.csv` | One row per food and form: id, fdc_id, description, category, form, density, basis portion, source |
| `data/aliases.json` | 281 curated common ingredients under 886 US, UK, AU and CA names, mapped to a USDA record and form, a branded-label median, or a model |
| `data/lite.json` | Everything the helper needs for those 281 ingredients in one 165 KB file (32 KB gzipped): the aliases, the 237 USDA records behind them, units, the dairy model, label medians and egg sizes. `data/lite.mjs` is the same object as an ES module |
| `data/branded-gaps.json` | Densities for 24 ingredients USDA's reference tables lack (ghee, kosher salt by brand, chia, spices), as the median of brand labels with every row kept |
| `data/egg-sizes.json` | US, Canadian and EU egg size classes with citations, and the shell fraction |
| `data/measurements.json` | Community measurements, starting with one egg |
| `data/units.json` | Every unit with its size in mL or g |
| `data/dairy-model.json` | Fit and calibration anchors for `creamDensity` |
| `data/build-report.json` | What the build kept and skipped, per source |

JSON Schemas for the source data files are in `schema/`. `lite.json` is generated from them; `npm test` rebuilds it in memory and fails if the committed file differs.

### Schema in short

An ingredient in `ingredients.json`:

```json
{
  "id": "wheat-flour-white-all-purpose-enriched-bleached",
  "fdcId": 168894,
  "description": "Wheat flour, white, all-purpose, enriched, bleached",
  "category": "Cereal Grains and Pasta",
  "source": "usda-sr-legacy",
  "composition": { "water": 0.1192, "protein": 0.1033, "fat": 0.0098, "carbohydrate": 0.7361, "fiber": 0.027, "ash": 0.0047, "sum": 1.0001, "carbohydrateByDifference": 0.7631 },
  "forms": [
    {
      "form": "default",
      "densityGPerMl": 0.528344,
      "basisPortionId": 83944,
      "portions": [
        { "usdaPortionId": 83944, "amount": 1, "modifier": "cup", "gramWeight": 125, "unit": "us-customary:cup", "volumeMl": 236.588236, "densityGPerMl": 0.528344 }
      ]
    }
  ]
}
```

(Whitespace is condensed here; the file is indented.)

- **source**: `usda-sr-legacy` or `usda-fndds`. SR Legacy wins: a FNDDS food is dropped when SR has a food with the same description or the same leading comma segments ("Milk, whole" is covered by "Milk, whole, 3.25% milkfat, ..."). Near duplicates can remain.
- **id**: kebab-case slug of the USDA description. Where two SR foods share a slug, both get `-<fdcId>` appended. A FNDDS food gets the suffix when its slug clashes with any SR id or another FNDDS food.
- **forms**: one density per physical state. Powders and chopped foods depend on how they are packed or cut, so `packed`, `unpacked`, `sifted`, `chopped`, `whipped` and similar are separate forms. `default` is the plain cup, tablespoon or fluid ounce.
- **densityGPerMl**: taken from the largest-volume portion of that form, because gram weights are rounded and a big portion rounds least.
- **portions**: every USDA row behind the density, with its `modifier` text copied byte-for-byte from USDA. For FNDDS rows `modifier` is the text after the amount in `portion_description` ("1 cup, cooked" gives `cup, cooked`).
- **portionSpreadPct**: present when the portions behind one form disagree by more than 5% in density (SR catsup: 1 tbsp 17 g, 1 cup 240 g). The density comes from the largest portion, as always; the helper warns. 89 SR forms and 178 FNDDS forms carry it.
- **waterEquivalent**: set on a form whose every volume portion weighs exactly like water on the FDA measures (cup 240 g, tbsp 15 g, tsp 5 g, fl oz 30 g). True for water-like liquids; for pastes and solids it usually means USDA used a placeholder (FNDDS cream cheese and hummus). The helper warns.
- **counts**: portions that are things, not volumes: `{ label, sizeNote, amount, gramWeight, gramsPerUnit, usdaPortionId }`. `label` is a short word (`large`, `extra large`, `clove`, `slice`, `stick`, `lemon` for the juice of one lemon); `sizeNote` is the USDA modifier verbatim, such as `medium (7" to 7-7/8" long)`. Counts never enter the density maths. A food with counts and no volume portions has `forms: []`.
- **composition**: grams per gram of food for water, protein, fat, carbohydrate, fiber and ash. USDA's "carbohydrate, by difference" includes fiber, so `carbohydrate` here is that value minus fiber, and the raw figure is kept as `carbohydrateByDifference`.
- **unit** ids look like `us-customary:cup`. Systems: `us-customary`, `us-legal`, `metric`, `australian`, `imperial`, `mass`.

An alias in `aliases.json` names an `fdcId`, a `form`, and the names people use. It may carry a `defaultUnit` (egg: `large`) and a `note` that the helper returns as a warning. Aliases for model-backed things (water, creams by fat percentage) name a `model`; aliases for the branded gap fills name a `branded` gap; `kosher salt` names the two brands it is ambiguous between.

## Use it as a helper

```sh
npm install cooking-density   # once published; or copy the repository
```

```js
import { findIngredient, toGrams, toVolume, convert, getDensity } from 'cooking-density';
```

The package has three entry points. They export the same functions and differ in where the data comes from:

| Import | Runs in | Knows |
|---|---|---|
| `cooking-density` | Node 18 and later | All 8,617 USDA foods and the 281 curated ingredients. Reads `data/` from disk, each file on first use. |
| `cooking-density/lite` | Browsers, Node, and any other ES-module runtime | The 281 curated ingredients. The data is bundled: 165 KB, 32 KB gzipped. |
| `cooking-density/core` | Anywhere | Whatever you give it: `createConverter(data)` builds the helper from JSON you loaded yourself. |

The main entry imports `node:fs`, so a browser bundle must import `cooking-density/lite`. Lite answers every name in `aliases.json` with the same numbers as the full helper, and the tests compare the two alias by alias. It does not know the other 8,380 USDA foods: `findIngredient('Kale, raw')` is `null` there.

To use every food in a browser, fetch the files and build your own converter:

```js
import { createConverter } from 'cooking-density/core';

const file = (name) => fetch(`/data/${name}.json`).then((r) => r.json());
const { toGrams } = createConverter({
  units: await file('units'),
  aliases: await file('aliases'),
  ingredients: await file('ingredients'),   // 9.6 MB; 0.6 MB gzipped
  dairyModel: await file('dairy-model'),
  brandedGaps: await file('branded-gaps'),
  eggSizes: await file('egg-sizes'),
});
```

`createConverter(await file('lite'))` works too: `lite.json` is one object with those same keys. `examples/browser.html` is a working page with no build step.

Every entry point exports these functions:

- `findIngredient(query)`: look up by alias, id, USDA description or fdcId. Returns `null` if unknown. Case, accents and punctuation do not matter.
- `searchIngredients(query, { limit })`: all words must appear, in any order. Curated ingredients come first, an exact name before a partial one; USDA foods follow, raw SR Legacy foods before prepared dishes.
- `toGrams({ ingredient, amount, unit, form?, temperatureC?, fatPercent?, calibrated? })`
- `toVolume({ ingredient, amount, unit = 'g', to = 'cup', ... })`
- `convert({ ingredient?, amount, from, to, ... })`: any unit to any unit. Volume to mass uses the density; same-kind conversions need no ingredient.
- `fromGrams({ ingredient, amount, unit = 'g', to })`: a count from a weight, `fromGrams({ ingredient: 'egg', amount: 150, to: 'large' })` is 3.
- `getDensity(ingredient, options)`: the density in g/mL with its source and warnings.
- `creamDensity({ fatPercent, temperatureC = 20, calibrated = true })`: g/mL of milk or cream at a fat percentage.
- `createConverter(data)`: all of the above, bound to data you supply.

A call that cannot be answered throws an `Error` whose message says what to change: `No unit given for all-purpose-flour. Pass one, such as "cup", "tbsp" or "g".`

### Units

Units are ids (`us-legal:cup`) or plain names. A bare `cup`, `tbsp`, `tsp`, `fl oz`, `pint`, `quart` or `gallon` is **US customary**. Name the others:

| You write | You get |
|---|---|
| `cup`, `us cup`, `Tbsp`, `tablespoon`, `fl oz` | US customary (cup = 236.588 mL) |
| `T`, `t` | US tablespoon and teaspoon, as old recipes write them. These two are the only names where case matters. |
| `us-legal cup`, `legal tbsp` | FDA labelling units (cup = 240 mL, tbsp = 15 mL, tsp = 5 mL, fl oz = 30 mL) |
| `metric cup`, `metric tbsp`, `metric tsp` | 250 mL, 15 mL, 5 mL |
| `dessertspoon`, `dsp` | 10 mL (UK and Australian recipes) |
| `au tbsp` | 20 mL |
| `uk cup`, `imperial pint` | UK imperial (cup = 10 imperial fl oz = 284.131 mL) |
| `ml`, `cl`, `dl`, `l` | metric |
| `mg`, `g`, `kg`, `oz`, `lb` | mass (`oz` alone is an ounce of weight; use `fl oz` for volume) |

Legal units never apply by accident, because the difference between a 240 mL cup and a 236.6 mL cup is 1.4%.

`uk tbsp` and `uk tsp` are refused. The old imperial tablespoon was 17.8 mL, and a UK recipe written today means the 15 mL metric spoon, so the error tells you to write `metric tbsp`.

### Regional names

`plain flour`, `caster sugar`, `icing sugar`, `bicarb soda`, `cornflour`, `double cream`, `single cream`, `whipping cream`, `35% cream`, `wholemeal flour`, `courgette`, `aubergine`, `rocket`, `fresh coriander`, `spring onion`, `swede`, `beetroot`, `mangetout`, `pak choi`, `capsicum`, `linseed`, `soya milk` and many more resolve to a USDA record. Where the match is approximate (caster sugar is finer than granulated; plain flour is close to, not identical to, all-purpose), the result carries a warning saying so.

### Counts

A unit can be a count the ingredient has USDA portions for. Counts go through grams, and through density when the other side is a volume.

```js
toGrams({ ingredient: 'egg', amount: 2, unit: 'large' }).value;           // 100
toGrams({ ingredient: 'egg', amount: 2, unit: 'extra large' }).value;     // 112
toGrams({ ingredient: 'garlic', amount: 3, unit: 'cloves' }).value;       // 9
toGrams({ ingredient: 'banana', amount: 2, unit: 'medium' }).value;       // 236
toGrams({ ingredient: 'lemon juice', amount: 2, unit: 'lemon' }).value;   // 96 (juice of two lemons)
fromGrams({ ingredient: 'egg', amount: 150, to: 'large' }).value;         // 3
convert({ ingredient: 'egg', amount: 1, from: 'cup', to: 'large' }).value; // 4.86
toGrams({ ingredient: 'egg', amount: 2, unit: 'eggs' }).value;            // 100 (the default size, large)
toGrams({ ingredient: 'egg', amount: 2, unit: 'XL' }).value;              // 112
toGrams({ ingredient: 'courgette', amount: 1 }).value;                    // 196 (one medium zucchini)
```

Plurals work (`cloves`, `leaves`, `slices`), and so do `XL`, `lg`, `med` and `sm`. Naming the ingredient as its own unit (`2 eggs`, `2 bananas`) or writing `each` or `whole` takes the ingredient's default size. A USDA food with no curated default takes `medium`, or its only count, and the result carries a warning that names the size used.

The result's `count` field gives the USDA `sizeNote` and portion id that was used. When several USDA rows share a label (an onion has three kinds of slice) the first is used, the others are listed in `warnings`, and `size: 'thin'` picks one. USDA portion weights are for edible material without refuse: a "large" egg is 50 g without the shell, and a medium banana is 118 g without the peel.

### Eggs

`data/egg-sizes.json` holds the size classes of the US (USDA AMS 56, section 56.218, minimum net weight per dozen), Canada (Canada A, per egg) and the EU (Regulation 589/2008, XL/L/M/S), each with a citation URL, in-shell weights. The shell is 12% of a whole egg in USDA SR Legacy, so:

```js
import { classifyEgg, edibleGramsFromShell } from 'cooking-density';

edibleGramsFromShell(60.5);   // 53.24 g edible from a 60.5 g egg in the shell
classifyEgg(60.5, 'us').name; // 'Large'
classifyEgg(60.5, 'eu').name; // 'M'
```

A 60.5 g fridge-cold egg sold as US large (2 in tall, 1.75 in wide, weighed on a coffee scale) is the first entry in `data/measurements.json`. It is 6.5% above USDA's 50 g for a large egg. That is not a disagreement: USDA's 50 g is the class minimum (24 oz per dozen, 56.7 g in the shell, less 12%), and the class runs up to 63.8 g. Australia is not included; no Australian size standard could be found and read.

### Dairy by fat percentage

`toGrams({ ingredient: '30% cream', ... })` and `toGrams({ ingredient: 'cream', fatPercent: 30, ... })` use a dairy model. The percentage can be written the ways cartons and recipes write it: `35% M.F. cream`, `cream 18%`, `cream (40% fat)`, `2 percent milk`. It describes the non-fat part of milk and cream by a line fitted to six USDA records (skim, whole milk, half and half, light cream, light whipping, heavy whipping), then computes density from composition with the Choi-Okos equations.

The model alone sits 0.8% to 2.2% under USDA's household-measure densities, and the gap grows with fat. So `calibrated` defaults to `true`: the model result is multiplied by the USDA/model ratio, interpolated by fat percentage between the six records. Pass `calibrated: false` for the uncalibrated physical model. 30% fat cream at 20 C is 1.0105 g/mL calibrated and 0.9913 g/mL uncalibrated. `docs/plans/physics-notes.md` has the method, the anchor table and the limits.

Beyond 36.08% fat (richer than the heavy cream record) the result is an extrapolation and says so in `warnings`.

### Ingredients USDA's tables lack

SR Legacy and FNDDS have no ghee, kosher salt, chia, Greek yogurt, basmati rice or ground cumin. For 24 such ingredients (kosher salt counts as two brands), `data/branded-gaps.json` collects every brand row in the FDC Branded Foods release (2026-10-29) whose household serving is a volume and whose serving weight is in grams, computes a density per row, and stores the median and every row (fdcId, brand owner, household text verbatim, grams). The helper returns the median, with the number of rows in `source`.

| Ingredient | Rows | Median g/mL | g per US tsp | Label rounding above 5% |
|---|---|---|---|---|
| Golden syrup | 1 | 1.4 | 6.9 | no |
| Ghee | 148 | 0.933333 | 4.6 | no |
| Kosher salt, Diamond Crystal | 3 | 0.56 | 2.8 | yes (7.1%) |
| Kosher salt, Morton | 4 | 0.96 | 4.7 | no |
| Flaky sea salt | 15 | 1.2 | 5.9 | no |
| Chia seeds | 234 | 0.8 | 3.9 | no |
| Agave syrup | 171 | 1.4 | 6.9 | no |
| Plain Greek yogurt | 463 | 0.944444 | 4.7 | no |
| Creme fraiche | 7 | 0.933333 | 4.6 | no |
| Gelatin powder | 5 | 0.666667 | 3.3 | no |
| Pastry flour | 27 | 0.5 | 2.5 | no |
| Desiccated or unsweetened shredded coconut | 104 | 0.458333 | 2.3 | no |
| Basmati rice, dry | 236 | 0.75 | 3.7 | no |
| Arborio rice, dry | 120 | 0.75 | 3.7 | no |
| Smoked paprika | 6 | 0.48 | 2.4 | yes (8.3%) |
| Za'atar | 36 | 0.76 | 3.7 | yes (6.7%) |
| Garam masala | 38 | 0.56 | 2.8 | yes (7.1%) |
| Sumac | 3 | 0.4 | 2.0 | yes (10.0%) |
| Ground cumin | 15 | 0.56 | 2.8 | yes (7.1%) |
| Ground coriander | 11 | 0.48 | 2.4 | yes (8.3%) |
| Chinese five spice | 29 | 0.48 | 2.4 | yes (8.3%) |
| Italian seasoning | 31 | 0.24 | 1.2 | yes (16.7%) |
| Nutritional yeast | 24 | 0.25 | 1.2 | no |
| Chipotle powder | 3 | 0.72 | 3.5 | yes (5.6%) |

Labels round, and a few warnings follow from that:

- **Weights are coarse.** A label that says "1/4 tsp (0.6 g)" could be 0.55 to 0.65 g: 8% either way. Each row carries `uncertaintyPct`, half a unit of the last printed digit as a share of the weight, and the helper warns when the median row exceeds 5%. Spices fail most often because their servings are a fraction of a gram.
- **Household volumes are nominal.** The same method run on foods SR Legacy already measures (`controls` in the file) lands 2% to 5% low: honey 1.40 against 1.433 g/mL, table salt 1.20 against 1.234, granulated sugar 0.80 against 0.845. Greek yogurt reads 9% below USDA plain yogurt, because labels state a 170 g serving as 3/4 cup. Treat a branded median as good to a few percent at best.
- **Kosher salt depends on the brand.** Morton coarse kosher salt is 0.96 g/mL (4.7 g per US tsp), Diamond Crystal 0.56 (2.8 g): Morton is 1.7 times heavier per teaspoon. `kosher salt` alone raises an error and names both brands.
- **Few rows.** Golden syrup (1 row), sumac (3), chipotle powder (3) and Diamond Crystal (3) carry a warning. No treacle rows exist.

### Temperature

Liquids can be converted at another temperature (`temperatureC`). Water uses 0.9982 g/mL at 20 C, scaled by the Choi-Okos water curve. Other liquids scale their USDA density by the model's temperature ratio and assume the USDA figure was measured at 20 C. Powders and solids ignore `temperatureC` and say so: their bulk density depends on packing, not temperature.

## Sources

- **USDA FoodData Central, SR Legacy (April 2018)**, public domain (CC0 1.0). Download: https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip. Portions, foods and nutrient values come from this release. Descriptions and modifier strings are reproduced exactly as USDA wrote them.
- **USDA FoodData Central, Survey (FNDDS 2021-2023)**, public domain. Download: https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_survey_food_csv_2024-10-31.zip. Used for foods SR Legacy lacks.
- **USDA FoodData Central, Branded Foods (2026-10-29)**, public domain. Download: https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_branded_food_csv_2026-10-29.zip (452 MB). Brand names are kept as USDA lists them; no endorsement is implied.
- **USDA SR28 documentation and FOOD_DES.txt** (https://www.ars.usda.gov/ARSUserFiles/80400525/Data/SR/SR28/dnload/sr28asc.zip): portion weights are for edible material without refuse; NDB 01123 "Egg, whole, raw, fresh" has refuse "Shell", 12 percent.
- **Egg size standards**: USDA AMS, *United States Standards, Grades, and Weight Classes for Shell Eggs* (AMS 56, July 20, 2000), section 56.218; CFIA, Canadian Grade Compendium Volume 5, section 5; Commission Regulation (EC) No 589/2008, Article 4. URLs are in `data/egg-sizes.json`.
- **FDA labelling units**: 21 CFR 101.9(b)(5)(viii): teaspoon 5 mL, tablespoon 15 mL, cup 240 mL, fluid ounce 30 mL. USDA portions marked NLEA use these.
- **Choi, Y. and Okos, M.R. (1986)**, "Effects of temperature and composition on the thermal properties of foods", in *Food Engineering and Process Applications*, Vol. 1, Transport Phenomena, Elsevier, pp. 93-101. Component density equations and the mixing rule `1/rho = sum(x_i / rho_i)`. The chapter itself was not read: the coefficients were checked against two secondary tables that reproduce them. Details and the differences found between those tables are in `docs/plans/physics-notes.md`.
- **Water at 20 C**: 0.9982 g/mL, cross-checked in three secondary tables; see the notes.
- **UK cream fat minimums** (single 18%, whipping 35%, double 48%): University of Reading food law summary and Dairy UK compositional standards.

## Accuracy

- **Packing is the largest error you can make.** One US cup of brown sugar is 220 g packed and 145 g unpacked: 52% more. Sifted powdered sugar is 100 g per cup; unsifted is 120 g. Pick the form that matches how the recipe measures.
- **Temperature is small.** Between 4 C and 20 C the model moves liquids by under 1%: olive oil 0.7%, 30% cream 0.3%, water 0.1%.
- **USDA gram weights are rounded** to the gram, or to a tenth. A teaspoon of baking soda is listed at 4.6 g, so a tablespoon is 13.8 g with an error of about 1%. Small measures carry more relative error.
- **The model against USDA at 20 C** (Choi-Okos from each record's own composition, uncalibrated): water -0.6%, skim milk -0.8%, whole milk -0.8%, half and half -1.0%, light whipping cream -2.2%, heavy whipping cream -2.0%, olive oil +0.5%, honey +0.8%. All are inside 3%. Every dairy value is low, and I found no independent measured cream density to say whether the model or USDA's cup weights are nearer the truth.
- **Brand and variety:** USDA lists one record for brown sugar, olive oil grades and molasses. Real products vary.
- **Labels round** (branded gap fills): see "Ingredients USDA's tables lack". Medians are good to a few percent when the weights are not coarse, and warnings say when they are. Salts differ most between brands: Morton and Diamond Crystal kosher salt differ by 1.7 times per teaspoon.
- **Portions disagree.** Where a form's USDA portions differ by more than 5% in density, the largest portion still sets the density and the helper warns. It matters most for ketchup (13%), grated Parmesan (25%), sour cream (20%) and nonfat dry milk (63%, from a "5 tbsp" row).
- **FNDDS weights are survey weights.** About 10% of FNDDS forms (389 of 4,077) have every portion at exactly water weight (240 g per cup). Some are real liquids; others (cream cheese, hummus, guacamole) look like placeholders. They carry `waterEquivalent: true` and the helper warns. Three of five FNDDS foods spot-checked agreed with SR Legacy to the gram (cooked white rice, brown sugar, powdered sugar).
- **Counts are USDA's.** A "large" egg is 50 g edible. A shop egg sold as large weighs 56.7 to 63.8 g in the shell (US), so its edible part is 49.9 to 56.1 g.
- **Not for alcoholic drinks** (the composition model has no alcohol term) or for anything whipped or aerated unless the form says so.

## Regenerate the data

```sh
npm run build:data      # SR Legacy + FNDDS (about 15 MB of downloads, once) -> data/
npm run build:branded   # Branded Foods (452 MB download, streamed, once) -> data/branded-gaps.json
npm run build:lite      # data/lite.json and data/lite.mjs from the files above; no download
npm test
```

The builds need Node 22 and `unzip` (and `curl` for the branded download). They write no timestamps, so two runs give byte-identical files. `aliases.json` and `measurements.json` are hand-curated and are not rewritten; `npm test` checks that each alias points at a real record, form and description, and that no two aliases claim the same name. The two data builds finish by running `build:lite`. After editing `aliases.json` or `units.json` by hand, run it yourself: `npm test` fails until the lite files match.

Tests use `node --test` with a glob, which needs Node 21 or later. The helper itself runs on Node 18 and later.

## Licence

Code: MIT, copyright KieranVR. Data: the USDA releases (SR Legacy, FNDDS, Branded Foods) are public domain; the curated aliases, units and derived densities are released under the same MIT licence.
