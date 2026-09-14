import type {
  ApiErrorPayload,
  AppPreferences,
  BootstrapPayload,
  Destination,
  DestinationPlanningUpdate,
  ResearchEntry,
  ResearchEntryInput,
} from '@repo/home'

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details: ReadonlyArray<string> = []
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
  updateDestination: (id: string, update: DestinationPlanningUpdate) =>
    request<Destination>(`/api/destinations/${encodeURIComponent(id)}/planning`, {
      method: 'PUT',
      body: JSON.stringify(update),
    }),
  createResearch: (entry: ResearchEntryInput) =>
    request<ResearchEntry>('/api/research', {
      method: 'POST',
      body: JSON.stringify(entry),
    }),
  savePreferences: (preferences: AppPreferences) =>
    request<AppPreferences>('/api/preferences', {
      method: 'PUT',
      body: JSON.stringify(preferences),
    }),
}
