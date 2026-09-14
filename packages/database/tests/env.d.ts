declare namespace Cloudflare {
  interface Env {
    DB: D1Database
    PUBLIC_CONTENT: KVNamespace
    TEST_MIGRATIONS: Array<{ name: string; queries: string[] }>
  }
}
