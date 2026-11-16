# Changelog

## 0.3.0 (2026-11-16)

### Runs in the browser

- `cooking-density/lite` is the same helper with its data bundled, for browsers and any runtime without a file system. It knows the 281 curated ingredients and weighs 165 KB (32 KB gzipped). The main entry still reads `data/` from disk and still needs Node.
- `cooking-density/core` exports `createConverter(data)`, which builds the helper from JSON you loaded yourself. Use it to put all 8,617 USDA foods in a browser.
- `data/lite.json` and `data/lite.mjs` hold the curated data in one file. `npm run build:lite` writes them, and `npm test` fails when they are stale.
- `examples/browser.html` is a working page with no build step.

### More names and units

- 53 new curated ingredients, most of them names that differ across the Atlantic: zucchini and courgette, eggplant and aubergine, cilantro and fresh coriander, scallions and spring onions, arugula and rocket, rutabaga and swede, beets and beetroot, snow peas and mangetout, bok choy and pak choi. Also stocks, soy and almond milk, wine, cooked rice, pasta and beans, berries and dried fruit.
- `capsicum`, `sweet pepper` and `red bell pepper` now find bell pepper; `wholemeal plain flour` finds whole wheat flour.
- New units: `cl`, `mg`, `dessertspoon` (10 mL), and the old US shorthand `T` (tablespoon) and `t` (teaspoon).
- `uk tbsp` and `uk tsp` are still refused, and the error now names the unit to write instead (`metric tbsp`, 15 mL).
- Counts accept the ingredient as its own unit (`2 eggs`, `2 bananas`), any regular plural, and `XL`, `lg`, `med`, `sm`.
- A fat percentage is read from more spellings: `35% M.F. cream`, `cream 18%`, `cream (40% fat)`, `2 percent milk`.

### Changed

- `searchIngredients` ranks its results: curated ingredients first with an exact name on top, then USDA foods with raw SR Legacy records before prepared dishes. `searchIngredients('zucchini')` used to open with "Bread, zucchini"; it now opens with zucchini.
- Ingredient objects carry `names`, every name the ingredient answers to.
- A count with no size (`unit: 'whole'` on a food with no curated default) now takes `medium`, or the food's only count, and says so in `warnings`. It used to throw.
- Errors for a missing unit, a missing amount or an amount passed as a string say what to pass.

### Internal

- The conversion code moved from `src/index.mjs` to `src/core.mjs` and takes its data as an argument. `src/index.mjs` and `src/lite.mjs` are thin files that bind it to data.
- A test checks that no two aliases claim the same name.
- GitHub Actions runs the tests on Node 22 and 24, and runs the helper on Node 18 and 20.

## 0.2.0 (2026-11-16)

- Count units: `2 large eggs`, `3 garlic cloves`, `1 medium banana`, in either direction.
- Egg size standards for the US, Canada and the EU, the 12 percent shell fraction, and `data/measurements.json` for kitchen measurements.
- 4,451 foods from USDA FNDDS that SR Legacy lacks.
- `data/branded-gaps.json`: label medians for 24 ingredients the USDA reference tables lack, such as ghee, kosher salt by brand and chia seeds.

## 0.1.0 (2026-11-16)

- First release: densities for USDA SR Legacy foods by form, curated aliases with US, UK, AU and CA names, units, and the Choi-Okos model for temperature and for dairy by fat percentage.
