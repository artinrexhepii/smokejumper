import { z } from 'zod'

export function exampleFromSchema(schema: z.ZodTypeAny): unknown {
  if (schema instanceof z.ZodDefault) {
    return schema._def.defaultValue()
  }
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
    return exampleFromSchema(schema.unwrap())
  }
  if (schema instanceof z.ZodEffects) {
    return exampleFromSchema(schema.innerType())
  }
  if (schema instanceof z.ZodObject) {
    const example: Record<string, unknown> = {}
    for (const [key, field] of Object.entries(schema.shape as Record<string, z.ZodTypeAny>)) {
      if (field instanceof z.ZodOptional) continue
      example[key] = exampleFromSchema(field)
    }
    return example
  }
  if (schema instanceof z.ZodString) {
    const checks = schema._def.checks
    if (checks.some((check) => check.kind === 'url')) return 'https://example.com'
    const min = checks.find((check): check is Extract<z.ZodStringCheck, { kind: 'min' }> => check.kind === 'min')
    const base = 'example'
    return min && min.value > base.length ? base.padEnd(min.value, 'x') : base
  }
  if (schema instanceof z.ZodNumber) {
    return schema.minValue ?? 1
  }
  if (schema instanceof z.ZodBoolean) return false
  if (schema instanceof z.ZodEnum) return schema.options[0]
  if (schema instanceof z.ZodLiteral) return schema.value
  if (schema instanceof z.ZodArray) return []
  if (schema instanceof z.ZodRecord) return {}
  if (schema instanceof z.ZodUnion) {
    return exampleFromSchema((schema.options as z.ZodTypeAny[])[0]!)
  }
  return null
}
