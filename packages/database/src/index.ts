import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { migrations } from '@repo/database/schema';
import type { Sql } from 'postgres';

export type Statement = { sql: string; params?: unknown[] };
export interface Database {
  query<T extends Record<string, any> = Record<string, any>>(
    sql: string,
    params?: unknown[],
  ): Promise<T[]>;
  transaction(statements: Statement[]): Promise<void>;
  close(): Promise<void>;
}

export async function createDatabase(
  options: { url?: string; directory?: string } = {},
): Promise<Database> {
  let db: Database;
  if (options.url) {
    const { default: postgres } = await import('postgres');
    const sql: Sql = postgres(options.url, { max: 5, prepare: false });
    db = {
      query: async <T extends Record<string, any>>(text: string, params: unknown[] = []) =>
        Array.from(await sql.unsafe(text, params as never[])) as T[],
      transaction: async (statements) => {
        await sql.begin(async (tx) => {
          for (const statement of statements)
            await tx.unsafe(statement.sql, (statement.params ?? []) as never[]);
        });
      },
      close: () => sql.end(),
    };
  } else {
    const { PGlite: LocalPostgres } = await import('@electric-sql/pglite');
    if (options.directory) await mkdir(options.directory, { recursive: true });
    const local: PGlite = new LocalPostgres(options.directory);
    db = {
      query: async <T extends Record<string, any>>(text: string, params: unknown[] = []) =>
        (await local.query<T>(text, params)).rows,
      transaction: async (statements) => {
        await local.transaction(async (tx) => {
          for (const statement of statements) await tx.query(statement.sql, statement.params ?? []);
        });
      },
      close: () => local.close(),
    };
  }
  await db.query('CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY)');
  const applied = new Set(
    (await db.query('SELECT version FROM schema_migrations')).map((row) => row.version),
  );
  for (const migration of migrations) {
    if (!applied.has(migration.version)) {
      const statements = migration.sql
        .split(';')
        .map((sql) => sql.trim())
        .filter(Boolean)
        .map((sql) => ({ sql }));
      await db.transaction([
        ...statements,
        { sql: 'INSERT INTO schema_migrations(version) VALUES ($1)', params: [migration.version] },
      ]);
    }
  }
  return db;
}

const scope = globalThis as typeof globalThis & { careerDatabase?: Promise<Database> };
export function database(): Promise<Database> {
  if (!scope.careerDatabase) {
    if (process.env.VERCEL && !process.env.DATABASE_URL)
      throw new Error('DATABASE_URL is required on Vercel.');
    scope.careerDatabase = createDatabase({
      url: process.env.DATABASE_URL,
      directory: process.env.DATABASE_URL
        ? undefined
        : resolve(/* turbopackIgnore: true */ process.env.LOCAL_DATA_DIR ?? '.data/postgres'),
    });
    scope.careerDatabase.catch(() => {
      scope.careerDatabase = undefined;
    });
  }
  return scope.careerDatabase;
}
