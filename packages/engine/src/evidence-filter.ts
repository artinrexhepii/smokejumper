export interface DiagnosisClaim {
  claim: string
  evidenceIds: string[]
  verified: boolean
}

export function filterEvidenceChain(
  chain: Array<{ claim: string; evidenceIds: string[] }>,
  knownIds: ReadonlySet<string>,
): DiagnosisClaim[] {
  return chain.map(({ claim, evidenceIds }) => {
    const surviving = [...new Set(evidenceIds)].filter((id) => knownIds.has(id))
    return { claim, evidenceIds: surviving, verified: surviving.length > 0 }
  })
}
