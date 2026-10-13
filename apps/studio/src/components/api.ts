export async function api<T = any>(action: string, input: unknown = {}): Promise<T> {
  const response = await fetch(`/api/studio/${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? 'Something went wrong.');
  return data;
}
