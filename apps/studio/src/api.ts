import type { CmsBootstrap, CmsDraft } from '@repo/cms'
import type { PublicSiteContent } from '@repo/content'

interface ErrorPayload {
  error?: string
  details?: ReadonlyArray<string>
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly details: ReadonlyArray<string> = []
  ) {
    super(message)
  }
}

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ErrorPayload
    throw new ApiError(body.error ?? `Request failed (${response.status})`, body.details ?? [])
  }
  return (await response.json()) as T
}

export const api = {
  bootstrap: () => request<CmsBootstrap>('/api/bootstrap'),
  saveDraft: (content: PublicSiteContent, revision: number) =>
    request<CmsDraft>('/api/site-draft', {
      method: 'PUT',
      body: JSON.stringify({ content, revision }),
    }),
  preview: () =>
    request<{ id: string; url: string; expiresInSeconds: number }>('/api/preview', {
      method: 'POST',
    }),
  publish: () =>
    request<{ revision: number; publishedAt: string; publishedBy: string }>('/api/publish', {
      method: 'POST',
    }),
}
