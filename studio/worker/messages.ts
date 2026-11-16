// What the caller sees, in one place for the Worker (studio.ts, publish.ts) and the Durable Object (backend.ts).
// None of these says why a sign-in was refused, and none holds data or a secret.
export const MESSAGES = {
  notConfigured: "The studio's sign-in is not set up, so the studio is closed.",
  forbidden: 'Sign in at https://studio.eggers.dev to use the studio.',
  method: 'Use GET or HEAD.',
  routesUnreadable: "The studio's pages are not ready. Try again in a moment.",
  starting: "The studio's server is starting. Try again in a moment.",
  containerDown: "The studio's server is not answering. Try again in a moment.",
  containerFailed: "The studio's server could not start:",
  notRunning: 'The container is not running, so there is nothing to back up.',
  notFound: 'There is no such studio control.',

  // The public collection (publish.ts).
  publishOff: "The public collection's buckets are not set up, so nothing can be published.",
  publishBody: 'Send the sha256 of the saved text you reviewed.',
  savedUnreadable: "The saved text could not be read from the studio's server. Nothing was published.",
  nothingSaved: 'There is no saved text to publish. Save the text first.',
  savedChanged: 'The saved text changed after you reviewed it. Review it again.',
  checksum: 'The saved text does not match its checksum. Save it again, then review it. Nothing was published.',
  emptyText: 'The saved text is empty. Nothing was published.',
  tooLong: 'The saved text is longer than 120,000 characters. Shorten it, then publish it.',
  bucketFailed: "The public collection's bucket did not answer. Try again in a moment.",
} as const;
