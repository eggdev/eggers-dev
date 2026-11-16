// The backup gateway: the only way into the private R2 bucket (binding DATA, bucket eggers-studio-data) from the
// studio's container. The Durable Object routes the container's requests to http://backup.internal here (an outbound
// intercept, studio/worker/index.ts), so the container holds no storage keys. Each container start has its own
// random token, given to this gateway in its props and to the keeper in its environment; a request without it is
// refused. The keeper's side is cloud/lib/store.ts; the object names are in cloud/lib/manifest.ts.
//
//   GET  /index                                  {latest, backups}: the pointer's manifest and every complete backup
//   GET  /object?key=<archive key>               one archive, streamed
//   POST /upload/start?key=<archive key>         body: its manifest. Starts a multipart upload: {uploadId}
//   PUT  /upload/part?key&uploadId&part=<n>      body: one part (at most 100 MiB). {partNumber, etag}
//   POST /upload/finish?key&uploadId             body: {parts, manifest}. Completes it, then writes the manifest
//   POST /upload/abort?key&uploadId
//   POST /commit                                 body: {key}. Writes latest.json, then deletes backups past retention
//
// What the container cannot do here: read or write anything but backups/<time>.tar.gz and their manifests, replace
// an existing backup, write the pointer for a backup that is not complete, or delete anything itself. Deletion
// happens only by the retention rule, after a commit, and never touches the backup the pointer names.
// The bucket also holds public-history/<time>.md, the history copies of the published public collection
// (publish.ts). This gateway lists only backups/, and every key it reads, writes or deletes passes isBackupKey or
// is such a key's manifest or the pointer: a history copy is never listed, restored, counted or deleted here.
// This file has no Cloudflare imports, so `bun test` runs it with a fake bucket.
import { isBackupKey, manifestKey, parseManifest, POINTER, PREFIX, toPrune, type Manifest } from '../../cloud/lib/manifest.ts';

