// An R2 bucket in memory, with the multipart upload calls the backup gateway uses and the object metadata the
// publish step uses. `ops` records every call in order, so a test can show that nothing reached the bucket.
// Only tests import this file.
import type { Bucket } from './backups.ts';
import type { ContentBucket } from './publish.ts';

type Meta = { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> };

const toBytes = async (value: ReadableStream | ArrayBuffer | string): Promise<Uint8Array> =>
  typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value instanceof ArrayBuffer ? value : await new Response(value).arrayBuffer());

export class FakeBucket implements Bucket, ContentBucket {
  objects = new Map<string, Uint8Array>();
  /** What each object was put with. */
  meta = new Map<string, Meta & { uploaded: Date }>();
  /** Every call, in order: "head collection.md", "put history/...", "delete a,b", "list history/". */
  ops: string[] = [];
  /** Calls that throw, by their `ops` text: fail.add('put collection.md'). */
  fail = new Set<string>();
  uploads = new Map<string, { key: string; parts: Map<number, Uint8Array>; done: boolean }>();
  deleted: string[] = [];
  private next = 1;

  private op(text: string) {
    this.ops.push(text);
    if (this.fail.has(text)) throw new Error('the bucket answered 500');
  }

  async head(key: string) {
    this.op(`head ${key}`);
    const o = this.objects.get(key);
    const m = this.meta.get(key);
    return o ? { size: o.length, customMetadata: m?.customMetadata, uploaded: m?.uploaded } : null;
  }

  async get(key: string) {
    this.op(`get ${key}`);
    const o = this.objects.get(key);
    if (!o) return null;
    return { size: o.length, body: new Response(o).body!, text: async () => new TextDecoder().decode(o) };
  }

  async put(key: string, value: string | Uint8Array, options: Meta = {}) {
    this.op(`put ${key}`);
    this.objects.set(key, typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value));
    this.meta.set(key, { ...options, uploaded: new Date() });
  }

  async delete(keys: string | string[]) {
    const all = Array.isArray(keys) ? keys : [keys];
    this.op(`delete ${all.join(',')}`);
    for (const k of all) {
      this.objects.delete(k);
      this.meta.delete(k);
      this.deleted.push(k);
    }
  }

  async list({ prefix, cursor, limit = 1000 }: { prefix: string; cursor?: string; limit?: number }) {
    this.op(`list ${prefix}`);
    const keys = [...this.objects.keys()].filter((k) => k.startsWith(prefix)).sort();
    const start = cursor ? Number(cursor) : 0;
    const page = keys.slice(start, start + limit);
    const truncated = start + limit < keys.length;
    return { objects: page.map((key) => ({ key, size: this.objects.get(key)!.length })), truncated, cursor: truncated ? String(start + limit) : undefined };
  }

  async createMultipartUpload(key: string) {
    const uploadId = `upload-${this.next++}`;
    this.uploads.set(uploadId, { key, parts: new Map(), done: false });
    return { uploadId };
  }

  resumeMultipartUpload(key: string, uploadId: string) {
    const u = this.uploads.get(uploadId);
    const check = () => {
      if (!u || u.key !== key || u.done) throw new Error('no such multipart upload');
      return u;
    };
    return {
      uploadPart: async (partNumber: number, value: ReadableStream | ArrayBuffer | string) => {
        check().parts.set(partNumber, await toBytes(value));
        return { partNumber, etag: `etag-${partNumber}` };
      },
      complete: async (parts: { partNumber: number; etag: string }[]) => {
        const up = check();
        const chunks = parts.map((p) => {
          const bytes = up.parts.get(p.partNumber);
          if (!bytes || p.etag !== `etag-${p.partNumber}`) throw new Error('a part is missing');
          return bytes;
        });
        const all = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
        let at = 0;
        for (const c of chunks) { all.set(c, at); at += c.length; }
        this.objects.set(key, all);
        up.done = true;
        return { size: all.length };
      },
      abort: async () => {
        check().done = true;
      },
    };
  }
}
