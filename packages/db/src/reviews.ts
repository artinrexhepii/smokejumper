import { eq } from 'drizzle-orm'
import type { Db } from './db.ts'
import { incidentReviews, type IncidentReview, type ReviewBody } from './schema.ts'

export async function createReview(
  db: Db,
  input: { incidentId: string; generated: ReviewBody },
): Promise<IncidentReview> {
  const [review] = await db.insert(incidentReviews).values(input).returning()
  return review!
}

export async function getReviewByIncident(db: Db, incidentId: string): Promise<IncidentReview | undefined> {
  const [review] = await db.select().from(incidentReviews).where(eq(incidentReviews.incidentId, incidentId))
  return review
}

export async function updateReview(db: Db, incidentId: string, edited: ReviewBody): Promise<void> {
  await db
    .update(incidentReviews)
    .set({ edited, updatedAt: new Date() })
    .where(eq(incidentReviews.incidentId, incidentId))
}

export async function approveReview(db: Db, incidentId: string, approvedBy: string): Promise<void> {
  await db
    .update(incidentReviews)
    .set({ status: 'approved', approvedBy, approvedAt: new Date(), updatedAt: new Date() })
    .where(eq(incidentReviews.incidentId, incidentId))
}

export async function upsertGenerated(
  db: Db,
  incidentId: string,
  generated: ReviewBody,
): Promise<IncidentReview> {
  const existing = await getReviewByIncident(db, incidentId)
  if (!existing) return createReview(db, { incidentId, generated })
  const [review] = await db
    .update(incidentReviews)
    .set({ generated, updatedAt: new Date() })
    .where(eq(incidentReviews.incidentId, incidentId))
    .returning()
  return review!
}
