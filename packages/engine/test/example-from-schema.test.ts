import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { exampleFromSchema } from '../src/example-from-schema'

describe('exampleFromSchema', () => {
  it('derives minimal objects, skipping optionals and applying defaults', () => {
    const schema = z.object({
      container: z.string(),
      tail: z.number().optional(),
      follow: z.boolean().default(true),
    })
    const example = exampleFromSchema(schema)
    expect(example).toEqual({ container: 'example', follow: true })
    expect(() => schema.parse(example)).not.toThrow()
  })

  it('satisfies scalar constraints', () => {
    expect(exampleFromSchema(z.string())).toBe('example')
    expect(exampleFromSchema(z.string().url())).toBe('https://example.com')
    expect(exampleFromSchema(z.string().min(10))).toHaveLength(10)
    expect(exampleFromSchema(z.number())).toBe(1)
    expect(exampleFromSchema(z.number().min(5))).toBe(5)
    expect(exampleFromSchema(z.boolean())).toBe(false)
    expect(exampleFromSchema(z.enum(['a', 'b']))).toBe('a')
    expect(exampleFromSchema(z.literal('fixed'))).toBe('fixed')
    expect(exampleFromSchema(z.array(z.string()))).toEqual([])
  })

  it('round-trips through parse for every first-party tool input shape', () => {
    const schemas = [
      z.object({ text: z.string() }),
      z.object({ container: z.string(), tail: z.number().optional() }),
      z.object({ url: z.string().url() }),
      z.object({}),
    ]
    for (const schema of schemas) {
      expect(() => schema.parse(exampleFromSchema(schema))).not.toThrow()
    }
  })
})
