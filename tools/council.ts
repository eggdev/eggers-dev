// `bun tools/council.ts [job id ...]`: has the council review the resume of each job not yet sent
// (or of the jobs named), rewriting any that fall short. Two at a time. Backs the database up first.
import { copyFileSync } from 'node:fs';
import { db } from '../lib/db.ts';
import { review, type JobRow } from '../lib/jobs.ts';
import { inData } from '../lib/paths.ts';

copyFileSync(inData('egg.db'), inData('egg.db.before-council'));
const ids = process.argv.slice(2).map(Number).filter(Boolean);
const queue = (db.query("SELECT * FROM jobs WHERE resume != '' AND posting != '' ORDER BY fit DESC").all() as JobRow[]).filter((j) => (ids.length ? ids.includes(j.id) : j.outcome === ''));
console.log(`${queue.length} resumes to review`);
const next = async (): Promise<void> => {
  const job = queue.shift();
  if (!job) return;
  try {
    const r = await review(job);
    console.log(`job ${job.id} (${job.company}): ${r.score}/10 after ${r.rounds} ${r.rounds === 1 ? 'rewrite' : 'rewrites'}${r.passed ? '' : ', short of 8'}`);
  } catch (e) { console.log(`job ${job.id} (${job.company}) failed: ${(e as Error).message}`); }
  return next();
};
await Promise.all([next(), next()]);
