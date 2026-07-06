/**
 * Minimal, dependency-free JSON-Schema-style validator for LLM structured
 * output. Supports the subset ORION needs: object/array/string/number/integer/
 * boolean/null, required, properties, items, enum, additionalProperties, nullable,
 * minItems. Returns explicit, human-readable errors — never silently accepts.
 */
export interface JsonSchema {
  type: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null';
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: (string | number | boolean)[];
  additionalProperties?: boolean;
  minItems?: number;
  nullable?: boolean;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateJsonSchema(schema: JsonSchema, value: unknown, path = '$'): ValidationResult {
  const errors: string[] = [];
  walk(schema, value, path, errors);
  return { valid: errors.length === 0, errors };
}

/** Parse JSON safely, returning either the value or a validation error. */
export function parseAndValidate<T = unknown>(
  raw: string,
  schema: JsonSchema,
): { ok: true; value: T } | { ok: false; result: ValidationResult } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { ok: false, result: { valid: false, errors: [`Malformed JSON: ${(e as Error).message}`] } };
  }
  const result = validateJsonSchema(schema, parsed);
  if (!result.valid) return { ok: false, result };
  return { ok: true, value: parsed as T };
}

function walk(schema: JsonSchema, value: unknown, path: string, errors: string[]): void {
  if (value === null) {
    if (schema.nullable || schema.type === 'null') return;
    errors.push(`${path}: expected ${schema.type}, got null`);
    return;
  }

  switch (schema.type) {
    case 'object': {
      if (typeof value !== 'object' || Array.isArray(value)) {
        errors.push(`${path}: expected object`);
        return;
      }
      const obj = value as Record<string, unknown>;
      for (const req of schema.required ?? []) {
        if (!(req in obj)) errors.push(`${path}.${req}: required property missing`);
      }
      if (schema.properties) {
        for (const [key, propSchema] of Object.entries(schema.properties)) {
          if (key in obj) walk(propSchema, obj[key], `${path}.${key}`, errors);
        }
      }
      if (schema.additionalProperties === false && schema.properties) {
        const allowed = new Set(Object.keys(schema.properties));
        for (const key of Object.keys(obj)) {
          if (!allowed.has(key)) errors.push(`${path}.${key}: additional property not allowed`);
        }
      }
      break;
    }
    case 'array': {
      if (!Array.isArray(value)) {
        errors.push(`${path}: expected array`);
        return;
      }
      if (schema.minItems !== undefined && value.length < schema.minItems) {
        errors.push(`${path}: expected at least ${schema.minItems} items, got ${value.length}`);
      }
      if (schema.items) value.forEach((item, i) => walk(schema.items!, item, `${path}[${i}]`, errors));
      break;
    }
    case 'string':
      if (typeof value !== 'string') errors.push(`${path}: expected string`);
      else if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: value not in enum [${schema.enum.join(', ')}]`);
      break;
    case 'integer':
      if (typeof value !== 'number' || !Number.isInteger(value)) errors.push(`${path}: expected integer`);
      break;
    case 'number':
      if (typeof value !== 'number' || Number.isNaN(value)) errors.push(`${path}: expected number`);
      break;
    case 'boolean':
      if (typeof value !== 'boolean') errors.push(`${path}: expected boolean`);
      break;
    case 'null':
      if (value !== null) errors.push(`${path}: expected null`);
      break;
  }
}
