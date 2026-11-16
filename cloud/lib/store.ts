// The backup store as the keeper sees it, and its one real form: plain HTTP to the Worker's backup gateway.
//
// The container holds no storage keys. The Durable Object that starts it routes the virtual host in
// EGG_BACKUP_URL (http://backup.internal) to a WorkerEntrypoint (studio/worker/backups.ts) through an outbound
// intercept, and that entrypoint reads and writes the R2 bucket. Each start makes a new random token: the gateway
// answers only requests that carry it (header x-egg-token), and the keeper never passes it to the server, the
// worker or their child programs.
//
// One request body may be at most 100 MiB (Containers: outbound HTTP request body size), so an archive goes up as
// an R2 multipart upload in parts of PART_BYTES. R2 needs every part but the last to be at least 5 MiB.
import { createWriteStream } from 'node:fs';
import { parseManifest, type Manifest } from './manifest.ts';

export const PART_BYTES = 32 * 1024 * 1024;

export type Index = {
  /** The manifest the pointer (latest.json) names, or null when there is no pointer. */
  latest: Manifest | null;
  /** Every complete backup, newest first. */
  backups: Manifest[];
};

export interface Store {
  /** What the bucket holds. Throws when the gateway cannot be reached or answers with an error. */
  index(): Promise<Index>;
  /** Downloads one archive to a local file. */
  download(key: string, to: string): Promise<void>;
  /** Uploads one archive with its manifest. It is not the backup to restore until commit(). */
  upload(file: string, manifest: Manifest): Promise<void>;
  /** Makes an uploaded backup the one to restore (writes latest.json), then deletes backups past retention. */
  commit(key: string): Promise<void>;
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export class HttpStore implements Store {
  constructor(
    private readonly base: string,
    private readonly token: string,
    private readonly fetcher: Fetch = fetch,
    /** The part size; tests use a small one. */
    private readonly partBytes = PART_BYTES,
  ) {}

  private async call(method: string, path: string, body?: BodyInit, type?: string): Promise<Response> {
    const headers: Record<string, string> = { 'x-egg-token': this.token };
    if (type) headers['content-type'] = type;
    const res = await this.fetcher(`${this.base}${path}`, { method, headers, body });
    if (!res.ok) {
      const text = (await res.text().catch(() => '')).slice(0, 300);
      throw new Error(`the backup store answered ${res.status} to ${method} ${path.split('?')[0]}${text ? `: ${text}` : ''}`);
    }
    return res;
  }

  async index(): Promise<Index> {
    const body = (await (await this.call('GET', '/index')).json()) as { latest?: unknown; backups?: unknown };
    if (!Array.isArray(body.backups)) throw new Error('the backup store answered without a list of backups');
    const latest = body.latest === null || body.latest === undefined ? null : parseManifest(body.latest);
    if (body.latest && !latest) throw new Error('the backup store answered with a pointer that is not a manifest');
    const backups = body.backups.map(parseManifest).filter((m): m is Manifest => m !== null).sort((a, b) => b.createdAt - a.createdAt);
    return { latest, backups };
  }

  async download(key: string, to: string): Promise<void> {
    const res = await this.call('GET', `/object?key=${encodeURIComponent(key)}`);
    if (!res.body) throw new Error('the backup store answered without a body');
    const out = createWriteStream(to);
    const done = new Promise<void>((resolve, reject) => { out.on('finish', resolve); out.on('error', reject); });
    for await (const chunk of res.body) {
      if (!out.write(chunk)) await new Promise<void>((resolve) => out.once('drain', () => resolve()));
    }
    out.end();
    await done;
  }

  async upload(file: string, manifest: Manifest): Promise<void> {
    const q = `key=${encodeURIComponent(manifest.key)}`;
    const { uploadId } = (await (await this.call('POST', `/upload/start?${q}`, JSON.stringify(manifest), 'application/json')).json()) as { uploadId: string };
    const u = `${q}&uploadId=${encodeURIComponent(uploadId)}`;
    try {
      const whole = Bun.file(file);
      const parts: { partNumber: number; etag: string }[] = [];
      const size = this.partBytes;
      for (let start = 0, n = 1; ; start += size, n++) {
        // A Blob slice of the file: Bun sends it with its length and reads it from disk as it goes.
        const part = whole.slice(start, Math.min(start + size, manifest.size));
        const res = await this.call('PUT', `/upload/part?${u}&part=${n}`, part, 'application/octet-stream');
        parts.push((await res.json()) as { partNumber: number; etag: string });
        if (start + size >= manifest.size) break;
      }
      await this.call('POST', `/upload/finish?${u}`, JSON.stringify({ parts, manifest }), 'application/json');
    } catch (error) {
      await this.call('POST', `/upload/abort?${u}`).catch(() => {});
      throw error;
    }
  }

  async commit(key: string): Promise<void> {
    await this.call('POST', '/commit', JSON.stringify({ key }), 'application/json');
  }
}
