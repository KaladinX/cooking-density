// Cream and milk density at an arbitrary fat percentage.
//
// The non-fat part of dairy products has nearly the same make-up whatever the
// fat content, so we describe each USDA dairy record by its fat fraction f and
// the composition of its non-fat part (each component divided by 1 - f).
// A least-squares line through the USDA records, per component, gives the
// non-fat make-up at any f. Method and limits: docs/plans/physics-notes.md.
//
// Every function takes the fitted model (data/dairy-model.json) as an argument,
// so nothing here touches the file system. src/physics/dairy.mjs is the same
// set of functions with the model read from disk.
import { density } from './choi-okos.mjs';

const NON_FAT = ['water', 'protein', 'carbohydrate', 'fiber', 'ash'];

/**
 * Fit the model. `records` is [{fdcId, description, composition}], composition in g/g.
 * Returns {components: {name: {intercept, slope}}, fatRange, records}.
 */
export function fitDairyModel(records) {
  const points = records.map((r) => {
    const f = r.composition.fat;
    const nonFat = 1 - f;
    const y = Object.fromEntries(NON_FAT.map((n) => [n, r.composition[n] / nonFat]));
    return { f, y };
  });
  const n = points.length;
  const meanF = points.reduce((s, p) => s + p.f, 0) / n;
  const sxx = points.reduce((s, p) => s + (p.f - meanF) ** 2, 0);
  const components = {};
  for (const name of NON_FAT) {
    const meanY = points.reduce((s, p) => s + p.y[name], 0) / n;
    const sxy = points.reduce((s, p) => s + (p.f - meanF) * (p.y[name] - meanY), 0);
    const slope = sxy / sxx;
    components[name] = { intercept: meanY - slope * meanF, slope };
  }
  const fats = points.map((p) => p.f);
  return {
    method: 'least-squares line of each non-fat component fraction against fat fraction',
    components,
    fatRange: [Math.min(...fats), Math.max(...fats)],
    records: records.map((r) => ({ fdcId: r.fdcId, description: r.description, fat: r.composition.fat })),
  };
}

/** Mass-fraction composition (g/g) of a dairy liquid with `fatPercent` percent fat by mass. */
export function dairyComposition(fatPercent, model) {
  const f = fatPercent / 100;
  if (!(f >= 0 && f < 1)) throw new Error('fatPercent must be in [0, 100)');
  const raw = Object.fromEntries(
    NON_FAT.map((n) => [n, Math.max(0, model.components[n].intercept + model.components[n].slope * f)]),
  );
  // Renormalise the non-fat part to sum to 1 so the fractions always add up.
  const sum = NON_FAT.reduce((s, n) => s + raw[n], 0);
  const composition = { fat: f };
  for (const n of NON_FAT) composition[n] = (raw[n] / sum) * (1 - f);
  return composition;
}

/**
 * USDA/model density ratio at `fatPercent`, linearly interpolated between the
 * anchor records and held constant beyond the first and last anchor.
 */
export function calibrationRatio(fatPercent, model) {
  const f = fatPercent / 100;
  const anchors = model.calibration;
  if (f <= anchors[0].fat) return anchors[0].ratio;
  const last = anchors[anchors.length - 1];
  if (f >= last.fat) return last.ratio;
  for (let i = 1; i < anchors.length; i++) {
    const hi = anchors[i];
    if (f <= hi.fat) {
      const lo = anchors[i - 1];
      return lo.ratio + ((f - lo.fat) / (hi.fat - lo.fat)) * (hi.ratio - lo.ratio);
    }
  }
  return last.ratio;
}

/**
 * Density in g/mL of cream or milk at `fatPercent` % fat (by mass) and `temperatureC`.
 * With `calibrated` (the default) the model result is scaled by the USDA/model ratio
 * at that fat percentage, so the answer matches USDA's measured values at the six
 * anchor records. `calibrated: false` returns the pure Choi-Okos result.
 */
export function creamDensity({ fatPercent, temperatureC = 20, calibrated = true }, model) {
  const modelled = density(dairyComposition(fatPercent, model), temperatureC);
  return calibrated ? modelled * calibrationRatio(fatPercent, model) : modelled;
}

/** Fat range (percent) covered by the anchor records. */
export function dairyFatRange(model) {
  const [lo, hi] = model.fatRange;
  return [lo * 100, hi * 100];
}
