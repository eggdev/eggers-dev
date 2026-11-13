// `bun tools/refresh.ts [steps…]`: brings everything derived from the bank up to date, with the
// code as it is now. Steps, in order when several are named: sources (reads any waiting source),
// dedupe (folds duplicate facts), profile (rewrites it), jobs (reads every job again).
// With no step named it runs them all. Run it while the worker is idle.
import { copyFileSync } from 'node:fs';
import { applyExtraction, associate, bankSignature, db, type SourceRow } from '../lib/db.ts';
import { dedupe } from '../lib/dedupe.ts';
import { read } from '../lib/ingest.ts';
import { analyze, publish, saveResume, type JobRow } from '../lib/jobs.ts';
import { DB_FILE, inData } from '../lib/paths.ts';
import { write } from '../lib/profile.ts';

const steps = process.argv.slice(2).length ? process.argv.slice(2) : ['sources', 'dedupe', 'profile', 'jobs'];
const count = () => (db.query('SELECT count(*) AS n FROM facts').get() as { n: number }).n;
db.run('PRAGMA wal_checkpoint(TRUNCATE)');
copyFileSync(DB_FILE, `${DB_FILE}.before-refresh`);
console.log(`backup: ${DB_FILE}.before-refresh`);

if (steps.includes('sources')) {
  for (const s of db.query("SELECT * FROM sources WHERE status = 'held' ORDER BY id").all() as SourceRow[]) {
    const before = count();
    try {
      const n = applyExtraction(s.id, await read(s), Date.now());
      associate();
      db.query("UPDATE sources SET status = 'done', note = ? WHERE id = ?").run(n === 0 ? 'Nothing new was found in it.' : '', s.id);
      console.log(`source "${s.title}": ${n} facts added or filled in (bank ${before} -> ${count()})`);
    } catch (e) { db.query("UPDATE sources SET status = 'failed', note = ? WHERE id = ?").run((e as Error).message, s.id); console.log(`source "${s.title}" failed: ${(e as Error).message}`); }
  }
}
if (steps.includes('dedupe')) { const before = count(); const gone = await dedupe(); console.log(`dedupe: ${gone} duplicates folded (bank ${before} -> ${count()})`); }
if (steps.includes('profile')) {
  const signature = bankSignature();
  try {
    const p = await write();
    db.query("UPDATE profile SET status = 'done', note = '', body = ?, gaps = ?, signature = ?, updated_at = ? WHERE id = 1").run(p.markdown.trim(), p.gaps.map((g) => g.trim()).filter(Boolean).join('\n'), signature, Date.now());
    await Bun.write(inData('profile.md'), `${p.markdown.trim()}\n`);
    console.log(`profile: written, ${p.markdown.length} characters, ${p.gaps.length} questions`);
  } catch (e) { console.log(`profile failed: ${(e as Error).message}`); }
}
if (steps.includes('jobs')) {
  const queue = db.query("SELECT * FROM jobs WHERE posting != '' ORDER BY id").all() as JobRow[];
  const next = async (): Promise<void> => {
    const job = queue.shift();
    if (!job) return;
    try {
      const a = await analyze(job.posting, job.pages);
      db.query("UPDATE jobs SET status = 'done', note = '', title = ?, company = ?, place = ?, fit = ?, analysis = ?, resume = ?, edited = 0, updated_at = ? WHERE id = ?").run(a.title || job.title, a.company, a.place, a.fit, JSON.stringify(a.analysis), a.resume, Date.now(), job.id);
      saveResume({ id: job.id, company: a.company, title: a.title }, a.resume);
      await publish(job.id);
      console.log(`job ${job.id} (${a.company}): fit ${job.fit} -> ${a.fit}; own fit test: ${(a.analysis.checks ?? []).map((c) => c.answer).join(', ') || 'none'}`);
    } catch (e) { console.log(`job ${job.id} failed: ${(e as Error).message}`); }
    return next();
  };
  await Promise.all([next(), next(), next()]);
}
console.log('refresh done');
