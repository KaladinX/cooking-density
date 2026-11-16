# Physics notes (batch 2)

Source material for the README. Numbers here come from `npm test` and
`data/` as built on 2026-11-16.

## Choi-Okos coefficients: verification

Model: `1/rho = sum(x_i / rho_i(T))`, rho in kg/m^3, T in degrees C, valid -40 to 150 C,
no pores and no interaction between components.

Original: Choi, Y. and Okos, M.R. (1986), "Effects of temperature and composition on
the thermal properties of foods", in *Food Engineering and Process Applications*,
Vol. 1, Transport Phenomena, Elsevier, pp. 93-101. The chapter itself was not
available to read. The coefficients were checked in two secondary tables that quote it:

1. Ankara University FDE 449 notes, "Density, specific gravity and porosity"
   (acikders.ankara.edu.tr), which prints all six.
2. *Engineering Properties of Foods* (CRC Press; copy at repository.ottimmo.ac.id), Table 1.3, "Density of
   Major Food Components" (attributed there to Choi and Okos, 1985 in the reference
   list), and a second table in the same book that prints water, protein, fat and ash.

| Component | rho(T), kg/m^3 | Matches the brief |
|---|---|---|
| water | 997.18 + 3.1439e-3 T - 3.7574e-3 T^2 | yes |
| protein | 1329.9 - 0.5184 T | yes |
| fat | 925.59 - 0.41757 T | yes |
| carbohydrate | 1599.1 - 0.31046 T | yes |
| fiber | 1311.5 - 0.36589 T | yes |
| ash | 2423.8 - 0.28063 T | yes |

Differences found in the sources, none of which changed the code:

- Table 1.3 in the book prints the protein intercept as 1330.0 (1.3300 x 10^3),
  a rounding of 1329.9. The Ankara notes and the book's other table give 1329.9.
  I used 1329.9. The effect is 0.1 kg/m^3 on a component that is 3% of cream.
- The second table in the book prints carbohydrate as `1599.1 - 3.6589e-1 t`.
  That slope is the fibre slope, a copy error: Table 1.3 and the Ankara notes both give
  0.31046. I used 0.31046.
- A US patent text (8363913) prints protein as `1330 - 0.1584 T`. It disagrees with
  every other source and I ignored it.

Known weakness of the water polynomial: it gives 995.74 kg/m^3 at 20 C, where
measured pure water is about 998.2. The model is 0.25% low for water at 20 C. Every
water-rich food inherits some of that. I kept the published coefficients.

## Composition from USDA

`food_nutrient.csv` gives grams per 100 g. Each ingredient gets `composition`
(g per g): water, protein, fat, carbohydrate, fiber, ash.

SR "Carbohydrate, by difference" (nutrient 1005) already contains dietary fibre
(nutrient 1079). So `carbohydrate = carbohydrateByDifference - fiber` (floored at
zero) and fibre is its own component. The raw by-difference value is kept as
`carbohydrateByDifference` so the split can be audited. A test checks
`carbohydrate + fiber = carbohydrateByDifference` for honey.

`sum` is the total of the six fractions. It is near 1 for most foods. It is lower
where USDA lists mass the model does not know (alcohol, caffeine); the lowest is
0.371. The model normalises fractions to sum to 1, so for those foods its answer is
only as good as the assumption that the missing mass looks like the rest. Do not
use it on alcoholic drinks. 192 foods lack a fibre or ash value; they are listed in
`composition.missing` and treated as zero.

## Parametric dairy: `creamDensity({fatPercent, temperatureC})`

Idea: cream is fat plus a watery "serum" whose make-up barely changes as fat rises.
Method, in `src/physics/dairy-model.mjs`, fitted in `scripts/build-data.mjs`:

1. Take six plain USDA records: skim (173432), whole 3.25% (172217), half and half
   (171255), light cream (170857), light whipping (170858), heavy whipping (170859).
   Fat runs from 0.18% to 36.08%.
2. For each record, divide water, protein, carbohydrate, fibre and ash by `1 - fat`.
   That is the make-up of the non-fat part.
3. For each component, fit a least-squares line against fat fraction. The fits are in
   `data/dairy-model.json`.
4. At a requested fat percentage, read each component off its line, clip below zero,
   and rescale the non-fat part so its pieces sum to 1. Multiply by `1 - fat`.
5. Pass the composition to Choi-Okos at the requested temperature.

