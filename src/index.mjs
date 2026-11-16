// cooking-density for Node: convert cooking volumes to grams and back.
//
//   findIngredient('plain flour')
//   toGrams({ ingredient: 'all-purpose flour', amount: 1, unit: 'cup' })
//   toVolume({ ingredient: 'granulated sugar', amount: 250, unit: 'g', to: 'cup' })
//   convert({ ingredient: 'water', amount: 1, from: 'cup', to: 'g' })
//
// This entry reads the JSON in data/ from disk, each file on first use, and
// knows every USDA food (8,617 of them). It needs node:fs, so it does not run
// in a browser: use cooking-density/lite there, or createConverter from
// cooking-density/core with data you load yourself.
import { readFileSync } from 'node:fs';
import { createConverter } from './core.mjs';

export { createConverter } from './core.mjs';

const read = (name) => () => JSON.parse(readFileSync(new URL(`../data/${name}.json`, import.meta.url), 'utf8'));

export const {
  units,
  parseUnit,
  WATER_DENSITY_20C,
  findIngredient,
  searchIngredients,
  getDensity,
  convert,
  toGrams,
  toVolume,
  fromGrams,
  creamDensity,
  compositionDensity,
  componentDensity,
  eggSizes,
  measurements,
  edibleGramsFromShell,
  shellGramsFromEdible,
  classifyEgg,
} = createConverter({
  units: read('units'),
  aliases: read('aliases'),
  ingredients: read('ingredients'),
  dairyModel: read('dairy-model'),
  brandedGaps: read('branded-gaps'),
  eggSizes: read('egg-sizes'),
  measurements: read('measurements'),
});
