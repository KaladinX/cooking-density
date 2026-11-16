// A small JSON Schema validator for the keywords our schemas use. No dependencies.
// Supported: type (incl. integer), enum, const, required, properties,
// additionalProperties (false or a schema), items, minItems, minimum,
// exclusiveMinimum, maximum, exclusiveMaximum, pattern, minLength, oneOf, anyOf,
// $ref to "#/$defs/name". Unknown keywords are ignored, except that this file
// throws on keywords it knows it cannot honour (allOf, not, if) so a schema
// cannot silently pass.
const UNSUPPORTED = ['allOf', 'not', 'if', 'then', 'else', 'patternProperties', 'dependentRequired', 'uniqueItems'];

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function matchesType(v, type) {
  const t = typeOf(v);
  if (type === 'integer') return t === 'number' && Number.isInteger(v);
  return t === type;
}

/** Returns an array of error strings; empty means valid. Stops after `limit` errors. */
export function validate(value, schema, root = schema, path = '$', limit = 20) {
  const errors = [];
  const fail = (msg) => { if (errors.length < limit) errors.push(`${path}: ${msg}`); };

  for (const k of UNSUPPORTED) if (k in schema) throw new Error(`Unsupported schema keyword ${k}`);

  if (schema.$ref) {
    const name = schema.$ref.replace('#/$defs/', '');
    const target = root.$defs?.[name];
    if (!target) throw new Error(`Unresolved $ref ${schema.$ref}`);
    return validate(value, target, root, path, limit);
  }
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => matchesType(value, t))) {
      fail(`expected ${types.join(' or ')}, got ${typeOf(value)}`);
      return errors;
    }
  }
  if ('const' in schema && value !== schema.const) fail(`expected ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(value)) fail(`${JSON.stringify(value)} not in enum`);
  if (typeof value === 'number') {
    if ('minimum' in schema && value < schema.minimum) fail(`${value} < minimum ${schema.minimum}`);
    if ('exclusiveMinimum' in schema && value <= schema.exclusiveMinimum) fail(`${value} <= ${schema.exclusiveMinimum}`);
    if ('maximum' in schema && value > schema.maximum) fail(`${value} > maximum ${schema.maximum}`);
    if ('exclusiveMaximum' in schema && value >= schema.exclusiveMaximum) fail(`${value} >= ${schema.exclusiveMaximum}`);
  }
  if (typeof value === 'string') {
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) fail(`${JSON.stringify(value)} does not match ${schema.pattern}`);
    if ('minLength' in schema && value.length < schema.minLength) fail('string too short');
  }
  if (Array.isArray(value)) {
    if ('minItems' in schema && value.length < schema.minItems) fail(`fewer than ${schema.minItems} items`);
    if (schema.items) {
      for (let i = 0; i < value.length && errors.length < limit; i++) {
        errors.push(...validate(value[i], schema.items, root, `${path}[${i}]`, limit - errors.length));
      }
    }
  }
  if (typeOf(value) === 'object') {
    for (const key of schema.required ?? []) if (!(key in value)) fail(`missing required property "${key}"`);
    const props = schema.properties ?? {};
    for (const [key, sub] of Object.entries(props)) {
      if (key in value && errors.length < limit) errors.push(...validate(value[key], sub, root, `${path}.${key}`, limit - errors.length));
    }
    if (schema.additionalProperties !== undefined) {
      for (const key of Object.keys(value)) {
        if (key in props) continue;
        if (schema.additionalProperties === false) fail(`unexpected property "${key}"`);
        else if (typeof schema.additionalProperties === 'object' && errors.length < limit) {
          errors.push(...validate(value[key], schema.additionalProperties, root, `${path}.${key}`, limit - errors.length));
        }
      }
    }
  }
  if (schema.oneOf) {
    const passing = schema.oneOf.filter((s) => validate(value, s, root, path, 1).length === 0).length;
    if (passing !== 1) fail(`matched ${passing} of ${schema.oneOf.length} oneOf branches (need exactly 1)`);
  }
  if (schema.anyOf) {
    if (!schema.anyOf.some((s) => validate(value, s, root, path, 1).length === 0)) fail('matched no anyOf branch');
  }
  return errors.slice(0, limit);
}