The fit is interpolation between 0.18% and 36.08% fat. Above 36% it extrapolates
along the same lines: fine to about 40%, untested beyond. `fatPercent` must be below
100, and nothing below the skim record has been checked.

Results for 30% fat, uncalibrated (`calibrated: false`, the pure model):

| Cream | 20 C | 4 C |
|---|---|---|
| 30% fat | 0.99128 g/mL | 0.99468 g/mL |

`creamDensity` now calibrates by default; see "Calibrated dairy" below.

The result is the density of liquid cream. Whipped cream holds air and is a separate
USDA form (about 0.51 g/mL).

## Model against USDA measured density, 20 C

"USDA" is the default-form density from the household portion (cup, fl oz or tbsp),
which carries gram-weight rounding and no stated temperature. The model uses each
record's own composition. Error is `model / USDA - 1`.

| Food | USDA g/mL | Model g/mL | Error |
|---|---|---|---|
| Water, bottled, generic | 1.0017 | 0.9961 | -0.56% |
| Milk, nonfat (skim) | 1.0356 | 1.0273 | -0.79% |
| Milk, whole 3.25% | 1.0313 | 1.0232 | -0.79% |
| Cream, half and half | 1.0229 | 1.0129 | -0.97% |
| Cream, light whipping | 1.0102 | 0.9885 | -2.15% |
| Cream, heavy whipping | 1.0060 | 0.9857 | -2.01% |
| Oil, olive | 0.9130 | 0.9172 | +0.47% |
| Honey | 1.4329 | 1.4442 | +0.79% |

Nothing fails 3%. Where it comes closest:

- Light and heavy whipping cream are 2.0% to 2.2% low. Every dairy liquid is low,
  and the gap grows with fat: 0.8% for milk, 2.0% to 2.2% for the whipping creams.
  I did not find an independent measured density for cream to settle which side
  is wrong. Two causes are possible and I cannot separate them here: the model's
  fat density, and USDA's household cup weights for cream (238 g and 242 g per
  cup are rounded to the gram, which alone is about 0.2%).
- Water is 0.56% low. 0.25% of that is the polynomial (above); the rest is USDA's
  rounded 1 fl oz weight.
- Honey passes (+0.79%). Honey is a concentrated sugar solution, and the model
  treats its sugar as one dry carbohydrate. It happens to land close, so honey is
  inside the model's reach, but sugar syrups at other concentrations were not tested.

The parametric `creamDensity` at 30.91% fat (the light-whipping fat content) gives
0.9902 g/mL, 1.98% under USDA's 1.0102. It was fitted on these same records, so this
is not an independent test; it only shows the fit does not add error beyond the
Choi-Okos gap (the parametric and direct answers agree within 0.5% on all six
records, which a test enforces).

## Temperature correction

`adjustDensityForTemperature(measured, composition, fromC, toC)` scales a measured
density by the model's ratio `rho(toC) / rho(fromC)`. The USDA household values carry
no stated temperature; the code assumes 20 C. Effect sizes from the model: olive oil
is 0.7% denser at 4 C than at 20 C; 30% cream is 0.34% denser at 4 C.
Water at 4 C is only 0.14% denser than at 20 C by this polynomial, where the true
value is about 0.18% (my recollection of the standard water table; not checked
against a source here).

## Calibrated dairy (batch 3)

The pure model sits 0.8% to 2.2% under USDA's household-measure densities for every
dairy liquid, and the gap grows with fat. A cook weighing a cup of cream wants the
number that matches what USDA recorded for a cup of cream, so `creamDensity` and the
`dairy` aliases now correct for it by default.

Method: at each of the six anchor records (skim, whole, half and half, light cream,
light whipping, heavy whipping) the build stores `ratio = USDA density / model density`
at that record's own fat percentage, with the model evaluated by the same parametric
code a caller uses (`data/dairy-model.json`, key `calibration`). For any fat
percentage, `creamDensity` multiplies the model result by the ratio, linearly
interpolated by fat percentage between neighbouring anchors. Below 0.18% and above
36.08% fat the end ratio is held constant. Temperature enters through the model
only, so the ratio is an offset measured at 20 C and carried to other temperatures.

