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

export interface Ingredient {
  id: string;
  name: string;
  kind: 'usda' | 'model';
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
}

export type DensitySource =
  | { kind: 'usda-sr-legacy'; fdcId: number; description: string }
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
  source: DensitySource | null;
  warnings: string[];
}

export function parseUnit(unit: UnitInput): Unit;
export function findIngredient(query: string | number | Ingredient): Ingredient | null;
export function searchIngredients(query: string, options?: { limit?: number }): Ingredient[];
export function getDensity(ingredient: string | number | Ingredient, options?: DensityOptions): DensityResult;

export function convert(args: {
  ingredient?: string | number | Ingredient;
  amount: number;
  from: UnitInput;
  to: UnitInput;
} & DensityOptions): ConversionResult;

export function toGrams(args: {
  ingredient: string | number | Ingredient;
  amount: number;
  unit: UnitInput;
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

export function creamDensity(args: { fatPercent: number; temperatureC?: number; calibrated?: boolean }): number;
export function compositionDensity(composition: Partial<Record<'water' | 'protein' | 'fat' | 'carbohydrate' | 'fiber' | 'ash', number>>, temperatureC?: number): number;
export function componentDensity(component: 'water' | 'protein' | 'fat' | 'carbohydrate' | 'fiber' | 'ash', temperatureC: number): number;
