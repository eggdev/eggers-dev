import { chatgpt } from 'eve/models/openai';
export function selectModel(id: string) {
  // The local Codex adapter has no AI Gateway context metadata. Use an explicit,
  // conservative working budget so Eve can compact long interviews reliably.
  const modelContextWindowTokens = Number(process.env.EVE_CONTEXT_WINDOW_TOKENS ?? 128_000);
  if (!Number.isSafeInteger(modelContextWindowTokens) || modelContextWindowTokens < 8192)
    throw new Error('EVE_CONTEXT_WINDOW_TOKENS must be an integer of at least 8192.');
  return {
    model:
      process.env.VERCEL || process.env.EVE_MODEL_CONNECTION === 'gateway'
        ? `openai/${id}`
        : chatgpt(id),
    modelContextWindowTokens,
  };
}
