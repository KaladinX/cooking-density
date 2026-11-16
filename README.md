# cooking-density

Convert cooking volumes to grams, and grams back to volumes, using measured ingredient densities.

The main product is data: JSON files that any website or app can load. A small helper with no dependencies applies the data for you.

Mass is density times volume. A cup of flour and a cup of honey are the same volume and very different masses, so a volume alone never gives a weight. Every number here comes from a cited source or a cited model. Where no source exists, the ingredient is left out.

## The six examples

Run `node examples/basic.mjs`. This is its output as of version 0.1.0:

```
1 US cup all-purpose flour    -> 125.0 g
1 US tbsp baking soda         -> 13.8 g
1 US cup water                -> 236.2 g
3 US cups 30% MF cream        -> 717.2 g
250 g granulated sugar        -> 1.25 US cups
1 cup brown sugar, packed     -> 220.0 g
1 cup brown sugar, unpacked   -> 145.0 g

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
| `data/ingredients.json` | 3,127 USDA foods with a volume portion: forms, densities, the raw portion rows, composition |
| `data/ingredients.csv` | One row per food and form: id, fdc_id, description, category, form, density, basis portion |
| `data/aliases.json` | 198 curated common ingredients with US, UK, AU and CA names, mapped to one record and form |
| `data/units.json` | Every unit with its size in mL or g |
| `data/dairy-model.json` | Fit and calibration anchors for `creamDensity` |
| `data/build-report.json` | What the build kept and skipped |

JSON Schemas for the first three are in `schema/`.

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

- **id**: kebab-case slug of the USDA description. Where two foods share a slug, both get `-<fdcId>` appended.
- **forms**: one density per physical state. Powders and chopped foods depend on how they are packed or cut, so `packed`, `unpacked`, `sifted`, `chopped`, `whipped` and similar are separate forms. `default` is the plain cup, tablespoon or fluid ounce.
- **densityGPerMl**: taken from the largest-volume portion of that form, because gram weights are rounded and a big portion rounds least.
- **portions**: every USDA row behind the density, with its `modifier` text copied byte-for-byte from USDA.
- **composition**: grams per gram of food for water, protein, fat, carbohydrate, fiber and ash. USDA's "carbohydrate, by difference" includes fiber, so `carbohydrate` here is that value minus fiber, and the raw figure is kept as `carbohydrateByDifference`.
- **unit** ids look like `us-customary:cup`. Systems: `us-customary`, `us-legal`, `metric`, `australian`, `imperial`, `mass`.

An alias in `aliases.json` names an `fdcId`, a `form`, and the names people use. Aliases for model-backed things (water, creams by fat percentage) name a `model` instead.

## Use it as a helper

```sh
npm install cooking-density   # once published; or copy the repository
```

```js
import { findIngredient, toGrams, toVolume, convert, getDensity } from 'cooking-density';
```

- `findIngredient(query)`: look up by alias, id, USDA description or fdcId. Returns `null` if unknown. Case, accents and punctuation do not matter.
- `searchIngredients(query, { limit })`: all words must appear, in any order.
- `toGrams({ ingredient, amount, unit, form?, temperatureC?, fatPercent?, calibrated? })`
- `toVolume({ ingredient, amount, unit = 'g', to = 'cup', ... })`
- `convert({ ingredient?, amount, from, to, ... })`: any unit to any unit. Volume to mass uses the density; same-kind conversions need no ingredient.
- `getDensity(ingredient, options)`: the density in g/mL with its source and warnings.
- `creamDensity({ fatPercent, temperatureC = 20, calibrated = true })`: g/mL of milk or cream at a fat percentage.

### Units

Units are ids (`us-legal:cup`) or plain names. A bare `cup`, `tbsp`, `tsp`, `fl oz`, `pint`, `quart` or `gallon` is **US customary**. Name the others:

| You write | You get |
|---|---|
| `cup`, `us cup`, `Tbsp`, `tablespoon`, `fl oz` | US customary (cup = 236.588 mL) |
| `us-legal cup`, `legal tbsp` | FDA labelling units (cup = 240 mL, tbsp = 15 mL, tsp = 5 mL, fl oz = 30 mL) |
| `metric cup`, `metric tbsp` | 250 mL, 15 mL |
| `au tbsp` | 20 mL |
| `uk cup`, `imperial pint` | UK imperial (cup = 10 imperial fl oz = 284.131 mL) |
| `ml`, `l`, `dl` | metric |
| `g`, `kg`, `oz`, `lb` | mass (`oz` alone is an ounce of weight; use `fl oz` for volume) |

Legal units never apply by accident, because the difference between a 240 mL cup and a 236.6 mL cup is 1.4%.

### Regional names

`plain flour`, `caster sugar`, `icing sugar`, `bicarb soda`, `cornflour`, `double cream`, `single cream`, `whipping cream`, `35% cream`, `wholemeal flour` and many more resolve to a USDA record. Where the match is approximate (caster sugar is finer than granulated; plain flour is close to, not identical to, all-purpose), the result carries a warning saying so.

### Dairy by fat percentage

`toGrams({ ingredient: '30% cream', ... })` and `toGrams({ ingredient: 'cream', fatPercent: 30, ... })` use a dairy model. It describes the non-fat part of milk and cream by a line fitted to six USDA records (skim, whole milk, half and half, light cream, light whipping, heavy whipping), then computes density from composition with the Choi-Okos equations.

The model alone sits 0.8% to 2.2% under USDA's household-measure densities, and the gap grows with fat. So `calibrated` defaults to `true`: the model result is multiplied by the USDA/model ratio, interpolated by fat percentage between the six records. Pass `calibrated: false` for the uncalibrated physical model. 30% fat cream at 20 C is 1.0105 g/mL calibrated and 0.9913 g/mL uncalibrated. `docs/plans/physics-notes.md` has the method, the anchor table and the limits.

Beyond 36.08% fat (richer than the heavy cream record) the result is an extrapolation and says so in `warnings`.

### Temperature

Liquids can be converted at another temperature (`temperatureC`). Water uses 0.9982 g/mL at 20 C, scaled by the Choi-Okos water curve. Other liquids scale their USDA density by the model's temperature ratio and assume the USDA figure was measured at 20 C. Powders and solids ignore `temperatureC` and say so: their bulk density depends on packing, not temperature.

## Sources

- **USDA FoodData Central, SR Legacy (April 2018)**, public domain (CC0 1.0). Download: https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip. Portions, foods and nutrient values come from this release. Descriptions and modifier strings are reproduced exactly as USDA wrote them.
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
- **Salts and flakes:** only table salt has a record. Kosher and flaked sea salt weigh much less per cup and are not in the data.
- **Not for alcoholic drinks** (the composition model has no alcohol term) or for anything whipped or aerated unless the form says so.

## Regenerate the data

```sh
npm run build:data   # downloads SR Legacy into vendor-src/ if absent, rewrites data/
npm test
```

The build needs Node 22 and `unzip` when it has to download. It writes no timestamps, so two runs give byte-identical files. `aliases.json` is hand-curated and is not rewritten by the build; `npm test` checks that each alias points at a real record, form and description.

Tests use `node --test` with a glob, which needs Node 21 or later. The helper itself runs on Node 18 and later.

## Licence

Code: MIT, copyright KieranVR. Data: USDA SR Legacy is public domain; the curated aliases, units and derived densities are released under the same MIT licence.
