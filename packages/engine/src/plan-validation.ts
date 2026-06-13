import type { PlanResult } from './driver'

export interface ValidatedPlan {
  specialists: PlanResult['specialists']
  warnings: string[]
}

export function validatePlan(plan: PlanResult, availableTools: ReadonlySet<string>): ValidatedPlan {
  const warnings: string[] = []
  const seen = new Set<string>()
  const specialists: PlanResult['specialists'] = []
  for (const spec of plan.specialists) {
    if (seen.has(spec.name)) {
      warnings.push(`specialist ${spec.name} listed twice — keeping the first entry`)
      continue
    }
    seen.add(spec.name)
    const toolNames = spec.toolNames.filter((name) => {
      if (availableTools.has(name)) return true
      warnings.push(`specialist ${spec.name} requested unknown tool "${name}" — dropped`)
      return false
    })
    specialists.push({ ...spec, toolNames })
  }
  return { specialists, warnings }
}
