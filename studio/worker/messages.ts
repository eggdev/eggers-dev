// What the caller sees, in one place for the Worker (studio.ts) and the Durable Object (backend.ts).
// None of these says why a sign-in was refused, and none holds data or a secret.
export const MESSAGES = {
  notConfigured: "The studio's sign-in is not set up, so the studio is closed.",
  forbidden: 'Sign in at https://studio.eggers.dev to use the studio.',
  serverDown: "The studio's server is not running. Start it on the machine that holds the data.",
  method: 'Use GET or HEAD.',
  routesUnreadable: "The studio's pages are not ready. Try again in a moment.",
  starting: "The studio's server is starting. Try again in a moment.",
  containerDown: "The studio's server is not answering. Try again in a moment.",
  containerFailed: "The studio's server could not start:",
  notRunning: 'The container is not running, so there is nothing to back up.',
  backendUnknown: "The studio's backend setting (STUDIO_BACKEND) is not one it knows.",
  notFound: 'There is no such studio control.',
  tunnelOnly: 'The studio runs on the tunnel backend (STUDIO_BACKEND=tunnel), which has no container or backups.',
} as const;
