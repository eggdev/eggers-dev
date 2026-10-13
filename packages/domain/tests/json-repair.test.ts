import { createDatabase } from '@repo/database';
import { migrations } from '@repo/database/schema';
import { createCareerService } from '@repo/domain';
import { Effect } from 'effect';
import { expect, it } from 'vitest';

it('repairs JSON encoded twice without changing existing structured data', async () => {
  const db = await createDatabase();
  try {
    const run = (action: string, input: unknown = {}) =>
      Effect.runPromise(createCareerService(db).execute(action, input));
    const prefs = await run('settings');
    await run('research.queue', { urls: ['https://example.com/json-repair'] });
    const [{ id }] = (await run('workspace')).listings;
    const requirements = [{ label: 'React', kind: 'technical', section: 'Skills', quote: 'React' }];
    await db.query("UPDATE listings SET requirements=$2::text::jsonb,status='ready' WHERE id=$1", [
      id,
      JSON.stringify(JSON.stringify(requirements)),
    ]);
    await db.query("UPDATE settings SET value=$1::text::jsonb WHERE id='owner'", [
      JSON.stringify(JSON.stringify(prefs)),
    ]);
    const thread = await run('threads.create', { title: 'Preserved conversation' });
    await db.query(
      'UPDATE threads SET session=$2::text::jsonb,events=$3::text::jsonb WHERE id=$1',
      [
        thread.id,
        JSON.stringify(JSON.stringify({ sessionId: 'existing', streamIndex: 42 })),
        JSON.stringify([{ type: 'existing-event' }]),
      ],
    );
    const repair = migrations.find((m) => m.version === 5);
    if (!repair) throw new Error('JSON repair migration is missing.');
    await db.transaction(
      repair.sql
        .split(';')
        .map((sql) => sql.trim())
        .filter(Boolean)
        .map((sql) => ({ sql })),
    );
    const workspace = await run('workspace');
    expect(workspace.settings).toEqual(prefs);
    expect(workspace.requirementHierarchy.totalRequirements).toBe(1);
    expect(await run('map.labels')).toMatchObject([{ label: 'React' }]);
    expect(workspace.threads[0].session).toEqual({ sessionId: 'existing', streamIndex: 42 });
    expect(workspace.threads[0].events).toEqual([{ type: 'existing-event' }]);
  } finally {
    await db.close();
  }
});
