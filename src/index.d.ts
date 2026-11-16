export interface Unit {
  id: string;
  name: string;
  system: string;
  kind: 'volume' | 'mass';
  /** Millilitres per unit (volume units). */
  ml?: number;
  /** Grams per unit (mass units). */
  grams?: number;
  note?: string;
}

export const units: Unit[];
export const WATER_DENSITY_20C: number;

/** A unit object, an id such as "us-legal:cup", or a friendly name such as "cup", "Tbsp", "metric cup", "au tbsp". */
export type UnitInput = string | Unit;

export interface Composition {
  water: number;
  protein: number;
  fat: number;
  carbohydrate: number;
  fiber: number;
  ash: number;
  sum: number;
  carbohydrateByDifference: number;
  missing?: string[];
}

export interface CountPortion {
  /** "large", "medium", "clove", "slice", "stick", "lemon" (juice from one lemon) and similar. */
  label: string;
  /** The USDA modifier text, verbatim: 'medium (7" to 7-7/8" long)'. */
  sizeNote: string;
  amount: number;
  gramWeight: number;
  gramsPerUnit: number;
  usdaPortionId: number;
}

export interface Ingredient {
  id: string;
  name: string;
  /** Every name the ingredient answers to: the alias names, or the USDA description alone. */
  names: string[];
  /** "usda" (SR Legacy or FNDDS record), "model" (water, dairy), "branded" (label median), "ambiguous" (name several brands share). */
  kind: 'usda' | 'model' | 'branded' | 'ambiguous';
  /** Which USDA dataset a "usda" ingredient came from. */
  dataSource?: 'usda-sr-legacy' | 'usda-fndds' | 'usda-branded' | null;
  counts: CountPortion[];
  /** Count unit used when a call names none (egg: "large"). */
  defaultUnit?: string | null;
  /** Present for kind "usda". */
  fdcId?: number;
  description?: string;
  /** Present for kind "model": "water" or "dairy". */
  model?: 'water' | 'dairy';
  fatPercent?: number | null;
  /** Form used when the caller names none. */
  form: string;
  /** Form name to density in g/mL; null for model ingredients. */
  forms: Record<string, number | null>;
  composition: Composition | null;
  liquid: boolean;
  dairy: boolean;
  note?: string | null;
}

export interface DensityOptions {
  form?: string;
  /** Applied to liquids and to the water and dairy models; ignored, with a warning, for powders and solids. */
  temperatureC?: number;
  /** Dairy model only: percent fat by mass. */
  fatPercent?: number;
  /** Dairy model only: scale to USDA measured values (default true). */
  calibrated?: boolean;
  /** Narrow a count unit by a piece of its USDA size note: size: "thin" picks "slice, thin". */
  size?: string;
}

export type DensitySource =
  | { kind: 'usda-sr-legacy' | 'usda-fndds'; fdcId: number; description: string; portionId?: number; modifier?: string }
  | { kind: 'usda-branded'; gap: string; rows: number; release: string; medianUncertaintyPct: number; interquartileDensityGPerMl: [number, number] }
  | { kind: 'reference'; name: string }
  | { kind: 'model'; name: string; model: 'dairy' };

export interface DensityResult {
  densityGPerMl: number;
  form: string;
  temperatureC: number;
  fatPercent?: number;
  source: DensitySource;
  warnings: string[];
}

export interface ConversionResult {
  value: number;
  /** Unit id of `value`, for example "mass:g". */
  unit: string;
  amount: number;
  from: string;
  volumeMl?: number;
  densityGPerMl: number | null;
  form: string | null;
  temperatureC?: number;
  fatPercent?: number;
  /** Present when a count unit was used. */
  count?: { label: string; sizeNote: string; gramsPerUnit: number; usdaPortionId: number };
  source: DensitySource | null;
  warnings: string[];
}

export { createConverter } from './core.js';
export type { Converter, ConverterData } from './core.js';

/**
 * Resolve a unit id or a friendly name. A lone capital "T" is a tablespoon and a
 * lone small "t" a teaspoon; every other name ignores case.
 */
export function parseUnit(unit: UnitInput): Unit;
export function findIngredient(query: string | number | Ingredient): Ingredient | null;
export function searchIngredients(query: string, options?: { limit?: number }): Ingredient[];
export function getDensity(ingredient: string | number | Ingredient, options?: DensityOptions): DensityResult;

export function convert(args: {
  ingredient?: string | number | Ingredient;
  amount: number;
  /** A unit, or a count the ingredient has ("large", "clove"). Without it, the ingredient's defaultUnit. */
  from?: UnitInput;
  to: UnitInput;
} & DensityOptions): ConversionResult;

export function toGrams(args: {
  ingredient: string | number | Ingredient;
  amount: number;
  /** A unit, or a count ("large", "cloves", "eggs"). Without it, the ingredient's defaultUnit. */
  unit?: UnitInput;
  /** Target unit, default "g". */
  to?: UnitInput;
} & DensityOptions): ConversionResult;

export function toVolume(args: {
  ingredient: string | number | Ingredient;
  amount: number;
  /** Source unit, default "g". */
  unit?: UnitInput;
  /** Target volume unit, default "cup". */
  to?: UnitInput;
} & DensityOptions): ConversionResult;

export function fromGrams(args: {
  ingredient: string | number | Ingredient;
  amount: number;
  /** Source unit, default "g". */
  unit?: UnitInput;
  /** A count ("large", "clove") or any unit; default is the ingredient's defaultUnit. */
  to?: UnitInput;
} & DensityOptions): ConversionResult;

export interface EggClass {
  name: string;
  minOuncesPerDozen?: number;
  minIndividualOuncesPerDozenRate?: number | null;
  minGramsPerEgg: number | null;
  minIndividualGramsPerEgg?: number | null;
  maxGramsPerEggExclusive: number | null;
}
export interface EggStandard { id: 'us' | 'ca' | 'eu'; name: string; basis: string; citation: { title: string; url: string }; derivation: string; classes: EggClass[] }
export interface EggSizes {
  schemaVersion: 1;
  note: string;
  shell: { description: string; refusePercent: number; edibleFraction: number; appliesTo: { fdcId: number; ndbNumber: number; usdaDescription: string }; citation: { title: string; url: string }; note: string };
  standards: EggStandard[];
  notAvailable: { id: string; reason: string }[];
}
export interface Measurement {
  id: string; contributor: string; submittedOn: string; ingredient: string; description: string;
  quantity: 'mass-in-shell' | 'mass' | 'volume'; value: number; unit: 'g' | 'mL';
  dimensions?: { height?: { value: number; unit: string }; width?: { value: number; unit: string } };
  instrument: string; conditions: string; sizeClaim?: { standard: 'us' | 'ca' | 'eu'; name: string };
}
export function eggSizes(): EggSizes;
export function measurements(): Measurement[];
/** Edible grams of an egg from its in-shell weight (USDA SR: shell is 12 percent). */
export function edibleGramsFromShell(gramsInShell: number): number;
export function shellGramsFromEdible(edibleGrams: number): number;
export function classifyEgg(gramsInShell: number, standard?: 'us' | 'ca' | 'eu'): EggClass | null;

export function creamDensity(args: { fatPercent: number; temperatureC?: number; calibrated?: boolean }): number;
export function compositionDensity(composition: Partial<Record<'water' | 'protein' | 'fat' | 'carbohydrate' | 'fiber' | 'ash', number>>, temperatureC?: number): number;
export function componentDensity(component: 'water' | 'protein' | 'fat' | 'carbohydrate' | 'fiber' | 'ash', temperatureC: number): number;