| Anchor | Fat % | USDA g/mL | Model g/mL | Ratio |
|---|---|---|---|---|
| Skim milk | 0.18 | 1.035554 | 1.026891 | 1.00844 |
| Whole milk | 3.27 | 1.031328 | 1.023074 | 1.00807 |
| Half and half | 11.50 | 1.022874 | 1.013055 | 1.00969 |
| Light cream | 19.10 | 1.014421 | 1.003987 | 1.01039 |
| Light whipping | 30.91 | 1.010194 | 0.990236 | 1.02015 |
| Heavy whipping | 36.08 | 1.005967 | 0.984343 | 1.02197 |

Calibrated result by construction equals USDA at the anchors (a test checks 0.2%).
Between anchors it is an interpolation of a correction, not an independent
measurement. 30% fat cream:

| | 20 C | 4 C |
|---|---|---|
| Calibrated (default) | 1.01051 g/mL | 1.01398 g/mL |
| Uncalibrated model | 0.99128 g/mL | 0.99468 g/mL |

The calibrated figure sits between light cream (1.0144 at 19.1% fat) and light
whipping cream (1.0102 at 30.91% fat), as it should. Whether USDA's rounded
household weights or the model are nearer to the true density of cream is unresolved
here (see above); the calibrated default trades model purity for agreement with the
data cooks will compare against. Use `calibrated: false` for the physical model.

Fixed-fat aliases (fat percentages come from the sources named, not from this
project): `single cream` 18% and `double cream` 48% (UK minimums, University of
Reading food law summary; Dairy UK compositional standards for single cream),
`whipping cream` and `35% cream` 35% (UK and Canadian whipping cream minimum).
`double cream` at 48% is beyond the 36.08% top of the fit, so it carries an
"extrapolated" warning and uses the heavy-cream end ratio. Any `N% cream` or
`N% milk` query builds the model at N percent.

## Water reference value (batch 3)

Choi-Okos gives pure water 995.74 kg/m^3 at 20 C, 0.25% low. The `water` ingredient
uses 0.9982 g/mL at 20 C instead, and applies the Choi-Okos water polynomial only as
a ratio rho(T)/rho(20 C) for temperature. Sources for 0.9982: the Ankara FDE 449
notes (a density-of-water table with 60 C at 983.2 and 80 C at 971.8 kg/m^3),
hypertextbook.com's water density table (0.9982 g/cm^3 at 20 C), and
open-chemistry water-property appendices that print 998.2071 kg/m^3 at 20 C
(secondary, OpenStax-derived). I could not open a primary IAPWS or CRC table, so the
four-figure value is cross-checked, not primary-sourced. `WATER_DENSITY_20C` is
0.9982 (the 998.2071 figure rounds to it).

Accuracy of the temperature ratio: 0.99964 g/mL at 0 C, 0.99960 at 4 C, 0.99737 at
25 C, 0.97579 at 80 C. Real water is densest near 4 C (about 0.99997), which the
polynomial does not reproduce: between 0 and 10 C the ratio is flat where real
water rises and falls by about 0.02%. At 60 to 80 C the ratio is 0.3% to 0.4% high
against the Ankara table values above. This is below the 1% temperature effect the
README quotes, and the helper warns outside 0 to 100 C.

## Aliases (batch 3)

