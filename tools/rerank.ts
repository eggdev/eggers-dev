// `bun tools/rerank.ts`: reads every job again against the bank as it is now, three at a time,
// and prints the old and new fit. The same work as Read Again on each job; use it after changing
// the weights in lib/jobs.ts or the kinds of work under Experience. Run it while the worker is idle.
import { db } from '../lib/db.ts';
import { analyze, publish, saveResume, type JobRow } from '../lib/jobs.ts';
import { setResume } from '../lib/versions.ts';

const jobs = db.query("SELECT * FROM jobs WHERE posting != '' ORDER BY id").all() as JobRow[];
const queue = [...jobs];
async function next(): Promise<void> {
  const job = queue.shift();
  if (!job) return;
  try {
    const a = await analyze(job.posting, job.pages);
    setResume(job.id, a.resume, a.links, 'written', 'Written again when every job was read again.',
      { set: { status: 'done', note: '', title: a.title || job.title, company: a.company, place: a.place, fit: a.fit, analysis: JSON.stringify(a.analysis), updated_at: Date.now() } });
    saveResume({ id: job.id, company: a.company, title: a.title }, a.resume);
      await publish(job.id);
    console.log(`job ${job.id}: fit ${job.fit} -> ${a.fit}`);
  } catch (e) { console.log(`job ${job.id}: failed: ${(e as Error).message}`); }
  return next();
}
await Promise.all([next(), next(), next()]);
console.log('done');