/** The parts of the R2 bucket binding this gateway uses. */
export interface Bucket {
  head(key: string): Promise<{ size: number } | null>;
  get(key: string): Promise<{ size: number; body: ReadableStream; text(): Promise<string> } | null>;
  put(key: string, value: string, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  delete(keys: string | string[]): Promise<void>;
  list(options: { prefix: string; cursor?: string; limit?: number }): Promise<{ objects: { key: string; size: number }[]; truncated: boolean; cursor?: string }>;
  createMultipartUpload(key: string, options?: { httpMetadata?: { contentType?: string } }): Promise<{ uploadId: string }>;
  resumeMultipartUpload(key: string, uploadId: string): {
    uploadPart(partNumber: number, value: ReadableStream | ArrayBuffer | string): Promise<{ partNumber: number; etag: string }>;
    complete(parts: { partNumber: number; etag: string }[]): Promise<{ size: number }>;
    abort(): Promise<void>;
  };
}

export type GatewayDeps = {
  bucket: Bucket;
  /** This container start's token. Empty means: refuse everything. */
  token: string;
  now: () => number;
  log: (msg: string) => void;
};

// Containers: "Cloudflare limits each HTTP request body forwarded from a Container ... to 100 MiB by default."
export const MAX_PART_BYTES = 100 * 1024 * 1024;

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const fail = (status: number, error: string) => json({ error }, status);

/** Constant-time comparison of two strings, so the token cannot be guessed one character at a time. */
function same(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** Every object under backups/, all pages. */
async function listAll(bucket: Bucket) {
  const out: { key: string; size: number }[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix: PREFIX, cursor, limit: 1000 });
    out.push(...page.objects.map((o) => ({ key: o.key, size: o.size })));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return out;
}

async function readManifest(bucket: Bucket, key: string): Promise<Manifest | null> {
  const obj = await bucket.get(key);
  if (!obj) return null;
  try {
    return parseManifest(JSON.parse(await obj.text()));
  } catch {
    return null;
  }
}

/** Every complete backup: an archive with a valid manifest whose recorded size matches. Newest first. */
export async function completeBackups(bucket: Bucket): Promise<Manifest[]> {
  const objects = await listAll(bucket);
  const sizes = new Map(objects.filter((o) => isBackupKey(o.key)).map((o) => [o.key, o.size]));
  const manifests = await Promise.all(
    objects.filter((o) => o.key.endsWith('.json') && sizes.has(o.key.replace(/\.json$/, '.tar.gz'))).map((o) => readManifest(bucket, o.key)),
  );
  return manifests
    .filter((m): m is Manifest => m !== null && sizes.get(m.key) === m.size)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function handleBackup(request: Request, d: GatewayDeps): Promise<Response> {
  if (!d.token || !same(request.headers.get('x-egg-token') ?? '', d.token)) return fail(403, 'forbidden');
  const url = new URL(request.url);
  const key = url.searchParams.get('key') ?? '';
  const uploadId = url.searchParams.get('uploadId') ?? '';
  const route = `${request.method} ${url.pathname}`;

  try {
    if (route === 'GET /index') {
      const pointer = await readManifest(d.bucket, POINTER);
      return json({ latest: pointer, backups: await completeBackups(d.bucket) });
    }

    // Every other route names one archive.
    if (route !== 'POST /commit' && !isBackupKey(key)) return fail(400, 'the key is not a backup archive key');

    if (route === 'GET /object') {
      const obj = await d.bucket.get(key);
      if (!obj) return fail(404, 'no such backup');
      return new Response(obj.body, { headers: { 'content-type': 'application/gzip', 'content-length': String(obj.size), 'cache-control': 'no-store' } });
    }

    if (route === 'POST /upload/start') {
      const m = parseManifest(await request.json().catch(() => null));
      if (!m || m.key !== key) return fail(400, 'the manifest is missing or names another key');
      if (await d.bucket.head(key)) return fail(409, 'a backup with this key already exists');
      const upload = await d.bucket.createMultipartUpload(key, { httpMetadata: { contentType: 'application/gzip' } });
      return json({ uploadId: upload.uploadId });
    }

    if (!uploadId) return route === 'POST /commit' ? commit(request, d) : fail(400, 'uploadId is missing');

    if (route === 'PUT /upload/part') {
      const part = Number(url.searchParams.get('part'));
      if (!Number.isInteger(part) || part < 1 || part > 10_000) return fail(400, 'the part number is not 1 to 10000');
      const length = Number(request.headers.get('content-length') ?? NaN);
      if (!Number.isFinite(length) || length < 0) return fail(411, 'a part needs a content-length');
      if (length > MAX_PART_BYTES) return fail(413, 'a part may be at most 100 MiB');
      if (!request.body) return fail(400, 'the part has no body');
      const uploaded = await d.bucket.resumeMultipartUpload(key, uploadId).uploadPart(part, request.body);
      return json({ partNumber: uploaded.partNumber, etag: uploaded.etag });
    }

    if (route === 'POST /upload/finish') {
      const body = (await request.json().catch(() => null)) as { parts?: unknown; manifest?: unknown } | null;
      const m = parseManifest(body?.manifest);
      const parts = Array.isArray(body?.parts) ? (body!.parts as { partNumber: number; etag: string }[]) : null;
      if (!m || m.key !== key || !parts || parts.length === 0) return fail(400, 'the manifest or the part list is missing');
      const obj = await d.bucket.resumeMultipartUpload(key, uploadId).complete(parts.map((p) => ({ partNumber: Number(p.partNumber), etag: String(p.etag) })));
      if (obj.size !== m.size) {
        await d.bucket.delete(key);
        return fail(400, `the uploaded archive is ${obj.size} bytes; the manifest says ${m.size}. It was deleted`);
      }
      // The manifest last: a backup without one is not complete, and /index does not list it.
      await d.bucket.put(manifestKey(key), JSON.stringify(m), { httpMetadata: { contentType: 'application/json' } });
      return json({ ok: true });
    }

    if (route === 'POST /upload/abort') {
      await d.bucket.resumeMultipartUpload(key, uploadId).abort();
      return json({ ok: true });
    }

    return fail(404, 'not found');
  } catch (error) {
    d.log(`backups: ${route} failed (${error instanceof Error ? error.message : 'unknown error'})`);
    return fail(500, 'the bucket operation failed');
  }
}

/** Points latest.json at a complete backup, then deletes what retention no longer keeps. */
async function commit(request: Request, d: GatewayDeps): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { key?: unknown } | null;
  const key = typeof body?.key === 'string' ? body.key : '';
  if (!isBackupKey(key)) return fail(400, 'the key is not a backup archive key');
  const m = await readManifest(d.bucket, manifestKey(key));
  const head = await d.bucket.head(key);
  if (!m || m.key !== key || !head || head.size !== m.size) return fail(409, 'that backup is not complete');
  await d.bucket.put(POINTER, JSON.stringify(m), { httpMetadata: { contentType: 'application/json' } });

  // Retention, after the pointer has moved. A failure here leaves extra backups, never fewer.
  let pruned = 0;
  try {
    const all = await completeBackups(d.bucket);
    const gone = toPrune(all, d.now(), key);
    for (const k of gone) {
      await d.bucket.delete([manifestKey(k), k]);
      pruned++;
    }
  } catch (error) {
    d.log(`backups: retention failed (${error instanceof Error ? error.message : 'unknown error'})`);
  }
  return json({ ok: true, pruned });
}
