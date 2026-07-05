import { z } from 'zod'
import type { PluginManifest } from './manifest'

export type ConfigFieldType = 'string' | 'number' | 'boolean' | 'url' | 'enum'

export interface ConfigFieldDescriptor {
  key: string
  type: ConfigFieldType
  required: boolean
  secret: boolean
  description?: string
  default?: string | number | boolean
  enumValues?: string[]
}

export interface ConfigDescriptor {
  config: ConfigFieldDescriptor[]
  credentials: ConfigFieldDescriptor[]
}

function describeField(key: string, schema: z.ZodTypeAny, secret: boolean): ConfigFieldDescriptor {
  let current: z.ZodTypeAny = schema
  let required = true
  let description = current._def.description
  let defaultValue: string | number | boolean | undefined

  while (current instanceof z.ZodOptional || current instanceof z.ZodDefault) {
    required = false
    if (current instanceof z.ZodDefault) {
      const value = current._def.defaultValue()
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        defaultValue = value
      }
    }
    current = current._def.innerType
    if (!description) description = current._def.description
  }

  let type: ConfigFieldType
  let enumValues: string[] | undefined
  if (current instanceof z.ZodString) {
    type = current._def.checks.some((check) => check.kind === 'url') ? 'url' : 'string'
  } else if (current instanceof z.ZodNumber) {
    type = 'number'
  } else if (current instanceof z.ZodBoolean) {
    type = 'boolean'
  } else if (current instanceof z.ZodEnum) {
    type = 'enum'
    enumValues = [...current._def.values]
  } else {
    throw new Error(`describeConfig: unsupported field "${key}" (${current.constructor.name})`)
  }

  return {
    key,
    type,
    required,
    secret,
    ...(description ? { description } : {}),
    ...(defaultValue !== undefined ? { default: defaultValue } : {}),
    ...(enumValues ? { enumValues } : {}),
  }
}

function describeObject(schema: z.ZodTypeAny, secret: boolean): ConfigFieldDescriptor[] {
  if (!(schema instanceof z.ZodObject)) {
    throw new Error('describeConfig: schema must be a top-level ZodObject')
  }
  const shape = schema.shape as Record<string, z.ZodTypeAny>
  return Object.entries(shape).map(([key, field]) => describeField(key, field, secret))
}

export function describeConfig(manifest: PluginManifest): ConfigDescriptor {
  return {
    config: describeObject(manifest.configSchema, false),
    credentials: manifest.credentialSchema ? describeObject(manifest.credentialSchema, true) : [],
  }
}
