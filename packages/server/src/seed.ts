import {
  addMember,
  createDb,
  createOrganization,
  createProject,
  createUser,
  getOrganizationBySlug,
  getProjectBySlug,
  getUserByEmail,
  runMigrations,
  type Db,
} from '@smokejumper/db'
import { pathToFileURL } from 'node:url'

export async function seed(db: Db): Promise<{ orgId: string; userId: string; projectId: string }> {
  const org =
    (await getOrganizationBySlug(db, 'acme')) ??
    (await createOrganization(db, { name: 'Acme', slug: 'acme' }))
  const user =
    (await getUserByEmail(db, 'admin@example.com')) ??
    (await createUser(db, { email: 'admin@example.com', password: 'smokejumper', name: 'Admin' }))
  await addMember(db, { orgId: org.id, userId: user.id, role: 'owner' })
  const project =
    (await getProjectBySlug(db, org.id, 'demo')) ??
    (await createProject(db, { orgId: org.id, name: 'Demo', slug: 'demo' }))
  return { orgId: org.id, userId: user.id, projectId: project.id }
}

const isMain = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false

if (isMain) {
  const url = process.env.DATABASE_URL ?? 'postgres://smokejumper:smokejumper@localhost:5432/smokejumper'
  const db = createDb(url)
  await runMigrations(db)
  console.log(JSON.stringify(await seed(db)))
  process.exit(0)
}
