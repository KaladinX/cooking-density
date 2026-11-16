// The dairy model bound to data/dairy-model.json, read from disk. Node only:
// the build script and tests use this. The maths lives in dairy-model.mjs.
import { readFileSync } from 'node:fs';
import * as pure from './dairy-model.mjs';

export { fitDairyModel } from './dairy-model.mjs';

let cached;
function loadModel() {
  cached ??= JSON.parse(readFileSync(new URL('../../data/dairy-model.json', import.meta.url), 'utf8'));
  return cached;
}

export const dairyComposition = (fatPercent, model = loadModel()) => pure.dairyComposition(fatPercent, model);
export const calibrationRatio = (fatPercent, model = loadModel()) => pure.calibrationRatio(fatPercent, model);
export const creamDensity = (options, model = loadModel()) => pure.creamDensity(options, model);
export const dairyFatRange = (model = loadModel()) => pure.dairyFatRange(model);
