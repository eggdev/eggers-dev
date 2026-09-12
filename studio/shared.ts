import type { ResumeContent } from '@career/schema'

export const documentKinds = ['inbox', 'note'] as const
export type DocumentKind = (typeof documentKinds)[number]

export const documentVisibilities = ['private', 'shareable', 'public'] as const
export type DocumentVisibility = (typeof documentVisibilities)[number]

export interface CareerDocument {
  id: string
  title: string
  kind: DocumentKind
  visibility: DocumentVisibility
  tags: string[]
  bodyMarkdown: string
  revision: number
  createdAt: string
  updatedAt: string
}

export interface ResumeRecord {
  id: string
  title: string
  data: ResumeContent
  isCanonical: boolean
  revision: number
  publishedCommit?: string
  publishedAt?: string
  createdAt: string
  updatedAt: string
}

export interface BootstrapPayload {
  identity: { email: string; local: boolean }
  documents: CareerDocument[]
  resumes: ResumeRecord[]
}

export interface PublishResult {
  commitSha: string
  commitUrl: string
  publishedAt: string
}

export interface ApiErrorPayload {
  error: string
  details?: string[]
}
