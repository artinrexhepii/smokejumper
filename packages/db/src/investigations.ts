import { asc, desc, eq } from 'drizzle-orm'
import type { Db } from './db.ts'
import { canonicalJson, sha256hex } from './hash.ts'
import {
  diagnoses,
  evidenceRecords,
  findings,
  investigations,
  type Diagnosis,
  type EvidenceChainClaim,
  type EvidenceRecord,
  type Finding,
  type Investigation,
  type InvestigationBudget,
} from './schema.ts'

export async function createInvestigation(
  db: Db,
  input: { incidentId: string; budget: InvestigationBudget },
): Promise<Investigation> {
  const [investigation] = await db.insert(investigations).values(input).returning()
  return investigation!
}

export async function getInvestigation(db: Db, id: string): Promise<Investigation | undefined> {
  const [investigation] = await db.select().from(investigations).where(eq(investigations.id, id))
  return investigation
}

export async function completeInvestigation(
  db: Db,
  investigationId: string,
  input: { status: 'completed' | 'failed' | 'budget_exceeded'; stats: Record<string, unknown> },
): Promise<void> {
  await db
    .update(investigations)
    .set({ status: input.status, stats: input.stats, completedAt: new Date() })
    .where(eq(investigations.id, investigationId))
}

export async function appendEvidence(
  db: Db,
  entry: { investigationId: string; toolName: string; input: unknown; output: unknown; summary: string },
): Promise<EvidenceRecord> {
  return db.transaction(async (tx) => {
    await tx
      .select({ id: investigations.id })
      .from(investigations)
      .where(eq(investigations.id, entry.investigationId))
      .for('update')
    const [last] = await tx
      .select()
      .from(evidenceRecords)
      .where(eq(evidenceRecords.investigationId, entry.investigationId))
      .orderBy(desc(evidenceRecords.seq))
      .limit(1)
    const seq = (last?.seq ?? 0) + 1
    const prevHash = last?.hash ?? 'genesis'
    const hash = sha256hex(
      prevHash +
        canonicalJson({
          investigationId: entry.investigationId,
          seq,
          toolName: entry.toolName,
          input: entry.input,
          output: entry.output,
          summary: entry.summary,
        }),
    )
    const [record] = await tx
      .insert(evidenceRecords)
      .values({
        investigationId: entry.investigationId,
        seq,
        toolName: entry.toolName,
        input: entry.input,
        output: entry.output,
        summary: entry.summary,
        prevHash,
        hash,
      })
      .returning()
    return record!
  })
}

export async function listEvidence(db: Db, investigationId: string): Promise<EvidenceRecord[]> {
  return db
    .select()
    .from(evidenceRecords)
    .where(eq(evidenceRecords.investigationId, investigationId))
    .orderBy(asc(evidenceRecords.seq))
}

export async function addFinding(
  db: Db,
  input: { investigationId: string; specialist: string; summary: string; evidenceIds: string[] },
): Promise<Finding> {
  const [finding] = await db.insert(findings).values(input).returning()
  return finding!
}

export async function listFindings(db: Db, investigationId: string): Promise<Finding[]> {
  return db
    .select()
    .from(findings)
    .where(eq(findings.investigationId, investigationId))
    .orderBy(asc(findings.createdAt))
}

export async function createDiagnosis(
  db: Db,
  input: {
    investigationId: string
    rootCause: string
    confidence: number
    evidenceChain: EvidenceChainClaim[]
    remediation: string
    openQuestions: string[]
  },
): Promise<Diagnosis> {
  return db.transaction(async (tx) => {
    await tx
      .select({ id: investigations.id })
      .from(investigations)
      .where(eq(investigations.id, input.investigationId))
      .for('update')
    const [latest] = await tx
      .select()
      .from(diagnoses)
      .where(eq(diagnoses.investigationId, input.investigationId))
      .orderBy(desc(diagnoses.version))
      .limit(1)
    const version = (latest?.version ?? 0) + 1
    const [diagnosis] = await tx
      .insert(diagnoses)
      .values({ ...input, version })
      .returning()
    return diagnosis!
  })
}

export async function getDiagnosis(db: Db, id: string): Promise<Diagnosis | undefined> {
  const [diagnosis] = await db.select().from(diagnoses).where(eq(diagnoses.id, id))
  return diagnosis
}

export async function setDiagnosisVerdict(
  db: Db,
  diagnosisId: string,
  input: { verdict: 'confirmed' | 'rejected' | 'partial'; note?: string },
): Promise<void> {
  await db
    .update(diagnoses)
    .set({ humanVerdict: input.verdict, humanNote: input.note ?? null })
    .where(eq(diagnoses.id, diagnosisId))
}
