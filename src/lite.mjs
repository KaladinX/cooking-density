// cooking-density/lite: the same helper with its data bundled, for browsers,
// workers and any runtime without a file system.
//
//   import { toGrams } from 'cooking-density/lite';
//   toGrams({ ingredient: 'plain flour', amount: 1, unit: 'cup' }).value;   // 125
//
// It knows the curated ingredients in data/aliases.json (the names people
// write in recipes) and the USDA records behind them, not all 8,617 USDA
// foods. For those, fetch data/ingredients.json yourself and pass it to
// createConverter from cooking-density/core.
import { createConverter } from './core.mjs';
import data from '../data/lite.mjs';

export { createConverter } from './core.mjs';

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
} = createConverter(data);
