import { type ResumeContent, validateResume } from '@career/schema'
import type { CareerDocument, ResumeRecord } from '../shared'
import { seedDocuments, seededResume } from './seed'

interface DocumentDbRow {
  id: string
  title: string
  kind: string
  visibility: string
  tags_json: string
  body_markdown: string
  revision: number
  created_at: string
  updated_at: string
}

interface ResumeDbRow {
  id: string
  title: string
  data_json: string
  is_canonical: number
  revision: number
  published_commit: string | null
  published_at: string | null
  created_at: string
  updated_at: string
}

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string')

const parseTags = (value: string): string[] => {
  try {
    const parsed: unknown = JSON.parse(value)
    return isStringArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

const mapDocument = (row: DocumentDbRow): CareerDocument => ({
  id: row.id,
  title: row.title,
  kind: row.kind === 'inbox' ? 'inbox' : 'note',
  visibility:
    row.visibility === 'public' || row.visibility === 'shareable' ? row.visibility : 'private',
  tags: parseTags(row.tags_json),
  bodyMarkdown: row.body_markdown,
  revision: row.revision,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const parseResumeJson = (value: string): ResumeContent => {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error('Stored resume JSON is malformed')
  }
  const result = validateResume(parsed)
  if (!result.data || result.errors.length > 0) {
    throw new Error(`Stored resume is invalid: ${result.errors.join(', ')}`)
  }
  return result.data
}

const mapResume = (row: ResumeDbRow): ResumeRecord => ({
  id: row.id,
  title: row.title,
  data: parseResumeJson(row.data_json),
  isCanonical: row.is_canonical === 1,
  revision: row.revision,
  publishedCommit: row.published_commit ?? undefined,
  publishedAt: row.published_at ?? undefined,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const normalizeStoredResumes = async (env: Env): Promise<void> => {
  const result = await env.DB.prepare('SELECT id, data_json FROM resumes').all<
    Pick<ResumeDbRow, 'id' | 'data_json'>
  >()
  const updates = result.results.flatMap((row) => {
    const normalized = JSON.stringify(parseResumeJson(row.data_json))
    if (normalized === row.data_json) return []
    return [
      env.DB.prepare('UPDATE resumes SET data_json = ? WHERE id = ? AND data_json = ?').bind(
        normalized,
        row.id,
        row.data_json
      ),
    ]
  })
  if (updates.length > 0) await env.DB.batch(updates)
}

export async function ensureSeeded(env: Env): Promise<void> {
  const existing = await env.DB.prepare('SELECT id FROM resumes LIMIT 1').first('id')
  if (existing) {
    await normalizeStoredResumes(env)
    return
  }

  const now = new Date().toISOString()
  const statements = [
    env.DB.prepare(
      `INSERT OR IGNORE INTO resumes
        (id, title, data_json, is_canonical, revision, created_at, updated_at)
       VALUES (?, ?, ?, 1, 1, ?, ?)`
    ).bind('resume-canonical', 'Canonical résumé', JSON.stringify(seededResume), now, now),
    ...seedDocuments.map((document) =>
      env.DB.prepare(
        `INSERT OR IGNORE INTO documents
          (id, title, kind, visibility, tags_json, body_markdown, revision, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`
      ).bind(
        document.id,
        document.title,
        document.kind,
        document.visibility,
        JSON.stringify(document.tags),
        document.bodyMarkdown,
        now,
        now
      )
    ),
  ]
  await env.DB.batch(statements)
}

export async function listDocuments(env: Env): Promise<CareerDocument[]> {
  const result = await env.DB.prepare(
    `SELECT id, title, kind, visibility, tags_json, body_markdown, revision, created_at, updated_at
     FROM documents WHERE archived = 0 ORDER BY updated_at DESC`
  ).all<DocumentDbRow>()
  return result.results.map(mapDocument)
}

export async function listResumes(env: Env): Promise<ResumeRecord[]> {
  const result = await env.DB.prepare(
    `SELECT id, title, data_json, is_canonical, revision, published_commit, published_at,
            created_at, updated_at
     FROM resumes ORDER BY is_canonical DESC, updated_at DESC`
  ).all<ResumeDbRow>()
  return result.results.map(mapResume)
}

export async function getResume(env: Env, id: string): Promise<ResumeRecord | null> {
  const row = await env.DB.prepare(
    `SELECT id, title, data_json, is_canonical, revision, published_commit, published_at,
            created_at, updated_at
     FROM resumes WHERE id = ?`
  )
    .bind(id)
    .first<ResumeDbRow>()
  return row ? mapResume(row) : null
}

export async function createDocument(
  env: Env,
  input: Pick<CareerDocument, 'title' | 'kind' | 'visibility' | 'tags' | 'bodyMarkdown'>
): Promise<CareerDocument> {
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  await env.DB.prepare(
    `INSERT INTO documents
      (id, title, kind, visibility, tags_json, body_markdown, revision, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`
  )
    .bind(
      id,
      input.title,
      input.kind,
      input.visibility,
      JSON.stringify(input.tags),
      input.bodyMarkdown,
      now,
      now
    )
    .run()
  return { ...input, id, revision: 1, createdAt: now, updatedAt: now }
}

export async function updateDocument(env: Env, document: CareerDocument): Promise<CareerDocument> {
  const now = new Date().toISOString()
  const result = await env.DB.prepare(
    `UPDATE documents
     SET title = ?, kind = ?, visibility = ?, tags_json = ?, body_markdown = ?,
         revision = revision + 1, updated_at = ?
     WHERE id = ? AND archived = 0`
  )
    .bind(
      document.title,
      document.kind,
      document.visibility,
      JSON.stringify(document.tags),
      document.bodyMarkdown,
      now,
      document.id
    )
    .run()
  if (result.meta.changes !== 1) throw new Error('Document not found')
  return { ...document, revision: document.revision + 1, updatedAt: now }
}

export async function archiveDocument(env: Env, id: string): Promise<void> {
  const result = await env.DB.prepare(
    'UPDATE documents SET archived = 1, revision = revision + 1, updated_at = ? WHERE id = ?'
  )
    .bind(new Date().toISOString(), id)
    .run()
  if (result.meta.changes !== 1) throw new Error('Document not found')
}

export async function updateResume(
  env: Env,
  id: string,
  title: string,
  data: ResumeContent
): Promise<ResumeRecord> {
  const now = new Date().toISOString()
  const result = await env.DB.prepare(
    `UPDATE resumes SET title = ?, data_json = ?, revision = revision + 1, updated_at = ?
     WHERE id = ?`
  )
    .bind(title, JSON.stringify(data), now, id)
    .run()
  if (result.meta.changes !== 1) throw new Error('Resume not found')
  const updated = await getResume(env, id)
  if (!updated) throw new Error('Resume disappeared after update')
  return updated
}

export async function cloneResume(env: Env, sourceId: string): Promise<ResumeRecord> {
  const source = await getResume(env, sourceId)
  if (!source) throw new Error('Resume not found')
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  const title = `${source.title.replace(/ \(copy(?: \d+)?\)$/, '')} (copy)`
  await env.DB.prepare(
    `INSERT INTO resumes
      (id, title, data_json, is_canonical, revision, created_at, updated_at)
     VALUES (?, ?, ?, 0, 1, ?, ?)`
  )
    .bind(id, title, JSON.stringify(source.data), now, now)
    .run()
  const clone = await getResume(env, id)
  if (!clone) throw new Error('Resume clone was not created')
  return clone
}

export async function recordPublish(
  env: Env,
  resumeId: string,
  commitSha: string,
  commitUrl: string
): Promise<string> {
  const now = new Date().toISOString()
  await env.DB.batch([
    env.DB.prepare(
      'UPDATE resumes SET published_commit = ?, published_at = ?, updated_at = ? WHERE id = ?'
    ).bind(commitSha, now, now, resumeId),
    env.DB.prepare(
      `INSERT INTO publish_events (id, resume_id, commit_sha, commit_url, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(crypto.randomUUID(), resumeId, commitSha, commitUrl, now),
  ])
  return now
}