`data/aliases.json` has 198 entries: 193 point at one USDA SR Legacy record and form
(`usdaDescription` is the record's description byte-for-byte, checked by a test), and
5 are model-backed (`water`, `single-cream`, `cream-35`, `double-cream` and the bare
`cream`, which requires `fatPercent`). Each carries regional names (US, UK, AU, CA) where
I know them. Several mappings are approximations, marked with a `note` that the
helper returns as a warning:

- `plain flour` to the US all-purpose record.
- `caster sugar` to granulated sugar (finer crystals; USDA has no record).
- `demerara sugar` to turbinado.
- `light brown sugar` and `dark brown sugar` to the single USDA brown sugar record.
- `sultanas` to raisins, `shredded coconut` to the sweetened flaked record.
- `cornflour` (UK, AU) to cornstarch.
- `olive oil` grades and `molasses` varieties share one record each.

Common ingredients I looked for and did not map, because SR Legacy has no volume
portion for them or no matching record. Each is absent rather than guessed:

- whole eggs (only whites and yolks have cup portions; whole egg is by count),
  chia seeds, agave syrup, golden syrup, treacle, ghee, pastry flour,
  kosher salt and flaked or coarse sea salt (only table salt),
  basmati and arborio rice (SR has long, medium and short grain),
  unsweetened desiccated coconut, plain Greek yogurt (only a flavoured record),
  creme fraiche, unflavoured gelatin powder (only gelatin dessert mixes),
  US "corn flour" (ambiguous between finely ground cornmeal and masa harina;
  masa harina is mapped),
  baking chocolate in squares or bars by the cup, citrus zest.
- `cream` with no fat percentage: ambiguous; the helper asks for `fatPercent`.

Forms matter for several: `cheddar` and `mozzarella` default to the shredded form,
`brown sugar` to packed, `raisins` to unpacked, `rolled oats` to the single dry oats
record. Pass `form` to override.

## Batch 4: counts, eggs, FNDDS, branded gap fills

### Count portions

SR Legacy and FNDDS list portions in things as well as volumes. The parser used to skip
them. `parseCount` now reads a fixed list of generic count words at the start of the
modifier (`large`, `medium`, `small`, `extra large`, `jumbo`, `clove`, `each`, `whole`,
`stick`, `slice`, `sprig`, `leaf`, `pod`, `piece`, `fruit`, `head`, `bunch`, `stalk`,
`ear`, `spear`, `wedge`, `pat`, `cube`, `bulb`, `unit`, `item`, and "lemon/lime/orange
yields", which is the juice of one fruit). Cuts and packages ("steak", "jar", "can",
"package") are not counted. Each count keeps `sizeNote` (the modifier text verbatim),
`amount`, `gramWeight`, `gramsPerUnit` and the USDA portion id, and stays out of the
volume density. A food with counts and no volume portion has `forms: []`.

SR Legacy: 1,806 count portions (1,038 SR foods have counts and no volume density, so
they enter `ingredients.json` with `forms: []`). FNDDS: 4,184. Total 5,990.

`cup (4.86 large eggs)` (243 g) is a volume portion with a note about how many eggs fill
it. The parser now ignores that parenthetical, so the whole raw egg gets a density,
1.0271 g/mL, and a cup of eggs is 4.86 large eggs.

Edible weights: the SR28 documentation says portion weights are "for edible material
without refuse". So `large` egg 50 g is without the shell, a medium banana's 118 g is
without the peel, and `lime yields` 44 g is the juice of one lime.

### Egg sizes and the shell

Source for the shell fraction: USDA SR28 `FOOD_DES.txt`, NDB 01123 "Egg, whole, raw,
fresh", `Ref_Desc` "Shell", `Refuse` 12. The FDC CSV and API for SR Legacy carry no
refuse field, which is why the older SR28 file was read.

Size standards (all read, not recalled):

- US: AMS 56 section 56.218 Table I. Minimum net weight per dozen: jumbo 30 oz, extra
  large 27, large 24, medium 21, small 18, peewee 15. Individual eggs at the dozen
  rate: 29, 26, 23, 20, 17. Per-egg grams are ounces / 12 x 28.349523125.
  The standard sets class minimums, not maximums; the data stores the next class's
  minimum as the exclusive upper edge. The weights are in section 56.218 of the AMS 56
  booklet (effective July 20, 2000), not in 7 CFR 56.210.
- Canada A: Canadian Grade Compendium Volume 5, section 5: jumbo 70 g, extra large 63,
  large 56, medium 49, small 42 (egg weighs not less than). The page text flattens the
  table, so peewee is read as "under 42 g" without confirmation.
- EU Class A: Regulation (EC) No 589/2008 Article 4: XL 73 g or more; L 63 to under 73;
  M 53 to under 63; S under 53. The copy read is on legislation.gov.uk (it includes UK
  amendments; the figures are the original ones).
- Australia: not included. Secondary pages quote ranges, but no Australian standard
  could be found and read.

#### The 60.5 g egg

A US "large" egg, fridge-cold, 2 in tall and 1.75 in wide, 60.5 g in the shell on a
coffee scale (contributor KieranVR; scale resolution not recorded).

- Class: US Large (56.70 up to 63.79 g per egg on the per-dozen average; the individual
  minimum is 54.34 g). Canada Large (56 to under 63). EU M (53 to under 63).
- Edible estimate: 60.5 x 0.88 = **53.24 g**.
- USDA: large egg **50 g** (SR portion 88374). Difference **+6.5%**.

Why they differ, as far as the numbers show:

1. USDA's 50 g is the class floor. The US large minimum is 24 oz per dozen = 56.70 g in
   the shell, and 56.70 x 0.88 = 49.9 g. The large class spans 56.70 to 63.79 g in the
   shell, so edible 49.9 to 56.1 g. The 60.5 g egg is 54% of the way up that span; the
   midpoint of the class is 60.2 g in the shell, 53.0 g edible. So the egg is ordinary
   for a large egg and 50 g is its lower end.
2. The 12% shell is one national average. A given egg's shell share is not measured here,
   and no measurement of it was found to cite.
3. The coffee scale's resolution and calibration are unknown, so no error bar is claimed.

The check in `test/eggs.test.mjs` asserts the egg is in the US Large range and that the
edible estimate is within 0% to 10% above 50 g.

### FNDDS

Source: FDC "FNDDS 2021-2023" CSV, `FoodData_Central_survey_food_csv_2024-10-31.zip`
(3.3 MB; the newest survey file on https://fdc.nal.usda.gov/download-datasets, checked
2026-11-16). SR Legacy wins. A FNDDS food is dropped when its description, split at
commas, equals the leading segments of an SR Legacy description (279 of 5,432 foods).
Near duplicates stay (FNDDS "Rice, white, cooked, no added fat" next to SR rice).

FNDDS writes the amount in `portion_description` ("1 cup", "1 tablespoon", "1 large"),
and its `modifier` column is a numeric code, so the amount is split off and the rest goes
through the same modifier parser. "Quantity not specified" (5,387 rows) has no amount
and is skipped. FNDDS composition uses nutrient numbers (255 is water) where SR uses
nutrient ids (1051 is water); both are mapped.

Result: 4,451 FNDDS foods kept (3,910 with a volume density, 541 with counts only),
4,077 forms, 4,184 count portions.

Spot-check of five FNDDS foods against SR Legacy:

| FNDDS food | FNDDS g/mL | SR Legacy | Verdict |
|---|---|---|---|
| Rice, white, cooked, no added fat (1 cup 158 g) | 0.6678 | cooked rice 0.668 (158 g) | agrees |
| Sugar, brown (1 cup 220 g) | 0.9299 | brown sugar packed 0.9299 | agrees |
| Sugar, white, confectioner's, powdered (1 cup 120 g) | 0.5072 | powdered sugar 0.5072 | agrees |
| Ketchup (1 tbsp 17 g, 1 cup 272 g) | 1.1497 | catsup 1.0144 (tbsp 17 g, cup 240 g) | SR disagrees with itself: its tbsp gives 1.152, its cup 1.014. FNDDS is consistent. |
| Cream cheese, regular, plain (1 cup 240 g, 1 tbsp 15 g) | 1.0144 | cream cheese 0.9806 (cup 232 g) | FNDDS is exactly water weight: a placeholder. Flagged `waterEquivalent`. |

Findings that came out of this and are now flagged in the data:

- `waterEquivalent`: 389 FNDDS forms (of 4,077) and 167 SR forms (of 3,439) have every
  volume portion at exactly cup 240 g, tbsp 15 g, tsp 5 g or fl oz 30 g. Water-like
  liquids pass for real. Hummus, guacamole, cream cheese and dips look like defaults.
- `portionSpreadPct`: 178 FNDDS and 89 SR forms have portions that disagree by more than
  5% in density. SR catsup is the clearest case. The rule "density from the largest
  portion" takes the cup (240 g) over the tablespoon (17 g), which here picks the worse
  number. The ketchup alias warns; it was not changed to a different record because the
  FNDDS record would then be the only evidence.

### Branded-label gap fills

Source: FDC Branded Foods CSV, release 2026-10-29 (452 MB zip, 3.1 GB unpacked; streamed
with `unzip -p`, never unpacked). Chosen over the API because the API's DEMO_KEY allows
a handful of requests per hour (a test call returned `x-ratelimit-limit: 10`), far too few
for 24 searches with paging.

Method (`scripts/build-branded.mjs`, patterns in `scripts/branded-gaps.mjs`):

1. Pass over `food.csv`: keep rows whose description matches a gap's pattern.
2. Pass over `branded_food.csv`: keep rows matching the gap's brand, ingredients and
   exclusion patterns; read the household serving text (`1/4 tsp`, `1 tbsp`, `3/4 cup`);
   take grams from `serving_size` when its unit is grams, else from a "(NNg)" in the
   household text; compute density = grams / (amount x mL).
3. Volume units are the FDA labelling units (cup 240 mL, tbsp 15 mL, tsp 5 mL), because
   US labels use them.
4. Drop rows outside 0.05 to 3 g/mL (Lyle's golden syrup appears as "1 tsp, 21 g"
   in some listings, a data error that would read as 4.3 g/mL).
5. Collapse rows that repeat the same brand, description, household text and weight.
6. Median, quartiles and range of the density; every row kept with `uncertaintyPct`.

Rounding uncertainty per row: half a unit of the last printed digit as a percent of the
gram weight. "15.0" is read as 15 (0.5/15 = 3.3%), "1.2" as 1.2 (0.05/1.2 = 4.2%), "1"
as 1 (50%). Float32 artifacts such as 1.2000000476837158 are cleaned to 7 significant
digits first. This measures only how coarse the printed number is. It cannot see that the
household volume itself is nominal.

Controls: the same method on three foods SR Legacy measures, median against SR default
density: honey 1.40 against 1.4329 (-2.3%, 1,144 rows), granulated sugar 0.80 against
0.8454 (-5.4%, 360 rows, median row uncertainty 12.5%), table salt 1.20 against 1.2342
(-2.8%, 231 rows). Label densities run a few percent low and quantise coarsely.

Results (rows after de-duplication, median g/mL):

| Gap | Rows | Median | Notes |
|---|---|---|---|
| Golden syrup | 1 | 1.40 | one Lyle's row; 1 row only |
| Treacle | 0 | none | no row in the release matches |
| Ghee | 148 | 0.9333 | |
| Kosher salt, Diamond Crystal | 3 | 0.56 | 2.8 g per US tsp; uncertainty 7.1% |
| Kosher salt, Morton | 4 | 0.96 | 4.7 g per US tsp |
| Flaky sea salt | 15 | 1.20 | quartiles 0.76 to 1.20: brands differ |
| Chia seeds | 234 | 0.80 | |
| Agave syrup | 171 | 1.40 | |
| Plain Greek yogurt | 463 | 0.9444 | 9% under SR plain yogurt: labels state 170 g as 3/4 cup |
| Creme fraiche | 7 | 0.9333 | |
| Gelatin powder | 5 | 0.6667 | |
| Pastry flour | 27 | 0.50 | |
| Desiccated coconut | 104 | 0.4583 | quartiles 0.33 to 0.50 |
| Basmati rice, dry | 236 | 0.75 | |
| Arborio rice, dry | 120 | 0.75 | |
| Smoked paprika | 6 | 0.48 | uncertainty 8.3% |
| Za'atar | 36 | 0.76 | uncertainty 6.7%; brands disagree |
| Garam masala | 38 | 0.56 | uncertainty 7.1% |
| Sumac | 3 | 0.40 | 3 rows; uncertainty 10% |
| Ground cumin | 15 | 0.56 | uncertainty 7.1% |
| Ground coriander | 11 | 0.48 | uncertainty 8.3% |
| Chinese five spice | 29 | 0.48 | uncertainty 8.3% |
| Italian seasoning | 31 | 0.24 | uncertainty 16.7% |
| Nutritional yeast | 24 | 0.25 | |
| Chipotle powder | 3 | 0.72 | 3 rows |

Kosher salt: Morton is 1.7 times Diamond Crystal per teaspoon (0.96 / 0.56), a little
under the "about 2x" rule of thumb. Both brands have few distinct rows because most label
rows repeat the same servings.

King Arthur's weight chart was not used.

### Still unmatched

- Treacle: no row in the 2026-10-29 release matches.
- `kosher salt` with no brand: ambiguous by design (Morton and Diamond Crystal differ by
  1.7 times per teaspoon); the helper asks for a brand.
- `cream` with no fat percentage, and US "corn flour" (two different products).
- Not looked at in batch 4, still absent from the data: baking chocolate by the cup and
  citrus zest.
- Australian egg size standard (none found that could be read).
- Spices beyond the ten fetched (smoked paprika, za'atar, garam masala, sumac, ground
  cumin, ground coriander, five spice, Italian seasoning, nutritional yeast, chipotle
  powder). Others that SR lacks were not searched for.
- Weak fills that work but warn: golden syrup (1 row), sumac (3), chipotle powder (3),
  Diamond Crystal kosher salt (3), and every spice whose labels give a fraction of a gram.
