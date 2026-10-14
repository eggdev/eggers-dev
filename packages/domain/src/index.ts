import { randomUUID } from 'node:crypto';
import type { Database } from '@repo/database';
import {
  ClassifyInput,
  EntryInputSchema,
  ExtractionInput,
  ImportInput,
  RoleInput,
  SettingsInput,
  ThreadInput,
  TopicInput,
} from '@repo/domain/contracts';
import { DomainError } from '@repo/domain/errors';
import { readTaxonomy, requirementTaxonomy } from '@repo/domain/requirement-taxonomy';
import { canonicalUrl, contentHash, fetchDescription } from '@repo/domain/research';
import { tracking } from '@repo/domain/tracking';
import type {
  Entry,
  EntryInput,
  Listing,
  Message,
  Proposal,
  Role,
  Settings,
  Thread,
  Topic,
  Workspace,
} from '@repo/domain/types';
import { Effect, Schema } from 'effect';

export { DomainError } from '@repo/domain/errors';
export type * from '@repo/domain/types';

function decode<T>(schema: Schema.Codec<T, any>, value: unknown): T {
  try {
    return Schema.decodeUnknownSync(schema)(value);
  } catch {
    throw new DomainError('Some fields are missing or invalid.');
  }
}
// Bind serialized JSON as text before casting; Postgres.js otherwise encodes it twice.
const json = (value: unknown) => JSON.stringify(value);
const requiredId = (value: unknown): string => {
  if (typeof value !== 'string' || !value || value.length > 200)
    throw new DomainError('A valid ID is required.');
  return value;
};
export type Actor = 'owner' | 'eve';
export function createCareerService(db: Database, retireSession?: (session: any) => Promise<void>) {
  const track = tracking(db);
  const taxonomy = requirementTaxonomy(db);
  const settings = async (): Promise<Settings> =>
    (await db.query('SELECT value FROM settings WHERE id=$1', ['owner']))[0].value;
  const workspace = async (): Promise<Workspace> => {
    const [roles, threads, entries, topics, listings, proposals, prefs] = await Promise.all([
      db.query<Role>('SELECT * FROM roles ORDER BY created_at'),
      db.query<Thread>('SELECT * FROM threads ORDER BY updated_at DESC'),
      db.query<Entry>(
        "SELECT e.*, COALESCE((SELECT jsonb_agg(message_id) FROM entry_sources WHERE entry_id=e.id),'[]') AS source_message_ids, COALESCE((SELECT jsonb_agg(capability_id ORDER BY capability_id) FROM entry_capabilities WHERE entry_id=e.id),'[]') AS capability_ids FROM entries e ORDER BY updated_at DESC",
      ),
      db.query<Topic>('SELECT * FROM topics ORDER BY label'),
      db.query<Listing>(
        "SELECT id,url,source_url,title,company,family,track,seniority,level,location,arrangement,requirements,status,error,duplicate_of,collected_at,content_hash,''::text AS description FROM listings ORDER BY collected_at DESC",
      ),
      db.query<Proposal>('SELECT * FROM proposals ORDER BY created_at'),
      settings(),
    ]);
    return {
      roles,
      threads,
      entries,
      topics,
      listings: listings.map((listing) => ({ ...listing, requirements: [] })),
      requirementHierarchy: (await readTaxonomy(db, listings as Listing[])).hierarchy,
      proposals,
      settings: prefs,
      storage: process.env.DATABASE_URL ? 'neon' : 'local',
      modelConnection: process.env.VERCEL
        ? 'disabled'
        : process.env.EVE_MODEL_CONNECTION === 'gateway'
          ? 'gateway'
          : 'subscription',
    };
  };
  async function saveEntry(raw: unknown, actor: Actor, mutationId?: string) {
    const input = decode(EntryInputSchema, raw) as EntryInput;
    const id = input.id ?? mutationId ?? randomUUID();
    const [existing] = await db.query<Entry>('SELECT * FROM entries WHERE id=$1', [id]);
    if (actor === 'eve' && (await settings()).reviewRequired) {
      const proposalId = mutationId ?? randomUUID();
      await db.query(
        'INSERT INTO proposals(id,entry_id,payload) VALUES($1,$2,$3::text::jsonb) ON CONFLICT(id) DO NOTHING',
        [
          proposalId,
          existing?.id ?? null,
          json({ ...input, id, expectedRevision: existing?.revision }),
        ],
      );
      return { proposed: true, id: proposalId };
    }
    if (existing && input.id && input.expectedRevision !== existing.revision)
      throw new DomainError('This entry changed. Reload it before saving.', 409);
    if (existing && !input.id) return existing; // replay of the same agent call
    // Omitted capability links keep the current associations; a supplied list replaces them.
    const capabilityIds = input.capabilityIds
      ? [...new Set(input.capabilityIds)].sort()
      : (
          await db.query<{ capability_id: string }>(
            'SELECT capability_id FROM entry_capabilities WHERE entry_id=$1 ORDER BY capability_id',
            [id],
          )
        ).map((r) => r.capability_id);
    if (input.capabilityIds?.length) {
      const known = await db.query<{ id: string }>(
        'SELECT id FROM requirement_capabilities WHERE id IN (SELECT jsonb_array_elements_text($1::text::jsonb))',
        [json(capabilityIds)],
      );
      if (known.length !== capabilityIds.length)
        throw new DomainError('Link entries only to existing requirement-map capabilities.');
    }
    const revision = (existing?.revision ?? 0) + 1;
    const params = [
      id,
      input.roleId ?? null,
      input.title,
      input.markdown,
      json(input.skills),
      revision,
      json(capabilityIds),
    ];
    const links = `history AS (
      INSERT INTO entry_revisions(entry_id,revision,title,markdown,skills,capability_ids) SELECT id,revision,title,markdown,skills,$7::text::jsonb FROM changed
    ), removed AS (
      DELETE FROM entry_capabilities WHERE entry_id=$1 AND capability_id NOT IN (SELECT jsonb_array_elements_text($7::text::jsonb)) AND EXISTS(SELECT 1 FROM changed)
    ), added AS (
      INSERT INTO entry_capabilities(entry_id,capability_id) SELECT changed.id, jsonb_array_elements_text($7::text::jsonb) FROM changed ON CONFLICT DO NOTHING
    ) SELECT * FROM changed`;
    const rows = existing
      ? await db.query<Entry>(
          `WITH changed AS (
      UPDATE entries SET role_id=$2,title=$3,markdown=$4,skills=$5::text::jsonb,revision=$6,updated_at=now()
      WHERE id=$1 AND revision=$8 RETURNING *), ${links}`,
          [...params, existing.revision],
        )
      : await db.query<Entry>(
          `WITH changed AS (
      INSERT INTO entries(id,role_id,title,markdown,skills,revision) VALUES($1,$2,$3,$4,$5::text::jsonb,$6) RETURNING *), ${links}`,
          params,
        );
    if (!rows.length) throw new DomainError('This entry changed. Reload it before saving.', 409);
    for (const messageId of input.sourceMessageIds)
      await db.query(
        'INSERT INTO entry_sources(entry_id,message_id) SELECT $1,id FROM messages WHERE id=$2 ON CONFLICT DO NOTHING',
        [id, messageId],
      );
    return { ...rows[0], capability_ids: capabilityIds };
  }
  async function retireAllSessions() {
    const threads = await db.query<Thread>('SELECT * FROM threads WHERE session IS NOT NULL');
    if (threads.length && !retireSession)
      throw new DomainError('Session retirement is unavailable. Try deletion through Studio.', 503);
    for (const thread of threads) {
      const sessionId = thread.session?.id ?? thread.session?.sessionId;
      if (sessionId)
        await db.query('INSERT INTO retired_sessions(id) VALUES($1) ON CONFLICT DO NOTHING', [
          sessionId,
        ]);
      await retireSession?.(thread.session);
    }
    await db.query("UPDATE threads SET session=NULL,events='[]'::jsonb");
  }
  async function propose(action: string, input: unknown, mutationId?: string) {
    const id = mutationId ?? randomUUID();
    await db.query(
      'INSERT INTO proposals(id,payload,action) VALUES($1,$2::text::jsonb,$3) ON CONFLICT(id) DO NOTHING',
      [id, json(input), action],
    );
    return { proposed: true, id };
  }
  async function dispatch(
    action: string,
    raw: any,
    actor: Actor,
    mutationId?: string,
  ): Promise<any> {
    if (action.startsWith('jobs.')) {
      if (actor !== 'owner')
        throw new DomainError('Job tracking changes require owner access.', 403);
      return track(action, raw);
    }
    if (action.startsWith('map.')) return taxonomy(action, raw);
    switch (action) {
      case 'workspace':
        return workspace();
      case 'settings':
        return settings();
      case 'settings.save': {
        const input = decode(SettingsInput, raw);
        await db.query('UPDATE settings SET value=$1::text::jsonb WHERE id=$2', [
          json(input),
          'owner',
        ]);
        return input;
      }
      case 'roles.save': {
        const input = decode(RoleInput, raw);
        const id = raw.id ?? mutationId ?? randomUUID();
        if (actor === 'eve' && (await settings()).reviewRequired)
          return propose(action, { ...input, id }, mutationId);
        return (
          await db.query(
            'INSERT INTO roles(id,title,company,dates,context) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET title=$2,company=$3,dates=$4,context=$5 RETURNING *',
            [id, input.title, input.company ?? '', input.dates ?? '', input.context ?? ''],
          )
        )[0];
      }
      case 'roles.delete': {
        const id = requiredId(raw.id);
        await retireAllSessions();
        await db.transaction([
          {
            sql: `DELETE FROM proposals WHERE payload->>'roleId'=$1 OR (action='roles.save' AND payload->>'id'=$1) OR payload->'sourceMessageIds' ?| ARRAY(SELECT m.id FROM messages m JOIN threads t ON t.id=m.thread_id WHERE t.role_id=$1)`,
            params: [id],
          },
          {
            sql: 'DELETE FROM entries WHERE role_id=$1 OR id IN (SELECT s.entry_id FROM entry_sources s JOIN messages m ON m.id=s.message_id JOIN threads t ON t.id=m.thread_id WHERE t.role_id=$1)',
            params: [id],
          },
          { sql: 'DELETE FROM threads WHERE role_id=$1', params: [id] },
          { sql: 'DELETE FROM roles WHERE id=$1', params: [id] },
        ]);
        return { ok: true };
      }
      case 'threads.create': {
        const input = decode(ThreadInput, raw);
        return (
          await db.query('INSERT INTO threads(id,title,role_id) VALUES($1,$2,$3) RETURNING *', [
            mutationId ?? randomUUID(),
            input.title,
            input.roleId ?? null,
          ])
        )[0];
      }
      case 'threads.get': {
        const id = requiredId(raw.id);
        const [thread] = await db.query<Thread>('SELECT * FROM threads WHERE id=$1', [id]);
        if (!thread) throw new DomainError('Conversation not found.', 404);
        return {
          thread,
          messages: await db.query<Message>(
            'SELECT * FROM messages WHERE thread_id=$1 ORDER BY position',
            [id],
          ),
        };
      }
      case 'threads.phase': {
        if (!['recall', 'discovery'].includes(raw.phase))
          throw new DomainError('Unknown interview phase.');
        await db.query('UPDATE threads SET phase=$2,updated_at=now() WHERE id=$1', [
          requiredId(raw.id),
          raw.phase,
        ]);
        return { ok: true };
      }
      case 'threads.cursor': {
        const id = requiredId(raw.id);
        const sessionId = raw.session?.id ?? raw.session?.sessionId;
        if (
          sessionId &&
          (await db.query('SELECT id FROM retired_sessions WHERE id=$1', [sessionId])).length
        )
          return { ok: false, retired: true };
        await db.query(
          'UPDATE threads SET session=$2::text::jsonb,events=$3::text::jsonb,updated_at=now() WHERE id=$1',
          [id, json(raw.session ?? null), json(raw.events ?? [])],
        );
        return { ok: true };
      }
      case 'messages.save': {
        const id = requiredId(raw.id),
          threadId = requiredId(raw.threadId),
          sessionId = requiredId(raw.sessionId);
        if ((await db.query('SELECT id FROM retired_sessions WHERE id=$1', [sessionId])).length)
          return { retired: true };
        if (
          !['user', 'assistant'].includes(raw.kind) ||
          typeof raw.body !== 'string' ||
          raw.body.length > 200_000
        )
          throw new DomainError('Invalid message.');
        await db.query(
          'INSERT INTO messages(id,thread_id,kind,body,turn_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING',
          [id, threadId, raw.kind, raw.body, typeof raw.turnId === 'string' ? raw.turnId : null],
        );
        // Save the session server-side even if the browser disconnects before receiving its cursor.
        await db.query(
          'UPDATE threads SET session=COALESCE(session,$2::text::jsonb),updated_at=now() WHERE id=$1',
          [threadId, json({ id: sessionId })],
        );
        return { ok: true };
      }
      case 'context': {
        const state = await workspace();
        const thread = state.threads.find((t) => t.id === raw.threadId);
        const messages = thread
          ? await db.query(
              'SELECT id,kind,body FROM messages WHERE thread_id=$1 ORDER BY position DESC LIMIT 40',
              [thread.id],
            )
          : [];
        return {
          settings: state.settings,
          roles: state.roles,
          thread: thread
            ? { id: thread.id, title: thread.title, roleId: thread.role_id, phase: thread.phase }
            : null,
          entries: state.entries.map((e) => ({
            id: e.id,
            roleId: e.role_id,
            title: e.title,
            markdown: e.markdown,
            skills: e.skills,
            capabilityIds: e.capability_ids,
            revision: e.revision,
          })),
          topics: state.topics,
          requirements: {
            ...state.requirementHierarchy,
            listings: undefined,
            capabilities: state.requirementHierarchy.capabilities.map(
              ({ experience_guide, prompts, distinctions, aliases, ...summary }) => summary,
            ),
          },
          messages: messages.reverse(),
        };
      }
      case 'entries.save':
        return saveEntry(raw, actor, mutationId);
      case 'entries.history':
        return db.query('SELECT * FROM entry_revisions WHERE entry_id=$1 ORDER BY revision DESC', [
          requiredId(raw.id),
        ]);
      case 'entries.delete': {
        const id = requiredId(raw.id);
        await retireAllSessions();
        await db.transaction([
          {
            sql: `DELETE FROM proposals WHERE payload->'sourceMessageIds' ?| ARRAY(SELECT id FROM messages WHERE id IN (SELECT message_id FROM entry_sources WHERE entry_id=$1) OR (thread_id,turn_id) IN (SELECT m.thread_id,m.turn_id FROM messages m JOIN entry_sources s ON s.message_id=m.id WHERE s.entry_id=$1 AND m.turn_id IS NOT NULL))`,
            params: [id],
          },
          {
            sql: `DELETE FROM messages WHERE id IN (SELECT message_id FROM entry_sources WHERE entry_id=$1) OR (thread_id,turn_id) IN (SELECT m.thread_id,m.turn_id FROM messages m JOIN entry_sources s ON s.message_id=m.id WHERE s.entry_id=$1 AND m.turn_id IS NOT NULL)`,
            params: [id],
          },
          { sql: 'DELETE FROM entries WHERE id=$1', params: [id] },
        ]);
        return { ok: true };
      }
      case 'threads.delete': {
        const id = requiredId(raw.id);
        await retireAllSessions();
        // Delete derived knowledge as well as its sources. The owner requested real deletion.
        await db.transaction([
          {
            sql: `DELETE FROM proposals WHERE payload->'sourceMessageIds' ?| ARRAY(SELECT id FROM messages WHERE thread_id=$1)`,
            params: [id],
          },
          {
            sql: 'DELETE FROM entries WHERE id IN (SELECT entry_id FROM entry_sources s JOIN messages m ON m.id=s.message_id WHERE m.thread_id=$1)',
            params: [id],
          },
          { sql: 'DELETE FROM threads WHERE id=$1', params: [id] },
        ]);
        return { ok: true };
      }
      case 'proposals.accept': {
        const id = requiredId(raw.id);
        const [proposal] = await db.query('SELECT * FROM proposals WHERE id=$1', [id]);
        if (!proposal) throw new DomainError('Proposed change not found.', 404);
        const result = await dispatch(proposal.action, raw.payload ?? proposal.payload, 'owner');
        await db.query('DELETE FROM proposals WHERE id=$1', [id]);
        return result;
      }
      case 'proposals.reject':
        await db.query('DELETE FROM proposals WHERE id=$1', [requiredId(raw.id)]);
        return { ok: true };
      case 'topics.save': {
        const input = decode(TopicInput, raw);
        const id = input.id ?? mutationId ?? randomUUID();
        if (actor === 'eve' && (await settings()).reviewRequired)
          return propose(action, { ...input, id }, mutationId);
        return (
          await db.query(
            'INSERT INTO topics(id,role_id,label,status,notes) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET label=$3,status=$4,notes=$5 RETURNING *',
            [id, input.roleId ?? null, input.label, input.status, input.notes ?? ''],
          )
        )[0];
      }
      case 'topics.delete':
        await db.query('DELETE FROM topics WHERE id=$1', [requiredId(raw.id)]);
        return { ok: true };
      case 'research.queue': {
        const input = decode(ImportInput, raw);
        const results = [];
        for (const source of input.urls) {
          try {
            const url = canonicalUrl(source);
            const rows = await db.query(
              'INSERT INTO listings(id,url,source_url,family) VALUES($1,$2,$3,$4) ON CONFLICT(url) DO NOTHING RETURNING id',
              [randomUUID(), url, source, input.family ?? ''],
            );
            results.push({ url, status: rows.length ? 'queued' : 'existing' });
          } catch {
            results.push({ url: source, status: 'invalid' });
          }
        }
        return results;
      }
      case 'research.get': {
        const [listing] = await db.query<Listing>('SELECT * FROM listings WHERE id=$1', [
          requiredId(raw.id),
        ]);
        if (!listing) throw new DomainError('Listing not found.', 404);
        return listing;
      }
      case 'research.summary': {
        const listings = await db.query(
          'SELECT id,url,title,company,status,error FROM listings ORDER BY collected_at',
        );
        const counts: Record<string, number> = {};
        for (const row of listings) counts[row.status] = (counts[row.status] ?? 0) + 1;
        return {
          total: listings.length,
          counts,
          gaps: listings.filter((row) => ['needs_browser', 'failed'].includes(row.status)),
        };
      }
      case 'research.pending':
        return db.query(
          "SELECT * FROM listings WHERE status IN ('queued','extracting') AND duplicate_of IS NULL ORDER BY collected_at LIMIT 5",
        );
      case 'research.fetch': {
        const id = requiredId(raw.id);
        const [listing] = await db.query<Listing>('SELECT * FROM listings WHERE id=$1', [id]);
        if (!listing) throw new DomainError('Listing not found.', 404);
        if (listing.status === 'ready' && !raw.refresh) return { status: 'unchanged', listing };
        if (listing.description && !raw.refresh) return { status: listing.status, listing };
        await db.query(
          "UPDATE listings SET status=CASE WHEN status='ready' THEN status ELSE 'fetching' END,attempts=attempts+1,error=NULL WHERE id=$1",
          [id],
        );
        try {
          const page = await fetchDescription(listing.url);
          return dispatch('research.capture', { id, ...page }, actor);
        } catch (error) {
          await db.query("UPDATE listings SET status='needs_browser',error=$2 WHERE id=$1", [
            id,
            error instanceof Error ? error.message : 'Retrieval failed.',
          ]);
          return {
            id,
            status: 'needs_browser',
            error: error instanceof Error ? error.message : 'Retrieval failed.',
          };
        }
      }
      case 'research.capture': {
        const id = requiredId(raw.id);
        if (
          typeof raw.description !== 'string' ||
          raw.description.length < 100 ||
          raw.description.length > 100_000
        )
          throw new DomainError('A description between 100 and 100,000 characters is required.');
        const hash = contentHash(raw.description);
        const [existing] = await db.query<Listing>('SELECT * FROM listings WHERE id=$1', [id]);
        if (!existing) throw new DomainError('Listing not found.', 404);
        if (existing.content_hash === hash && existing.status === 'ready')
          return { id, status: 'unchanged' };
        const [duplicate] = await db.query(
          'SELECT id FROM listings WHERE content_hash=$1 AND id<>$2 AND duplicate_of IS NULL ORDER BY collected_at LIMIT 1',
          [hash, id],
        );
        await db.query(
          "UPDATE listings SET description=$2,content_hash=$3,title=$4,company=$5,status='extracting',error=NULL,parser_version=$6,duplicate_of=$7 WHERE id=$1",
          [
            id,
            raw.description,
            hash,
            String(raw.title ?? '').slice(0, 500),
            String(raw.company ?? '').slice(0, 500),
            raw.method ?? 'browser-v1',
            duplicate?.id ?? null,
          ],
        );
        return { id, status: duplicate ? 'duplicate' : 'extracting', duplicateOf: duplicate?.id };
      }
      case 'research.extract': {
        const id = requiredId(raw.id);
        const input = decode(ExtractionInput, raw);
        const [listing] = await db.query<Listing>('SELECT * FROM listings WHERE id=$1', [id]);
        if (!listing?.description)
          throw new DomainError('Fetch the source before extracting requirements.');
        // Keep source evidence literal: extraction cannot invent qualifications.
        const normalize = (s: string) => s.replace(/\s+/g, ' ').toLowerCase().trim();
        for (const req of input.requirements)
          if (!req.quote.trim() || !normalize(listing.description).includes(normalize(req.quote)))
            throw new DomainError(
              `Requirement "${req.label}" needs an exact excerpt from the source.`,
            );
        await db.query(
          "UPDATE listings SET title=$2,company=$3,family=$4,seniority=$5,location=$6,arrangement=$7,requirements=$8::text::jsonb,status='ready',parsed_at=now(),model=$9,error=NULL,track=$10,level=$11 WHERE id=$1",
          [
            id,
            input.title,
            input.company,
            input.family,
            input.seniority,
            input.location,
            input.arrangement,
            json(input.requirements),
            (await settings()).extractionModel,
            input.track,
            input.level,
          ],
        );
        return { id, status: 'ready', requirements: input.requirements.length };
      }
      case 'research.classify': {
        const input = decode(ClassifyInput, raw);
        const rows = await db.query(
          'UPDATE listings SET track=$2,level=$3 WHERE id=$1 RETURNING id,track,level',
          [input.id, input.track, input.level],
        );
        if (!rows.length) throw new DomainError('Listing not found.', 404);
        return rows[0];
      }
      case 'research.retry':
        await db.query(
          "UPDATE listings SET status=CASE WHEN description='' THEN 'queued' ELSE 'extracting' END,error=NULL WHERE id=$1",
          [requiredId(raw.id)],
        );
        return { ok: true };
      case 'research.blocked':
        await db.query(
          "UPDATE listings SET status='needs_browser',error=$2 WHERE id=$1 AND status<>'ready'",
          [
            requiredId(raw.id),
            String(raw.error ?? 'The original description could not be captured.').slice(0, 2000),
          ],
        );
        return { ok: true };
      case 'research.delete':
        await db.query('DELETE FROM listings WHERE id=$1', [requiredId(raw.id)]);
        return { ok: true };
      default:
        throw new DomainError('Unknown operation.', 404);
    }
  }
  return {
    execute: (action: string, input: unknown = {}, actor: Actor = 'owner', mutationId?: string) =>
      Effect.tryPromise({
        try: () => dispatch(action, input, actor, mutationId),
        catch: (error) =>
          error instanceof DomainError
            ? error
            : new DomainError(error instanceof Error ? error.message : 'Operation failed.', 500),
      }),
  };
}
