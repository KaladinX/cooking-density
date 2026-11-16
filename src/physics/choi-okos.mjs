// Choi-Okos composition model for the true density of foods with no entrained air.
//
// Component densities rho_i(T) in kg/m^3, T in degrees C, valid -40 to 150 C:
// Choi, Y. and Okos, M.R. (1986), "Effects of temperature and composition on the
// thermal properties of foods", in Food Engineering and Process Applications,
// Vol. 1, Transport Phenomena, Elsevier, pp. 93-101.
//
// The coefficients below were checked against two secondary tables that reproduce
// them (see docs/plans/physics-notes.md):
//   - Engineering Properties of Foods (CRC Press), Table 1.3, "Density of Major
//     Food Components" (prints protein as 1330.0, a rounding of 1329.9).
//   - Ankara University FDE 449 lecture notes, "Density, specific gravity and porosity".
// The original 1986 chapter was not available to read.
//
// Mixing rule (no pores, no interaction between components):
//   1 / rho = sum( x_i / rho_i(T) ),  x_i = mass fraction.

export const COMPONENTS = ['water', 'protein', 'fat', 'carbohydrate', 'fiber', 'ash'];

const COEFFICIENTS = {
  water: [997.18, 3.1439e-3, -3.7574e-3],
  protein: [1329.9, -0.5184, 0],
  fat: [925.59, -0.41757, 0],
  carbohydrate: [1599.1, -0.31046, 0],
  fiber: [1311.5, -0.36589, 0],
  ash: [2423.8, -0.28063, 0],
};

/** Density of one pure component, kg/m^3. */
export function componentDensity(component, temperatureC) {
  const c = COEFFICIENTS[component];
  if (!c) throw new Error(`Unknown component ${component}`);
  return c[0] + c[1] * temperatureC + c[2] * temperatureC * temperatureC;
}

/**
 * Density of a mixture in g/mL.
 * `composition` maps component names to mass fractions (g per g). Missing keys count
 * as zero. Fractions are normalised to sum to 1, so unmodelled mass (alcohol,
 * caffeine, rounding) is spread over the modelled components rather than dropped.
 */
export function density(composition, temperatureC = 20) {
  let total = 0;
  for (const name of COMPONENTS) total += composition[name] ?? 0;
  if (!(total > 0)) throw new Error('Composition has no mass');
  let specificVolume = 0; // m^3 per kg
  for (const name of COMPONENTS) {
    const x = (composition[name] ?? 0) / total;
    if (x > 0) specificVolume += x / componentDensity(name, temperatureC);
  }
  return 1 / specificVolume / 1000;
}

/**
 * Move a measured liquid density from one temperature to another by scaling it with
 * the model's own ratio rho(to) / rho(from). Only the temperature dependence comes
 * from the model, so a measured value keeps its offset from the model.
 */
export function adjustDensityForTemperature(measuredGPerMl, composition, fromC, toC) {
  return measuredGPerMl * (density(composition, toC) / density(composition, fromC));
}
