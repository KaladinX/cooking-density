// Egg sizes and edible weight. Data: data/egg-sizes.json (standards, shell fraction)
// and data/measurements.json (community measurements), both passed in as loaders.

/**
 * `loadSizes` returns the parsed egg-sizes.json; `loadMeasurements` returns the
 * `measurements` array. Each is called once, on first use.
 */
export function createEggs(loadSizes, loadMeasurements) {
  /** The egg size standards and shell fraction, as stored in data/egg-sizes.json. */
  const eggSizes = loadSizes;

  /** Community measurements, as stored in data/measurements.json. */
  const measurements = loadMeasurements;

  /**
   * Edible grams (white, yolk) from the weight of a whole egg in its shell, using the
   * USDA SR refuse figure for eggs (12 percent shell). One national average:
   * an individual egg's shell share varies.
   */
  function edibleGramsFromShell(gramsInShell) {
    if (!(gramsInShell > 0)) throw new Error('gramsInShell must be a positive number');
    return gramsInShell * eggSizes().shell.edibleFraction;
  }

  /** In-shell grams from edible grams: the inverse of edibleGramsFromShell. */
  function shellGramsFromEdible(edibleGrams) {
    if (!(edibleGrams > 0)) throw new Error('edibleGrams must be a positive number');
    return edibleGrams / eggSizes().shell.edibleFraction;
  }

  /**
   * Which size class an in-shell egg weight falls in under a standard
   * ('us', 'ca' or 'eu'). Returns the class object or null if the weight is
   * below every class. US classes use per-dozen averages, so an individual egg
   * in the overlap just under a class minimum can still be graded into it
   * (see minIndividualGramsPerEgg); this function uses the class average range.
   */
  function classifyEgg(gramsInShell, standard = 'us') {
    const std = eggSizes().standards.find((s) => s.id === standard);
    if (!std) throw new Error(`Unknown egg standard "${standard}". Available: ${eggSizes().standards.map((s) => s.id).join(', ')}`);
    for (const c of std.classes) {
      const aboveMin = c.minGramsPerEgg === null || gramsInShell >= c.minGramsPerEgg;
      const belowMax = c.maxGramsPerEggExclusive === null || gramsInShell < c.maxGramsPerEggExclusive;
      if (aboveMin && belowMax) return c;
    }
    return null;
  }

  return { eggSizes, measurements, edibleGramsFromShell, shellGramsFromEdible, classifyEgg };
}
