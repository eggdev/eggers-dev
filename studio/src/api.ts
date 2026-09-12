import type { ResumeContent } from '@career/schema'
import type {
  ApiErrorPayload,
  BootstrapPayload,
  CareerDocument,
  PublishResult,
  ResumeRecord,
} from '../shared'

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details: string[] = []
  ) {
    super(message)
  }
}

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(path, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json', ...init.headers } : init?.headers,
  })
  const payload: unknown = response.status === 204 ? undefined : await response.json()
  if (!response.ok) {
    const problem = payload as ApiErrorPayload | undefined
    throw new ApiError(problem?.error ?? 'Request failed', response.status, problem?.details)
  }
  return payload as T
}

export const api = {
  bootstrap: () => request<BootstrapPayload>('/api/bootstrap'),
  createDocument: (document: Omit<CareerDocument, 'id' | 'revision' | 'createdAt' | 'updatedAt'>) =>
    request<CareerDocument>('/api/documents', {
      method: 'POST',
      body: JSON.stringify(document),
    }),
  updateDocument: (document: CareerDocument) =>
    request<CareerDocument>(`/api/documents/${encodeURIComponent(document.id)}`, {
      method: 'PUT',
      body: JSON.stringify(document),
    }),
  archiveDocument: (id: string) =>
    request<void>(`/api/documents/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  updateResume: (resume: ResumeRecord) =>
    request<ResumeRecord>(`/api/resumes/${encodeURIComponent(resume.id)}`, {
      method: 'PUT',
      body: JSON.stringify({ title: resume.title, data: resume.data }),
    }),
  cloneResume: (id: string) =>
    request<ResumeRecord>(`/api/resumes/${encodeURIComponent(id)}/clone`, { method: 'POST' }),
  publishResume: (id: string) =>
    request<PublishResult>(`/api/resumes/${encodeURIComponent(id)}/publish`, { method: 'POST' }),
}

export const withResumeData = (resume: ResumeRecord, data: ResumeContent): ResumeRecord => ({
  ...resume,
  data,
})
