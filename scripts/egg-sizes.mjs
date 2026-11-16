// Egg size classes and the shell fraction. Every number here is copied from a
// standard or a USDA table named in `citation`; derived figures (grams per egg
// from ounces per dozen) are computed, not typed.
const OUNCE_G = 28.349523125; // data/units.json, mass:oz
const r2 = (x) => Math.round(x * 100) / 100;

const US_ROWS = [
  // name, minimum net ounces per dozen, minimum for individual eggs at the dozen rate (ounces)
  ['Jumbo', 30, 29],
  ['Extra large', 27, 26],
  ['Large', 24, 23],
  ['Medium', 21, 20],
  ['Small', 18, 17],
  ['Peewee', 15, null],
];

function usClasses() {
  return US_ROWS.map(([name, perDozenOz, individualOz], i) => {
    const larger = i === 0 ? null : US_ROWS[i - 1][1];
    return {
      name,
      minOuncesPerDozen: perDozenOz,
      minIndividualOuncesPerDozenRate: individualOz,
      minGramsPerEgg: r2((perDozenOz / 12) * OUNCE_G),
      minIndividualGramsPerEgg: individualOz === null ? null : r2((individualOz / 12) * OUNCE_G),
      maxGramsPerEggExclusive: larger === null ? null : r2((larger / 12) * OUNCE_G),
    };
  });
}

function perEggClasses(rows) {
  // rows: [name, minGrams|null], largest first. Max is the next larger class's minimum.
  return rows.map(([name, min], i) => ({
    name,
    minGramsPerEgg: min,
    maxGramsPerEggExclusive: i === 0 ? null : rows[i - 1][1],
  }));
}

export function buildEggSizes() {
  return {
    schemaVersion: 1,
    note: 'Sizes are for eggs in the shell. USDA SR Legacy count portions (large 50 g and so on) are edible weights without the shell.',
    shell: {
      description: 'Shell',
      refusePercent: 12,
      edibleFraction: 0.88,
      appliesTo: { fdcId: 171287, ndbNumber: 1123, usdaDescription: 'Egg, whole, raw, fresh' },
      citation: {
        title: 'USDA National Nutrient Database for Standard Reference, Release 28, FOOD_DES.txt: NDB 01123 "Egg, whole, raw, fresh", Ref_Desc "Shell", Refuse 12 (percent)',
        url: 'https://www.ars.usda.gov/ARSUserFiles/80400525/Data/SR/SR28/dnload/sr28asc.zip',
      },
      note: 'One national figure. Shell share varies with hen age, breed and egg size, and is not measured per egg here.',
    },
    standards: [
      {
        id: 'us',
        name: 'United States (USDA consumer grades)',
        basis: 'minimum net weight per dozen; per-egg figures are that weight divided by 12',
        citation: {
          title: 'United States Standards, Grades, and Weight Classes for Shell Eggs, AMS 56, effective July 20, 2000, section 56.218 (Weight classes), Table I',
          url: 'https://www.ams.usda.gov/sites/default/files/media/Shell_Egg_Standard%5B1%5D.pdf',
        },
        derivation: `minGramsPerEgg = ounces per dozen / 12 x ${OUNCE_G} g; maxGramsPerEggExclusive is the minimum of the next larger class`,
        classes: usClasses(),
      },
      {
        id: 'ca',
        name: 'Canada (Canada A)',
        basis: 'minimum weight of each egg',
        citation: {
          title: 'Canadian Grade Compendium, Volume 5 - Eggs, section 5, Table for Size Designations for Canada A Eggs (CFIA)',
          url: 'https://inspection.canada.ca/en/about-cfia/acts-and-regulations/list-acts-and-regulations/documents-incorporated-reference/canadian-grade-compendium-volume-5',
        },
        derivation: 'Column 2, "Egg weighs not less than". Peewee is read as under 42 g: the page text does not show which column holds its 42 g.',
        classes: perEggClasses([['Jumbo', 70], ['Extra large', 63], ['Large', 56], ['Medium', 49], ['Small', 42], ['Peewee', null]]),
      },
      {
        id: 'eu',
        name: 'European Union (Class A)',
        basis: 'weight of each egg',
        citation: {
          title: 'Commission Regulation (EC) No 589/2008, Article 4: Grading of Class A eggs by weight',
          url: 'https://www.legislation.gov.uk/eur/2008/589/data.html',
        },
        derivation: 'XL 73 g or more; L 63 g or more and under 73 g; M 53 g or more and under 63 g; S under 53 g. The URL is the legislation.gov.uk copy that was read.',
        classes: perEggClasses([['XL', 73], ['L', 63], ['M', 53], ['S', null]]),
      },
    ],
    notAvailable: [
      {
        id: 'au',
        reason: 'No Australian size standard could be found and read. Secondary pages quote ranges, but the Australian Eggs labelling guide itself was not reached, so none are included.',
      },
    ],
  };
}
