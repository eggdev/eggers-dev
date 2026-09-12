// Standard Worker secrets are intentionally absent from wrangler.jsonc.
// This declaration augments Wrangler's generated Env without duplicating binding types.
interface Env {
  GITHUB_PRIVATE_KEY?: string
}
