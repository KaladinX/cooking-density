import type * as api from './index.js';
import type { Unit, EggSizes, Measurement } from './index.js';

/** Everything the helper exports, bound to one set of data. */
export type Converter = Omit<typeof api, 'createConverter'>;

/** A value, or a function returning it that is called once, on first use. */
type Source<T> = T | (() => T);

/**
 * The data behind a converter. Each entry is the parsed JSON file of the same
 * name in data/, or its main array. `data/lite.json` is one object of this shape.
 */
export interface ConverterData {
  /** data/units.json */
  units: Source<Unit[] | { units: Unit[] }>;
  /** data/aliases.json */
  aliases: Source<object[] | { aliases: object[] }>;
  /** data/ingredients.json, or any subset of its records. */
  ingredients: Source<object[] | { ingredients: object[] }>;
  /** data/dairy-model.json: needed for cream and milk by fat percentage. */
  dairyModel?: Source<object>;
  /** data/branded-gaps.json: needed for ghee, kosher salt and the other label medians. */
  brandedGaps?: Source<object>;
  /** data/egg-sizes.json: needed for classifyEgg and the shell helpers. */
  eggSizes?: Source<EggSizes>;
  /** data/measurements.json: needed for measurements(). */
  measurements?: Source<Measurement[] | { measurements: Measurement[] }>;
}

/**
 * Build the helper from data you loaded yourself. Runs in any JavaScript
 * runtime: nothing in it touches the file system or the network.
 */
export function createConverter(data: ConverterData): Converter;

export const WATER_DENSITY_20C: number;
