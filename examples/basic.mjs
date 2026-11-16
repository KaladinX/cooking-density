// Run with: node examples/basic.mjs
import { toGrams, toVolume } from '../src/index.mjs';

const g = (r) => `${r.value.toFixed(1)} g`;

console.log('1 US cup all-purpose flour    ->', g(toGrams({ ingredient: 'all-purpose flour', amount: 1, unit: 'cup' })));
console.log('1 US tbsp baking soda         ->', g(toGrams({ ingredient: 'baking soda', amount: 1, unit: 'tbsp' })));
console.log('1 US cup water                ->', g(toGrams({ ingredient: 'water', amount: 1, unit: 'cup' })));
console.log('3 US cups 30% MF cream        ->', g(toGrams({ ingredient: '30% cream', amount: 3, unit: 'cups' })));

const sugar = toVolume({ ingredient: 'granulated sugar', amount: 250, unit: 'g', to: 'cup' });
console.log('250 g granulated sugar        ->', `${sugar.value.toFixed(2)} US cups`);

const packed = toGrams({ ingredient: 'brown sugar', amount: 1, unit: 'cup', form: 'packed' });
const loose = toGrams({ ingredient: 'brown sugar', amount: 1, unit: 'cup', form: 'unpacked' });
console.log('1 cup brown sugar, packed     ->', g(packed));
console.log('1 cup brown sugar, unpacked   ->', g(loose));

// Every result says where the density came from.
const flour = toGrams({ ingredient: 'plain flour', amount: 2, unit: 'metric cup' });
console.log('\n2 metric cups plain flour:', g(flour));
console.log('  density', flour.densityGPerMl, 'g/mL from', flour.source);
console.log('  warnings', flour.warnings);
