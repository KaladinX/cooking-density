// The unit helpers bound to data/units.json, read from disk. Node only: the
// build scripts and tests use this. Browser code goes through src/core.mjs.
import { readFileSync } from 'node:fs';
import { createUnits } from './core/units.mjs';

export { toMl, fromMl, toGramsMass, convertUnit } from './core/units.mjs';

const table = JSON.parse(
  readFileSync(new URL('../data/units.json', import.meta.url), 'utf8'),
);

export const { units, getUnit, parseUnit } = createUnits(table);
