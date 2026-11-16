// Test helpers: an in-memory backup store and tiny invented databases. Only the tests import this file.
import { Database } from 'bun:sqlite';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { toPrune, type Manifest } from './manifest.ts';
import type { Index, Store } from './store.ts';

/** A store in memory. `events` records each upload and commit in order; `fail` makes the next calls throw. */
export class FakeStore implements Store {
  objects = new Map<string, Uint8Array>();
  manifests = new Map<string, Manifest>();
  pointer: Manifest | null = null;
  events: string[] = [];
  fail: { index?: number; download?: number; upload?: number } = {};
  now = () => Date.now();

  async index(): Promise<Index> {
    if (this.fail.index && this.fail.index-- > 0) throw new Error('connect ECONNREFUSED');
    const backups = [...this.manifests.values()].filter((m) => this.objects.has(m.key)).sort((a, b) => b.createdAt - a.createdAt);
    return { latest: this.pointer, backups };
  }

  async download(key: string, to: string): Promise<void> {
    if (this.fail.download && this.fail.download-- > 0) throw new Error('the connection was reset');
    const bytes = this.objects.get(key);
    if (!bytes) throw new Error(`the backup store answered 404 for ${key}`);
    mkdirSync(dirname(to), { recursive: true });
    writeFileSync(to, bytes);
  }

  async upload(file: string, manifest: Manifest): Promise<void> {
    this.events.push(`upload ${manifest.key}`);
    if (this.fail.upload && this.fail.upload-- > 0) throw new Error('the backup store answered 500');
    this.objects.set(manifest.key, new Uint8Array(readFileSync(file)));
    this.manifests.set(manifest.key, manifest);
  }

  async commit(key: string): Promise<void> {
    this.events.push(`commit ${key}`);
    const m = this.manifests.get(key);
    if (!m || !this.objects.has(key)) throw new Error('commit of a backup that is not uploaded');
    this.pointer = m;
    for (const old of toPrune([...this.manifests.values()], this.now(), key)) {
      this.objects.delete(old);
      this.manifests.delete(old);
    }
  }
}

/** A tiny invented database in WAL mode, as the app makes it, with this many roles and facts. */
export function makeDb(path: string, roles = 2, facts = 5, jobs = 1): void {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.run('PRAGMA journal_mode = WAL');
  db.run('CREATE TABLE IF NOT EXISTS roles (id INTEGER PRIMARY KEY, title TEXT)');
  db.run('CREATE TABLE IF NOT EXISTS facts (id INTEGER PRIMARY KEY, text TEXT)');
  db.run("CREATE TABLE IF NOT EXISTS jobs (id INTEGER PRIMARY KEY, status TEXT NOT NULL DEFAULT 'done', resume_status TEXT NOT NULL DEFAULT '', outreach_status TEXT NOT NULL DEFAULT '')");
  db.run("CREATE TABLE IF NOT EXISTS sources (id INTEGER PRIMARY KEY, status TEXT NOT NULL DEFAULT 'done')");
  for (let i = 0; i < roles; i++) db.query('INSERT INTO roles (title) VALUES (?)').run(`Invented role ${i}`);
  for (let i = 0; i < facts; i++) db.query('INSERT INTO facts (text) VALUES (?)').run(`Invented fact ${i} ${'x'.repeat(200)}`);
  for (let i = 0; i < jobs; i++) db.run("INSERT INTO jobs (status) VALUES ('done')");
  db.close();
}
